// ============================================================
// Subscriptions that check themselves against reality
// ============================================================

// Real charges for a subscription: the ones Ledger posted and the bank later
// confirmed, plus any statement row naming the same merchant. Posted-but-never-
// seen charges are excluded - they are forecasts, and measuring the interval
// from your own forecast would only ever confirm what is already configured.
function realChargesFor(r){
  const key = merchantKey(r.match || r.name);
  return txns
    .filter(t => t.dir === 'out' && !t.auto)
    .filter(t => (t.recurId && t.recurId === r.id) || merchantAgrees(key, t))
    .slice()
    .sort((a,b) => a.date < b.date ? -1 : 1);
}

function medianOf(nums){
  if(!nums.length) return null;
  const s = nums.slice().sort((a,b)=>a-b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m-1] + s[m]) / 2);
}

// At least four charges, so three gaps - two could agree by accident.
const SUB_MIN_CHARGES = 4;
const SUB_INTERVAL_TOLERANCE = 2;      // days before it is worth saying anything
const SUB_SILENT_DAYS = 35;            // "not seen in over a month"

function subFindings(){
  const out = [];
  const declined = settings.subDeclined || {};
  const today = new Date(); today.setHours(0,0,0,0);

  recur.forEach(r=>{
    const charges = realChargesFor(r);

    // ---- interval ----
    if(charges.length >= SUB_MIN_CHARGES){
      const gaps = [];
      for(let i=1;i<charges.length;i++){
        gaps.push(Math.round((parseYMD(charges[i].date) - parseYMD(charges[i-1].date)) / 86400000));
      }
      const med = medianOf(gaps);
      const configured = cadenceDays(r);
      if(med && configured && Math.abs(med - configured) >= SUB_INTERVAL_TOLERANCE){
        const key = 'interval:' + r.id + ':' + med;
        if(!declined[key]){
          out.push({kind:'interval', id:r.id, key:key, rec:r, days:med,
                    was:configured, charges:charges.slice(-6), gaps:gaps.slice(-5)});
        }
      }
    }

    // ---- price ----
    if(charges.length >= 3){
      const last = charges[charges.length-1];
      const prior = charges.slice(0,-1).map(t=>t.amount);
      const wasAmt = medianOf(prior.map(x=>Math.round(x*100))) / 100;
      const cfg = Math.abs(Number(r.amount)) || 0;
      // Only when the newest charge differs from BOTH the old norm and what is
      // configured - otherwise a one-off refund or a part month reads as a rise.
      if(wasAmt > 0 && cfg > 0 &&
         Math.abs(last.amount - wasAmt) / wasAmt > 0.02 &&
         Math.abs(last.amount - cfg) / cfg > 0.02){
        const key = 'price:' + r.id + ':' + Math.round(last.amount*100);
        if(!declined[key]){
          out.push({kind:'price', id:r.id, key:key, rec:r,
                    now:last.amount, was:wasAmt, on:last.date});
        }
      }
    }

    // ---- not seen on a statement ----
    if(charges.length){
      const lastSeen = charges[charges.length-1].date;
      const days = Math.round((today - parseYMD(lastSeen)) / 86400000);
      const cad = cadenceDays(r) || 30;
      // Generous: a quarterly subscription is not missing at 40 days.
      if(days > Math.max(SUB_SILENT_DAYS, cad + 10)){
        const key = 'silent:' + r.id + ':' + lastSeen;
        if(!declined[key]){
          const since = txns.filter(t => t.recurId === r.id && t.date > lastSeen)
                            .reduce((s,t)=>s+t.amount, 0);
          out.push({kind:'silent', id:r.id, key:key, rec:r, days:days,
                    lastSeen:lastSeen, since:since});
        }
      }
    }
  });
  return out;
}

function declineFinding(key){
  const d = settings.subDeclined || {};
  d[key] = todayYMD();
  settings.subDeclined = d;
  save(K.settings, settings);
  render();
}

function applyInterval(id, days){
  recur = recur.map(r => r.id === id ? {...r, cadence:'days', everyDays: days} : r);
  save(K.recur, recur);
  render();
}
function applyPrice(id, amount){
  recur = recur.map(r => r.id === id ? {...r, amount: amount} : r);
  save(K.recur, recur);
  render();
}

function renderSubFindings(){
  const box = document.getElementById('sub-findings');
  if(!box) return;
  const found = subFindings();
  if(!found.length){ box.innerHTML = ''; return; }
  box.innerHTML = found.map(f=>{
    if(f.kind === 'interval'){
      const dates = f.charges.map((c,i)=>
        (i ? '<span class="gapn">+'+f.gaps[i-1]+'</span>' : '') +
        '<span>'+parseYMD(c.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+'</span>'
      ).join('');
      return '<div class="finding"><div class="fh">This bills every '+f.days+
        ' days, not '+f.was+'</div>'+
        '<div class="fb">The last '+f.charges.length+' charges were '+f.days+
        ' days apart. At '+f.was+', Ledger forecasts it '+
        (f.days > f.was ? Math.abs(f.days-f.was)+' day'+(Math.abs(f.days-f.was)===1?'':'s')+' early'
                        : Math.abs(f.days-f.was)+' day'+(Math.abs(f.days-f.was)===1?'':'s')+' late')+
        ' and drifts further every time.</div>'+
        '<div class="fdates">'+dates+'</div>'+
        '<div class="facts"><button class="go" data-subfix="'+esc(f.key)+'" data-id="'+esc(f.id)+
          '" data-days="'+f.days+'">Change to '+f.days+' days</button>'+
        '<button data-subno="'+esc(f.key)+'">Leave it</button></div></div>';
    }
    if(f.kind === 'price'){
      const up = f.now > f.was;
      return '<div class="finding"><div class="fh">'+esc(f.rec.name)+' '+
        (up?'went up':'went down')+' to '+money0(f.now)+'</div>'+
        '<div class="fb">It was '+money0(f.was)+' and the charge on '+prettyDate(f.on)+
        ' was '+money0(f.now)+'. Ledger still has it down as '+money0(Math.abs(Number(f.rec.amount))||0)+
        ', so every forecast from here is '+(up?'under':'over')+'stating it.</div>'+
        '<div class="facts"><button class="go" data-subprice="'+esc(f.key)+'" data-id="'+esc(f.id)+
          '" data-amt="'+f.now+'">Update to '+money0(f.now)+'</button>'+
        '<button data-subno="'+esc(f.key)+'">Leave it</button></div></div>';
    }
    return '<div class="finding"><div class="fh">'+esc(f.rec.name)+
      ' has not appeared on a statement since '+prettyDate(f.lastSeen)+'</div>'+
      '<div class="fb">'+f.days+' days ago'+
      (f.since > 0 ? ', and Ledger has forecast '+money0(f.since)+' of charges since' : '')+
      '. Either it is cancelled and should come off, or a statement is missing.</div>'+
      '<div class="facts"><button class="go" data-subno="'+esc(f.key)+'">Noted</button></div></div>';
  }).join('');

  box.querySelectorAll('[data-subfix]').forEach(b=>{
    b.onclick = ()=>{ applyInterval(b.dataset.id, Number(b.dataset.days)); };
  });
  box.querySelectorAll('[data-subprice]').forEach(b=>{
    b.onclick = ()=>{ applyPrice(b.dataset.id, Number(b.dataset.amt)); };
  });
  box.querySelectorAll('[data-subno]').forEach(b=>{
    b.onclick = ()=> declineFinding(b.dataset.subno);
  });
}

// ---------------- Spending ----------------
function shiftMonth(mk, n){
  const [y,m] = mk.split('-').map(Number);
  const d = new Date(y, m-1+n, 1);
  return monthKey(d);
}
const ordinal = n => n + (n%100>=11 && n%100<=13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[n%10] || 'th'));
function spendCompare(mt){
  const isNow = spendMonth === monthKey(new Date());
  const prevMk = shiftMonth(spendMonth, -1);
  const [py, pm] = prevMk.split('-').map(Number);
  const prevFull = monthTotals(prevMk);
  if(!(prevFull.out > 0)) return null;
  const today = new Date(), day = today.getDate();
  const lastDayNow = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
  const partial = isNow && day < lastDayNow;
  const upto = Math.min(day, new Date(py, pm, 0).getDate());
  const prev = partial ? periodTotals(new Date(py, pm-1, 1), new Date(py, pm-1, upto)) : prevFull;
  const diff = mt.out - prev.out;
  const pct = prev.out > 0 ? Math.round(Math.abs(diff) / prev.out * 100) : null;
  const moves = [...new Set([...Object.keys(mt.byCat), ...Object.keys(prev.byCat)])]
    .map(cid=>({cid, d:(mt.byCat[cid]||0) - (prev.byCat[cid]||0)}))
    .filter(x=> Math.abs(x.d) >= 1)
    .sort((a,b)=> Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
  const name = mk => parseYMD(mk+'-01').toLocaleDateString('en-GB', {month:'long'});
  return {isNow, partial, upto, prev, prevFull, diff, pct, moves,
          thisName: isNow ? 'This month' : name(spendMonth), prevName: isNow ? 'Last month' : name(prevMk)};
}
function renderSpendCompare(mt){
  const box = document.getElementById('s-cmp');
  if(!box) return false;
  const c = spendCompare(mt);
  if(!c){ box.style.display = 'none'; box.innerHTML = ''; return false; }
  const same = c.pct !== null && c.pct < 3;
  const tone = same ? '' : c.diff < 0 ? 'good' : 'mid';
  const pill = c.pct === null ? (mt.out > 0 ? 'More' : 'Level')
             : same ? 'About the same' : c.pct+'% '+(c.diff < 0 ? 'less' : 'more');
  const max = Math.max(mt.out, c.prevFull.out, 1);
  const w = v => (Math.max(0, Math.min(1, v / max)) * 100).toFixed(1) + '%';
  const line = c.pct === null ? 'Nothing had gone out by the '+ordinal(c.upto)+' last month.'
    : same ? 'Spending is level with '+c.prevName.toLowerCase()+(c.partial ? ' at this point.' : '.')
    : '<b>'+money0(Math.abs(c.diff))+' '+(c.diff < 0 ? 'less' : 'more')+'</b> than '+c.prevName.toLowerCase()+(c.partial ? ' by the '+ordinal(c.upto)+'.' : '.');
  box.innerHTML =
    '<div class="cmp-head"><b class="xt">'+esc(c.thisName)+' vs '+esc(c.prevName.toLowerCase())+'</b>'+
      '<span class="cmp-pill '+tone+'">'+pill+'</span></div>'+
    '<div class="cmp-line">'+line+'</div>'+
    '<div class="cmp-row"><span>'+esc(c.thisName)+'</span><div class="cmp-bar"><i class="now" style="width:'+w(mt.out)+'"></i></div><b class="fig">'+money0(mt.out)+'</b></div>'+
    '<div class="cmp-row"><span>'+esc(c.prevName)+'</span><div class="cmp-bar">'+
      (c.partial ? '<i class="ghost" style="width:'+w(c.prevFull.out)+'"></i>' : '')+
      '<i class="was" style="width:'+w(c.prev.out)+'"></i></div><b class="fig">'+money0(c.prev.out)+'</b></div>'+
    (c.partial ? '<div class="cmp-foot">Both up to the '+ordinal(c.upto)+'. '+c.prevName+' ended on '+money0(c.prevFull.out)+'.</div>' : '')+
    (c.moves.length ? '<div class="cmp-moves"><div class="cmp-sub">Biggest changes</div>'+c.moves.map(m=>{
        const cat = m.cid === '__none' ? {name:'Needs a category', colour:'#6b7684'} : catById(m.cid);
        return '<div class="cmp-move"><i style="background:'+esc(cat.colour || '#6b7684')+'"></i><span>'+esc(cat.name)+'</span>'+
          '<b class="fig '+(m.d < 0 ? 'good' : 'mid')+'">'+(m.d < 0 ? '−' : '+')+money0(Math.abs(m.d))+'</b></div>';
      }).join('')+'</div>' : '');
  box.style.display = '';
  return true;
}
function renderSpend(){
  const now = monthKey(new Date());
  const [y,m] = spendMonth.split('-').map(Number);
  const label = new Date(y,m-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  document.getElementById('m-label').textContent = spendMonth===now ? 'This month' : label;
  document.getElementById('m-next').style.opacity = spendMonth>=now ? 0.3 : 1;

  const mt = monthTotals(spendMonth);
  animFig(document.getElementById('s-total'), mt.out, money0);

  // v56: like for like. Part-way through a month, "more than last month"
  // against a FULL month is always wrong, so this month is measured against
  // last month up to the same day.
  const cmp = document.getElementById('s-compare');
  const cmpShown = renderSpendCompare(mt);
  cmp.style.display = cmpShown ? 'none' : '';
  if(!cmpShown) cmp.textContent = mt.inn>0 ? money0(mt.inn)+' came in' : '';

  // by category
  // Straight from monthTotals, so the bars, the sheet they open and the month
  // header can never disagree about what a category cost.
  const sorted = Object.entries(mt.byCat).sort((a,b)=>b[1]-a[1]);
  const maxV = sorted.length ? sorted[0][1] : 1;

  // v50: the month split by category as one bar. The five biggest get their
  // own colour; the rest share a grey so the bar stays readable.
  const stack = document.getElementById('s-stack');
  const totalCat = sorted.reduce((s,e)=>s+Math.max(0,e[1]),0);
  if(stack){
    if(totalCat > 0){
      const top = sorted.filter(e=>e[1]>0).slice(0,5);
      const rest = totalCat - top.reduce((s,e)=>s+e[1],0);
      stack.innerHTML = top.map(([cid,v])=>{
        const col = cid==='__none' ? 'var(--text3)' : (catById(cid).colour || 'var(--text3)');
        return '<i style="width:'+(v/totalCat*100).toFixed(2)+'%; background:'+esc(col)+'"></i>';
      }).join('') + (rest > 0.005 ? '<i style="width:'+(rest/totalCat*100).toFixed(2)+'%; background:#3a3f48"></i>' : '');
      stack.style.display = '';
    } else { stack.innerHTML = ''; stack.style.display = 'none'; }
  }
  // Everything still untagged, any month - the same set the tagging sheet works on.
  const uncatN = txns.filter(needsAttention).length;
  document.getElementById('s-uncat').style.display = uncatN ? '' : 'none';
  document.getElementById('s-uncat-t').textContent = uncatN+' need'+(uncatN===1?'s':'')+' sorting';

  // A category with a budget shows progress against the budget instead of against
  // your biggest category — the limit is the thing worth knowing.
  const anyBudget = Object.values(budgets).some(v=>v>0);
  document.getElementById('cat-breakdown').innerHTML = sorted.length===0
    ? '<div class="estate"><i class="ti ti-receipt" aria-hidden="true"></i><div class="et">Nothing spent this month</div><div class="es">Import a statement and this fills in by category, biggest first.</div><button data-estate="import">Import a statement</button></div>'
    : '<div class="card pad">' + sorted.map(([cid,v])=>{
        const c = cid==='__none' ? {name:'Needs a category', colour:'#6b7684'} : catById(cid);
        const pct = Math.round(v/mt.out*100);
        const bud = Number(budgets[cid])||0;
        let right, barW, barCol, sub = '';
        if(bud > 0){
          const used = v/bud*100;
          barW = Math.min(100, used);
          const over = v > bud;
          barCol = over ? 'var(--out)' : (used > 85 ? 'var(--brass)' : c.colour);
          right = money0(v)+' <span style="color:var(--text3)">of '+money0(bud)+'</span>';
          sub = over ? money0(v-bud)+' over' : money0(bud-v)+' left';
        } else {
          barW = v/maxV*100; barCol = c.colour;
          right = money0(v)+' <span style="color:var(--text3)">'+pct+'%</span>';
        }
        return '<button class="catrow" data-catdrill="'+esc(cid)+'">'+
          '<div style="display:flex; justify-content:space-between; align-items:baseline; font-size:13.5px; gap:10px;">'+
          '<span>'+esc(c.name)+'</span><span class="fig">'+right+
          ' <i class="ti ti-chevron-right" style="font-size:12px; color:var(--text3);"></i></span></div>'+
          '<div class="catbar"><div style="width:'+barW+'%; background:'+barCol+'"></div></div>'+
          (sub ? '<div class="note" style="margin-top:3px;">'+sub+'</div>' : '')+'</button>';
      }).join('') +
      (mt.refundsBack > 0.005 ? '<div class="catrow" style="cursor:default"><div style="display:flex; justify-content:space-between; align-items:baseline; font-size:13.5px; gap:10px;"><span>Refunds back</span><span class="fig" style="color:var(--in)">−'+money0(mt.refundsBack)+'</span></div><div class="note" style="margin-top:3px;">Money back that Ledger could not match to a purchase this month</div></div>' : '') +
      '</div>' +
      (mt.movedOut > 0.005 || mt.movedIn > 0.005 ? '<div class="note" style="margin:-4px 4px 12px;">'+
        (mt.movedOut > 0.005 ? money0(mt.movedOut)+' moved to investments' : '')+
        (mt.movedOut > 0.005 && mt.movedIn > 0.005 ? ', ' : '')+
        (mt.movedIn > 0.005 ? money0(mt.movedIn)+' back from investments' : '')+
        ' this month. Not counted as spending or income.</div>' : '') +
      (anyBudget ? '' : '<button class="btn ghost" id="set-budgets-btn" style="margin-top:2px;">Set monthly budgets</button>');
  const sbb = document.getElementById('set-budgets-btn');
  if(sbb) sbb.onclick = openBudgets;

  // The month on screen, with its refund pairings, so the sheet nets the same
  // way the bar it opened from does.
  document.querySelectorAll('#cat-breakdown [data-catdrill]').forEach(b=>{
    b.onclick = ()=> openCategory(b.dataset.catdrill, mt, spendMonth);
  });

  growOnce(document.getElementById('view-spend'), spendMonth+'|'+Math.round(mt.out));

  // filter chips
  const chips = ['<button class="chip'+(catFilter===null?' on':'')+'" data-cat="">All</button>']
    .concat(sorted.map(([cid])=>{
      const c = cid==='__none' ? {name:'Needs a category'} : catById(cid);
      return '<button class="chip'+(catFilter===cid?' on':'')+'" data-cat="'+cid+'">'+esc(c.name)+'</button>';
    }));
  document.getElementById('cat-filter').innerHTML = chips.join('');
  document.querySelectorAll('#cat-filter .chip').forEach(b=>{
    b.onclick = ()=>{ catFilter = b.dataset.cat || null; txnPageSize = TXN_FIRST; renderSpend(); };
  });

  const found = searchTxns(txnQuery);
  const sum = document.getElementById('txn-search-sum');
  document.querySelector('.srch').classList.toggle('has', !!txnQuery);
  // The category chips filter the month. With a search running they would
  // narrow a different list than the one on screen, so they step aside.
  document.getElementById('cat-filter').style.display = found ? 'none' : '';

  let list;
  if(found){
    list = found;
    const out = found.filter(t=>t.dir==='out').reduce((a,t)=>a+t.amount,0);
    const inn = found.filter(t=>t.dir==='in').reduce((a,t)=>a+t.amount,0);
    // "2026-01 to 2026-08" is machine output. Say it the way a person would.
    const mlab = d => parseYMD(d).toLocaleDateString('en-GB',{month:'short', year:'numeric'});
    const a = found.length ? mlab(found[found.length-1].date) : '';
    const b2 = found.length ? mlab(found[0].date) : '';
    const span = !found.length ? '' : (a === b2 ? a : a + ' to ' + b2);
    sum.className = 'srch-sum on';
    sum.innerHTML = found.length === 0
      ? 'Nothing matches that, in any month.'
      : '<b>'+found.length+'</b> across every month'+(span?' \u00b7 '+span:'')+
        (out ? ' \u00b7 <b>'+money0(out)+'</b> out' : '')+
        (inn ? ' \u00b7 <b>'+money0(inn)+'</b> in' : '');
  } else {
    sum.className = 'srch-sum';
    sum.innerHTML = '';
    list = txnsInMonth(spendMonth).sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if(catFilter) list = list.filter(t=> (t.cat||'__none')===catFilter );
    if(dayFilter) list = list.filter(t=> t.date === dayFilter);   // v69: a day picked on the calendar
  }
  document.getElementById('txn-count').textContent = list.length ? list.length : '';
  // Rendering a whole year of statements at once builds thousands of rows and
  // wires a swipe handler to each — it took seconds. Show a page at a time.
  const shown = Math.min(list.length, txnPageSize);
  document.getElementById('txn-list').innerHTML = list.length===0
    ? (txnQuery
        ? '<div class="estate"><i class="ti ti-search-off" aria-hidden="true"></i><div class="et">No match, in any month</div><div class="es">Search looks at the description, the note, the category and the amount.</div></div>'
        : '<div class="empty">Nothing here.</div>')
    : txnRowsByDay(list.slice(0, shown)) +
      (list.length > shown
        ? '<button class="lrow tap" id="txn-more" style="width:100%; border:none; background:none; color:var(--brass); font:inherit; justify-content:center; padding:14px;">Show '+
          Math.min(TXN_PAGE, list.length - shown)+' more of '+list.length+'</button>'
        : '');
  const moreBtn = document.getElementById('txn-more');
  if(moreBtn) moreBtn.onclick = ()=>{ txnPageSize += TXN_PAGE; renderSpend(); };
  wireTxnRows();
}

// ---------------- Assets ----------------
// The line is drawn to the DATA's own scale, so month-to-month movement is
// readable; the bar underneath is drawn to the TARGET's scale, so the gap is
// honest. One chart cannot do both without lying about one of them.
function nwPath(series, w, h, pad){
  const vals = series.map(p=>p.value);
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if(hi - lo < 1){ hi = hi + 1; lo = lo - 1; }
  const span = hi - lo;
  const x = i => pad + (w - pad*2) * (series.length===1 ? 0.5 : i/(series.length-1));
  const y = v => pad + (h - pad*2) * (1 - (v - lo)/span);
  return { pts: series.map((p,i)=>({x:x(i), y:y(p.value), v:p.value})), lo, hi };
}
function renderNetWorth(){
  const card = document.getElementById('nw-card');
  if(!card) return;
  const series = netWorthSeries();
  const now = accts.length || hasAssets() ? netWorthAt(todayYMD()) : 0;
  const target = freedomTarget();

  document.getElementById('nw-amt').innerHTML = moneyPair0(now);
  // v63: Home's "Net position" leaves trading money out; this one counts it.
  const trd = tradingTotal();
  document.getElementById('nw-incl').textContent = trd ? 'Includes '+money0(trd)+' trading capital. Home leaves trading out.' : '';
  document.getElementById('nw-target').textContent = money0(target);

  const pct = target > 0 ? Math.max(0, Math.min(100, now/target*100)) : 0;
  document.getElementById('nw-fill').style.width = pct + '%';
  document.getElementById('nw-pct').innerHTML =
    '<b>'+ (pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct)) +'%</b> of the way there';

  const sub = document.getElementById('nw-sub');
  const chart = document.getElementById('nw-chart');
  const months = document.getElementById('nw-months');
  const verdict = document.getElementById('nw-verdict');

  if(series.length < 2){
    sub.textContent = accts.length || hasAssets()
      ? 'One month in. The line starts once there are two.'
      : 'Add an account or an asset and this starts drawing itself.';
    chart.innerHTML = ''; months.innerHTML = '';
    verdict.className = 'nw-verdict unknown';
    verdict.textContent = 'No rate yet. Ledger will not guess at a date from a single month.';
    return;
  }

  const first = series[0].value, last = series[series.length-1].value;
  const change = last - first;
  sub.innerHTML = (change >= 0 ? 'Up ' : 'Down ') + money0(Math.abs(change)) +
    ' over ' + (series.length-1) + ' month' + (series.length-1===1?'':'s');

  const W = 320, H = 96, PAD = 6;
  const { pts, lo, hi } = nwPath(series, W, H, PAD);
  const line = pts.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
  const area = line + ' L'+pts[pts.length-1].x.toFixed(1)+' '+(H-PAD)+
               ' L'+pts[0].x.toFixed(1)+' '+(H-PAD)+' Z';
  const end = pts[pts.length-1];
  chart.innerHTML =
    '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" '+
    'aria-label="Net worth over '+series.length+' months">'+
      '<defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0%" stop-color="rgba(217,180,74,0.22)"/>'+
        '<stop offset="100%" stop-color="rgba(217,180,74,0)"/>'+
      '</linearGradient></defs>'+
      '<path d="'+area+'" fill="url(#nwg)"/>'+
      '<path d="'+line+'" fill="none" stroke="var(--brass)" stroke-width="2" '+
        'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'+
      '<circle cx="'+end.x.toFixed(1)+'" cy="'+end.y.toFixed(1)+'" r="3.2" fill="var(--brass)"/>'+
    '</svg>';
  const lab = m => { const [y,mm]=m.split('-'); return new Date(+y,+mm-1,1)
      .toLocaleDateString('en-GB',{month:'short'}); };
  months.innerHTML = '<span>'+lab(series[0].month)+'</span>'+
    (series.length > 2 ? '<span>'+lab(series[Math.floor(series.length/2)].month)+'</span>' : '')+
    '<span>'+lab(series[series.length-1].month)+'</span>';

  // The arithmetic. Below four points there is no rate, and saying so is the
  // honest answer rather than dividing by a number that means nothing.
  if(series.length < NW_MIN_MONTHS){
    verdict.className = 'nw-verdict unknown';
    verdict.textContent = 'Not enough months yet to call a rate — '+(series.length-1)+
      ' of the '+(NW_MIN_MONTHS-1)+' it takes.';
    return;
  }
  const rate = netWorthRate(series, 3);
  const yrs = yearsToTarget(now, rate, target);
  verdict.className = 'nw-verdict';
  if(now >= target){
    verdict.innerHTML = 'You are past ' + money0(target) + '. <b>That was the number.</b>';
  } else if(yrs === null){
    verdict.className = 'nw-verdict unknown';
    verdict.innerHTML = 'Over the last three months you are ' +
      (rate === 0 ? 'flat' : 'down ' + money0(Math.abs(rate)) + ' a month') +
      '. At this rate there is no date to give you.';
  } else {
    const when = yrs < 1
      ? Math.max(1, Math.round(yrs*12)) + ' month' + (Math.round(yrs*12)===1?'':'s')
      : yrs.toFixed(1) + ' years';
    verdict.innerHTML = 'At the last three months\u2019 rate — <b>'+money0(rate)+
      ' a month</b> — you reach '+money0(target)+' in <b>'+when+'</b>.';
  }
}

function renderAssets(){
  renderNetWorth();
  if(typeof renderInvCards === 'function') renderInvCards();
  // v57: Holdings = Crypto + Stocks + anything logged by hand. Growth counts
  // what you took back out, so selling at a profit is not "down".
  const IT = invTotals(), man = manualAssets();
  const val = assetsValue(), inv = assetsInvested();
  const gain = man.reduce((t,a)=>t+assetValue(a)-assetInvested(a),0) + IT.total;
  animFig(document.getElementById('a-value'), val, money0);
  document.getElementById('a-invested').textContent = money0(inv);
  document.getElementById('a-return').textContent = (gain>=0?'+':'−')+money0(Math.abs(gain));
  document.getElementById('a-return').className = 'val fig ' + (gain>=0?'in':'out');
  document.getElementById('a-gain').textContent = !hasAssets() ? ''
    : (gain>=0?'Up ':'Down ')+money0(Math.abs(gain))+' all time'+
      (IT.takenOut > 0 ? ', counting '+money0(IT.takenOut)+' taken back out' : '')+
      (inv>0 ? ' ('+(gain>=0?'+':'−')+Math.abs(gain/inv*100).toFixed(1)+'%)' : '');
  // v58: what the total is made of, so it visibly adds up.
  const brk = document.getElementById('a-break');
  if(brk){
    const parts = invCatIds().filter(invCatAny).map(c=> [invCatInfo(c).name, invCategory(c).value]);
    if(man.length) parts.push(['Not in a category yet', man.reduce((t,a)=>t+assetValue(a),0)]);
    const cov = assets.filter(a=>a.covered);
    brk.innerHTML = parts.length > 1 || cov.length ? parts.map(x=> '<div class="ab-row"><span>'+esc(x[0])+'</span><b class="fig">'+money0(x[1])+'</b></div>').join('')+
      '<div class="ab-row ab-tot"><span>Total</span><b class="fig">'+money0(val)+'</b></div>'+
      (cov.length ? '<div class="ab-note">'+cov.length+' hand-logged '+(cov.length===1?'entry is':'entries are')+' left out because '+(cov.length===1?'it is':'they are')+' already counted in an investment.</div>' : '') : '';
  }
  // v59: anything still logged by hand gets one prompt to move it into a
  // category; once moved, there is no second list.
  const hr = document.getElementById('hold-rule'), um = unmovedAssets();
  if(hr) hr.textContent = 'Not in a category yet';
  document.getElementById('hold-wrap').style.display = um.length ? '' : 'none';
  document.getElementById('add-asset-btn').style.display = 'none';
  document.getElementById('asset-list').innerHTML = !um.length ? ''
    : '<button class="btn" id="move-go" style="margin:0 0 10px;">Put '+(um.length===1?'it':'these '+um.length)+' in your categories</button>'+(
    false
    ? '<div class="estate"><i class="ti ti-chart-line" aria-hidden="true"></i><div class="et">Nothing tracked yet</div><div class="es">An investment, a pot, anything you own that changes value. Ledger keeps what you put in separate from what it made.</div><button data-estate="asset">Add an asset</button></div>'
    : '<div class="card">' + um.map(a=>{
        const v = assetValue(a), i = assetInvested(a), g = v-i;
        const readings = (a.values||[]).length;
        // v50: a value over a week old is flagged, since the Sunday reading is
        // what keeps real growth honest.
        const lastRead = readings ? a.values.reduce((m,v)=> (v && v.date > m ? v.date : m), '') || null : null;
        const age = lastRead ? Math.floor((parseYMD(todayYMD()) - parseYMD(lastRead))/86400000) : null;
        const stale = age !== null && age > 7;
        const d2 = stale
          ? '<div class="d2 stale">Value is '+age+' days old · update</div>'
          : '<div class="d2">'+money0(i)+' put in · '+(readings ? readings+' reading'+(readings===1?'':'s') : 'no readings yet')+'</div>';
        if(a.covered) return '<div class="lrow tap covered" data-asset="'+a.id+'"><div><div class="d1">'+esc(a.name)+'</div><div class="d2">Counted in '+esc(invCatInfo(a.covered).name)+', not twice</div></div><div class="amtcol"><span class="sub">'+money0(v)+'</span></div></div>';
        return '<div class="lrow tap" data-asset="'+a.id+'"><div><div class="d1">'+esc(a.name)+'</div>'+
          d2+'</div>'+
          '<div class="amtcol">'+moneyPair0(v)+'<span class="sub '+(g>=0?'in':'out')+'" style="color:'+(g>=0?'var(--in)':'var(--out)')+'">'+
          (g>=0?'+':'−')+money0(Math.abs(g))+'</span></div></div>';
      }).join('') + '</div>');
  const mg = document.getElementById('move-go'); if(mg) mg.onclick = openMoveSheet;
  document.querySelectorAll('[data-asset]').forEach(el=>{
    el.onclick = ()=> openAsset(el.dataset.asset);
  });
}

// ---------------- More ----------------
function renderSettingsHome(){
  const put = (id, t)=>{ const el = document.getElementById(id); if(el) el.textContent = t; };
  const uns = txns.filter(needsAttention).length;
  const bd = settings.lastBackup ? Math.floor((parseYMD(todayYMD()) - parseYMD(settings.lastBackup))/86400000) : null;
  put('sc-week', (uns ? uns+' to sort' : 'All sorted')+' · '+(bd === null ? 'never backed up' : bd === 0 ? 'backed up today' : 'backed up '+bd+'d ago'));
  const nb = Object.values(budgets).filter(v=>v>0).length;
  put('sc-setup', recur.length+' bill'+(recur.length===1?'':'s')+' · '+nb+' budget'+(nb===1?'':'s')+' · '+accts.length+' account'+(accts.length===1?'':'s'));
  put('sc-currency', curCode()+(secOn() ? ' · '+secCode()+' shown underneath' : ''));
  put('sc-feel', (soundOn() ? 'Taps on' : 'Taps off')+' · '+(fxOn() ? 'sounds on' : 'sounds off')+' · '+(hapticsOn() ? 'buzz on' : 'buzz off'));
  put('sc-data', 'Restore or export');
  const T = freedomTargets(); put('targets-sub', 'Keep '+Math.round(T.keep*100)+'% · '+T.runway+' months runway');
  let dn = 0; try{ const d = duplicateScan(); dn = d.certain.reduce((a,g)=>a+g.length-1, 0) + d.possible.length; }catch(e){}
  put('sc-fix', dn ? dn+' possible duplicate'+(dn===1?'':'s') : 'Duplicates and currency fixes');
}
function renderMore(){
  renderSettingsHome();
  const rb = rollbackAvailable();
  const undoRow = document.getElementById('do-undo');
  undoRow.style.display = rb ? 'flex' : 'none';
  if(rb) document.getElementById('undo-sub').textContent =
    rb.label + ' · ' + new Date(rb.at).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  document.getElementById('cur-sub').textContent =
    curCode()+' — '+(CURRENCIES[curCode()]||{name:''}).name;
  const dScan = duplicateScan();
  const dExtra = dScan.certain.reduce((s,g)=>s+g.length-1, 0);
  const dMaybe = dScan.possible.length;
  document.getElementById('dupe-sub').textContent = dExtra
    ? dExtra + ' duplicate' + (dExtra===1?'':'s') + ' inflating your totals' +
      (dMaybe ? ', ' + dMaybe + ' more to check' : '')
    : (dMaybe ? dMaybe + ' possible duplicate' + (dMaybe===1?'':'s') + ' to check' : 'None found');
  const unt = txns.filter(t=>!t.cat && t.dir!=='transfer').length;
  document.getElementById('bulk-sub').textContent = unt
    ? unt + ' transaction' + (unt===1?'':'s') + ' still need a category'
    : 'Everything is categorised';
  const rboard = rateBoard();
  const rboardEl = document.getElementById('rates-sub');
  if(rboardEl){
    const watched = rboard.codes.filter(c=>c !== rboard.base);
    const age = rateBoardAgeDays();
    rboardEl.textContent = watched.length
      ? rboard.base + ' vs ' + watched.join(', ') + (rboard.date ? ' · ' + (age === 0 ? 'today' : age + 'd old') : '')
      : 'Not set up yet';
  }
  const fxFixN = (settings.fxFixes||[]).length;
  const fxImpEl = document.getElementById('fximport-sub');
  if(fxImpEl) fxImpEl.textContent = fxFixN
    ? fxFixN + ' fix' + (fxFixN===1?'':'es') + ' applied'
    : 'Convert transactions that came in as the wrong money';
  const fxN = (settings.fxLog||[]).length;
  document.getElementById('fxfix-sub').textContent = fxN
    ? fxN + ' conversion' + (fxN===1?'':'s') + ' applied — reversible'
    : 'No conversions applied';
  document.getElementById('sec-sub').textContent = secOn()
    ? 'Showing ' + secCode() + ' underneath at ' + secRate().toFixed(2) + secDrift()
    : 'Off — show a rough second currency in small print';
  const ht = document.getElementById('haptic-toggle');
  ht.textContent = hapticsOn() ? 'On' : 'Off';
  ht.classList.toggle('on', hapticsOn());
  ht.onclick = ()=>{
    localStorage.setItem(HAPTIC_KEY, hapticsOn() ? 'off' : 'on');
    if(hapticsOn()) buzz();
    renderMore();
  };
  const fxt = document.getElementById('fx-toggle');
  fxt.textContent = fxOn() ? 'On' : 'Off';
  fxt.classList.toggle('on', fxOn());
  fxt.onclick = ()=>{
    try{ localStorage.setItem(FX_KEY, fxOn() ? 'off' : 'on'); }catch(e){}
    if(fxOn()) sfx('arcade');   // a preview, so you know what you just switched on
    renderMore();
  };
  const st = document.getElementById('sound-toggle');
  st.textContent = soundOn() ? 'On' : 'Off';
  st.classList.toggle('on', soundOn());
  st.onclick = ()=>{
    localStorage.setItem(SOUND_KEY, soundOn() ? 'off' : 'on');
    renderMore();
  };
  document.getElementById('recur-sub').textContent = recur.length
    ? recur.length+' item'+(recur.length===1?'':'s')+' · '+money0(committedMonthly())+' a month'
    : 'Nothing set up yet';
  const nb = Object.values(budgets).filter(v=>v>0).length;
  const nMonths = completeMonthsDesc().length;
  document.getElementById('budget-sub').textContent =
    (nb ? nb+' categor'+(nb===1?'y':'ies')+' capped' : 'No limits set') +
    (nMonths ? ' · insights from '+nMonths+' month'+(nMonths===1?'':'s') : '');
  document.getElementById('acct-sub').textContent = accts.length ? accts.length+' set up' : 'None yet';
  document.getElementById('rule-sub').textContent = rules.length+' rule'+(rules.length===1?'':'s')+' · '+cats.length+' categories';
  paintCloudRow();
  const carriedOn = carryDate();
  document.getElementById('backup-note').textContent = carriedOn
    ? 'One file, both apps — includes COACH data from '+
      parseYMD(carriedOn).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+'.'
    : 'Ledger only for now. Restore a COACH backup here once and every future file covers both apps.';
  // The row says whether it is DUE, not just when it last happened — a date
  // needs arithmetic to act on, and nobody does arithmetic in a settings list.
  const bs = document.getElementById('backup-sub');
  const bd = daysSinceBackup();
  if(!settings.lastBackup){
    bs.textContent = 'Never backed up';
    bs.style.color = 'var(--brass)';
  } else if(bd !== null && bd >= BACKUP_EVERY_DAYS){
    bs.textContent = 'Due — last taken '+bd+' day'+(bd===1?'':'s')+' ago';
    bs.style.color = 'var(--brass)';
  } else {
    bs.textContent = 'Last taken '+parseYMD(settings.lastBackup).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    bs.style.color = '';
  }
  document.getElementById('check-sub').textContent = settings.lastCheck
    ? 'Last checked '+parseYMD(settings.lastCheck).toLocaleDateString('en-GB',{day:'numeric',month:'short'})
    : 'Compare against your real balance';
}
