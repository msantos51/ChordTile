import './fonts';
import './app/input-mode';
import './styles.css';
import type * as AlphaTab from '@coderline/alphatab';
import { analyzeBar, isBassTrack, label, sectionsFromScore, type LabelOptions, type Section } from './analysis/analyze';
import { parseScore } from './analysis/parse';
import { pitchClassesOf } from './app/notes';
import { exportPdf } from './app/pdf';
import { barView, type BarView } from './analysis/bar';
import { Clicker, METRO_SOUNDS, isMetroSound, nextTickTime, type MetroSound } from './app/metronome';
import { MetroInjector, type GridSource } from './app/metro-inject';
import type { GridEvent } from './app/metro-grid';
import { autoSub, beatInfo, countLabels, slotOf, type Sub } from './app/count';
import { VisualDelay } from './app/sync';
import { releaseAudio, unlockAudio } from './app/audio-unlock';
import { TOUR_STEPS, markTourSeen, tourSeen, visibleTarget } from './app/tour';
import { cloudEnabled, deleteRemoteSong, fetchEntitlement, syncLibrary, uploadSong, watchAccount, type Account } from './app/cloud';
import { openAuthDialog } from './app/auth-ui';
import { FREE_SONG_LIMIT, GUEST, GUEST_SONG_LIMIT, access, canSaveSong, planLabel, planState, songLimit, type Feature, type PlanState } from './app/plan';
import { OFFERS, checkoutUrl, paymentsEnabled } from './app/billing';
import { addLoop, addTime, isMastered, progressText, type SongProgress } from './app/practice';
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
/** Tablatura mais compacta em ecrãs estreitos (dois compassos por linha em vez de um). */
/** Compassos por linha da tablatura (Settings → Tab): 0 = automático (2 no telemóvel, os que couberem no computador). */
let tabPerRow = 0;
const tabLayout = () => {
  const auto = innerWidth < 600 ? { scale: 0.78, barsPerRow: 2 } : { scale: 0.95, barsPerRow: -1 };
  return tabPerRow > 0 ? { ...auto, barsPerRow: tabPerRow } : auto;
};

interface State {
  score: Score | null;
  fileKey: string;
  isSample: boolean;
  sections: Section[];
  /** Correções do utilizador, por instrumento (índice da pista) e por compasso. */
  overridesByTrack: Record<number, Record<number, string>>;
  /** Texto pessoal de cada compasso (por baixo do acorde), igual para todos os instrumentos. */
  texts: Record<number, string>;
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
  sections: [], overridesByTrack: {}, texts: {}, detected: [], fileFlag: [],
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
  texts?: Record<number, string>;
  /** Formato antigo: correções sem instrumento. */
  overrides?: Record<number, string>;
  perRow: number;
  track?: number;
}
const save = () => storage.set('mapa:' + st.fileKey, {
  sections: st.sections, overridesByTrack: st.overridesByTrack, texts: st.texts, perRow: st.perRow, track: st.viewTrack,
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
{ const saved = storage.get<number>('mapa:tabPerRow'); tabPerRow = typeof saved === 'number' && saved >= 0 && saved <= 6 ? Math.round(saved) : 0; select('tabPerRow').value = String(tabPerRow); }
input('syncMs').addEventListener('input', () => setSync(+input('syncMs').value));
$('syncMinus').addEventListener('click', () => setSync(st.syncMs - 10));
$('syncPlus').addEventListener('click', () => setSync(st.syncMs + 10));

// ---------- Carregar música ----------
function loadBytes(bytes: Uint8Array, name: string, isSample: boolean): boolean {
  let s: Score;
  try { s = parseScore(at, bytes); }
  catch (e) {
    showErr('Couldn’t read “' + name + '”: the file is damaged or in an unsupported format. Guitar Pro 3 to 8 (.gp3, .gp4, .gp5, .gpx, .gp) and MusicXML files are supported. If the file opens in Guitar Pro, try saving it as .gp5.');
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
  st.texts = saved?.texts ?? {};
  if (saved?.perRow) { st.perRow = saved.perRow; select('perRow').value = String(saved.perRow); }

  practice.progress = storage.get<SongProgress>('mapa:progress:' + st.fileKey) ?? {}; practice.lastTick = -1; practice.lastAt = 0;
  renderInfo(name); renderTrackControls(); detect(); renderChart(); renderTab(); updateNow(-1, 0);
  return true;
}

function renderInfo(name: string) {
  const s = score();
  $('songTitle').textContent = s.title || name.replace(/\.[^.]+$/, '');
  document.title = $('songTitle').textContent + ' · ChordTile';
  const mb = s.masterBars[0];
  const parts = [s.artist, s.masterBars.length + ' bars', Math.round(s.tempo) + ' bpm', mb ? mb.timeSignatureNumerator + '/' + mb.timeSignatureDenominator : ''];
  const m = $('songMeta'); m.textContent = parts.filter(Boolean).join(' · ');
  if (st.isSample) { const b = document.createElement('span'); b.className = 'sample'; b.textContent = 'Sample'; m.append(b); }
}

const isPercussion = (t: Track) => t.staves.every(x => x.isPercussion);
function trackLabel(t: Track, i: number) {
  const name = t.name || 'Track ' + (i + 1);
  // Só acrescenta "baixo" quando o nome ainda não o diz ("Baixo" fica "Baixo", não "Baixo · baixo").
  return isBassTrack(t) && !/bass|baixo|bajo/i.test(name) ? name + ' · bass' : name;
}

/** Preenche o seletor de instrumento da barra de topo. A bateria fica de fora: não tem tom. */
function renderTrackControls() {
  const s = score();
  const sel = select('trackQuick');
  sel.innerHTML = '';
  s.tracks.forEach((t, i) => {
    if (isPercussion(t)) return;
    const o = document.createElement('option'); o.value = String(i); o.textContent = trackLabel(t, i);
    o.selected = i === st.viewTrack; sel.append(o);
  });
}

/** Muda o instrumento: volta a detetar o tom só com ele, e atualiza a tablatura. */
function setTrack(i: number) {
  if (i === st.viewTrack) return;
  st.viewTrack = i;
  select('trackQuick').value = String(i);
  save(); detect(); renderChart(); renderTab();
  toast('Key detected from: ' + trackLabel(score().tracks[i], i));
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
    note.textContent = 'This song has no pitched instrument (drums only), so there is no key to show.';
    chart.append(note);
  }
  st.sections.forEach((sec, k) => {
    const end = secEnd(k);
    const wrap = document.createElement('div'); wrap.className = 'section' + (st.loopSection === k ? ' looping' : ''); wrap.dataset.sec = String(k);
    const head = document.createElement('div'); head.className = 'sec-head';
    const mark = document.createElement('div'); mark.className = 'mark'; mark.contentEditable = 'true'; mark.spellcheck = false;
    mark.textContent = sec.name; mark.setAttribute('aria-label', 'Section name');
    mark.addEventListener('input', () => { sec.name = mark.textContent?.trim() || 'SECTION'; save(); });
    mark.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); mark.blur(); } });
    const meta = document.createElement('span'); meta.className = 'sec-meta';
    meta.textContent = 'b. ' + (sec.start + 1) + '–' + end + ' · ' + (end - sec.start) + ' bars';
    // Progresso fora de .sec-meta, para se ver também no telemóvel
    const prog = document.createElement('span'); prog.className = 'sec-prog-wrap'; prog.dataset.start = String(sec.start);
    const acts = document.createElement('div'); acts.className = 'sec-actions';
    const loopB = document.createElement('button'); loopB.type = 'button'; loopB.className = 'sbtn' + (st.loopSection === k ? ' on' : '');
    loopB.innerHTML = ICON_LOOP + '<span>' + (st.loopSection === k ? 'Practising' : 'Practise') + '</span>';
    loopB.title = 'Loop this section'; loopB.setAttribute('aria-label', 'Practise ' + sec.name + ' on loop');
    loopB.addEventListener('click', () => practiceSection(k)); loopB.dataset.gate = 'tools';
    loopB.setAttribute('aria-pressed', String(st.loopSection === k));
    acts.append(loopB);
    head.append(mark, meta, prog, acts); wrap.append(head);

    for (let r = sec.start; r < end; r += st.perRow) {
      const row = document.createElement('div'); row.className = 'row'; row.style.setProperty('--per', String(st.perRow));
      for (let i = r; i < Math.min(r + st.perRow, end); i++) row.append(barCell(i));
      wrap.append(row);
    }
    chart.append(wrap);
  });
  markPlaying(st.playingBar, false);
  if (st.playingBar >= 0) updateNow(st.playingBar, 0);
  renderProgress(); applyLocks();
}

function barCell(i: number) {
  const mb = score().masterBars[i];
  const cell = document.createElement('div'); cell.className = 'bar'; cell.dataset.bar = String(i);
  cell.tabIndex = 0; cell.setAttribute('role', 'button');
  if (st.fileFlag[i] && ov()[i] == null) cell.classList.add('file');
  const num = document.createElement('span'); num.className = 'num'; num.textContent = (mb.isRepeatStart ? '‖: ' : '') + (i + 1);
  const ch = document.createElement('div'); ch.className = 'ch'; ch.textContent = barText(i);
  // Texto pessoal por baixo do acorde ("palm mute", "x2", "slide"…)
  const txt = document.createElement('div'); txt.className = 'txt'; txt.spellcheck = false;
  txt.textContent = st.texts[i] ?? ''; txt.hidden = !st.texts[i];
  cell.classList.toggle('has-txt', !!st.texts[i]);
  cell.setAttribute('aria-label', 'Bar ' + (i + 1) + ', ' + barText(i) + (st.texts[i] ? ', note: ' + st.texts[i] : ''));
  const pick = () => { selectBar(i); if (st.ready && st.playingBar !== i) goBar(i, true); };
  cell.addEventListener('click', e => { if ((e.target as HTMLElement).isContentEditable) return; pick(); });
  cell.addEventListener('dblclick', e => { e.preventDefault(); selectBar(i); editText(i); });
  cell.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).isContentEditable) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); focusBar(i + (e.key === 'ArrowRight' ? 1 : -1)); }
  });
  colorCell(cell, barText(i));
  cell.append(num, ch, txt);
  if (mb.repeatCount > 0) { const rep = document.createElement('span'); rep.className = 'rep'; rep.textContent = ':‖ ×' + mb.repeatCount; cell.append(rep); }
  return cell;
}
function focusBar(i: number) {
  document.querySelector<HTMLElement>('.bar[data-bar="' + i + '"]')?.focus();
}
/** Escreve (ou muda) o texto por baixo do acorde do compasso i. Vazio = apaga. */
function editText(i: number) {
  if (!gateOk('notes')) return;
  const cell = document.querySelector<HTMLElement>('.bar[data-bar="' + i + '"]');
  const txt = cell?.querySelector<HTMLElement>('.txt');
  if (!cell || !txt) return;
  const before = st.texts[i] ?? '';
  txt.hidden = false; cell.classList.add('has-txt', 'writing');
  txt.contentEditable = 'true'; txt.dataset.ph = 'Your note…';
  txt.focus(); selectText(txt);
  const done = (keep: boolean) => {
    txt.removeEventListener('keydown', onKey); txt.removeEventListener('blur', onBlur);
    txt.contentEditable = 'false'; cell.classList.remove('writing');
    const v = keep ? (txt.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) : before;
    if (v) st.texts[i] = v; else delete st.texts[i];
    txt.textContent = v; txt.hidden = !v; cell.classList.toggle('has-txt', !!v);
    save(); updateTextBtn();
    if (keep && v !== before) toast(v ? 'Note saved on bar ' + (i + 1) + '.' : 'Note removed.');
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true); cell.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); done(false); cell.focus(); }
  };
  const onBlur = () => done(true);
  txt.addEventListener('keydown', onKey); txt.addEventListener('blur', onBlur);
}
function updateTextBtn() {
  $('bbText').textContent = st.selBar >= 0 && st.texts[st.selBar] ? 'Edit note' : 'Add note';
}
function selectBar(i: number) {
  document.querySelectorAll('.bar.sel').forEach(e => e.classList.remove('sel'));
  document.querySelector('.bar[data-bar="' + i + '"]')?.classList.add('sel');
  st.selBar = i;
  $('bbLabel').textContent = 'Bar ' + (i + 1);
  $<HTMLButtonElement>('bbSplit').disabled = st.sections.some(s => s.start === i);
  updateTextBtn();
  $('barbar').hidden = false;
  showTabSel(i, false);
}
$('bbText').addEventListener('click', () => { if (st.selBar >= 0) editText(st.selBar); });
$('bbExpand').addEventListener('click', () => { if (st.selBar >= 0) { $('barbar').hidden = true; openBarModal(st.selBar); } });

$('bbClose').addEventListener('click', () => { $('barbar').hidden = true; document.querySelectorAll('.bar.sel').forEach(e => e.classList.remove('sel')); (document.activeElement as HTMLElement | null)?.blur(); });
$('bbPlay').addEventListener('click', () => { if (st.selBar >= 0) playFrom(st.selBar); });
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
    $('nowTitle').textContent = st.sections[0] ? st.sections[0].name + ' · bar 1' : 'Start';
    $('nowChip').textContent = '';
    return;
  }
  const k = secOf(i);
  $('nowTitle').textContent = st.sections[k].name + ' · bar ' + (i + 1);
  $('nowChip').textContent = st.sections[k].name + ' · b. ' + (i + 1);
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
  const meta = [s.artist, trackLabel(t, st.viewTrack), Math.round(s.tempo) + ' bpm', mb ? mb.timeSignatureNumerator + '/' + mb.timeSignatureDenominator : '', s.masterBars.length + ' bars']
    .filter(Boolean).join(' · ');
  const btn = $<HTMLButtonElement>('pdfBtn'); btn.disabled = true;
  try {
    await exportPdf({
      title: $('songTitle').textContent || 'Song',
      meta,
      perRow: st.perRow,
      colors: input('optColors').checked,
      theme: currentTheme(),
      noteKey: [...$('noteKey').children].map(el => el.textContent ?? ''),
      watermark: plan.premium ? undefined : 'FREE PLAN',
      sections: st.sections.map((sec, k) => {
        const end = secEnd(k), bars = [];
        for (let i = sec.start; i < end; i++) {
          const mb = s.masterBars[i];
          bars.push({ n: i + 1, text: barText(i), pcs: pitchClassesOf(barText(i)), note: st.texts[i], repeatStart: mb.isRepeatStart, repeats: mb.repeatCount });
        }
        return { name: sec.name, range: 'b. ' + (sec.start + 1) + '–' + end, bars };
      }),
    }, base);
    toast(plan.premium ? 'Chart PDF downloaded.' : 'Chart PDF downloaded. Premium exports it without the watermark.');
  } catch { toast('Couldn’t create the PDF.'); }
  finally { btn.disabled = false; }
});

// ---------- Tema claro / escuro ----------
function setTheme(theme: Theme) {
  applyTheme(theme);
  input('optLight').checked = theme === 'light';
  const next = theme === 'light' ? 'dark' : 'light';
  $('themeBtn').setAttribute('aria-label', 'Switch to ' + next + ' theme');
  if (st.api) {
    // A tablatura é desenhada em SVG com cores próprias: trocar e voltar a desenhar.
    const res = st.api.settings.display.resources as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(TAB_COLORS[theme])) res[k] = at.model.Color.fromJson(v);
    st.api.updateSettings();
    st.api.render();
  }
}
$('themeBtn').addEventListener('click', () => setTheme(currentTheme() === 'light' ? 'dark' : 'light'));
// Nas definições (no telemóvel o botão do tema, a ajuda e o Premium ficam só aqui)
input('optLight').checked = currentTheme() === 'light';
input('optLight').addEventListener('change', () => setTheme(input('optLight').checked ? 'light' : 'dark'));
$('setTour').addEventListener('click', () => { openSettings(false, false); startTour(); });
$('setPremium').addEventListener('click', () => { openSettings(false, false); $('premiumBtn').click(); });
$('themeBtn').setAttribute('aria-label', 'Switch to ' + (currentTheme() === 'light' ? 'dark' : 'light') + ' theme');

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
select('tabPerRow').addEventListener('change', () => {
  tabPerRow = +select('tabPerRow').value; storage.set('mapa:tabPerRow', tabPerRow);
  if (st.api) { Object.assign(st.api.settings.display, tabLayout()); st.api.updateSettings(); st.api.render(); }
});
$('resetBtn').addEventListener('click', () => {
  st.overridesByTrack[st.viewTrack] = {}; st.sections = sectionsFromScore(score()); clearLoop(); save(); renderChart(); toast('Chart reset from the file.');
});
select('trackQuick').addEventListener('change', () => setTrack(+select('trackQuick').value));

// ---------- Compasso escolhido na tablatura ----------
/** Mostra o contorno e a barra (Expandir / Loop) por cima do compasso i na tablatura. */
/** `withBar`: mostra também a barra com Expandir/Loop (escolha feita na tablatura). Escolhido no
 *  esquema, só o contorno: as ações ficam na barra de baixo, para não haver duas barras iguais. */
let tabSelWithBar = false;
function showTabSel(i: number, withBar = tabSelWithBar) {
  st.tabSel = i; tabSelWithBar = withBar;
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
  $('tsLabel').textContent = 'Bar ' + (i + 1) + ' · ' + barText(i);
  // Se a barra ficasse cortada no topo do painel, passa para baixo do compasso
  const visibleTop = tab.offsetTop + b.y - $('tabScroll').scrollTop;
  $('tabSelBar').classList.toggle('below', visibleTop < 60);
  $('tabSelBar').hidden = !tabSelWithBar;
  const on = st.loopBar === i;
  $('tsLoop').setAttribute('aria-pressed', String(on));
  $('tsLoop').querySelector('span')!.textContent = on ? 'Stop loop' : 'Loop';
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
  usedSub: 2 as Sub,
  beatTicks: 960,
  slots: 8,
  lastSlot: -1,
  reps: 0,
};
const LINE_GAP = 44;

function openBarModal(i: number) {
  if (!st.score || !gateOk('expand')) return;
  modal.open = true;
  syncModalToggles();
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
    if (st.ready) setStatus('Paused');
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
  $('bmTitle').append('Bar ' + (i + 1) + ' ');
  const sp = document.createElement('span'); sp.textContent = '· ' + st.sections[k].name; $('bmTitle').append(sp);
  const v = modal.view, t = s.tracks[st.viewTrack];
  $('bmMeta').textContent = v.numerator + '/' + v.denominator + ' · ' + Math.round(s.tempo) + ' bpm · ' + trackLabel(t, st.viewTrack);
  const chord = $('bmChord'); chord.textContent = barText(i);
  const pc = pitchClassesOf(barText(i))[0];
  if (pc != null && input('optColors').checked) chord.style.setProperty('--nc', 'var(--n' + pc + ')'); else chord.style.removeProperty('--nc');
  $<HTMLButtonElement>('bmPrev').disabled = i === 0;
  $<HTMLButtonElement>('bmNext').disabled = i === s.masterBars.length - 1;
  $('bmPrevN').textContent = 'Bar ' + i;
  $('bmNextN').textContent = 'Bar ' + (i + 2);
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
  // A contagem é sempre automática: a mais simples que acerta em todas as notas do compasso.
  const sub: Sub = autoSub(v.notes.map(n => n.start), beatTicks);
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

  // Subdivisão (automática)
  const names2: Record<Sub, string> = { 1: 'beats (1 2 3 4)', 2: 'eighth notes (1 & 2 &)', 4: 'sixteenth notes (1 e & a)' };
  $('bmSubName').textContent = names2[sub];
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
  $('bmPlayText').textContent = playing ? 'Playing on loop' : 'Play on loop';
}
$('bmPlay').addEventListener('click', () => {
  if (!st.ready) { toast('The sounds are still loading.'); return; }
  if (api().playerState === PLAYING && st.loopBar === modal.bar) { api().pause(); return; }
  // Contagem e metrónomo conforme as opções da janela (e os botões do leitor acompanham)
  setPressed('countBtn', input('bmCountIn').checked); setPressed('metroBtn', input('bmMetro').checked); applyMetronome();
  modal.reps = 0; $('bmReps').textContent = '0';
  setLoopBar(modal.bar);
  api().tickPosition = barTick(modal.bar);
  api().play();
});
input('bmMetro').addEventListener('change', () => { setPressed('metroBtn', input('bmMetro').checked); applyMetronome(); });
// "Play along" e "Solo" da janela do compasso são os mesmos do leitor (nunca ligados os dois ao mesmo tempo)
input('bmMute').addEventListener('change', () => { const v = input('bmMute').checked; setPressed('muteBtn', v); if (v) setPressed('soloBtn', false); applyMute(); });
input('bmSolo').addEventListener('change', () => { const v = input('bmSolo').checked; setPressed('soloBtn', v); if (v) setPressed('muteBtn', false); applyMute(); });
input('bmCountIn').addEventListener('change', () => { setPressed('countBtn', input('bmCountIn').checked); applyMetronome(); });
select('bmSpeed').addEventListener('change', () => {
  select('speed').value = select('bmSpeed').value;
  select('speed').dispatchEvent(new Event('change'));
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
    if (startsAudio) { unlockAudio(); if (metro.sound !== 'click') clicker.ensure(); }
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
  // Todos os textos da tablatura (títulos, marcações, andamento, números) em Roboto, como o resto do site
  const fonts = a.settings.display.resources.elementFonts;
  for (const [el, f] of fonts) fonts.set(el, new at.model.Font('Roboto', f.size, f.style, f.weight));
  a.updateSettings();
  a.customCursorHandler = delay.cursorHandler(at.midi.MidiTickLookupFindBeatResultCursorMode.ToNextBext);
  a.soundFontLoad.on(e => { if (e.total) $('status').textContent = 'Loading sounds… ' + Math.round((e.loaded / e.total) * 100) + '%'; });
  a.playerReady.on(() => {
    st.ready = true;
    ['playBtn', 'stopBtn', 'prevBtn', 'nextBtn', 'loopBtn', 'metroBtn', 'countBtn', 'muteBtn', 'soloBtn'].forEach(id => ($<HTMLButtonElement>(id).disabled = false));
    $('status').textContent = 'Ready to play';
    a.playbackSpeed = +select('speed').value / 100;
    setupInjector(a);
    applyMetronome(); if (metro.sound !== 'click') void clicker.load(metro.sound);
    applyMute();
  });
  a.renderStarted.on(() => ($('tabLoading').hidden = false));
  a.renderFinished.on(() => {
    $('tabLoading').hidden = true; if (st.tabSel >= 0 && !modal.open) placeTabSel();
    // Ao mudar para a vista da tablatura (telemóvel), mostra logo o compasso onde está
    if (pendingScroll && st.playingBar >= 0) { pendingScroll = false; requestAnimationFrame(() => scrollTabToBar(st.playingBar, false)); }
  });
  a.playerStateChanged.on(e => {
    const playing = e.state === PLAYING;
    if (!playing) { delay.clear(); releaseAudio(); practice.lastAt = 0; flushProgress(); }
    // Contagem inicial: os primeiros avisos do metrónomo (um compasso) são a contagem
    metro.last = null;
    metro.countInLeft = playing && $('countBtn').getAttribute('aria-pressed') === 'true' ? curNumerator() : 0;
    $('playIcon').innerHTML = playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    setStatus(playing ? 'Playing' : 'Paused');
    syncModalPlay();
    if (!playing && modal.open) clearModalHighlight();
  });
  a.midiEventsPlayedFilter = [at.midi.MidiEventType.AlphaTabMetronome];
  a.midiEventsPlayed.on(e => { for (const m of e.events) if ((m as AlphaTab.midi.AlphaTabMetronomeEvent).isMetronome) onMetronome(m as AlphaTab.midi.AlphaTabMetronomeEvent); });
  a.playedBeatChanged.on(beat => delay.run(() => {
    const mb = beat.voice.bar.masterBar, i = mb.index;
    if (i !== st.playingBar) { st.playingBar = i; markPlaying(i); }
    let frac = 0; try { frac = beat.playbackStart / mb.calculateDuration(); } catch { /* compasso vazio */ }
    updateNow(i, frac);
    if (modal.open && i === modal.bar) highlightModal(beat.playbackStart, beat.id);
    trackPractice(i, barTick(i) + beat.playbackStart);
  }));
  // Clicar numa nota da tablatura leva o esquema para esse compasso.
  a.beatMouseDown.on(beat => {
    const i = beat.voice.bar.masterBar.index;
    $('barbar').hidden = true;
    showTabSel(i, true);
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
  a.error.on(e => { $('status').textContent = 'Player error: ' + (e?.message ?? e); });
}
function setStatus(txt: string) {
  const s = $('status'); s.textContent = txt;
  const what = st.loopSection >= 0 ? st.sections[st.loopSection].name : st.loopBar >= 0 ? 'bar ' + (st.loopBar + 1) : '';
  if (what) { const l = document.createElement('span'); l.className = 'loopinfo'; l.textContent = ' · looping ' + what; s.append(l); }
  s.append(' · ' + select('speed').value + '%');
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

/** Os botões do leitor e as opções da janela do compasso mostram sempre o mesmo estado. */
function syncModalToggles() {
  const on = (id: string) => $(id).getAttribute('aria-pressed') === 'true';
  input('bmCountIn').checked = on('countBtn'); input('bmMetro').checked = on('metroBtn');
  input('bmMute').checked = on('muteBtn'); input('bmSolo').checked = on('soloBtn');
}
/** "Tocar por cima" silencia o instrumento selecionado; "Só o meu instrumento" deixa só esse a tocar. */
function applyMute() {
  syncModalToggles();
  if (!st.api || !st.score) return;
  const all = st.score.tracks, mine = [all[st.viewTrack]];
  const mute = $('muteBtn').getAttribute('aria-pressed') === 'true';
  const solo = $('soloBtn').getAttribute('aria-pressed') === 'true';
  st.api.changeTrackMute(all, false);
  st.api.changeTrackSolo(all, false);
  if (mute) st.api.changeTrackMute(mine, true);
  if (solo) st.api.changeTrackSolo(mine, true);
}

// ---------- Sons do metrónomo ----------
const clicker = new Clicker(base);
const metro = { sound: 'click' as MetroSound, last: null as number | null, countInLeft: 0 };
for (const id of ['metroSound', 'bmSound']) {
  for (const o of METRO_SOUNDS) { const el = document.createElement('option'); el.value = o.id; el.textContent = o.label; select(id).append(el); }
  select(id).addEventListener('change', () => { clicker.ensure(); setMetroSound(select(id).value as MetroSound); });
}
function setMetroSound(v: MetroSound) {
  metro.sound = v; select('metroSound').value = v; select('bmSound').value = v;
  storage.set('mapa:metroSound', v);
  if (v !== 'click') void clicker.load(v);
  void injector?.prepare();
  applyMetronome();
}
{ const saved = storage.get<string>('mapa:metroSound'); metro.sound = isMetroSound(saved) ? saved : 'click'; select('metroSound').value = metro.sound; select('bmSound').value = metro.sound; }
/** O clique próprio do alphaTab só se ouve com o som "Click"; os outros sons tocamos nós. */
function applyMetronome() {
  syncModalToggles();
  if (!st.api) return;
  const metroOn = $('metroBtn').getAttribute('aria-pressed') === 'true';
  const countOn = $('countBtn').getAttribute('aria-pressed') === 'true';
  st.api.metronomeVolume = metroOn && metro.sound === 'click' ? 1 : 0;
  // A contagem inicial só acontece com volume > 0: com outro som fica quase muda e tocamos nós
  st.api.countInVolume = countOn ? (metro.sound === 'click' ? 1 : 0.0001) : 0;
}
const curNumerator = () => {
  const i = Math.max(0, st.playingBar);
  return st.score?.masterBars[i]?.timeSignatureNumerator ?? 4;
};
/**
 * Metrónomo e contagem exatos: o som é misturado no próprio fluxo de áudio da música, na amostra certa
 * (ver app/metro-inject.ts). O som "Click" é o do próprio alphaTab, que já vem dentro do sintetizador.
 * Se isto não puder ser instalado, usa-se o método antigo (onMetronome), que agenda os sons pelos avisos.
 */
let injector: MetroInjector | null = null;
let gridCache: { score: AlphaTab.model.Score; source: GridSource } | null = null;
/** Eventos de tempo e compasso do MIDI da música, iguais aos que o sintetizador usa para a sua grelha. */
function gridSource(): GridSource | null {
  const a = st.api, sc = a?.score;
  if (!a || !sc) return null;
  if (gridCache?.score === sc) return gridCache.source;
  const mf = new at.midi.MidiFile();
  new at.midi.MidiFileGenerator(sc, a.settings, new at.midi.AlphaSynthMidiFileHandler(mf, false)).generate();
  const events: GridEvent[] = [];
  let abs = 0, prev = 0;
  for (const e of mf.events) {
    abs += e.tick - prev; prev = e.tick;   // o alphaTab soma as diferenças entre eventos
    if (e.type === at.midi.MidiEventType.TempoChange) events.push({ kind: 'tempo', tick: abs, bpm: (e as AlphaTab.midi.TempoChangeEvent).beatsPerMinute });
    else if (e.type === at.midi.MidiEventType.TimeSignature) {
      const t = e as AlphaTab.midi.TimeSignatureEvent;
      events.push({ kind: 'signature', tick: abs, numerator: t.numerator, denominatorIndex: t.denominatorIndex });
    }
  }
  const source = { division: mf.division, tickShift: mf.tickShift, endTick: abs, events };
  gridCache = { score: sc, source };
  return source;
}
function setupInjector(a: AlphaTab.AlphaTabApi) {
  if (injector) return;
  const inj = new MetroInjector({
    player: (a as unknown as { player: unknown }).player,
    source: gridSource,
    speed: () => a.playbackSpeed,
    countInVolume: () => a.countInVolume,
    sound: () => metro.sound,
    metroOn: () => $('metroBtn').getAttribute('aria-pressed') === 'true',
    countInOn: () => $('countBtn').getAttribute('aria-pressed') === 'true',
    samples: (sound, rate) => clicker.samples(sound, rate),
    resync: () => { a.tickPosition = a.tickPosition; },
  });
  if (inj.install()) { injector = inj; void inj.prepare(); }
}
function onMetronome(m: AlphaTab.midi.AlphaTabMetronomeEvent) {
  if (injector?.active) return;
  const speed = st.api?.playbackSpeed || 1;
  const sec = m.metronomeDurationInMilliseconds / 1000 / speed;
  metro.last = nextTickTime(metro.last, clicker.now(), sec);
  const inCountIn = metro.countInLeft > 0;
  if (inCountIn) metro.countInLeft--;
  const on = $(inCountIn ? 'countBtn' : 'metroBtn').getAttribute('aria-pressed') === 'true';
  if (on && metro.sound !== 'click') clicker.tick(metro.sound, m.metronomeNumerator, metro.last, sec);
}
$('metroTest').addEventListener('click', () => {
  clicker.ensure();
  void clicker.load(metro.sound).then(() => {
    const t0 = clicker.now() + 0.1;
    for (let b = 0; b < 4; b++) {
      if (metro.sound === 'click') clicker.tick('wood', b, t0 + b * 0.6, 0.6); else clicker.tick(metro.sound, b, t0 + b * 0.6, 0.6);
    }
  });
});

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
  practice.lastTick = -1;
  i = Math.max(0, Math.min(score().masterBars.length - 1, i));
  leaveLoopIfOutside(i);
  delay.clear();
  api().tickPosition = barTick(i);
  st.playingBar = i; markPlaying(i, !fromChart); updateNow(i, 0);
  // A tablatura acompanha: rola até ao compasso escolhido.
  scrollTabToBar(i);
}
/** Rola a tablatura (o painel, ou a página no telemóvel) até o compasso i ficar à vista. */
function scrollTabToBar(i: number, smooth = true) {
  const b = st.api?.boundsLookup?.findMasterBarByIndex(i)?.visualBounds;
  const tab = $('tab'), sc = $('tabScroll');
  if (!b || !tab.offsetParent) return; // tablatura ainda por desenhar ou escondida (vista do esquema)
  const behavior: ScrollBehavior = smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
  const tabTop = tab.getBoundingClientRect().top;
  if (sc.scrollHeight > sc.clientHeight + 4) {
    // Painel com scroll próprio (computador): o compasso fica a um terço do topo do painel
    const scTop = sc.getBoundingClientRect().top;
    const y = tabTop - scTop + sc.scrollTop + b.y;
    if (y < sc.scrollTop + 8 || y + b.h > sc.scrollTop + sc.clientHeight - 8) sc.scrollTo({ top: Math.max(0, y - sc.clientHeight / 3), behavior });
  } else {
    const y = tabTop + scrollY + b.y, dockH = $('dock').offsetHeight;
    if (y < scrollY + 80 || y + b.h > scrollY + innerHeight - dockH - 16) window.scrollTo({ top: Math.max(0, y - innerHeight / 3), behavior });
  }
}
function playFrom(i: number) {
  if (!st.ready) { toast('The sounds are still loading.'); return; }
  goBar(i);
  if (api().playerState !== PLAYING) api().play();
}
function practiceSection(k: number) {
  if (!st.ready) { toast('The sounds are still loading.'); return; }
  if (st.loopSection === k) { clearLoop(); renderChart(); setStatus(api().playerState === PLAYING ? 'Playing' : 'Paused'); return; }
  st.loopSection = k; st.loopBar = -1; practice.lastTick = -1;
  const s = st.sections[k], end = secEnd(k);
  api().playbackRange = { startTick: barTick(s.start), endTick: barEndTick(end - 1) } as AlphaTab.synth.PlaybackRange;
  api().isLooping = true; setPressed('loopBtn', true);
  renderChart();
  delay.clear();
  api().tickPosition = barTick(s.start);
  if (api().playerState !== PLAYING) api().play(); else setStatus('Playing');
}
/** Loop de um só compasso (sem mudar a posição de reprodução). */
function setLoopBar(i: number) {
  if (st.loopSection >= 0) { st.loopSection = -1; renderChart(); }
  st.loopBar = i;
  api().playbackRange = { startTick: barTick(i), endTick: barEndTick(i) } as AlphaTab.synth.PlaybackRange;
  api().isLooping = true; setPressed('loopBtn', true);
  setStatus(api().playerState === PLAYING ? 'Playing' : 'Paused');
}
/** Liga/desliga o loop do compasso i e começa a tocar. */
function practiceBar(i: number) {
  if (!st.ready) { toast('The sounds are still loading.'); return; }
  if (st.loopBar === i) { clearLoop(); placeTabSel(); setStatus(api().playerState === PLAYING ? 'Playing' : 'Paused'); return; }
  setLoopBar(i); practice.lastTick = -1;
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
select('speed').addEventListener('change', () => {
  const v = +select('speed').value;
  select('bmSpeed').value = String(v);
  if (st.api) st.api.playbackSpeed = v / 100;
  if (st.ready) setStatus(api().playerState === PLAYING ? 'Playing' : 'Paused');
});
$('loopBtn').addEventListener('click', () => {
  const v = toggle('loopBtn'); api().isLooping = v;
  if (!v && (st.loopSection >= 0 || st.loopBar >= 0)) { clearLoop(); renderChart(); if (st.tabSel >= 0) placeTabSel(); }
});
$('metroBtn').addEventListener('click', () => { toggle('metroBtn'); clicker.ensure(); applyMetronome(); });
$('countBtn').addEventListener('click', () => { toggle('countBtn'); clicker.ensure(); applyMetronome(); });
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
  if (e.key === 'Escape' && !$('paywall').hidden) { closePaywall(); return; }
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
let pendingScroll = false;
function setView(v: 'chart' | 'tab') {
  document.body.dataset.view = v;
  $('vChart').setAttribute('aria-selected', String(v === 'chart'));
  $('vTab').setAttribute('aria-selected', String(v === 'tab'));
  if (v === 'tab') { st.api?.render(); pendingScroll = true; }
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
function openImported(bytes: Uint8Array, name: string): Promise<boolean> {
  // Limite de músicas: sem conta 1, conta grátis 3, Premium sem limite (reabrir uma guardada é sempre possível)
  return listSongs().catch(() => []).then(saved => {
    let id = '';
    try { const sc = parseScore(at, bytes); id = (sc.title || name) + '|' + (sc.artist || '') + '|' + sc.masterBars.length; } catch { /* loadBytes mostra o erro */ }
    if (id && !canSaveSong(plan, saved.map(x => x.id), id)) { songLimitReached(); return false; }
    st.api?.stop(); clearLoop();
    if (!loadBytes(bytes, name, false)) return false;
    saveImported(bytes, name);
    openLibrary(false);
    return true;
  });
}
function songLimitReached() {
  if (plan.kind === 'guest') {
    openAuthDialog('signup', 'Without an account you can keep ' + GUEST_SONG_LIMIT + ' song. Create a free account to keep ' + FREE_SONG_LIMIT + ' and unlock all practice tools.');
  } else {
    toast('The free plan keeps ' + FREE_SONG_LIMIT + ' songs. Delete one in “My songs” or go Premium for unlimited songs.');
    openPaywall('library');
  }
}
/** Guarda a música neste browser (e na conta, com Premium) para a próxima vez. */
function saveImported(bytes: Uint8Array, name: string) {
  const s = score(), id = st.fileKey;
  void (async () => {
    return saveSong({ id, fileName: name, title: $('songTitle').textContent || name, artist: s.artist || '', bars: s.masterBars.length }, bytes)
      .then(() => {
        askPersistentStorage(); renderLibrary(); toast('Saved to “My songs”.');
        if (account && plan.premium) uploadSong(id).catch(() => setSyncStatus('Couldn’t upload the last song. Try “Sync now”.'));
      })
      .catch(() => toast('Couldn’t save the song in this browser (private mode?).'));
  })();
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

const ICON_NOTE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_TRASH = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
async function renderLibrary() {
  const list = $('libList');
  let songs: Awaited<ReturnType<typeof listSongs>> = [];
  try { songs = await listSongs(); } catch { /* sem IndexedDB */ }
  list.innerHTML = '';
  $('libEmpty').hidden = songs.length > 0;
  $('libCount').textContent = songs.length ? plural(songs.length, 'song') + ' saved' : 'Nothing saved yet';
  renderLibLimit(songs.length);
  for (const song of songs) {
    const li = document.createElement('li'); li.className = 'lib-item';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'lib-open';
    const cur = song.id === st.fileKey && !st.isSample;
    const ic = document.createElement('span'); ic.className = 'lib-icon'; ic.innerHTML = ICON_NOTE;
    const txt = document.createElement('span'); txt.className = 'lib-text';
    const t = document.createElement('span'); t.className = 'lib-title'; t.textContent = song.title;
    const m = document.createElement('span'); m.className = 'lib-meta';
    m.textContent = [song.artist, song.bars + ' bars', 'opened ' + relativeDay(song.openedAt)].filter(Boolean).join(' · ');
    if (cur) { const now = document.createElement('span'); now.className = 'lib-now'; now.textContent = 'Open'; m.prepend(now); }
    txt.append(t, m); open.append(ic, txt);
    if (cur) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => openSaved(song.id));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'lib-del'; del.innerHTML = ICON_TRASH;
    del.setAttribute('aria-label', 'Delete ' + song.title);
    del.addEventListener('click', () => {
      // Confirmação no próprio item (sem janelas do browser)
      const c = document.createElement('span'); c.className = 'lib-confirm';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'danger'; yes.textContent = 'Delete';
      const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancel';
      yes.addEventListener('click', async () => {
        await deleteSong(song.id).catch(() => {});
        if (account) deleteRemoteSong(song.id).catch(() => setSyncStatus('Couldn’t delete it from your account. Try “Sync now”.'));
        renderLibrary(); toast('“' + song.title + '” deleted' + (account ? '.' : ' from this browser.'));
      });
      no.addEventListener('click', () => renderLibrary());
      c.append(yes, no); del.replaceWith(c); no.focus();
    });
    li.classList.toggle('cur', cur);
    li.append(open, del); list.append(li);
  }
}
async function openSaved(id: string) {
  const song = await getSong(id).catch(() => null);
  if (!song) { toast('That song isn’t in this browser any more.'); renderLibrary(); return; }
  st.api?.stop(); clearLoop();
  if (loadBytes(song.bytes, song.fileName, false)) { touchSong(id).catch(() => {}); openLibrary(false); }
}
function openSample() {
  return fetch(base + 'sample.gp5')
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then(b => { st.api?.stop(); clearLoop(); loadBytes(new Uint8Array(b), 'Sample', true); })
    .catch(() => { $('songTitle').textContent = 'Load a Guitar Pro file to get started'; });
}
input('fileInput').addEventListener('change', e => {
  const el = e.target as HTMLInputElement; readFile(el.files?.[0]); el.value = '';
});
let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { dragN++; $('drop').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('drop').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('drop').hidden = true; readFile(e.dataTransfer?.files[0]); });

// ---------- Conta e sincronização ----------
let account: Account | null = null;
let syncing = false;
function setSyncStatus(t: string) { $('syncStatus').textContent = t; }
/** A linha de sincronização de "My songs" só aparece com conta e Premium. */
function updateSyncRow() { $('libSync').hidden = !(account && plan.premium); }
function plural(n: number, w: string) { return n + ' ' + w + (n === 1 ? '' : 's'); }
async function runSync(quiet: boolean) {
  if (!account || syncing) return;
  if (!plan.premium) { setSyncStatus('Sync across devices is a Premium feature. Your songs stay in this browser.'); return; }
  syncing = true; $<HTMLButtonElement>('syncBtn').disabled = true; setSyncStatus('Syncing…');
  try {
    const r = await syncLibrary();
    const parts = [r.uploaded && plural(r.uploaded, 'song') + ' uploaded', r.downloaded && plural(r.downloaded, 'song') + ' downloaded', r.deleted && plural(r.deleted, 'song') + ' removed'].filter(Boolean);
    setSyncStatus('Up to date' + (parts.length ? ': ' + parts.join(', ') : '') + '.');
    if (parts.length) renderLibrary();
    if (!quiet && parts.length) toast('“My songs” synced.');
    // Primeira sincronização num dispositivo novo: abre a última música em vez do exemplo
    if (r.downloaded && st.isSample) { const songs = await listSongs(); if (songs[0]) openSaved(songs[0].id); }
  } catch {
    setSyncStatus('Couldn’t sync. Check your connection and try again.');
  } finally { syncing = false; $<HTMLButtonElement>('syncBtn').disabled = false; }
}
function showAccount(a: Account | null) {
  const was = account?.id; account = a;
  if (!a) setPlan(GUEST);
  $('libLocalHint').textContent = a
    ? 'Songs are kept in this browser (and in your account with Premium).'
    : 'Songs are saved only in this browser on this device.';
  $('accountBtnText').textContent = a ? (a.name.split(' ')[0] || 'Account') : 'Sign in';
  $('accountBtn').classList.toggle('signed', !!a);
  $('accountBtn').setAttribute('aria-label', a ? 'Your account' : 'Sign in or create an account');
  if (a && a.id !== was) refreshPlan().then(() => runSync(true));
  $('pwTrial').hidden = !!a;
  updateSyncRow(); applyLocks();
}
if (cloudEnabled) {
  watchAccount(showAccount).catch(() => { /* sem sessão */ });
  // Ao voltar ao separador, apanha o que mudou noutros dispositivos
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPlan().then(() => runSync(true)); });
}
const welcome = () => toast('You’re signed in. Welcome!');
$('accountBtn').addEventListener('click', () => { if (account) location.href = './account.html'; else openAuthDialog('signin', undefined, welcome); });
// Sem Supabase configurado (por exemplo em desenvolvimento) não há contas: tudo fica desbloqueado
if (!cloudEnabled) { $('accountBtn').hidden = true; queueMicrotask(() => setPlan({ kind: 'lifetime', premium: true, until: null })); }
$('syncBtn').addEventListener('click', () => (plan.premium ? runSync(false) : openPaywall('sync')));

// ---------- Cadeados (sem conta / conta grátis / Premium) ----------
const GATE_NAMES: Record<Feature, string> = {
  tools: 'Loop, speed, the metronome and the other practice tools', notes: 'Notes on the bars', expand: 'Expanding a bar',
  pdf: 'The PDF chart', progress: 'Progress per section', sync: 'Sync across devices',
};
/** Pode usar a função? Se não, pede conta (sem conta) ou mostra o Premium (conta grátis). */
function gateOk(f: Feature): boolean {
  const a = access(plan, f);
  if (a === 'ok') return true;
  if (a === 'account') {
    const premiumOnly = access({ kind: 'free', premium: false, until: null }, f) === 'premium';
    openAuthDialog('signup', GATE_NAMES[f] + (premiumOnly ? ' is Premium: create a free account to try it for 14 days.' : ' need a free account.'), welcome);
  } else openPaywall(f as PaywallReason);
  return false;
}
// Os botões com data-gate não fazem nada (e mostram a mensagem) enquanto estiverem bloqueados
document.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-gate]');
  if (!el || gateOk(el.dataset.gate as Feature)) return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
/** Mostra o cadeado nos botões que o plano atual não deixa usar. */
function applyLocks() {
  document.querySelectorAll<HTMLElement>('[data-gate]').forEach(el => {
    const locked = access(plan, el.dataset.gate as Feature) !== 'ok';
    el.classList.toggle('locked', locked);
    el.title = locked ? GATE_NAMES[el.dataset.gate as Feature] + (access(plan, el.dataset.gate as Feature) === 'account' ? ' · free account' : ' · Premium') : el.title.replace(/ · (free account|Premium)$/, '');
  });
  select('speed').disabled = access(plan, 'tools') !== 'ok';
  select('bmSpeed').disabled = select('speed').disabled;
}

// ---------- Plano (Free / Premium) ----------
let plan: PlanState = GUEST;
function setPlan(p: PlanState) {
  const was = plan.premium; plan = p;
  const btn = $('premiumBtn');
  btn.classList.toggle('on', p.premium);
  $('setPremiumText').textContent = p.premium ? planLabel(p) : 'Go Premium';
  $('setPremiumSub').textContent = p.premium ? 'All features unlocked. Thank you!' : 'Try 14 days free: sync, more songs and every bar up close';
  $('premiumBtnText').textContent = p.kind === 'trial' ? planLabel(p).replace('Premium trial · ', 'Trial · ') : p.premium ? 'Premium' : 'Go Premium';
  if (was !== p.premium) { renderProgress(); renderLibrary(); }
  updateSyncRow(); applyLocks();
}
async function refreshPlan() {
  if (!account) { setPlan(GUEST); return; }
  try { setPlan(planState(await fetchEntitlement())); } catch { /* sem rede: mantém o que estava */ }
}
async function renderLibLimit(count: number) {
  const el = $('libLimit');
  if (plan.premium) { el.hidden = true; return; }
  el.hidden = false; el.textContent = '';
  const lim = songLimit(plan), who = plan.kind === 'guest' ? 'Without an account' : 'Free plan';
  el.append(who + ': ' + Math.min(count, lim) + ' of ' + lim + ' song' + (lim === 1 ? '' : 's') + (count >= lim ? '. Delete one to load another.' : '.'));
  const b = document.createElement('button'); b.type = 'button'; b.className = 'linkbtn';
  b.textContent = plan.kind === 'guest' ? 'Create free account' : 'Go Premium';
  b.addEventListener('click', () => (plan.kind === 'guest' ? openAuthDialog('signup', undefined, welcome) : openPaywall('library')));
  el.append(' ', b);
}

// ---------- Janela do Premium ----------
type PaywallReason = 'upgrade' | 'library' | 'sync' | 'progress' | 'expand' | 'pdf';
const PAYWALL_COPY: Record<PaywallReason, [string, string]> = {
  upgrade: ['Keep everything you’ve built', 'Practising is always free. Premium is for the songs you keep coming back to.'],
  library: ['Keep all your songs', 'The free plan keeps ' + FREE_SONG_LIMIT + ' songs in “My songs”. Premium keeps them all, on every device.'],
  expand: ['See every bar up close', 'Expand any bar to see its notes large, how to count them, and practise it on its own.'],
  pdf: ['Take the chart to rehearsal', 'Premium exports the song chart as a clean PDF, with your notes.'],
  sync: ['Your songs on every device', 'Premium keeps “My songs” in sync between your phone, tablet and computer.'],
  progress: ['See how far you’ve come', 'Premium shows the time you’ve practised each section, your best speed and what you’ve mastered.'],
};
function openPaywall(reason: PaywallReason) {
  const [title, lead] = PAYWALL_COPY[reason];
  $('pwTitle').textContent = title; $('pwLead').textContent = lead;
  $('pwKicker').textContent = plan.kind === 'trial' ? planLabel(plan) : 'Premium';
  // Sem conta: primeiro a experiência grátis (só com o email). Com conta: os planos.
  $('pwTrial').hidden = !!account || !cloudEnabled;
  const offers = $('pwOffers'); offers.innerHTML = '';
  offers.hidden = !account;
  for (const o of OFFERS) {
    const url = account ? checkoutUrl(o.id, account) : null;
    const a = document.createElement('a'); a.className = 'pw-offer' + (o.id === 'yearly' ? ' best' : '');
    a.innerHTML = '<span class="n"></span><span class="p"></span><span class="t"></span>';
    a.querySelector('.n')!.textContent = o.name;
    const price = a.querySelector('.p')!; price.textContent = o.price;
    const per = document.createElement('small'); per.textContent = o.per; price.append(per);
    a.querySelector('.t')!.textContent = paymentsEnabled(o.id) ? o.note : 'Coming soon';
    if (url) a.href = url; else { a.setAttribute('aria-disabled', 'true'); a.setAttribute('role', 'link'); }
    offers.append(a);
  }
  $('pwFoot').hidden = !account;
  $('paywall').hidden = false; $('pwScrim').hidden = false;
  (account ? offers.querySelector<HTMLElement>('.best') ?? $('pwClose') : $('pwSignup')).focus();
}
function closePaywall() { $('paywall').hidden = true; $('pwScrim').hidden = true; }
$('premiumBtn').addEventListener('click', () => {
  if (plan.premium && plan.kind !== 'trial') { openLibrary(true); return; }
  openPaywall('upgrade');
});
$('pwClose').addEventListener('click', closePaywall);
$('pwScrim').addEventListener('click', closePaywall);
$('pwSignup').addEventListener('click', () => { closePaywall(); openAuthDialog('signup', undefined, welcome); });
$('pwSignin').addEventListener('click', () => { closePaywall(); openAuthDialog('signin', undefined, welcome); });
// Volta do checkout da Stripe: o Premium é ativado pelo webhook, por isso esperamos um pouco.
if (new URLSearchParams(location.search).has('checkout')) {
  history.replaceState(null, '', location.pathname + location.hash);
  toast('Thank you! Activating Premium…');
  let tries = 0;
  const poll = setInterval(async () => {
    await refreshPlan();
    if ((plan.premium && plan.kind !== 'trial') || ++tries > 10) {
      clearInterval(poll);
      if (plan.premium && plan.kind !== 'trial') { toast('Premium is on. Enjoy!'); runSync(true); }
    }
  }, 3000);
}

// ---------- Progresso por secção ----------
const practice = { progress: {} as SongProgress, lastTick: -1, lastAt: 0, dirty: false, savedAt: 0 };
function flushProgress() {
  if (!practice.dirty || !st.fileKey || st.isSample) return;
  storage.set('mapa:progress:' + st.fileKey, practice.progress);
  practice.dirty = false; practice.savedAt = Date.now();
}
/** Chamado a cada nota tocada: soma tempo à secção e deteta o fim de cada volta do loop. */
function trackPractice(bar: number, tick: number) {
  const now = performance.now();
  if (st.isSample) return;
  const k = secOf(bar), start = st.sections[k]?.start ?? 0;
  if (practice.lastAt) { practice.progress = addTime(practice.progress, start, now - practice.lastAt, Date.now()); practice.dirty = true; }
  practice.lastAt = now;
  const looping = st.loopSection >= 0 || st.loopBar >= 0;
  if (looping && practice.lastTick >= 0 && tick < practice.lastTick) onLoopDone();
  practice.lastTick = tick;
  if (Date.now() - practice.savedAt > 5000) flushProgress();
}
function onLoopDone() {
  const speed = +select('speed').value;
  if (st.loopSection >= 0) {
    const start = st.sections[st.loopSection].start;
    const before = isMastered(practice.progress[start]);
    practice.progress = addLoop(practice.progress, start, speed); practice.dirty = true;
    if (plan.premium && !before && isMastered(practice.progress[start])) toast('“' + st.sections[st.loopSection].name + '” mastered!');
    renderProgress();
  }
}
function renderProgress() {
  document.querySelectorAll<HTMLElement>('.sec-prog-wrap').forEach(w => {
    const p = practice.progress[+w.dataset.start!];
    const text = progressText(p);
    w.innerHTML = '';
    if (!text) return;
    if (plan.premium) {
      const sp = document.createElement('span'); sp.className = 'sec-prog' + (isMastered(p) ? ' mastered' : ''); sp.textContent = text; w.append(sp);
    } else {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sec-lock'; b.textContent = 'Progress · Premium';
      b.addEventListener('click', () => openPaywall('progress')); w.append(b);
    }
  });
}
addEventListener('pagehide', flushProgress);

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
  $('tourNext').textContent = last ? 'Start' : tour.i === 0 ? 'Show me' : 'Next';
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

// Ao abrir: o ficheiro escolhido na página inicial (?open); ou a música de exemplo (?sample);
// ou a última música aberta neste browser; se não houver, a música de exemplo.
const params = new URLSearchParams(location.search);
// (Also accepts the old Portuguese names: ?exemplo, ?abrir, #musicas.)
const wantSample = params.has('sample') || params.has('exemplo');
const wantOpen = params.has('open') || params.has('abrir');
if (wantSample || wantOpen) history.replaceState(null, '', location.pathname + location.hash);
async function boot(): Promise<unknown> {
  if (wantOpen) {
    const f = await takePendingFile().catch(() => null);
    if (f && await openImported(f.bytes, f.name)) return;
  }
  if (wantSample) return openSample();
  const songs = await listSongs();
  return songs.length ? openSaved(songs[0].id) : openSample();
}
boot()
  .catch(() => openSample())
  // Ligações diretas: player.html?premium abre os planos; ?signup a criação de conta
  .then(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('premium')) openPaywall('upgrade');
    if (q.has('signup') && !account) openAuthDialog('signup', undefined, welcome);
    if (q.has('premium') || q.has('signup')) history.replaceState(null, '', location.pathname + location.hash);
  })
  .then(() => { if (location.hash === '#songs' || location.hash === '#musicas') openLibrary(true); })
  // Primeira visita: tutorial (depois de a música aparecer, para os destaques ficarem no sítio certo)
  .finally(() => { if (!tourSeen()) setTimeout(startTour, 600); });
