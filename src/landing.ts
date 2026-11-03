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

// ---------- Animação do mapa da música ----------
// O mapa "toca" sozinho: o compasso atual fica preto, os 4 tempos piscam e o refrão repete
// 3 vezes com a velocidade a subir (80 % → 90 % → 100 %), como o treino de velocidade.
// Para quando sai do ecrã, quando o separador fica escondido e não corre com "reduzir movimento".
const BEAT_MS = 150;
const SECTION_NAMES = ['Intro', 'Verse', 'Chorus', 'Bridge'];
const $ = (id: string) => document.getElementById(id) as HTMLElement;

function startBoard() {
  const board = document.querySelector<HTMLElement>('.board');
  if (!board) return;
  const rows = [...board.querySelectorAll<HTMLElement>('.row')];
  const tiles = [...board.querySelectorAll<HTMLElement>('.t')];
  const beats = [...document.querySelectorAll<HTMLElement>('#beats i')];
  const order: { t: HTMLElement; k: number; rep: number; bar: number }[] = [];
  let bar = 0;
  rows.forEach((r, k) => {
    const ts = [...r.querySelectorAll<HTMLElement>('.t')];
    const first = bar; bar += ts.length;
    for (let rep = 0; rep < (r.classList.contains('loop') ? 3 : 1); rep++) ts.forEach((t, j) => order.push({ t, k, rep, bar: first + j + 1 }));
  });

  // Legenda: destaca os compassos com essa nota
  $('legend').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    $('legend').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', String(on));
    tiles.forEach(t => t.classList.toggle('dim', on && t.dataset.n !== b.dataset.n));
  });

  if (!order.length || matchMedia('(prefers-reduced-motion: reduce)').matches) { tiles[0]?.classList.add('on'); return; }
  let i = 0, beat = 0, speed = 1, timer = 0, visible = true;
  function tick() {
    const s = order[i];
    beats.forEach((b, j) => b.classList.toggle('on', j === beat));
    if (beat === 0) {
      tiles.forEach(t => t.classList.remove('on')); s.t.classList.add('on');
      const looping = rows[s.k].classList.contains('loop');
      speed = looping ? [0.8, 0.9, 1][s.rep] : 1;
      $('where').textContent = SECTION_NAMES[s.k] + ' · bar ' + s.bar + (looping ? ' · loop ' + (s.rep + 1) + '/3' : '');
      $('spd').textContent = Math.round(speed * 100) + '%';
      $('secNo').textContent = '0' + (s.k + 1) + ' / 0' + rows.length;
      $('secName').textContent = SECTION_NAMES[s.k].toUpperCase();
      $('secBar').style.width = ((s.k + 1) / rows.length) * 100 + '%';
    }
    beat = (beat + 1) % 4; if (beat === 0) i = (i + 1) % order.length;
    timer = window.setTimeout(tick, BEAT_MS / speed);
  }
  function play() { if (!timer && visible && !document.hidden) tick(); }
  function pause() { clearTimeout(timer); timer = 0; }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) play(); else pause(); }, { threshold: 0.2 }).observe(board);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
}
startBoard();
