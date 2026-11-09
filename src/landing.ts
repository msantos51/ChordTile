// Página inicial: apresenta o método Tile by Tile (e o leitor, em segundo plano). Não guarda nada no browser:
// "Learn a song by heart" leva ao leitor, onde a música é carregada e guardada na conta (sem conta, pede primeiro para criar uma grátis).
import './fonts';
import './landing.css';
import { accountsEnabled, storedAccount } from './app/session-hint';

// Menu de cima: com sessão iniciada, "Your account" em vez de "Sign in"; sem contas (cópia local), nada
const navAccount = document.getElementById('navAccount') as HTMLAnchorElement;
if (!accountsEnabled) navAccount.hidden = true;
else if (storedAccount()) navAccount.textContent = 'Your account';

/** Para onde vai quem quer carregar uma música: o leitor ("My songs"), ou criar conta primeiro. */
const loadUrl = () => (accountsEnabled && !storedAccount() ? '/player?signup' : '/player?load');
document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b => b.addEventListener('click', () => { location.href = loadUrl(); }));

// ---------- Animação: o método Tile by Tile, em 4 cenas ----------
// 1. Learn: a tab do refrão aparece e o cursor percorre-a em loop; o quadrado de cada compasso acende.
// 2. Play it without: a tab desaparece e toca-se só pelos quadrados (com a cor e o acorde, como no leitor),
//    3 voltas. No fim o refrão fica "de cor" (✓) e a percentagem sobe.
// 3. Join it up: o refrão junta-se ao verso (já sabido) e um só cursor percorre os dois seguidos.
// 4. Know it by heart: as secções que faltam acendem, a percentagem chega a 100% e os quadrados fazem uma onda.
// Os passos de baixo acompanham e saltam para a cena ao clicar. Só se animam transform/opacity/filter
// (Web Animations); pára fora do ecrã e, com "reduzir movimento", cada passo mostra o seu resultado parado.
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
const VERSE = 1, CHORUS = 2;
const BARS = SECTIONS.map(s => s.chords.length), TOTAL = BARS.reduce((a, b) => a + b, 0);
/** % da música sabida de cor quando se sabem as primeiras `n` secções. */
const pctOf = (n: number) => Math.round((BARS.slice(0, n).reduce((a, b) => a + b, 0) / TOTAL) * 100);
// Guitarra: cordas de 0 (mi agudo) a 5 (mi grave); casa de cada corda em cada acorde (null = não toca)
const SHAPES: Record<string, (number | null)[]> = {
  Am: [0, 1, 2, 2, 0, null], F: [1, 1, 2, 3, 3, 1], C: [0, 1, 0, 2, 3, null],
  G: [3, 0, 0, 0, 2, 3], Dm: [1, 3, 2, 0, null, null], E: [0, 0, 1, 2, 2, 0],
};
/** Na tab em miniatura cada compasso mostra 4 tempos de um arpejo: o baixo e as cordas de cima. */
function notesOf(chord: string): Note[] {
  const sh = SHAPES[chord], root = sh.reduce<number>((a, f, l) => (f != null ? l : a), 0);
  return [root, 2, 1, 0].map((l, i) => ({ s: i * 2, l, f: sh[l] ?? 0 }));
}

// ---- Construção (uma vez) ----
const tile = (chord: string, n: number, cls: string) => {
  const t = document.createElement('div'); t.className = cls; t.dataset.n = String(n);
  const c = document.createElement('span'); c.textContent = chord; t.append(c); return t;
};
// O refrão: 8 quadrados (2 linhas de 4), com a cor e o acorde desde o início, como no esquema do leitor
const chorusTiles = SECTIONS[CHORUS].chords.map(([c, n]) => tile(c, n, 'mq known'));
$('mTiles').append(...chorusTiles);
// A tab do refrão: 2 sistemas de 4 compassos
const tabBars: HTMLElement[] = [];
for (let r = 0; r < 2; r++) {
  const sys = document.createElement('div'); sys.className = 'm-sys';
  sys.innerHTML = '<div class="m-lines">' + [0, 1, 2, 3, 4, 5].map(l => '<i style="top:' + l * 7 + 'px"></i>').join('') + '</div>';
  for (let i = 0; i < 4; i++) {
    const chord = SECTIONS[CHORUS].chords[r * 4 + i][0];
    const b = document.createElement('div'); b.className = 'm-bar'; b.style.left = i * 25 + '%';
    b.innerHTML = notesOf(chord).map(n => '<span class="m-fret" style="left:' + ((n.s + 0.5) / 8) * 100 + '%;top:' + n.l * 7 + 'px">' + n.f + '</span>').join('');
    sys.append(b); tabBars.push(b);
  }
  $('mSystems').append(sys);
}
/** A música toda numa faixa: um segmento por secção (largura = compassos). */
function strip(el: HTMLElement) {
  return SECTIONS.map((s, k) => {
    const seg = document.createElement('i'); seg.style.flex = String(BARS[k]); seg.textContent = s.name; el.append(seg); return seg;
  });
}
const segs = strip($('mStrip')), bigSegs = strip($('hStrip'));
// Juntar: verso e refrão em pequeno, já com as cores
const joinTiles = [VERSE, CHORUS].flatMap((k, j) => {
  const box = document.querySelectorAll<HTMLElement>('.j-tiles')[j];
  return SECTIONS[k].chords.map(([c, n]) => { const t = tile(c, n, 'jq known'); box.append(t); return t; });
});
// A música toda: todos os quadrados
const allTiles = SECTIONS.flatMap(s => s.chords.map(([c, n]) => { const t = tile(c, n, 'hq known'); $('hTiles').append(t); return t; }));

// ---- Escala da tela para caber no painel ----
new ResizeObserver(() => {
  const k = Math.min(stage.clientWidth / 560, stage.clientHeight / 440, 1.3);
  canvas.style.setProperty('--k', String(Math.max(0.3, k)));
}).observe(stage);

// ---- Motor: esperas canceláveis e animações ----
let run = 0;
const CANCEL = Symbol('cancel');
const wait = (ms: number) => { const id = run; return new Promise<void>((ok, ko) => setTimeout(() => (id === run ? ok() : ko(CANCEL)), ms)); };
const EASE = 'cubic-bezier(.16,1,.3,1)', EASE_IO = 'cubic-bezier(.65,0,.35,1)';
const linearOk = CSS.supports('animation-timing-function', 'linear(0, 1)');
/** Mola amortecida amostrada como easing linear() (cai para uma cúbica com ligeiro excesso). */
function spring(zeta: number, omega: number, fallback: string) {
  if (!linearOk) return fallback;
  const wd = omega * Math.sqrt(1 - zeta * zeta), pts: string[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, x = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
    pts.push(i === 32 ? '1' : x.toFixed(3));
  }
  return 'linear(' + pts.join(', ') + ')';
}
const POP = spring(0.55, 11, 'cubic-bezier(.34,1.56,.64,1)');
const anim = (el: Element, k: Keyframe[], o: KeyframeAnimationOptions) => el.animate(k, { fill: 'forwards', easing: EASE, ...o });

/** Tempos das cenas (ms). As barras dos passos usam as mesmas contas, por isso acabam com a cena. */
const T = { enter: 450, bar1: 260, bar2: 200, hide: 650, run: 210, join: 140, wave: 28, hold: 800, count: 14, tick: 40 };
const COUNT_MS = T.count * T.tick;
const DUR = [
  T.enter + 8 * T.bar1 + 8 * T.bar2 + 250,
  T.hide + 24 * T.run + COUNT_MS + T.hold,
  T.enter + 250 + 550 + 400 + 16 * T.join + T.hold,
  T.enter + 200 + COUNT_MS + 250 + 600 + 24 * T.wave + T.hold,
];
const NAMES = ['Learn it with the tab', 'Play it without', 'Join it up', 'Know it by heart'];
const SCENE_IDS = ['learn', 'recall', 'join', 'heart'];
function setStep(k: number) {
  const no = $('sceneNo'), name = $('sceneName');
  if (name.textContent !== NAMES[k]) {
    no.textContent = '0' + (k + 1); name.textContent = NAMES[k];
    if (!reduce) [no, name].forEach((e, j) => e.animate([{ opacity: 0, transform: 'translateY(60%)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 700, delay: j * 60, easing: EASE, fill: 'backwards' }));
  }
  canvas.dataset.scene = SCENE_IDS[k];
  steps.forEach((li, j) => {
    li.classList.toggle('on', j === k); li.classList.toggle('done', j < k);
    const bar = li.querySelector<HTMLElement>('.prog i')!;
    bar.getAnimations().forEach(a => a.cancel());
    if (j === k && !reduce) bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: DUR[k], easing: 'linear', fill: 'forwards' });
  });
}

/** Faixa da música: as primeiras `known` secções sabidas e, a seguir, a próxima com contorno. */
function setStrip(list: HTMLElement[], known: number) {
  list.forEach((s, k) => { s.classList.toggle('k', k < known); s.classList.toggle('n', k === known); });
}
/** Voltas: `done` já feitas (cheias) e `now` a que se está a tocar (contorno forte). */
const setRuns = (done: number, text: string, now = -1) => {
  $('mRunText').textContent = text;
  $('mRuns').querySelectorAll('i').forEach((p, j) => { p.classList.toggle('on', j < done); p.classList.toggle('now', j === now); });
};

/** Volta tudo ao estado inicial (cena 1), sem animação. */
function resetAll() {
  canvas.querySelectorAll('*').forEach(e => e.getAnimations().forEach(a => a.cancel()));
  canvas.classList.remove('fade');
  $('mTab').classList.remove('gone'); $('mCur').classList.remove('on');
  chorusTiles.forEach(t => t.classList.remove('on'));
  $('mOk').classList.remove('on');
  setRuns(0, 'Loop · 75%');
  setStrip(segs, CHORUS); setStrip(bigSegs, CHORUS + 1);
  $('mPct').textContent = pctOf(CHORUS) + '%'; $('hPct').textContent = String(pctOf(CHORUS + 1));
  joinTiles.forEach(t => t.classList.remove('on'));
  $('jLink').style.transform = '';
}
/** Estado no fim da cena 2 (o refrão já de cor), para saltar para as cenas 3 e 4. */
function chorusKnown() {
  $('mTab').classList.add('gone');
  $('mOk').classList.add('on');
  setRuns(3, 'By heart'); setStrip(segs, CHORUS + 1); $('mPct').textContent = pctOf(CHORUS + 1) + '%';
}

/** Conta de `from` até `to` num elemento (a percentagem a subir). */
async function count(el: HTMLElement, from: number, to: number, suffix: string) {
  for (let v = 1; v <= T.count; v++) { el.textContent = Math.round(from + ((to - from) * v) / T.count) + suffix; await wait(T.tick); }
}
const light = (list: HTMLElement[], i: number) => list.forEach((t, j) => t.classList.toggle('on', j === i));

async function sceneLearn() {
  await wait(T.enter);
  const cur = $('mCur'); cur.classList.add('on');
  for (const [loop, speed] of [[1, 75], [2, 100]] as const) {
    setRuns(0, 'Loop ' + loop + '/2 · ' + speed + '%');
    for (let i = 0; i < 8; i++) {
      const b = tabBars[i], ms = loop === 1 ? T.bar1 : T.bar2;
      light(chorusTiles, i);
      const sys = b.parentElement as HTMLElement, x = sys.offsetLeft + b.offsetLeft, y = sys.offsetTop, w = b.offsetWidth;
      anim(cur, [{ transform: `translate(${x}px, ${y}px)` }, { transform: `translate(${x + w - 2}px, ${y}px)` }], { duration: ms, easing: 'linear' });
      await wait(ms);
    }
  }
  cur.classList.remove('on'); light(chorusTiles, -1);
  await wait(250);
}

async function sceneRecall() {
  // A tab sobe e desfoca até desaparecer: fica só o esquema (o texto muda logo, com a tab)
  $('mTab').classList.add('gone');
  setRuns(0, 'Run 1 of 3 · no tab', 0);
  await wait(T.hide);
  for (let r = 0; r < 3; r++) {
    setRuns(r, 'Run ' + (r + 1) + ' of 3 · no tab', r);
    for (let i = 0; i < 8; i++) {
      light(chorusTiles, i);
      await wait(T.run);
    }
    setRuns(r + 1, 'Run ' + (r + 1) + ' of 3 · no tab');
  }
  light(chorusTiles, -1);
  setRuns(3, 'By heart');
  // O refrão já se toca de cor: ✓ e um pequeno salto em cascata nos quadrados
  $('mOk').classList.add('on');
  chorusTiles.forEach((t, j) => anim(t, [{ transform: 'none' }, { transform: 'translateY(-6px) scale(1.06)', offset: 0.4 }, { transform: 'none' }], { duration: 500, delay: j * 35, easing: EASE_IO, fill: 'none' }));
  // O refrão passa a estar de cor na faixa da música e a percentagem sobe
  setStrip(segs, CHORUS + 1);
  anim(segs[CHORUS], [{ transform: 'scaleY(1.5)' }, { transform: 'none' }], { duration: 500, easing: POP });
  await count($('mPct'), pctOf(CHORUS), pctOf(CHORUS + 1), '%');
  await wait(T.hold);
}

async function sceneJoin() {
  // O verso (já sabido) aparece com a cena; o refrão chega da direita e encaixa a seguir
  const card = $('jB');
  anim(card, [{ opacity: 0, transform: 'translateX(70px) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 650, delay: T.enter + 250, easing: POP, fill: 'both' });
  await wait(T.enter + 250 + 550);
  anim($('jLink'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 350 });
  await wait(400);
  // Um só cursor: o verso e logo a seguir o refrão, sem parar
  for (let i = 0; i < joinTiles.length; i++) { light(joinTiles, i); await wait(T.join); }
  light(joinTiles, -1);
  await wait(T.hold);
}

async function sceneHeart() {
  // Os quadrados da música toda entram em cascata enquanto a percentagem sobe
  allTiles.forEach((t, j) => anim(t, [{ opacity: 0, transform: 'translateY(10px) scale(.7)' }, { opacity: 1, transform: 'none' }],
    { duration: 450, delay: T.enter + j * 22, easing: POP, fill: 'both' }));
  await wait(T.enter + 200);
  setStrip(bigSegs, SECTIONS.length);
  anim(bigSegs[SECTIONS.length - 1], [{ transform: 'scaleY(1.5)' }, { transform: 'none' }], { duration: 500, easing: POP });
  await count($('hPct'), pctOf(CHORUS + 1), 100, '');
  await wait(250);
  // Uma onda pelos quadrados da música toda
  allTiles.forEach((t, j) => anim(t, [{ transform: 'none' }, { transform: 'translateY(-10px) scale(1.08)', offset: 0.4 }, { transform: 'none' }], { duration: 600, delay: j * T.wave, easing: EASE_IO, fill: 'none' }));
  await wait(600 + allTiles.length * T.wave + T.hold);
}

const SCENES = [sceneLearn, sceneRecall, sceneJoin, sceneHeart];
let scene = 0, visible = true;
async function go(k: number) {
  const id = ++run;
  resetAll();
  if (k >= 2) chorusKnown();
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
  if (k === 0) { light(chorusTiles, 3); setRuns(0, 'Loop · 75%'); }
  if (k >= 1) chorusKnown();
  if (k === 2) $('jLink').style.transform = 'scaleX(1)';
  if (k === 3) { setStrip(bigSegs, SECTIONS.length); $('hPct').textContent = '100'; }
}

steps.forEach((li, k) => li.querySelector('button')!.addEventListener('click', () => (reduce ? staticScene(k) : go(k))));

if (reduce) staticScene(1);
else {
  new IntersectionObserver(([e]) => { const was = visible; visible = e.isIntersecting; if (visible && !was) go(scene); if (!visible) pause(); }, { threshold: 0.2 }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : visible && go(scene)));
  // Primeiro deixa a página entrar (título e painel), depois começa a demonstração
  run++; const first = run;
  resetAll(); setStep(0);
  setTimeout(() => { if (first === run) go(0); }, 900);
}
