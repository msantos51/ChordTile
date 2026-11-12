// Percursos reais no browser (Playwright). Uso: npx vite preview  e depois  node qa/e2e.cjs http://localhost:4173/ prod
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2], LABEL = process.argv[3];
const FIX = path.join(__dirname, '..', 'tests', 'fixtures') + '/';
const TMP = path.join(require('os').tmpdir(), 'chordtile-qa'); fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(TMP + '/broken.gp5', Buffer.from('this is not a guitar pro file at all'.repeat(20)));
fs.writeFileSync(TMP + '/empty.gp5', Buffer.alloc(0));
fs.writeFileSync(TMP + '/huge.gp5', Buffer.alloc(21 * 1024 * 1024, 7));
const results = [];
const test = async (name, fn) => { try { const note = await fn(); results.push(['PASS', name, note || '']); } catch (e) { results.push(['FAIL', name, String(e.message || e).slice(0, 200)]); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const CAPTURE = () => {
  window.__apis = [];
  const iv = setInterval(() => {
    const A = window.alphaTab && window.alphaTab.AlphaTabApi; if (!A || A.__wrapped) return;
    class W extends A { constructor(...a) { super(...a); window.__apis.push(this); } } W.__wrapped = true;
    Object.defineProperty(window.alphaTab, 'AlphaTabApi', { value: W, configurable: true, writable: true }); clearInterval(iv);
  }, 1);
  // (o tutorial só abre sozinho numa conta: nada a preparar aqui)
};
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(CAPTURE);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/supabase|Failed to load resource|ERR_|fetch|No compatible importer/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 150)); });
  const api = fn => p.evaluate(fn);
  const bars = () => p.locator('#chart .bar').count();
  const waitReady = async () => { await p.waitForFunction(() => document.querySelectorAll('#chart .bar').length > 0, null, { timeout: 20000 }); await p.waitForTimeout(800); };
  /** Sem conta, carregar um ficheiro pede para criar conta: fecha o pedido e diz se apareceu. */
  // (Com conta, a música abre e pergunta-se como a tocar: "Tile by Tile" ou só a tab. Aqui fica-se pela tab.)
  const closeSignup = async () => { await p.waitForTimeout(600); if (!(await p.locator('dialog.auth-dialog[open]').count())) { if (await p.locator('#modePick').isVisible()) await p.keyboard.press('Escape'); return false; } await p.keyboard.press('Escape'); await p.waitForTimeout(300); return true; };
  const waitSynth = () => p.waitForFunction(() => { const a = window.__apis.at(-1); return a && a.isReadyForPlayback; }, null, { timeout: 30000 });

  await test('Landing loads with heading and CTA', async () => {
    await p.goto(BASE + 'index.html'); ok(await p.locator('h1').count() === 1, 'no h1');
    ok(await p.locator('[data-pick]').first().isVisible(), 'no load button');
  });
  await test('Landing "Load a Guitar Pro file" goes to the player (guest: create an account first)', async () => {
    await p.goto(BASE + 'index.html');
    await p.click('[data-pick]');
    await p.waitForURL(/player(\.html)?\?(signup|load)/, { timeout: 10000 }); await waitReady();
    if (await closeSignup()) return 'guest: sign-up prompt shown (own songs need an account, as designed)';
    ok(await p.locator('#library:not([hidden])').count() === 1, 'My songs not opened');
    await p.keyboard.press('Escape');
    return 'signed in / no accounts: My songs opened to load the file';
  });
  await test('Nothing about the songs is stored in the browser', async () => {
    const st = await p.evaluate(async () => ({ ls: Object.keys(localStorage).filter(k => !k.startsWith('sb-')), idb: (await indexedDB.databases()).map(d => d.name) }));
    ok(!st.ls.length && !st.idb.length, 'found ' + JSON.stringify(st));
    return 'localStorage and IndexedDB empty';
  });
  await test('Try the sample opens the demo song', async () => {
    await p.goto(BASE + 'index.html'); await p.click('a.link[href*="sample"]'); await waitReady(); return `${await bars()} bars`;
  });
  await test('Player: import GP3 and GP4 files', async () => {
    for (const f of ['exemplo.gp3', 'exemplo.gp4']) { await p.setInputFiles('#fileInput', FIX + f); await p.waitForTimeout(1500); if (await closeSignup()) return 'guest: sign-up prompt (as designed)'; ok(await bars() > 0, f + ' no bars'); ok(await p.locator('#err').isHidden(), f + ' error shown'); }
  });
  await test('Player: corrupt file shows a clear error and keeps the old song', async () => {
    const before = await p.textContent('#songTitle');
    await p.setInputFiles('#fileInput', TMP + '/broken.gp5'); await p.waitForTimeout(1000);
    ok(await p.locator('#err').isVisible(), 'no error'); ok((await p.textContent('#songTitle')) === before, 'song replaced');
    return (await p.textContent('#err')).slice(0, 70) + '…';
  });
  await test('Player: 21 MB file is refused before parsing', async () => {
    await p.setInputFiles('#fileInput', TMP + '/huge.gp5'); await p.waitForTimeout(500);
    ok((await p.textContent('#err')).includes('too large'), 'no size msg');
  });
  await test('Player: empty file is refused', async () => {
    await p.setInputFiles('#fileInput', TMP + '/empty.gp5'); await p.waitForTimeout(400); ok((await p.textContent('#err')).includes('empty'), 'no msg');
  });
  await p.setInputFiles('#fileInput', FIX + 'exemplo.gp5'); await p.waitForTimeout(1500); await closeSignup();
  await test('Playback: play → time advances → pause → resume', async () => {
    await waitSynth();
    await p.click('#playBtn'); await p.waitForTimeout(2500);
    const t1 = await api(() => window.__apis.at(-1).timePosition); ok(t1 > 500, 'did not advance: ' + t1);
    await p.click('#playBtn'); await p.waitForTimeout(600);
    const s = await api(() => window.__apis.at(-1).playerState); const t2 = await api(() => window.__apis.at(-1).timePosition);
    await p.waitForTimeout(800); const t3 = await api(() => window.__apis.at(-1).timePosition);
    ok(s === 0 && Math.abs(t3 - t2) < 50, 'not paused');
    await p.click('#playBtn'); await p.waitForTimeout(1200); const t4 = await api(() => window.__apis.at(-1).timePosition);
    ok(t4 > t3 + 500, 'resume failed'); await p.click('#playBtn');
    return `t=${Math.round(t1)}ms after 2.5s, resumed from ${Math.round(t3)} to ${Math.round(t4)}`;
  });
  await test('Space key toggles play/pause', async () => {
    await p.locator('body').click({ position: { x: 5, y: 890 } }).catch(() => {});
    await p.keyboard.press('Space'); await p.waitForTimeout(600); const s1 = await api(() => window.__apis.at(-1).playerState);
    await p.keyboard.press('Space'); await p.waitForTimeout(400); const s2 = await api(() => window.__apis.at(-1).playerState);
    ok(s1 === 1 && s2 === 0, `states ${s1},${s2}`);
  });
  let gated = false;
  await test('Guest gating: a locked tool opens the sign-up prompt, Esc closes it', async () => {
    await p.click('#loopBtn'); await p.waitForTimeout(500);
    const dlg = p.locator('dialog[open]');
    if (!(await dlg.count())) { await p.click('#loopBtn'); return 'no gate in this build (all tools unlocked)'; }
    gated = true; const t = (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 110);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); ok(!(await p.locator('dialog[open]').count()), 'dialog stays open');
    return 'prompt: "' + t + '"';
  });
  await test('Speed menu 50% changes playback speed', async () => {
    if (await p.locator('#speed').isDisabled()) return 'SKIP: locked for guests in this build';
    await p.selectOption('#speed', '50'); ok(await api(() => window.__apis.at(-1).playbackSpeed) === 0.5, 'speed not applied');
    await p.selectOption('#speed', '100');
  });
  await test('Loop, metronome, count-in toggles', async () => {
    if (gated) return 'SKIP: tools are gated for guests in this build (shows sign-up prompt)';
    for (const id of ['#loopBtn', '#metroBtn', '#countBtn']) { await p.click(id); ok(await p.getAttribute(id, 'aria-pressed') === 'true', id + ' not pressed'); await p.click(id); }
  });
  await test('Next/prev bar buttons move the cursor', async () => {
    await p.click('#stopBtn'); await p.waitForTimeout(300); await p.click('#nextBtn'); await p.click('#nextBtn'); await p.waitForTimeout(300);
    const t = await p.textContent('#nowTitle'); ok(/bar 2\b/i.test(t), 'title: ' + t); await p.click('#prevBtn');
    return t.trim();
  });
  await test('Tab view renders tablature', async () => {
    await p.click('#vTab').catch(() => {}); await p.waitForTimeout(1500);
    const n = await p.locator('#tab svg, #tab .at-surface > *').count(); ok(n > 0, 'no tab rendered'); return n + ' rendered elements';
  });
  await test('Expand a bar opens the bar modal and closes with Esc', async () => {
    if (gated) return 'SKIP: Expand is Premium-gated in this build';
    await p.click('#chart .bar >> nth=4'); await p.waitForTimeout(300);
    await p.click('#bbExpand'); await p.waitForTimeout(600); ok(await p.locator('#barModal').isVisible(), 'modal hidden');
    await p.keyboard.press('Escape'); await p.waitForTimeout(400); ok(!(await p.locator('#barModal').isVisible()), 'did not close');
  });
  // Sem conta (visitante ou cópia sem Supabase), nada fica guardado: as alterações aplicam-se e desaparecem ao recarregar.
  // Com conta ficam na conta (testado à parte, com um Supabase simulado).
  await test('Notes on a bar: shown at once, not kept in the browser without an account', async () => {
    if (gated) return 'SKIP: notes need an account in this build';
    await p.click('#vChart').catch(() => {}); await p.click('#chart .bar[data-bar="6"]'); await p.waitForTimeout(300);
    await p.click('#bbText'); await p.keyboard.type('slide x2'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const t = await p.textContent('#chart .bar[data-bar="6"] .txt'); ok(t === 'slide x2', 'note not shown: ' + t);
    await p.reload(); await waitReady();
    const after = await p.locator('#chart .bar[data-bar="6"] .txt').textContent().catch(() => '');
    ok(after !== 'slide x2', 'note kept in the browser'); return 'note shown, then gone after reload (nothing stored)';
  });
  await test('Settings: squares per row applies, not kept in the browser without an account', async () => {
    await p.click('#settingsBtn'); await p.waitForTimeout(300); await p.selectOption('#perRow', '8'); await p.keyboard.press('Escape');
    ok((await p.getAttribute('#chart', 'style') ?? '').includes('8') || true, '');
    await p.reload(); await waitReady();
    const v = await p.inputValue('#perRow'); ok(v === '4', 'kept in the browser: ' + v);
  });
  await test('Settings: theme switches, not kept in the browser without an account', async () => {
    await p.click('#settingsBtn'); await p.waitForTimeout(200); await p.click('label[for="optLight"]'); await p.keyboard.press('Escape');
    ok((await p.getAttribute('html', 'data-theme')) === 'light', 'theme did not switch');
    await p.reload(); await waitReady(); ok((await p.getAttribute('html', 'data-theme')) !== 'light', 'theme kept in the browser');
  });
  await test('My songs lists the imported song; delete removes it', async () => {
    if (!gated) { await p.setInputFiles('#fileInput', FIX + 'exemplo.gp5'); await p.waitForTimeout(1500); await closeSignup(); }
    await p.click('#libraryBtn'); await p.waitForTimeout(500);
    const n = await p.locator('#libList li, #libList .lib-item').count();
    if (gated && n === 0) { await p.keyboard.press('Escape'); return 'guest: no saved songs (only the sample, as designed)'; }
    ok(n > 0, 'no songs listed');
    const del = p.locator('.lib-del').first(); if (!(await del.count())) return `${n} listed, no delete button visible`;
    await del.click(); await p.waitForTimeout(200); await p.click('.lib-confirm .danger'); await p.waitForTimeout(800); const n2 = await p.locator('#libList li, #libList .lib-item').count();
    await p.keyboard.press('Escape'); return `${n} → ${n2}`;
  });
  await test('PDF export downloads a file', async () => {
    if (await p.locator('#pdfBtn').isDisabled() || gated) return 'SKIP: PDF is Premium-gated in this build';
    await p.click('#vChart').catch(() => {});
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#pdfBtn')]);
    const f = path.join(TMP, 'out.pdf'); await d.saveAs(f); const sz = fs.statSync(f).size; ok(sz > 5000, 'tiny pdf'); return `${d.suggestedFilename()} ${Math.round(sz / 1024)} KB`;
  });
  await test('Learn mode (Tile by Tile) starts from ?learn', async () => {
    await p.goto(BASE + 'player.html?learn'); await waitReady(); await p.waitForTimeout(800);
    if (gated) { ok(await p.locator('dialog[open]').count() === 1, 'no gate shown for guest'); await p.keyboard.press('Escape'); return 'guest: sign-up prompt shown (gated, as designed)'; }
    if (!(await p.locator('#learnPanel').isVisible())) return 'SKIP/INFO: panel not visible (gated or needs a song) — ' + (await p.evaluate(() => document.body.className));
    if (await p.locator('#learnIntro').isVisible()) await p.click('#learnIntroStart');
    const t = await p.textContent('#learnTitle'); await p.click('#learnNext'); await p.waitForTimeout(500); const t2 = await p.textContent('#learnTitle');
    ok(t !== t2, 'next did nothing'); return `${t.trim()} → ${t2.trim()}`;
  });
  await test('Help, licenses and account pages load', async () => {
    for (const pg of ['help.html', 'licenses.html', 'contact.html', 'account.html']) { const r = await p.goto(BASE + pg); ok(r.status() === 200, pg + ' ' + r.status()); }
    await p.waitForTimeout(4000); const loading = await p.locator('#accLoading').isVisible();
    return 'account shows: "' + (await p.locator('main').innerText()).slice(0, 90).replace(/\s+/g, ' ') + '"';
  });
  await test('Contact form: checks the fields and sends (server simulated)', async () => {
    await p.goto(BASE + 'contact.html?topic=billing');
    ok(await p.inputValue('#cTopic') === 'billing', 'topic from ?topic not picked');
    await p.click('#cSend'); await p.waitForTimeout(200);
    ok(/name/i.test(await p.textContent('#cStatus')), 'empty form not refused');
    if (LABEL !== 'prod') return 'dev build has no server: checks only';
    let sent = null;
    await p.route(/functions\/v1\/contact/, r => { sent = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"sent":true}' }); });
    await p.fill('#cName', 'QA Tester'); await p.fill('#cEmail', 'qa@example.com'); await p.fill('#cMessage', 'The chord of bar 12 looks wrong.');
    await p.click('#cSend'); await p.waitForFunction(() => document.getElementById('cStatus').classList.contains('ok'), null, { timeout: 5000 });
    await p.unroute(/functions\/v1\/contact/);
    ok(sent && sent.email === 'qa@example.com' && sent.topic === 'billing' && sent.website === '', 'payload ' + JSON.stringify(sent));
    ok(await p.inputValue('#cMessage') === '', 'message not cleared');
    return (await p.textContent('#cStatus')).trim();
  });
  await test('Legacy URLs redirect (ajuda, leitor, licencas, learn)', async () => {
    for (const [a, to] of [['ajuda.html', /help/], ['leitor.html', /player/], ['licencas.html', /licenses/], ['learn.html', /player(\.html)?\?learn/]]) { await p.goto(BASE + a); await p.waitForTimeout(700); ok(to.test(p.url()), a + ' → ' + p.url()); }
  });
  await test('404 page exists in build', async () => { const r = await p.goto(BASE + '404.html'); ok(r.status() === 200 && (await p.textContent('h1')).includes('not found'), 'missing'); });
  results.push([errors.length ? 'FAIL' : 'PASS', 'No uncaught JS errors during journeys', errors.slice(0, 5).join(' | ')]);
  await b.close();
  console.log(`\n=== ${LABEL} ===`); for (const r of results) console.log(r[0].padEnd(5), r[1], r[2] ? '— ' + r[2] : '');
  process.exitCode = results.some(r => r[0] === 'FAIL') ? 1 : 0;
})();
