// Conta e sincronização dos dados (Playwright) com um Supabase simulado: as respostas do servidor são dadas
// aqui (page.route), por isso não toca em nenhuma conta nem base de dados verdadeira.
// Uso (o site tem de ser servido com este endereço de Supabase falso):
//   VITE_SUPABASE_URL=https://fakeproj.supabase.co VITE_SUPABASE_ANON_KEY=anon-key npx vite --port 5174
//   node qa/account-sync.cjs http://localhost:5174/
const { chromium } = require('playwright');
const fs = require('fs'), crypto = require('crypto'), nodePath = require('path');
const BASE = process.argv[2] || 'http://localhost:5174/', SB = 'https://fakeproj.supabase.co';
const FIX = nodePath.join(__dirname, '..', 'tests', 'fixtures') + '/', SAMPLE = nodePath.join(__dirname, '..', 'public', 'sample.gp5');
const UID = '11111111-2222-4333-8444-555555555555';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const session = () => ({ access_token: b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: UID, exp: now() + 3600, role: 'authenticated', aud: 'authenticated' }) + '.sig', token_type: 'bearer', expires_in: 3600, expires_at: now() + 3600, refresh_token: 'r',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', user_metadata: { name: 'Tester' }, app_metadata: {}, identities: [], created_at: new Date().toISOString() } });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const results = []; const ok = (c, m) => { if (!c) throw new Error(m); };
const test = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']); } catch (e) { results.push(['FAIL', name, String(e.message || e).slice(0, 400)]); } };

async function world(opts = {}) {
  const ID1 = 'Exemplo|Esquema de demonstração|52', ID2 = 'Sample song|Demo chart|52';
  const srv = { data: { 'mapa:theme': 'light', ['mapa:' + ID1]: { sections: [{ name: 'INTRO', start: 0 }, { name: 'VERSO', start: 4 }], texts: { 2: 'slide here' }, perRow: 4, track: 1 }, 'mapa:tour-visto': '1', ...(opts.data || {}) },
    songs: [{ id: ID1, file_name: 'exemplo.gp5', title: 'Exemplo', artist: 'Esquema de demonstração', bars: 52, added_at: new Date().toISOString(), opened_at: new Date().toISOString(), deleted_at: null }, ...(opts.second ? [{ id: ID2, file_name: 'exemplo.gp4', title: 'Sample song', artist: 'Demo chart', bars: 52, added_at: new Date().toISOString(), opened_at: new Date(Date.now() - 86400000).toISOString(), deleted_at: null }] : [])],
    log: [], failData: opts.failData || 0, plan: opts.plan || 'lifetime' };
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(s => { localStorage.setItem('sb-fakeproj-auth-token', JSON.stringify(s)); }, session());
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await ctx.route(SB + '/**', async route => {
    const rq = route.request(), u = new URL(rq.url()), m = rq.method(), path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    srv.log.push(m + ' ' + path + (m === 'POST' && path.endsWith('user_data') ? ' ' + rq.postData() : ''));
    const single = (rq.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (path === '/rest/v1/user_data') {
      if (m === 'GET') { if (srv.failData > 0) { srv.failData--; return route.abort('internetdisconnected'); } return json(Object.entries(srv.data).map(([key, value]) => ({ key, value }))); }
      if (m === 'POST') { for (const r of JSON.parse(rq.postData())) srv.data[r.key] = r.value; return json([], 201); }
      if (m === 'DELETE') return json([], 204);
    }
    if (path === '/rest/v1/songs') {
      if (m === 'GET') { const idq = u.searchParams.get('id'); const rows = srv.songs.filter(s => !idq || 'eq.' + s.id === idq);
        if (single) return rows[0] ? json(rows[0]) : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) });
        return json(rows.sort((a, b) => b.opened_at.localeCompare(a.opened_at))); }
      if (m === 'DELETE') { const idq = u.searchParams.get('id'); srv.songs = srv.songs.filter(s => 'eq.' + s.id !== idq); return json([], 204); }
      if (m === 'POST') { srv.songs.push({ ...JSON.parse(rq.postData()), }); return json([], 201); }
      return json([], 204);
    }
    if (path === '/rest/v1/entitlements') return json({ plan: srv.plan, trial_ends_at: new Date(Date.now() - 86400000 * 30).toISOString(), premium_until: null });
    if (path.startsWith('/storage/v1/object/list/')) return json([]);
    if (path.startsWith('/storage/v1/object/songs/')) {
      if (m === 'GET') return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.endsWith(sha(ID2)) ? SAMPLE : FIX + 'exemplo.gp5') });
      if (m === 'PUT') return opts.noFile ? json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400) : json({ Key: 'k', Id: 'i' });
      if (m === 'POST') return opts.limit ? json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 400) : json({ Key: 'k', Id: 'i' });
    }
    if (path === '/storage/v1/object/songs' && m === 'DELETE') return json([]);
    if (path.startsWith('/auth/v1/')) return json(session());
    return json({});
  });
  const ready = async () => {
    await p.waitForFunction(() => document.querySelectorAll('#chart .bar').length > 0, null, { timeout: 20000 });
    await p.waitForTimeout(600);
  };
  return { b, p, srv, errors, ready, ID1, ID2 };
}
const posts = srv => srv.log.filter(l => l.startsWith('POST /rest/v1/user_data'));

(async () => {
  await test('Signed in: opens the last song with its notes, sections, instrument and theme', async () => {
    const { b, p, srv, errors, ready } = await world();
    await p.goto(BASE + 'player'); await p.waitForFunction(() => document.getElementById('songTitle').textContent === 'Exemplo', null, { timeout: 20000 }); await ready();
    const st = await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, note: document.querySelector('.bar[data-bar="2"] .txt').textContent, secs: document.querySelectorAll('.section').length, track: document.getElementById('trackQuick').value, acct: document.getElementById('accountBtnText').textContent }));
    ok(st.theme === 'light' && st.note === 'slide here' && st.secs === 2 && st.track === '1' && st.acct === 'Tester', JSON.stringify(st));
    ok(!posts(srv).some(l => /mapa:theme/.test(l)), 'wrote prefs back on open: ' + posts(srv).join(' | '));
    ok(!errors.length, errors.join('|')); await b.close();
  });
  await test('An edit is saved to the account; leaving the page right after an edit still saves it', async () => {
    const { b, p, srv, ready, ID1 } = await world();
    await p.goto(BASE + 'player'); await p.waitForFunction(() => document.getElementById('songTitle').textContent === 'Exemplo', null, { timeout: 20000 }); await ready();
    await p.locator('.bar[data-bar="5"]').dblclick(); await p.keyboard.type('x2'); await p.keyboard.press('Enter');
    await p.waitForTimeout(2200);
    ok(srv.data['mapa:' + ID1].texts['5'] === 'x2', 'edit not saved: ' + JSON.stringify(srv.data['mapa:' + ID1].texts));
    const n = posts(srv).length;
    await p.locator('.bar[data-bar="6"]').dblclick(); await p.keyboard.type('mute'); await p.keyboard.press('Enter');
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await p.waitForTimeout(400); // muito menos do que os 1,5 s do envio normal
    ok(srv.data['mapa:' + ID1].texts['6'] === 'mute', 'exit save missing');
    await p.waitForTimeout(2500);
    ok(posts(srv).length === n + 1, 'sent twice: ' + (posts(srv).length - n));
    await b.close();
  });
  await test('A change made on another device appears when coming back to the tab (and local edits are kept)', async () => {
    const { b, p, srv, ready, ID1 } = await world();
    await p.goto(BASE + 'player'); await p.waitForFunction(() => document.getElementById('songTitle').textContent === 'Exemplo', null, { timeout: 20000 }); await ready();
    await p.waitForTimeout(10200);
    // outro dispositivo: nova nota, secção nova, tema escuro
    srv.data['mapa:' + ID1] = { ...srv.data['mapa:' + ID1], texts: { 2: 'slide here', 9: 'from my phone' }, sections: [{ name: 'INTRO', start: 0 }, { name: 'VERSO', start: 4 }, { name: 'PONTE', start: 20 }] };
    srv.data['mapa:theme'] = 'dark';
    // aqui: uma alteração local ainda por enviar (preferência)
    await p.evaluate(() => { const s = document.getElementById('tabPerRow'); s.value = '3'; s.dispatchEvent(new Event('change')); });
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, note: document.querySelector('.bar[data-bar="9"] .txt').textContent, secs: [...document.querySelectorAll('.mark')].map(m => m.textContent), rows: document.getElementById('tabPerRow').value }));
    ok(st.note === 'from my phone' && st.secs.join() === 'INTRO,VERSO,PONTE' && st.theme === 'dark', JSON.stringify(st));
    ok(st.rows === '3' && srv.data['mapa:tabPerRow'] === 3, 'local edit lost: ' + JSON.stringify([st.rows, srv.data['mapa:tabPerRow']]));
    await b.close();
  });
  await test('No connection when the page opens: nothing is overwritten, and it recovers by itself', async () => {
    const { b, p, srv, ready, ID1 } = await world({ failData: 5 });
    await p.goto(BASE + 'player'); await ready(); await p.waitForTimeout(2500);
    ok(!posts(srv).length, 'wrote before reading the account: ' + posts(srv).join(' | '));
    ok(srv.data['mapa:theme'] === 'light', 'theme overwritten');
    await p.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 40000 });
    await p.waitForTimeout(1500);
    ok(srv.data['mapa:theme'] === 'light' && srv.data['mapa:' + ID1].texts['2'] === 'slide here', 'account data damaged: ' + JSON.stringify(srv.data));
    ok(await p.evaluate(() => document.querySelector('.bar[data-bar="2"] .txt')?.textContent) === 'slide here', 'note not shown after recovering');
    ok(await p.evaluate(() => document.getElementById('tour').hidden), 'tutorial opened for someone who had seen it');
    await b.close();
  });
  await test('Deleting the open song opens the next one (and does not write its data back)', async () => {
    const { b, p, srv, ready, ID1 } = await world({ second: true });
    await p.goto(BASE + 'player'); await p.waitForFunction(() => document.getElementById('songTitle').textContent === 'Exemplo', null, { timeout: 20000 }); await ready();
    await p.click('#libraryBtn'); await p.waitForTimeout(600);
    await p.locator('.lib-item.cur .lib-del').click(); await p.locator('.lib-confirm .danger').click();
    await p.waitForFunction(() => document.getElementById('songTitle').textContent === 'Sample song', null, { timeout: 10000 });
    await p.waitForTimeout(2500);
    ok(await p.locator('.lib-item').count() === 1, 'library not updated');
    ok(!posts(srv).some(l => l.includes('"mapa:' + ID1 + '"') || l.includes('progress:' + ID1)), 'wrote the deleted song back: ' + posts(srv).join(' | '));
    await b.close();
  });
  await test('Loading again a song that is already in the account replaces the file (does not count as a new one)', async () => {
    const { b, p, srv, ready } = await world({ plan: 'trial', limit: true });
    await p.goto(BASE + 'player'); await p.waitForFunction(() => document.getElementById('songTitle').textContent === 'Exemplo', null, { timeout: 20000 }); await ready();
    await p.setInputFiles('#fileInput', FIX + 'exemplo.gp5'); await p.waitForTimeout(2000);
    const st = srv.log.filter(l => /storage\/v1\/object\/songs\//.test(l) && !l.startsWith('GET'));
    ok(st.length === 1 && st[0].startsWith('PUT'), 'storage calls: ' + st.join(' | '));
    ok(await p.locator('#paywall:not([hidden])').count() === 0, 'paywall shown for a song already saved');
    await b.close();
  });
  for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '  — ' + note : ''));
  process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
})();
