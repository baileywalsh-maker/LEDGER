// Ledger daily cloud backup tests (v69). Usage, from inside the repo:
//   NODE_PATH=$(npm root -g) node _source/tests/cloudtest.js
// Loads ../../index.html with a pretend GitHub that keeps every version of
// backups/ledger-backup.json (like real git history). No real network.
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m); };
const p = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
const back = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const H = { 'access-control-allow-origin': '*' };

// The pretend repo: versions of the backup file, newest last.
const gh = { versions: [], puts: [], failAuth: false, syncGets: 0 };
const SEED = ({ syncOn, cloudDay, txnCount }) => `(() => {
  localStorage.clear();
  const txns = [];
  for (let i = 0; i < ${txnCount || 2}; i++) txns.push({id:'t'+i, date:'${back(2)}', dir:'out', amount:10+i, desc:'Shop '+i, cat:'groceries', acct:'wgbp'});
  localStorage.setItem('ledger:accounts', JSON.stringify([{id:'wgbp', name:'Wise GBP', type:'current', opening:1000, openingDate:'${back(60)}'}]));
  localStorage.setItem('ledger:txns', JSON.stringify(txns));
  localStorage.setItem('ledger:cats', JSON.stringify([{id:'groceries', name:'Groceries', kind:'spend', colour:'#4aa87a'}]));
  localStorage.setItem('ledger:settings', JSON.stringify({lastBackup:'${back(9)}', weekDismissed:'${back(0)}', monthSnooze:'${back(0)}', currency:'GBP'${syncOn ? ', syncEnabled:true' : ''}}));
  localStorage.setItem('ledger:lastbackupday', '${back(9)}');
  ${cloudDay ? `localStorage.setItem('ledger:cloudday', '${cloudDay}');` : ''}
  ${syncOn ? `localStorage.setItem('ledger:sync-token', JSON.stringify('test-token'));` : ''}
})()`;

async function open(browser, opts) {
  gh.puts = []; gh.failAuth = !!opts.failAuth;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (opts.seed !== false) await ctx.addInitScript({ content: `if(!sessionStorage.getItem('seeded')){ ${SEED(opts)}; sessionStorage.setItem('seeded','1'); }` });
  await ctx.route('**/sw.js', r => r.abort());
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url()), m = r.request().method();
    if (u.hostname !== 'api.github.com') return u.protocol === 'file:' ? r.continue() : r.abort();
    if (m === 'OPTIONS') return r.fulfill({ status: 200, headers: Object.assign({ 'access-control-allow-headers': 'authorization, content-type, accept' }, H), body: '' });
    if (gh.failAuth) return r.fulfill({ status: 401, headers: H, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
    if (u.pathname.endsWith('/ledger-sync.json')) { gh.syncGets++; return r.fulfill({ status: 404, headers: H, contentType: 'application/json', body: '{}' }); }
    if (u.pathname.endsWith('/commits')) {
      return r.fulfill({ status: 200, headers: H, contentType: 'application/json',
        body: JSON.stringify(gh.versions.slice().reverse().map(v => ({ sha: v.sha, commit: { author: { date: v.date } } }))) });
    }
    if (u.pathname.endsWith('/contents/backups/ledger-backup.json')) {
      if (m === 'GET') {
        const ref = u.searchParams.get('ref');
        const v = ref ? gh.versions.find(x => x.sha === ref) : gh.versions[gh.versions.length - 1];
        if (!v) return r.fulfill({ status: 404, headers: H, contentType: 'application/json', body: '{"message":"Not Found"}' });
        if (/raw/.test(r.request().headers().accept || '')) return r.fulfill({ status: 200, headers: H, contentType: 'text/plain', body: v.text });
        return r.fulfill({ status: 200, headers: H, contentType: 'application/json', body: JSON.stringify({ sha: v.sha }) });
      }
      if (m === 'PUT') {
        const body = JSON.parse(r.request().postData());
        gh.puts.push(body);
        const last = gh.versions[gh.versions.length - 1];
        if (last && body.sha !== last.sha) return r.fulfill({ status: 409, headers: H, contentType: 'application/json', body: '{"message":"sha mismatch"}' });
        const v = { sha: 'bk-' + (gh.versions.length + 1), date: opts.putDate || new Date().toISOString(), text: Buffer.from(body.content, 'base64').toString('utf8') };
        gh.versions.push(v);
        return r.fulfill({ status: 200, headers: H, contentType: 'application/json', body: JSON.stringify({ content: { sha: v.sha } }) });
      }
    }
    return r.fulfill({ status: 404, headers: H, body: '{}' });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(opts.wait || 8000);
  return { page, ctx, errs, q: (f, a) => page.evaluate(f, a) };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

  // 1. Sync off: nothing is sent, Settings says how to turn it on.
  let o = await open(browser, { syncOn: false });
  ok(gh.puts.length === 0, 'Sync off: no cloud backup is sent');
  ok(/Turn on Sync with Muse/.test(await o.q(() => document.getElementById('cloud-sub').textContent)), 'Sync off: Settings says to turn sync on');
  await o.ctx.close();

  // 2. Sync on: first open of the day saves one backup and counts as backed up.
  o = await open(browser, { syncOn: true, txnCount: 5, putDate: back(1) + 'T12:00:00Z' });
  ok(gh.puts.length === 1, 'First open of the day saves one cloud backup');
  const file = gh.versions[0] && JSON.parse(gh.versions[0].text);
  ok(file && file.__suite === 1 && Array.isArray(file.txns) && file.txns.length === 5, 'The cloud copy is a normal backup file with every transaction');
  ok(gh.versions[0] && !/test-token/.test(gh.versions[0].text), 'The token is never inside the backup');
  ok(/^Ledger backup \d{4}-\d{2}-\d{2}$/.test(gh.puts[0].message), 'Saved with a dated message');
  ok(await o.q(() => localStorage.getItem('ledger:lastbackupday') === todayYMD() && settings.lastBackup === todayYMD()), 'It counts as backed up today');
  ok(await o.q(() => !backupDue()), 'Backup is no longer due (pill turns Safe)');
  // Same day again: no second save.
  await o.page.reload(); await o.page.waitForTimeout(8000);
  ok(gh.puts.length === 1, 'Opening again the same day does not save again');
  await o.ctx.close();

  // 3. Next day: saves over the same file (with its sha), GitHub keeps both versions.
  o = await open(browser, { syncOn: true, txnCount: 7, cloudDay: back(1) });
  ok(gh.puts.length === 1 && gh.puts[0].sha === 'bk-1', 'Next day saves a new version over the same file');
  ok(gh.versions.length === 2, 'Both days are kept');

  // 4. Put back: list of days, pick the older one, preview, replace.
  await o.q(() => { document.querySelectorAll('.backdrop').forEach(b => b.classList.remove('open')); });
  await o.q(() => document.getElementById('do-cloud-putback').click());
  await o.page.waitForTimeout(1200);
  const rows = await o.q(() => document.querySelectorAll('#cloud-body [data-cloudsha]').length);
  ok(rows === 2, 'Put back lists one row per day (' + rows + ')');
  await o.q(() => document.querySelectorAll('#cloud-body [data-cloudsha]')[1].click());
  await o.page.waitForTimeout(1200);
  ok(await o.q(() => document.getElementById('restore-backdrop').classList.contains('open')), 'Picking a day opens the usual restore preview first');
  ok(await o.q(() => /5/.test(document.getElementById('restore-body').textContent)), 'The preview shows that day\'s contents (5 transactions)');
  ok(await o.q(() => txns.length === 7), 'Nothing changes until you confirm');
  await o.q(() => document.getElementById('restore-go').click());
  await o.page.waitForTimeout(800);
  ok(await o.q(() => txns.length === 5), 'Confirming puts that day back');
  ok(o.errs.length === 0, 'No errors (' + o.errs.join(' | ') + ')');
  await o.ctx.close();

  // 5. Bad token: nothing counts as backed up.
  gh.versions = [];
  o = await open(browser, { syncOn: true, failAuth: true });
  ok(gh.versions.length === 0 && await o.q(() => localStorage.getItem('ledger:lastbackupday') !== todayYMD()), 'Bad token: not counted as backed up');
  ok(o.errs.length === 0, 'Bad token fails quietly, no errors');
  await o.ctx.close();

  // 6. The manual Files backup still works and is the same file shape.
  o = await open(browser, { syncOn: false, wait: 2500 });
  const manual = await o.q(() => JSON.parse(backupPayloadText(true)));
  ok(manual.__suite === 1 && Array.isArray(manual.txns), 'Back up to Files still builds the same backup file');
  await o.ctx.close();

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
