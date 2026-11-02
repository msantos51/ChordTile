import './fonts';
import './styles.css';
import type * as AlphaTab from '@coderline/alphatab';
import { analyzeBar, isBassTrack, label, sectionsFromScore, type LabelOptions, type Section } from './analysis/analyze';
import { parseScore } from './analysis/parse';
import { pitchClassesOf } from './app/notes';
import { exportPdf } from './app/pdf';
import { barView, type BarView } from './analysis/bar';
import { autoSub, beatInfo, countLabels, slotOf, type Sub } from './app/count';
import { VisualDelay } from './app/sync';
import { releaseAudio, unlockAudio } from './app/audio-unlock';
import { TOUR_STEPS, markTourSeen, tourSeen, visibleTarget } from './app/tour';
import { askPersistentStorage, deleteSong, getSong, listSongs, relativeDay, saveSong, takePendingFile, touchSong } from './app/library';
import { TAB_COLORS, applyTheme, currentTheme, type Theme } from './app/theme';

type Score = AlphaTab.model.Score;
type Track = AlphaTab.model.Track;

// O alphaTab é carregado como script clássico (public/vendor/alphatab), porque os workers
// do leitor e do desenho precisam de um ficheiro único que possam reabrir.
const at = (window as unknown as { alphaTab: typeof AlphaTab }).alphaTab;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);

const base = new URL('.', location.href).href;
const vendor = base + 'vendor/alphatab/';
const PLAYING = 1; // alphaTab.synth.PlayerState.Playing
/** Ecrã tátil: tocar num quadrado escolhe o compasso (sem abrir o teclado); editar é no botão "Editar". */
const coarse = matchMedia('(pointer: coarse)').matches;
/** Tablatura mais compacta em ecrãs estreitos (dois compassos por linha em vez de um). */
const tabLayout = () => (innerWidth < 600 ? { scale: 0.78, barsPerRow: 2 } : { scale: 0.95, barsPerRow: -1 });

interface State {
  score: Score | null;
  fileKey: string;
  isSample: boolean;
  sections: Section[];
  /** Correções do utilizador, por instrumento (índice da pista) e por compasso. */
  overridesByTrack: Record<number, Record<number, string>>;
  detected: string[];
  fileFlag: boolean[];
  perRow: number;
  viewTrack: number;
  loopSection: number;
  /** Compasso em loop (ou -1). */
  loopBar: number;
  /** Compasso escolhido na tablatura (ou -1). */
  tabSel: number;
  selBar: number;
  playingBar: number;
  api: AlphaTab.AlphaTabApi | null;
  ready: boolean;
  syncMs: number;
}

const st: State = {
  score: null, fileKey: '', isSample: true,
  sections: [], overridesByTrack: {}, detected: [], fileFlag: [],
  perRow: 4, viewTrack: 0,
  loopSection: -1, loopBar: -1, tabSel: -1, selBar: -1, playingBar: -1, api: null, ready: false, syncMs: 0,
};
const score = () => st.score as Score;
const api = () => st.api as AlphaTab.AlphaTabApi;
/** Correções do instrumento selecionado. */
const ov = () => (st.overridesByTrack[st.viewTrack] ??= {});

// ---------- Utilidades ----------
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200);
}
function showErr(msg: string) { const e = $('err'); e.textContent = msg; e.hidden = !msg; }

const storage = {
  get<T>(key: string): T | null {
    try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem armazenamento */ }
  },
};
interface SavedSong {
  sections: Section[];
  overridesByTrack?: Record<number, Record<number, string>>;
  /** Formato antigo: correções sem instrumento. */
  overrides?: Record<number, string>;
  perRow: number;
  track?: number;
}
const save = () => storage.set('mapa:' + st.fileKey, {
  sections: st.sections, overridesByTrack: st.overridesByTrack, perRow: st.perRow, track: st.viewTrack,
} satisfies SavedSong);

function opts(): LabelOptions & { splitBars: boolean; useFileChords: boolean } {
  return {
    showMinor: input('optMinor').checked, splitBars: input('optSplit').checked, useFileChords: input('optFileChords').checked,
    latin: select('optNames').value === 'latin', accidentals: select('optAcc').value as LabelOptions['accidentals'],
  };
}

// Altura do leitor flutuante (para margens e barras por cima dele)
new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', $('dock').offsetHeight + 'px')).observe($('dock'));

// ---------- Sincronização ----------
const delay = new VisualDelay(() => st.syncMs, () => !!st.api && st.api.playerState === PLAYING);
function setSync(v: number) {
  st.syncMs = Math.max(0, Math.min(500, Math.round(v / 10) * 10));
  input('syncMs').value = String(st.syncMs);
  $('syncOut').textContent = st.syncMs + ' ms';
  storage.set('mapa:sync', st.syncMs);
}
setSync(storage.get<number>('mapa:sync') ?? 0);
input('syncMs').addEventListener('input', () => setSync(+input('syncMs').value));
$('syncMinus').addEventListener('click', () => setSync(st.syncMs - 10));
$('syncPlus').addEventListener('click', () => setSync(st.syncMs + 10));

// ---------- Carregar música ----------
function loadBytes(bytes: Uint8Array, name: string, isSample: boolean): boolean {
  let s: Score;
  try { s = parseScore(at, bytes); }
  catch (e) {
    showErr('Não consegui ler “' + name + '”: o ficheiro está danificado ou num formato que não é suportado. Aceita ficheiros Guitar Pro 3 a 8 (.gp3, .gp4, .gp5, .gpx, .gp) e MusicXML. Se o ficheiro abre no Guitar Pro, experimenta guardá-lo como .gp5.');
    console.error(e);
    return false;
  }
  showErr('');
  st.score = s; st.isSample = isSample;
  st.fileKey = (s.title || name) + '|' + (s.artist || '') + '|' + s.masterBars.length;
  const pitched = s.tracks.map((_, i) => i).filter(i => !isPercussion(s.tracks[i]));
  const bassIdx = pitched.find(i => isBassTrack(s.tracks[i]));
  st.loopSection = -1; st.loopBar = -1; st.tabSel = -1; st.selBar = -1; st.playingBar = -1;
  $('tabSel').hidden = true; closeBarModal();

  const saved = storage.get<SavedSong>('mapa:' + st.fileKey);
  // Instrumento: o último escolhido para esta música; senão o baixo; senão o primeiro com notas.
  const savedOk = saved?.track != null && s.tracks[saved.track] && !isPercussion(s.tracks[saved.track]);
  st.viewTrack = savedOk ? saved!.track! : bassIdx ?? pitched[0] ?? 0;
  st.sections = saved?.sections?.length ? saved.sections : sectionsFromScore(s);
  st.overridesByTrack = saved?.overridesByTrack ?? (saved?.overrides ? { [st.viewTrack]: saved.overrides } : {});
  if (saved?.perRow) { st.perRow = saved.perRow; select('perRow').value = String(saved.perRow); }

  renderInfo(name); renderTrackControls(); detect(); renderChart(); renderTab(); updateNow(-1, 0);
  return true;
}

function renderInfo(name: string) {
  const s = score();
  $('songTitle').textContent = s.title || name.replace(/\.[^.]+$/, '');
  document.title = $('songTitle').textContent + ' · Mapa de Compassos';
  const mb = s.masterBars[0];
  const parts = [s.artist, s.masterBars.length + ' compassos', Math.round(s.tempo) + ' bpm', mb ? mb.timeSignatureNumerator + '/' + mb.timeSignatureDenominator : ''];
  const m = $('songMeta'); m.textContent = parts.filter(Boolean).join(' · ');
  if (st.isSample) { const b = document.createElement('span'); b.className = 'sample'; b.textContent = 'Exemplo'; m.append(b); }
}

const isPercussion = (t: Track) => t.staves.every(x => x.isPercussion);
function trackLabel(t: Track, i: number) {
  const name = t.name || 'Pista ' + (i + 1);
  // Só acrescenta "baixo" quando o nome ainda não o diz ("Baixo" fica "Baixo", não "Baixo · baixo").
  return isBassTrack(t) && !/bass|baixo|bajo/i.test(name) ? name + ' · baixo' : name;
}

/** Preenche os dois seletores de instrumento (ajustes e barra de topo). A bateria fica de fora: não tem tom. */
function renderTrackControls() {
  const s = score();
  for (const sel of [select('viewTrack'), select('trackQuick')]) {
    sel.innerHTML = '';
    s.tracks.forEach((t, i) => {
      if (isPercussion(t)) return;
      const o = document.createElement('option'); o.value = String(i); o.textContent = trackLabel(t, i);
      o.selected = i === st.viewTrack; sel.append(o);
    });
  }
}

/** Muda o instrumento: volta a detetar o tom só com ele, e atualiza a tablatura. */
function setTrack(i: number) {
  if (i === st.viewTrack) return;
  st.viewTrack = i;
  select('viewTrack').value = String(i); select('trackQuick').value = String(i);
  save(); detect(); renderChart(); renderTab();
  toast('Tom detetado a partir de: ' + trackLabel(score().tracks[i], i));
}

// ---------- Deteção ----------
function detect() {
  const s = score(), o = opts();
  st.detected = []; st.fileFlag = [];
  for (let i = 0; i < s.masterBars.length; i++) {
    // O tom é sempre detetado só a partir do instrumento selecionado.
    const res = analyzeBar(s, i, [st.viewTrack], o);
    const kt = s.tracks[st.viewTrack];
    const ks = (kt?.staves[0].bars[i]?.keySignature as number | undefined) ?? 0;
    st.detected[i] = res.length ? res.map(c => label(c, o, ks)).join(' ') : '–';
    st.fileFlag[i] = !!res[0]?.fromFile;
  }
}
const barText = (i: number) => ov()[i] ?? st.detected[i];
const secEnd = (k: number) => (k + 1 < st.sections.length ? st.sections[k + 1].start : score().masterBars.length);
function secOf(i: number) { let k = 0; st.sections.forEach((s, j) => { if (s.start <= i) k = j; }); return k; }

// ---------- Cores por nota ----------
function colorCell(cell: HTMLElement, text: string) {
  const pcs = pitchClassesOf(text);
  cell.classList.remove('two'); delete cell.dataset.pc;
  cell.style.removeProperty('--nc'); cell.style.removeProperty('--nc2');
  if (!pcs.length) return;
  cell.dataset.pc = String(pcs[0]); cell.style.setProperty('--nc', 'var(--n' + pcs[0] + ')');
  if (pcs.length === 2 && pcs[1] !== pcs[0]) { cell.classList.add('two'); cell.style.setProperty('--nc2', 'var(--n' + pcs[1] + ')'); }
}
function renderNoteKey() {
  const o = opts(), key = $('noteKey');
  key.hidden = !input('optColors').checked; key.innerHTML = '';
  for (let pc = 0; pc < 12; pc++) {
    const sp = document.createElement('span'); sp.style.setProperty('--nc', 'var(--n' + pc + ')');
    sp.textContent = label({ pc, minor: false }, { ...o, showMinor: false }, 0);
    key.append(sp);
  }
}

const ICON_LOOP = '<svg class="i" viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';

function selectText(el: HTMLElement) {
  const r = document.createRange(); r.selectNodeContents(el);
  const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
}

// ---------- Esquema ----------
function renderChart() {
  const chart = $('chart');
  chart.innerHTML = '';
  chart.classList.toggle('colored', input('optColors').checked);
  renderNoteKey();
  if (!st.score?.tracks.some(t => !isPercussion(t))) {
    const note = document.createElement('p'); note.className = 'chart-empty';
    note.textContent = 'Esta música não tem nenhum instrumento com notas (só bateria), por isso não há tom para mostrar.';
    chart.append(note);
  }
  st.sections.forEach((sec, k) => {
    const end = secEnd(k);
    const wrap = document.createElement('div'); wrap.className = 'section' + (st.loopSection === k ? ' looping' : ''); wrap.dataset.sec = String(k);
    const head = document.createElement('div'); head.className = 'sec-head';
    const mark = document.createElement('div'); mark.className = 'mark'; mark.contentEditable = 'true'; mark.spellcheck = false;
    mark.textContent = sec.name; mark.setAttribute('aria-label', 'Nome da secção');
    mark.addEventListener('input', () => { sec.name = mark.textContent?.trim() || 'SECÇÃO'; save(); });
    mark.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); mark.blur(); } });
    const meta = document.createElement('span'); meta.className = 'sec-meta';
    meta.textContent = 'c. ' + (sec.start + 1) + '–' + end + ' · ' + (end - sec.start) + ' comp.';
    const acts = document.createElement('div'); acts.className = 'sec-actions';
    const loopB = document.createElement('button'); loopB.type = 'button'; loopB.className = 'sbtn' + (st.loopSection === k ? ' on' : '');
    loopB.innerHTML = ICON_LOOP + '<span>' + (st.loopSection === k ? 'A praticar' : 'Praticar') + '</span>';
    loopB.title = 'Repetir esta secção em loop'; loopB.setAttribute('aria-label', 'Praticar ' + sec.name + ' em loop');
    loopB.addEventListener('click', () => practiceSection(k));
    loopB.setAttribute('aria-pressed', String(st.loopSection === k));
    acts.append(loopB);
    head.append(mark, meta, acts); wrap.append(head);

    for (let r = sec.start; r < end; r += st.perRow) {
      const row = document.createElement('div'); row.className = 'row'; row.style.setProperty('--per', String(st.perRow));
      for (let i = r; i < Math.min(r + st.perRow, end); i++) row.append(barCell(i));
      wrap.append(row);
    }
    chart.append(wrap);
  });
  markPlaying(st.playingBar, false);
  if (st.playingBar >= 0) updateNow(st.playingBar, 0);
}

function barCell(i: number) {
  const mb = score().masterBars[i];
  const cell = document.createElement('div'); cell.className = 'bar'; cell.dataset.bar = String(i);
  if (ov()[i] != null) cell.classList.add('edited');
  if (st.fileFlag[i] && ov()[i] == null) cell.classList.add('file');
  const num = document.createElement('span'); num.className = 'num'; num.textContent = (mb.isRepeatStart ? '‖: ' : '') + (i + 1);
  const ch = document.createElement('div'); ch.className = 'ch'; ch.contentEditable = coarse ? 'false' : 'true'; ch.spellcheck = false;
  ch.textContent = barText(i); ch.setAttribute('aria-label', 'Tom do compasso ' + (i + 1));
  ch.addEventListener('focus', () => { selectBar(i); if (st.ready && st.playingBar !== i) goBar(i, true); });
  ch.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); focusBar(i + 1); }
    if (e.key === 'Tab') { e.preventDefault(); focusBar(e.shiftKey ? i - 1 : i + 1); }
    if (e.key === 'Escape') { ch.blur(); $('barbar').hidden = true; }
  });
  ch.addEventListener('input', () => {
    const v = ch.textContent?.trim() ?? '';
    if (v === st.detected[i] || v === '') delete ov()[i]; else ov()[i] = v;
    cell.classList.toggle('edited', ov()[i] != null); cell.classList.remove('file'); colorCell(cell, v); save();
    $<HTMLButtonElement>('bbReset').disabled = ov()[i] == null;
  });
  cell.addEventListener('click', e => {
    if (coarse) {
      if (ch.isContentEditable) return; // a editar
      selectBar(i);
      if (st.ready && st.playingBar !== i) goBar(i, true);
      return;
    }
    if (e.target === cell) ch.focus();
  });
  if (coarse) ch.addEventListener('blur', () => { ch.contentEditable = 'false'; });
  colorCell(cell, barText(i));
  cell.append(num, ch);
  if (mb.repeatCount > 0) { const rep = document.createElement('span'); rep.className = 'rep'; rep.textContent = ':‖ ×' + mb.repeatCount; cell.append(rep); }
  return cell;
}
function focusBar(i: number) {
  const el = document.querySelector<HTMLElement>('.bar[data-bar="' + i + '"] .ch');
  if (el) { el.focus(); selectText(el); }
}
function selectBar(i: number) {
  st.selBar = i;
  $('bbLabel').textContent = 'Compasso ' + (i + 1);
  $<HTMLButtonElement>('bbSplit').disabled = st.sections.some(s => s.start === i);
  $<HTMLButtonElement>('bbReset').disabled = ov()[i] == null;
  $('barbar').hidden = false;
  showTabSel(i);
}
$('bbEdit').addEventListener('click', () => {
  const ch = document.querySelector<HTMLElement>('.bar[data-bar="' + st.selBar + '"] .ch');
  if (!ch) return;
  ch.contentEditable = 'true'; ch.focus(); selectText(ch);
});
$('bbEdit').hidden = !coarse;
$('bbExpand').addEventListener('click', () => { if (st.selBar >= 0) { $('barbar').hidden = true; openBarModal(st.selBar); } });

$('bbClose').addEventListener('click', () => { $('barbar').hidden = true; (document.activeElement as HTMLElement | null)?.blur(); });
$('bbPlay').addEventListener('click', () => { if (st.selBar >= 0) playFrom(st.selBar); });
$('bbReset').addEventListener('click', () => { const i = st.selBar; delete ov()[i]; save(); renderChart(); focusBar(i); });
$('bbSplit').addEventListener('click', () => {
  const i = st.selBar; if (st.sections.some(s => s.start === i)) return;
  st.sections.push({ name: 'NOVA', start: i }); st.sections.sort((a, b) => a.start - b.start);
  clearLoop(); save(); renderChart();
  const k = st.sections.findIndex(s => s.start === i);
  const mark = document.querySelectorAll<HTMLElement>('.mark')[k];
  if (mark) { mark.focus(); selectText(mark); }
  $('barbar').hidden = true;
});

function markPlaying(i: number, scroll = true) {
  document.querySelectorAll('.bar.playing').forEach(e => e.classList.remove('playing'));
  if (i < 0) return;
  const el = document.querySelector<HTMLElement>('.bar[data-bar="' + i + '"]');
  if (!el) return;
  el.classList.add('playing');
  if (!scroll) return;
  const r = el.getBoundingClientRect(), dockH = $('dock').offsetHeight;
  if (r.top < 60 || r.bottom > innerHeight - dockH - 30) {
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

// ---------- Progresso (barra neutra no leitor) ----------
function updateNow(i: number, frac: number) {
  const total = st.score ? st.score.masterBars.length : 1;
  $('progressFill').style.width = (i < 0 ? 0 : ((i + frac) / total) * 100) + '%';
  if (i < 0) {
    $('nowTitle').textContent = st.sections[0] ? st.sections[0].name + ' · compasso 1' : 'Início';
    $('nowChip').textContent = '';
    return;
  }
  const k = secOf(i);
  $('nowTitle').textContent = st.sections[k].name + ' · compasso ' + (i + 1);
  $('nowChip').textContent = st.sections[k].name + ' · c. ' + (i + 1);
}
$('progress').addEventListener('click', e => {
  if (!st.ready || !st.score) return;
  const r = $('progress').getBoundingClientRect();
  const i = Math.floor(((e.clientX - r.left) / r.width) * st.score.masterBars.length);
  goBar(i, true);
});

// ---------- Exportar para PDF ----------
$('pdfBtn').addEventListener('click', async () => {
  if (!st.score) return;
  const s = score(), t = s.tracks[st.viewTrack];
  const mb = s.masterBars[0];
  const meta = [s.artist, trackLabel(t, st.viewTrack), Math.round(s.tempo) + ' bpm', mb ? mb.timeSignatureNumerator + '/' + mb.timeSignatureDenominator : '', s.masterBars.length + ' compassos']
    .filter(Boolean).join(' · ');
  const btn = $<HTMLButtonElement>('pdfBtn'); btn.disabled = true;
  try {
    await exportPdf({
      title: $('songTitle').textContent || 'Música',
      meta,
      perRow: st.perRow,
      colors: input('optColors').checked,
      sections: st.sections.map((sec, k) => {
        const end = secEnd(k), bars = [];
        for (let i = sec.start; i < end; i++) bars.push({ n: i + 1, text: barText(i), pcs: pitchClassesOf(barText(i)) });
        return { name: sec.name, range: 'c. ' + (sec.start + 1) + '–' + end, bars };
      }),
    });
    toast('PDF do esquema descarregado.');
  } catch { toast('Não foi possível criar o PDF.'); }
  finally { btn.disabled = false; }
});

// ---------- Tema claro / escuro ----------
function setTheme(theme: Theme) {
  applyTheme(theme);
  const next = theme === 'light' ? 'escuro' : 'claro';
  $('themeBtn').setAttribute('aria-label', 'Mudar para o tema ' + next);
  if (st.api) {
    // A tablatura é desenhada em SVG com cores próprias: trocar e voltar a desenhar.
    const res = st.api.settings.display.resources as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(TAB_COLORS[theme])) res[k] = at.model.Color.fromJson(v);
    st.api.updateSettings();
    st.api.render();
  }
}
$('themeBtn').addEventListener('click', () => setTheme(currentTheme() === 'light' ? 'dark' : 'light'));
$('themeBtn').setAttribute('aria-label', 'Mudar para o tema ' + (currentTheme() === 'light' ? 'escuro' : 'claro'));

// ---------- Ajustes ----------
function openSettings(v: boolean, focus = true) {
  if (v) openLibrary(false);
  $('settings').hidden = !v; $('scrim').hidden = !v && $('library').hidden; $('settingsBtn').setAttribute('aria-expanded', String(v));
  if (focus) (v ? $('closeSettings') : $('settingsBtn')).focus();
}
$('settingsBtn').addEventListener('click', () => openSettings(true));
$('closeSettings').addEventListener('click', () => openSettings(false));
$('scrim').addEventListener('click', () => { openSettings(false, false); openLibrary(false); });
input('optColors').addEventListener('change', renderChart);
['optMinor', 'optSplit', 'optFileChords', 'optNames', 'optAcc'].forEach(id => $(id).addEventListener('change', () => { detect(); renderChart(); }));
select('perRow').addEventListener('change', () => { st.perRow = +select('perRow').value; save(); renderChart(); });
$('resetBtn').addEventListener('click', () => {
  st.overridesByTrack[st.viewTrack] = {}; st.sections = sectionsFromScore(score()); clearLoop(); save(); renderChart(); toast('Esquema reposto a partir do ficheiro.');
});
select('viewTrack').addEventListener('change', () => setTrack(+select('viewTrack').value));
select('trackQuick').addEventListener('change', () => setTrack(+select('trackQuick').value));

// ---------- Compasso escolhido na tablatura ----------
/** Mostra o contorno e a barra (Expandir / Loop) por cima do compasso i na tablatura. */
function showTabSel(i: number) {
  st.tabSel = i;
  placeTabSel();
}
function placeTabSel() {
  const el = $('tabSel'), i = st.tabSel;
  const b = i >= 0 ? st.api?.boundsLookup?.findMasterBarByIndex(i)?.visualBounds : null;
  if (!b) { el.hidden = true; return; }
  const tab = $('tab');
  el.style.left = tab.offsetLeft + b.x - 3 + 'px';
  el.style.top = tab.offsetTop + b.y - 3 + 'px';
  el.style.width = b.w + 6 + 'px';
  el.style.height = b.h + 6 + 'px';
  $('tsLabel').textContent = 'Compasso ' + (i + 1) + ' · ' + barText(i);
  $('tabSelBar').classList.toggle('below', b.y < 60);
  const on = st.loopBar === i;
  $('tsLoop').setAttribute('aria-pressed', String(on));
  $('tsLoop').querySelector('span')!.textContent = on ? 'Parar loop' : 'Loop';
  el.hidden = false;
}
$('tsExpand').addEventListener('click', () => { if (st.tabSel >= 0) openBarModal(st.tabSel); });
$('tsLoop').addEventListener('click', () => { if (st.tabSel >= 0) practiceBar(st.tabSel); });
$('tab').addEventListener('dblclick', () => { if (st.tabSel >= 0) openBarModal(st.tabSel); });

// ---------- Compasso expandido ----------
const modal = {
  open: false,
  bar: -1,
  view: null as BarView | null,
  sub: 'auto' as 'auto' | Sub,
  usedSub: 2 as Sub,
  beatTicks: 960,
  slots: 8,
  lastSlot: -1,
  reps: 0,
};
const LINE_GAP = 44;

function openBarModal(i: number) {
  if (!st.score) return;
  modal.open = true;
  $('barModal').hidden = false; $('bmScrim').hidden = false;
  $('tabSel').hidden = true;
  setModalBar(i);
  $<HTMLButtonElement>('bmPlay').focus();
}
function closeBarModal() {
  if (!modal.open) return;
  modal.open = false;
  $('barModal').hidden = true; $('bmScrim').hidden = true;
  // Ao fechar, o loop do compasso termina.
  if (st.loopBar >= 0) {
    st.api?.pause(); clearLoop();
    if (st.ready) setStatus('Em pausa');
  }
  if (st.tabSel >= 0) placeTabSel();
}
function setModalBar(i: number) {
  const s = score();
  i = Math.max(0, Math.min(s.masterBars.length - 1, i));
  const wasLooping = st.loopBar >= 0, wasPlaying = st.api?.playerState === PLAYING;
  modal.bar = i; modal.reps = 0; modal.lastSlot = -1;
  modal.view = barView(s, i, st.viewTrack);
  const k = secOf(i);
  $('bmTitle').innerHTML = '';
  $('bmTitle').append('Compasso ' + (i + 1) + ' ');
  const sp = document.createElement('span'); sp.textContent = '· ' + st.sections[k].name; $('bmTitle').append(sp);
  const v = modal.view, t = s.tracks[st.viewTrack];
  $('bmMeta').textContent = v.numerator + '/' + v.denominator + ' · ' + Math.round(s.tempo) + ' bpm · ' + trackLabel(t, st.viewTrack);
  const chord = $('bmChord'); chord.textContent = barText(i);
  const pc = pitchClassesOf(barText(i))[0];
  if (pc != null && input('optColors').checked) chord.style.setProperty('--nc', 'var(--n' + pc + ')'); else chord.style.removeProperty('--nc');
  $<HTMLButtonElement>('bmPrev').disabled = i === 0;
  $<HTMLButtonElement>('bmNext').disabled = i === s.masterBars.length - 1;
  $('bmPrevN').textContent = 'Compasso ' + i;
  $('bmNextN').textContent = 'Compasso ' + (i + 2);
  $('bmReps').textContent = '0';
  renderBarModal();
  st.tabSel = i; st.selBar = i;
  goBar(i);
  if (wasLooping) { setLoopBar(i); if (wasPlaying) api().play(); }
  syncModalPlay();
}

function renderBarModal() {
  const v = modal.view; if (!v) return;
  const { beats, beatTicks } = beatInfo(v.numerator, v.denominator);
  const sub: Sub = modal.sub === 'auto' ? autoSub(v.notes.map(n => n.start), beatTicks) : modal.sub;
  modal.usedSub = sub; modal.beatTicks = beatTicks;
  const labels = countLabels(beats, sub);
  modal.slots = labels.length;
  const x = (slot: number) => ((slot + 0.5) / labels.length) * 100 + '%';
  const lines = Math.max(1, v.strings.length);
  const staffH = (lines - 1) * LINE_GAP + 24;
  const root = $('barModal');
  root.style.setProperty('--slots', String(labels.length));
  root.style.setProperty('--staff-h', staffH + 'px');
  const lineY = (l: number) => 12 + l * LINE_GAP;

  // Nomes das cordas
  const names = $('bmStrings'); names.innerHTML = '';
  v.strings.forEach((n, l) => { const e = document.createElement('span'); e.textContent = n; e.style.top = lineY(l) + 'px'; names.append(e); });

  // Pauta: colunas da contagem, divisões dos tempos, linhas e notas
  const staff = $('bmStaff'); staff.innerHTML = '';
  labels.forEach((_, slot) => {
    const c = document.createElement('span'); c.className = 'col'; c.dataset.slot = String(slot);
    c.style.left = x(slot); c.style.width = 100 / labels.length - 0.8 + '%'; staff.append(c);
  });
  for (let b = 1; b < beats; b++) { const e = document.createElement('span'); e.className = 'bt'; e.style.left = (b / beats) * 100 + '%'; staff.append(e); }
  for (let l = 0; l < lines; l++) { const e = document.createElement('span'); e.className = 'ln'; e.style.top = lineY(l) + 'px'; staff.append(e); }
  const hit = new Set<number>();
  for (const n of v.notes) {
    const slot = slotOf(n.start, beatTicks, sub, labels.length); hit.add(slot);
    const e = document.createElement('span'); e.className = 'nt' + (n.dead ? ' dead' : '');
    e.dataset.beat = String(n.beatId); e.dataset.slot = String(slot);
    e.textContent = n.dead ? 'x' : String(n.fret);
    e.style.left = x(slot); e.style.top = lineY(n.line) + 'px';
    staff.append(e);
  }

  // Contagem por baixo e pulsos do metrónomo por cima
  const count = $('bmCount'); count.innerHTML = '';
  const perBeat = labels.length / beats;
  labels.forEach((t, slot) => {
    const e = document.createElement('span'); e.textContent = t; e.dataset.slot = String(slot);
    if (slot % perBeat === 0) e.classList.add('beat');
    if (hit.has(slot)) e.classList.add('hit');
    count.append(e);
  });
  // Um pulso por tempo, alinhado com o número do tempo na contagem
  const pulses = $('bmPulses'); pulses.innerHTML = '';
  labels.forEach((_, slot) => {
    const e = document.createElement('i');
    if (slot % perBeat === 0) e.dataset.beat = String(slot / perBeat); else e.style.visibility = 'hidden';
    pulses.append(e);
  });

  // Subdivisão
  $('bmSubs').querySelectorAll<HTMLButtonElement>('button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.sub === String(modal.sub))));
  const names2: Record<Sub, string> = { 1: 'só os tempos', 2: 'colcheias (1 & 2 &)', 4: 'semicolcheias (1 e & a)' };
  $('bmSubHint').textContent = modal.sub === 'auto' ? 'A contar em ' + names2[sub] + ', pela nota mais curta do compasso.' : '';
  modal.lastSlot = -1;
}

/** Acende a nota, a contagem e o pulso do tempo que está a tocar. */
function highlightModal(beatStart: number, beatId: number) {
  const slot = slotOf(beatStart, modal.beatTicks, modal.usedSub, modal.slots);
  if (modal.lastSlot >= 0 && slot < modal.lastSlot) { modal.reps++; $('bmReps').textContent = String(modal.reps); }
  modal.lastSlot = slot;
  const beat = Math.floor(slot / modal.usedSub);
  $('bmStaff').querySelectorAll<HTMLElement>('.nt').forEach(e => e.classList.toggle('on', e.dataset.beat === String(beatId)));
  $('bmStaff').querySelectorAll<HTMLElement>('.col').forEach(e => e.classList.toggle('on', e.dataset.slot === String(slot)));
  $('bmCount').querySelectorAll<HTMLElement>('span').forEach(e => e.classList.toggle('on', e.dataset.slot === String(slot)));
  $('bmPulses').querySelectorAll<HTMLElement>('i').forEach(e => e.classList.toggle('on', e.dataset.beat === String(beat)));
}
function clearModalHighlight() {
  $('barModal').querySelectorAll('.on').forEach(e => e.classList.remove('on'));
  modal.lastSlot = -1;
}

function syncModalPlay() {
  const playing = !!st.api && st.api.playerState === PLAYING && st.loopBar === modal.bar;
  $('bmPlayIcon').innerHTML = playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
  $('bmPlayText').textContent = playing ? 'A tocar em loop' : 'Tocar em loop';
}
$('bmPlay').addEventListener('click', () => {
  if (!st.ready) { toast('Os sons ainda estão a carregar.'); return; }
  if (api().playerState === PLAYING && st.loopBar === modal.bar) { api().pause(); return; }
  // Contagem e metrónomo conforme as opções da janela (e os botões do leitor acompanham)
  api().countInVolume = input('bmCountIn').checked ? 1 : 0; setPressed('countBtn', input('bmCountIn').checked);
  api().metronomeVolume = input('bmMetro').checked ? 1 : 0; setPressed('metroBtn', input('bmMetro').checked);
  modal.reps = 0; $('bmReps').textContent = '0';
  setLoopBar(modal.bar);
  api().tickPosition = barTick(modal.bar);
  api().play();
});
input('bmMetro').addEventListener('change', () => { if (st.api) { st.api.metronomeVolume = input('bmMetro').checked ? 1 : 0; setPressed('metroBtn', input('bmMetro').checked); } });
input('bmCountIn').addEventListener('change', () => { if (st.api) { st.api.countInVolume = input('bmCountIn').checked ? 1 : 0; setPressed('countBtn', input('bmCountIn').checked); } });
input('bmSpeed').addEventListener('input', () => {
  input('speed').value = input('bmSpeed').value;
  input('speed').dispatchEvent(new Event('input'));
});
$('bmSubs').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-sub]'); if (!b) return;
  modal.sub = b.dataset.sub === 'auto' ? 'auto' : (+b.dataset.sub! as Sub);
  renderBarModal();
});
$('bmPrev').addEventListener('click', () => setModalBar(modal.bar - 1));
$('bmNext').addEventListener('click', () => setModalBar(modal.bar + 1));
$('bmClose').addEventListener('click', closeBarModal);
$('bmScrim').addEventListener('click', closeBarModal);

// ---------- Som no telemóvel ----------
// No iPhone o som do leitor só sai com o interruptor de silêncio ligado se for desbloqueado num toque.
for (const ev of ['pointerdown', 'keydown'] as const) {
  addEventListener(ev, e => {
    const t = e.target as HTMLElement | null;
    const startsAudio = ev === 'keydown' ? (e as KeyboardEvent).key === ' '
      : !!t?.closest('#playBtn, #bmPlay, #tsLoop, #bbPlay, .sbtn, #nextBtn, #prevBtn, #progress');
    if (startsAudio) unlockAudio();
  }, { capture: true });
}

// ---------- Leitor (alphaTab) ----------
function initApi() {
  const a = new at.AlphaTabApi($('tab'), {
    core: { fontDirectory: vendor + 'font/', scriptFile: vendor + 'alphaTab.min.js', engine: 'svg' },
    display: {
      staveProfile: 'Tab', layoutMode: 'Page', ...tabLayout(),
      // Cores da tablatura a condizer com o tema
      resources: TAB_COLORS[currentTheme()],
    },
    player: {
      playerMode: 'EnabledSynthesizer', outputMode: 'WebAudioScriptProcessor', soundFont: vendor + 'soundfont/sonivox.sf3',
      scrollElement: $('tabScroll'), enableCursor: true, enableAnimatedBeatCursor: true, enableUserInteraction: true, scrollOffsetY: -40,
    },
  });
  st.api = a;
  a.customCursorHandler = delay.cursorHandler(at.midi.MidiTickLookupFindBeatResultCursorMode.ToNextBext);
  a.soundFontLoad.on(e => { if (e.total) $('status').textContent = 'A carregar os sons… ' + Math.round((e.loaded / e.total) * 100) + '%'; });
  a.playerReady.on(() => {
    st.ready = true;
    ['playBtn', 'stopBtn', 'prevBtn', 'nextBtn', 'loopBtn', 'metroBtn', 'countBtn', 'muteBtn', 'soloBtn'].forEach(id => ($<HTMLButtonElement>(id).disabled = false));
    $('status').textContent = 'Pronto a tocar';
    a.playbackSpeed = +input('speed').value / 100;
    applyMute();
  });
  a.renderStarted.on(() => ($('tabLoading').hidden = false));
  a.renderFinished.on(() => { $('tabLoading').hidden = true; if (st.tabSel >= 0 && !modal.open) placeTabSel(); });
  a.playerStateChanged.on(e => {
    const playing = e.state === PLAYING;
    if (!playing) { delay.clear(); releaseAudio(); }
    $('playIcon').innerHTML = playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    $('playBtn').setAttribute('aria-label', playing ? 'Pausa' : 'Tocar');
    setStatus(playing ? 'A tocar' : 'Em pausa');
    syncModalPlay();
    if (!playing && modal.open) clearModalHighlight();
  });
  a.playedBeatChanged.on(beat => delay.run(() => {
    const mb = beat.voice.bar.masterBar, i = mb.index;
    if (i !== st.playingBar) { st.playingBar = i; markPlaying(i); }
    let frac = 0; try { frac = beat.playbackStart / mb.calculateDuration(); } catch { /* compasso vazio */ }
    updateNow(i, frac);
    if (modal.open && i === modal.bar) highlightModal(beat.playbackStart, beat.id);
  }));
  // Clicar numa nota da tablatura leva o esquema para esse compasso.
  a.beatMouseDown.on(beat => {
    const i = beat.voice.bar.masterBar.index;
    showTabSel(i);
    if (i === st.playingBar) return;
    leaveLoopIfOutside(i);
    st.playingBar = i; markPlaying(i); updateNow(i, 0);
  });
  // Ao rodar o telemóvel ou mudar o tamanho da janela, ajusta a densidade da tablatura.
  let lastLayout = JSON.stringify(tabLayout());
  addEventListener('resize', () => {
    const now = JSON.stringify(tabLayout());
    if (now === lastLayout) return;
    lastLayout = now;
    Object.assign(a.settings.display, tabLayout());
    a.updateSettings(); a.render();
  });
  a.error.on(e => { $('status').textContent = 'Erro no leitor: ' + (e?.message ?? e); });
}
function setStatus(txt: string) {
  const s = $('status'); s.textContent = txt;
  const what = st.loopSection >= 0 ? st.sections[st.loopSection].name : st.loopBar >= 0 ? 'compasso ' + (st.loopBar + 1) : '';
  if (what) { const l = document.createElement('span'); l.className = 'loopinfo'; l.textContent = ' · loop em ' + what; s.append(l); }
  s.append(' · ' + input('speed').value + '%');
}

function renderTab() {
  if (!st.api) initApi();
  const t = score().tracks[st.viewTrack];
  $('tabTrackName').textContent = trackLabel(t, st.viewTrack);
  const allTab = t.staves.every(s => s.showTablature !== false && s.tuning && s.tuning.length);
  api().settings.display.staveProfile = allTab ? at.StaveProfile.Tab : at.StaveProfile.Default;
  api().updateSettings();
  api().renderScore(score(), [st.viewTrack]);
  if (st.ready) applyMute();
}

/** "Tocar por cima" silencia o instrumento selecionado; "Só o meu instrumento" deixa só esse a tocar. */
function applyMute() {
  if (!st.api || !st.score) return;
  const all = st.score.tracks, mine = [all[st.viewTrack]];
  const mute = $('muteBtn').getAttribute('aria-pressed') === 'true';
  const solo = $('soloBtn').getAttribute('aria-pressed') === 'true';
  st.api.changeTrackMute(all, false);
  st.api.changeTrackSolo(all, false);
  if (mute) st.api.changeTrackMute(mine, true);
  if (solo) st.api.changeTrackSolo(mine, true);
}

function barTick(i: number) {
  const mb = score().masterBars[i];
  try { const t = api().tickCache?.getMasterBarStart(mb); if (t != null) return t; } catch { /* sem cache ainda */ }
  return mb.start;
}
function barEndTick(i: number) {
  if (i + 1 < score().masterBars.length) return barTick(i + 1);
  return barTick(i) + score().masterBars[i].calculateDuration();
}
function leaveLoopIfOutside(i: number) {
  if (st.loopBar >= 0 && i !== st.loopBar && !modal.open) { clearLoop(); if (st.tabSel >= 0) placeTabSel(); }
  if (st.loopSection < 0) return;
  const s = st.sections[st.loopSection];
  if (i < s.start || i >= secEnd(st.loopSection)) { clearLoop(); renderChart(); }
}
/** Leva o leitor, a tablatura e o esquema para o compasso i. `fromChart`: não mexe no scroll do esquema. */
function goBar(i: number, fromChart = false) {
  if (!st.ready) return;
  i = Math.max(0, Math.min(score().masterBars.length - 1, i));
  leaveLoopIfOutside(i);
  delay.clear();
  api().tickPosition = barTick(i);
  st.playingBar = i; markPlaying(i, !fromChart); updateNow(i, 0);
  // A tablatura acompanha: mostra o compasso escolhido.
  try { api().scrollToCursor(); } catch { /* ainda sem cursor */ }
}
function playFrom(i: number) {
  if (!st.ready) { toast('Os sons ainda estão a carregar.'); return; }
  goBar(i);
  if (api().playerState !== PLAYING) api().play();
}
function practiceSection(k: number) {
  if (!st.ready) { toast('Os sons ainda estão a carregar.'); return; }
  if (st.loopSection === k) { clearLoop(); renderChart(); setStatus(api().playerState === PLAYING ? 'A tocar' : 'Em pausa'); return; }
  st.loopSection = k; st.loopBar = -1;
  const s = st.sections[k], end = secEnd(k);
  api().playbackRange = { startTick: barTick(s.start), endTick: barEndTick(end - 1) } as AlphaTab.synth.PlaybackRange;
  api().isLooping = true; setPressed('loopBtn', true);
  renderChart();
  delay.clear();
  api().tickPosition = barTick(s.start);
  if (api().playerState !== PLAYING) api().play(); else setStatus('A tocar');
}
/** Loop de um só compasso (sem mudar a posição de reprodução). */
function setLoopBar(i: number) {
  if (st.loopSection >= 0) { st.loopSection = -1; renderChart(); }
  st.loopBar = i;
  api().playbackRange = { startTick: barTick(i), endTick: barEndTick(i) } as AlphaTab.synth.PlaybackRange;
  api().isLooping = true; setPressed('loopBtn', true);
  setStatus(api().playerState === PLAYING ? 'A tocar' : 'Em pausa');
}
/** Liga/desliga o loop do compasso i e começa a tocar. */
function practiceBar(i: number) {
  if (!st.ready) { toast('Os sons ainda estão a carregar.'); return; }
  if (st.loopBar === i) { clearLoop(); placeTabSel(); setStatus(api().playerState === PLAYING ? 'A tocar' : 'Em pausa'); return; }
  setLoopBar(i);
  delay.clear();
  api().tickPosition = barTick(i);
  if (api().playerState !== PLAYING) api().play();
  placeTabSel();
}
function clearLoop() {
  st.loopSection = -1; st.loopBar = -1;
  if (st.api && st.ready) { st.api.playbackRange = null; st.api.isLooping = false; }
  setPressed('loopBtn', false);
}
const setPressed = (id: string, v: boolean) => $(id).setAttribute('aria-pressed', v ? 'true' : 'false');
function toggle(id: string) { const v = $(id).getAttribute('aria-pressed') !== 'true'; setPressed(id, v); return v; }

$('playBtn').addEventListener('click', () => st.api?.playPause());
$('moreBtn').addEventListener('click', () => {
  const open = !$('dock').classList.contains('tools-open');
  $('dock').classList.toggle('tools-open', open);
  $('moreBtn').setAttribute('aria-expanded', String(open));
});
$('stopBtn').addEventListener('click', () => {
  if (!st.api) return;
  delay.clear(); st.api.stop(); st.playingBar = -1; markPlaying(-1); updateNow(-1, 0);
});
$('prevBtn').addEventListener('click', () => goBar((st.playingBar < 0 ? 0 : st.playingBar) - 1));
$('nextBtn').addEventListener('click', () => goBar((st.playingBar < 0 ? -1 : st.playingBar) + 1));
input('speed').addEventListener('input', () => {
  const v = +input('speed').value; $('speedOut').textContent = v + '%';
  input('bmSpeed').value = String(v); $('bmSpeedOut').textContent = v + '%';
  if (st.api) st.api.playbackSpeed = v / 100;
  if (st.ready) setStatus(api().playerState === PLAYING ? 'A tocar' : 'Em pausa');
});
$('loopBtn').addEventListener('click', () => {
  const v = toggle('loopBtn'); api().isLooping = v;
  if (!v && (st.loopSection >= 0 || st.loopBar >= 0)) { clearLoop(); renderChart(); if (st.tabSel >= 0) placeTabSel(); }
});
$('metroBtn').addEventListener('click', () => { api().metronomeVolume = toggle('metroBtn') ? 1 : 0; });
$('countBtn').addEventListener('click', () => { api().countInVolume = toggle('countBtn') ? 1 : 0; });
$('muteBtn').addEventListener('click', () => { if (toggle('muteBtn')) setPressed('soloBtn', false); applyMute(); });
$('soloBtn').addEventListener('click', () => { if (toggle('soloBtn')) setPressed('muteBtn', false); applyMute(); });

// Atalhos de teclado
addEventListener('keydown', e => {
  if (tour.open) {
    if (e.key === 'Escape') { e.preventDefault(); endTour(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); $('tourNext').click(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); $('tourPrev').click(); }
    return;
  }
  if (e.key === 'Escape' && !$('helpMenu').hidden) { openHelp(false); return; }
  if (e.key === 'Escape' && !$('settings').hidden) { openSettings(false); return; }
  if (e.key === 'Escape' && !$('library').hidden) { openLibrary(false); $('libraryBtn').focus(); return; }
  if (e.key === 'Escape' && modal.open) { closeBarModal(); return; }
  const t = e.target as HTMLElement;
  if (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!st.ready) return;
  if (e.key === ' ' && !modal.open) { e.preventDefault(); api().playPause(); }
  if (modal.open) {
    if (e.key === ' ') { e.preventDefault(); $('bmPlay').click(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); $('bmPrev').click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); $('bmNext').click(); }
    return;
  }
  if (e.key === 'ArrowLeft') { e.preventDefault(); $('prevBtn').click(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); $('nextBtn').click(); }
});

// Vista no telemóvel
function setView(v: 'chart' | 'tab') {
  document.body.dataset.view = v;
  $('vChart').setAttribute('aria-selected', String(v === 'chart'));
  $('vTab').setAttribute('aria-selected', String(v === 'tab'));
  if (v === 'tab') st.api?.render();
}
$('vChart').addEventListener('click', () => setView('chart'));
$('vTab').addEventListener('click', () => setView('tab'));
setView('chart');

// ---------- Ficheiros ----------
function readFile(f: File | undefined) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => openImported(new Uint8Array(r.result as ArrayBuffer), f.name);
  r.readAsArrayBuffer(f);
}
/** Abre um ficheiro importado (daqui ou da página inicial) e guarda-o em "As minhas músicas". */
function openImported(bytes: Uint8Array, name: string): boolean {
  st.api?.stop(); clearLoop();
  if (!loadBytes(bytes, name, false)) return false;
  // Guarda a música neste browser para a próxima vez
  const s = score();
  saveSong({ id: st.fileKey, fileName: name, title: $('songTitle').textContent || name, artist: s.artist || '', bars: s.masterBars.length }, bytes)
    .then(() => { askPersistentStorage(); renderLibrary(); toast('Guardada em “As minhas músicas”.'); })
    .catch(() => toast('Não foi possível guardar a música neste browser (modo privado?).'));
  openLibrary(false);
  return true;
}

// ---------- As minhas músicas ----------
function openLibrary(v: boolean) {
  if (v) { renderLibrary(); openSettings(false, false); }
  $('library').hidden = !v; $('scrim').hidden = !v && $('settings').hidden;
  $('libraryBtn').setAttribute('aria-expanded', String(v));
  if (v) $('closeLibrary').focus();
}
$('libraryBtn').addEventListener('click', () => openLibrary(true));
$('closeLibrary').addEventListener('click', () => { openLibrary(false); $('libraryBtn').focus(); });
$('libSample').addEventListener('click', () => { openLibrary(false); openSample(); });

const ICON_TRASH = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
async function renderLibrary() {
  const list = $('libList');
  let songs: Awaited<ReturnType<typeof listSongs>> = [];
  try { songs = await listSongs(); } catch { /* sem IndexedDB */ }
  list.innerHTML = '';
  $('libEmpty').hidden = songs.length > 0;
  for (const song of songs) {
    const li = document.createElement('li'); li.className = 'lib-item' + (song.id === st.fileKey && !st.isSample ? ' cur' : '');
    const open = document.createElement('button'); open.type = 'button'; open.className = 'lib-open';
    const t = document.createElement('span'); t.className = 'lib-title'; t.textContent = song.title;
    const m = document.createElement('span'); m.className = 'lib-meta';
    m.textContent = [song.artist, song.bars + ' compassos', 'aberta ' + relativeDay(song.openedAt)].filter(Boolean).join(' · ');
    open.append(t, m);
    open.addEventListener('click', () => openSaved(song.id));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'lib-del'; del.innerHTML = ICON_TRASH;
    del.setAttribute('aria-label', 'Apagar ' + song.title);
    del.addEventListener('click', () => {
      // Confirmação no próprio item (sem janelas do browser)
      const c = document.createElement('span'); c.className = 'lib-confirm';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'danger'; yes.textContent = 'Apagar';
      const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancelar';
      yes.addEventListener('click', async () => { await deleteSong(song.id).catch(() => {}); renderLibrary(); toast('“' + song.title + '” apagada deste browser.'); });
      no.addEventListener('click', () => renderLibrary());
      c.append(yes, no); del.replaceWith(c); no.focus();
    });
    li.append(open, del); list.append(li);
  }
}
async function openSaved(id: string) {
  const song = await getSong(id).catch(() => null);
  if (!song) { toast('Não encontrei essa música neste browser.'); renderLibrary(); return; }
  st.api?.stop(); clearLoop();
  if (loadBytes(song.bytes, song.fileName, false)) { touchSong(id).catch(() => {}); openLibrary(false); }
}
function openSample() {
  return fetch(base + 'exemplo.gp5')
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then(b => { st.api?.stop(); clearLoop(); loadBytes(new Uint8Array(b), 'Exemplo', true); })
    .catch(() => { $('songTitle').textContent = 'Carrega um ficheiro Guitar Pro para começar'; });
}
input('fileInput').addEventListener('change', e => {
  const el = e.target as HTMLInputElement; readFile(el.files?.[0]); el.value = '';
});
let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { dragN++; $('drop').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('drop').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('drop').hidden = true; readFile(e.dataTransfer?.files[0]); });

// ---------- Ajuda e tutorial ----------
function openHelp(v: boolean) {
  $('helpMenu').hidden = !v; $('helpBtn').setAttribute('aria-expanded', String(v));
}
$('helpBtn').addEventListener('click', e => { e.stopPropagation(); openHelp($('helpMenu').hidden); });
document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('.help-wrap')) openHelp(false); });
$('tourBtn').addEventListener('click', () => { openHelp(false); startTour(); });

const tour = { i: 0, open: false };
function startTour() {
  openSettings(false, false); openLibrary(false); closeBarModal();
  tour.i = 0; tour.open = true;
  $('tour').hidden = false;
  $('tourDots').innerHTML = TOUR_STEPS.map(() => '<i></i>').join('');
  showTourStep();
  $<HTMLButtonElement>('tourNext').focus();
}
function endTour() {
  tour.open = false; $('tour').hidden = true; markTourSeen();
}
function showTourStep() {
  const step = TOUR_STEPS[tour.i], last = tour.i === TOUR_STEPS.length - 1;
  $('tourStep').textContent = (tour.i + 1) + ' / ' + TOUR_STEPS.length;
  $('tourTitle').textContent = step.title;
  $('tourText').textContent = step.text;
  $('tourDots').querySelectorAll('i').forEach((d, j) => d.classList.toggle('on', j === tour.i));
  $<HTMLButtonElement>('tourPrev').hidden = tour.i === 0;
  $('tourNext').textContent = last ? 'Começar' : tour.i === 0 ? 'Mostrar' : 'Seguinte';
  $<HTMLButtonElement>('tourSkip').hidden = last;
  const target = visibleTarget(step);
  if (target) target.scrollIntoView({ block: 'nearest' });
  requestAnimationFrame(() => placeTour(target));
}
/** Destaca o elemento e põe o cartão ao lado (por baixo ou por cima), sempre dentro do ecrã. */
function placeTour(target: HTMLElement | null) {
  const spot = $('tourSpot'), card = $('tourCard');
  const cw = card.offsetWidth, ch = card.offsetHeight, m = 12;
  if (!target) {
    spot.className = 'tour-spot none'; spot.removeAttribute('style');
    card.style.left = (innerWidth - cw) / 2 + 'px'; card.style.top = Math.max(m, (innerHeight - ch) / 2) + 'px';
    return;
  }
  const r = target.getBoundingClientRect(), pad = 6;
  spot.className = 'tour-spot';
  Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
  const below = r.bottom + pad + m, above = r.top - pad - m - ch;
  let top = below + ch <= innerHeight - m ? below : above >= m ? above : Math.max(m, innerHeight - ch - m);
  // Destinos muito altos (o esquema, o leitor): cartão por cima do centro do destino
  if (r.height > innerHeight * 0.6) top = Math.max(m, Math.min(innerHeight - ch - m, r.top + 40));
  const left = Math.max(m, Math.min(innerWidth - cw - m, r.left + r.width / 2 - cw / 2));
  card.style.left = left + 'px'; card.style.top = top + 'px';
}
$('tourNext').addEventListener('click', () => {
  if (tour.i === TOUR_STEPS.length - 1) { endTour(); return; }
  tour.i++; showTourStep();
});
$('tourPrev').addEventListener('click', () => { if (tour.i > 0) { tour.i--; showTourStep(); } });
$('tourSkip').addEventListener('click', endTour);
addEventListener('resize', () => { if (tour.open) placeTour(visibleTarget(TOUR_STEPS[tour.i])); });

// Ao abrir: o ficheiro escolhido na página inicial; ou a música de exemplo (?exemplo);
// ou a última música aberta neste browser; se não houver, a música de exemplo.
const params = new URLSearchParams(location.search);
if (params.has('exemplo') || params.has('abrir')) history.replaceState(null, '', location.pathname + location.hash);
async function boot(): Promise<unknown> {
  if (params.has('abrir')) {
    const f = await takePendingFile().catch(() => null);
    if (f && openImported(f.bytes, f.name)) return;
  }
  if (params.has('exemplo')) return openSample();
  const songs = await listSongs();
  return songs.length ? openSaved(songs[0].id) : openSample();
}
boot()
  .catch(() => openSample())
  .then(() => { if (location.hash === '#musicas') openLibrary(true); })
  // Primeira visita: tutorial (depois de a música aparecer, para os destaques ficarem no sítio certo)
  .finally(() => { if (!tourSeen()) setTimeout(startTour, 600); });
