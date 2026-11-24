// v72 pull down to refresh. Run from tests/ in the usual layout (../app = build under test).
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const APP = path.resolve(process.cwd(), '..', 'app');
const html0 = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const sw0 = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
const seed = fs.readFileSync(path.join(__dirname, 'seed.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  let swText = sw0, offline = false;
  await pg.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ body: html0, contentType: 'text/html' });
    if (u.pathname === '/sw.js') return offline ? r.abort() : r.fulfill({ body: swText, contentType: 'text/javascript' });
    const f = path.join(APP, u.pathname); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' }); });
  await pg.goto('http://localhost/');
  await pg.evaluate(s => { localStorage.clear(); eval(s); const st = JSON.parse(localStorage.getItem('ledger:settings') || '{}');
    st.weekDismissed = todayYMD(); st.monthSnooze = todayYMD(); localStorage.setItem('ledger:settings', JSON.stringify(st)); }, seed);
  await pg.reload(); await pg.waitForTimeout(3000);
  const q = (f, a) => pg.evaluate(f, a);
  const before = await q(() => JSON.stringify(Object.keys(localStorage).sort().filter(k => k.startsWith('ledger:') && !/settings|homefold|sync|invpx/.test(k)).map(k => [k, localStorage.getItem(k)])));

  ok(await q(() => APP_VERSION) === Number(sw0.match(/ledger-v(\d+)/)[1]), 'App knows its own version (matches sw.js)');
  ok(await q(() => !!document.getElementById('ptr')), 'Pull indicator is on the page');

  // Real touch drag from the top
  const drag = async (dist) => {
    const cdp = await ctx.newCDPSession(pg);
    const ev = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] });
    await ev('touchStart', 150);
    for (let i = 1; i <= 10; i++) await ev('touchMove', 150 + dist * i / 10);
    const h = await q(() => document.getElementById('ptr').offsetHeight);
    await ev('touchEnd', 0); return h;
  };
  await q(() => { window.__calls = []; const s = refreshInvPrices; refreshInvPrices = async () => { window.__calls.push('prices'); }; window.__ptrReload = () => window.__calls.push('reload'); });
  const h = await drag(60);
  ok(h > 0, 'Indicator follows the finger (' + h + 'px)');
  await pg.waitForTimeout(600);
  ok(await q(() => window.__calls.length === 0), 'A short pull does nothing');

  await drag(220); await pg.waitForTimeout(1200);
  ok(await q(() => window.__calls.includes('prices') && !window.__calls.includes('reload')), 'A long pull refreshes (same version: no reload)');
  ok(await q(() => /Up to date/.test(document.body.textContent)), 'Says "Up to date"');
  ok(await q(() => document.getElementById('ptr').offsetHeight === 0), 'Indicator goes away after');

  // Sheet open: ignored
  await q(() => { window.__calls = []; document.querySelector('.backdrop').classList.add('open'); });
  await drag(220); await pg.waitForTimeout(800);
  ok(await q(() => window.__calls.length === 0), 'Ignored while a sheet is open');
  await q(() => document.querySelector('.backdrop').classList.remove('open'));

  // Scrolled down: ignored
  await q(() => { window.__calls = []; document.body.style.minHeight = '3000px'; window.scrollTo(0, 400); });
  await drag(220); await pg.waitForTimeout(800);
  ok(await q(() => window.__calls.length === 0), 'Ignored when not at the top');
  await q(() => window.scrollTo(0, 0));

  // Sync on: pull syncs
  await q(() => { window.__calls = []; const s = syncNow; settings.syncEnabled = true; syncEnabled = () => true; syncNow = async (o) => { window.__calls.push('sync:' + (o && o.quiet)); return { ok: true, pulled: 3 }; }; });
  await q(() => window.__pullRefresh()); await pg.waitForTimeout(300);
  ok(await q(() => window.__calls.includes('sync:true')), 'Sync with Muse runs on pull when sync is on');
  ok(await q(() => /3 new from Muse/.test(document.body.textContent)), 'Says how many came from Muse');

  // Newer version: reload, once
  swText = sw0.replace(/ledger-v(\d+)/, (m, n) => 'ledger-v' + (Number(n) + 1));
  await q(() => { window.__calls = []; });
  let r = await q(() => window.__pullRefresh());
  ok(r.did === 'reload' && await q(() => window.__calls.includes('reload')), 'Newer Ledger online: reloads (loading screen shows)');
  r = await q(() => window.__pullRefresh());
  ok(r.did === 'refresh', 'Never loops: second pull on the same version just refreshes');

  offline = true;
  r = await q(() => window.__pullRefresh());
  ok(r.did === 'offline', 'Offline: keeps what is on the phone');

  const after = await q(() => JSON.stringify(Object.keys(localStorage).sort().filter(k => k.startsWith('ledger:') && !/settings|homefold|sync|invpx/.test(k)).map(k => [k, localStorage.getItem(k)])));
  ok(before === after, 'Saved data unchanged by pulling');
  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(`\npulltest: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
