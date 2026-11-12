import './fonts';
import './app/input-mode';
import './styles.css';
import type * as AlphaTab from '@coderline/alphatab';
import { analyzeBar, isBassTrack, label, sectionsFromScore, type LabelOptions, type Section } from './analysis/analyze';
import { parseScore } from './analysis/parse';
import { pitchClassesOf } from './app/notes';
import { exportPdf } from './app/pdf';
import { DYNAMIC_NAMES, TECH_NAMES, barView, techLegend, type BarView } from './analysis/bar';
import { Clicker, METRO_SOUNDS, isMetroSound, nextTickTime, type MetroSound } from './app/metronome';
import { MetroInjector, type GridSource } from './app/metro-inject';
import { stateAt, type GridEvent } from './app/metro-grid';
import { autoSub, beatInfo, countLabels, slotOf, type Sub } from './app/count';
import { VisualDelay } from './app/sync';
import { releaseAudio, unlockAudio } from './app/audio-unlock';
import { TOUR_STEPS, markTourSeen, tourSeen, visibleTarget } from './app/tour';
import { SongLimitError, addAccountSong, cloudEnabled, deleteAccountSong, fetchEntitlement, getAccountSong, listAccountSongs, loadUserData, saveUserData, saveUserDataOnExit, songDataKeys, touchAccountSong, watchAccount, type Account } from './app/cloud';
import { openAuthDialog } from './app/auth-ui';
import { FREE_SONG_LIMIT, GUEST, access, canSaveSong, planLabel, planState, songLimit, type Feature, type PlanState } from './app/plan';
import { OFFERS, checkoutUrl, paymentsEnabled } from './app/billing';
import { addLoop, addTime, isMastered, progressText, type SongProgress } from './app/practice';
import { buildSteps, byHeartPct, firstStepOf, isFinal, knownSections, restoreStep, runsGoal, stepRange, stepSection, type LearnStep, type SavedLearn } from './app/learn-path';
import { readLegacyData, readLegacySongs, relativeDay, wipeLegacy, type SongMeta } from './app/library';
import { TAB_COLORS, applyTheme, currentTheme, savedTheme, type Theme } from './app/theme';
import { attachAccount, detachAccount, flush, flushOnExit, isHydrated, mergeRemote, store } from './app/user-store';

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

// Dados da pessoa (notas, secções, progresso, preferências): ficam na conta, nunca no browser (ver user-store.ts)
const storage = store;
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
/** Altura da barra fixa em baixo (a do leitor, ou a do Tile by Tile no telemóvel). */
const bottomBarH = () => Math.max($('dock').offsetHeight, $('learnDock').offsetHeight);
{
  const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', bottomBarH() + 'px'));
  ro.observe($('dock')); ro.observe($('learnDock'));
}
// Altura do cabeçalho (para o rodapé ficar no fundo do ecrã quando há pouca música)
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', document.querySelector<HTMLElement>('.top')!.offsetHeight + 'px')).observe(document.querySelector('.top')!);

// ---------- Sincronização ----------
const delay = new VisualDelay(() => st.syncMs, () => !!st.api && st.api.playerState === PLAYING);
/** `keep` false: só mostra o valor (o valor por defeito não se escreve na conta de quem nunca o escolheu). */
function setSync(v: number, keep = true) {
  st.syncMs = Math.max(0, Math.min(500, Math.round((Number(v) || 0) / 10) * 10));
  input('syncMs').value = String(st.syncMs);
  $('syncOut').textContent = st.syncMs + ' ms';
  if (keep) storage.set('mapa:sync', st.syncMs);
}
setSync(storage.get<number>('mapa:sync') ?? 0, false);
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
  // Ainda com a música anterior: sai do Tile by Tile, fecha o compasso expandido e guarda o progresso dela.
  // (Feito depois de trocar, o esquema da música antiga era desenhado com os compassos da nova.)
  if (learn.on) exitLearn(false);
  closeModePick(false);
  closeBarModal(); flushProgress(); practice.dirty = false;
  st.score = s; st.isSample = isSample;
  st.fileKey = (s.title || name) + '|' + (s.artist || '') + '|' + s.masterBars.length;
  st.loopSection = -1; st.loopBar = -1; ownRange = null; st.tabSel = -1; st.selBar = -1; st.playingBar = -1;
  $('tabSel').hidden = true; $('barbar').hidden = true;
  restoreSong(storage.get<SavedSong>('mapa:' + st.fileKey));

  practice.progress = storage.get<SongProgress>('mapa:progress:' + st.fileKey) ?? {}; practice.lastTick = -1; practice.lastAt = 0;
  renderInfo(name); renderTrackControls(); detect(); renderChart(); renderTab(); updateNow(-1, 0); updateLearnCta();
  return true;
}
/** Aplica à música aberta o que está guardado para ela (secções, correções, notas, instrumento). */
function restoreSong(saved: SavedSong | null, keepTrack = false) {
  const s = score();
  const pitched = s.tracks.map((_, i) => i).filter(i => !isPercussion(s.tracks[i]));
  const bassIdx = pitched.find(i => isBassTrack(s.tracks[i]));
  // Instrumento: o último escolhido para esta música; senão o baixo; senão o primeiro com notas.
  const savedOk = saved?.track != null && s.tracks[saved.track] && !isPercussion(s.tracks[saved.track]);
  if (!keepTrack) st.viewTrack = savedOk ? saved!.track! : bassIdx ?? pitched[0] ?? 0;
  // Secções guardadas só valem se couberem nesta música (compassos que existem, por ordem)
  const n = s.masterBars.length;
  const secs = (saved?.sections ?? []).filter(x => x && typeof x.name === 'string' && Number.isInteger(x.start) && x.start >= 0 && x.start < n)
    .sort((a, b) => a.start - b.start).filter((x, k, all) => k === 0 || x.start !== all[k - 1].start);
  st.sections = secs.length ? secs : sectionsFromScore(s);
  st.overridesByTrack = saved?.overridesByTrack ?? (saved?.overrides ? { [st.viewTrack]: saved.overrides } : {});
  st.texts = saved?.texts ?? {};
  if (saved?.perRow && select('perRow').querySelector('option[value="' + saved.perRow + '"]')) { st.perRow = saved.perRow; select('perRow').value = String(saved.perRow); }
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
    loopB.addEventListener('click', () => practiceSection(k)); loopB.dataset.gate = 'loop';
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
  const r = el.getBoundingClientRect(), dockH = bottomBarH();
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
  goBar(i); // (o esquema também rola até lá: o compasso podia ficar fora do ecrã)
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
function setTheme(theme: Theme, keep = true) {
  applyTheme(theme, keep);
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
/** Troca de tema com transição: o novo tema abre-se num círculo a partir do botão (onde o browser deixa). */
function switchTheme(theme: Theme, from?: HTMLElement) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { setTheme(theme); return; }
  const r = from?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : 0;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  doc.startViewTransition(() => setTheme(theme)).ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
}
$('themeBtn').addEventListener('click', () => switchTheme(currentTheme() === 'light' ? 'dark' : 'light', $('themeBtn')));
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
select('perRow').addEventListener('change', () => { st.perRow = +select('perRow').value; save(); renderChart(); if (learn.on) renderLearnPath(learnSteps(), learn.step); });
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
  // A música a tocar seguida não continua por trás da janela (aqui estuda-se um compasso); um loop de compasso continua.
  if (st.api?.playerState === PLAYING && st.loopBar < 0) st.api.pause();
  if (learn.on) { cancelLearnCount(); hideLearnDone(); } // a contagem do passo não arranca a música por trás da janela
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
  // Tile by Tile: o leitor volta a ficar com o trecho do passo (o loop do compasso tinha-o substituído),
  // parado no início, com as voltas já feitas como estavam.
  const step = learn.on ? learnSteps()[learn.step] : null;
  if (step) { const [from, to] = stepRange(step); setLearnLoop(from, to); syncLearnPlay(); }
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
    const e = document.createElement('span'); e.className = 'nt' + (n.dead ? ' dead' : '') + (n.ghost ? ' ghost' : '') + (n.tied ? ' tied' : '');
    e.dataset.beat = String(n.beatId); e.dataset.slot = String(slot);
    e.textContent = n.dead ? 'x' : n.ghost ? '(' + n.fret + ')' : String(n.fret);
    // Técnicas da nota (H, P, bend, slide…): etiqueta pequena colada à nota
    if (n.tech.length) {
      const t = document.createElement('span'); t.className = 'tq';
      t.textContent = n.tech.map(x => x.text).join(' ');
      t.title = n.tech.map(x => TECH_NAMES[x.kind] + (x.kind === 'bend' || x.kind === 'prebend' ? ' ' + x.text.replace(/^(↑|PB) /, '') : '')).join(', ');
      e.append(t);
      e.setAttribute('aria-label', (n.dead ? 'dead note' : 'fret ' + n.fret) + ', ' + t.title);
    }
    e.style.left = x(slot); e.style.top = lineY(n.line) + 'px';
    staff.append(e);
  }
  // Técnicas de cada tempo (slap, pop, rasgado…) e dinâmicas, numa faixa por cima da pauta
  const bt = $('bmBeatTech'); bt.innerHTML = '';
  let anyBeat = false;
  for (const b of v.beats) {
    if (!b.tech.length && !b.dynamic) continue;
    anyBeat = true;
    const c = document.createElement('span'); c.className = 'btq';
    c.style.left = x(slotOf(b.start, beatTicks, sub, labels.length));
    if (b.dynamic) { const d = document.createElement('em'); d.className = 'dyn'; d.textContent = b.dynamic; d.title = 'Dynamics: ' + (DYNAMIC_NAMES[b.dynamic] ?? b.dynamic); c.append(d); }
    if (b.tech.length) { const t = document.createElement('span'); t.textContent = b.tech.map(x => x.text).join(' '); t.title = b.tech.map(x => TECH_NAMES[x.kind]).join(', '); c.append(t); }
    bt.append(c);
  }
  bt.classList.toggle('empty', !anyBeat); // fica na grelha (senão as colunas desencontram-se), só sem altura
  // Legenda: o que quer dizer cada etiqueta deste compasso
  const leg = techLegend(v), list = $('bmTechs'); list.innerHTML = '';
  for (const t of leg.kinds) {
    const li = document.createElement('li'); const k = document.createElement('b');
    k.textContent = t.kind === 'bend' ? '↑' : t.kind === 'prebend' ? 'PB' : t.text; li.append(k, ' ' + TECH_NAMES[t.kind]); list.append(li);
  }
  for (const d of leg.dynamics) {
    const li = document.createElement('li'); const k = document.createElement('em'); k.className = 'dyn'; k.textContent = d;
    li.append(k, ' ' + (DYNAMIC_NAMES[d] ? DYNAMIC_NAMES[d].charAt(0).toUpperCase() + DYNAMIC_NAMES[d].slice(1) : 'Dynamics')); list.append(li);
  }
  $('bmLegend').hidden = !list.childElementCount;

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
// O alphaTab só dá o clique na tablatura por terminado se o botão for largado em cima dela. Largado noutro
// sítio (ou por cima da barra do compasso), ficava "preso" e a tablatura deixava de acompanhar a música.
// Por isso, sempre que o botão é largado fora dela, entrega-se à tablatura um "largar" igual ao que ela esperava
// (se não havia clique por acabar, o alphaTab ignora-o).
let tabPress = false;
function endTabPress(e?: Event) {
  if (!tabPress) return;
  const surface = document.querySelector<HTMLElement>('#tab .at-surface');
  if (!surface || (e && e.target instanceof Node && surface.contains(e.target))) return; // largado na tablatura: ela trata
  tabPress = false;
  const m = e instanceof MouseEvent ? e : null;
  surface.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: m?.clientX ?? -1, clientY: m?.clientY ?? -1 }));
}
for (const ev of ['mouseup', 'pointercancel', 'blur'] as const) addEventListener(ev, endTabPress, { capture: true });
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
      scrollElement: $('tabScroll'), enableCursor: true, enableAnimatedBeatCursor: true, enableUserInteraction: true,
      // O scroll automático é feito por nós (followTab), a partir da posição real da música:
      // o do alphaTab dependia do cursor e deixava a tablatura parada no início enquanto a música avançava.
      scrollMode: at.ScrollMode.Off,
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
    if (learn.on) showLearnStep();
    applyMetronome(); if (metro.sound !== 'click') void clicker.load(metro.sound);
    applyMute();
  });
  a.renderStarted.on(() => ($('tabLoading').hidden = false));
  a.renderFinished.on(() => {
    $('tabLoading').hidden = true; if (st.tabSel >= 0 && !modal.open) placeTabSel();
    // Ao mudar para a vista da tablatura (telemóvel), mostra logo o compasso onde está
    if (pendingScroll && st.playingBar >= 0) { pendingScroll = false; requestAnimationFrame(() => scrollTabToBar(st.playingBar, false)); }
  });
  // Tile by Tile: o trecho toca uma vez e pára; no fim conta-se a volta e vem a contagem (ou o fim do passo)
  // (O loop de um compasso expandido também "acaba" a cada volta: essas não são voltas do passo. Contá-las
  // fazia vir a contagem e tocar a secção inteira com a janela de um só compasso ainda aberta.)
  a.playerFinished.on(() => { if (learn.on && !modal.open && st.loopBar < 0) learnRunEnded(); });
  a.playerStateChanged.on(e => {
    const playing = e.state === PLAYING;
    if (!playing) { delay.clear(); releaseAudio(); practice.lastAt = 0; flushProgress(); }
    // Parou (botão Stop, ou a música chegou ao fim): o leitor voltou ao início do trecho, ou da música.
    // O esquema e a barra de progresso acompanham, senão ficavam no último compasso tocado.
    if (!playing && e.stopped) showStopped();
    // Contagem inicial: os primeiros avisos do metrónomo (um compasso) são a contagem
    metro.last = null;
    metro.countInLeft = playing && !learn.on && $('countBtn').getAttribute('aria-pressed') === 'true' ? curNumerator() : 0;
    $('playIcon').innerHTML = playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    setStatus(playing ? 'Playing' : 'Paused');
    syncModalPlay(); syncLearnPlay();
    if (!playing && modal.open) clearModalHighlight();
  });
  a.midiEventsPlayedFilter = [at.midi.MidiEventType.AlphaTabMetronome];
  a.midiEventsPlayed.on(e => { for (const m of e.events) if ((m as AlphaTab.midi.AlphaTabMetronomeEvent).isMetronome) onMetronome(m as AlphaTab.midi.AlphaTabMetronomeEvent); });
  // O quadrado a tocar e a barra de progresso seguem a posição do próprio leitor (o tempo da música),
  // e não o cursor da tablatura: assim acompanham sempre, mesmo com a tablatura escondida ou só com uma secção
  // desenhada (Tile by Tile), onde o alphaTab não avisa da mudança de tempo.
  a.playerPositionChanged.on(e => {
    if (a.playerState !== PLAYING) return;
    const tick = e.currentTick;
    delay.run(() => {
      const at = barAtTick(tick);
      if (!at) return;
      if (at.i !== st.playingBar) { st.playingBar = at.i; markPlaying(at.i); followTab(at.i); }
      else ensurePlayingMark(at.i);
      updateNow(at.i, at.frac);
      trackPractice(at.i, tick);
    });
  });
  a.playedBeatChanged.on(beat => delay.run(() => {
    const i = beat.voice.bar.masterBar.index;
    if (modal.open && i === modal.bar) highlightModal(beat.playbackStart, beat.id);
  }));
  // Clicar numa nota da tablatura leva o esquema para esse compasso.
  a.beatMouseDown.on(beat => {
    tabPress = true;
    const i = beat.voice.bar.masterBar.index;
    $('barbar').hidden = true;
    showTabSel(i, true);
    if (i === st.playingBar) return;
    leaveLoopIfOutside(i);
    delay.clear();
    st.playingBar = i; markPlaying(i); updateNow(i, 0);
  });
  // Ao largar, o alphaTab leva o leitor para a nota clicada e MUDA o trecho a tocar: tira-o (clique simples) ou
  // troca-o pelo que se arrastou. O loop da secção/compasso e o passo do Tile by Tile ficavam desfeitos no leitor
  // (a música seguia até ao fim) com o site ainda a dizer "looping". Aqui repõe-se o trecho do site; a posição
  // clicada mantém-se se estiver dentro dele.
  a.beatMouseUp.on(() => {
    tabPress = false;
    const pos = a.tickPosition;
    if (!ownRange) { if (a.playbackRange) a.playbackRange = null; return; }
    a.playbackRange = { ...ownRange } as AlphaTab.synth.PlaybackRange; // (repor o trecho leva o leitor ao início dele)
    if (pos > ownRange.startTick && pos < ownRange.endTick) a.tickPosition = pos;
    practice.lastTick = -1;
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
/** Depois de parar: o esquema mostra onde o leitor ficou (início do trecho em loop, ou nada = início da música). */
function showStopped() {
  delay.clear(); practice.lastTick = -1;
  const i = ownRange ? barAtTick(ownRange.startTick)?.i ?? -1 : -1;
  st.playingBar = i; markPlaying(i, false); updateNow(i, 0);
  if (i >= 0) scrollTabToBar(i);
}
/** Compasso (e fração já tocada) num tempo do leitor; conta com as repetições. */
function barAtTick(tick: number): { i: number; frac: number } | null {
  const list = st.api?.tickCache?.masterBars;
  if (!list?.length) return null;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].start <= tick) lo = m; else hi = m - 1; }
  const l = list[lo], len = l.end - l.start;
  return { i: l.masterBar.index, frac: len > 0 ? Math.max(0, Math.min(1, (tick - l.start) / len)) : 0 };
}
/** Se o esquema foi redesenhado (ou o destaque se perdeu), volta a marcar o quadrado a tocar. */
function ensurePlayingMark(i: number) {
  const el = document.querySelector('.bar[data-bar="' + i + '"]');
  if (el && !el.classList.contains('playing')) markPlaying(i, false);
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
  // A contagem inicial só acontece com volume > 0: com outro som fica quase muda e tocamos nós.
  // No Tile by Tile a contagem é a do próprio passo (no meio do ecrã, antes de cada volta), por isso desliga-se aqui.
  st.api.countInVolume = countOn && !learn.on ? (metro.sound === 'click' ? 1 : 0.0001) : 0;
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
    countInOn: () => !learn.on && $('countBtn').getAttribute('aria-pressed') === 'true',
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
/** Fim do compasso i, da primeira vez que se toca (num compasso repetido, o seguinte só vem depois da repetição). */
function barEndTick(i: number) {
  const start = barTick(i);
  const hit = st.api?.tickCache?.masterBars.find(m => m.masterBar.index === i && m.start === start);
  return hit ? hit.end : start + score().masterBars[i].calculateDuration();
}
/**
 * Trecho do leitor para os compassos first…last (inclusive). Acaba onde começa o compasso seguinte: se o trecho
 * tiver repetições, tocam-se; depois do último compasso da música, vai até ao fim (com as repetições finais).
 */
function barsRange(first: number, last: number): TickRange {
  const startTick = barTick(first), list = st.api?.tickCache?.masterBars;
  let endTick = barEndTick(last);
  if (last + 1 < score().masterBars.length) { const next = barTick(last + 1); if (next > endTick) endTick = next; }
  else if (list?.length) endTick = Math.max(endTick, list[list.length - 1].end);
  return { startTick, endTick };
}
interface TickRange { startTick: number; endTick: number }
/**
 * O trecho que o site pediu ao leitor (loop de uma secção ou de um compasso, ou o passo do Tile by Tile);
 * null = a música toda. Guarda-se aqui porque o alphaTab também mexe no trecho (cliques na tablatura).
 */
let ownRange: TickRange | null = null;
function setRange(r: TickRange | null) {
  ownRange = r;
  if (st.api && st.ready) st.api.playbackRange = r ? ({ ...r } as AlphaTab.synth.PlaybackRange) : null;
}
/** Compassos [primeiro, último] a que o Tile by Tile limita o leitor no passo atual (null fora dele). */
function learnBars(): [number, number] | null {
  const step = learn.on ? learnSteps()[learn.step] : null;
  if (!step) return null;
  const [from, to] = stepRange(step);
  return [st.sections[from].start, secEnd(to) - 1];
}
function leaveLoopIfOutside(i: number) {
  if (learn.on) return; // o trecho do passo não se desfaz: goBar fica dentro dele
  const was = st.loopBar >= 0 || st.loopSection >= 0;
  if (st.loopBar >= 0 && i !== st.loopBar && !modal.open) { clearLoop(); if (st.tabSel >= 0) placeTabSel(); }
  if (st.loopSection >= 0) {
    const s = st.sections[st.loopSection];
    if (i < s.start || i >= secEnd(st.loopSection)) { clearLoop(); renderChart(); }
  }
  // O estado deixa de dizer "looping …"
  if (was && st.loopBar < 0 && st.loopSection < 0 && st.ready) setStatus(api().playerState === PLAYING ? 'Playing' : 'Paused');
}
/** Leva o leitor, a tablatura e o esquema para o compasso i. `fromChart`: não mexe no scroll do esquema. */
function goBar(i: number, fromChart = false) {
  if (!st.ready) return;
  practice.lastTick = -1;
  const lim = learnBars() ?? [0, score().masterBars.length - 1];
  i = Math.max(lim[0], Math.min(lim[1], i));
  leaveLoopIfOutside(i);
  delay.clear();
  api().tickPosition = barTick(i);
  st.playingBar = i; markPlaying(i, !fromChart); updateNow(i, 0);
  // A tablatura acompanha: rola até ao compasso escolhido.
  scrollTabToBar(i);
}
/** A tablatura (o painel no computador, a página no telemóvel) acompanha o compasso a tocar. */
function followTab(i: number) {
  scrollTabToBar(i);
}
/**
 * Rola a tablatura até o compasso i ficar à vista. Conta com o que se vê mesmo: o painel da tablatura
 * pode ter scroll próprio e ao mesmo tempo estar meio fora da janela (ou tapado pela barra do leitor),
 * por isso a zona visível é a interseção do painel com a janela.
 */
function scrollTabToBar(i: number, smooth = true) {
  const b = st.api?.boundsLookup?.findMasterBarByIndex(i)?.visualBounds;
  const tab = $('tab'), sc = $('tabScroll');
  if (!b || !tab.offsetParent) return; // tablatura ainda por desenhar ou escondida (vista do esquema)
  const behavior: ScrollBehavior = smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
  const vpTop = 80, vpBot = innerHeight - bottomBarH() - 16;
  let top = tab.getBoundingClientRect().top + b.y; // topo do compasso no ecrã
  if (sc.scrollHeight > sc.clientHeight + 4) {
    // Painel com scroll próprio (computador): o compasso fica a um terço da parte visível do painel
    const r = sc.getBoundingClientRect();
    const visTop = Math.max(r.top, vpTop), visBot = Math.min(r.bottom, vpBot);
    if (top < visTop + 8 || top + b.h > visBot - 8) {
      const anchor = visBot - visTop > b.h + 16 ? visTop + (visBot - visTop) / 3 : r.top + 8;
      const max = sc.scrollHeight - sc.clientHeight;
      const next = Math.max(0, Math.min(max, sc.scrollTop + top - anchor));
      top -= next - sc.scrollTop;
      if (Math.abs(next - sc.scrollTop) > 1) sc.scrollTo({ top: next, behavior });
    }
  }
  // No Tile by Tile sem a tab, a tab só aparece por cima (Peek): a página não se mexe
  if (document.body.classList.contains('learn-tiles')) return;
  // A página: se mesmo assim o compasso não estiver na janela (painel fora do ecrã, ou telemóvel)
  if (top < vpTop || top + b.h > vpBot) window.scrollTo({ top: Math.max(0, scrollY + top - innerHeight / 3), behavior });
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
  setRange(barsRange(s.start, end - 1));
  api().isLooping = true; setPressed('loopBtn', true);
  renderChart();
  delay.clear();
  api().tickPosition = barTick(s.start);
  if (api().playerState !== PLAYING) api().play(); else setStatus('Playing');
}
/** Loop de um só compasso (o leitor vai para o início dele). */
function setLoopBar(i: number) {
  if (st.loopSection >= 0) { st.loopSection = -1; renderChart(); }
  st.loopBar = i;
  setRange({ startTick: barTick(i), endTick: barEndTick(i) });
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
  setRange(null);
  if (st.api && st.ready) st.api.isLooping = false;
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
  st.api.stop(); showStopped();
});
$('prevBtn').addEventListener('click', () => goBar((st.playingBar < 0 ? 0 : st.playingBar) - 1));
$('nextBtn').addEventListener('click', () => goBar((st.playingBar < 0 ? -1 : st.playingBar) + 1));
select('speed').addEventListener('change', () => {
  const v = +select('speed').value;
  select('bmSpeed').value = String(v); select('learnSpeed').value = String(v);
  if (st.api) st.api.playbackSpeed = v / 100;
  if (st.ready) setStatus(api().playerState === PLAYING ? 'Playing' : 'Paused');
});
$('loopBtn').addEventListener('click', () => {
  const v = toggle('loopBtn'); api().isLooping = v;
  if (!v && (st.loopSection >= 0 || st.loopBar >= 0)) { clearLoop(); renderChart(); if (st.tabSel >= 0) placeTabSel(); }
  setStatus(api().playerState === PLAYING ? 'Playing' : 'Paused');
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
  if (e.key === 'Escape' && !$('modePick').hidden) { e.preventDefault(); closeModePick(); return; }
  if (e.key === 'Escape' && !$('helpMenu').hidden) { openHelp(false); return; }
  if (e.key === 'Escape' && !$('settings').hidden) { openSettings(false); return; }
  if (e.key === 'Escape' && !$('library').hidden) { openLibrary(false); $('libraryBtn').focus(); return; }
  if (e.key === 'Escape' && modal.open) { closeBarModal(); return; }
  const t = e.target as HTMLElement;
  if (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  // Num botão ou numa ligação, o espaço é desse botão; as setas continuam a andar pelos compassos
  // (senão, depois de clicar em Play com o rato, as setas deixavam de funcionar).
  if (/^(BUTTON|A|SUMMARY)$/.test(t.tagName) && e.key === ' ') return;
  if (!st.ready) return;
  if (e.key === ' ' && !modal.open) { e.preventDefault(); if (learn.on) $('learnPlay').click(); else api().playPause(); }
  if (modal.open) {
    if (e.key === ' ') { e.preventDefault(); $('bmPlay').click(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); $('bmPrev').click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); $('bmNext').click(); }
    return;
  }
  if (e.key === 'ArrowLeft') { e.preventDefault(); $('prevBtn').click(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); $('nextBtn').click(); }
});

// Vista: no telemóvel/tablet Chart ou Tab; no computador também Both (lado a lado).
// No computador, o painel sozinho fica expandido e centrado.
let pendingScroll = false;
type View = 'chart' | 'tab' | 'both';
const wideMq = matchMedia('(min-width: 1101px)');
const views = { mobile: 'tab' as View, desk: 'both' as View };
function syncViewSwitch() {
  const v = wideMq.matches ? views.desk : views.mobile;
  for (const [id, k] of [['vChart', 'chart'], ['vTab', 'tab'], ['vBoth', 'both']] as const) $(id).setAttribute('aria-selected', String(v === k));
}
function setView(v: View) {
  const wide = wideMq.matches;
  if (wide) views.desk = v; else if (v !== 'both') views.mobile = v;
  document.body.dataset.view = views.mobile;
  document.body.dataset.desk = views.desk;
  syncViewSwitch();
  const cur = wide ? views.desk : views.mobile;
  // As ações do quadrado escolhido (barra de baixo) são do esquema: não ficam a tapar a tablatura.
  if (cur === 'tab') { $('barbar').hidden = true; document.querySelectorAll('.bar.sel').forEach(e => e.classList.remove('sel')); }
  // A tablatura mudou de largura (ou voltou a aparecer): redesenhar e voltar ao compasso atual.
  if (cur !== 'chart') { st.api?.render(); pendingScroll = true; }
}
$('vChart').addEventListener('click', () => setView('chart'));
$('vTab').addEventListener('click', () => setView('tab'));
$('vBoth').addEventListener('click', () => setView('both'));
wideMq.addEventListener('change', syncViewSwitch);
setView(wideMq.matches ? 'both' : 'tab');

// ---------- Ficheiros ----------
/** Maior ficheiro aceite (igual ao limite do armazenamento na nuvem). Um Guitar Pro tem quase sempre menos de 2 MB. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
function readFile(f: File | undefined) {
  if (!f) return;
  if (f.size > MAX_FILE_BYTES) { showErr('“' + f.name + '” is too large (' + (f.size / 1048576).toFixed(0) + ' MB). Guitar Pro and MusicXML files up to 20 MB are supported.'); return; }
  if (!f.size) { showErr('“' + f.name + '” is empty.'); return; }
  const r = new FileReader();
  r.onload = () => openImported(new Uint8Array(r.result as ArrayBuffer), f.name);
  r.readAsArrayBuffer(f);
}
// ---------- "My songs" (na conta; sem Supabase configurado, como em desenvolvimento, só em memória) ----------
const devSongs = new Map<string, SongMeta & { bytes: Uint8Array }>();
const lib = {
  list: (): Promise<SongMeta[]> => cloudEnabled
    ? (account ? listAccountSongs() : Promise.resolve([]))
    : Promise.resolve([...devSongs.values()].map(({ bytes: _b, ...m }) => m).sort((a, b) => b.openedAt - a.openedAt)),
  get: (id: string) => (cloudEnabled ? getAccountSong(id) : Promise.resolve(devSongs.get(id) ?? null)),
  add: (meta: Omit<SongMeta, 'addedAt' | 'openedAt'>, bytes: Uint8Array): Promise<void> => {
    if (cloudEnabled) return addAccountSong(meta, bytes);
    const now = Date.now(); devSongs.set(meta.id, { ...meta, bytes, addedAt: devSongs.get(meta.id)?.addedAt ?? now, openedAt: now });
    return Promise.resolve();
  },
  touch: (id: string): Promise<void> => {
    if (cloudEnabled) return touchAccountSong(id);
    const x = devSongs.get(id); if (x) x.openedAt = Date.now(); return Promise.resolve();
  },
  remove: async (id: string) => { if (cloudEnabled) await deleteAccountSong(id); else devSongs.delete(id); storage.forget(songDataKeys(id)); },
};

/** Abre um ficheiro importado e guarda-o em "My songs", na conta. */
function openImported(bytes: Uint8Array, name: string): Promise<boolean> {
  // Limite de músicas (por conta): sem conta nenhuma (só a de exemplo), Gratuito 3, Premium sem limite. Reabrir uma guardada é sempre possível.
  return lib.list().catch(() => [] as SongMeta[]).then(saved => {
    let id = '';
    try { const sc = parseScore(at, bytes); id = (sc.title || name) + '|' + (sc.artist || '') + '|' + sc.masterBars.length; } catch { /* loadBytes mostra o erro */ }
    if (id && !canSaveSong(plan, saved.map(x => x.id), id)) { songLimitReached(() => void openImported(bytes, name)); return false; }
    openTurn++; // um ficheiro escolhido agora ganha a qualquer música que ainda esteja a chegar da conta
    st.api?.stop(); clearLoop();
    if (!loadBytes(bytes, name, false)) return false;
    saveImported(bytes, name);
    openLibrary(false);
    offerLearn();
    return true;
  });
}
/** Ficheiro que um visitante tentou abrir: abre-se sozinho assim que entrar numa conta. */
let afterSignIn: (() => void) | null = null;
/** Acabou de se abrir (depois de entrar na conta) o ficheiro que a pessoa tinha escolhido. */
let openedAfterSignIn = false;
function songLimitReached(retry?: () => void) {
  if (plan.kind === 'guest') {
    afterSignIn = retry ?? null;
    openAuthDialog('signup', 'To load your own songs, create a free account: it keeps up to ' + FREE_SONG_LIMIT + ' songs, and you get 7 days of Premium with everything unlocked.');
  } else {
    toast('The free plan keeps ' + FREE_SONG_LIMIT + ' songs. Delete one in “My songs” or go Premium for unlimited songs.');
    openPaywall('library');
  }
}
/** Guarda a música na conta, para a abrir em qualquer dispositivo. */
function saveImported(bytes: Uint8Array, name: string) {
  const s = score(), id = st.fileKey;
  lib.add({ id, fileName: name, title: $('songTitle').textContent || name, artist: s.artist || '', bars: s.masterBars.length }, bytes)
    .then(() => { renderLibrary(); toast('Saved to “My songs”, in your account.'); })
    .catch(e => {
      if (e instanceof SongLimitError) songLimitReached();
      else toast('Couldn’t save the song in your account. Check your connection and load it again.');
    });
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
  let songs: SongMeta[] = [];
  try { songs = await lib.list(); } catch { setSyncStatus('Couldn’t reach your account. Check your connection.'); }
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
    open.addEventListener('click', () => openSaved(song.id, false, true));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'lib-del'; del.innerHTML = ICON_TRASH;
    del.setAttribute('aria-label', 'Delete ' + song.title);
    del.addEventListener('click', () => {
      // Confirmação no próprio item (sem janelas do browser)
      const c = document.createElement('span'); c.className = 'lib-confirm';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'danger'; yes.textContent = 'Delete';
      const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Cancel';
      yes.addEventListener('click', async () => {
        yes.disabled = true;
        const wasOpen = song.id === st.fileKey && !st.isSample;
        // A música aberta: o progresso por guardar não volta a ser escrito depois de apagada
        if (wasOpen) { st.api?.pause(); practice.dirty = false; }
        try { await lib.remove(song.id); toast('“' + song.title + '” deleted from your account.'); }
        catch { toast('Couldn’t delete it. Check your connection and try again.'); renderLibrary(); return; }
        // Apagou a que estava aberta: abre a seguinte da conta (ou a de exemplo), para não ficar no ecrã uma
        // música que já não existe (e cujas alterações voltariam a ser guardadas).
        if (wasOpen) {
          const rest = await lib.list().catch(() => [] as SongMeta[]);
          if (rest[0]) await openSaved(rest[0].id, true); else await openSample();
        }
        renderLibrary();
      });
      no.addEventListener('click', () => renderLibrary());
      c.append(yes, no); del.replaceWith(c); no.focus();
    });
    li.classList.toggle('cur', cur);
    li.append(open, del); list.append(li);
  }
}
/**
 * Abre uma música da conta. `keepLibrary`: não fecha "My songs" (ao abrir a seguinte depois de apagar uma).
 * `ask`: foi a pessoa que a escolheu, por isso pergunta-se como a quer tocar (Tile by Tile ou só a tab).
 */
async function openSaved(id: string, keepLibrary = false, ask = false) {
  const turn = ++openTurn;
  let song: Awaited<ReturnType<typeof lib.get>> = null;
  try { song = await lib.get(id); } catch { toast('Couldn’t open the song. Check your connection and try again.'); return; }
  if (turn !== openTurn) return; // entretanto pediu-se outra música: essa é que fica
  if (!song) { toast('That song isn’t in your account any more.'); renderLibrary(); return; }
  st.api?.stop(); clearLoop();
  if (loadBytes(song.bytes, song.fileName, false)) { lib.touch(id).catch(() => {}); if (!keepLibrary) openLibrary(false); if (ask) offerLearn(); }
}
/** Conta os pedidos de abrir uma música: se chegarem fora de ordem (rede), só o último pedido conta. */
let openTurn = 0;
function openSample() {
  const turn = ++openTurn;
  return fetch(base + 'sample.gp5')
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then(b => { if (turn !== openTurn) return; st.api?.stop(); clearLoop(); loadBytes(new Uint8Array(b), 'Sample', true); })
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

// ---------- Conta ----------
// Tudo o que é da pessoa fica na conta: "My songs" e os dados (notas, secções, progresso, preferências).
// O browser não guarda nada além da sessão de login.
let account: Account | null = null;
function setSyncStatus(t: string) { $('syncStatus').textContent = t; }
/** "My songs" diz sempre o mesmo: com conta, na conta; sem conta, só a música de exemplo. */
function updateSyncRow() {
  $('libSync').hidden = !account;
  $('libLocalHint').parentElement!.hidden = !!account;
  $('libLocalHint').textContent = 'Without an account you can try the sample song. Create a free account to load your own.';
}
function plural(n: number, w: string) { return n + ' ' + w + (n === 1 ? '' : 's'); }

/** Preferências guardadas na conta: tema, atraso do áudio, compassos por linha na tab, som do metrónomo. */
function applyPrefs() {
  const theme = savedTheme();
  if (theme !== currentTheme() || !theme) setTheme(theme ?? 'dark', false);
  setSync(storage.get<number>('mapa:sync') ?? 0, false);
  const rows = storage.get<number>('mapa:tabPerRow');
  const next = typeof rows === 'number' && rows >= 0 && rows <= 6 ? Math.round(rows) : 0;
  if (next !== tabPerRow) { tabPerRow = next; select('tabPerRow').value = String(next); if (st.score) renderTab(); }
  const snd = storage.get<string>('mapa:metroSound');
  if (isMetroSound(snd) && snd !== metro.sound) { select('metroSound').value = snd; select('metroSound').dispatchEvent(new Event('change')); }
}

/**
 * Versões antigas guardavam as músicas e os dados neste browser: passam para a conta (uma vez) e
 * apagam-se do browser. No plano Gratuito passam as 3 mais recentes.
 */
async function migrateLegacy() {
  const [songs, data] = [await readLegacySongs().catch(() => []), readLegacyData()];
  if (!songs.length && !Object.keys(data).length) return;
  for (const [k, v] of Object.entries(data)) if (storage.get(k) === null) storage.set(k, v);
  await flush();
  let moved = 0, left = 0, failed = false;
  for (const sg of songs) {
    if (left) { left++; continue; }
    try { await addAccountSong(sg, sg.bytes); moved++; }
    catch (e) { if (e instanceof SongLimitError) left++; else { failed = true; break; } }
  }
  if (failed) return; // sem rede: fica tudo como estava e tenta-se na próxima vez
  await wipeLegacy();
  if (moved || left) toast((moved ? plural(moved, 'song') + ' moved to your account.' : '') + (left ? ' The free plan keeps ' + FREE_SONG_LIMIT + '; ' + plural(left, 'older song') + ' wasn’t moved.' : ''));
}

/**
 * Liga a conta: carrega os dados dela, passa o que estava no browser e aplica as preferências.
 * Sem rede, os dados ficam por ler: nada é enviado até se conseguir (enviar já escreveria por cima do que está
 * na conta, por exemplo o tema por defeito por cima do escolhido) e volta-se a tentar sozinho.
 */
async function connectAccount() {
  const failed = () => setSyncStatus('Couldn’t save your changes to your account yet. ChordTile will try again automatically.');
  let data: Record<string, unknown> | null = null;
  try { data = await loadUserData(); } catch { setSyncStatus('Couldn’t reach your account. Check your connection.'); }
  attachAccount(data, saveUserData, failed);
  if (!data) { retryPull(); return; }
  pulledAt = Date.now();
  await migrateLegacy().catch(() => {});
  applyPrefs();
}
/** Quando se leram os dados da conta pela última vez. */
let pulledAt = 0;
let pulling = false;
let pullTimer: ReturnType<typeof setTimeout> | undefined;
function retryPull(ms = 5000) {
  clearTimeout(pullTimer);
  pullTimer = setTimeout(() => void pullAccount().then(ok => { if (!ok && account) retryPull(Math.min(ms * 2, 60000)); }), ms);
}
/**
 * Volta a ler os dados da conta e aplica o que mudou noutro dispositivo (ou noutro separador): notas, secções,
 * instrumento, progresso, passo do Tile by Tile e preferências. O que foi alterado aqui e ainda não seguiu
 * é enviado primeiro e nunca é substituído.
 */
async function pullAccount(): Promise<boolean> {
  if (!account || pulling) return false;
  pulling = true;
  const who = account.id, first = !isHydrated();
  try {
    await flush();
    const data = await loadUserData();
    if (account?.id !== who) return false;
    const changed = mergeRemote(data);
    pulledAt = Date.now(); clearTimeout(pullTimer); setSyncStatus('');
    if (first) {
      await migrateLegacy().catch(() => {}); applyPrefs();
      // A página abriu sem rede e ficou na música de exemplo: agora abre a última da conta
      renderLibrary();
      if (st.isSample) { const songs = await lib.list().catch(() => [] as SongMeta[]); if (songs[0] && st.isSample) void openSaved(songs[0].id); }
    }
    applyRemote(changed, first);
    return true;
  } catch { return false; }
  finally { pulling = false; }
}
const PREF_KEYS = ['mapa:theme', 'mapa:sync', 'mapa:tabPerRow', 'mapa:metroSound'];
function applyRemote(changed: string[], first: boolean) {
  if (!changed.length) return;
  if (!first && changed.some(k => PREF_KEYS.includes(k))) applyPrefs();
  if (changed.includes('mapa:learnCtaFolded')) setCtaFolded(storage.get<boolean>('mapa:learnCtaFolded') === true);
  if (!st.score || !st.fileKey) return;
  // A música aberta. Não se mexe no ecrã a meio de uma coisa: Tile by Tile, compasso expandido ou a escrever.
  const busy = learn.on || modal.open || !!(document.activeElement as HTMLElement | null)?.isContentEditable;
  if (changed.includes('mapa:progress:' + st.fileKey) && !practice.dirty) {
    practice.progress = storage.get<SongProgress>('mapa:progress:' + st.fileKey) ?? {}; renderProgress();
  }
  if (changed.includes('mapa:' + st.fileKey) && !busy) {
    const playing = st.api?.playerState === PLAYING, track = st.viewTrack;
    const before = JSON.stringify(st.sections.map(x => x.start));
    restoreSong(storage.get<SavedSong>('mapa:' + st.fileKey), playing); // a tocar, o instrumento não muda
    if (JSON.stringify(st.sections.map(x => x.start)) !== before && (st.loopSection >= 0 || st.loopBar >= 0)) clearLoop();
    renderTrackControls(); detect(); renderChart();
    if (st.viewTrack !== track) renderTab();
    if (st.selBar >= 0) selectBar(st.selBar);
  }
  if ((changed.includes('mapa:learn:' + st.fileKey) || changed.includes('mapa:' + st.fileKey)) && !learn.on) updateLearnCta();
}
/** A página vai fechar (ou ficar em segundo plano): o que ainda não seguiu vai já, num pedido que o browser acaba mesmo depois de ela fechar. */
function saveOnExit() {
  flushProgress();
  flushOnExit(saveUserDataOnExit);
}

let firstAccount!: () => void;
/** Fica pronta depois de se saber se há sessão (e, havendo, de carregar os dados da conta). */
const accountReady = new Promise<void>(r => { firstAccount = r; });
let connected = false;
function showAccount(a: Account | null) {
  const was = account?.id; account = a;
  // Com sessão: a inicial num círculo e o primeiro nome (no telemóvel só a inicial); sem sessão: "Sign in"
  const first = a ? (a.name.split(/\s+/)[0] || a.email.split('@')[0]) : '';
  $('accountBtnText').textContent = a ? first : 'Sign in';
  $('accountAvatar').textContent = first.charAt(0).toUpperCase();
  $('accountAvatar').hidden = !a;
  $('accountBtn').classList.toggle('signed', !!a);
  $('accountBtn').setAttribute('aria-label', a ? 'Your account (' + a.email + ')' : 'Sign in or create an account');
  $('accountBtn').title = a ? 'Your account · ' + a.email : 'Sign in or create an account';
  $('pwTrial').hidden = !!a;
  updateSyncRow(); applyLocks();
  if (!a) {
    clearTimeout(pullTimer); practice.dirty = false;
    detachAccount(); setPlan(GUEST);
    if (was) { renderLibrary(); if (!st.isSample) openSample(); } // saiu: nada fica no ecrã nem no browser
    if (!connected) { connected = true; firstAccount(); }
    return;
  }
  if (a.id === was) return;
  const signingIn = connected; // entrou agora (e não ao abrir a página)
  void connectAccount().then(() => refreshPlan()).then(async () => {
    if (!connected) { connected = true; firstAccount(); return; }
    renderLibrary();
    // Entrou com a música de exemplo aberta: abre a última da conta. (Não, se entrou para carregar um ficheiro:
    // esse já está a abrir, e a música da conta chegava depois e ficava por cima dele.)
    const importing = openedAfterSignIn; openedAfterSignIn = false;
    if (signingIn && st.isSample && !importing) { const songs = await lib.list().catch(() => [] as SongMeta[]); if (songs[0] && st.isSample) openSaved(songs[0].id); }
  });
}
if (cloudEnabled) {
  watchAccount(showAccount).catch(() => { connected = true; firstAccount(); });
  // Ao voltar ao separador: o plano pode ter mudado (pagamento) e as músicas podem ter mudado noutro dispositivo
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { saveOnExit(); return; }
    if (!account) return;
    refreshPlan(); if (!$('library').hidden) renderLibrary();
    // …e as notas, secções e progresso também: lê-os outra vez (no máximo de 10 em 10 s)
    if (Date.now() - pulledAt > 10000) void pullAccount();
  });
  addEventListener('pagehide', saveOnExit);
  addEventListener('online', () => { if (account) void pullAccount(); });
} else queueMicrotask(() => { connected = true; firstAccount(); });
const welcome = () => toast('You’re signed in. Welcome!');
$('accountBtn').addEventListener('click', () => { if (account) location.href = '/account'; else openAuthDialog('signin', undefined, welcome); });
// Sem Supabase configurado (por exemplo em desenvolvimento) não há contas: tudo fica desbloqueado (e nada se guarda)
if (!cloudEnabled) { $('accountBtn').hidden = true; queueMicrotask(() => setPlan({ kind: 'lifetime', premium: true, until: null })); }

// ---------- Cadeados (sem conta / conta grátis / Premium) ----------
const GATE_NAMES: Record<Feature, string> = {
  tools: 'Speed, the metronome and the count-in', notes: 'Notes on the bars', loop: 'Loop', playalong: 'Play along',
  solo: 'Solo', learn: 'Tile by Tile', expand: 'Expanding a bar', pdf: 'The PDF chart', progress: 'Progress per section',
  sync: 'Keeping songs in your account',
};
/** Pode usar a função? Se não, pede conta (sem conta) ou mostra o Premium (conta grátis). */
function gateOk(f: Feature): boolean {
  const a = access(plan, f);
  if (a === 'ok') return true;
  if (a === 'account') {
    const premiumOnly = access({ kind: 'free', premium: false, until: null }, f) === 'premium';
    openAuthDialog('signup', GATE_NAMES[f] + (premiumOnly ? ' is Premium: create a free account to try it for 7 days.' : ' need a free account.'), welcome);
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
  select('learnSpeed').disabled = select('speed').disabled;
}

// ---------- Plano (Free / Premium) ----------
let plan: PlanState = GUEST;
function setPlan(p: PlanState) {
  const was = plan.premium; plan = p;
  if (p.kind !== 'guest' && afterSignIn) { const go = afterSignIn; afterSignIn = null; openedAfterSignIn = true; queueMicrotask(go); }
  const btn = $('premiumBtn');
  btn.classList.toggle('on', p.premium);
  $('setPremiumText').textContent = p.premium ? planLabel(p) : 'Go Premium';
  $('setPremiumSub').textContent = p.premium ? 'All features unlocked. Thank you!' : 'Try 7 days free: loop, Tile by Tile, every bar up close and more';
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
  const lim = songLimit(plan);
  if (plan.kind === 'guest') el.append('Without an account you can only try the sample song.');
  else el.append('Free plan: ' + Math.min(count, lim) + ' of ' + lim + ' song' + (lim === 1 ? '' : 's') + (count >= lim ? '. Delete one to load another.' : '.'));
  const b = document.createElement('button'); b.type = 'button'; b.className = 'linkbtn';
  b.textContent = plan.kind === 'guest' ? 'Create free account' : 'Go Premium';
  b.addEventListener('click', () => (plan.kind === 'guest' ? openAuthDialog('signup', undefined, welcome) : openPaywall('library')));
  el.append(' ', b);
}

// ---------- Janela do Premium ----------
type PaywallReason = 'upgrade' | 'library' | 'sync' | 'progress' | 'expand' | 'pdf' | 'loop' | 'playalong' | 'solo' | 'learn';
const PAYWALL_COPY: Record<PaywallReason, [string, string]> = {
  upgrade: ['Practise like you mean it', 'Premium unlocks loop, Tile by Tile, play along, solo, every bar up close, PDF charts and unlimited songs.'],
  loop: ['Loop the hard part', 'Premium loops the whole song, a section or a single bar, as many times as you need.'],
  learn: ['Learn songs without the tab', 'Tile by Tile is Premium: learn each section with the tab, play it without, then join it to the ones before, until you play the whole song with no tab.'],
  playalong: ['Play along with the band', 'Premium mutes your instrument so you play your part with the rest of the band.'],
  solo: ['Hear only your part', 'Premium plays your instrument alone, so you can hear exactly what to play.'],
  library: ['Keep all your songs', 'The free plan keeps ' + FREE_SONG_LIMIT + ' songs in your account. Premium keeps as many as you like.'],
  expand: ['See every bar up close', 'Expand any bar to see its notes large, how to count them, and practise it on its own.'],
  pdf: ['Take the chart to rehearsal', 'Premium exports the song chart as a clean PDF, with your notes.'],
  sync: ['Your songs on every device', 'Your songs are kept in your account, on your phone, tablet and computer.'],
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
      if (plan.premium && plan.kind !== 'trial') { toast('Premium is on. Enjoy!'); renderLibrary(); }
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
  // Fim de uma volta: o leitor voltou atrás no loop (no Tile by Tile o loop pode juntar várias secções)
  // (No Tile by Tile o trecho não fica em loop: cada volta acaba em playerFinished, ver learnRunEnded.)
  const looping = !learn.on && (st.loopSection >= 0 || st.loopBar >= 0);
  const wrapped = looping && practice.lastTick >= 0 && tick < practice.lastTick;
  practice.lastTick = tick;
  if (st.isSample) return;
  const k = secOf(bar), start = st.sections[k]?.start ?? 0;
  if (practice.lastAt) { practice.progress = addTime(practice.progress, start, now - practice.lastAt, Date.now()); practice.dirty = true; }
  practice.lastAt = now;
  if (wrapped) onLoopDone();
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
if (!cloudEnabled) addEventListener('pagehide', flushProgress); // (com conta: saveOnExit, que também envia)

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
    card.style.transform = `translate(${(innerWidth - cw) / 2}px, ${Math.max(m, (innerHeight - ch) / 2)}px)`;
    return;
  }
  const r = target.getBoundingClientRect(), pad = 6;
  spot.className = 'tour-spot';
  // Posição por transform (e não left/top): mexer no destaque não conta como "salto" do layout (CLS)
  Object.assign(spot.style, { transform: `translate(${r.left - pad}px, ${r.top - pad}px)`, width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
  const below = r.bottom + pad + m, above = r.top - pad - m - ch;
  let top = below + ch <= innerHeight - m ? below : above >= m ? above : Math.max(m, innerHeight - ch - m);
  // Destinos muito altos (o esquema, o leitor): cartão por cima do centro do destino
  if (r.height > innerHeight * 0.6) top = Math.max(m, Math.min(innerHeight - ch - m, r.top + 40));
  const left = Math.max(m, Math.min(innerWidth - cw - m, r.left + r.width / 2 - cw / 2));
  card.style.transform = `translate(${left}px, ${top}px)`;
}
$('tourNext').addEventListener('click', () => {
  if (tour.i === TOUR_STEPS.length - 1) { endTour(); return; }
  tour.i++; showTourStep();
});
$('tourPrev').addEventListener('click', () => { if (tour.i > 0) { tour.i--; showTourStep(); } });
$('tourSkip').addEventListener('click', endTour);
addEventListener('resize', () => { if (tour.open) placeTour(visibleTarget(TOUR_STEPS[tour.i])); });


// ---------- Tile by Tile: aprender a música de cor, secção a secção ----------
// O percurso (learn-path.ts): para cada secção, aprende-se com a tab (só a dessa secção, em loop), depois toca-se
// de cor (só os quadrados) e, a partir da 2.ª, junta-se a tudo o que já se sabe (1 → 2, 1 → 3…) até à música toda.
// Cada volta do loop conta; espreitar a tab ("Peek") faz com que essa volta não conte. O passo fica guardado por música.
const LEARN_NAME = 'Tile by Tile';
const learn = {
  on: false, step: 0, runs: 0, peeked: false, peeking: false, lit: -1,
  /** Até quantas voltas se toca antes de parar (o objetivo do passo, ou mais depois de "Repeat"). */
  target: 0,
  /** A contagem antes de uma volta (temporizadores), ou null. */
  counting: null as number[] | null,
};
const learnKey = () => 'mapa:learn:' + st.fileKey;
const learnSteps = () => buildSteps(st.sections.length);
const secBars = () => st.sections.map((s, k) => secEnd(k) - s.start);
/** "Intro → Verse", ou "Intro → … → Chorus" quando são muitas. */
function joinName(from: number, to: number) {
  const names = st.sections.slice(from, to + 1).map(s => s.name);
  return names.length > 3 ? names[0] + ' → … → ' + names[names.length - 1] : names.join(' → ');
}
function stepLabel(steps: LearnStep[], j: number) {
  const s = steps[j];
  if (isFinal(steps, j) && s.kind !== 'learn') return 'The whole song, no tab';
  if (s.kind === 'learn') return st.sections[s.sec].name + ' with the tab';
  if (s.kind === 'recall') return st.sections[s.sec].name + ' without the tab';
  return joinName(s.from, s.to) + ', no tab';
}
function setLearnStyle(css: string) {
  let el = document.getElementById('learnStyle');
  if (!el) { el = document.createElement('style'); el.id = 'learnStyle'; document.head.append(el); }
  el.textContent = css;
}
/** A tablatura só com os compassos das secções from…to (null = a música toda). */
function setTabRange(from: number | null, to: number | null = from, draw = true) {
  const a = st.api; if (!a) return;
  const d = a.settings.display;
  const start = from === null ? 1 : st.sections[from].start + 1;
  const count = from === null || to === null ? -1 : secEnd(to) - st.sections[from].start;
  if (d.startBar === start && d.barCount === count) return;
  d.startBar = start; d.barCount = count;
  a.updateSettings(); if (draw) a.render();
}
/**
 * O trecho das secções from…to, pronto a tocar (sem começar sozinho). Não fica em loop no leitor: cada volta
 * acaba e pára (playerFinished), e a seguinte só começa depois da contagem no meio do ecrã.
 */
function setLearnLoop(from: number, to: number) {
  if (!st.ready) return;
  if (api().playerState === PLAYING) api().pause();
  st.loopSection = from === to ? from : -1; st.loopBar = -1; practice.lastTick = -1;
  const s = st.sections[from];
  setRange(barsRange(s.start, secEnd(to) - 1));
  api().isLooping = false; setPressed('loopBtn', true);
  renderChart();
  delay.clear();
  api().tickPosition = barTick(s.start);
  st.playingBar = s.start; markPlaying(s.start, false); updateNow(s.start, 0);
}

function enterLearn() {
  if (!st.score || !gateOk('learn')) return;
  learn.on = true;
  learn.step = restoreStep(storage.get<SavedLearn>(learnKey()), learnSteps(), st.sections.length);
  closeBarModal(); openLibrary(false); openSettings(false, false); $('barbar').hidden = true;
  history.replaceState(null, '', location.pathname + '?learn' + location.hash);
  showLearnStep(); applyMetronome();
  scrollTo({ top: 0 });
  // Na primeira vez, explica o método antes de começar
  if (!storage.get<boolean>('mapa:learnIntroSeen')) openLearnIntro(true);
}
/** `redraw` false: a tablatura vai ser desenhada a seguir com outra música (dois desenhos seguidos atropelavam-se). */
function exitLearn(redraw = true) {
  if (!learn.on) return;
  setPeek(false); closeLearnIntro(); setLearnMore(false); cancelLearnCount(); hideLearnDone();
  learn.on = false;
  document.body.classList.remove('learning', 'learn-tab', 'learn-tiles', 'learn-final');
  $('learnPanel').hidden = true; setLearnStyle('');
  if (st.api && api().playerState === PLAYING) api().pause();
  // A tablatura volta a ter a música toda: ao acabar de a desenhar, mostra o compasso onde se ficou
  pendingScroll = true;
  setTabRange(null, null, redraw); clearLoop(); renderChart(); updateLearnCta(); applyMetronome();
  history.replaceState(null, '', location.pathname + location.hash);
}

function goLearnStep(i: number) { learn.step = i; showLearnStep(); scrollTo({ top: 0, behavior: 'smooth' }); }
const learnGoalMet = (steps: LearnStep[]) => learn.runs >= runsGoal(steps, learn.step);

/**
 * O percurso: uma etiqueta por secção da música, por ordem. "✓" as que já se tocam sem a tab, cheia a de agora
 * (num passo de juntar, todas as que se tocam seguidas), as outras por fazer. Clicar salta para essa secção.
 */
function renderLearnPath(steps: LearnStep[], i: number) {
  const track = $('learnTrack'); track.innerHTML = '';
  const cur = steps[i], met = learnGoalMet(steps);
  const known = knownSections(steps, i, cur?.kind === 'recall' && met);
  const [from, to] = cur ? stepRange(cur) : [-1, -1];
  const here = cur ? stepSection(cur) : -1;
  st.sections.forEach((sec, k) => {
    const li = document.createElement('li');
    li.className = 'lp-item' + (known[k] ? ' known' : '') + (k >= from && k <= to ? ' now' : '') + (k === learn.lit ? ' lit' : '');
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = sec.name;
    b.title = sec.name + (known[k] ? ': you can play it with no tab' : k === here ? ': learning now' : ': go to this section');
    b.setAttribute('aria-label', sec.name + (known[k] ? ', no tab' : k === here ? ', learning now' : ''));
    if (k === here) b.setAttribute('aria-current', 'step');
    b.addEventListener('click', () => { if (k !== here) goLearnStep(firstStepOf(steps, k)); });
    li.append(b); track.append(li);
  });
  $('learnPct').textContent = byHeartPct(known, secBars()) + '%';
  learn.lit = -1;
  track.querySelector<HTMLElement>('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/** Nome curto de um passo dentro da sua secção (para a linha de passos). */
function stepShort(steps: LearnStep[], j: number) {
  const s = steps[j];
  if (s.kind === 'learn') return 'With the tab';
  if (s.kind === 'recall') return 'Without the tab';
  if (isFinal(steps, j)) return 'The whole song';
  return s.to - s.from === 1 ? 'Join it to ' + st.sections[s.from].name : 'Join it to the sections before';
}
/** Os passos da secção de agora: ✓ feito · o de agora destacado · os que faltam. */
function renderLearnSteps(steps: LearnStep[], i: number) {
  const list = $('learnSteps'); list.innerHTML = '';
  const here = stepSection(steps[i]), met = learnGoalMet(steps);
  let n = 0;
  steps.forEach((s, j) => {
    if (stepSection(s) !== here) return;
    n++;
    const done = j < i || (j === i && met);
    const li = document.createElement('li');
    li.className = done ? 'done' : j === i ? 'now' : '';
    if (j === i) li.setAttribute('aria-current', 'step');
    const num = document.createElement('b'); num.setAttribute('aria-hidden', 'true'); num.textContent = done ? '✓' : String(n);
    const lab = document.createElement('span'); lab.textContent = stepShort(steps, j);
    li.append(num, lab);
    if (done) li.setAttribute('aria-label', lab.textContent + ', done');
    list.append(li);
  });
}

/** As voltas deste passo: ●●○ "2 of 3". Com as voltas todas feitas, o botão do passo seguinte acende-se. */
function renderRuns() {
  const steps = learnSteps(), step = steps[learn.step];
  if (!step) return;
  const goal = runsGoal(steps, learn.step), done = Math.min(learn.runs, goal), met = done >= goal;
  const el = $('learnRuns'); el.innerHTML = '';
  el.classList.toggle('met', met);
  const pips = document.createElement('span'); pips.className = 'lr-pips'; pips.setAttribute('aria-hidden', 'true');
  for (let j = 0; j < goal; j++) { const p = document.createElement('i'); if (j < done) { p.className = 'on'; p.textContent = '✓'; } pips.append(p); }
  const cnt = document.createElement('strong'); cnt.className = 'lr-count';
  cnt.textContent = met ? (learn.runs > goal ? 'Done · ' + learn.runs + ' runs' : 'Done!') : done + ' of ' + goal;
  el.append(pips, cnt);
  el.setAttribute('aria-label', (goal === 1 ? 'Run' : 'Runs') + ': ' + cnt.textContent);
  $('learnNext').classList.toggle('ready', met);
  const left = goal - done;
  $('learnNextKicker').textContent = met ? (isFinal(steps, learn.step) ? 'You did it!' : 'Nailed it · next step')
    : 'Next, after ' + left + ' more run' + (left === 1 ? '' : 's');
  renderLearnSteps(steps, learn.step);
}

/** Fim de uma volta (chamado pelo leitor). Devolve a mensagem de parabéns quando a volta completa o passo. */
function learnLoopDone(): string {
  const steps = learnSteps(), i = learn.step, step = steps[i];
  if (!step) return '';
  const peeked = learn.peeked;
  learn.peeked = learn.peeking; // quem ainda está a espreitar já estraga a volta seguinte
  if (step.kind !== 'learn' && peeked) { toast('You peeked at the tab, so that run doesn’t count. Go again!'); return ''; }
  const goal = runsGoal(steps, i), before = learn.runs;
  learn.runs++;
  let msg = '';
  if (before < goal && learn.runs >= goal) {
    const sec = st.sections[stepSection(step)];
    if (step.kind === 'recall') {
      learn.lit = step.sec;
      const pct = byHeartPct(knownSections(steps, i, true), secBars());
      msg = '“' + sec.name + '” is yours, no tab needed! ' + pct + '% of the song with no tab.';
    } else if (isFinal(steps, i)) msg = 'The whole song, no tab. Amazing!';
    else if (step.kind === 'join') msg = joinName(step.from, step.to) + ' in a row, no tab. Great!';
    else msg = 'You’ve got “' + sec.name + '” with the tab. Now try it without.';
    renderLearnPath(steps, i);
  } else if (learn.runs < learn.target) toast(learn.runs < goal ? 'Run ' + learn.runs + ' of ' + goal + '. Keep going!' : 'Another clean run!');
  renderRuns();
  return msg;
}

/**
 * Contagem antes de cada volta: um compasso de tempos, ao andamento (e à velocidade) do início do trecho,
 * em números grandes no meio do ecrã e com o som do metrónomo. Depois toca o trecho desde onde está.
 */
function learnCountIn() {
  const steps = learnSteps(), step = steps[learn.step];
  if (!step || !st.ready || learn.counting) return;
  hideLearnDone();
  const [from, to] = stepRange(step);
  const { startTick, endTick } = barsRange(st.sections[from].start, secEnd(to) - 1);
  // O trecho do passo tem de estar no leitor (por segurança: sem ele a volta não acabava no fim da secção)
  const cur = api().playbackRange;
  if (!cur || cur.startTick !== startTick || cur.endTick !== endTick) { const pos = api().tickPosition; setRange({ startTick, endTick }); if (pos > startTick && pos < endTick) api().tickPosition = pos; }
  api().isLooping = false;
  // Volta nova (ou acabada): do início do trecho. Pausada a meio: continua de onde estava.
  const pos = api().tickPosition;
  if (pos <= startTick || pos >= endTick - 1) api().tickPosition = startTick;
  const src = gridSource();
  const { bpm, numerator, denominator } = src ? stateAt(src.events, startTick) : { bpm: score().tempo || 120, numerator: 4, denominator: 4 };
  const beats = Math.max(1, Math.min(12, numerator));
  const beatSec = (60 / Math.max(20, bpm)) * (4 / denominator) / (api().playbackSpeed || 1);
  const sound: MetroSound = metro.sound === 'click' ? 'wood' : metro.sound;
  clicker.ensure();
  const lead = 0.12, t0 = clicker.now() + lead;
  const goal = runsGoal(steps, learn.step), run = learn.runs + 1;
  $('loCountLab').textContent = goal === 1 ? 'Get ready' : run <= goal ? 'Run ' + run + ' of ' + goal : 'Run ' + run;
  $('loNum').textContent = '';
  $('learnOverlay').hidden = false; $('loCount').hidden = false;
  const timers: number[] = [];
  for (let b = 0; b < beats; b++) {
    clicker.tick(sound, b, t0 + b * beatSec, beatSec);
    timers.push(window.setTimeout(() => {
      const n = $('loNum'); n.textContent = String(b + 1);
      n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop');
    }, (lead + b * beatSec) * 1000));
  }
  timers.push(window.setTimeout(() => {
    learn.counting = null; $('loCount').hidden = true; $('learnOverlay').hidden = true;
    practice.lastTick = -1;
    api().play();
  }, (lead + beats * beatSec) * 1000));
  learn.counting = timers;
  syncLearnPlay();
}
function cancelLearnCount() {
  if (!learn.counting) return;
  learn.counting.forEach(t => clearTimeout(t)); learn.counting = null;
  $('loCount').hidden = true; if ($('loDone').hidden) $('learnOverlay').hidden = true;
  syncLearnPlay();
}

/** Acabou uma volta: conta-a; se ainda faltam voltas vem a contagem, senão pára e pergunta: repetir ou avançar. */
function learnRunEnded() {
  if (!st.isSample) onLoopDone();
  const msg = learnLoopDone();
  if (learn.runs >= learn.target) showLearnDone(msg);
  else learnCountIn();
}
function showLearnDone(msg: string) {
  const steps = learnSteps(), i = learn.step, final = isFinal(steps, i), goal = runsGoal(steps, i);
  $('loTitle').textContent = msg || (final ? 'The whole song, no tab. Amazing!' : 'Done! ' + learn.runs + ' runs.');
  $('loText').textContent = final ? 'You played the whole song with no tab.' : 'Up next: ' + stepLabel(steps, i + 1) + '.';
  $('loRepeat').textContent = goal === 1 ? 'Play it again' : 'Repeat ' + goal + ' more times';
  $('loNextLabel').textContent = final ? 'Finish Tile by Tile' : 'Next step';
  $('learnOverlay').hidden = false; $('loDone').hidden = false; $('loCount').hidden = true;
  $('loNext').focus();
}
function hideLearnDone() {
  $('loDone').hidden = true; if (!learn.counting) $('learnOverlay').hidden = true;
}
$('loRepeat').addEventListener('click', () => {
  learn.target = learn.runs + runsGoal(learnSteps(), learn.step);
  hideLearnDone(); learnCountIn();
});
$('loNext').addEventListener('click', () => { hideLearnDone(); $('learnNext').click(); });

/** Espreitar a tab (enquanto se carrega no botão) nos passos sem a tab. */
function setPeek(on: boolean) {
  if (learn.peeking === on) return;
  learn.peeking = on;
  if (on) learn.peeked = true;
  document.body.classList.toggle('peeking', on);
  $('learnPeek').setAttribute('aria-pressed', String(on));
  if (on && st.playingBar >= 0) requestAnimationFrame(() => scrollTabToBar(st.playingBar, false));
}

function showLearnStep() {
  const steps = learnSteps();
  const i = (learn.step = Math.max(0, Math.min(learn.step, steps.length - 1)));
  const step = steps[i], final = isFinal(steps, i), goal = runsGoal(steps, i);
  storage.set(learnKey(), { v: 2, step: i } satisfies SavedLearn);
  learn.runs = 0; learn.target = goal; learn.peeked = false; setPeek(false);
  cancelLearnCount(); hideLearnDone();
  const b = document.body, noTab = step.kind !== 'learn';
  b.classList.add('learning');
  b.classList.toggle('learn-tab', !noTab);
  b.classList.toggle('learn-tiles', noTab);
  b.classList.toggle('learn-final', final);
  $('learnPanel').hidden = false;
  $('learnName').textContent = LEARN_NAME;
  renderLearnPath(steps, i);
  $<HTMLButtonElement>('learnBack').disabled = i === 0;
  const [from, to] = stepRange(step);
  const name = step.kind === 'join' ? joinName(from, to) : st.sections[from].name;
  const times = goal === 1 ? 'once' : goal === 2 ? 'twice' : goal + ' times';
  if (final) {
    $('learnTitle').textContent = 'The whole song: play it once, start to finish, with no tab.';
    $('learnText').textContent = 'One clean run without peeking and the song is yours.';
  } else if (step.kind === 'learn') {
    $('learnTitle').textContent = name + ': play it ' + times + ' with the tab.';
    $('learnText').textContent = 'Follow the tab and play along. Each run starts with a count-in and stops at the end. Slow it down with the speed if you need to.';
  } else if (step.kind === 'recall') {
    $('learnTitle').textContent = name + ': play it ' + times + ' without looking at the tab.';
    $('learnText').innerHTML = 'The tab is hidden: play from the chord tiles. Stuck? Hold <strong>Peek</strong> to see the tab, but that run won’t count. Double-tap a tile to write a reminder (“slide”, “x2”).';
  } else {
    $('learnTitle').textContent = name + ': play ' + (to - from === 1 ? 'both' : 'them') + ' ' + times + ' in a row, no tab.';
    $('learnText').textContent = 'Don’t stop between sections: the changes are where it usually breaks.';
  }
  $('learnNextLabel').textContent = final ? 'Finish Tile by Tile' : stepLabel(steps, i + 1);
  const shown = st.sections.map((_, k) => k).filter(k => k >= from && k <= to).map(k => ':not([data-sec="' + k + '"])').join('');
  setLearnStyle(noTab ? '.chart .section' + shown + ' { display: none; }' : '');
  setTabRange(from, to);
  setLearnLoop(from, to);
  renderRuns();
  syncLearnPlay();
}
function syncLearnPlay() {
  if (!learn.on) return;
  const playing = !!st.api && st.ready && api().playerState === PLAYING;
  const final = isFinal(learnSteps(), learn.step);
  const busy = playing || !!learn.counting;
  $('learnPlay').querySelector('span')!.textContent = learn.counting ? 'Cancel' : playing ? 'Pause' : final ? 'Play the whole song' : 'Play';
  $('learnPlay').querySelector('svg')!.innerHTML = busy ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
}
// Os botões do leitor no painel são atalhos para os da barra de baixo (que fica escondida enquanto se aprende)
document.querySelectorAll<HTMLButtonElement>('.learn-tools [data-for]').forEach(b => {
  const orig = $<HTMLButtonElement>(b.dataset.for!);
  const sync = () => { b.setAttribute('aria-pressed', orig.getAttribute('aria-pressed') || 'false'); b.disabled = orig.disabled; };
  new MutationObserver(sync).observe(orig, { attributes: true, attributeFilter: ['aria-pressed', 'disabled'] });
  sync();
  b.addEventListener('click', () => orig.click());
});
select('learnSpeed').addEventListener('change', () => {
  select('speed').value = select('learnSpeed').value;
  select('speed').dispatchEvent(new Event('change'));
});
new MutationObserver(() => { $('learnStatus').textContent = $('status').textContent; }).observe($('status'), { childList: true, subtree: true, characterData: true });
$('learnBtn').addEventListener('click', enterLearn);
$('learnCtaBtn').addEventListener('click', enterLearn);
// A faixa pode ficar recolhida (num chip pequeno) para quem só quer ler a tab; a escolha fica guardada.
const setCtaFolded = (folded: boolean) => {
  $('learnCta').classList.toggle('folded', folded);
  const fold = $('learnCtaFold');
  fold.setAttribute('aria-expanded', String(!folded));
  fold.setAttribute('aria-label', folded ? 'Expand Tile by Tile' : 'Collapse Tile by Tile');
  fold.title = folded ? 'Expand' : 'Collapse';
};
setCtaFolded(storage.get<boolean>('mapa:learnCtaFolded') === true);
$('learnCtaFold').addEventListener('click', () => {
  const folded = !$('learnCta').classList.contains('folded');
  storage.set('mapa:learnCtaFolded', folded); setCtaFolded(folded);
});
/**
 * Faixa do Tile by Tile por cima do esquema: um segmento por secção (largura = compassos, com o nome lá dentro),
 * a vermelho as que já se sabem de cor e com contorno a próxima; o botão diz o que vem a seguir.
 */
function updateLearnCta() {
  if (!st.score) return;
  const { saved, step, bars, known, next, pct, nextName } = learnProgress();
  const track = $('learnCtaTrack');
  track.replaceChildren(...learnSegs(known, next, bars));
  const count = known.filter(Boolean).length;
  track.setAttribute('aria-label', count + ' of ' + st.sections.length + ' sections with no tab');
  $('learnCtaPct').querySelector('strong')!.textContent = pct + '%';
  $('learnCtaBtnText').textContent = saved?.done ? 'Practise again' : step > 0 ? 'Continue' + (nextName ? ' · ' + nextName : '') : 'Start' + (nextName ? ' · ' + nextName : '');
  $('learnCtaTitle').textContent = saved?.done ? 'You can play it with no tab' : 'Tile by Tile';
}
/** Onde se vai no Tile by Tile desta música: o passo guardado, o que já se sabe de cor e a secção que vem a seguir. */
function learnProgress() {
  const steps = learnSteps(), saved = storage.get<SavedLearn>(learnKey());
  const step = restoreStep(saved, steps, st.sections.length);
  const bars = secBars();
  const known = saved?.done ? bars.map(() => true) : knownSections(steps, step);
  // A próxima secção a aprender: a primeira que ainda não se sabe de cor
  const next = saved?.done ? -1 : known.indexOf(false);
  return { saved, step, bars, known, next, pct: byHeartPct(known, bars), nextName: next >= 0 ? st.sections[next]?.name ?? '' : '' };
}
/** Um segmento por secção (largura = compassos): cheio as que já se sabem de cor, com contorno a próxima. */
function learnSegs(known: boolean[], next: number, bars: number[]) {
  return st.sections.map((sec, k) => {
    const seg = document.createElement('span');
    seg.className = 'lc-seg' + (known[k] ? ' known' : k === next ? ' next' : '');
    seg.style.flex = String(Math.max(1, bars[k]));
    seg.title = sec.name + ' · ' + bars[k] + ' bar' + (bars[k] === 1 ? '' : 's') + (known[k] ? ' · no tab' : k === next ? ' · next' : '');
    const name = document.createElement('span'); name.textContent = sec.name; seg.append(name);
    return seg;
  });
}

// Ao abrir uma música (escolhida pela pessoa): aprender com o Tile by Tile ou só abrir a tab. Pergunta-se na primeira
// vez de cada música; depois, só enquanto houver um percurso a meio (para o retomar). Fechar = só abrir a tab.
const askedKey = () => 'mapa:asked:' + st.fileKey;
function offerLearn() {
  if (!st.score || learn.on || tour.open || !st.sections.length) return;
  const { saved, step, bars, known, next, pct, nextName } = learnProgress();
  const midway = !saved?.done && step > 0;
  if (storage.get<boolean>(askedKey()) && !midway) return;
  $('mpSong').textContent = [$('songTitle').textContent, score().artist].filter(Boolean).join(' · ');
  $('mpTitle').textContent = midway ? 'Pick up where you left off?' : 'How do you want to play this song?';
  $('mpTrack').replaceChildren(...learnSegs(known, next, bars));
  const n = st.sections.length;
  const meta = $('mpMeta'); meta.textContent = n + ' section' + (n === 1 ? '' : 's') + ' · ';
  const strong = document.createElement('strong'); strong.textContent = pct + '%';
  meta.append(strong, ' no tab yet');
  $('mpGo').textContent = saved?.done ? 'Practise again' : (midway ? 'Continue' : 'Start') + (nextName ? ' · ' + nextName : '');
  // Sem acesso: diz logo o que é preciso (o botão leva à criação de conta ou ao Premium)
  const a = access(plan, 'learn'), badge = $('mpBadge');
  badge.hidden = a === 'ok'; badge.textContent = a === 'account' ? 'Free account' : 'Premium';
  $('modePick').hidden = false; $('modeScrim').hidden = false;
  $('mpLearn').focus();
}
/** `seen` false: fechou-se porque se abriu outra música (não conta como resposta). */
function closeModePick(seen = true) {
  if ($('modePick').hidden) return;
  $('modePick').hidden = true; $('modeScrim').hidden = true;
  if (seen) storage.set(askedKey(), true);
}
['mpTab', 'mpClose', 'modeScrim'].forEach(id => $(id).addEventListener('click', () => closeModePick()));
$('mpLearn').addEventListener('click', () => { closeModePick(); enterLearn(); });
$('learnExit').addEventListener('click', () => exitLearn());

// "How it works": o método explicado numa janela (abre sozinha na primeira vez; depois, no botão "?")
function openLearnIntro(first = false) {
  const n = st.sections.length, steps = learnSteps();
  $('liTitle').textContent = 'You’ll learn this song in ' + n + ' section' + (n === 1 ? '' : 's') + '.';
  // Uma só secção: não há nada a que juntar
  ($('learnIntro').querySelector('.li-steps li:nth-child(3)') as HTMLElement).hidden = n < 2;
  const cur = steps[learn.step];
  $('learnIntroStart').textContent = first && learn.step === 0 ? 'Start with ' + st.sections[0].name : 'Continue' + (cur ? ' with ' + st.sections[stepSection(cur)].name : '');
  $('learnIntro').hidden = false; $('learnIntroScrim').hidden = false;
  if (st.api && api().playerState === PLAYING) api().pause();
  $('learnIntroStart').focus();
}
function closeLearnIntro() {
  if ($('learnIntro').hidden) return;
  $('learnIntro').hidden = true; $('learnIntroScrim').hidden = true;
  storage.set('mapa:learnIntroSeen', true);
  if (learn.on) $('learnPlay').focus();
}
$('learnHow').addEventListener('click', () => openLearnIntro());
['learnIntroStart', 'learnIntroClose', 'learnIntroScrim'].forEach(id => $(id).addEventListener('click', closeLearnIntro));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('learnIntro').hidden) { e.preventDefault(); closeLearnIntro(); } });

// "More options": metrónomo, contagem, tocar por cima e solo ficam escondidos até se pedirem
function setLearnMore(open: boolean) {
  $('learnTools').hidden = !open;
  $('learnMore').setAttribute('aria-expanded', String(open));
}
$('learnMore').addEventListener('click', () => setLearnMore($('learnTools').hidden));
$('learnBack').addEventListener('click', () => goLearnStep(learn.step - 1));
$('learnNext').addEventListener('click', () => {
  if (learn.step >= learnSteps().length - 1) {
    toast('You can play “' + ($('songTitle').textContent || 'the song') + '” with no tab. Well done!');
    storage.set(learnKey(), { v: 2, step: 0, done: true } satisfies SavedLearn); exitLearn(); return;
  }
  goLearnStep(learn.step + 1);
});
$('learnPlay').addEventListener('click', () => {
  if (!st.ready) { toast('The sounds are still loading.'); return; }
  if (learn.counting) { cancelLearnCount(); return; }
  if (api().playerState === PLAYING) { api().pause(); return; }
  // Depois de acabar o passo, tocar outra vez é repetir as voltas
  if (learn.runs >= learn.target) learn.target = learn.runs + runsGoal(learnSteps(), learn.step);
  learnCountIn();
});
// Peek: carregar e manter (rato ou dedo) mostra a tab; ao largar esconde-se. Com o teclado, alterna.
{
  const peek = $<HTMLButtonElement>('learnPeek');
  peek.addEventListener('pointerdown', e => { e.preventDefault(); peek.setPointerCapture(e.pointerId); setPeek(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) peek.addEventListener(ev, () => setPeek(false));
  peek.addEventListener('click', e => { if (e.detail === 0) setPeek(!learn.peeking); });
  peek.addEventListener('contextmenu', e => e.preventDefault());
  peek.addEventListener('blur', () => setPeek(false));
}

// Ao abrir: a música de exemplo (?sample); ou a última aberta na conta (em qualquer dispositivo);
// sem conta ou sem músicas, a de exemplo. ?load (vindo da página inicial) abre "My songs" para carregar uma.
const params = new URLSearchParams(location.search);
// (Also accepts the old Portuguese names: ?exemplo, ?abrir, #musicas.)
const wantSample = params.has('sample') || params.has('exemplo');
const wantLoad = params.has('load') || params.has('open') || params.has('abrir');
if (wantSample || wantLoad) history.replaceState(null, '', location.pathname + location.hash);
async function boot(): Promise<unknown> {
  await accountReady;
  if (wantSample || (cloudEnabled && !account)) return openSample();
  const songs = await lib.list().catch(() => [] as SongMeta[]);
  return songs.length ? openSaved(songs[0].id) : openSample();
}
boot()
  .catch(() => openSample())
  // Ligações diretas: /player?premium abre os planos; ?signup a criação de conta
  .then(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('premium')) openPaywall('upgrade');
    if (q.has('signup') && !account) openAuthDialog('signup', undefined, welcome);
    if (q.has('premium') || q.has('signup')) history.replaceState(null, '', location.pathname + location.hash);
  })
  .then(() => { if (location.hash === '#songs' || location.hash === '#musicas') openLibrary(true); })
  .then(() => {
    if (!wantLoad) return;
    if (cloudEnabled && !account) { songLimitReached(); return; }
    openLibrary(true); toast('Choose the Guitar Pro file to load.'); $('libraryBtn').blur();
  })
  .then(() => { if (params.has('learn')) enterLearn(); })
  // Primeira vez numa conta: tutorial (depois de a música aparecer, para os destaques ficarem no sítio certo).
  // Sem conta não abre sozinho (não se guarda nada, por isso abriria em todas as visitas): fica no "?".
  // (Nem quando os dados da conta ainda não se leram: não se sabe se já o viu.)
  .finally(() => { if (account && isHydrated() && !tourSeen()) setTimeout(startTour, 600); });
