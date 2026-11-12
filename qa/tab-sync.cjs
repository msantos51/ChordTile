// Sincronização do leitor com a tablatura e o esquema (Playwright), nos casos que já falharam:
// loop + clique na tablatura, repetições, Stop/fim da música, Tile by Tile e troca de música.
// Uso: npm run dev  e depois  node qa/tab-sync.cjs http://localhost:5173/
// (sem Supabase configurado, como em `npm run dev`, tudo fica desbloqueado e nada precisa de conta)
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.argv[2] || 'http://localhost:5173/';
const TMP = path.join(os.tmpdir(), 'chordtile-qa'); fs.mkdirSync(TMP, { recursive: true });
const results = [];
const test = async (name, fn) => { try { const note = await fn(); results.push(['PASS', name, note || '']); } catch (e) { results.push(['FAIL', name, String(e.message || e).slice(0, 300)]); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const CAPTURE = () => {
  window.__apis = [];
  const iv = setInterval(() => {
    const A = window.alphaTab && window.alphaTab.AlphaTabApi; if (!A || A.__wrapped) return;
    class W extends A { constructor(...a) { super(...a); window.__apis.push(this); } } W.__wrapped = true;
    Object.defineProperty(window.alphaTab, 'AlphaTabApi', { value: W, configurable: true, writable: true }); clearInterval(iv);
  }, 1);
};
// 4 compassos repetidos (‖: 1 2 3 4 :‖) na secção A e 4 normais na secção B
const TEX = '\\title "Repeats" \\tempo 240 . \\section "A" \\ro 0.6.4 2.5.4 2.4.4 0.6.4 | 3.6.4 2.5.4 0.4.4 3.6.4 | 0.5.4 2.5.4 2.4.4 0.5.4 | \\rc 2 3.6.4 2.5.4 0.4.4 3.6.4 | \\section "B" 5.6.4 2.5.4 2.4.4 5.6.4 | 3.6.4 2.5.4 0.4.4 3.6.4 | 0.5.4 2.5.4 2.4.4 0.5.4 | 3.6.4 2.5.4 0.4.4 3.6.4';
const BAR = 3840;

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(CAPTURE);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack).split('\n').slice(1, 4).join(' < ')));
  const S = () => p.evaluate(() => { const a = window.__apis.at(-1), r = a.playbackRange; return {
    state: a.playerState, tick: a.tickPosition, range: r ? [r.startTick, r.endTick] : null, looping: a.isLooping,
    bar: document.querySelector('.bar.playing')?.dataset.bar ?? null, now: document.getElementById('nowTitle').textContent,
    status: document.getElementById('status').textContent, loopBtn: document.getElementById('loopBtn').getAttribute('aria-pressed') }; });
  const ready = async () => {
    await p.waitForFunction(() => document.querySelectorAll('#chart .bar').length > 0, null, { timeout: 20000 });
    await p.waitForFunction(() => { const a = window.__apis.at(-1); return a && a.isReadyForPlayback && !document.getElementById('playBtn').disabled && document.getElementById('tabLoading').hidden; }, null, { timeout: 40000 });
    await p.waitForTimeout(400);
  };
  const tabPoint = (i, dx = 0.5) => p.evaluate(([i, dx]) => { const a = window.__apis.at(-1), bb = a.boundsLookup.findMasterBarByIndex(i).visualBounds;
    const r = document.querySelector('#tab .at-surface').getBoundingClientRect(); return { x: r.left + bb.x + bb.w * dx, y: r.top + bb.y + bb.h / 2 }; }, [i, dx]);
  const clickTab = async (i, dx) => { const pt = await tabPoint(i, dx); await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(500); };
  const pause = async () => { await p.evaluate(() => window.__apis.at(-1).pause()); await p.waitForTimeout(250); };
  const blur = () => p.evaluate(() => document.activeElement && document.activeElement.blur());
  const loadRepeats = async () => {
    const bytes = await p.evaluate(tex => { const at = window.alphaTab, imp = new at.importer.AlphaTexImporter(), s = new at.Settings();
      imp.initFromString(tex, s); return Array.from(new at.exporter.Gp7Exporter().export(imp.readScore(), s)); }, TEX);
    fs.writeFileSync(TMP + '/repeats.gp', Buffer.from(bytes));
    await p.setInputFiles('#fileInput', TMP + '/repeats.gp');
    await p.waitForFunction(() => document.getElementById('songTitle').textContent === 'Repeats', null, { timeout: 10000 }); await ready();
    // Ao abrir um ficheiro pergunta-se como o tocar (Tile by Tile ou só a tab): aqui, só a tab
    if (await p.locator('#modePick').isVisible()) await p.keyboard.press('Escape');
  };

  await p.goto(BASE + 'player?sample'); await ready();
  const gated = await p.evaluate(() => document.getElementById('loopBtn').classList.contains('locked'));
  if (gated) { console.log('SKIP: this build has accounts on (features locked without an account). Run against `npm run dev`.'); await b.close(); return; }

  await test('Section loop survives a click on the tab inside the section', async () => {
    await p.locator('.section[data-sec="1"] .sbtn').click(); await p.waitForTimeout(1200);
    const a = await S(); ok(a.range && a.looping, 'loop not set: ' + JSON.stringify(a));
    await clickTab(7);
    const c = await S();
    ok(c.range && c.range[0] === a.range[0] && c.range[1] === a.range[1], 'range lost after the click: ' + JSON.stringify(c));
    ok(c.looping && /looping VERSE/.test(c.status), 'not looping any more: ' + JSON.stringify(c));
    ok(c.bar === '7' && c.tick >= 7 * BAR && c.tick < 8 * BAR + 2000, 'not at the clicked bar: ' + JSON.stringify(c));
    return 'range ' + c.range.join('–') + ', playing from bar 8';
  });
  await test('Click on the tab outside the looped section leaves the loop (leader and site agree)', async () => {
    await p.evaluate(() => { document.getElementById('tabScroll').scrollTop = 0; }); await p.waitForTimeout(200);
    await clickTab(1);
    const c = await S();
    ok(!c.range && !c.looping && c.loopBtn === 'false' && !/looping/.test(c.status), JSON.stringify(c));
    ok(c.bar === '1', 'chart not on bar 2: ' + JSON.stringify(c));
  });
  await test('Dragging over the tab does not leave a hidden play range', async () => {
    await pause();
    const from = await tabPoint(0, 0.2), to = await tabPoint(2, 0.6);
    await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move((from.x + to.x) / 2, to.y, { steps: 4 }); await p.mouse.move(to.x, to.y, { steps: 4 }); await p.mouse.up();
    await p.waitForTimeout(400);
    const c = await S(); ok(!c.range, 'range left behind: ' + JSON.stringify(c));
  });
  await test('Press on the tab, release outside it: the click still ends (no stuck selection)', async () => {
    const from = await tabPoint(2, 0.3);
    await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(from.x, 20, { steps: 5 }); await p.mouse.up();
    await p.waitForTimeout(300);
    // Passar o rato pela tablatura sem botão: se o clique tivesse ficado preso, isto criava uma seleção
    const over = await tabPoint(3, 0.5), over2 = await tabPoint(0, 0.5);
    await p.mouse.move(over.x, over.y, { steps: 3 }); await p.mouse.move(over2.x, over2.y, { steps: 6 }); await p.waitForTimeout(200);
    const sel = await p.evaluate(() => [...document.querySelectorAll('#tab .at-selection div')].filter(d => d.offsetWidth > 0).length);
    const c = await S(); ok(!c.range && sel === 0, 'selection: ' + sel + ' ' + JSON.stringify(c));
    ok(c.bar === '2' && c.tick >= 2 * BAR && c.tick < 3 * BAR, 'not at the pressed bar: ' + JSON.stringify(c));
  });
  await test('Loop button off clears "looping" from the status', async () => {
    await p.locator('.section[data-sec="0"] .sbtn').click(); await p.waitForTimeout(600); await pause();
    await p.click('#loopBtn'); await p.waitForTimeout(200);
    const c = await S(); ok(!/looping/.test(c.status) && !c.range && !c.looping, JSON.stringify(c));
  });
  await test('Stop with a section loop on: chart and tab go to the start of the section', async () => {
    await p.locator('.section[data-sec="2"] .sbtn').click(); await p.waitForTimeout(1500);
    await p.click('#stopBtn'); await p.waitForTimeout(500);
    const c = await S(); ok(c.state === 0 && c.bar === '20' && /CHORUS · bar 21/.test(c.now), JSON.stringify(c));
    ok(c.range && c.tick >= c.range[0] && c.tick < c.range[0] + 10, 'player not at the section start');
    await p.click('#loopBtn');
  });
  await test('End of the song: player, chart and progress bar all go back to the start', async () => {
    await p.selectOption('#speed', '125');
    const n = await p.locator('#chart .bar').count();
    await p.locator('#chart .bar').nth(n - 1).click(); await p.waitForTimeout(300);
    await p.click('#playBtn');
    await p.waitForFunction(() => window.__apis.at(-1).playerState === 1, null, { timeout: 5000 });
    await p.waitForFunction(() => window.__apis.at(-1).playerState === 0, null, { timeout: 15000 }); await p.waitForTimeout(600);
    const c = await S(); ok(c.bar === null && /bar 1$/.test(c.now) && c.tick < 10, JSON.stringify(c));
    const w = await p.evaluate(() => document.getElementById('progressFill').style.width); ok(w === '0%', 'progress ' + w);
    await blur(); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
    ok((await S()).bar === '0', 'ArrowRight after the end did not go to bar 1');
    await p.selectOption('#speed', '100');
  });
  await test('Arrow keys still move by bar after clicking a button with the mouse', async () => {
    await p.click('#playBtn'); await p.waitForTimeout(400); await p.click('#playBtn'); await p.waitForTimeout(300);
    const before = +(await S()).bar; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
    ok(+(await S()).bar === before + 1, 'bar did not advance');
  });

  await test('Tile by Tile: a click on the tab keeps the run inside the section', async () => {
    await p.click('#learnCtaBtn'); await p.waitForTimeout(700);
    if (await p.locator('#learnIntro:not([hidden])').count()) { await p.click('#learnIntroStart'); await p.waitForTimeout(300); }
    const a = await S(); ok(a.range && a.range[0] === 0 && a.range[1] === 4 * BAR, 'step range: ' + JSON.stringify(a));
    await clickTab(2);
    const c = await S(); ok(c.range && c.range[1] === 4 * BAR && !c.looping, 'range lost: ' + JSON.stringify(c));
    ok(c.bar === '2', 'not on the clicked bar');
  });
  await test('Tile by Tile: arrow keys cannot leave the section being learnt', async () => {
    await blur(); for (let k = 0; k < 6; k++) await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
    const c = await S(); ok(c.bar === '3' && c.range && c.range[1] === 4 * BAR, JSON.stringify(c));
    for (let k = 0; k < 8; k++) await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300);
    ok((await S()).bar === '0', 'did not stop at the first bar');
  });
  await test('Tile by Tile: a run ends at the end of the section and counts', async () => {
    await p.selectOption('#learnSpeed', '125');
    await p.click('#learnPlay');
    await p.waitForFunction(() => /1 of 3/.test(document.getElementById('learnRuns').textContent), null, { timeout: 25000 });
    const c = await S(); ok(c.tick <= 4 * BAR + 10, 'played past the section: ' + JSON.stringify(c));
    await p.click('#learnPlay'); await p.waitForTimeout(300); // cancela a contagem da volta seguinte
    await pause();
  });
  await test('Tile by Tile: an expanded bar loops only itself, its loops are not runs of the step', async () => {
    const runs = () => p.evaluate(() => document.getElementById('learnRuns').textContent);
    const before = await runs();
    await clickTab(1); await p.click('#tsExpand'); await p.waitForTimeout(400);
    await p.click('#bmPlay');
    let min = Infinity, max = 0; const t0 = Date.now();
    while (Date.now() - t0 < 7000) { const c = await S(); min = Math.min(min, c.tick); max = Math.max(max, c.tick); await p.waitForTimeout(80); } // 3 ou mais voltas
    ok(min >= BAR - 30 && max <= 2 * BAR + 30, 'left the bar: ticks ' + min + '…' + max);
    ok((await runs()) === before, 'bar loops counted as runs: ' + await runs());
    ok(await p.evaluate(() => document.getElementById('learnOverlay').hidden), 'count-in/overlay shown over the window');
    await p.click('#bmClose'); await p.waitForTimeout(500);
    const c = await S(); ok(c.state === 0 && c.range && c.range[0] === 0 && c.range[1] === 4 * BAR && !c.looping, 'step range not restored: ' + JSON.stringify(c));
  });
  await test('Opening another (shorter) song while in Tile by Tile works', async () => {
    await loadRepeats();
    ok(await p.locator('#chart .bar').count() === 8, 'bars: ' + await p.locator('#chart .bar').count());
    ok(!(await p.evaluate(() => document.body.classList.contains('learning'))), 'still in Tile by Tile');
    const c = await S(); ok(!c.range && c.bar === null, JSON.stringify(c));
  });

  await test('Repeats: looping the last bar of a repeat loops only that bar', async () => {
    await p.selectOption('#speed', '100');
    await clickTab(3); await p.click('#tsLoop'); await p.waitForTimeout(500);
    const c = await S(); ok(c.range && c.range[0] === 3 * BAR && c.range[1] === 4 * BAR, 'range ' + JSON.stringify(c.range));
    await p.waitForTimeout(2500); // vários loops (1 compasso = 1 s a 240 bpm)
    const d = await S(); ok(d.bar === '3' && d.tick >= 3 * BAR && d.tick <= 4 * BAR, 'left the bar: ' + JSON.stringify(d));
    await p.click('#tsLoop'); await pause();
  });
  await test('Repeats: a section loop plays the section with its repeat', async () => {
    await p.locator('.section[data-sec="0"] .sbtn').click(); await p.waitForTimeout(500);
    const c = await S(); ok(c.range && c.range[0] === 0 && c.range[1] === 8 * BAR, 'range ' + JSON.stringify(c.range));
    await p.locator('.section[data-sec="1"] .sbtn').click(); await p.waitForTimeout(500);
    const d = await S(); ok(d.range && d.range[0] === 8 * BAR && d.range[1] === 12 * BAR, 'range B ' + JSON.stringify(d.range));
    await p.locator('.section[data-sec="1"] .sbtn').click(); await pause();
  });
  await test('Repeats: the chart follows the second pass (bar 1 again after bar 4)', async () => {
    await p.locator('#chart .bar').nth(3).click(); await p.waitForTimeout(300);
    await p.click('#playBtn');
    await p.waitForFunction(() => window.__apis.at(-1).tickPosition > 4.3 * 3840, null, { timeout: 8000 }); await p.waitForTimeout(150);
    const c = await S(); await pause();
    ok(c.bar === '0', 'chart on bar ' + c.bar + ' at tick ' + c.tick);
  });
  await test('Expanding a bar while the song plays pauses it; the bar loops only itself', async () => {
    await p.locator('#chart .bar').nth(1).click(); await p.click('#playBtn'); await p.waitForTimeout(500);
    await p.click('#bbExpand'); await p.waitForTimeout(500);
    ok((await S()).state === 0, 'still playing behind the window');
    await p.click('#bmPlay'); await p.waitForTimeout(1500);
    const c = await S(); ok(c.state === 1 && c.range && c.range[0] === BAR && c.range[1] === 2 * BAR, JSON.stringify(c));
    await p.click('#bmNext'); await p.waitForTimeout(700);
    const d = await S(); ok(d.state === 1 && d.range[0] === 2 * BAR && d.range[1] === 3 * BAR, 'next bar: ' + JSON.stringify(d));
    await p.click('#bmClose'); await p.waitForTimeout(400);
    const e = await S(); ok(e.state === 0 && !e.range && !e.looping, 'after closing: ' + JSON.stringify(e));
  });
  await test('No page errors', async () => { ok(!errors.length, errors.join(' | ')); });

  await b.close();
  for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '  — ' + note : ''));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
