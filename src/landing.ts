// Página inicial: apresentação do site. O ficheiro escolhido aqui fica guardado neste browser
// (IndexedDB) e o leitor abre-o logo (/player?open). Nada é enviado para um servidor.
import './fonts';
import './landing.css';
import { setPendingFile } from './app/library';
import { accountsEnabled, storedAccount } from './app/session-hint';

const input = document.getElementById('landingFile') as HTMLInputElement;
const drop = document.getElementById('landingDrop') as HTMLElement;
const err = document.getElementById('landingErr') as HTMLElement;

// Menu de cima: com sessão iniciada, "Your account" em vez de "Sign in"; sem contas (cópia local), nada
const navAccount = document.getElementById('navAccount') as HTMLAnchorElement;
if (!accountsEnabled) navAccount.hidden = true;
else if (storedAccount()) navAccount.textContent = 'Your account';

function fail(msg: string) {
  err.textContent = msg; err.hidden = false;
}

async function openInReader(f: File | undefined) {
  if (!f) return;
  err.hidden = true;
  if (f.size > 20 * 1024 * 1024) { fail('“' + f.name + '” is too large. Guitar Pro and MusicXML files up to 20 MB are supported.'); return; }
  if (!f.size) { fail('“' + f.name + '” is empty.'); return; }
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await setPendingFile(f.name, bytes);
    location.href = '/player?open';
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
// 1. Importar: o ficheiro é arrastado para a zona e lido.  2. Secções: os compassos aparecem
// por grupos.  3. Leitor: clica-se em "Practise" no refrão; a tablatura segue o som e a
// velocidade sobe.  4. Clica-se num compasso da tablatura e em "Expand": abre em grande, com as
// notas e a contagem. Os passos do "How it works" acompanham e saltam para a cena ao clicar.
// Só se animam transform/opacity (Web Animations); pára fora do ecrã e com "reduzir movimento".
type Note = { s: number; l: number; f: number };
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('canvas'), stage = $('stage');
const steps = [...document.querySelectorAll<HTMLLIElement>('#steps li')];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const SECTIONS: { name: string; chords: [string, number][] }[] = [
  { name: 'Intro', chords: [['Am', 9], ['F', 5], ['C', 0], ['G', 7]] },
  { name: 'Verse', chords: [['Am', 9], ['Am', 9], ['F', 5], ['G', 7], ['C', 0], ['G', 7], ['Am', 9], ['Am', 9]] },
  { name: 'Chorus', chords: [['F', 5], ['G', 7], ['C', 0], ['Am', 9], ['F', 5], ['G', 7], ['C', 0], ['C', 0]] },
  { name: 'Bridge', chords: [['Dm', 2], ['E', 4], ['Am', 9], ['Am', 9]] },
];
// Guitarra: cordas de 0 (mi agudo) a 5 (mi grave); casa de cada corda em cada acorde (null = não toca)
const STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'];
const SHAPES: Record<string, (number | null)[]> = {
  Am: [0, 1, 2, 2, 0, null], F: [1, 1, 2, 3, 3, 1], C: [0, 1, 0, 2, 3, null],
  G: [3, 0, 0, 0, 2, 3], Dm: [1, 3, 2, 0, null, null], E: [0, 0, 1, 2, 2, 0],
};
/** Arpejo em colcheias: baixo do acorde e depois as cordas de cima (como se toca à guitarra). */
function arpeggio(chord: string): Note[] {
  const sh = SHAPES[chord], root = sh.reduce<number>((a, f, l) => (f != null ? l : a), 0);
  return [root, 2, 1, 0, 1, 2, 1, root > 3 ? 3 : 2].map((l, s) => ({ s, l, f: sh[l] ?? 0 }));
}
const BAR14 = arpeggio('G');
/** Na tablatura em miniatura cada compasso mostra só os tempos (cabe sem sobrepor). */
const notesOf = (chord: string): Note[] => arpeggio(chord).slice(0, 4).map((n, i) => ({ ...n, s: i * 2 }));
/** Nota pessoal escrita na animação, no 1.º compasso do refrão (compasso 13). */
const NOTE_BAR = 13, NOTE_TEXT = 'let ring';
const firstBar = (k: number) => SECTIONS.slice(0, k).reduce((a, x) => a + x.chords.length, 0) + 1;

// ---- Construção (uma vez) ----
const boardTiles: HTMLElement[] = [];
const boardLabels: HTMLElement[] = [];
SECTIONS.forEach(sec => {
  const row = document.createElement('div'); row.className = 'row';
  const l = document.createElement('div'); l.className = 'row-l'; l.innerHTML = sec.name + ' <span>' + sec.chords.length + ' bars</span>';
  const tl = document.createElement('div'); tl.className = 'tiles';
  sec.chords.forEach(([c, n]) => { const t = document.createElement('div'); t.className = 't'; t.dataset.n = String(n); t.innerHTML = c + '<small></small>'; tl.append(t); boardTiles.push(t); });
  row.append(l, tl); $('rows').append(row); boardLabels.push(l);
});
const mpTiles = new Map<number, HTMLElement>();
SECTIONS.slice(0, 3).forEach((sec, k) => {
  const box = document.createElement('div'); box.className = 'mp-sec'; if (k === 2) box.id = 'mpChorus';
  box.innerHTML = '<p>' + sec.name + '<span class="mp-prac"' + (k === 2 ? ' id="mpPractise"' : '') + '>⟲ Practise</span></p>';
  const g = document.createElement('div'); g.className = 'mp-grid';
  sec.chords.forEach(([c, n], j) => { const t = document.createElement('div'); t.className = 'mt'; t.dataset.n = String(n); t.innerHTML = c + '<small></small>'; g.append(t); mpTiles.set(firstBar(k) + j, t); });
  box.append(g); $('mpChart').append(box);
});
// Tablatura: 3 sistemas de 4 compassos (Verse 5–8, Chorus 13–16 e 17–20)
const SYSTEMS = [{ label: 'Verse', sec: 1, from: 0 }, { label: 'Chorus', sec: 2, from: 0 }, { label: '', sec: 2, from: 4 }];
const tabBars = new Map<number, { sys: HTMLElement; i: number }>();
SYSTEMS.forEach(sy => {
  const el = document.createElement('div'); el.className = 'sys';
  el.innerHTML = '<span class="sys-l">' + sy.label + '</span><div class="sys-lines">' + [0, 1, 2, 3, 4, 5].map(l => '<i style="top:' + l * 9 + 'px"></i>').join('') + '</div>';
  for (let i = 0; i < 4; i++) {
    const bar = firstBar(sy.sec) + sy.from + i, chord = SECTIONS[sy.sec].chords[sy.from + i][0];
    const b = document.createElement('div'); b.className = 'sys-bar'; b.style.left = i * 25 + '%'; b.style.width = '25%';
    b.innerHTML = '<span class="sys-no" style="right:4px;top:-10px">' + bar + '</span>' +
      notesOf(chord).map(n => '<span class="fret" style="left:' + ((n.s + 0.5) / 8) * 100 + '%;top:' + n.l * 9 + 'px">' + n.f + '</span>').join('');
    el.append(b); tabBars.set(bar, { sys: el, i });
  }
  $('mpSystems').append(el);
});
// Janela do compasso aberto: 6 cordas e as 8 colcheias do compasso 14
$('zStaff').innerHTML = STRINGS.map((n, l) => '<span class="z-str" style="--l:' + l + '">' + n + '</span><i class="ln" style="--l:' + l + '"></i>').join('') +
  BAR14.map(n => '<span class="nt" style="--s:' + n.s + ';--l:' + n.l + '" data-s="' + n.s + '">' + n.f + '</span>').join('');
// Os compassos da tablatura posicionam as notas dentro das linhas
document.querySelectorAll<HTMLElement>('.sys-bar').forEach(b => { b.style.top = '16px'; b.style.height = '45px'; });

/** Posição de um elemento dentro da tela (em píxeis da tela, sem a escala). */
function rectIn(el: HTMLElement) {
  let x = 0, y = 0, e: HTMLElement | null = el;
  while (e && e !== canvas) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent as HTMLElement | null; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}
/** Centro de um elemento tal como aparece no ecrã (conta com transform/translate), em píxeis da tela. */
function center(el: HTMLElement) {
  const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect(), k = c.width / 560;
  return { x: (r.left + r.width / 2 - c.left) / k, y: (r.top + r.height / 2 - c.top) / k };
}

// ---- Escala da tela para caber no painel ----
new ResizeObserver(() => {
  const k = Math.min(stage.clientWidth / 560, stage.clientHeight / 440, 1.3);
  canvas.style.setProperty('--k', String(Math.max(0.3, k)));
}).observe(stage);

// ---- Motor: esperas canceláveis e animações ----
let run = 0;
const CANCEL = Symbol('cancel');
const wait = (ms: number) => { const id = run; return new Promise<void>((ok, ko) => setTimeout(() => (id === run ? ok() : ko(CANCEL)), ms)); };
const anim = (el: Element, k: Keyframe[], o: KeyframeAnimationOptions) => el.animate(k, { fill: 'forwards', easing: 'cubic-bezier(.2,.8,.2,1)', ...o });
const ptr = $('ptr');
let ptrAt = { x: 470, y: 380 };
/** A ponta da seta está a (5, 3) px do canto da caixa do cursor: move a caixa para a ponta ficar em (x, y). */
const TIP = { x: 5, y: 3 };
const at = (p: { x: number; y: number }) => `translate(${p.x - TIP.x}px, ${p.y - TIP.y}px)`;
async function moveTo(x: number, y: number, ms = 650) {
  ptr.classList.add('on');
  anim(ptr, [{ transform: at(ptrAt) }, { transform: at({ x, y }) }], { duration: ms, easing: 'cubic-bezier(.5,0,.2,1)' });
  ptrAt = { x, y }; await wait(ms);
}
async function click() { ptr.classList.remove('click'); void ptr.offsetWidth; ptr.classList.add('click'); await wait(180); }

const DUR = [3900, 5200, 6600, 6600];
const NAMES = ['Import', 'Sections & notes', 'Practise with the tab', 'Open a bar'];
function setStep(k: number) {
  $('sceneNo').textContent = '0' + (k + 1); $('sceneName').textContent = NAMES[k];
  steps.forEach((li, j) => {
    li.classList.toggle('on', j === k); li.classList.toggle('done', j < k);
    const bar = li.querySelector<HTMLElement>('.prog i')!;
    bar.getAnimations().forEach(a => a.cancel());
    if (j === k && !reduce) bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: DUR[k], easing: 'linear', fill: 'forwards' });
  });
}

/** Volta tudo ao estado inicial, sem animação. */
function resetAll() {
  canvas.querySelectorAll('*').forEach(e => e.getAnimations().forEach(a => a.cancel()));
  ptr.getAnimations().forEach(a => a.cancel());
  canvas.classList.remove('fade');
  ptr.classList.remove('on', 'click'); ptrAt = { x: 470, y: 380 };
  ptr.style.transform = at(ptrAt);
  $('dropzone').classList.remove('hot', 'reading-on'); $('readText').textContent = 'Reading the file…';
  $('file').style.opacity = '0';
  mpTiles.forEach(t => t.classList.remove('on'));
  boardTiles.forEach(t => { t.classList.remove('sel', 'writing'); t.querySelector('small')!.textContent = ''; });
  mpTiles.get(NOTE_BAR)!.querySelector('small')!.textContent = '';
  $('file').classList.remove('held');
  $('mpChorus').classList.remove('loop');
  $('mpLoop').classList.remove('on');
  $('mpSpeed').textContent = '100%'; $('mpWhere').textContent = 'Ready to play';
  $('mpCursor').classList.remove('on'); $('mpSel').classList.remove('on'); $('mpExpand').classList.remove('press');
  const z = $('zoom'); z.style.opacity = '0'; z.style.transform = '';
  $('zCount').querySelectorAll('span').forEach(x => x.classList.remove('on'));
  $('zStaff').querySelectorAll('.nt').forEach(x => x.classList.remove('on'));
  $('zRep').textContent = '1';
}

async function sceneImport() {
  canvas.dataset.scene = 'import';
  const file = $('file'), dz = $('dropzone');
  const dzc = center(dz);
  // O ficheiro está na camada da cena (52 px abaixo do topo da tela); o cursor está na tela
  const layer = file.offsetParent as HTMLElement, base = { x: layer.offsetLeft, y: layer.offsetTop };
  const start = { x: 360, y: 8 }, end = { x: dzc.x - base.x - file.offsetWidth / 2, y: dzc.y - base.y - 110 };
  // Ponto onde o cursor agarra o ficheiro (igual à posição do cursor desenhado dentro dele), em coordenadas da tela
  const grab = { x: base.x + file.offsetWidth * 0.58, y: base.y + file.offsetHeight * 0.42 };
  anim(file, [{ opacity: 0, transform: `translate(${start.x + 30}px, ${start.y - 20}px) rotate(8deg)` }, { opacity: 1, transform: `translate(${start.x}px, ${start.y}px)` }], { duration: 450 });
  await moveTo(start.x + grab.x, start.y + grab.y, 550);
  await click();
  // Arrastar: o cursor passa a ser desenhado dentro do ficheiro, por isso andam exatamente juntos
  ptr.classList.remove('on'); file.classList.add('held');
  anim(file, [{ opacity: 1, transform: `translate(${start.x}px, ${start.y}px)` }, { opacity: 1, transform: `translate(${end.x}px, ${end.y}px) rotate(-2deg)`, offset: 0.85 }, { opacity: 1, transform: `translate(${end.x}px, ${end.y}px)` }], { duration: 1000, easing: 'cubic-bezier(.5,0,.2,1)' });
  await wait(550); dz.classList.add('hot'); await wait(450);
  // Largar: o cursor volta a ser o principal e o ficheiro entra na zona
  ptrAt = { x: end.x + grab.x, y: end.y + grab.y };
  ptr.getAnimations().forEach(a => a.cancel()); ptr.style.transform = at(ptrAt);
  ptr.classList.add('on'); file.classList.remove('held');
  await click();
  // O ficheiro encolhe para dentro da zona a partir do ponto onde o cursor o larga (não foge do cursor)
  file.style.transformOrigin = '58% 42%';
  anim(file, [{ opacity: 1, transform: `translate(${end.x}px, ${end.y}px) scale(1)` }, { opacity: 0, transform: `translate(${end.x}px, ${end.y}px) scale(.4)` }], { duration: 380, easing: 'cubic-bezier(.4,0,.2,1)' });
  await wait(120);
  dz.classList.remove('hot'); dz.classList.add('reading-on');
  anim(ptr, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
  anim($('readFill'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 1150, easing: 'cubic-bezier(.4,0,.2,1)' });
  await wait(1200);
  $('readText').textContent = '✓ 52 bars · 4 sections found';
  await wait(650);
}

async function sceneBoard() {
  ptr.classList.remove('on'); ptr.getAnimations().forEach(a => a.cancel());
  canvas.dataset.scene = 'board';
  let i = 0;
  SECTIONS.forEach((sec, k) => {
    anim(boardLabels[k], [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 250 + k * 420 });
    sec.chords.forEach((_, j) => {
      anim(boardTiles[i++], [{ opacity: 0, transform: 'translateY(12px) scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 300 + k * 420 + j * 40 });
    });
  });
  await wait(2500);
  // Duplo clique num compasso do refrão e escrever uma nota por baixo do acorde
  const tile = boardTiles[NOTE_BAR - 1], small = tile.querySelector('small')!;
  ptrAt = { x: 470, y: 420 }; ptr.style.transform = at(ptrAt);
  const c = center(tile);
  await moveTo(c.x + 6, c.y + 4, 650);
  await click(); await wait(90); await click();
  tile.classList.add('sel', 'writing');
  await moveTo(c.x + 46, c.y + 48, 260); // o cursor sai de cima para se ver o texto
  for (let n = 1; n <= NOTE_TEXT.length; n++) { small.textContent = NOTE_TEXT.slice(0, n); await wait(75); }
  await wait(350);
  tile.classList.remove('writing');
  await wait(450);
  tile.classList.remove('sel');
  await moveTo(c.x + 60, c.y + 80, 400); ptr.classList.remove('on');
  await wait(250);
}

/** Estado final das secções (para saltar diretamente para as cenas seguintes). */
function boardDone() {
  boardLabels.forEach(l => { l.style.opacity = '1'; }); boardTiles.forEach(t => { t.style.opacity = '1'; t.style.transform = 'none'; });
  boardTiles[NOTE_BAR - 1].querySelector('small')!.textContent = NOTE_TEXT;
}
/** A nota escrita nas secções aparece no leitor (cenas 3 e 4). */
function noteInPlayer() { mpTiles.get(NOTE_BAR)!.querySelector('small')!.textContent = NOTE_TEXT; }

function barGeom(bar: number) {
  const { sys, i } = tabBars.get(bar)!;
  const r = rectIn(sys), tab = rectIn($('mpTab'));
  const w = r.w / 4;
  return { x: r.x - tab.x + i * w, y: r.y - tab.y + 14, w, h: 49, abs: { x: r.x + i * w, y: r.y + 12, w, h: 53 } };
}

async function scenePlayer() {
  canvas.dataset.scene = 'player'; noteInPlayer();
  await wait(500);
  ptr.style.opacity = ''; ptr.getAnimations().forEach(a => a.cancel());
  ptrAt = { x: 420, y: 400 }; ptr.style.transform = at(ptrAt);
  const pr = center($('mpPractise'));
  await moveTo(pr.x - 4, pr.y - 2, 750);
  await click();
  $('mpChorus').classList.add('loop'); $('mpLoop').classList.add('on');
  await wait(250);
  await moveTo(pr.x + 60, pr.y + 140, 500);
  ptr.classList.remove('on');
  const cur = $('mpCursor'); cur.classList.add('on');
  for (const [loop, speed] of [[1, 100], [2, 100]] as const) {
    $('mpSpeed').textContent = speed + '%';
    for (let bar = 13; bar <= 16; bar++) {
      const g = barGeom(bar), ms = 560 * (100 / speed);
      mpTiles.forEach(t => t.classList.remove('on')); mpTiles.get(bar)?.classList.add('on');
      $('mpWhere').textContent = 'Chorus · bar ' + bar + ' · loop ' + loop + '/2';
      anim(cur, [{ transform: `translate(${g.x}px, ${g.y}px)` }, { transform: `translate(${g.x + g.w - 2}px, ${g.y}px)` }], { duration: ms, easing: 'linear' });
      await wait(ms);
    }
  }
  cur.classList.remove('on'); mpTiles.forEach(t => t.classList.remove('on'));
  $('mpWhere').textContent = 'Paused · chorus at full speed';
  await wait(250);
}

function playerReady() { $('mpChorus').classList.add('loop'); $('mpLoop').classList.add('on'); $('mpWhere').textContent = 'Paused'; }

async function sceneExpand() {
  canvas.dataset.scene = 'player'; noteInPlayer();
  const g = barGeom(14), sel = $('mpSel');
  ptr.getAnimations().forEach(a => a.cancel()); ptr.style.opacity = '';
  ptrAt = { x: 460, y: 400 }; ptr.style.transform = at(ptrAt);
  await moveTo(g.abs.x + g.abs.w / 2, g.abs.y + g.abs.h / 2, 700);
  await click();
  Object.assign(sel.style, { left: g.x - 2 + 'px', top: g.y - 4 + 'px', width: g.w + 4 + 'px', height: g.h + 8 + 'px' });
  sel.classList.add('on');
  mpTiles.get(14)?.classList.add('on');
  $('mpWhere').textContent = 'Chorus · bar 14';
  await wait(450);
  const ex = center($('mpExpand'));
  await moveTo(ex.x, ex.y, 450);
  $('mpExpand').classList.add('press'); await click(); $('mpExpand').classList.remove('press');
  ptr.classList.remove('on');
  // A janela cresce a partir do compasso da tablatura
  const z = $('zoom'), zr = { x: 30, y: 110, w: z.offsetWidth, h: z.offsetHeight };
  const from = `translate(${g.abs.x - zr.x}px, ${g.abs.y - zr.y}px) scale(${g.abs.w / zr.w}, ${g.abs.h / zr.h})`;
  anim(z, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none', offset: 0.35 }, { opacity: 1, transform: 'none' }], { duration: 650 });
  await wait(750);
  const slots = [...$('zCount').querySelectorAll<HTMLElement>('span')];
  const notes = [...$('zStaff').querySelectorAll<HTMLElement>('.nt')];
  for (let rep = 0; rep < 2; rep++) {
    $('zRep').textContent = String(rep + 1);
    for (let s = 0; s < 8; s++) {
      slots.forEach((x, j) => x.classList.toggle('on', j === s));
      notes.forEach(n => n.classList.toggle('on', n.dataset.s === String(s)));
      await wait(250);
    }
  }
  slots.forEach(x => x.classList.remove('on')); notes.forEach(n => n.classList.remove('on'));
  await wait(200);
  anim(z, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: from, offset: 0.75 }, { opacity: 0, transform: from }], { duration: 500, easing: 'cubic-bezier(.6,0,.4,1)' });
  await wait(520);
  sel.classList.remove('on');
}

const SCENES = [sceneImport, sceneBoard, scenePlayer, sceneExpand];
let scene = 0, visible = true;
async function go(k: number) {
  const id = ++run;
  resetAll();
  if (k >= 1) boardDone(); else boardTiles.concat(boardLabels).forEach(t => { t.style.opacity = ''; t.style.transform = ''; });
  if (k >= 3) playerReady();
  try {
    for (let i = k; i < SCENES.length; i++) { scene = i; setStep(i); await SCENES[i](); }
    // Fim: desvanece e recomeça do princípio
    canvas.classList.add('fade'); await wait(600);
    if (id === run) go(0);
  } catch (e) { if (e !== CANCEL) throw e; }
}
function pause() { run++; }

/** Sem animação: cada passo mostra o seu resultado, parado. */
function staticScene(k: number) {
  run++; resetAll(); scene = k; setStep(k);
  if (k === 0) { canvas.dataset.scene = 'import'; $('dropzone').classList.add('reading-on'); $('readFill').style.transform = 'scaleX(1)'; $('readText').textContent = '✓ 52 bars · 4 sections found'; }
  if (k === 1) { canvas.dataset.scene = 'board'; boardDone(); }
  if (k >= 2) { canvas.dataset.scene = 'player'; playerReady(); noteInPlayer(); mpTiles.get(14)?.classList.add('on'); }
  if (k === 3) { const z = $('zoom'); z.style.opacity = '1'; z.style.transform = 'none'; }
}

steps.forEach((li, k) => li.querySelector('button')!.addEventListener('click', () => (reduce ? staticScene(k) : go(k))));

if (reduce) staticScene(2);
else {
  new IntersectionObserver(([e]) => { const was = visible; visible = e.isIntersecting; if (visible && !was) go(scene); if (!visible) pause(); }, { threshold: 0.2 }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : visible && go(scene)));
  go(0);
}
