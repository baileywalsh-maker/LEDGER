// v65: moving Ledger to a new web address. The new address starts empty; the
// weekly backup is restored there. Everything must come back as it was.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const SKIP = new Set(['ledger:lastbackupday', 'ledger:rollback', 'ledger:premigrate', 'ledger:invpx', 'ledger:carrywhen']);
async function boot(browser, dir, { seed = true, init } = {}){
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  if(seed) await ctx.addInitScript({ path: path.join(__dirname, 'seed.js') });
  if(init) await ctx.addInitScript(init);
  // No share sheet: backup falls back to a download.
  await ctx.addInitScript(() => { try{ delete Navigator.prototype.share; delete Navigator.prototype.canShare; }catch(e){} });
  await ctx.route('**/sw.js', r => r.abort());
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto('file://' + path.resolve(__dirname, dir, 'index.html'));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (document.querySelectorAll('.backdrop').forEach(b => b.classList.remove('open', 'closing')),
    (typeof ciOpen !== 'undefined' && ciOpen) ? (ciOpen = false, weekFlow = false, document.getElementById('ci').hidden = true, document.body.classList.remove('ci-open')) : 0));
  return { ctx, page, errs };
}
const dump = page => page.evaluate(() => { const o = {}; for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k.startsWith('ledger:')) o[k] = localStorage.getItem(k); } return o; });
async function backup(p){
  const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await p.evaluate(() => runBackup());
  const d = await dl; if(!d) return null;
  const f = path.join(os.tmpdir(), 'ledger-move-' + Date.now() + '.json'); await d.saveAs(f); return f;
}
async function restore(p, file){
  p.once('filechooser', fc => fc.setFiles(file));
  await p.evaluate(() => document.getElementById('restore-file').click());
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById('restore-go').click());
  await p.waitForTimeout(800);
}
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  // Old address: seeded data plus non-default look settings.
  const look = () => { if(!localStorage.getItem('ledger:sound')){ localStorage.setItem('ledger:sound', 'off'); localStorage.setItem('ledger:fx', 'off');
    localStorage.setItem('ledger:haptic', 'off'); localStorage.setItem('ledger:homefold', JSON.stringify({ due: 0, accts: 0, recent: 1, history: 1, dueAll: 0 }));
    localStorage.setItem('ledger:frslide', '1'); } };
  const a = await boot(browser, '../app', { init: look });
  const A = await dump(a.page);
  const file = await backup(a.page);
  ok(!!file, 'Backup saved as a file');
  await a.ctx.close();
  // New address: nothing saved.
  const b = await boot(browser, '../app', { seed: false });
  ok(!(await b.page.evaluate(() => localStorage.getItem('ledger:txns') || '[]').then(t => JSON.parse(t).length)), 'New address starts empty');
  if(file) await restore(b.page, file);
  const B = await dump(b.page);
  const differ = Object.keys(A).filter(k => !SKIP.has(k)).filter(k => {
    if(A[k] === B[k]) return false;
    try{ return JSON.stringify(JSON.parse(A[k])) !== JSON.stringify(JSON.parse(B[k] || 'null')); }catch(e){ return true; }
  });
  ok(differ.length === 0, 'Move: every saved item comes back exactly (' + Object.keys(A).filter(k => !SKIP.has(k)).length + ' kinds checked)' + (differ.length ? ' - differ: ' + differ.join(', ') : ''));
  ok(await b.page.evaluate(() => !soundOn() && !hapticsOn() && !fxOn()), 'Move: sound, moment sounds and haptics stay off as they were');
  ok(await b.page.evaluate(() => { const s = foldState(); return s.due === 0 && s.accts === 0 && s.history === 1; }), 'Move: folded home sections come back');
  ok(b.errs.length === 0, 'No errors after the move ' + b.errs.join(' | '));
  await b.ctx.close();
  // An older backup (v64, no look settings) restores and leaves this phone's look alone.
  const o = await boot(browser, '../app-previous');
  const oldFile = await backup(o.page); const O = await dump(o.page); await o.ctx.close();
  const c = await boot(browser, '../app', { seed: false, init: () => { if(!localStorage.getItem('ledger:sound')) localStorage.setItem('ledger:sound', 'off'); } });
  if(oldFile) await restore(c.page, oldFile);
  const C = await dump(c.page);
  ok(!!C['ledger:txns'] && JSON.parse(C['ledger:txns']).length > 0 && (C['ledger:txns'] === O['ledger:txns'] || JSON.stringify(JSON.parse(C['ledger:txns'] || 'null')) === JSON.stringify(JSON.parse(O['ledger:txns'] || 'null'))), 'v64 backup restores into v65: transactions identical' );
  ok(C['ledger:sound'] === 'off', 'v64 backup (no look settings): this phone\'s settings kept');
  ok(c.errs.length === 0, 'No errors restoring an older backup ' + c.errs.join(' | '));
  await c.ctx.close();
  await browser.close();
})();
