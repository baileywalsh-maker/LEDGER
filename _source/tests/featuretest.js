// v69 features: payday countdown, spending calendar, savings pots.
// Run from tests/ in the usual layout (../app/index.html is the build under test).
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const APP = path.resolve(process.cwd(), '..', 'app');
const html0 = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const seed = fs.readFileSync(path.join(__dirname, 'seed.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') return r.abort();
    if (u.pathname === '/') return r.fulfill({ body: html0, contentType: 'text/html' });
    const f = path.join(APP, u.pathname); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' }); });
  await pg.goto('http://localhost/');
  await pg.evaluate(s => { localStorage.clear(); eval(s); const st = JSON.parse(localStorage.getItem('ledger:settings') || '{}');
    st.weekDismissed = todayYMD(); st.monthSnooze = todayYMD(); localStorage.setItem('ledger:settings', JSON.stringify(st)); }, seed);
  await pg.reload(); await pg.waitForTimeout(2200);
  const q = (f, a) => pg.evaluate(f, a);

  // ---- payday ----
  const p = await q(() => { const p = paydayInfo(); if (!p) return null;
    const last = txns.filter(t => t.dir === 'in' && t.cat === 'income').map(t => t.date).sort().pop();
    const want = ymd(new Date(parseYMD(last).getTime() + 14 * 86400000));
    const cur = accts.filter(a => a.type === 'current' || a.type === 'cash').reduce((s, a) => s + acctBalance(a.id), 0);
    return { next: ymd(p.pay.next), want, cad: p.pay.cad.label, have: p.have, cur, left: p.left, bills: p.billTotal, perDay: p.perDay, days: p.days,
      allBefore: p.bills.every(x => x.date < ymd(p.pay.next) && x.date >= todayYMD()) }; });
  ok(!!p, 'Payday is found from steady pay');
  ok(p && p.cad === 'every 2 weeks' && p.next === p.want, 'Next payday is 2 weeks after the last pay (' + (p && p.next) + ')');
  ok(p && Math.abs(p.have - p.cur) < 0.01, 'Uses current and cash accounts only (savings and trading left out)');
  ok(p && p.allBefore && Math.abs(p.left - (p.have - p.bills)) < 0.01, 'Takes off only the bills due before payday');
  ok(p && Math.abs(p.perDay - p.left / p.days) < 0.01, 'Per day = left over days to go');
  ok(await q(() => !document.getElementById('payday').hidden && /Until payday/.test(document.getElementById('payday').textContent)), 'Shows on Home');
  ok(await q(() => getComputedStyle(document.querySelector('#payday .pd-more')).display === 'none'), 'Details tucked away at first');
  await q(() => document.getElementById('payday').click()); await pg.waitForTimeout(200);
  ok(await q(() => getComputedStyle(document.querySelector('#payday .pd-more')).display !== 'none'), 'Tap opens the details');
  await q(() => document.getElementById('payday').click());
  ok(await q(() => { const keep = txns; txns = txns.filter(t => !(t.dir === 'in' && t.cat === 'income')); const r = paydayInfo(); txns = keep; return r === null; }), 'No steady pay: no payday guessed');
  ok(await q(() => { const keep = txns; const d = new Date(); const ds = [];
      for (let i = 1; i <= 4; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 25); ds.push(ymd(x)); }
      txns = keep.filter(t => !(t.dir === 'in' && t.cat === 'income')).concat(ds.map((x, i) => ({ id: 'mp' + i, date: x, dir: 'in', amount: 2000, desc: 'Big Co Salary', cat: 'income', acct: accts[0].id })));
      const r = paydayInfo(); txns = keep; return !!r && r.pay.cad.label === 'every month' && r.pay.next.getDate() === 25; }), 'Monthly pay is spotted (the 25th)');

  // ---- calendar ----
  await q(() => document.querySelector('[data-view=spend]').click()); await pg.waitForTimeout(1000);
  const cal = await q(() => { const [y, m] = spendMonth.split('-').map(Number); return { cells: document.querySelectorAll('#s-cal .cal-d').length, days: new Date(y, m, 0).getDate(), shown: !document.getElementById('s-cal').hidden }; });
  ok(cal.shown && cal.cells === cal.days, 'Calendar shows every day of the month (' + cal.cells + ')');
  const day = await q(() => { const b = [...document.querySelectorAll('#s-cal .cal-d:not([disabled])')].find(x => !x.classList.contains('l0')); b.click(); return b.dataset.day; });
  await pg.waitForTimeout(400);
  const rows = await q(d => { const want = txns.filter(t => t.date === d).length; return { want, got: document.querySelectorAll('#txn-list .lrow:not(#txn-more)').length }; }, day);
  ok(rows.got === rows.want && rows.want > 0, 'Tapping a day shows just that day (' + rows.got + ')');
  await q(() => document.getElementById('cal-clear').click()); await pg.waitForTimeout(300);
  ok(await q(() => dayFilter === null), '"Show all days" clears it');
  ok(await q(() => { const d = [...document.querySelectorAll('#s-cal .cal-d:not([disabled])')].find(x => !x.classList.contains('l0')); d.click(); document.getElementById('m-prev').click(); return dayFilter === null; }), 'Changing month clears the picked day');
  await q(() => { document.getElementById('m-next') && document.getElementById('m-next').click(); });

  // ---- pots ----
  await q(() => document.querySelector('[data-view=home]').click()); await pg.waitForTimeout(500);
  ok(await q(() => document.getElementById('pots-sec').hidden), 'Saving for is hidden until there is a pot');
  await q(() => { openPot(null); document.getElementById('pot-name').value = 'Trip fund'; document.getElementById('pot-target').value = '3000';
    document.getElementById('pot-acct').value = ''; document.getElementById('pot-saved').value = '1200'; document.getElementById('pot-save').click(); });
  await q(() => { openPot(null); document.getElementById('pot-name').value = 'Rainy day'; document.getElementById('pot-target').value = '5000';
    const sav = accts.find(a => a.type === 'savings') || accts[0]; document.getElementById('pot-acct').value = sav.id; document.getElementById('pot-save').click(); });
  await pg.waitForTimeout(400);
  const pt = await q(() => ({ n: pots.length, manual: potHave(pots[0]), linked: potHave(pots[1]), bal: Math.max(0, acctBalance(pots[1].acct)), shown: !document.getElementById('pots-sec').hidden, rows: document.querySelectorAll('#pots-list .pot').length }));
  ok(pt.n === 2 && pt.shown && pt.rows === 2, 'Two pots added and shown on Home');
  ok(pt.manual === 1200, 'A pot without an account uses the amount you enter');
  ok(Math.abs(pt.linked - pt.bal) < 0.01, 'A pot in an account follows that account\'s balance');
  ok(await q(() => { const d = new Date(); d.setMonth(d.getMonth() + 4); pots[0].date = ymd(d); return /a month to make/.test(potStatus(pots[0]).line); }), 'With a date: says how much a month it needs');
  ok(await q(() => JSON.parse(backupPayloadText()).pots.length === 2), 'Pots are in the backup');
  ok(await q(() => { const info = inspectBackup(JSON.stringify(Object.assign({ __suite: 1 }, (() => { const s = ledgerSection(); delete s.pots; return s; })()))); applyRestore(info); return pots.length === 2; }), 'Restoring an older backup without pots keeps this phone\'s');
  await q(() => { openPot(pots[0].id); document.getElementById('pot-del').click(); });
  ok(await q(() => pots.length === 1), 'Delete removes a pot');
  ok(await q(() => { doRollback(); return pots.length === 2; }), 'Undo brings it back');
  ok(errs.length === 0, 'No errors (' + errs.join(' | ') + ')');
  console.log('errors: ' + JSON.stringify(errs));
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
})();
