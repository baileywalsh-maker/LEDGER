// ============================================================
// Account editor
// ============================================================
let editingAcct = null;
/* ============ v48: the account, as it stands today ============
   Top: what it holds now, in a box you can type over. Under that: every week
   since it started, so the starting point is visible as where the line begins
   rather than as a form to fill in. The form itself is folded away.

   Typing a new balance moves the STARTING figure by the difference. No
   transaction is invented, so spending and income totals do not change, and
   the snapshot taken first means it can be undone from More.               */
function acctWeeks(a){
  const id = a.id;
  const from = a.openingDate ? parseYMD(a.openingDate) : null;
  const today = new Date(); today.setHours(0,0,0,0);
  const mine = txns.filter(t=>(t.acct === id || t.toAcct === id) && (!from || parseYMD(t.date) >= from));
  let first = from;
  if(!first){
    first = today;
    mine.forEach(t=>{ const d = parseYMD(t.date); if(d < first) first = d; });
  }
  const weeks = [];
  for(let w = weekStart(first); w <= today; w = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7))
    weeks.push({start: w, inn: 0, out: 0, n: 0});
  const idx = d => Math.floor((weekStart(d) - weeks[0].start) / (7 * 86400000) + 0.5);
  (Array.isArray(a.adj) ? a.adj : []).forEach(x=>{
    if(!x || !x.date || !isFinite(Number(x.amount))) return;
    const d = parseYMD(x.date);
    if(d > today || (from && d < from)) return;
    const wk = weeks[idx(d)];
    if(wk) wk.adj = (wk.adj || 0) + Number(x.amount);
  });
  mine.forEach(t=>{
    const d = parseYMD(t.date);
    if(d > today) return;
    const wk = weeks[idx(d)];
    if(!wk) return;
    wk.n++;
    if(t.dir === 'in' && t.acct === id) wk.inn += t.amount;
    else if(t.dir === 'out' && t.acct === id) wk.out += t.amount;
    else if(t.dir === 'transfer'){
      if(t.acct === id) wk.out += t.amount;
      if(t.toAcct === id) wk.inn += t.amount;
    }
  });
  let bal = Number(a.opening) || 0;
  weeks.forEach(w=>{ w.before = bal; bal += w.inn - w.out + (w.adj || 0); w.end = bal; });
  return weeks;
}
let acctWeekShown = [];
function acctChartHTML(a){
  const all = acctWeeks(a);
  if(!all.length) return '';
  const MAXW = 26;
  const weeks = all.slice(-MAXW);
  acctWeekShown = weeks;
  const cut = all.length > weeks.length;
  const W = 340, H1 = 120, H2 = 56, PADL = 6, PADR = 6, TOP = 18, GAP = 14;
  const n = weeks.length;
  // One point for where the window starts, then one per week's end.
  const pts = [weeks[0].before].concat(weeks.map(w=>w.end));
  let lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
  if(hi - lo < 1){ hi += 1; lo -= 1; }
  const x = i => PADL + (W - PADL - PADR) * (i / n);
  const y = v => TOP + (H1 - TOP - 6) * (1 - (v - lo) / (hi - lo));
  const line = pts.map((v, i)=> x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const maxMove = Math.max.apply(null, weeks.map(w=>Math.abs(w.inn - w.out + (w.adj || 0))).concat([1]));
  const mid = H1 + GAP + H2 / 2;
  const bw = Math.max(2, (W - PADL - PADR) / n - 2);
  const bars = weeks.map((w, i)=>{
    const net = w.inn - w.out + (w.adj || 0);
    const h = Math.abs(net) / maxMove * (H2 / 2 - 2);
    if(h < 0.5) return '';
    return '<rect x="' + (x(i) + 1).toFixed(1) + '" y="' + (net >= 0 ? mid - h : mid).toFixed(1) + '" width="' + bw.toFixed(1) +
      '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + (net >= 0 ? 'var(--in)' : 'var(--out)') + '"/>';
  }).join('');
  const hits = weeks.map((w, i)=>
    '<rect data-aewk="' + i + '" x="' + x(i).toFixed(1) + '" y="0" width="' + ((W - PADL - PADR) / n).toFixed(1) +
    '" height="' + (H1 + GAP + H2) + '" fill="transparent"/>').join('');
  const startLab = (cut ? '' : 'Start ') + money0(pts[0]);
  const svg =
    '<svg viewBox="0 0 ' + W + ' ' + (H1 + GAP + H2 + 16) + '" style="width:100%; height:auto; display:block;" role="img" aria-label="Balance by week">' +
    '<polyline points="' + line + '" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + x(0).toFixed(1) + '" cy="' + y(pts[0]).toFixed(1) + '" r="4" fill="var(--brass)" stroke="var(--ink)" stroke-width="2"/>' +
    '<circle cx="' + x(n).toFixed(1) + '" cy="' + y(pts[n]).toFixed(1) + '" r="4" fill="var(--text)" stroke="var(--ink)" stroke-width="2"/>' +
    '<text x="' + PADL + '" y="11" font-size="11" fill="var(--brass)">' + esc(startLab) + '</text>' +
    '<text x="' + (W - PADR) + '" y="11" font-size="11" text-anchor="end" fill="var(--text)">Today ' + esc(money0(pts[n])) + '</text>' +
    '<line x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + mid + '" y2="' + mid + '" stroke="var(--line)" stroke-width="1"/>' +
    bars +
    '<rect id="ae-wk-mark" x="0" y="0" width="0" height="' + (H1 + GAP + H2) + '" fill="var(--text)" opacity="0.07"/>' +
    '<text x="' + PADL + '" y="' + (H1 + GAP + H2 + 13) + '" font-size="10.5" fill="var(--text3)">' + esc(shortD(weeks[0].start)) + '</text>' +
    '<text x="' + (W - PADR) + '" y="' + (H1 + GAP + H2 + 13) + '" font-size="10.5" text-anchor="end" fill="var(--text3)">this week</text>' +
    hits + '</svg>';
  const startDate = a.openingDate ? parseYMD(a.openingDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';
  return '<div style="font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--text3); margin-bottom:6px;">Week by week</div>' +
    svg +
    '<div id="ae-wk" style="font-size:12.5px; color:var(--text2); line-height:1.5; min-height:38px; margin-top:8px;">' +
      'The line is the balance; the bars are what each week added or took. Tap a week for its figures.</div>' +
    '<div style="font-size:11.5px; color:var(--text3); line-height:1.5; margin-top:4px;">' +
      'Started at ' + money(Number(a.opening) || 0) + (startDate ? ' on ' + esc(startDate) : '') + '.' +
      (cut ? ' Showing the last ' + MAXW + ' weeks.' : '') + '</div>';
}
function renderAcctNow(a, t){
  const bal = acctBalance(a.id);
  const today = new Date().toLocaleDateString('en-GB',{weekday:'short', day:'numeric', month:'short'});
  const row = (l, v)=> '<div style="display:flex; justify-content:space-between; gap:12px; padding:3px 0;"><span>'+l+'</span><span>'+v+'</span></div>';
  document.getElementById('ae-now').innerHTML =
    '<div style="border:1px solid var(--line); border-radius:12px; padding:13px 14px; margin-bottom:12px;">'+
      '<div style="display:flex; justify-content:space-between; font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--text3);">'+
        '<span>Balance today</span><span>'+esc(today)+'</span></div>'+
      '<div style="display:flex; align-items:center; gap:8px; margin-top:6px;">'+
      '<span style="font-size:26px; font-weight:700; color:var(--text2);">'+esc(money(0).replace(/[\d.,\s\u2212-]/g,''))+'</span>'+
      '<input type="number" id="ae-now-fig" inputmode="decimal" step="0.01" value="'+(Math.round(bal*100)/100).toFixed(2)+'" '+
        'style="font-size:26px; font-weight:700; margin:0; text-align:left; flex:1; min-width:0;"></div>'+
      '<div id="ae-now-diff" style="font-size:12.5px; color:var(--text2); line-height:1.5; margin-top:6px;">Type over this if your bank says something different.</div>'+
      '<button class="btn" id="ae-now-set" style="display:none; margin:10px 0 0;">Update balance</button>'+
    '</div>'+
    '<div style="border:1px solid var(--line); border-radius:12px; padding:13px 14px; margin-bottom:12px;">'+ acctChartHTML(a) +'</div>'+
    '<div style="font-size:12.5px; color:var(--text2); line-height:1.5; padding:0 2px 6px;">'+
      row('Money in', '+'+money(t.inSum))+ row('Money out', '\u2212'+money(t.outSum))+
      ((t.trIn || t.trOut) ? row('Transfers in', '+'+money(t.trIn)) + row('Transfers out', '\u2212'+money(t.trOut)) : '')+
      (acctAdj(a) ? row('Balance corrections', (acctAdj(a) > 0 ? '+' : '\u2212')+money(Math.abs(acctAdj(a)))) : '')+
      '<div style="font-size:11.5px; color:var(--text3); margin-top:4px;">From '+t.counted+' transaction'+(t.counted===1?'':'s')+'.'+
      (t.older ? ' <span style="color:var(--brass);">'+t.older+' older one'+(t.older===1?' is':'s are')+' dated before the start, so '+(t.older===1?'it does':'they do')+' not move this balance.</span>' : '')+
      '</div></div>';
  const fig = document.getElementById('ae-now-fig');
  const diffEl = document.getElementById('ae-now-diff');
  const setBtn = document.getElementById('ae-now-set');
  const read = ()=>{
    const v = Number(fig.value);
    return (fig.value !== '' && isFinite(v)) ? Math.round(v * 100) / 100 : null;
  };
  fig.oninput = ()=>{
    const v = read();
    const d = v === null ? 0 : Math.round((v - acctBalance(a.id)) * 100) / 100;
    if(Math.abs(d) < 0.005){
      diffEl.textContent = 'Type over this if your bank says something different.';
      setBtn.style.display = 'none';
      return;
    }
    diffEl.innerHTML = 'That is <b>'+money(Math.abs(d))+' '+(d > 0 ? 'more' : 'less')+'</b> than Ledger has now.';
    setBtn.style.display = 'block';
  };
  setBtn.onclick = ()=>{
    const v = read();
    if(v === null) return;
    const d = Math.round((v - acctBalance(a.id)) * 100) / 100;
    if(Math.abs(d) < 0.005) return;
    if(!confirm('Set '+a.name+' to '+money(v)+'?\n\nIt is saved as a correction dated today. No transaction is added, so your spending and income totals stay as they are, and months you have already closed off are untouched. This can be undone from More.')) return;
    snapshot('Set '+a.name+' balance to '+money(v));
    const today = todayYMD();
    accts = accts.map(x=>{
      if(x.id !== a.id) return x;
      const adj = Array.isArray(x.adj) ? x.adj.slice() : [];
      // A correction dated before the account started would never count, so
      // the start date is the earliest a correction can carry.
      const date = (x.openingDate && x.openingDate > today) ? x.openingDate : today;
      adj.push({date: date, amount: d});
      return Object.assign({}, x, {adj: adj});
    });
    save(K.accts, accts);
    render();
    openAcctEdit(a.id);
  };
  document.querySelectorAll('#ae-now [data-aewk]').forEach(r=>{
    r.onclick = ()=>{
      const w = acctWeekShown[Number(r.dataset.aewk)];
      if(!w) return;
      const mark = document.getElementById('ae-wk-mark');
      if(mark){ mark.setAttribute('x', r.getAttribute('x')); mark.setAttribute('width', r.getAttribute('width')); }
      const net = w.inn - w.out + (w.adj || 0);
      document.getElementById('ae-wk').innerHTML =
        '<b style="color:var(--text)">Week of '+esc(shortD(w.start))+'</b> \u00b7 '+w.n+' transaction'+(w.n===1?'':'s')+'<br>'+
        'In +'+money(w.inn)+' \u00b7 out \u2212'+money(w.out)+' \u00b7 net '+(net >= 0 ? '+' : '\u2212')+money(Math.abs(net))+
        (w.adj ? ' \u00b7 balance corrected '+(w.adj > 0 ? '+' : '\u2212')+money(Math.abs(w.adj)) : '')+
        ' \u00b7 ended at <b style="color:var(--text)">'+money(w.end)+'</b>';
    };
  });
}

function openAcctEdit(id){
  editingAcct = id || null;
  const del = document.getElementById('ae-delete');
  const note = document.getElementById('ae-note');
  if(id){
    const a = accts.find(x=>x.id===id);
    if(!a) return;
    document.getElementById('ae-title').textContent = a.name;
    document.getElementById('ae-name').value = a.name;
    document.getElementById('ae-type').value = a.type;
    document.getElementById('ae-open').value = a.opening;
    document.getElementById('ae-opendate').value = a.openingDate;
    const n = txns.filter(t=>t.acct===id||t.toAcct===id).length;
    note.innerHTML = '<div class="warn">Changing the starting balance or its date shifts every figure after it.</div>';
    // How today's figure is built, so it can be checked line by line against
    // the bank: where it started, what came in, what went out, what moved.
    const from = a.openingDate ? parseYMD(a.openingDate) : null;
    let inSum = 0, outSum = 0, trIn = 0, trOut = 0, counted = 0;
    for(const t of txns){
      if(t.acct !== id && t.toAcct !== id) continue;
      if(from && parseYMD(t.date) < from) continue;
      counted++;
      if(t.dir === 'in' && t.acct === id) inSum += t.amount;
      else if(t.dir === 'out' && t.acct === id) outSum += t.amount;
      else if(t.dir === 'transfer'){
        if(t.acct === id) trOut += t.amount;
        if(t.toAcct === id) trIn += t.amount;
      }
    }
    const older = preOpeningCount(id);
    renderAcctNow(a, {inSum, outSum, trIn, trOut, counted, older});
    document.getElementById('ae-details').open = false;
    document.getElementById('ae-open-lab').textContent = 'Starting balance';
    document.getElementById('ae-date-lab').textContent = 'Starting date';
    del.style.display = 'block';
    del.textContent = n ? 'Delete account and its '+n+' transactions' : 'Delete this account';
  } else {
    document.getElementById('ae-title').textContent = 'New account';
    document.getElementById('ae-now').innerHTML = '';
    document.getElementById('ae-details').open = true;
    document.getElementById('ae-open-lab').textContent = 'Balance';
    document.getElementById('ae-date-lab').textContent = 'As of';
    document.getElementById('ae-name').value = '';
    document.getElementById('ae-type').value = 'current';
    document.getElementById('ae-open').value = '';
    document.getElementById('ae-opendate').value = todayYMD();
    note.innerHTML = '<p class="note">Trading capital is kept out of your net position. It is working capital, not savings.</p>';
    del.style.display = 'none';
  }
  openSheet('acctedit-backdrop');
}
document.getElementById('ae-today').onclick = ()=>{
  const v = document.getElementById('ae-open').value;
  document.getElementById('ae-opendate').value = todayYMD();
  alert(v
    ? 'Dated today. Ledger will treat ' + money(Number(v)||0) + ' as what this account holds right now, and only transactions from today onward will change it.'
    : "Dated today. Enter what the account holds right now and Ledger will count only transactions from today onward.");
};

document.getElementById('ae-save').onclick = ()=>{
  const name = document.getElementById('ae-name').value.trim();
  if(!name){ alert('Give the account a name.'); return; }
  const rec = { name,
    type: document.getElementById('ae-type').value,
    opening: Number(document.getElementById('ae-open').value)||0,
    openingDate: document.getElementById('ae-opendate').value || todayYMD() };
  if(editingAcct) accts = accts.map(a=> a.id===editingAcct ? {...a, ...rec} : a);
  else accts.push({id:uid(), ...rec});
  save(K.accts, accts);
  closeSheet('acctedit-backdrop');
  render();
};
document.getElementById('ae-delete').onclick = ()=>{
  if(!editingAcct) return;
  deleteAccount(editingAcct);
  closeSheet('acctedit-backdrop');
};
function deleteAccount(id){
  const n = txns.filter(t=>t.acct===id||t.toAcct===id).length;
  const a = accts.find(x=>x.id===id);
  if(!confirm('Delete '+(a?a.name:'this account')+(n ? ' and its '+n+' transactions' : '')+'? This cannot be undone.')) return false;
  accts = accts.filter(x=>x.id!==id);
  txns = txns.filter(t=>t.acct!==id && t.toAcct!==id);
  save(K.accts, accts); save(K.txns, txns);
  openSwipe = null;
  render();
  return true;
}
