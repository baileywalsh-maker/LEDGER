const { chromium } = require('playwright');
const path=require('path');
async function boot(browser, dir, extra){
  const ctx=await browser.newContext({viewport:{width:390,height:844}, deviceScaleFactor:2});
  await ctx.addInitScript({path: path.join(__dirname,'seed.js')});
  if(extra) await ctx.addInitScript(extra);
  await ctx.route('**/sw.js', r=>r.abort());
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror', e=>errs.push('PAGEERROR '+e.message));
  page.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  const dialogs=[]; page.on('dialog', d=>{ dialogs.push(d.type()+': '+d.message().slice(0,100)); d.type()==='confirm'?d.accept():d.dismiss(); });
  const t0=Date.now();
  await page.goto('file://'+path.resolve(dir,'index.html'));
  await page.waitForTimeout(2500);
  await page.evaluate(()=>(document.querySelectorAll('.backdrop').forEach(b=>b.classList.remove('open','closing')), (typeof ciOpen!=='undefined' && ciOpen) ? (ciOpen=false, weekFlow=false, document.getElementById('ci').hidden=true, document.body.classList.remove('ci-open')) : 0));
  return {ctx,page,errs,dialogs};
}
const dump = page => page.evaluate(()=>{ const o={}; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k.startsWith('ledger:')) o[k]=localStorage.getItem(k);} return o; });
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
  const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
  // 1. same data, v49 vs v50: what is stored after opening must be identical
  const a=await boot(browser,'../app-previous'); const A=await dump(a.page);
  const b=await boot(browser,'../app'); const B=await dump(b.page);
  const keys=new Set([...Object.keys(A),...Object.keys(B)]);
  const diff=[...keys].filter(k=>{
    if(A[k]===B[k]) return false;
    try{ const x=JSON.parse(A[k]||'null'), y=JSON.parse(B[k]||'null');
      // ids made at runtime (auto-posted charges) differ between runs; compare without them
      const strip=v=>JSON.stringify(v,(kk,vv)=> kk==='id'||kk==='at'||kk==='ts'||kk==='nwMilestone'?undefined:vv);
      return strip(x)!==strip(y);}catch(e){return true;}
  });
  ok(diff.length===0, 'stored data identical after opening v49 vs v50 '+(diff.length?JSON.stringify(diff):''));
  const p=b.page;
  // 2. navigation
  for(const v of ['spend','assets','home']){
    const t=Date.now(); await p.click('.tabs button[data-view="'+v+'"]'); const ms=Date.now()-t;
    ok(await p.evaluate(v=>currentView===v && document.getElementById('view-'+v).style.display==='block', v), 'tab '+v+' ('+ms+'ms incl. click)');
  }
  await p.click('#tb-more'); ok(await p.evaluate(()=>currentView==='more' && getComputedStyle(document.getElementById('actbar')).display==='none'), 'gear opens settings, action bar hidden');
  await p.click('#tb-more'); ok(await p.evaluate(()=>currentView==='home'), 'gear again returns to previous tab');
  await p.click('#tb-search'); ok(await p.evaluate(()=>currentView==='spend' && document.activeElement.id==='txn-search'), 'search button opens Spending with search focused');
  await p.fill('#txn-search','tesco'); await p.waitForTimeout(400);
  ok(await p.evaluate(()=>document.querySelectorAll('#txn-list [data-txn]').length>0 && document.getElementById('txn-search-sum').textContent.includes('across every month')), 'search finds Tesco across months');
  await p.click('#txn-search-x');
  ok(await p.evaluate(()=>document.querySelectorAll('#txn-list .dayhdr').length>0), 'spending list grouped by day');
  ok(await p.evaluate(()=>document.querySelectorAll('#s-stack i').length>0), 'category bar drawn');
  ok(await p.evaluate(()=>document.getElementById('s-uncat').style.display==='' && /need/.test(document.getElementById('s-uncat-t').textContent)), 'need-a-category button shows');
  await p.click('#s-uncat'); await p.waitForTimeout(300);
  ok(await p.evaluate(()=>document.getElementById('sort-backdrop').classList.contains('open')), 'Tag now opens tagging sheet');
  await p.evaluate(()=>closeSheet('sort-backdrop')); await p.waitForTimeout(300);
  await p.click('.tabs button[data-view="home"]');
  await p.click('#fab'); await p.waitForTimeout(300);
  ok(await p.evaluate(()=>document.getElementById('add-backdrop').classList.contains('open')), 'Add opens add sheet');
  await p.evaluate(()=>closeSheet('add-backdrop')); await p.waitForTimeout(300);
  ok(await p.evaluate(()=>document.getElementById('bk-pill').textContent==='Safe'), 'backup pill says Safe (backed up 3 days ago)');
  ok(await p.evaluate(()=>document.querySelector('#week-chip').classList.contains('on') && /Next:/.test(document.getElementById('week-chip-sub').textContent)), 'check-in card shows next step');
  ok(await p.evaluate(()=>document.querySelectorAll('#recent-list .cdot').length>0 && document.querySelectorAll('#recent-list .cdot.hollow, #recent-list .cdot.none').length>=0), 'category dots on recent');
  // 3. import through the real UI
  await p.click('#act-import'); await p.waitForTimeout(300);
  ok(await p.evaluate(()=>document.getElementById('import-backdrop').classList.contains('open')), 'Import button opens import sheet');
  await p.selectOption('#imp-acct', 'wgbp');
  await p.setInputFiles('#imp-file', path.join(__dirname,'wise.csv')); await p.waitForTimeout(900);
  const tiles=await p.evaluate(()=>[...document.querySelectorAll('#imp-summary .imp-tile')].map(t=>t.textContent));
  ok(tiles.length===3, 'import preview tiles: '+JSON.stringify(tiles));
  await p.screenshot({path:'../shots/after-import-preview.png'});
  const before=await p.evaluate(()=>txns.length);
  await p.click('#imp-go'); await p.waitForTimeout(1500);
  const after=await p.evaluate(()=>txns.length);
  ok(after-before===5, 'import added '+(after-before)+' transactions');
  ok(await p.evaluate(()=>document.getElementById('impdone-backdrop').classList.contains('open')), 'results sheet shown');
  await p.screenshot({path:'../shots/after-import-done.png'});
  const done=await p.evaluate(()=>document.getElementById('impdone-body').textContent);
  console.log('  results:', done);
  await p.click('#impdone-tag'); await p.waitForTimeout(500);
  ok(await p.evaluate(()=>document.getElementById('sort-backdrop').classList.contains('open')), 'Tag N now opens tagging sheet');
  // re-import the same file: must add nothing
  await p.evaluate(()=>closeSheet('sort-backdrop')); await p.waitForTimeout(300);
  await p.click('#act-import'); await p.waitForTimeout(300);
  await p.selectOption('#imp-acct', 'wgbp');
  await p.setInputFiles('#imp-file', path.join(__dirname,'wise.csv')); await p.waitForTimeout(900);
  await p.click('#imp-go').catch(()=>{}); await p.waitForTimeout(1200);
  ok(await p.evaluate(n=>txns.length===n, after), 'same file twice adds nothing');
  // 4. render speed
  const ms=await p.evaluate(()=>{ const t=performance.now(); for(let i=0;i<20;i++){ switchView(['home','spend','assets'][i%3]); } return (performance.now()-t)/20; });
  ok(ms<50, 'average tab render '+ms.toFixed(1)+'ms');
  console.log('dialogs:', JSON.stringify(b.dialogs));
  console.log('errors v49:', JSON.stringify(a.errs), ' v50:', JSON.stringify(b.errs));
  // 5. overdue backup and never-backed-up states
  const c=await boot(browser,'../app',()=>{ if(!localStorage.getItem('x')){ localStorage.setItem('x','1'); } });
  await c.page.evaluate(()=>{ settings.lastBackup='2026-10-01'; render(); });
  ok(await c.page.evaluate(()=>/Back up · \d+d/.test(document.getElementById('bk-pill').textContent) && document.getElementById('bk-pill').classList.contains('due')), 'overdue backup turns pill amber: '+await c.page.evaluate(()=>document.getElementById('bk-pill').textContent));
  await c.page.screenshot({path:'../shots/after-backup-due.png', clip:{x:0,y:0,width:390,height:80}});
  // 6. empty install
  const ctx=await browser.newContext({viewport:{width:390,height:844}}); const e=await ctx.newPage(); const ee=[];
  e.on('pageerror',x=>ee.push(x.message)); e.on('dialog',d=>d.dismiss());
  await e.goto('file://'+path.resolve('../app/index.html')); await e.waitForTimeout(1500);
  for(const v of ['spend','assets','more','home']) await e.evaluate(v=>switchView(v), v);
  ok(ee.length===0, 'fresh install, no data: no errors '+JSON.stringify(ee));
  await e.screenshot({path:'../shots/after-empty.png'});
  await browser.close();
})();
