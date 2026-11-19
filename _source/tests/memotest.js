const { chromium } = require('playwright'); const path=require('path');
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome'}); const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
  const ctx=await b.newContext({viewport:{width:390,height:844}, deviceScaleFactor:2});
  await ctx.addInitScript({path: path.join(__dirname,'seed.js')}); await ctx.route('**/sw.js', r=>r.abort());
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.dismiss());
  await p.goto('file://'+path.resolve('../app/index.html')); await p.waitForTimeout(2600);
  const v=(f,a)=>p.evaluate(f,a);
  await v(()=>{ ciOpen=false; weekFlow=false; document.getElementById('ci').hidden=true; document.body.classList.remove('ci-open'); document.querySelectorAll('.backdrop').forEach(b=>b.classList.remove('open','closing')); });
  // existing Other with no note now asks for one
  const unmemo = await v(()=>txns.filter(needsMemo).length);
  ok(unmemo>0 && /need.* a note/.test(await v(()=>document.getElementById('sort-alert').textContent)), 'Home alert counts '+unmemo+' old "Other" payments needing a note');
  // add a transaction as Other without a note -> blocked
  await v(()=>{ openTxn(null); txnDir='out'; setDir('out'); document.getElementById('t-amount').value='12'; document.getElementById('t-desc').value='Mystery'; const s=document.getElementById('t-cat'); s.value='other'; s.dispatchEvent(new Event('change')); });
  ok(/needed for Other/.test(await v(()=>document.getElementById('t-memo-lab').textContent)), 'picking Other changes the label to "needed"');
  const n0 = await v(()=>txns.length);
  await p.click('#t-save'); await p.waitForTimeout(200);
  ok(await v(n=>txns.length===n && !document.getElementById('t-memo-err').hidden, n0), 'save blocked without a note, message shows');
  await p.screenshot({path:'../shots/v53-add-blocked.png'});
  await p.fill('#t-memo','Birthday present for Mum'); await p.click('#t-save'); await p.waitForTimeout(300);
  ok(await v(n=>txns.length===n+1 && txns[txns.length-1].memo==='Birthday present for Mum', n0), 'with a note it saves, note stored');
  // transfers category, received
  await v(()=>{ openTxn(null); setDir('in'); document.getElementById('t-amount').value='20'; document.getElementById('t-desc').value='Sam'; const s=document.getElementById('t-cat'); s.value='transfers'; s.dispatchEvent(new Event('change')); });
  await p.click('#t-save'); await p.waitForTimeout(200);
  ok(await v(()=>!document.getElementById('t-memo-err').hidden), 'Transfers also needs a note');
  await p.fill('#t-memo','Sam paid me back for dinner'); await p.click('#t-save'); await p.waitForTimeout(300);
  // normal category -> no note needed
  await v(()=>{ openTxn(null); setDir('out'); document.getElementById('t-amount').value='5'; document.getElementById('t-desc').value='Tesco'; const s=document.getElementById('t-cat'); s.value='groceries'; s.dispatchEvent(new Event('change')); });
  const n1 = await v(()=>txns.length); await p.click('#t-save'); await p.waitForTimeout(300);
  ok(await v(n=>txns.length===n+1, n1), 'Groceries saves without a note');
  // note shows on the row and in search
  await v(()=>switchView('home'));
  ok(/Birthday present for Mum/.test(await v(()=>document.getElementById('recent-list').textContent)), 'note shows on the transaction row');
  ok(await v(()=>searchTxns('birthday').length===1), 'search finds it by the note');
  // editing an old Other forces a note
  const oldId = await v(()=>txns.find(needsMemo).id);
  await v(id=>openTxn(id), oldId); await p.click('#t-save'); await p.waitForTimeout(200);
  ok(await v(()=>!document.getElementById('t-memo-err').hidden), 'editing an old Other asks for a note too');
  await v(()=>closeSheet('txn-backdrop')); await p.waitForTimeout(300);
  // sort list: choosing Other asks for a note, only that row
  await p.click('#sort-alert'); await p.waitForTimeout(400);
  const memoRows0 = await v(()=>document.querySelectorAll('#sort-list .srow.memo-mode').length);
  ok(memoRows0>0, 'old Other payments show in the list with a note box ('+memoRows0+')');
  // pick Other for an uncategorised row via More select
  const uid = await v(()=>{ const r=[...document.querySelectorAll('#sort-list .srow:not(.memo-mode)')][0]; return r && r.dataset.srow; });
  if(uid){
    const cnt0 = await v(()=>uncatList().length);
    await p.selectOption('#sort-list .srow[data-srow="'+uid+'"] [data-pickmore]','other'); await p.waitForTimeout(300);
    ok(await v(id=>document.querySelector('#sort-list .srow[data-srow="'+id+'"]').classList.contains('memo-mode') && document.activeElement.id==='memo-'+id, uid), 'picking Other opens a note box and focuses it');
    ok(await v(n=>uncatList().length===n, cnt0), 'nothing filed yet');
    await p.screenshot({path:'../shots/v53-sort-note.png'});
    await p.click('#sort-list .srow[data-srow="'+uid+'"] [data-memosave]'); await p.waitForTimeout(200);
    ok(await v(id=>!document.querySelector('#sort-list .srow[data-srow="'+id+'"] [data-memoerr]').hidden, uid), 'Save with empty note is refused');
    await p.fill('#memo-'+uid,'Car park'); await p.press('#memo-'+uid,'Enter'); await p.waitForTimeout(450);
    ok(await v(id=>{ const t=txns.find(x=>x.id===id); return t.cat==='other' && t.memo==='Car park'; }, uid), 'Enter saves it with the note');
    ok(await v(n=>uncatList().length===n-1, cnt0), 'that row is gone');
    ok(await v(()=>!rules.some(r=>r.cat==='other')), 'Other is not remembered as a rule for the shop');
  }
  // clear the rest of the old notes
  let g=0;
  while(await v(()=>document.querySelectorAll('#sort-list .srow.memo-mode').length>0) && g++<30){
    const id = await v(()=>document.querySelector('#sort-list .srow.memo-mode').dataset.srow);
    await p.fill('#memo-'+id,'Test note'); await p.click('#sort-list .srow[data-srow="'+id+'"] [data-memosave]'); await p.waitForTimeout(380);
  }
  ok(await v(()=>txns.filter(needsMemo).length===0), 'all notes added');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
