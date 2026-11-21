// v68 compact look: every trimmed part is hidden by default, opens on a tap of its
// card or title, closes again, and is remembered after reopening. Nothing is lost.
// Run from tests/ in the usual layout (../app/index.html is the build under test).
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const APP = path.resolve(process.cwd(), '..', 'app');
const html0 = fs.readFileSync(path.join(APP, 'index.html'),'utf8').replaceAll('env(safe-area-inset-top)','47px').replaceAll('env(safe-area-inset-bottom)','34px');
const seed = fs.readFileSync(path.join(__dirname, 'seed.js'),'utf8');
(async()=>{
  const b = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});
  const ctx = await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const pg = await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.route('**/*', r=>{const u=new URL(r.request().url()); if(u.hostname!=='localhost') return r.abort(); if(u.pathname==='/') return r.fulfill({body:html0,contentType:'text/html'}); const f=path.join(APP, u.pathname); return fs.existsSync(f)?r.fulfill({path:f}):r.fulfill({status:404,body:''});});
  await pg.goto('http://localhost/');
  await pg.evaluate(s=>{localStorage.clear(); eval(s); const st=JSON.parse(localStorage.getItem('ledger:settings')||'{}'); const d=new Date(); const y=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); st.weekDismissed=y; st.monthSnooze=y; st.lastBackup=y; localStorage.setItem('ledger:settings',JSON.stringify(st));}, seed);
  await pg.reload(); await pg.waitForTimeout(2200); await pg.evaluate(()=>document.querySelectorAll('#splash,.splash,#loading').forEach(e=>e.remove()));
  const vis = sel => pg.evaluate(s=>{const e=document.querySelector(s); return !!e && e.offsetParent!==null && getComputedStyle(e).display!=='none';}, sel);
  const r = {};
  r.heroHidden = !(await vis('#m-running'));
  await pg.click('#net-amt'); await pg.waitForTimeout(300); r.heroOpens = await vis('#m-running');
  
  await pg.click('#net-amt'); await pg.waitForTimeout(300); r.heroCloses = !(await vis('#m-running'));
  r.dueBtn = await pg.evaluate(()=>document.getElementById('due-x').textContent);
  r.findingHidden = !(await vis('#sub-findings .finding'));
  await pg.evaluate(()=>document.getElementById('due-x').scrollIntoView()); await pg.click('#due-x'); await pg.waitForTimeout(300);
  r.findingOpens = await vis('#sub-findings .finding'); r.totalOpens = await vis('#committed-block .total-card');
  await pg.click('#due-x'); await pg.waitForTimeout(200);
  r.freeLineHidden = !(await vis('.fr-line'));
  await pg.evaluate(()=>document.querySelector('.fr-head').scrollIntoView()); await pg.click('.fr-head'); await pg.waitForTimeout(300); r.freeOpens = await vis('.fr-line');
  r.bothSlides = await pg.evaluate(()=>document.querySelectorAll('.fr-slide').length);
  await pg.click('.fr-head');
  r.recentRows = await pg.evaluate(()=>document.querySelectorAll('#recent-list .lrow').length);
  r.sideBySide = await pg.evaluate(()=>{const a=document.getElementById('week-chip').getBoundingClientRect(), b=document.getElementById('home-warn').getBoundingClientRect(); return Math.abs(a.top-b.top)<4;});
  await pg.evaluate(()=>document.querySelector('[data-view=spend]').click()); await pg.waitForTimeout(1200);
  r.movesHidden = !(await vis('.cmp-moves'));
  await pg.click('#s-cmp .cmp-head'); await pg.waitForTimeout(300); r.movesOpen = await vis('.cmp-moves');
  
  r.txRows = await pg.evaluate(()=>document.querySelectorAll('#txn-list .lrow:not(#txn-more)').length);
  r.moreBtn = await pg.evaluate(()=>document.getElementById('txn-more')?.textContent);
  await pg.evaluate(()=>document.getElementById('txn-more').click()); await pg.waitForTimeout(500);
  r.txAll = await pg.evaluate(()=>document.querySelectorAll('#txn-list .lrow:not(#txn-more)').length);
  await pg.evaluate(()=>document.querySelector('[data-view=assets]').click()); await pg.waitForTimeout(1200);
  r.nwHidden = !(await vis('#nw-verdict'));
  await pg.click('#nw-x'); await pg.waitForTimeout(300); r.nwOpens = await vis('#nw-verdict');
  await pg.reload(); await pg.waitForTimeout(2200);
  r.rememberedAfterReopen = await pg.evaluate(()=>document.body.classList.contains('x-cmp') && document.body.classList.contains('x-nw') && !document.body.classList.contains('x-hero'));
  r.inBackup = await pg.evaluate(()=>JSON.stringify(ledgerSection()).includes('xCmp'));
  const want = {heroHidden:'Net position: breakdown hidden at first', heroOpens:'Tapping net position opens it', heroCloses:'Tapping again closes it',
    findingHidden:'Due soon: notices tucked away at first', findingOpens:'The Due soon button opens the notices', totalOpens:'...and the monthly total',
    freeLineHidden:'Freedom: extra line tucked away', freeOpens:'Tapping Freedom opens it', recentRows:'Recent shows 3 rows', sideBySide:'Check-in and sorting sit side by side',
    movesHidden:'Spending: biggest changes tucked away', movesOpen:'Tapping the month comparison opens biggest changes', txRows:'Spending shows 8 transactions first',
    txAll:'Show more brings every transaction back', nwHidden:'Net worth outlook tucked away', nwOpens:'Tapping it opens the outlook', rememberedAfterReopen:'Open/closed is remembered after reopening'};
  const okv = {recentRows:3, txRows:8, txAll:24, bothSlides:2};
  for(const k in want){ const pass = (k in okv) ? r[k] === okv[k] : r[k] === true; console.log((pass ? 'PASS ' : 'FAIL ') + want[k] + (pass ? '' : ' (' + r[k] + ')')); }
  console.log((r.bothSlides === 2 ? 'PASS ' : 'FAIL ') + 'Freedom keeps both views (bars and gauges)');
  console.log((/to check/.test(r.dueBtn) ? 'PASS ' : 'FAIL ') + 'A Due soon notice is flagged on the button while tucked away');
  console.log('errors: ' + JSON.stringify(errs));
  await b.close();
})();
