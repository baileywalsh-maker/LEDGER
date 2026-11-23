// ============================================================
// Working out WHY a balance does not match
// ============================================================
// An adjustment hides a discrepancy; it does not fix it. Whatever caused the gap
// is still in the data and will drift again next month. These are the causes
// Ledger can actually identify from what it holds, each returned with the fix.
//
// Sign convention, which is easy to get backwards: drift = bank - ledger.
// Double-counting a payment subtracts it twice, so Ledger reads LOW and the
// drift is POSITIVE. A positive drift therefore means "there is spending in here
// that should not be".
function explainDrift(acctId, drift){
  const out = [];
  const gap = Math.abs(drift);
  if(gap < 0.01) return out;
  const near = (v) => Math.abs(v - gap) < 0.02;
  const mine = txns.filter(t=>t.acct === acctId || t.toAcct === acctId);

  // 1. Posted subscription charges no statement has confirmed. The commonest
  //    cause by far, and the one that produced this feature.
  const unconfirmed = mine.filter(t=>t.auto);
  if(unconfirmed.length && drift > 0){
    const total = unconfirmed.reduce((s,t)=>s+t.amount, 0);
    const single = unconfirmed.find(t=>near(t.amount));
    if(single){
      out.push({score:100, kind:'auto-one', ids:[single.id],
        title:'A scheduled charge that never appeared on a statement',
        body:'Ledger posted '+esc(single.desc)+' for '+money(single.amount)+' on '+
             prettyDate(single.date)+', and that is exactly your difference. The real '+
             'charge was probably imported under a slightly different amount — a '+
             'subscription billed in another currency converts differently every month.',
        action:'Remove that posted charge'});
    } else if(near(total)){
      out.push({score:95, kind:'auto-all', ids:unconfirmed.map(t=>t.id),
        title:unconfirmed.length+' scheduled charges never confirmed',
        body:'Together they come to '+money(total)+', which is your difference exactly.',
        action:'Remove all '+unconfirmed.length});
    } else {
      out.push({score:55, kind:'auto-all', ids:unconfirmed.map(t=>t.id),
        title:unconfirmed.length+' scheduled charge'+(unconfirmed.length===1?'':'s')+' not yet confirmed',
        body:'Worth '+money(total)+' in total. These were posted by Ledger and no imported row '+
             'has matched them, so if the real charges are already in from a statement, these are duplicates.',
        action:'Review them'});
    }
  }

  // 2. Duplicates Ledger is already confident about.
  const certain = duplicateScan().certain
    .map(g=>g.filter(t=>t.acct === acctId))
    .filter(g=>g.length > 1);
  if(certain.length && drift > 0){
    const extra = certain.reduce((s,g)=>s + g.slice(1).reduce((n,t)=>n+t.amount,0), 0);
    out.push({score: near(extra) ? 98 : 60, kind:'dupes', ids:[],
      title: certain.length+' duplicate payment'+(certain.length===1?'':'s')+' in this account',
      body: near(extra)
        ? 'The extra copies come to '+money(extra)+' — your difference exactly.'
        : 'The extra copies come to '+money(extra)+'.',
      action:'Open Find duplicates'});
  }

  // 3. A single transaction that is exactly the gap. Often a payment entered by
  //    hand and then imported as well.
  const exactOne = mine.filter(t=>t.dir !== 'transfer' && near(t.amount))
    .filter(t=> drift > 0 ? t.dir === 'out' : t.dir === 'in');
  if(exactOne.length && exactOne.length <= 3){
    out.push({score:70, kind:'one-txn', ids:exactOne.map(t=>t.id),
      title:'A transaction the same size as the gap',
      body: exactOne.map(t=>esc(t.desc||'No description')+' · '+money(t.amount)+' · '+prettyDate(t.date)).join('<br>')+
            '<br>If that was entered twice, or never actually left the account, removing it closes the difference.',
      action: exactOne.length === 1 ? 'Remove it' : 'Show them'});
  }

  // 4. Nothing imported recently — the boring, likeliest explanation of all.
  const latest = mine.filter(t=>!t.auto).map(t=>t.date).sort().pop();
  if(latest){
    const days = Math.floor((parseYMD(todayYMD()) - parseYMD(latest)) / 86400000);
    if(days >= 3){
      out.push({score: drift < 0 ? 85 : 40, kind:'stale', ids:[],
        title:'Nothing imported since '+prettyDate(latest),
        body:'That is '+days+' days. Spending since then would not be in Ledger yet, which is '+
             'the usual reason the bank reads lower than Ledger does.',
        action:'Import a statement'});
    }
  }

  // 5. Rounding on converted rows. Small gaps only — anything larger is a real
  //    cause wearing rounding's clothes.
  const converted = mine.filter(t=>t.fxRate).length;
  if(converted && gap < 1){
    out.push({score:50, kind:'rounding', ids:[],
      title:'Currency rounding',
      body:converted+' transaction'+(converted===1?'':'s')+' in this account were converted from '+
           'another currency. Each is stored to the penny, so a gap under '+money(1)+' across '+
           'that many rows is arithmetic rather than anything missing.',
      action:null});
  }

  // 6. Transactions sitting before the account's start date.
  const a = accts.find(x=>x.id === acctId);
  if(a && a.openingDate){
    const before = txns.filter(t=>t.acct === acctId && t.date < a.openingDate).length;
    if(before){
      out.push({score:45, kind:'before-open', ids:[],
        title:before+' transaction'+(before===1?'':'s')+' before this account starts',
        body:'Dated before '+prettyDate(a.openingDate)+', so they count towards spending but do not '+
             'move the balance. If the starting balance was meant to include them, it is the '+
             'starting figure that is wrong rather than anything missing.',
        action:'Open accounts'});
    }
  }

  return out.sort((x,y)=>y.score - x.score);
}

// ---- Live rates board ----
// settings.rateBoard = {base, codes:[], rates:{CODE:rate}, date, fetchedAt}
function rateBoard(){
  const b = settings.rateBoard;
  if(b && typeof b === 'object' && Array.isArray(b.codes)) return b;
  return {base: curCode(), codes: [], rates: {}, date: null, fetchedAt: null};
}
function saveRateBoard(b){ settings.rateBoard = b; save(K.settings, settings); }

function rateBoardAgeDays(){
  const b = rateBoard();
  if(!b.date) return null;
  return Math.floor((parseYMD(todayYMD()) - parseYMD(b.date)) / 86400000);
}

function renderRateBoard(){
  const b = rateBoard();
  const box = document.getElementById('rates-board');
  if(!box) return;
  const codes = b.codes.filter(c=>c && c !== b.base);
  if(!codes.length){
    box.innerHTML = '<div class="note">Choose up to three currencies above, then refresh.</div>';
    return;
  }
  const age = rateBoardAgeDays();
  const stale = age != null && age >= 4;   // beyond a long weekend
  const head = b.date
    ? '<div class="note" style="margin-bottom:8px;'+(stale?' color:var(--out);':'')+'">Rates as at '+
        prettyDate(b.date)+(stale ? ' — '+age+' days old, refresh when you have signal' : '')+'</div>'
    : '<div class="note" style="margin-bottom:8px;">Not fetched yet.</div>';

  box.innerHTML = head + codes.map(c=>{
    const r = Number(b.rates[c]);
    if(!r || !isFinite(r)){
      return '<div class="rateline"><div class="rl-l">'+esc(b.base)+' → '+esc(c)+
        '</div><div class="rl-r" style="color:var(--text3);">—</div></div>';
    }
    return '<div class="rateline"><div><div class="rl-l">1 '+esc(b.base)+' = '+
      r.toFixed(4)+' '+esc(c)+'</div>'+
      '<div class="rl-sub">1 '+esc(c)+' = '+(1/r).toFixed(4)+' '+esc(b.base)+
      ' · '+esc((CURRENCIES[c]||{name:c}).name)+'</div></div>'+
      '<div class="rl-r">'+(CURRENCIES[c]||{sym:''}).sym+r.toFixed(2)+'</div></div>';
  }).join('');
}

function syncRateSelects(){
  const b = rateBoard();
  buildCurrencySelect(document.getElementById('rates-base'), b.base || curCode());
  [1,2,3].forEach(i=>{
    const el = document.getElementById('rates-c'+i);
    buildCurrencySelect(el, b.codes[i-1] || '');
    // A blank option, so you can watch fewer than three.
    el.insertAdjacentHTML('afterbegin', '<option value="">—</option>');
    el.value = b.codes[i-1] || '';
  });
}

function readRateSelects(){
  const b = rateBoard();
  b.base = document.getElementById('rates-base').value || curCode();
  b.codes = [1,2,3].map(i=>document.getElementById('rates-c'+i).value).filter(Boolean);
  // Watching your own base tells you nothing, and duplicates waste a slot.
  b.codes = b.codes.filter((c,i)=> c !== b.base && b.codes.indexOf(c) === i);
  saveRateBoard(b);
  return b;
}

async function refreshRateBoard(){
  const b = readRateSelects();
  const box = document.getElementById('rates-board');
  const codes = b.codes.filter(c=>c !== b.base);
  if(!codes.length){ renderRateBoard(); return; }
  if(box) box.innerHTML = '<div class="note">Fetching rates...</div>';
  let any = false, when = null;
  for(const c of codes){
    try{
      const r = await fetchRate(b.base, c);
      b.rates[c] = r.rate; when = r.date || when; any = true;
    }catch(e){ /* keep whatever was cached for this one */ }
  }
  if(any){ b.date = when || todayYMD(); b.fetchedAt = todayYMD(); saveRateBoard(b); }
  renderRateBoard();
  if(!any && box){
    box.innerHTML = '<div class="note" style="color:var(--out);">Could not reach a rate service. '+
      'Showing whatever was last saved.</div>' + box.innerHTML;
    renderRateBoard();
  }
  renderMore();
}

document.getElementById('open-rates').onclick = ()=>{
  const b = rateBoard();
  if(!b.base) b.base = curCode();
  saveRateBoard(b);
  syncRateSelects();
  renderRateBoard();
  openSheet('rates-backdrop');
};
document.getElementById('rates-close').onclick = ()=> closeSheet('rates-backdrop');
document.getElementById('rates-refresh').onclick = ()=> refreshRateBoard();
['rates-base','rates-c1','rates-c2','rates-c3'].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', ()=>{ readRateSelects(); renderRateBoard(); renderMore(); });
});

// ---- Fix an import that came in as the wrong currency ----
// Deliberately scoped. applyConversion() rewrites every figure in the app and
// flips the base currency; that is right when you are moving countries and wrong
// when one statement out of several arrived in the wrong money.
function fximpMatches(){
  const acct = document.getElementById('fximp-acct').value;
  const d1 = document.getElementById('fximp-d1').value || '';
  const d2 = document.getElementById('fximp-d2').value || '';
  return txns.filter(t=>{
    if(t.acct !== acct) return false;
    if(t.dir === 'transfer') return false;
    // Rows converted at import time already carry their rate. Converting them
    // again would double-apply it.
    if(t.fxRate) return false;
    if(d1 && t.date < d1) return false;
    if(d2 && t.date > d2) return false;
    return true;
  });
}

function renderFximpPreview(){
  const box = document.getElementById('fximp-preview');
  const from = document.getElementById('fximp-from').value;
  const rate = Number(document.getElementById('fximp-rate').value) || 0;
  document.getElementById('fximp-target').textContent = curCode();
  document.getElementById('fximp-source').textContent = from || '—';
  const hits = fximpMatches();
  const total = hits.reduce((s,t)=>s + (t.dir==='out' ? t.amount : 0), 0);

  if(from === curCode()){
    box.innerHTML = 'Those figures are already in '+esc(curCode())+' — nothing to convert.';
    document.getElementById('fximp-go').style.opacity = 0.4;
    return;
  }
  if(!hits.length){
    box.innerHTML = 'No transactions match. Check the account and the dates — rows already converted at import are skipped automatically.';
    document.getElementById('fximp-go').style.opacity = 0.4;
    return;
  }
  if(!(rate > 0)){
    box.innerHTML = '<b>'+hits.length+' transaction'+(hits.length===1?'':'s')+' selected.</b><br>'+
      'Set the rate to see what they become.';
    document.getElementById('fximp-go').style.opacity = 0.4;
    return;
  }
  box.innerHTML = '<b>'+hits.length+' transaction'+(hits.length===1?'':'s')+' will be converted</b> from '+
    esc(from)+' to '+esc(curCode())+' at '+rate.toFixed(4)+'.<br>'+
    'Spending in that selection goes from '+money0(total)+' to '+money0(total*rate)+'.';
  document.getElementById('fximp-go').style.opacity = 1;
}

function applyImportFx(acct, from, rate, rateDate, hits){
  snapshot('Convert '+hits.length+' imported transaction'+(hits.length===1?'':'s')+' from '+from);
  const ids = new Set(hits.map(t=>t.id));
  txns = txns.map(t=> ids.has(t.id)
    ? {...t,
       amount: Math.round(t.amount * rate * 100) / 100,
       srcCur: from,
       srcAmount: Math.round(t.amount * 100) / 100,
       fxRate: rate}
    : t);
  // Record the exact ids, so reversing touches those rows and nothing else.
  settings.fxFixes = (settings.fxFixes||[]).concat([{
    on: todayYMD(), acct, from, to: curCode(), rate,
    rateDate: rateDate || todayYMD(), ids: [...ids]
  }]);
  save(K.txns, txns); save(K.settings, settings);
  render();
  return ids.size;
}

function reverseImportFx(entry){
  snapshot('Undo '+entry.from+'→'+entry.to+' on '+entry.ids.length+' transaction'+(entry.ids.length===1?'':'s'));
  const ids = new Set(entry.ids || []);
  txns = txns.map(t=>{
    if(!ids.has(t.id)) return t;
    const back = {...t, amount: Math.round((t.amount / entry.rate) * 100) / 100};
    delete back.srcCur; delete back.srcAmount; delete back.fxRate;
    return back;
  });
  settings.fxFixes = (settings.fxFixes||[]).filter(f=>f !== entry);
  save(K.txns, txns); save(K.settings, settings);
  render();
}

document.getElementById('open-fximport').onclick = ()=>{
  if(!accts.length){ alert('Add an account first: tap the gear, then Set up, then Accounts.'); return; }
  fillSelect(document.getElementById('fximp-acct'), accts);
  buildCurrencySelect(document.getElementById('fximp-from'), curCode());
  document.getElementById('fximp-target2').textContent = curCode();
  document.getElementById('fximp-rate').value = '';
  document.getElementById('fximp-d1').value = '';
  document.getElementById('fximp-d2').value = '';
  renderFximpPreview();
  openSheet('fximport-backdrop');
};
document.getElementById('fximp-close').onclick = ()=> closeSheet('fximport-backdrop');
['fximp-acct','fximp-from','fximp-d1','fximp-d2','fximp-rate'].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', renderFximpPreview);
  if(el) el.addEventListener('input', renderFximpPreview);
});
document.getElementById('fximp-fetch').onclick = async ()=>{
  const from = document.getElementById('fximp-from').value;
  const box = document.getElementById('fximp-preview');
  if(from === curCode()) return;
  box.textContent = 'Looking up the rate...';
  try{
    const r = await fetchRate(from, curCode());
    document.getElementById('fximp-rate').value = r.rate;
  }catch(e){
    box.innerHTML = '<b style="color:var(--out)">Could not reach a rate service.</b> Type the rate in above.';
    return;
  }
  renderFximpPreview();
};
document.getElementById('fximp-go').onclick = ()=>{
  const acct = document.getElementById('fximp-acct').value;
  const from = document.getElementById('fximp-from').value;
  const rate = Number(document.getElementById('fximp-rate').value) || 0;
  if(from === curCode() || !(rate > 0)) return;
  const hits = fximpMatches();
  if(!hits.length) return;
  const total = hits.reduce((s,t)=>s + (t.dir==='out' ? t.amount : 0), 0);
  if(!confirm('Convert '+hits.length+' transaction'+(hits.length===1?'':'s')+' from '+from+
    ' to '+curCode()+' at '+rate.toFixed(4)+'?\n\n'+
    'Spending in that selection goes from '+money0(total)+' to '+money0(total*rate)+'.\n\n'+
    'The original figures are kept on each row and this can be undone from More.')) return;
  const n = applyImportFx(acct, from, rate, todayYMD(), hits);
  renderFximpPreview();
  renderMore();
  alert(n+' transaction'+(n===1?'':'s')+' converted. Your totals are corrected.');
};

document.getElementById('open-fxfix').onclick = ()=>{ renderFxFix(); openSheet('fxfix-backdrop'); };
document.getElementById('fxfix-close').onclick = ()=> closeSheet('fxfix-backdrop');
document.getElementById('fxfix-all').onclick = ()=>{
  const log = (settings.fxLog||[]).slice();
  if(!log.length) return;
  const first = log[0];
  if(!confirm('Reverse all '+log.length+' conversions and return every figure to '+first.from+'?')) return;
  snapshot('Reverse all conversions');
  while((settings.fxLog||[]).length){
    const e = settings.fxLog[settings.fxLog.length-1];
    reverseConversion(e);
  }
  renderFxFix();
  alert('All conversions reversed. Everything is back in '+first.from+'.');
};

// Same account, same day, same amount, same direction is the same payment.
// Transfers are excluded — paying the same amount twice between accounts on one
// day is legitimate and not something to quietly delete.
// The merchant behind a transaction, or '' when the description names none.
// merchantKey() already strips card numbers, references and filler words, so
// "CARD 445512" reduces to nothing while "PRET A MANGER LDN" reduces to a
// stable merchant. The note is searched too: an import often parks the real
// merchant there when the description column was the useless one.
function dupeMerchant(t){
  return merchantKey(t.desc) || merchantKey(t.note) || '';
}

// Two tiers, and the line between them is the MERCHANT, not the raw text.
//
// The commonest real duplicate is a statement imported twice where the two
// copies do NOT read the same — once as the bank's reference ("CARD 445512"),
// once with the merchant resolved ("PRET A MANGER LDN"). Splitting on the exact
// description would file every one of those under "check it yourself", which is
// precisely the pile that needs to be clearable in one press.
//
// CERTAIN: same account, date, direction and amount, and at most ONE distinct
// merchant across the group. One of the copies naming no merchant at all counts
// as agreement — it carries no evidence of being a different payment.
//
// POSSIBLE: two or more distinct merchants at the same amount on the same day.
// A coffee and a tube fare that both cost 3.20 are not a duplicate. These are
// never touched in bulk; they are shown separately and decided one at a time.
function duplicateScan(){
  const map = {};
  txns.filter(t=>t.dir!=='transfer').forEach(t=>{
    const k = [t.acct, t.date, t.dir, Math.round(t.amount*100)].join('|');
    (map[k] = map[k] || []).push(t);
  });
  const certain = [], possible = [];
  Object.values(map).forEach(g=>{
    if(g.length < 2) return;
    const merchants = new Set();
    g.forEach(t=>{ const m = dupeMerchant(t); if(m) merchants.add(m); });
    if(merchants.size <= 1){
      certain.push(g);
    } else {
      // Copies that DO agree on a merchant are still certain among themselves;
      // only the disagreement is left for you. Two Tesco lines and one Pret
      // line means the Tesco pair is safe and the group is still worth showing.
      const byMerchant = {};
      g.forEach(t=>{ const m = dupeMerchant(t); (byMerchant[m] = byMerchant[m] || []).push(t); });
      Object.keys(byMerchant).forEach(m=>{
        if(m && byMerchant[m].length > 1) certain.push(byMerchant[m]);
      });
      possible.push(g);
    }
  });
  return {certain, possible};
}

// Kept for anything still calling the old name. Certain duplicates only —
// callers of this expect a list that is safe to remove.
function duplicateGroups(){ return duplicateScan().certain; }

// The copy worth keeping is the one carrying the most information.
function richness(t){
  return (t.cat ? 4 : 0) + (t.note ? 3 : 0) + Math.min(3, String(t.desc||'').length / 12);
}

// Which copies a group would lose, keeping the richest one. Returned rather
// than acted on, so the count shown to you and the count removed come from the
// same function and cannot drift apart.
function dropIdsFor(groups){
  const drop = new Set();
  groups.forEach(g=>{
    const sorted = g.slice().sort((a,b)=>richness(b) - richness(a));
    sorted.slice(1).forEach(t=>drop.add(t.id));
  });
  return drop;
}

function removeDuplicates(groups){
  const drop = dropIdsFor(groups);
  if(!drop.size) return 0;
  snapshot('Remove '+drop.size+' duplicate transaction'+(drop.size===1?'':'s'));
  txns = txns.filter(t=>!drop.has(t.id));
  save(K.txns, txns);
  render();
  return drop.size;
}

// Rendering a thousand duplicate cards at once is what made the transaction
// list slow enough to need pagination. Same reasoning here.
const DUPE_PAGE = 40;
let dupeShown = DUPE_PAGE;

function dupeCard(g, kind){
  const keep = g.slice().sort((a,b)=>richness(b) - richness(a))[0];
  const lose = g.length - 1;
  const descs = kind === 'possible'
    ? '<div class="note" style="margin-top:5px;">'+g.map(t=>'· '+esc(t.desc || 'no description')).join('<br>')+'</div>'
    : '';
  return '<div class="card pad" style="margin-bottom:10px;">'+
    '<div style="display:flex; justify-content:space-between; gap:10px;">'+
    '<b style="font-size:13px; word-break:break-word;">'+esc(keep.desc || 'No description')+'</b>'+
    '<span class="fig" style="white-space:nowrap;">'+money(keep.amount)+'</span></div>'+
    '<div class="note" style="margin-top:3px;">'+prettyDate(keep.date)+' · '+g.length+' copies · keeping the one '+
    (keep.cat ? 'categorised as '+esc(catById(keep.cat).name) : 'with the fullest description')+'</div>'+
    descs+
    '<div style="display:flex; gap:8px; margin-top:9px;">'+
    '<button class="btn" style="flex:1; padding:8px; font-size:12px; margin:0;" data-dupe-remove="'+esc(keep.id)+'">Remove '+lose+' cop'+(lose===1?'y':'ies')+'</button>'+
    '<button class="btn ghost" style="flex:1; padding:8px; font-size:12px; margin:0;" data-dupe-keep="'+esc(keep.id)+'">Keep both</button>'+
    '</div></div>';
}

// Groups the user has said are genuinely separate payments. Held for the life
// of the sheet only — a decision to keep is not a change to their data, so it
// is deliberately not written to storage.
let dupeKept = new Set();
function groupSig(g){ return g.map(t=>t.id).sort().join(','); }

function renderDupes(){
  const box = document.getElementById('dupe-list');
  const scan = duplicateScan();
  const certain  = scan.certain.filter(g=>!dupeKept.has(groupSig(g)));
  const possible = scan.possible.filter(g=>!dupeKept.has(groupSig(g)));
  const extra = certain.reduce((s,g)=>s+g.length-1, 0);

  const btn = document.getElementById('dupe-all');
  btn.style.display = extra ? 'block' : 'none';
  btn.textContent = 'Remove all '+extra+' certain duplicate'+(extra===1?'':'s');

  if(!certain.length && !possible.length){
    box.innerHTML = '<div class="note">No duplicates found. Every transaction is unique on account, date, amount and merchant.</div>';
    return;
  }

  let html = '';

  if(certain.length){
    const total = certain.reduce((s,g)=>s + (g[0].dir==='out' ? g[0].amount*(g.length-1) : 0), 0);
    html += '<div class="warn" style="margin-bottom:12px;"><b>'+extra+' extra cop'+(extra===1?'y':'ies')+
      '</b> across '+certain.length+' payment'+(certain.length===1?'':'s')+
      ', same merchant as well as the same money.<br>Removing them takes '+money0(total)+
      ' off your spending totals.</div>';
    html += certain.slice(0, dupeShown).map(g=>dupeCard(g,'certain')).join('');
    if(certain.length > dupeShown){
      html += '<button class="btn ghost" id="dupe-more" style="margin-bottom:14px;">Show '+
        Math.min(DUPE_PAGE, certain.length - dupeShown)+' more of '+
        (certain.length - dupeShown)+' remaining</button>';
    }
  }

  if(possible.length){
    html += '<div class="note" style="margin:16px 0 10px; padding:10px; border-radius:10px; background:rgba(217,180,74,.08);">'+
      '<b>'+possible.length+' to check yourself.</b> Same account, date and amount, but a different '+
      'merchant each time — so this could genuinely be two separate payments. These are never '+
      'removed by the button above.</div>';
    html += possible.slice(0, dupeShown).map(g=>dupeCard(g,'possible')).join('');
    if(possible.length > dupeShown){
      html += '<button class="btn ghost" id="dupe-more2" style="margin-bottom:14px;">Show more to check</button>';
    }
  }

  box.innerHTML = html;

  const more1 = document.getElementById('dupe-more');
  const more2 = document.getElementById('dupe-more2');
  if(more1) more1.onclick = ()=>{ dupeShown += DUPE_PAGE; renderDupes(); };
  if(more2) more2.onclick = ()=>{ dupeShown += DUPE_PAGE; renderDupes(); };

  // One group at a time. Anchored on the id of the copy being KEPT, so the
  // handler re-finds the group from live data rather than trusting an index
  // into a list that may have been re-rendered underneath it.
  const all = certain.concat(possible);
  box.querySelectorAll('[data-dupe-remove]').forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.dupeRemove;
      const g = all.find(x=>x.slice().sort((p,q)=>richness(q)-richness(p))[0].id === id);
      if(!g) return;
      removeDuplicates([g]);
      renderDupes(); renderMore();
    };
  });
  box.querySelectorAll('[data-dupe-keep]').forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.dupeKeep;
      const g = all.find(x=>x.slice().sort((p,q)=>richness(q)-richness(p))[0].id === id);
      if(!g) return;
      dupeKept.add(groupSig(g));
      renderDupes();
    };
  });
}

document.getElementById('open-dupes').onclick = ()=>{
  dupeShown = DUPE_PAGE; dupeKept = new Set();
  renderDupes(); openSheet('dupe-backdrop');
};
document.getElementById('dupe-close').onclick = ()=> closeSheet('dupe-backdrop');
document.getElementById('dupe-all').onclick = ()=>{
  // Certain groups only. The "possible" pile is never swept up by this button,
  // however many of them there are.
  const groups = duplicateScan().certain.filter(g=>!dupeKept.has(groupSig(g)));
  const extra = dropIdsFor(groups).size;
  if(!extra) return;
  const total = groups.reduce((s,g)=>s + (g[0].dir==='out' ? g[0].amount*(g.length-1) : 0), 0);
  if(!confirm('Remove '+extra+' duplicate transaction'+(extra===1?'':'s')+'?\n\n'+
    'These match on account, date and amount, and none of them names a different '+
    'merchant — so each one is the same statement line stored twice.\n\n'+
    'One copy of each is kept — the one with the most '+
    'detail. Your spending drops by '+money0(total)+'.\n\nThis can be undone from More.')) return;
  const n = removeDuplicates(groups);
  renderDupes();
  renderMore();
  alert(n+' duplicate'+(n===1?'':'s')+' removed. Your totals are corrected.\n\n'+
    'If that was not what you wanted, undo it from More.');
};

// Group the untagged by merchant so one decision clears many rows.
function bulkGroups(){
  const groups = {};
  txns.filter(t=>!t.cat && t.dir!=='transfer').forEach(t=>{
    const key = merchantKey(t.desc) || merchantKey(t.note) || String(t.desc||'').toLowerCase().slice(0,18) || 'unlabelled';
    (groups[key] = groups[key] || {key, items:[], sample:t}).items.push(t);
  });
  return Object.values(groups).sort((a,b)=>b.items.length - a.items.length);
}

function renderBulk(){
  const box = document.getElementById('bulk-list');
  const groups = bulkGroups();
  if(!groups.length){
    box.innerHTML = '<div class="note">Nothing left to tag — every transaction has a category.</div>';
    return;
  }
  const opts = cats.filter(c=>c.kind==='spend').map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
  const inOpts = cats.filter(c=>c.kind==='income').map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
  box.innerHTML = groups.slice(0,40).map((g,i)=>{
    const total = g.items.reduce((s,t)=>s+(t.dir==='out'?t.amount:-t.amount),0);
    const isIn = g.items[0].dir === 'in';
    return '<div class="card pad" style="margin-bottom:10px;">'+
      '<div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px;">'+
      '<b style="font-size:13.5px; word-break:break-word;">'+esc(g.sample.desc || g.key)+'</b>'+
      '<span class="fig" style="white-space:nowrap;">'+money0(Math.abs(total))+'</span></div>'+
      '<div class="note" style="margin-top:3px;">'+g.items.length+' transaction'+(g.items.length===1?'':'s')+
        (g.sample.note ? ' · '+esc(String(g.sample.note).slice(0,70)) : '')+'</div>'+
      '<select data-bulk="'+i+'" style="margin-top:8px;"><option value="">Choose a category...</option>'+
        (isIn ? inOpts : opts)+'</select>'+
      '</div>';
  }).join('');
  box.querySelectorAll('[data-bulk]').forEach(sel=>{
    sel.onchange = ()=>{
      const g = groups[Number(sel.dataset.bulk)];
      const cat = sel.value;
      if(!g || !cat) return;
      snapshot('Tag '+g.items.length+' transaction'+(g.items.length===1?'':'s'));
      const ids = new Set(g.items.map(t=>t.id));
      txns = txns.map(t=> ids.has(t.id) ? {...t, cat} : t);
      // Remember it, so this merchant never needs tagging again.
      if(g.key && g.key.length >= 3 && !rules.some(r=>r.match.toLowerCase()===g.key)){
        rules.push({match:g.key, cat});
        save(K.rules, rules);
      }
      save(K.txns, txns);
      render();
      renderBulk();
    };
  });
}

document.getElementById('open-bulk').onclick = ()=> openSort();   // v52: the one-tap list
document.getElementById('bulk-close').onclick = ()=> closeSheet('bulk-backdrop');

let pendingSec = null;

function openSecondary(){
  const sel = document.getElementById('sec-select');
  sel.innerHTML = Object.entries(CURRENCIES).filter(([code])=>code!==curCode())
    .map(([code,c])=>'<option value="'+code+'">'+code+' — '+c.name+'</option>').join('');
  sel.value = secCode() && secCode()!==curCode() ? secCode() : (curCode()==='AUD' ? 'GBP' : 'AUD');
  document.getElementById('sec-main').textContent = curCode();
  document.getElementById('sec-rate-box').innerHTML = secOn()
    ? '<div class="card pad" style="margin-bottom:10px;"><div style="display:flex; justify-content:space-between; align-items:baseline;">'+
      '<span style="font-size:13px; color:var(--text2);">Currently 1 '+curCode()+' =</span>'+
      '<span class="fig" style="font-size:18px; font-weight:600; color:var(--brass);">'+secRate().toFixed(4)+' '+secCode()+'</span></div>'+
      '<div class="note" style="margin-top:5px;">Rate from '+prettyDate(settings.secondary.rateDate)+
      (settings.secondary.manual ? ', entered by you' : '')+'. Refresh it whenever you like — it only affects the small print.</div></div>'
    : '';
  // Always offer manual entry. Rate services go down, and a rough figure typed
  // by hand is perfectly good for small print — there is no reason to make the
  // network a prerequisite.
  document.getElementById('sec-manual-wrap').style.display = 'block';
  document.getElementById('sec-manual-lab').textContent = '1 '+curCode()+' buys how many '+sel.value+'?';
  document.getElementById('sec-manual').value = '';
  document.getElementById('sec-save').style.display = 'none';
  document.getElementById('sec-off').style.display = secOn() ? 'block' : 'none';
  sel.onchange = ()=>{
    document.getElementById('sec-manual-lab').textContent = '1 '+curCode()+' buys how many '+sel.value+'?';
    document.getElementById('sec-fetch').click();
  };
  pendingSec = null;
  // v55: no button — the rate fetches itself. Typing one in only shows if that fails.
  document.getElementById('sec-manual-wrap').style.display = 'none';
  document.getElementById('sec-save').textContent = secOn() ? 'Save' : 'Turn it on';
  openSheet('secondary-backdrop');
  document.getElementById('sec-fetch').click();
}

document.getElementById('open-secondary').onclick = openSecondary;
document.getElementById('sec-close').onclick = ()=> closeSheet('secondary-backdrop');

document.getElementById('sec-fetch').onclick = async ()=>{
  const to = document.getElementById('sec-select').value;
  const from = curCode();
  const box = document.getElementById('sec-rate-box');
  box.innerHTML = '<div class="note">Fetching today\'s rate...</div>';
  try{
    const {rate, date} = await fetchRate(from, to);
    pendingSec = {code:to, rate, rateDate: date || todayYMD()};
    showSecPreview();
    document.getElementById('sec-manual-wrap').style.display = 'none';
  }catch(e){
    box.innerHTML = '<div class="warn"><b>No rate service could be reached.</b><br>'+
      'Enter the rate below instead — a rough figure is fine, this only affects the small print.'+
      '<div style="font-size:10.5px; color:var(--text3); margin-top:8px; font-family:var(--mono); line-height:1.5; word-break:break-word;">'+
      esc((e.attempts || [e.message]).join('\n'))+'</div></div>';
    document.getElementById('sec-manual-wrap').style.display = 'block';
    document.getElementById('sec-manual-lab').textContent = '1 '+from+' buys how many '+to+'?';
  }
};

// Type a rate and immediately see it applied to a real figure of yours. A rate
// entered upside down is obvious the moment it is shown as money.
document.getElementById('sec-manual').addEventListener('input', ()=>{
  const el = document.getElementById('sec-manual-check');
  const r = Number(document.getElementById('sec-manual').value);
  const to = document.getElementById('sec-select').value;
  if(!r || r <= 0){ el.textContent = ''; return; }
  const sample = liquidTotal() || 100;
  el.innerHTML = 'Your '+money0(sample)+' would show as <b>'+(CURRENCIES[to]||{sym:''}).sym+
    Math.round(Math.abs(sample)*r).toLocaleString('en-GB')+'</b> underneath. '+
    '<span style="color:var(--text3);">If that looks the wrong way round, use '+(1/r).toFixed(4)+' instead.</span>';
});

document.getElementById('sec-manual-go').onclick = ()=>{
  const rate = Number(document.getElementById('sec-manual').value);
  if(!rate || rate <= 0){ alert('Enter the rate as a number, for example 1.94.'); return; }
  pendingSec = {code: document.getElementById('sec-select').value, rate, rateDate: todayYMD(), manual:true};
  showSecPreview();
};

function showSecPreview(){
  const p = pendingSec;
  const sample = liquidTotal() || 100;
  document.getElementById('sec-rate-box').innerHTML =
    '<div class="card pad" style="margin-bottom:10px;">'+
    '<div style="display:flex; justify-content:space-between; align-items:baseline;">'+
    '<span style="font-size:13px; color:var(--text2);">1 '+curCode()+' buys</span>'+
    '<span class="fig" style="font-size:20px; font-weight:600; color:var(--brass);">'+p.rate.toFixed(4)+' '+p.code+'</span></div>'+
    '<div class="note" style="margin-top:6px;">Your accounts would read '+money0(sample)+
    ' <span style="color:var(--text3);">'+(CURRENCIES[p.code]||{sym:''}).sym+
    Math.round(Math.abs(sample)*p.rate).toLocaleString('en-GB')+'</span>'+
    (p.manual ? '. Rate entered by you.' : '. Rate from '+prettyDate(p.rateDate)+'.')+'</div></div>';
  document.getElementById('sec-save').style.display = 'block';
}

document.getElementById('sec-save').onclick = ()=>{
  if(!pendingSec) return;
  settings.secondary = pendingSec;
  save(K.settings, settings);
  closeSheet('secondary-backdrop');
  render();
};

document.getElementById('sec-off').onclick = ()=>{
  delete settings.secondary;
  save(K.settings, settings);
  closeSheet('secondary-backdrop');
  render();
};

let pendingFx = null;

function openCurrency(){
  const sel = document.getElementById('cur-select');
  sel.innerHTML = Object.entries(CURRENCIES).map(([code,c])=>
    '<option value="'+code+'">'+code+' — '+c.name+'</option>').join('');
  sel.value = curCode();
  document.getElementById('cur-current').textContent = curCode()+' ('+curSym().trim()+')';
  document.getElementById('cur-rate-box').innerHTML = '';
  document.getElementById('cur-manual-wrap').style.display = 'none';
  document.getElementById('cur-apply').style.display = 'none';
  pendingFx = null;
  renderFxLog();
  openSheet('currency-backdrop');
}

function renderFxLog(){
  const log = (settings.fxLog||[]).slice().reverse();
  document.getElementById('cur-log').innerHTML = log.length === 0 ? '' :
    '<div class="rule">Past changes</div><div class="card">' + log.slice(0,8).map(f=>
      '<div class="lrow"><div><div class="d1">'+f.from+' → '+f.to+'</div>'+
      '<div class="d2">Rate '+f.rate.toFixed(4)+' from '+prettyDate(f.rateDate)+'</div></div>'+
      '<div class="amtcol"><span class="sub">'+prettyDate(f.on)+'</span></div></div>').join('') + '</div>';
}

document.getElementById('cur-fetch').onclick = async ()=>{
  const to = document.getElementById('cur-select').value;
  const from = curCode();
  const box = document.getElementById('cur-rate-box');
  if(to === from){ box.innerHTML = '<div class="note">That is already your currency.</div>'; return; }
  box.innerHTML = '<div class="note">Fetching today\'s rate...</div>';
  document.getElementById('cur-apply').style.display = 'none';
  try{
    const {rate, date} = await fetchRate(from, to);
    pendingFx = {from, to, rate, rateDate: date};
    showFxPreview();
    document.getElementById('cur-manual-wrap').style.display = 'none';
  }catch(e){
    box.innerHTML = '<div class="warn"><b>No rate service could be reached.</b><br>'+
      'Enter the rate yourself and Ledger will use that instead.'+
      '<div style="font-size:10.5px; color:var(--text3); margin-top:8px; font-family:var(--mono); line-height:1.5; word-break:break-word;">'+
      esc((e.attempts || [e.message]).join('\n'))+'</div></div>';
    document.getElementById('cur-manual-wrap').style.display = 'block';
    document.getElementById('cur-manual-lab').textContent = '1 '+from+' buys how many '+to+'?';
  }
};

document.getElementById('cur-manual-go').onclick = ()=>{
  const rate = Number(document.getElementById('cur-manual').value);
  if(!rate || rate <= 0){ alert('Enter the rate as a number, for example 1.94.'); return; }
  pendingFx = {from: curCode(), to: document.getElementById('cur-select').value, rate, rateDate: todayYMD(), manual:true};
  showFxPreview();
};

function showFxPreview(){
  const f = pendingFx;
  const sampleFrom = liquidTotal();
  const box = document.getElementById('cur-rate-box');
  box.innerHTML =
    '<div class="card pad" style="margin-bottom:10px;">'+
    '<div style="display:flex; justify-content:space-between; align-items:baseline;">'+
    '<span style="font-size:13px; color:var(--text2);">1 '+f.from+' buys</span>'+
    '<span class="fig" style="font-size:20px; font-weight:600; color:var(--brass);">'+f.rate.toFixed(4)+' '+f.to+'</span></div>'+
    '<div class="note" style="margin-top:5px;">'+(f.manual
      ? 'Rate you entered by hand.'
      : 'European Central Bank reference rate from '+prettyDate(f.rateDate)+'.')+'</div></div>'+
    '<div class="warn">Your accounts total '+money(sampleFrom)+' now and would become '+
    (CURRENCIES[f.to].sym)+(sampleFrom*f.rate).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})+'.'+
    '<br><br>Every stored figure is converted at this one rate, including transactions from months ago. '+
    'That restates old spending at today\'s rate rather than the rate on the day it happened. '+
    'Back up first — the change is applied to your data, not just the display.</div>';
  document.getElementById('cur-apply').style.display = 'block';
  document.getElementById('cur-apply').textContent = 'Convert everything to '+f.to;
}

document.getElementById('cur-apply').onclick = ()=>{
  if(!pendingFx) return;
  const f = pendingFx;
  if(!confirm('Convert all your data from '+f.from+' to '+f.to+' at '+f.rate.toFixed(4)+'? Back up first if you have not.')) return;
  applyConversion(f.from, f.to, f.rate, f.rateDate);
  pendingFx = null;
  closeSheet('currency-backdrop');
};
