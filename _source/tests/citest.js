const { chromium } = require('playwright');
const path=require('path');
const SH='../shots/';
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
  const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
  async function boot(){
    const ctx=await browser.newContext({viewport:{width:390,height:844}, deviceScaleFactor:2, acceptDownloads:true});
    await ctx.addInitScript({path: path.join(__dirname,'seed.js')});
    await ctx.route('**/sw.js', r=>r.abort());
    const page=await ctx.newPage(); const errs=[];
    page.on('pageerror', e=>errs.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
    page.on('dialog', d=> d.type()==='confirm'?d.accept():d.dismiss());
    await page.addInitScript(()=>{ try{ const st=JSON.parse(localStorage.getItem('ledger:settings')||'{}'); if(!st.__aged){ st.lastBackup='2026-10-01'; st.__aged=1; localStorage.setItem('ledger:settings', JSON.stringify(st)); localStorage.setItem('ledger:lastbackupday','2026-10-01'); } }catch(e){} });
    await page.goto('file://'+path.resolve('../app/index.html'));
    await page.waitForTimeout(2600);
    await page.evaluate(()=>{ window.__played=[]; Object.keys(SFX).forEach(k=>{ const f=SFX[k]; SFX[k]=t=>{ window.__played.push(k); f(t); }; }); });
    return {page,errs,ctx};
  }
  const v=(p,f,a)=>p.evaluate(f,a);
  async function sortOne(pg, sel){
    const memo = await pg.evaluate(s=>{ const r=document.querySelector(s+' .srow.memo-mode:not(.going)'); return r && r.dataset.srow; }, sel);
    if(memo){ await pg.fill('#memo-'+memo,'Test note'); await pg.click(sel+' .srow[data-srow="'+memo+'"] [data-memosave]'); }
    else await pg.click(sel+' .srow:not(.memo-mode):not(.going) .cchip[data-pick]:not([data-pick="other"]):not([data-pick="otherin"]):not([data-pick="transfers"])');
  }

  // ---------- full flow ----------
  const {page:p, errs} = await boot();
  ok(await v(p,()=>ciOpen && !document.getElementById('ci').hidden && ciCur==='lastImport'), 'check-in opens itself on Sunday/Monday at step 1');
  ok(await v(p,()=>document.getElementById('ci-step').textContent==='Step 1 of 5'), 'shows Step 1 of 5');
  await p.screenshot({path:SH+'v52-1-import.png'});
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#ci-main')]);
  await fc.setFiles(path.join(__dirname,'wise.csv')); await p.waitForTimeout(900);
  ok(await v(p,()=>document.getElementById('import-backdrop').classList.contains('open') && document.querySelectorAll('#imp-summary .imp-tile').length===3), 'import sheet opens over the flow with counts');
  const before = await v(p,()=>txns.length);
  await p.click('#imp-go'); await p.waitForTimeout(1300);
  ok(await v(p,n=>txns.length===n+5, before), 'import added 5 (diff '+(await v(p,()=>txns.length))+' vs '+before+')');
  ok(await v(p,()=>ciCur==='tag' && currentView==='home'), 'flow moved to Sort step, stayed on Home underneath');
  ok(await v(p,()=>/5 transactions added/.test(document.getElementById('ci-body').textContent)), 'banner says what was added');
  ok(await v(p,()=>window.__played.includes('typewriter')), 'typewriter played');
  await p.screenshot({path:SH+'v52-2-sort.png'});
  // pick, undo, pick again
  const left0 = await v(p,()=>uncatList().length);
  await p.click('#ci-sort .srow:not(.memo-mode) .cchip[data-pick]:not([data-pick="other"]):not([data-pick="otherin"]):not([data-pick="transfers"])'); await p.waitForTimeout(450);
  const left1 = await v(p,()=>uncatList().length);
  ok(left1 < left0, 'tap a category: row(s) gone ('+left0+' -> '+left1+')');
  ok(await v(p,()=>!document.getElementById('toast').hidden && /remembered/.test(document.getElementById('toast-t').textContent)), 'toast with undo shows');
  await p.screenshot({path:SH+'v52-2b-toast.png'});
  await p.click('#toast-undo'); await p.waitForTimeout(400);
  ok(await v(p,n=>uncatList().length===n, left0), 'Undo puts them back '+JSON.stringify(await v(p,()=>[uncatList().length, document.getElementById('toast').hidden])));
  // use the More select on one row
  const selId = await v(p,()=>document.querySelector('#ci-sort .srow:not(.memo-mode)').dataset.srow); console.log('selId',selId, await v(p,id=>!!txns.find(t=>t.id===id),selId));
  await p.selectOption('#ci-sort .srow[data-srow="'+selId+'"] [data-pickmore]', 'shopping'); await p.waitForTimeout(450);
  ok(await v(p,id=>txns.find(t=>t.id===id).cat==='shopping', selId), 'More… list works');
  let guard=0;
  while(await v(p,()=>ciCur==='tag' && uncatList().length>0) && guard++<60){ await sortOne(p,'#ci-sort'); await p.waitForTimeout(420); }
  await p.waitForTimeout(900);
  ok(await v(p,()=>uncatList().length===0 && ciCur==='lastAssetVal'), 'all sorted -> moves on to assets by itself');
  ok(await v(p,()=>rules.length>0 && rules.every(r=>typeof r.match==='string' && r.cat)), 'shops remembered as rules ('+await v(p,()=>rules.length)+')');
  await p.fill('#ci-av-a2', '2710'); await p.waitForTimeout(100);
  ok(await v(p,()=>document.getElementById('ci-avr-a2').textContent==='+£210'), 'asset change shows +£210');
  await p.screenshot({path:SH+'v52-3-assets.png'});
  await p.click('#ci-main'); await p.waitForTimeout(500);
  ok(await v(p,()=>assetValue(assets.find(a=>a.id==='a2'))===2710 && ciCur==='lastCheck'), 'values saved, moved to balance check');
  const gbp = await v(p,()=>acctBalance('wgbp').toFixed(2));
  await p.fill('#ci-bal-wgbp', gbp);
  ok(await v(p,()=>/Matches/.test(document.getElementById('ci-balr-wgbp').textContent)), 'matching balance shows Matches');
  await p.fill('#ci-bal-waud', '588.5'); await p.waitForTimeout(150); ok(await v(p,()=>document.activeElement.id==='ci-bal-waud'), 'typing in the next box keeps focus');
  ok(await v(p,()=>/out/.test(document.getElementById('ci-balr-waud').textContent) && !document.querySelector('[data-acts="waud"]').hidden), 'wrong balance shows difference + Show me why');
  await p.screenshot({path:SH+'v52-4-balance.png'});
  await p.click('[data-why="waud"]'); await p.waitForTimeout(600);
  ok(await v(p,()=>document.getElementById('check-backdrop').classList.contains('open') && ciCur==='lastCheck'), 'Show me why opens the balance explainer over the flow');
  await v(p,()=>closeSheet('check-backdrop')); await p.waitForTimeout(300);
  ok(await v(p,()=>document.getElementById('ci-bal-waud').value==='588.5'), 'typed values kept after coming back');
  await p.click('[data-leave="waud"]'); await p.click('#ci-main'); await p.waitForTimeout(500);
  ok(await v(p,()=>ciCur==='backup'), 'moved to backup');
  await p.screenshot({path:SH+'v52-5-backup.png'});
  const [dl] = await Promise.all([p.waitForEvent('download').catch(()=>null), p.click('#ci-main')]);
  await p.waitForTimeout(1200);
  ok(!!dl && await v(p,()=>ciCur==='done'), 'backup downloaded, Week closed screen');
  ok(await v(p,()=>window.__played.includes('book') && settings.weekDismissed===todayYMD() && settings.weekStreak===1), 'book sound, week closed, streak 1');
  ok(await v(p,()=>/Wise AUD is/.test(document.getElementById('ci-body').textContent)), 'summary lists what was left for later');
  await p.screenshot({path:SH+'v52-6-done.png'});
  await p.click('#ci-main'); await p.waitForTimeout(400);
  ok(await v(p,()=>!ciOpen && document.getElementById('ci').hidden && !document.getElementById('week-chip').classList.contains('on')), 'Done closes it, Home card gone');
  console.log('errors:', JSON.stringify(errs));
  // ---------- skip + resume ----------
  const b = await boot();
  await b.page.click('#ci-skip'); await b.page.waitForTimeout(400);
  ok(await v(b.page,()=>ciCur==='tag'), 'Skip moves to next step');
  await b.page.click('#ci-close'); await b.page.waitForTimeout(300);
  ok(await v(b.page,()=>!ciOpen && settings.weekSnooze===todayYMD() && document.getElementById('week-chip').classList.contains('on')), 'X closes, card stays, no pop-up again today');
  ok(await v(b.page,()=>document.getElementById('week-chip-go').textContent==='Continue'), 'card says Continue');
  await b.page.screenshot({path:SH+'v52-home.png'});
  await b.page.click('#week-chip'); await b.page.waitForTimeout(400);
  ok(await v(b.page,()=>ciOpen && ciCur==='tag'), 'reopening picks up at the same step');
  console.log('errors:', JSON.stringify(b.errs));
  // ---------- Home alert -> sort list ----------
  const c = await boot();
  await v(c.page,()=>{ ciOpen=false; weekFlow=false; document.getElementById('ci').hidden=true; document.body.classList.remove('ci-open'); });
  ok(await v(c.page,()=>!!document.getElementById('sort-alert')), 'Home shows tappable "need a category" alert');
  await c.page.click('#sort-alert'); await c.page.waitForTimeout(400);
  ok(await v(c.page,()=>document.getElementById('sort-backdrop').classList.contains('open') && document.querySelectorAll('#sort-list .srow').length>0), 'tapping it opens the list');
  await c.page.screenshot({path:SH+'v52-sortlist.png'});
  guard=0;
  while(await v(c.page,()=>uncatList().length>0) && guard++<60){ await sortOne(c.page,'#sort-list'); await c.page.waitForTimeout(420); }
  ok(await v(c.page,()=>/All sorted/.test(document.getElementById('sort-list').textContent)), 'list empties to All sorted');
  await c.page.click('#sort-done-btn'); await c.page.waitForTimeout(300);
  ok(await v(c.page,()=>!document.getElementById('sort-alert')), 'alert gone from Home');
  console.log('errors:', JSON.stringify(c.errs));
  await browser.close();
})();
