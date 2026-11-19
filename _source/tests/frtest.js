const { chromium } = require('playwright'); const path=require('path');
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome'}); const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
  const ctx=await b.newContext({viewport:{width:390,height:844}, deviceScaleFactor:2, hasTouch:true, isMobile:true});
  await ctx.addInitScript({path: path.join(__dirname,'seed.js')}); await ctx.route('**/sw.js', r=>r.abort());
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.dismiss());
  await p.goto('file://'+path.resolve('../app/index.html')); await p.waitForTimeout(2600);
  // realistic example: steady pay so the card shows a normal month, not the fake data's loss
  await p.evaluate(()=>{ ciOpen=false; weekFlow=false; document.getElementById('ci').hidden=true; document.body.classList.remove('ci-open'); document.querySelectorAll('.backdrop').forEach(b=>b.classList.remove('open','closing'));
    const d=new Date(); for(let m=1;m<=4;m++){ const x=new Date(d.getFullYear(), d.getMonth()-m, 15); txns.push({id:'pay'+m, date:ymd(x), dir:'in', amount:1300, desc:'Acme Payroll', cat:'income', acct:'wgbp'}); }
    switchView('home'); document.getElementById('freedom').scrollIntoView({block:'center'}); });
  await p.waitForTimeout(400);
  const card = await p.$('#freedom');
  await card.screenshot({path:'../shots/v55-fr-a.png'});
  ok(await p.evaluate(()=>document.querySelector('.fr-dots button.on').dataset.frs==='0'), 'starts on view A (bars)');
  await p.evaluate(()=>{ const s=document.getElementById('fr-slides'); s.scrollTo({left:s.clientWidth}); }); await p.waitForTimeout(500);
  ok(await p.evaluate(()=>document.querySelector('.fr-dots button.on').dataset.frs==='1' && localStorage.getItem('ledger:frslide')==='1'), 'swiping moves to view B (gauges), dot follows, remembered');
  await card.screenshot({path:'../shots/v55-fr-b.png'});
  await p.click('.fr-dots [data-frs="0"]'); await p.waitForTimeout(600);
  ok(await p.evaluate(()=>document.getElementById('fr-slides').scrollLeft < 5), 'tapping a dot goes back to A');
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=390), 'no sideways page scroll');
  console.log('text:', (await p.evaluate(()=>document.getElementById('freedom').textContent)).replace(/\s+/g,' ').slice(0,260));
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
