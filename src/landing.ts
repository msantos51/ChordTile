// Página inicial: apresentação do site. O ficheiro escolhido aqui fica guardado neste browser
// (IndexedDB) e o leitor abre-o logo (player.html?open). Nada é enviado para um servidor.
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/plus-jakarta-sans/latin-800.css';
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

// ---------- Animação da pré-visualização ----------
// A pré-visualização "toca" sozinha: o compasso atual acende, a contagem marca os 4 tempos,
// a barra de progresso avança e o refrão repete uma vez (loop). Para quando sai do ecrã,
// quando o separador fica escondido e não corre com "reduzir movimento".
const BEAT_MS = 300; // ~200 bpm: mais rápido do que a música, para se ver o movimento
function startMockPlayback() {
  const mock = document.querySelector<HTMLElement>('.l-mock');
  if (!mock || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const secs = [...mock.querySelectorAll<HTMLElement>('.l-sec')];
  const beats = [...document.querySelectorAll<HTMLElement>('#mockBeats i')];
  const fill = mock.querySelector<HTMLElement>('.l-progress i');
  const icon = document.getElementById('mockPlayIcon');
  const loopBadge = mock.querySelector<HTMLElement>('.l-sec em');

  // Ordem de reprodução: Intro, Verso, Refrão ×2 (loop), Ponte
  const order: { sec: number; bar: HTMLElement; loop: boolean }[] = [];
  secs.forEach((sec, k) => {
    const bars = [...sec.querySelectorAll<HTMLElement>('.l-bars i')];
    const times = sec.querySelector('em') ? 2 : 1;
    for (let t = 0; t < times; t++) bars.forEach(bar => order.push({ sec: k, bar, loop: times > 1 }));
  });
  if (!order.length) return;

  let step = 0, beat = 0, timer = 0, visible = true;
  const PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z', PLAY = 'M8 5v14l11-7z';

  function tick() {
    const cur = order[step];
    if (beat === 0) {
      mock!.querySelectorAll('.l-bars i.is-on').forEach(e => e.classList.remove('is-on'));
      cur.bar.classList.add('is-on');
      secs.forEach((s, k) => s.classList.toggle('is-active', k === cur.sec));
      loopBadge?.classList.toggle('is-looping', cur.loop);
      if (fill) fill.style.width = ((step + 1) / order.length) * 100 + '%';
    }
    beats.forEach((b, j) => b.classList.toggle('on', j === beat));
    beat = (beat + 1) % 4;
    if (beat === 0) step = (step + 1) % order.length;
  }
  function play() {
    if (timer || !visible || document.hidden) return;
    icon?.setAttribute('d', PAUSE);
    tick(); timer = window.setInterval(tick, BEAT_MS);
  }
  function pause() {
    if (!timer) return;
    clearInterval(timer); timer = 0;
    icon?.setAttribute('d', PLAY);
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) play(); else pause(); }, { threshold: 0.2 }).observe(mock);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  window.setTimeout(play, 900); // depois da entrada da página
}
startMockPlayback();
