const { chromium } = require('playwright'); const path=require('path');
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome'}); const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
  async function boot(init, wait){
    const ctx=await b.newContext({viewport:{width:390,height:844}, deviceScaleFactor:2, acceptDownloads:true});
    await ctx.addInitScript({path: path.join(__dirname,'seed.js')}); if(init) await ctx.addInitScript(init); await ctx.route('**/sw.js', r=>r.abort());
    const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); }); p.on('dialog',d=>d.dismiss());
    await p.goto('file://'+path.resolve('../app/index.html')); await p.waitForTimeout(wait||2600);
    await p.evaluate(()=>{ if(typeof ciOpen!=='undefined' && ciOpen){ ciOpen=false; weekFlow=false; document.getElementById('ci').hidden=true; document.body.classList.remove('ci-open'); } document.querySelectorAll('.backdrop').forEach(b=>b.classList.remove('open','closing')); });
    return {p,errs,ctx};
  }
  const close = p=>p.evaluate(()=>document.querySelectorAll('.backdrop').forEach(b=>b.classList.remove('open','closing')));
  // ----- loading screen -----
  const s0 = await boot(null, 300);
  ok(await s0.p.evaluate(()=>{ const s=document.getElementById('splash'); return s && !s.classList.contains('out'); }), 'loading screen shows on open');
  await s0.p.screenshot({path:'../shots/v55-splash.png'});
  await s0.p.waitForTimeout(1500);
  ok(await s0.p.evaluate(()=>!document.getElementById('splash')), 'loading screen fades and is removed after ~1s');
  // ----- settings -----
  const {p, errs} = await boot();
  await p.click('#tb-more'); await p.waitForTimeout(300);
  ok(await p.evaluate(()=>document.querySelectorAll('#view-more .set-cat').length===6), 'Settings shows 6 groups');
  ok(await p.evaluate(()=>[...document.querySelectorAll('.set-cat small')].every(e=>e.textContent.length>0)), 'every group has a summary line: '+JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('.set-cat small')].map(e=>e.textContent))));
  await p.screenshot({path:'../shots/v55-settings.png'});
  const groups = {week:['open-import','open-check','open-bulk','do-backup'], setup:['open-recurring','open-budgets','open-accounts','open-rules','open-targets'], currency:['open-currency','open-secondary'], feel:['sound-toggle','fx-toggle','haptic-toggle'], data:['do-restore','open-export'], fix:['open-dupes','open-fxfix','open-fximport']};
  for(const [k, rows] of Object.entries(groups)){
    await close(p); await p.click('.set-cat[data-set="'+k+'"]'); await p.waitForTimeout(350);
    const sheet = k==='fix' ? 'fix-backdrop' : 'set-'+k+'-backdrop';
    const vis = await p.evaluate(([sh, rows])=>document.getElementById(sh).classList.contains('open') && rows.every(id=>{ const e=document.getElementById(id); return e && e.offsetParent && e.closest('#'+sh); }), [sheet, rows]);
    ok(vis, k+' opens with '+rows.length+' rows');
    if(k==='week') await p.screenshot({path:'../shots/v55-week.png'});
  }
  ok(await p.evaluate(()=>!document.getElementById('do-undo').offsetParent && !document.getElementById('open-rates').offsetParent && document.querySelectorAll('#fix-list .lrow').length===3), 'Undo and Live rates rows gone; Fix things has 3 tools');
  // rows open their screens and close the group first
  for(const [k,id,target] of [['week','open-check','check-backdrop'],['setup','open-budgets',null],['setup','open-targets','targets-backdrop'],['data','open-export','exportpick-backdrop'],['fix','open-fxfix','fxfix-backdrop'],['currency','open-currency',null]]){
    await close(p); await p.click('.set-cat[data-set="'+k+'"]'); await p.waitForTimeout(300);
    await p.click('#'+id); await p.waitForTimeout(400);
    const r = await p.evaluate(([k,t])=>{ const g = k==='fix'?'fix-backdrop':'set-'+k+'-backdrop'; const opens=[...document.querySelectorAll('.backdrop.open')].map(b=>b.id); return {groupClosed: !opens.includes(g), opens}; }, [k,target]);
    ok(r.groupClosed && r.opens.length===1 && (!target || r.opens[0]===target), id+' opens '+r.opens.join(',')+' with the group closed');
  }
  // toggles inside Feel still work and stay put
  await close(p); await p.click('.set-cat[data-set="feel"]'); await p.waitForTimeout(300);
  await p.click('#haptic-toggle'); await p.waitForTimeout(200);
  ok(await p.evaluate(()=>document.getElementById('set-feel-backdrop').classList.contains('open') && localStorage.getItem('ledger:haptic')==='off' && /buzz off/.test(document.getElementById('sc-feel').textContent)), 'Buzz toggle works, sheet stays open, summary updates');
  await p.click('#haptic-toggle');
  // ----- targets -----
  await close(p); await p.click('.set-cat[data-set="setup"]'); await p.waitForTimeout(300); await p.click('#open-targets'); await p.waitForTimeout(350);
  await p.screenshot({path:'../shots/v55-targets.png'});
  await p.click('[data-tg="keep"][data-v="0.5"]'); await p.click('[data-tg="runway"][data-v="12"]'); await p.waitForTimeout(200);
  await p.evaluate(()=>{ closeSheet('targets-backdrop'); switchView('home'); }); await p.waitForTimeout(200);
  ok(await p.evaluate(()=>settings.freedomTargets.keep===0.5 && settings.freedomTargets.runway===12 && /50%/.test(document.getElementById('freedom').textContent) && /12 mo/.test(document.getElementById('freedom').textContent)), 'targets save and show on the Home card');
  ok(await p.evaluate(()=>runTone(5)==='bad' && runTone(7)==='mid' && runTone(13)==='good' && keepTone(0.05)==='bad' && keepTone(0.3)==='mid' && keepTone(0.5)==='good'), 'colour ranges follow the targets');
  // ----- import's "get rate" button gone -----
  ok(await p.evaluate(()=>document.getElementById('imp-rate-fetch').hidden && document.getElementById('sec-fetch').hidden), 'no rate buttons left');
  console.log('errors:', JSON.stringify(errs));
  // ----- second currency fetches by itself (rate service mocked) -----
  const s2 = await boot(()=>{ window.__fetches=[]; const real=window.fetch; window.fetch=(u,o)=>{ window.__fetches.push(String(u)); return Promise.resolve(new Response(JSON.stringify({amount:1, base:'GBP', date:'2026-11-04', rates:{AUD:1.95}}), {status:200, headers:{'Content-Type':'application/json'}})); }; });
  await s2.p.evaluate(()=>{ settings.secondary={code:'AUD', rate:1.80, rateDate:'2026-10-01', manual:true}; save(K.settings, settings); autoRefreshSecondary(); });
  await s2.p.waitForTimeout(800);
  ok(await s2.p.evaluate(()=>settings.secondary.rate===1.95 && settings.secondary.manual===false), 'second currency rate refreshed by itself: '+await s2.p.evaluate(()=>JSON.stringify(settings.secondary)));
  await close(s2.p); await s2.p.click('#tb-more'); await s2.p.click('.set-cat[data-set="currency"]'); await s2.p.waitForTimeout(300); await s2.p.click('#open-secondary'); await s2.p.waitForTimeout(800);
  ok(await s2.p.evaluate(()=>/1\.95/.test(document.getElementById('sec-rate-box').textContent) && document.getElementById('sec-manual-wrap').style.display==='none'), 'opening Second currency shows a fresh rate with no button to press');
  // ----- offline: falls back quietly -----
  const s3 = await boot(()=>{ window.fetch=()=>Promise.reject(new Error('offline')); });
  await s3.p.evaluate(()=>{ settings.secondary={code:'AUD', rate:1.80, rateDate:'2026-10-01'}; save(K.settings, settings); autoRefreshSecondary(); });
  await s3.p.waitForTimeout(3500);
  ok(await s3.p.evaluate(()=>settings.secondary.rate===1.80) && s3.errs.length===0, 'offline: keeps the old rate, no errors');
  await b.close();
})();
