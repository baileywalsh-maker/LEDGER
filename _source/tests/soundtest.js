const { chromium } = require('playwright');
const path=require('path');
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome', args:['--autoplay-policy=no-user-gesture-required']});
  const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
  async function boot(dir){
    const ctx=await browser.newContext({viewport:{width:390,height:844}, acceptDownloads:true});
    await ctx.addInitScript({path: path.join(__dirname,'seed.js')});
    await ctx.route('**/sw.js', r=>r.abort());
    const page=await ctx.newPage(); const errs=[];
    page.on('pageerror', e=>errs.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
    page.on('dialog', d=> d.type()==='confirm'?d.accept():d.dismiss());
    await page.addInitScript(()=>{ window.__played=[]; });
    await page.goto('file://'+path.resolve(dir,'index.html'));
    await page.waitForTimeout(2500);
    await page.evaluate(()=>(document.querySelectorAll('.backdrop').forEach(b=>b.classList.remove('open','closing')), (typeof ciOpen!=='undefined' && ciOpen) ? (ciOpen=false, weekFlow=false, document.getElementById('ci').hidden=true, document.body.classList.remove('ci-open')) : 0));
    return {page,errs};
  }
  const dump = page => page.evaluate(()=>{ const o={}; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k.startsWith('ledger:')) o[k]=localStorage.getItem(k);} return o; });
  const a=await boot('../app-previous'), b=await boot('../app');
  const A=await dump(a.page), B=await dump(b.page);
  const strip=v=>JSON.stringify(JSON.parse(v||'null'),(k,vv)=> ['id','at','ts','nwMilestone'].includes(k)?undefined:vv);
  const diff=[...new Set([...Object.keys(A),...Object.keys(B)])].filter(k=> strip(A[k])!==strip(B[k]));
  ok(!diff.length, 'saved data same as v50 (only new key: nwMilestone) '+JSON.stringify(diff));
  const p=b.page;
  ok(await p.evaluate(()=>typeof settings.nwMilestone==='number'), 'milestone mark recorded silently on open: '+await p.evaluate(()=>settings.nwMilestone));
  // spy on sfx after the coalescing decision
  await p.evaluate(()=>{ const real=SFX; Object.keys(real).forEach(k=>{ const f=real[k]; real[k]=t=>{ window.__played.push(k); f(t); }; }); });
  const last = async ()=>{ await p.waitForTimeout(250); return p.evaluate(()=>window.__played.splice(0).filter(x=>x!=='wood')); };
  ok((await last()).length===0, 'no sound on opening the app');
  const addTxn = (dir, amt, cat)=> p.evaluate(([dir,amt,cat])=>{ openTxn(null); txnDir=dir; document.getElementById('t-amount').value=amt; document.getElementById('t-desc').value='Test';
    if(cat){ const sel=document.getElementById('t-cat'); if(![...sel.options].some(o=>o.value===cat)){ const o=document.createElement('option'); o.value=cat; sel.appendChild(o);} sel.value=cat; }
    document.getElementById('t-save').click(); }, [dir,amt,cat]);
  await addTxn('out', 5, 'eatingout'); ok(JSON.stringify(await last())==='["pencil"]', 'spending logged -> pencil tick');
  await addTxn('out', 900, 'groceries'); ok(JSON.stringify(await last())==='["lownote"]', 'goes over budget -> soft two-note drop');
  await addTxn('in', 20, 'income'); ok(JSON.stringify(await last())==='["arcade"]', 'money in -> arcade coin');
  await addTxn('in', 20000, 'income'); ok(JSON.stringify(await last())==='["milestone"]', 'passing a £10k mark -> coins and chime (instead of arcade)');
  await addTxn('in', 20, 'income'); ok(JSON.stringify(await last())==='["arcade"]', 'next income is back to arcade coin');
  await p.evaluate(()=>{ editingAsset='a1'; document.getElementById('ad-newval').value='99999'; document.getElementById('ad-logval').click(); });
  const av=await last(); ok(av.includes('arcade')||av.includes('milestone'), 'asset value up -> '+JSON.stringify(av));
  await p.evaluate(()=>{ editingAsset='a2'; document.getElementById('ad-newval').value='10'; document.getElementById('ad-logval').click(); });
  ok((await last()).length===0, 'asset value down -> no sound (and no milestone replay)');
  await p.evaluate(()=>runBackup()); ok(JSON.stringify(await last())==='["safe"]', 'backup -> safe dial and lock');
  await p.evaluate(()=>closeSheet('asset-backdrop'));
  await p.click('#act-import'); await p.waitForTimeout(300);
  await p.selectOption('#imp-acct','wgbp'); await p.setInputFiles('#imp-file', path.join(__dirname,'wise.csv')); await p.waitForTimeout(800);
  await p.click('#imp-go'); ok(JSON.stringify(await last())==='["typewriter"]', 'statement imported -> typewriter');
  await p.evaluate(()=>{ window.weekTasks=()=>[{done:true,label:'x'}]; weekFlow=true; resumeWeekIfFlowing(); });
  ok(JSON.stringify(await last())==='["book"]', 'check-in finished -> big book closing');
  await p.evaluate(()=>{ localStorage.setItem('ledger:fx','off'); }); await addTxn('in', 20, 'income');
  ok((await last()).length===0, 'Moment sounds switched off -> silent');
  await p.evaluate(()=>{ localStorage.removeItem('ledger:fx'); });
  // play every sound for real in the audio engine, no exceptions allowed
  const thrown=await p.evaluate(()=>{ const bad=[]; sfxCtx(); for(const k of Object.keys(SFX)){ try{ SFX[k](audioCtx.currentTime+0.01); }catch(e){ bad.push(k+': '+e.message); } } return bad; });
  ok(!thrown.length, 'all 8 sounds render in the audio engine '+JSON.stringify(thrown));
  await p.evaluate(()=>(document.querySelectorAll('.backdrop').forEach(b=>b.classList.remove('open','closing')), (typeof ciOpen!=='undefined' && ciOpen) ? (ciOpen=false, weekFlow=false, document.getElementById('ci').hidden=true, document.body.classList.remove('ci-open')) : 0)); await p.click('#tb-more'); await p.waitForTimeout(200);
  ok(await p.evaluate(()=>document.getElementById('fx-toggle').textContent==='On'), 'Moment sounds switch shows in Settings');
  console.log('errors:', JSON.stringify(b.errs));
  await browser.close();
})();
