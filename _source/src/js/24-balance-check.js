// ============================================================
// Balance check
// ============================================================
document.getElementById('open-check').onclick = ()=>{
  if(accts.length===0){ alert('Add an account first: tap the gear, then Set up, then Accounts.'); return; }
  fillSelect(document.getElementById('c-acct'), accts);
  document.getElementById('c-actual').value = '';
  document.getElementById('c-result').innerHTML = '';
  document.getElementById('c-fix').style.display = 'none';
  openSheet('check-backdrop');
};
let checkDrift = 0, checkAcct = null;
document.getElementById('c-compare').onclick = ()=>{
  const id = document.getElementById('c-acct').value;
  const actual = Number(document.getElementById('c-actual').value);
  if(!document.getElementById('c-actual').value.trim()){ alert('Type what your bank says.'); return; }
  const mine = acctBalance(id);
  const drift = actual - mine;
  checkDrift = drift; checkAcct = id;
  const el = document.getElementById('c-result');
  const rows = '<div class="card" style="margin-top:12px;">'+
    '<div class="lrow"><div class="d1">Ledger says</div><div class="amtcol">'+moneyPair(mine)+'</div></div>'+
    '<div class="lrow"><div class="d1">Bank says</div><div class="amtcol">'+moneyPair(actual)+'</div></div>'+
    '<div class="lrow"><div class="d1"><b>Difference</b></div><div class="amtcol" style="color:'+(Math.abs(drift)<0.01?'var(--in)':'var(--brass)')+'">'+moneyPair(drift)+'</div></div></div>';
  let body = '';
  if(Math.abs(drift) < 0.01){
    body = '<p class="note" style="margin-top:10px;">Spot on. Nothing missing.</p>';
  } else {
    const causes = explainDrift(id, drift);
    body = causes.length
      ? '<div class="rule">What could explain it</div>' + causes.map((c,i)=>
          '<div class="card pad" style="margin-bottom:10px;">'+
          '<b style="font-size:13.5px;">'+c.title+'</b>'+
          '<div class="note" style="margin-top:5px;">'+c.body+'</div>'+
          (c.action ? '<button class="chip" data-cause="'+i+'" style="margin-top:9px;">'+esc(c.action)+'</button>' : '')+
          '</div>').join('')
      : '<p class="note" style="margin-top:10px;">Nothing in your data explains this one. The usual '+
        'cause is a transaction that has not been imported yet.</p>';
    body += '<p class="note" style="margin-top:4px;">An adjustment only papers over the gap. Use it when the real cause can\'t be found.</p>';
  }
  el.innerHTML = rows + body;
  wireDriftCauses(id, drift);
  document.getElementById('c-fix').style.display = Math.abs(drift) < 0.01 ? 'none' : 'block';
  settings.lastCheck = todayYMD(); save(K.settings, settings);
  setTimeout(resumeWeekIfFlowing, 400);
};
// Each explanation carries its own fix, so the button does the thing rather than
// telling you where to go and do it.
function wireDriftCauses(acctId, drift){
  const causes = explainDrift(acctId, drift);
  document.querySelectorAll('[data-cause]').forEach(b=>{
    b.onclick = ()=>{
      const c = causes[Number(b.dataset.cause)];
      if(!c) return;
      if(c.kind === 'auto-one' || c.kind === 'auto-all' || c.kind === 'one-txn'){
        const ids = new Set(c.ids);
        if(!ids.size) return;
        const total = txns.filter(t=>ids.has(t.id)).reduce((s,t)=>s+t.amount, 0);
        if(!confirm('Remove '+ids.size+' transaction'+(ids.size===1?'':'s')+' worth '+money(total)+'?\n\n'+
          'This can be undone from More.')) return;
        snapshot('Remove '+ids.size+' transaction'+(ids.size===1?'':'s')+' while checking a balance');
        txns = txns.filter(t=>!ids.has(t.id));
        save(K.txns, txns);
        render();
        // Re-run the comparison so the new difference is on screen immediately.
        document.getElementById('c-compare').click();
        return;
      }
      if(c.kind === 'dupes'){ closeSheet('check-backdrop'); setTimeout(()=>document.getElementById('open-dupes').click(), 220); return; }
      if(c.kind === 'stale'){ closeSheet('check-backdrop'); setTimeout(()=>document.getElementById('open-import').click(), 220); return; }
      if(c.kind === 'before-open'){ closeSheet('check-backdrop'); setTimeout(()=>document.getElementById('open-accounts').click(), 220); return; }
    };
  });
}

document.getElementById('c-fix').onclick = ()=>{
  if(!checkAcct || Math.abs(checkDrift) < 0.01) return;
  if(!confirm('Write a '+money(Math.abs(checkDrift))+' adjustment?\n\n'+
    'This invents a transaction so the totals agree. It does not fix whatever caused the '+
    'gap, and that cause will drift again. Only do this if you have been through the '+
    'possible explanations above.')) return;
  // An invented adjustment is not a wage either. It goes to Other money in for
  // the same reason an unrecognised credit does.
  const incomeCat = resolveCat('otherin');
  const otherCat = (cats.find(c=>c.id==='other') || cats.find(c=>c.kind==='spend') || {}).id || null;
  snapshot('Balance adjustment of '+money(Math.abs(checkDrift)));
  txns.push({ id:uid(), date:todayYMD(), amount:Math.abs(checkDrift),
    dir: checkDrift > 0 ? 'in' : 'out', acct:checkAcct, toAcct:null,
    desc:'Balance adjustment', cat: checkDrift > 0 ? incomeCat : otherCat });
  save(K.txns, txns);
  closeSheet('check-backdrop');
  render();
};
