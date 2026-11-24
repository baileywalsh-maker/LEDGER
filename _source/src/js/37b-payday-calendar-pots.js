// ============================================================
// v69: payday countdown, spending calendar, savings pots
// ============================================================

// ---- Payday countdown (Home, under the net position card) ----
// Works out when you are next paid from your own Income history: anyone who has
// paid you 3+ times in the last 4 months on a steady rhythm (weekly, fortnightly,
// four-weekly, monthly). Then: money in your current and cash accounts, minus the
// bills due before that day, spread over the days left. Hidden if there's no
// steady pay to go on - it never guesses a payday.
function paydayPayers(){
  const today = parseYMD(todayYMD());
  const since = ymd(new Date(today.getTime() - 120*86400000));
  const by = {};
  for(const t of txns){
    if(t.dir !== 'in' || t.cat !== 'income' || t.date < since) continue;
    const k = merchantKey(t.desc) || String(t.desc||'').toLowerCase().trim();
    if(!k) continue;
    (by[k] = by[k] || {name:t.desc, list:[]}).list.push(t);
  }
  const out = [];
  for(const k in by){
    const list = by[k].list.sort((a,b)=> a.date.localeCompare(b.date));
    // one payment per day (a split payment counts once)
    const days = [...new Set(list.map(t=>t.date))];
    if(days.length < 3) continue;
    const gaps = [];
    for(let i = 1; i < days.length; i++) gaps.push(Math.round((parseYMD(days[i]) - parseYMD(days[i-1]))/86400000));
    gaps.sort((a,b)=>a-b);
    const g = gaps[Math.floor(gaps.length/2)];
    let cad = null;
    if(g >= 6 && g <= 8) cad = {days:7, label:'every week'};
    else if(g >= 13 && g <= 15) cad = {days:14, label:'every 2 weeks'};
    else if(g >= 27 && g <= 28) cad = {days:28, label:'every 4 weeks'};
    else if(g >= 29 && g <= 32) cad = {monthly:true, label:'every month'};
    if(!cad) continue;
    // steady: most gaps close to the median
    const steady = gaps.filter(x=> Math.abs(x - g) <= 3).length >= Math.ceil(gaps.length * 0.6);
    if(!steady) continue;
    const lastDay = days[days.length-1];
    const step = d => cad.monthly ? new Date(d.getFullYear(), d.getMonth()+1, parseYMD(lastDay).getDate()) : new Date(d.getTime() + cad.days*86400000);
    let next = step(parseYMD(lastDay)), guard = 0;
    while(next <= today && guard++ < 24) next = step(next);
    // gone quiet (missed two paydays): don't count on it
    const span = cad.monthly ? 31 : cad.days;
    if((today - parseYMD(lastDay))/86400000 > span * 2 + 3) continue;
    const amts = list.map(t=>t.amount).sort((a,b)=>a-b);
    out.push({name:by[k].name, next, cad, typical:amts[Math.floor(amts.length/2)]});
  }
  return out.sort((a,b)=> a.next - b.next);
}
function paydayInfo(){
  const payers = paydayPayers();
  if(!payers.length) return null;
  const today = parseYMD(todayYMD());
  const pay = payers[0];
  const days = Math.max(1, Math.round((pay.next - today)/86400000));
  const spendAccts = accts.filter(a=> a.type === 'current' || a.type === 'cash');
  if(!spendAccts.length) return null;
  const have = spendAccts.reduce((s,a)=> s + acctBalance(a.id), 0);
  const skip = new Set(accts.filter(a=> a.type === 'savings' || a.type === 'trading').map(a=>a.id));
  const bills = [];
  for(const r of recur){
    if(!r || !r.nextDue || !(r.amount > 0) || (r.acct && skip.has(r.acct))) continue;
    let d = parseYMD(r.nextDue), guard = 0;
    while(d < pay.next && guard++ < 60){
      if(d >= today) bills.push({name:r.name, amount:r.amount, date:ymd(d)});
      d = stepCadence(d, r.cadence, r.everyDays);
    }
  }
  bills.sort((a,b)=> a.date.localeCompare(b.date));
  const billTotal = bills.reduce((s,b)=> s + b.amount, 0);
  const left = have - billTotal;
  return {pay, payers, days, have, spendAccts, bills, billTotal, left, perDay: left / days};
}
function renderPayday(){
  const el = document.getElementById('payday'); if(!el) return;
  let p = null; try{ p = paydayInfo(); }catch(e){ p = null; }
  if(!p){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const day = p.pay.next.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
  const when = p.days === 1 ? 'tomorrow' : 'in ' + p.days + ' days';
  const short = p.left < 0;
  el.classList.toggle('short', short);
  el.innerHTML =
    '<div class="pd-main"><span class="pd-lab xt">Until payday</span>' +
      '<b class="fig">' + (short ? '−' : '') + money0(Math.abs(p.left)) + '</b>' +
      '<span class="pd-per">' + (short ? 'short before ' + esc(day) : 'about ' + money0(Math.max(0, p.perDay)) + ' a day') + '</span></div>' +
    '<div class="pd-when">' + esc(day) + ' · ' + when + '</div>' +
    '<div class="pd-more">' +
      '<div class="pd-row"><span>In ' + p.spendAccts.map(a=>esc(a.name)).join(', ') + '</span><b class="fig">' + money0(p.have) + '</b></div>' +
      (p.bills.length ? p.bills.map(b=> '<div class="pd-row"><span>' + esc(b.name) + ' · ' + parseYMD(b.date).toLocaleDateString('en-GB',{day:'numeric', month:'short'}) + '</span><b class="fig out">−' + money0(b.amount) + '</b></div>').join('')
        : '<div class="pd-row"><span>No bills due before then</span><b></b></div>') +
      '<div class="pd-row pd-tot"><span>Left to spend</span><b class="fig">' + (short ? '−' : '') + money0(Math.abs(p.left)) + '</b></div>' +
      '<div class="note" style="margin-top:6px;">Next pay: ' + p.payers.map(x=> esc(x.name) + ' ' + x.cad.label + ', about ' + money0(x.typical) + ' (' + x.next.toLocaleDateString('en-GB',{weekday:'short', day:'numeric', month:'short'}) + ')').join(' · ') + '. Savings and trading accounts are left out.</div>' +
    '</div>';
}

// ---- Spending calendar (Spending tab) ----
let dayFilter = null;   // 'YYYY-MM-DD' while a calendar day is picked
function renderCal(){
  const box = document.getElementById('s-cal'); if(!box) return;
  if(txnQuery){ box.hidden = true; return; }
  const [y, m] = spendMonth.split('-').map(Number);
  const first = new Date(y, m-1, 1), nDays = new Date(y, m, 0).getDate();
  const todayS = todayYMD();
  const spent = [];
  for(let d = 1; d <= nDays; d++){
    const dt = new Date(y, m-1, d);
    spent.push(ymd(dt) > todayS ? null : Math.max(0, periodTotals(dt, dt).out));
  }
  const vals = spent.filter(v=> v > 0).sort((a,b)=>a-b);
  if(!vals.length){ box.hidden = true; return; }
  box.hidden = false;
  // four shades by where the day sits among this month's spending days
  const q = f => vals[Math.min(vals.length-1, Math.floor(vals.length * f))];
  const cut = [q(0.25), q(0.5), q(0.8)];
  const lvl = v => v == null ? 'fut' : v <= 0 ? 'l0' : v <= cut[0] ? 'l1' : v <= cut[1] ? 'l2' : v <= cut[2] ? 'l3' : 'l4';
  const lead = (first.getDay() + 6) % 7;   // Monday first
  let cells = '';
  for(let i = 0; i < lead; i++) cells += '<i class="cal-pad"></i>';
  for(let d = 1; d <= nDays; d++){
    const s = ymd(new Date(y, m-1, d)), v = spent[d-1];
    cells += '<button class="cal-d ' + lvl(v) + (s === dayFilter ? ' sel' : '') + (s === todayS ? ' today' : '') + '" data-day="' + s + '"' + (v == null ? ' disabled' : '') +
      ' aria-label="' + d + ': ' + (v ? money0(v) : 'nothing') + '">' + d + '</button>';
  }
  const busiest = spent.reduce((b, v, i)=> v != null && v > (b.v||0) ? {v, i} : b, {});
  box.innerHTML =
    '<div class="cal-head"><b class="xt">Day by day</b><span>' +
      (dayFilter ? '<button class="rule-link" id="cal-clear">Show all days</button>'
        : busiest.v ? 'Busiest: ' + (busiest.i+1) + ordinal(busiest.i+1).replace(/^\d+/, '') + ', ' + money0(busiest.v) : '') + '</span></div>' +
    '<div class="cal-body"><div class="cal-wk"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>' +
    '<div class="cal-grid">' + cells + '</div>' +
    '<div class="cal-key"><span>Less</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div></div>';
  box.querySelectorAll('.cal-d[data-day]').forEach(b=> b.onclick = e=>{
    e.stopPropagation();
    dayFilter = dayFilter === b.dataset.day ? null : b.dataset.day;
    txnPageSize = TXN_PAGE;   // a day is short: show all of it
    renderSpend();
    if(dayFilter) setTimeout(()=>{ const l = document.getElementById('txn-list'); if(l) l.scrollIntoView({behavior:'smooth', block:'start'}); }, 50);
  });
  const clr = document.getElementById('cal-clear');
  if(clr) clr.onclick = e=>{ e.stopPropagation(); dayFilter = null; txnPageSize = TXN_FIRST; renderSpend(); };
}
// The month changing, a category chip or a search all clear the picked day.
const _renderSpendV68 = renderSpend;
renderSpend = function(){
  if(dayFilter && dayFilter.slice(0,7) !== spendMonth) dayFilter = null;
  _renderSpendV68();
  try{ renderCal(); }catch(e){}
};

// ---- Savings pots ----
// Something you're saving for: a name, a target, an optional date, and either an
// account it lives in (its balance is the progress) or an amount you update.
// Stored in ledger:pots, carried in backups and undo, and synced with Muse (v71).
const K_POTS = 'ledger:pots';
let pots = (()=>{ try{ const v = JSON.parse(localStorage.getItem(K_POTS)); return Array.isArray(v) ? v.filter(p=> p && typeof p === 'object' && p.id) : []; }catch(e){ return []; } })();
function savePots(){ save(K_POTS, pots); }
// v71: sync hands pots over here (Muse can add or change them).
window.syncSetPots = v => { pots = Array.isArray(v) ? v.filter(p=> p && typeof p === 'object' && p.id) : pots; };
function potHave(p){
  if(p.acct && accts.some(a=>a.id === p.acct)) return Math.max(0, acctBalance(p.acct));
  return Math.max(0, Number(p.saved) || 0);
}
function potStatus(p){
  const have = potHave(p), target = Number(p.target) || 0;
  const pct = target > 0 ? Math.min(1, have / target) : 0;
  if(have >= target && target > 0) return {have, pct, line:'Done', tone:'good'};
  if(!p.date) return {have, pct, line:money0(Math.max(0, target - have)) + ' to go', tone:''};
  const today = parseYMD(todayYMD()), by = parseYMD(p.date);
  const months = Math.max(0, (by.getFullYear() - today.getFullYear())*12 + (by.getMonth() - today.getMonth()) + (by.getDate() >= today.getDate() ? 0 : -1));
  const byNice = by.toLocaleDateString('en-GB', {month:'short', year: by.getFullYear() === today.getFullYear() ? undefined : 'numeric'});
  if(by < today) return {have, pct, line:money0(target - have) + ' to go · was due ' + byNice, tone:'mid'};
  const need = (target - have) / Math.max(1, months);
  return {have, pct, line:money0(need) + ' a month to make ' + byNice, tone:''};
}
function renderPots(){
  const sec = document.getElementById('pots-sec'), list = document.getElementById('pots-list');
  if(!sec || !list) return;
  sec.hidden = !pots.length;
  const sub = document.getElementById('pots-sub');
  if(sub) sub.textContent = pots.length ? pots.length + ' on the go' : 'Nothing yet';
  if(!pots.length){ list.innerHTML = ''; return; }
  const tot = pots.reduce((s,p)=> s + potHave(p), 0);
  const tEl = document.getElementById('pots-total'); if(tEl) tEl.textContent = money0(tot);
  list.innerHTML = '<div class="card">' + pots.map(p=>{
    const st = potStatus(p);
    return '<div class="pot tap" data-pot="' + esc(p.id) + '">' +
      '<div class="pot-top"><span class="pot-name">' + esc(p.name) + '</span><span class="fig">' + money0(st.have) + ' <small>of ' + money0(Number(p.target)||0) + '</small></span></div>' +
      '<div class="pot-bar"><i style="width:' + (st.pct*100).toFixed(1) + '%"></i></div>' +
      '<div class="pot-line ' + st.tone + '">' + esc(st.line) + (p.acct ? ' · in ' + esc((accts.find(a=>a.id===p.acct)||{}).name || 'an account') : '') + '</div></div>';
  }).join('') + '</div>';
  list.querySelectorAll('[data-pot]').forEach(r=> r.onclick = ()=> openPot(r.dataset.pot));
}
let potEditing = null;
function openPot(id){
  const p = id ? pots.find(x=>x.id === id) : null;
  potEditing = p ? p.id : null;
  document.getElementById('pot-title').textContent = p ? 'Edit pot' : 'Something to save for';
  document.getElementById('pot-name').value = p ? p.name : '';
  document.getElementById('pot-target').value = p ? p.target : '';
  document.getElementById('pot-date').value = p && p.date ? p.date : '';
  const sel = document.getElementById('pot-acct');
  sel.innerHTML = '<option value="">No - I\'ll update the amount</option>' +
    accts.filter(a=> a.type !== 'trading').map(a=> '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>').join('');
  sel.value = p && p.acct ? p.acct : '';
  document.getElementById('pot-saved').value = p && !p.acct ? (p.saved || '') : '';
  document.getElementById('pot-del').style.display = p ? '' : 'none';
  potSavedVis();
  openSheet('pot-backdrop');
}
function potSavedVis(){ document.getElementById('pot-saved-wrap').style.display = document.getElementById('pot-acct').value ? 'none' : ''; }
document.getElementById('pot-acct').onchange = potSavedVis;
document.getElementById('pot-save').onclick = ()=>{
  const name = document.getElementById('pot-name').value.trim();
  const target = parseFloat(document.getElementById('pot-target').value);
  if(!name){ showToast('Give it a name'); return; }
  if(!(target > 0)){ showToast('Add how much you need'); return; }
  const acct = document.getElementById('pot-acct').value || null;
  const saved = acct ? 0 : Math.max(0, parseFloat(document.getElementById('pot-saved').value) || 0);
  const date = document.getElementById('pot-date').value || null;
  snapshot(potEditing ? 'Edit pot' : 'Add pot');
  if(potEditing){
    const p = pots.find(x=>x.id === potEditing);
    if(p) Object.assign(p, {name, target, date, acct, saved});
  } else {
    pots.push({id:'pot' + Date.now().toString(36), name, target, date, acct, saved, created:todayYMD()});
  }
  savePots(); closeSheet('pot-backdrop'); render();
  showToast(potEditing ? 'Saved' : 'Added "' + esc(name) + '"');
};
document.getElementById('pot-del').onclick = ()=>{
  const p = pots.find(x=>x.id === potEditing); if(!p) return;
  snapshot('Delete pot');
  const was = pots.slice();
  pots = pots.filter(x=>x.id !== p.id); savePots();
  closeSheet('pot-backdrop'); render();
  showToast('Deleted "' + esc(p.name) + '"', ()=>{ pots = was; savePots(); render(); });
};
document.getElementById('pot-cancel').onclick = ()=> closeSheet('pot-backdrop');
document.getElementById('pots-add').onclick = e=>{ e.stopPropagation(); openPot(null); };
document.getElementById('open-pots').onclick = ()=> openPot(null);

// Payday details open on a tap, like the other tucked-away parts (v68).
document.getElementById('payday').onclick = ()=> toggleX('xPay');
document.getElementById('s-cal').addEventListener('click', e=>{ if(e.target.closest('.cal-head') && !e.target.closest('button')) toggleX('xCalShut'); });
