// Ledger sync test suite (v66). Usage:
//   NODE_PATH=<path to playwright> node synctest.js
// Loads ../.. /index.html in a phone-sized Chromium with a pretend GitHub
// for the private ledger-sync repo. Nothing here touches the network:
// every non-file request is aborted except api.github.com, which is faked.
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m); };
const p = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
const back = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const ahead = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

const gh = { pack: null, sha: 'sha-1', puts: [], failAuth: false };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = s => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

const SEED = (opts) => {
  const syncOn = opts && opts.syncOn;
  return `(() => {
    localStorage.clear();
    const txns = [
      {id:'t1', date:'${back(2)}', dir:'out', amount:18.45, desc:'Tesco', cat:'groceries', acct:'wgbp'},
      {id:'t2', date:'${back(1)}', dir:'in', amount:450, desc:'Acme Payroll', cat:'income', acct:'wgbp'}
    ];
    localStorage.setItem('ledger:accounts', JSON.stringify([{id:'wgbp', name:'Wise GBP', type:'current', opening:1800, openingDate:'${back(180)}'}]));
    localStorage.setItem('ledger:txns', JSON.stringify(txns));
    localStorage.setItem('ledger:cats', JSON.stringify([
      {id:'groceries', name:'Groceries', kind:'spend', colour:'#4aa87a'},
      {id:'income', name:'Income', kind:'income', colour:'#4aa87a'},
      {id:'other', name:'Other', kind:'spend', colour:'#6b7684'}]));
    localStorage.setItem('ledger:budgets', JSON.stringify({groceries:450}));
    localStorage.setItem('ledger:rules', JSON.stringify([{match:'tesco', cat:'groceries'}]));
    localStorage.setItem('ledger:recurring', JSON.stringify([{id:'r1', name:'Spotify', amount:11.99, cadence:'monthly', nextDue:'${ahead(30)}', acct:'wgbp', cat:'subs'}]));
    localStorage.setItem('ledger:assets', JSON.stringify([{id:'a1', name:'Index fund', initial:4000, initialDate:'${back(170)}', contribs:[], values:[{date:'${back(2)}', value:5900}]}]));
    localStorage.setItem('ledger:invest', JSON.stringify({trades:[{id:'tr1', ext:'cb:1', src:'coinbase', cat:'crypto', date:'${back(10)}', ts:'${back(10)} 12:00:00', sym:'BTC', kind:'buy', qty:0.01, gbp:500}], cats:[{id:'crypto', name:'Crypto', type:'crypto'}], byValue:{}, prices:{'crypto:BTC':{gbp:60000, at:new Date().toISOString()}}}));
    localStorage.setItem('ledger:impmap', JSON.stringify({cols:{date:0, amount:1}, fmt:'ymd'}));
    localStorage.setItem('ledger:settings', JSON.stringify({lastBackup:'${back(3)}', currency:'GBP'${syncOn ? ", syncEnabled:true" : ''}}));
    ${syncOn ? `localStorage.setItem('ledger:sync-token', JSON.stringify('test-token'));` : ''}
  })()`;
};

async function openSync(browser, { syncOn = true, remote = null } = {}) {
  gh.pack = remote; gh.sha = 'sha-1'; gh.puts = []; gh.failAuth = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript({ content: SEED({ syncOn }) });
  await ctx.route('**/sw.js', r => r.abort());
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname === 'api.github.com') {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, accept' }, body: '' });
      // v69: the daily cloud backup writes backups/ledger-backup.json in the same
      // repo. That file is not the sync file: answer it separately.
      if (!u.pathname.endsWith('/ledger-sync.json')) {
        gh.other = (gh.other || 0) + 1;
        if (r.request().method() === 'PUT') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"content":{"sha":"bk-1"}}' });
        return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"message":"Not Found"}' });
      }
      if (gh.failAuth) return r.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
      if (r.request().method() === 'GET') {
        if (!gh.pack) return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"message":"Not Found"}' });
        return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ sha: gh.sha, content: b64(gh.pack) }) });
      }
      if (r.request().method() === 'PUT') {
        const body = JSON.parse(r.request().postData());
        gh.puts.push({ auth: r.request().headers().authorization, body });
        if (body.sha && body.sha !== gh.sha) return r.fulfill({ status: 409, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"message":"conflict"}' });
        gh.pack = unb64(body.content); gh.sha = 'sha-' + (gh.puts.length + 1);
        return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ content: { sha: gh.sha } }) });
      }
      return r.fulfill({ status: 405, body: '' });
    }
    if (u.protocol === 'file:') return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  // The harness aborts every network request (offline by design), so the
  // app's own fetches — exchange rates, live coin prices — log "Failed to
  // load resource". Those are the harness, not the app: only count real
  // JS errors (pageerror) and other console errors.
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(2500);
  // Close anything the app opened on its own (check-in flow, sheets).
  await page.evaluate(() => (document.querySelectorAll('.backdrop').forEach(b => b.classList.remove('open', 'closing')), (typeof ciOpen !== 'undefined' && ciOpen) ? (ciOpen = false, weekFlow = false, document.getElementById('ci').hidden = true, document.body.classList.remove('ci-open')) : 0));
  const q = (f, a) => page.evaluate(f, a);
  const savedTxns = () => page.evaluate(() => JSON.parse(localStorage.getItem('ledger:txns')));
  const openData = async () => {
    const already = await page.evaluate(() => document.getElementById('set-data-backdrop').classList.contains('open'));
    if (already) { await page.waitForTimeout(200); return; }
    await page.evaluate(() => document.querySelectorAll('.backdrop').forEach(b => b.classList.remove('open', 'closing')));
    await page.click('#tb-more'); await page.waitForTimeout(300);
    await page.click('.set-cat[data-set="data"]'); await page.waitForTimeout(300);
  };
  return { page, ctx, errs, q, savedTxns, openData };
}

(async () => {
  const browser = await chromium.launch();
  const now = Date.now();
  const museTxn = { id: 'm1', text: undefined, date: back(0), dir: 'out', amount: 9.99, desc: 'Pret — from Muse', cat: 'eatingout', acct: 'wgbp', upd: now - 1000 };
  delete museTxn.text;
  const remotePack = {
    __ledgerSync: 1, version: 5, updatedAt: new Date().toISOString(), updatedBy: 'muse', schema: 1,
    txns: [museTxn], budgets: { groceries: 450, eatingout: 200 }, cats: [], rules: [],
    accts: [], assets: [], recur: [],
    invest: { trades: [], cats: [], byValue: {} }, impmap: null
  };

  // 1. Off by default: Settings shows the sync section, switched off.
  let o = await openSync(browser, { syncOn: false });
  await o.openData();
  ok(await o.q(() => !!document.getElementById('t-sync')), 'Settings has a Sync with Muse switch');
  ok(await o.q(() => document.getElementById('t-sync').textContent === 'Off'), 'Sync is off by default');
  ok(await o.q(() => document.getElementById('sync-state').textContent.indexOf('Off') === 0), 'Status says Off');
  ok(await o.q(() => document.getElementById('sync-setup').style.display === 'none'), 'Token box hidden while off');
  ok(o.errs.length === 0, 'No JS errors with sync off ' + o.errs.join(' | '));
  await o.ctx.close();

  // 2. On, with a remote transaction from Muse: opening pulls it in and
  // pushes this phone's transactions up, merged — nothing lost either way.
  o = await openSync(browser, { syncOn: true, remote: remotePack });
  await o.page.waitForTimeout(3500);   // auto-sync on open (2s) + round trip
  let got = await o.savedTxns();
  ok(got.some(x => x.id === 'm1'), 'A transaction Muse added appears in Ledger after opening');
  ok(got.some(x => x.id === 't1'), 'This phone’s transaction is still there after the merge');
  ok(gh.puts.length >= 1, 'The merged copy was pushed back to the private repo');
  const lastPut = gh.puts.length ? unb64(gh.puts[gh.puts.length - 1].body.content) : null;
  ok(lastPut && lastPut.__ledgerSync === 1 && lastPut.txns.some(x => x.id === 'm1') && lastPut.txns.some(x => x.id === 't1'), 'Pushed file has both transactions');
  ok(lastPut && !('prices' in (lastPut.invest || {})) && !('settings' in lastPut), 'Synced file has no price cache and no settings');
  ok(lastPut && lastPut.budgets && lastPut.budgets.eatingout === 200 && lastPut.budgets.groceries === 450, 'Budgets merge: Muse’s new budget kept, phone’s kept');
  ok(gh.puts.every(p => p.auth === 'Bearer test-token'), 'Every sync call carries the token in the header');
  ok(gh.puts.every(p => JSON.stringify(p.body).indexOf('test-token') < 0), 'The token is never written into the synced file');
  await o.openData();
  ok(await o.q(() => document.getElementById('sync-state').textContent.indexOf('Last synced') === 0), 'Status shows Last synced');
  ok(o.errs.length === 0, 'No JS errors after auto-sync ' + o.errs.join(' | '));

  // 3. A transaction added on the phone reaches the repo on Sync now.
  await o.q(() => { txns.push({ id: 't3', date: new Date().toISOString().slice(0, 10), dir: 'out', amount: 4.5, desc: 'Boots', cat: 'shopping', acct: 'wgbp' }); save(K.txns, txns); render(); });
  await o.q(() => window.__ledgerSync.now({ manual: true }));
  await o.page.waitForTimeout(600);
  ok(gh.pack.txns.some(x => x.id === 't3'), 'A transaction added on the phone is in the repo after Sync now');

  // 4. Deleting on the phone deletes in the repo — but only because the
  // remote copy had not changed it.
  await o.q(() => { txns = txns.filter(t => t.id !== 't1'); save(K.txns, txns); render(); });
  await o.q(() => window.__ledgerSync.now({ manual: true }));
  await o.page.waitForTimeout(600);
  ok(!gh.pack.txns.some(x => x.id === 't1'), 'A transaction deleted on the phone is gone from the repo too');
  ok(gh.pack.txns.some(x => x.id === 'm1'), 'Deleting one transaction does not take the others with it');

  // 4b. (v71) Savings pots sync both ways, and a file with no pots list never wipes them.
  await o.q(() => { pots.push({ id: 'potP', name: 'Trip fund', target: 3000, saved: 400, acct: null, date: null }); savePots(); render(); });
  await o.q(() => window.__ledgerSync.now({ manual: true })); await o.page.waitForTimeout(600);
  ok(Array.isArray(gh.pack.pots) && gh.pack.pots.some(p => p.id === 'potP'), 'A pot added on the phone is in the synced file');
  gh.pack = Object.assign({}, gh.pack, { version: (gh.pack.version || 1) + 1, updatedBy: 'muse', pots: gh.pack.pots.concat([{ id: 'potM', name: 'New laptop', target: 1200, saved: 100, acct: null, date: null }]) }); gh.sha = 'sha-muse-1';
  await o.q(() => window.__ledgerSync.now({ manual: true })); await o.page.waitForTimeout(600);
  ok(await o.q(() => pots.some(p => p.id === 'potM') && JSON.parse(localStorage.getItem('ledger:pots')).some(p => p.id === 'potM')), 'A pot Muse adds appears in Ledger');
  ok(await o.q(() => pots.some(p => p.id === 'potP')), 'The phone\u2019s own pot is still there after the merge');
  gh.pack = Object.assign({}, gh.pack, { version: (gh.pack.version || 1) + 1 }); delete gh.pack.pots; gh.sha = 'sha-old-file';
  await o.q(() => window.__ledgerSync.now({ manual: true })); await o.page.waitForTimeout(600);
  ok(await o.q(() => pots.length === 2), 'A file with no pots list (older app) does not delete any pots');
  ok(Array.isArray(gh.pack.pots) && gh.pack.pots.length === 2, 'and the next push puts them back in the file');

  // 5. Merge rules, as pure function checks (no network).
  const merged = await o.q(() => {
    const loc = { __ledgerSync: 1, version: 2, txns: [{ id: 'x1', desc: 'One edited here', amount: 5, upd: 500 }, { id: 'x2', desc: 'Two', amount: 6 }], budgets: { groceries: 450 }, cats: [], rules: [], accts: [], assets: [], recur: [], invest: { trades: [], cats: [], byValue: {} }, impmap: null };
    const rem = { __ledgerSync: 1, version: 3, txns: [{ id: 'x1', desc: 'One', amount: 5 }, { id: 'x2', desc: 'Two edited there', amount: 7, upd: 600 }], budgets: { groceries: 400 }, cats: [], rules: [], accts: [], assets: [], recur: [], invest: { trades: [], cats: [], byValue: {} }, impmap: null };
    const h = n => { let x = 5381; const s = JSON.stringify(n); for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x.toString(36); };
    const sn = { txns: { x1: h({ id: 'x1', desc: 'One', amount: 5 }), x2: h({ id: 'x2', desc: 'Two', amount: 6 }) }, budgets: { groceries: h(400) }, cats: {}, rules: '', accts: {}, assets: {}, recur: {}, invest: { trades: {}, cats: {}, byValue: {} }, impmap: '' };
    return window.__ledgerSync.merge(loc, rem, sn);
  });
  ok(merged.pack.txns.find(n => n.id === 'x1').desc === 'One edited here', 'Transaction changed only on the phone keeps the phone copy');
  ok(merged.pack.txns.find(n => n.id === 'x2').desc === 'Two edited there', 'Transaction changed only remotely keeps the remote copy');
  ok(merged.pack.budgets.groceries === 450, 'Budget changed only on the phone keeps the phone value');
  const both = await o.q(() => {
    const loc = { __ledgerSync: 1, version: 2, txns: [{ id: 'x1', desc: 'Older edit', amount: 5, upd: 500 }], budgets: { groceries: 450 }, cats: [], rules: [], accts: [], assets: [], recur: [], invest: { trades: [], cats: [], byValue: {} }, impmap: null };
    const rem = { __ledgerSync: 1, version: 3, txns: [{ id: 'x1', desc: 'Newer edit', amount: 5, upd: 900 }], budgets: { groceries: 400 }, cats: [], rules: [], accts: [], assets: [], recur: [], invest: { trades: [], cats: [], byValue: {} }, impmap: null };
    const h = n => { let x = 5381; const s = JSON.stringify(n); for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x.toString(36); };
    const sn = { txns: { x1: h({ id: 'x1', desc: 'Original', amount: 5 }) }, budgets: { groceries: h(300) }, cats: {}, rules: '', accts: {}, assets: {}, recur: {}, invest: { trades: {}, cats: {}, byValue: {} }, impmap: '' };
    return window.__ledgerSync.merge(loc, rem, sn);
  });
  ok(both.pack.txns[0].desc === 'Newer edit', 'Same transaction changed both ways keeps the newer copy');
  ok(both.pack.budgets.groceries === 450, 'Same budget changed both ways keeps the phone’s copy');
  ok(both.conflicts.length === 2, 'Both-ways changes are reported as conflicts, not hidden');

  // 6. A bad token fails cleanly and says so in Settings.
  await o.q(() => { localStorage.setItem('ledger:sync-token', JSON.stringify('wrong-token')); });
  gh.failAuth = true;
  const res = await o.q(() => window.__ledgerSync.now({ manual: true }));
  ok(res && res.ok === false && res.reason === 'auth', 'A rejected token returns auth, not a crash');
  await o.openData();
  ok(await o.q(() => document.getElementById('sync-state').textContent.indexOf('did not accept the token') >= 0), 'Settings says the token was not accepted');
  ok((await o.savedTxns()).some(x => x.id === 'm1'), 'A failed sync never wipes local transactions');
  ok(o.errs.length === 0, 'No JS errors after a failed sync ' + o.errs.join(' | '));
  await o.ctx.close();

  // 7. The token is never in a backup file, and the price cache never syncs.
  o = await openSync(browser, { syncOn: true, remote: remotePack });
  await o.page.waitForTimeout(3500);
  ok(await o.q(() => JSON.stringify(ledgerSection()).indexOf('test-token') < 0), 'Backup file never contains the token');
  ok(await o.q(() => JSON.stringify(ledgerSection()).indexOf('ledger:sync-token') < 0), 'Backup file never mentions the token key');
  ok(await o.q(() => { const inv = JSON.parse(localStorage.getItem('ledger:invest')); return !!(inv && inv.prices && inv.prices['crypto:BTC']); }), 'Local price cache is still on the phone after a sync');
  ok(await o.q(() => { const p = window.__ledgerSync.pack(); return p.invest && !('prices' in p.invest) && p.invest.trades.length === 1; }), 'Sync pack carries trades but never the price cache');
  // 8. Editing a transaction stamps upd; untouched ones stay unstamped.
  ok(await o.q(() => { txns = txns.map(t => t.id === 't1' ? Object.assign({}, t, { amount: 19.45 }) : t); save(K.txns, txns); const one = txns.find(t => t.id === 't1'); const two = txns.find(t => t.id === 't2'); return typeof one.upd === 'number' && one.upd <= Date.now() && typeof two.upd === 'undefined'; }), 'An edited transaction is stamped upd, an untouched one is not');
  ok(o.errs.length === 0, 'No JS errors at the end ' + o.errs.join(' | '));
  await o.ctx.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL suite crashed: ' + e.message); process.exit(1); });
