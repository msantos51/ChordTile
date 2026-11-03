// Página inicial: apresentação do site. O ficheiro escolhido aqui fica guardado neste browser
// (IndexedDB) e o leitor abre-o logo (player.html?open). Nada é enviado para um servidor.
import './fonts';
import './landing.css';
import { setPendingFile } from './app/library';

const input = document.getElementById('landingFile') as HTMLInputElement;
const drop = document.getElementById('landingDrop') as HTMLElement;
const err = document.getElementById('landingErr') as HTMLElement;

function fail(msg: string) {
  err.textContent = msg; err.hidden = false;
}

async function openInReader(f: File | undefined) {
  if (!f) return;
  err.hidden = true;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await setPendingFile(f.name, bytes);
    location.href = './player.html?open';
  } catch {
    fail('Couldn’t hand the file to the player in this browser (private mode?). Open the player and load it there.');
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b => b.addEventListener('click', () => input.click()));
input.addEventListener('change', () => { void openInReader(input.files?.[0]); input.value = ''; });

let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { dragN++; drop.hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) drop.hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; drop.hidden = true; void openInReader(e.dataTransfer?.files[0]); });

// ---------- Animação: como funciona, em 4 cenas ----------
// 1. Importar: o ficheiro cai na zona e é lido.  2. Secções: os compassos aparecem por grupos.
// 3. Loop: o leitor toca e o refrão repete com a velocidade a subir.  4. Compasso aberto: um
// compasso cresce até à janela com as notas e a contagem. Os passos do "How it works" acendem
// com cada cena e saltam para ela ao clicar. Pára fora do ecrã e não corre com "reduzir movimento".
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const stage = $('stage');
const rows = [...stage.querySelectorAll<HTMLElement>('.row')];
const tiles = [...stage.querySelectorAll<HTMLElement>('.t')];
const steps = [...document.querySelectorAll<HTMLLIElement>('#steps li')];
const beats = [...stage.querySelectorAll<HTMLElement>('#beats i')];
const zoom = $('zoom');
const LABELS = ['01 · Import', '02 · Sections', '03 · Practise on loop', '04 · Open a bar'];
const DUR = [3400, 2600, 6400, 6000];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Atraso de entrada de cada quadrado (aparecem em cascata, secção a secção)
rows.forEach(r => r.querySelectorAll<HTMLElement>('.t').forEach((t, j) => t.style.setProperty('--i', String(j))));

let timers: number[] = [];
let scene = 0, running = false, visible = true;
const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)); };
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function reset() {
  stage.classList.remove('s-in', 's-drop', 's-read', 'sc-map', 'sc-play', 'sc-zoom');
  rows.forEach(r => r.classList.remove('shown', 'looping'));
  tiles.forEach(t => t.classList.remove('on', 'pick'));
  beats.forEach(b => b.classList.remove('on'));
  $('readText').textContent = 'Reading…';
  closeZoom(true);
}

function setStep(k: number) {
  steps.forEach((li, j) => {
    li.classList.toggle('on', j === k); li.classList.toggle('done', j < k);
    li.style.setProperty('--dur', DUR[j] + 'ms');
    // Reinicia a barra de progresso do passo ativo
    const p = li.querySelector<HTMLElement>('.prog'); if (p && j === k) { p.style.display = 'none'; void p.offsetWidth; p.style.display = ''; }
  });
  $('sceneLabel').textContent = LABELS[k];
}

function showAllRows() { rows.forEach(r => r.classList.add('shown')); }

function sceneImport() {
  later(200, () => stage.classList.add('s-in'));
  later(1100, () => stage.classList.add('s-drop'));
  later(1700, () => stage.classList.add('s-read'));
  later(2900, () => { $('readText').textContent = '52 bars · 4 sections'; });
}
function sceneMap() {
  stage.classList.add('sc-map');
  rows.forEach((r, k) => later(150 + k * 480, () => r.classList.add('shown')));
}
function scenePlay() {
  stage.classList.add('sc-map', 'sc-play'); showAllRows();
  // Intro inteira e depois o refrão em loop, 2 voltas, a 80 % e 100 %
  const intro = [...rows[0].querySelectorAll<HTMLElement>('.t')].map(t => ({ t, sec: 'Intro', speed: 100 }));
  const chorus = [...rows[2].querySelectorAll<HTMLElement>('.t')].slice(0, 4);
  const seq = [...intro, ...chorus.map(t => ({ t, sec: 'Chorus', speed: 80 })), ...chorus.map(t => ({ t, sec: 'Chorus', speed: 100 }))];
  const barNo = (t: HTMLElement) => tiles.indexOf(t) + 1;
  let at = 100;
  seq.forEach((s, i) => {
    const beat = 300 * (100 / s.speed) / 2.6;
    later(at, () => {
      tiles.forEach(x => x.classList.remove('on')); s.t.classList.add('on');
      rows[2].classList.toggle('looping', s.sec === 'Chorus');
      $('where').textContent = s.sec + ' · bar ' + barNo(s.t) + (s.sec === 'Chorus' ? ' · loop ' + (i - intro.length < chorus.length ? 1 : 2) + '/2' : '');
      $('spd').textContent = s.speed + '%';
    });
    for (let b = 0; b < 4; b++) later(at + b * beat, () => beats.forEach((x, j) => x.classList.toggle('on', j === b)));
    at += beat * 4;
  });
}
function sceneZoom() {
  stage.classList.add('sc-map', 'sc-play'); showAllRows(); rows[2].classList.add('looping');
  tiles.forEach(x => x.classList.remove('on'));
  const tile = $('zoomTile');
  $('where').textContent = 'Chorus · bar 14 · opened'; $('spd').textContent = '100%';
  beats.forEach(b => b.classList.remove('on'));
  later(150, () => tile.classList.add('pick'));
  later(800, () => { stage.classList.add('sc-zoom'); openZoom(tile); });
  // A contagem percorre o compasso duas vezes e as notas acendem no tempo certo
  const slots = [...$('zCount').querySelectorAll<HTMLElement>('span')];
  const notes = [...$('zStaff').querySelectorAll<HTMLElement>('.nt')];
  for (let rep = 0; rep < 2; rep++) {
    for (let s = 0; s < 8; s++) {
      later(1500 + (rep * 8 + s) * 210, () => {
        $('zRep').textContent = String(rep + 1);
        slots.forEach((x, j) => x.classList.toggle('on', j === s));
        notes.forEach(n => n.classList.toggle('on', n.style.getPropertyValue('--s') === String(s)));
      });
    }
  }
  later(1500 + 16 * 210 + 300, () => { slots.forEach(x => x.classList.remove('on')); notes.forEach(n => n.classList.remove('on')); closeZoom(false, tile); });
}

/** A janela cresce a partir do quadrado (técnica FLIP: mede o fim, parte do quadrado e anima). */
function openZoom(from: HTMLElement) {
  zoom.style.transition = 'none'; zoom.style.transform = 'none';
  const end = zoom.getBoundingClientRect(), r = from.getBoundingClientRect();
  zoom.style.transform = `translate(${r.left - end.left}px, ${r.top - end.top}px) scale(${r.width / end.width}, ${r.height / end.height})`;
  zoom.classList.add('open'); void zoom.offsetWidth;
  zoom.style.transition = 'transform .55s cubic-bezier(.2, .8, .2, 1), opacity .2s';
  zoom.style.transform = 'none';
}
function closeZoom(instant: boolean, to?: HTMLElement) {
  if (instant || !to) { zoom.style.transition = 'none'; zoom.classList.remove('open'); zoom.style.transform = 'none'; return; }
  const end = zoom.getBoundingClientRect(), r = to.getBoundingClientRect();
  zoom.style.transition = 'transform .45s cubic-bezier(.6, 0, .4, 1), opacity .3s .2s';
  zoom.style.transform = `translate(${r.left - end.left}px, ${r.top - end.top}px) scale(${r.width / end.width}, ${r.height / end.height})`;
  zoom.classList.remove('open');
  later(450, () => { stage.classList.remove('sc-zoom'); to.classList.remove('pick'); zoom.style.transition = 'none'; zoom.style.transform = 'none'; });
}

const SCENES = [sceneImport, sceneMap, scenePlay, sceneZoom];
function go(k: number) {
  clearTimers(); reset();
  scene = k; setStep(k);
  if (k >= 1) stage.classList.add('sc-map');
  SCENES[k]();
  later(DUR[k], () => go((k + 1) % SCENES.length));
}
function play() { if (!running && visible && !document.hidden) { running = true; go(scene); } }
function pause() { running = false; clearTimers(); }

steps.forEach((li, k) => li.querySelector('button')!.addEventListener('click', () => {
  if (reduce) { staticScene(k); return; }
  running = true; go(k);
}));

/** Sem animação: mostra o resultado de cada passo, parado. */
function staticScene(k: number) {
  reset(); scene = k; setStep(k);
  if (k === 0) stage.classList.add('s-in', 's-drop', 's-read');
  if (k >= 1) { stage.classList.add('sc-map'); showAllRows(); }
  if (k >= 2) { stage.classList.add('sc-play'); rows[2].classList.add('looping'); $('zoomTile').classList.add('on'); }
  if (k === 3) { stage.classList.add('sc-zoom'); zoom.classList.add('open'); }
}

if (reduce) staticScene(1);
else {
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) play(); else pause(); }, { threshold: 0.2 }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
}
