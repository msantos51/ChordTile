// Grava as cenas do vídeo a partir do site real (npm run dev, sem Supabase: tudo desbloqueado).
// Cada cena: frames nítidos (CDP screencast, com a hora de cada frame) + o som do leitor (MediaRecorder),
// depois juntos num MP4 a 30 fps em video/public/clips/<cena>.mp4.
// Uso: npm run dev (na raiz) e depois: node video/scripts/record.cjs [http://localhost:5173] [cena…]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5173';
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('http'));
const OUT = path.join(__dirname, '..', 'public', 'clips'), TMP = path.join(__dirname, '..', '.tmp');
const VIEW = { width: 412, height: 780 }, SCALE = 960 / 412; // 960×1816 px no vídeo (a montagem enquadra a parte que interessa)
const PLAYER = ['tab', 'chart', 'outro']; // cenas no leitor normal (as outras no Tile by Tile)
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Cenas: `setup` prepara (não é gravado), `act` é o que se grava, durante `secs` segundos. */
const SCENES = {
  tab: { secs: 8, setup: async p => { await p.click('#vTab'); }, act: async p => { await p.click('#playBtn'); } },
  chart: { secs: 9, setup: async p => { await p.click('#vChart'); }, act: async p => { await p.click('#playBtn'); } },
  learn: { secs: 10, setup: async p => { await enterLearn(p, 0); }, act: async p => { await p.click('#learnPlay'); } },
  recall: { secs: 10, setup: async p => { await enterLearn(p, 1); }, act: async p => { await p.click('#learnPlay'); } },
  join: { secs: 10, setup: async p => { await enterLearn(p, 4); }, act: async p => { await p.click('#learnPlay'); } },
  // Só o som (o refrão) para o fim do vídeo
  outro: { secs: 12, setup: async p => { await p.click('#vChart'); await p.click('.bar[data-bar="21"]'); }, act: async p => { await p.click('#playBtn'); } },
};

async function enterLearn(p, step) {
  await p.click('#learnCtaBtn'); await sleep(700);
  if (await p.locator('#learnIntroStart').isVisible()) { await p.click('#learnIntroStart'); await sleep(500); }
  for (let i = 0; i < step; i++) { await p.click('#learnNext'); await sleep(350); }
  await p.evaluate(() => scrollTo({ top: 0 })); await sleep(600);
}

async function record(browser, name, scene) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true });
  await ctx.addInitScript({ path: path.join(__dirname, 'audiotap.js') });
  const p = await ctx.newPage(); p.on('pageerror', e => console.error(name, 'page error:', e.message));
  await p.goto(BASE + '/player?sample');
  await p.waitForFunction(() => /Ready to play/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 30000 });
  // O rodapé do site não faz parte do que se quer mostrar
  await p.addStyleTag({ content: '.site-foot { display: none !important; }' });
  await p.selectOption('#trackQuick', { label: 'Guitar' }); await sleep(1200);
  await scene.setup(p); await sleep(800);
  // Acorda o som antes de gravar (o AudioContext só existe depois de tocar uma vez)
  await p.click(PLAYER.includes(name) ? '#playBtn' : '#learnPlay'); await sleep(400);
  await p.click(PLAYER.includes(name) ? '#playBtn' : '#learnPlay'); await sleep(300);
  if (name === 'outro') { await p.click('.bar[data-bar="21"]'); await sleep(400); }
  else if (PLAYER.includes(name)) { await p.click('#stopBtn').catch(() => {}); await sleep(400); }
  else { await p.evaluate(() => scrollTo({ top: 0 })); }
  const dir = path.join(TMP, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(p), frames = [];
  cdp.on('Page.screencastFrame', async f => {
    const file = path.join(dir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64')); frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await p.waitForFunction(() => !!window.__tap);
  const audioStart = (await p.evaluate(() => window.__recStart())) / 1000;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 960, maxHeight: 1818, everyNthFrame: 1 });
  await sleep(250);
  await scene.act(p);
  await sleep(scene.secs * 1000);
  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  fs.writeFileSync(path.join(dir, 'audio.webm'), Buffer.from(await p.evaluate(() => window.__recStop()), 'base64'));
  await ctx.close();

  // Frames com a duração real de cada um → vídeo a 30 fps; o som alinhado pela hora de início
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.t ?? end) - f.t).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
  fs.writeFileSync(path.join(dir, 'frames.txt'), list);
  const offset = frames[0].t - audioStart; // >0: o som começou antes do primeiro frame
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'),
    '-ss', String(Math.max(0, offset)), '-i', path.join(dir, 'audio.webm'),
    '-vf', 'fps=30,scale=960:1816:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow',
    '-c:a', 'aac', '-b:a', '256k', '-shortest', path.join(OUT, name + '.mp4')]);
  console.log(`${name}: ${frames.length} frames, ${(end - frames[0].t).toFixed(1)} s, audio offset ${offset.toFixed(3)} s`);
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [name, scene] of Object.entries(SCENES)) if (!ONLY.length || ONLY.includes(name)) await record(browser, name, scene);
  await browser.close();
})();
