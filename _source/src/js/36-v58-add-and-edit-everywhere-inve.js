// ============================================================
// v58: add and edit everywhere - investment categories, holdings, entries,
// any broker's history file, and spending categories
// ============================================================

// ---------------- an investment category ----------------
let invCatEditing = null;
function openInvCatSheet(id){
  invCatEditing = id;
  const c = id ? invCatInfo(id) : {name:'', type:'shares'};
  document.getElementById('ic-title').textContent = id ? 'Edit '+c.name : 'New category';
  document.getElementById('ic-name').value = id ? c.name : '';
  document.querySelectorAll('#ic-type [data-type]').forEach(b=> b.classList.toggle('on', b.dataset.type === c.type));
  const n = id ? invest.trades.filter(t=>t.cat===id).length : 0;
  const del = document.getElementById('ic-delete');
  del.style.display = id ? '' : 'none';
  del.textContent = n ? 'Delete this category and its '+n+' entries' : 'Delete this category';
  openSheet('invcat-backdrop');
  setTimeout(()=> document.getElementById('ic-name').focus(), 250);
}
document.querySelectorAll('#ic-type [data-type]').forEach(b=> b.onclick = ()=>{
  document.querySelectorAll('#ic-type [data-type]').forEach(x=> x.classList.toggle('on', x===b));
});
document.getElementById('ic-save').onclick = ()=>{
  const name = document.getElementById('ic-name').value.trim();
  if(!name){ alert('Give it a name.'); return; }
  const on = document.querySelector('#ic-type [data-type].on');
  const type = on ? on.dataset.type : 'other';
  const list = invCats();
  if(list.some(c=> c.name.toLowerCase() === name.toLowerCase() && c.id !== invCatEditing)){ alert('You already have a category called '+name+'.'); return; }
  if(invCatEditing){ const c = list.find(x=>x.id===invCatEditing); c.name = name; c.type = type; }
  else list.push({id:uid(), name, type});
  saveInvest(); closeSheet('invcat-backdrop'); render(); if(invOpen) invDraw();
};
document.getElementById('ic-delete').onclick = ()=>{
  const id = invCatEditing; if(!id) return;
  const n = invest.trades.filter(t=>t.cat===id).length;
  if(!confirm(n ? 'Delete '+invCatInfo(id).name+' and all '+n+' of its entries?\n\nYou can undo this straight after.' : 'Delete '+invCatInfo(id).name+'?')) return;
  snapshot('Delete '+invCatInfo(id).name);
  invest.cats = invCats().filter(c=>c.id!==id);
  invest.trades = invest.trades.filter(t=> t.cat !== id && !(id === 'crypto' && t.cat === 'cash'));
  assets.forEach(a=>{ if(a.covered === id) delete a.covered; }); save(K.assets, assets);
  saveInvest(); closeSheet('invcat-backdrop');
  if(invOpen){ invStack = []; invBack(); }
  render();
  showToast('Deleted', ()=> doRollback());
};
document.getElementById('inv-edit').onclick = ()=>{
  const top = invStack[invStack.length-1]; if(!top) return;
  if(top.sym) renameHolding(top.cat, top.sym); else openInvCatSheet(top.cat);
};
function renameHolding(cat, sym){
  const now = symName(cat, sym);
  const v = prompt('What should '+sym+' be called?', now);
  if(v == null) return;
  invest.names = invest.names || {};
  if(v.trim() && v.trim() !== sym) invest.names[cat+':'+sym] = v.trim(); else delete invest.names[cat+':'+sym];
  saveInvest(); invDraw(); render();
}

// ---------------- one entry: bought, sold, value, dividend ----------------
const ENTRY_KINDS = [['buy','Bought'],['sell','Sold'],['value','Value now'],['reward','Dividend or reward']];
const ENTRY_CURS = ['GBP','AUD','USD','EUR'];
let invEntry = null;
function openInvEntry(o){
  const t = o.edit || null;
  invEntry = {cat: t ? t.cat : o.cat, sym: t ? t.sym : (o.sym || ''), edit: t, fresh: !!o.fresh && !t};
  const cw = document.getElementById('ie-cat-wrap');
  cw.style.display = o.pickCat ? '' : 'none';
  if(o.pickCat){
    const sel = document.getElementById('ie-cat');
    sel.innerHTML = invCats().map(c=> '<option value="'+esc(c.id)+'"'+(c.id===invEntry.cat?' selected':'')+'>'+esc(c.name)+'</option>').join('');
    sel.onchange = ()=> openInvEntry({cat:sel.value, kind:ieKind(), fresh:true, pickCat:true});
  }
  const kind = t ? t.kind : (o.kind || 'buy');
  document.getElementById('ie-title').textContent = t ? 'Edit entry' : invEntry.sym ? symName(invEntry.cat, invEntry.sym) : 'Add to '+invCatInfo(invEntry.cat).name;
  // holding: fixed when we know it, otherwise pick one or type a new one
  const S = invCategory(invEntry.cat);
  const known = Object.keys(S.P).sort();
  const pick = document.getElementById('ie-hold');
  pick.innerHTML = known.map(s=> '<option value="'+esc(s)+'">'+esc(symName(invEntry.cat, s))+(symName(invEntry.cat,s)!==s?' ('+esc(s)+')':'')+'</option>').join('')+'<option value="__new">Something new…</option>';
  pick.value = invEntry.sym && known.includes(invEntry.sym) ? invEntry.sym : (known.length && !invEntry.fresh ? known[0] : '__new');
  document.getElementById('ie-hold-wrap').style.display = invEntry.sym ? 'none' : '';
  document.getElementById('ie-code').value = ''; document.getElementById('ie-name').value = '';
  document.querySelectorAll('#ie-kind [data-kind]').forEach(b=> b.classList.toggle('on', b.dataset.kind === kind));
  document.getElementById('ie-kind').style.display = (t && (t.kind==='in'||t.kind==='out')) ? 'none' : '';
  document.getElementById('ie-date').value = t ? t.date : todayYMD();
  document.getElementById('ie-qty').value = t && t.qty ? +t.qty.toPrecision(10) : '';
  document.getElementById('ie-total').value = t ? (t.orig ? t.orig.amt : +t.gbp.toFixed(2)) : '';
  document.getElementById('ie-fee').value = t && t.fee ? (t.orig && t.orig.fee != null ? t.orig.fee : +t.fee.toFixed(2)) : '';
  document.getElementById('ie-cur').innerHTML = ENTRY_CURS.map(c=> '<option>'+c+'</option>').join('');
  document.getElementById('ie-cur').value = t && t.orig ? t.orig.cur : (settings.invCur || 'GBP');
  document.getElementById('ie-delete').style.display = t ? '' : 'none';
  document.getElementById('ie-err').textContent = '';
  const fromFile = t && t.src && t.src !== 'manual';
  document.getElementById('ie-src').textContent = fromFile ? 'From your '+(t.src==='coinbase'?'Coinbase':'imported')+' file. Editing it here is fine; importing the same file again will not undo your change.' : '';
  ieShape();
  openSheet('inventry-backdrop');
}
function ieKind(){ const b = document.querySelector('#ie-kind [data-kind].on'); return b ? b.dataset.kind : (invEntry.edit ? invEntry.edit.kind : 'buy'); }
function ieSym(){
  if(invEntry.sym) return invEntry.sym;
  const v = document.getElementById('ie-hold').value;
  return v === '__new' ? document.getElementById('ie-code').value.trim().toUpperCase() : v;
}
// Show only the boxes that matter for this kind of entry.
function ieShape(){
  const k = ieKind(), isNew = !invEntry.sym && document.getElementById('ie-hold').value === '__new';
  document.getElementById('ie-new').style.display = isNew ? '' : 'none';
  document.getElementById('ie-qty-wrap').style.display = k === 'value' ? 'none' : '';
  document.getElementById('ie-fee-wrap').style.display = (k === 'buy' || k === 'sell') ? '' : 'none';
  document.getElementById('ie-qty-lab').textContent = k === 'reward' ? 'Units received (leave blank if paid as cash)' : 'How many';
  document.getElementById('ie-total-lab').textContent = k === 'buy' ? 'Total paid' : k === 'sell' ? 'Total received' : k === 'value' ? 'What it is all worth now' : 'Amount';
  const sym = ieSym(), p = sym && invCategory(invEntry.cat).P[sym];
  document.getElementById('ie-hint').textContent = p && p.qty ? 'You hold '+fmtQty(p.qty)+' '+sym+'.' : '';
}
document.querySelectorAll('#ie-kind [data-kind]').forEach(b=> b.onclick = ()=>{
  document.querySelectorAll('#ie-kind [data-kind]').forEach(x=> x.classList.toggle('on', x===b)); ieShape();
});
document.getElementById('ie-hold').onchange = ieShape;
async function toBaseOn(cur, day){
  if(cur === 'GBP') return 1;
  if(cur === 'USD'){ const r = usdGbpOn(day); if(r) return r; }
  try{
    const s = await fetchRateSeries(cur, 'GBP', ymd(new Date(parseYMD(day).getTime() - 6*864e5)), day);
    if(s){ const ks = Object.keys(s).filter(k=>k<=day).sort(); if(ks.length) return s[ks[ks.length-1]]; }
  }catch(e){}
  return 0;
}
document.getElementById('ie-save').onclick = async ()=>{
  const err = m => { document.getElementById('ie-err').textContent = m; };
  const k = ieKind(), cat = invEntry.cat, sym = ieSym();
  const date = document.getElementById('ie-date').value || todayYMD();
  const num = id => { const v = String(document.getElementById(id).value||'').replace(/[£$€,\s]/g,''); return v === '' ? null : Number(v); };
  const qty = num('ie-qty'), total = num('ie-total'), fee = num('ie-fee') || 0;
  if(!sym) return err('Give it a short code, like VAS or NDQ.');
  if(!/^[A-Z0-9.\-]{1,12}$/.test(sym)) return err('The code can only use letters and numbers (up to 12).');
  if(!(total >= 0) || total === null) return err('Put in the amount.');
  if(k !== 'value' && k !== 'reward' && !(qty > 0)) return err('Put in how many.');
  const p = invCategory(cat).P[sym];
  const heldBefore = p ? p.qty + (invEntry.edit && invEntry.edit.kind === 'sell' ? invEntry.edit.qty : 0) - (invEntry.edit && invEntry.edit.kind === 'buy' ? invEntry.edit.qty : 0) : 0;
  if(k === 'sell' && qty > heldBefore + 1e-9) return err('That is more than you hold ('+fmtQty(heldBefore)+').');
  if(k === 'value' && !(heldBefore > 0)) return err('Add what you bought first, then its value.');
  const cur = document.getElementById('ie-cur').value;
  const rate = await toBaseOn(cur, date);
  if(!rate) return err('Could not get the '+cur+' rate for that day. Try again online, or enter it in GBP.');
  settings.invCur = cur; save(K.settings, settings);
  const gbp = total * rate;
  const q = k === 'value' ? 0 : (qty || 0);
  const price = k === 'value' ? gbp / heldBefore : (q > 0 ? gbp / q : 0);
  const fields = {cat, sym, kind:k, date, ts: date+' 12:00:00', qty:q, gbp, fee: (k==='buy'||k==='sell') ? fee*rate : 0, price,
    orig: cur === 'GBP' ? undefined : {cur, amt:total, fee}};
  snapshot(invEntry.edit ? 'Edit '+sym : 'Add '+sym);
  if(invEntry.edit){
    Object.assign(invEntry.edit, fields, {fxGuess:0});
    if(!fields.orig) delete invEntry.edit.orig;
  } else {
    invest.trades.push(Object.assign({id:uid(), ext:'me:'+uid(), src:'manual', note:'Added in Ledger'}, fields));
  }
  if(!invEntry.sym && document.getElementById('ie-hold').value === '__new'){
    const nm = document.getElementById('ie-name').value.trim();
    if(nm){ invest.names = invest.names || {}; invest.names[cat+':'+sym] = nm; }
  }
  sortTrades(); saveInvest();
  closeSheet('inventry-backdrop');
  render();
  if(invOpen){
    const top = invStack[invStack.length-1];
    if(!top.sym && invEntry.fresh) invStack.push({cat, sym});
    invDraw();
  }
  buzz();
  sfx(k === 'sell' ? 'book' : k === 'value' ? 'pencil' : 'arcade');
};
document.getElementById('ie-delete').onclick = ()=>{
  const t = invEntry.edit; if(!t) return;
  if(!confirm('Delete this entry?')) return;
  snapshot('Delete entry');
  invest.trades = invest.trades.filter(x=> x !== t);
  saveInvest(); closeSheet('inventry-backdrop'); render();
  if(invOpen){
    const top = invStack[invStack.length-1];
    if(top.sym && !invest.trades.some(x=> x.cat===top.cat && x.sym===top.sym)) invStack.pop();
    if(invStack.length) invDraw(); else invBack();
  }
  showToast('Entry deleted', ()=> doRollback());
};

// ---------------- any broker's history file ----------------
// Columns are matched by their names (most brokers use similar words), you can
// change any of them, and the preview shows exactly what will be added.
const IMP_FIELDS = [
  ['date','Date', /date|time|settle/i],
  ['code','Code', /code|symbol|ticker|security|instrument|asset|stock|holding|investment|name/i],
  ['type','Buy or sell', /type|action|side|activity|transaction|direction|description/i],
  ['qty','How many', /quantity|units|shares|qty|no\.? of|volume/i],
  ['total','Total', /total|value|amount|consideration|cost|proceeds|net/i],
  ['price','Price each', /price/i],
  ['fee','Fee', /fee|brokerage|commission|charge/i],
  ['cur','Currency', /currency|ccy/i]
];
let invImp = null;
function impNum(s){ const v = String(s==null?'':s).replace(/[^0-9.\-()]/g,''); if(!v) return null; const neg = /^\(.*\)$/.test(v) || /-/.test(String(s)); const n = Math.abs(parseFloat(v.replace(/[()]/g,''))); return isFinite(n) ? (neg ? -n : n) : null; }
function impDate(s){
  s = String(s||'').trim().replace(/,?[T\s]+\d{1,2}:\d{2}.*$/,'').replace(/^(\d{1,2})(st|nd|rd|th)\b/i,'$1').replace(/,/g,'').trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if(m) return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);       // day first: UK and Australia
  if(m){ const y = m[3].length === 2 ? '20'+m[3] : m[3]; return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'); }
  m = s.match(/^(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?\s*,?\s*(\d{2,4})$/);
  if(m && MONTHS[m[2].toLowerCase()] != null){ const y = m[3].length === 2 ? '20'+m[3] : m[3]; return y+'-'+String(MONTHS[m[2].toLowerCase()]+1).padStart(2,'0')+'-'+m[1].padStart(2,'0'); }
  m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/);
  if(m && MONTHS[m[1].toLowerCase()] != null) return m[3]+'-'+String(MONTHS[m[1].toLowerCase()]+1).padStart(2,'0')+'-'+m[2].padStart(2,'0');
  return null;
}
function impKind(typeText, qty, total){
  const s = String(typeText||'').toLowerCase();
  if(/dividend|distribution|interest|reinvest.*div/.test(s)) return 'reward';
  if(/sell|sold|sale|redeem|redemption|withdraw/.test(s)) return 'sell';
  if(/buy|bought|purchase|applied|application|invest|deposit|contribution/.test(s)) return 'buy';
  if(/fee|tax|cash|transfer/.test(s)) return null;
  if(qty != null && qty < 0) return 'sell';
  if(qty != null && qty > 0) return 'buy';
  return null;
}
// A broker CASH statement (Pearler's "transaction statement" is one): it has
// money going in and out but no shares.
//  - Deposit, and a Transfer INTO the account from outside ("to AU Cash",
//    plus amount - Pearler's auto-invest from your bank) = money in.
//  - Withdraw = money out.
//  - A small Transfer out ("-$6.50 to AU Cash") = a brokerage fee.
//  - Reward = a reward. Fees and rewards are shown, never added to money
//    in/out (the cash they move is already inside the withdrawals).
//  - "from US Cash" etc. = your own money moving between your cash
//    accounts (sale money): left out.
function cashStatement(rows){
  const hi = rows.findIndex(r=> r.some(c=>/^action$/i.test(String(c).trim())) && r.some(c=>/^value$/i.test(String(c).trim())) && r.some(c=>/^date$/i.test(String(c).trim())));
  if(hi < 0) return null;
  const H = rows[hi].map(c=> String(c).trim().toLowerCase());
  const ia = H.indexOf('action'), iv = H.indexOf('value'), id = H.indexOf('date'), ic = H.indexOf('currency'), ip = H.indexOf('is pending'), ide = H.indexOf('description');
  const out = [];
  rows.slice(hi+1).forEach(r=>{
    if(r.length < 3) return;
    if(ip >= 0 && /true/i.test(r[ip])) return;
    const a = String(r[ia]||'').trim().toLowerCase();
    const date = impDate(r[id]), v = impNum(r[iv]);
    if(!date || v == null || !v) return;
    const desc = String(ide >= 0 ? r[ide] : '').trim().toLowerCase();
    let kind = null;
    if(/^deposit/.test(a)) kind = 'deposit';
    else if(/^withdraw/.test(a)) kind = 'withdraw';
    else if(/^reward/.test(a)) kind = 'creward';
    else if(/^transfer/.test(a) && !/^from\b/.test(desc)){
      if(v > 0) kind = 'deposit';
      else if(Math.abs(v) <= 20) kind = 'cfee';
    }
    if(!kind) return;
    const cur = ic >= 0 && /^[A-Z]{3}$/.test(String(r[ic]).trim()) ? String(r[ic]).trim() : 'AUD';
    out.push({date, code:'CASH', kind, qty:0, total:Math.abs(v), fee:0, cur, ext:'cash:'+[date, kind, Math.abs(v).toFixed(2), String(r[id]).trim()].join('|')});
  });
  return out;
}
function openInvImport(cat, text, fname){
  const rows = parseCSV(text);
  const cash = cashStatement(rows);
  if(cash){
    invImp = {cat, cash, fname, cur: cash[0] ? cash[0].cur : 'AUD', rows:[], map:{}};
    document.getElementById('ii-title').textContent = 'Import into '+invCatInfo(cat).name;
    document.getElementById('ii-file').textContent = fname || 'Your file';
    document.getElementById('ii-file').parentNode.lastChild.textContent = '. Here is what is in it.';
    const sum = k => cash.filter(e=>e.kind===k).reduce((t,e)=>t+e.total,0);
    const cur = invImp.cur;
    document.getElementById('ii-map').innerHTML = '<div class="ii-row"><span>This is a cash statement</span></div>'+
      '<p class="note" style="margin:0 0 10px;">This file has money in and out, not shares. Totals and profit will be right; shares won\'t be listed.</p>'+
      '<div class="ii-row"><span>Paid in</span><b class="fig">'+cur+' '+sum('deposit').toLocaleString('en-GB',{minimumFractionDigits:2})+'</b></div>'+
      '<div class="ii-row"><span>Taken out</span><b class="fig">'+cur+' '+sum('withdraw').toLocaleString('en-GB',{minimumFractionDigits:2})+'</b></div>'+
      '<div class="ii-row"><span>Result</span><b class="fig">'+(sum('withdraw')-sum('deposit')>=0?'+':'−')+cur+' '+Math.abs(sum('withdraw')-sum('deposit')).toLocaleString('en-GB',{minimumFractionDigits:2})+'</b></div>'+
      (sum('cfee') ? '<div class="ii-row"><span>Fees</span><b class="fig">'+cur+' '+sum('cfee').toLocaleString('en-GB',{minimumFractionDigits:2})+'</b></div>' : '')+
      (sum('creward') ? '<div class="ii-row"><span>Rewards</span><b class="fig">'+cur+' '+sum('creward').toLocaleString('en-GB',{minimumFractionDigits:2})+'</b></div>' : '');
    document.getElementById('ii-cur').innerHTML = '<option>'+cur+'</option>';
    impPreview();
    openSheet('invimp-backdrop');
    return;
  }
  // the header is the first row with several words in it
  let hi = rows.findIndex(r=> r.filter(c=> /[a-z]/i.test(c)).length >= 3);
  if(hi < 0 || rows.length - hi < 2){ alert('That file has no rows Ledger can read.'); return; }
  const H = rows[hi].map(h=> String(h).trim());
  const map = {}, used = new Set();
  for(const [k,,re] of IMP_FIELDS){
    // exact-ish names first, then anything that matches
    let i = H.findIndex((h,j)=> !used.has(j) && re.test(h) && (k!=='code' || !/date|type|price|total|value|currency/i.test(h)));
    if(k === 'total' && i >= 0 && /price/i.test(H[i])) i = -1;
    if(i >= 0){ map[k] = i; used.add(i); }
  }
  const curGuess = /AUD|pearler|commsec|selfwealth|stake|raiz|spaceship|vanguard.*au/i.test(fname + ' ' + H.join(' ') + ' ' + text.slice(0,2000)) ? 'AUD'
    : /USD|\$/.test(H.join(' ')) ? 'USD' : (settings.invCur || 'GBP');
  invImp = {cat, H, rows: rows.slice(hi+1), map, cur: curGuess, fname};
  document.getElementById('ii-title').textContent = 'Import into '+invCatInfo(cat).name;
  document.getElementById('ii-file').textContent = fname || 'Your file';
  document.getElementById('ii-file').parentNode.lastChild.textContent = '. Ledger matched the columns below. Change any that look wrong.';
  document.getElementById('ii-map').innerHTML = IMP_FIELDS.map(([k,lab])=>
    '<div class="ii-row"><span>'+lab+(k==='date'||k==='code'||k==='qty'||k==='total'?'':' <i>optional</i>')+'</span><select data-imp="'+k+'"><option value="">—</option>'+
      H.map((h,i)=> '<option value="'+i+'"'+(map[k]===i?' selected':'')+'>'+esc(h || 'Column '+(i+1))+'</option>').join('')+'</select></div>').join('');
  document.getElementById('ii-cur').innerHTML = ENTRY_CURS.map(c=> '<option'+(c===curGuess?' selected':'')+'>'+c+'</option>').join('');
  document.querySelectorAll('#ii-map [data-imp]').forEach(sel=> sel.onchange = ()=>{ const v = sel.value; if(v==='') delete invImp.map[sel.dataset.imp]; else invImp.map[sel.dataset.imp] = +v; impPreview(); });
  document.getElementById('ii-cur').onchange = e=>{ invImp.cur = e.target.value; impPreview(); };
  impPreview();
  openSheet('invimp-backdrop');
}
// Turns the file into entries using the current column choices.
function impBuild(){
  const m = invImp.map, out = [], skipped = [];
  const cell = (r,k)=> m[k] != null ? r[m[k]] : null;
  invImp.rows.forEach((r, n)=>{
    const date = impDate(cell(r,'date'));
    const code = String(cell(r,'code')||'').trim().toUpperCase().replace(/\.AX$|\.ASX$|:ASX$/,'');
    const q = impNum(cell(r,'qty')), tot = impNum(cell(r,'total')), pr = impNum(cell(r,'price')), fee = Math.abs(impNum(cell(r,'fee'))||0);
    const kind = impKind(cell(r,'type'), q, tot);
    const cur = m.cur != null && /^[A-Z]{3}$/.test(String(cell(r,'cur')||'').trim()) ? String(cell(r,'cur')).trim() : invImp.cur;
    let total = tot != null ? Math.abs(tot) : (pr != null && q != null ? Math.abs(pr*q) : null);
    if(!date || !code || !kind || total == null){ skipped.push(n); return; }
    const qty = Math.abs(q || 0);
    if((kind === 'buy' || kind === 'sell') && !qty){ skipped.push(n); return; }
    const ext = 'csv:'+invImp.cat+':'+[date, code, kind, qty, total.toFixed(2)].join('|');
    out.push({date, code, kind, qty, total, fee, cur, ext});
  });
  return {out, skipped};
}
function impPreview(){
  const need = invImp.cash ? [] : ['date','code','total'].filter(k=> invImp.map[k] == null);
  const box = document.getElementById('ii-preview'), go = document.getElementById('ii-go');
  if(need.length){
    box.innerHTML = '<div class="rs-warn amber">Pick the column for '+need.map(k=> IMP_FIELDS.find(f=>f[0]===k)[1].toLowerCase()).join(' and ')+'.</div>';
    go.disabled = true; return;
  }
  const {out, skipped} = invImp.cash ? {out: invImp.cash.map(e=>Object.assign({}, e)), skipped: []} : impBuild();
  const have = new Set(invest.trades.map(t=>t.ext));
  const fresh = out.filter(e=> !have.has(e.ext));
  // same entry twice in one file is two real trades: keep both, but count each once
  const seen = {}; fresh.forEach(e=>{ seen[e.ext] = (seen[e.ext]||0) + 1; if(seen[e.ext] > 1) e.ext += '#'+seen[e.ext]; });
  invImp.fresh = fresh;
  const L = {buy:'Bought', sell:'Sold', reward:'Dividend', deposit:'Paid in', withdraw:'Taken out', cfee:'Fee', creward:'Reward'};
  box.innerHTML = '<div class="ii-sum"><b>'+fresh.length+'</b> to add'+(out.length-fresh.length ? ' · '+(out.length-fresh.length)+' already in Ledger' : '')+(skipped.length ? ' · '+skipped.length+' row'+(skipped.length===1?'':'s')+' skipped (cash, fees or blank)' : '')+'</div>'+
    (fresh.length ? '<div class="card">'+fresh.slice(0,5).map(e=> '<div class="lrow"><div><div class="d1">'+L[e.kind]+(e.code==='CASH'?'':' '+esc(e.code))+'</div><div class="d2">'+prettyDate(e.date)+(e.qty?' · '+fmtQty(e.qty)+' units':'')+'</div></div><div class="amtcol"><b class="fig">'+esc(e.cur)+' '+e.total.toLocaleString('en-GB',{minimumFractionDigits:2, maximumFractionDigits:2})+'</b></div></div>').join('')+
      (fresh.length > 5 ? '<div class="lrow"><div class="d2">and '+(fresh.length-5)+' more</div></div>' : '')+'</div>' : '');
  go.disabled = !fresh.length;
  go.textContent = fresh.length ? 'Add '+fresh.length+' entr'+(fresh.length===1?'y':'ies') : 'Nothing new to add';
}
document.getElementById('ii-go').onclick = async ()=>{
  const fresh = invImp.fresh || []; if(!fresh.length) return;
  const go = document.getElementById('ii-go'); go.disabled = true; go.textContent = 'Converting to pounds…';
  // one rate request per currency for the whole file
  const rates = {};
  for(const cur of [...new Set(fresh.map(e=>e.cur))]){
    if(cur === 'GBP'){ rates[cur] = null; continue; }
    const days = fresh.filter(e=>e.cur===cur).map(e=>e.date).sort();
    try{ rates[cur] = await fetchRateSeries(cur, 'GBP', ymd(new Date(parseYMD(days[0]).getTime()-6*864e5)), days[days.length-1]) || {}; }catch(e){ rates[cur] = {}; }
  }
  const missing = fresh.filter(e=> e.cur !== 'GBP' && !Object.keys(rates[e.cur]||{}).length);
  if(missing.length && !confirm('Could not get '+missing[0].cur+' rates right now (are you online?).\n\nAdd them anyway with a rough rate, corrected next time you import online?')){ impPreview(); return; }
  const rough = {AUD:0.51, USD:0.78, EUR:0.85};
  snapshot('Import into '+invCatInfo(invImp.cat).name);
  for(const e of fresh){
    const rate = e.cur === 'GBP' ? 1 : (Object.keys(rates[e.cur]||{}).length ? rateOn(rates[e.cur], e.date, rough[e.cur]||1) : (rough[e.cur]||1));
    const gbp = e.total * rate;
    invest.trades.push({id:uid(), ext:e.ext, src:'file', cat:invImp.cat, date:e.date, ts:e.date+' 12:00:00', sym:e.code, kind:e.kind,
      qty: e.kind === 'reward' ? 0 : e.qty, gbp, fee:e.fee*rate, price: e.qty ? gbp/e.qty : 0,
      orig: e.cur === 'GBP' ? undefined : {cur:e.cur, amt:e.total, fee:e.fee}, note:'From '+(invImp.fname||'a file')});
  }
  sortTrades(); saveInvest();
  invest.lastImport = invest.lastImport || {}; invest.lastImport[invImp.cat] = todayYMD(); saveInvest();
  settings.invCur = invImp.cur; settings.lastInvImport = todayYMD(); save(K.settings, settings);
  closeSheet('invimp-backdrop'); render(); if(invOpen) invDraw();
  if(typeof ciOpen !== 'undefined' && ciOpen && typeof ciRefresh === 'function') ciRefresh();
  sfx('typewriter');
  showToast(fresh.length+' entr'+(fresh.length===1?'y':'ies')+' added', ()=> doRollback());
};
document.getElementById('ii-cancel').onclick = ()=> closeSheet('invimp-backdrop');

// ---------------- spending categories: rename, kind, colour ----------------
const CAT_SWATCHES = ['#4aa87a','#7fe0b0','#5b8dd6','#8fd3ff','#9b6dd6','#c9a8f0','#d0574f','#f0897c','#d68b4a','#c9a227','#d9b44a','#4ab5b0','#d64a8b','#9aa1ab'];
let catEditing = null;
function openCatEdit(id){
  const c = cats.find(x=>x.id===id); if(!c) return;
  catEditing = id;
  document.getElementById('ce-name').value = c.name;
  document.getElementById('ce-kind').value = c.kind === 'income' ? 'income' : c.kind === 'transfer' ? 'transfer' : 'spend';
  document.getElementById('ce-swatches').innerHTML = CAT_SWATCHES.map(col=> '<button class="ce-sw'+(col.toLowerCase()===String(c.colour).toLowerCase()?' on':'')+'" data-col="'+col+'" style="background:'+col+'" aria-label="Colour '+col+'"></button>').join('');
  document.querySelectorAll('#ce-swatches [data-col]').forEach(b=> b.onclick = ()=> document.querySelectorAll('#ce-swatches [data-col]').forEach(x=> x.classList.toggle('on', x===b)));
  const n = txns.filter(t=>t.cat===id).length;
  document.getElementById('ce-count').textContent = n ? n+' transaction'+(n===1?' uses':'s use')+' it.' : 'Nothing uses it yet.';
  openSheet('catedit-backdrop');
}
document.getElementById('ce-save').onclick = ()=>{
  const c = cats.find(x=>x.id===catEditing); if(!c) return;
  const name = document.getElementById('ce-name').value.trim();
  if(!name){ alert('Give it a name.'); return; }
  const sw = document.querySelector('#ce-swatches .on');
  c.name = name; c.kind = document.getElementById('ce-kind').value; if(sw) c.colour = sw.dataset.col;
  save(K.cats, cats); closeSheet('catedit-backdrop');
  if(typeof renderRules === 'function') renderRules();
  render();
};

// ---------------- "Edit" and "Add" where things are shown ----------------
document.getElementById('home-accts-edit').onclick = e=>{ e.stopPropagation(); document.getElementById('open-accounts').click(); };
document.getElementById('spend-cats-edit').onclick = ()=> document.getElementById('open-rules').click();
document.getElementById('inv-add-link').onclick = ()=> openInvCatSheet(null);
