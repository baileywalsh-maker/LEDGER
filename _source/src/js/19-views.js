// ============================================================
// Views
// ============================================================
let currentView = 'home';
let spendMonth = monthKey(new Date());
let catFilter = null;
// Searching is deliberately global. A month-scoped search would answer a
// question you can already answer by scrolling.
let txnQuery = '';
function matchTxn(t, needle, numeric){
  if((t.desc||'').toLowerCase().indexOf(needle) >= 0) return true;
  if((t.note||'').toLowerCase().indexOf(needle) >= 0) return true;
  if((t.memo||'').toLowerCase().indexOf(needle) >= 0) return true;
  if(t.cat){ const c = catById(t.cat); if(c && c.name.toLowerCase().indexOf(needle) >= 0) return true; }
  // "42.10" should find the £42.10, because that is how you remember a
  // transaction you cannot name.
  if(numeric && Number(t.amount||0).toFixed(2).indexOf(needle) >= 0) return true;
  return false;
}
function searchTxns(q){
  const needle = String(q||'').trim().toLowerCase();
  if(needle.length < 2) return null;
  const numeric = /^[0-9]+(\.[0-9]+)?$/.test(needle);
  return txns.filter(t=>matchTxn(t, needle, numeric))
             .sort((a,b)=> b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
}
const TXN_PAGE = 120, TXN_FIRST = 8;   // v68: 8 first, then the rest on a tap
let txnPageSize = TXN_FIRST;

function switchView(v){
  const changed = currentView !== v;
  currentView = v;
  ['home','spend','assets','more'].forEach(x=>{
    document.getElementById('view-'+x).style.display = x===v ? 'block' : 'none';
  });
  document.querySelectorAll('.tabs button').forEach(b=>{
    const on = b.dataset.view===v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.getElementById('tb-more').classList.toggle('on', v==='more');
  // Switching tabs kept the scroll position. Assets is the shortest view, so
  // arriving there from a scrolled Ledger clamped the scroll and the whole page
  // appeared to jump. Every tab now starts at the top, which is also just what
  // you want when you tap a tab.
  // Assign scrollTop rather than calling window.scrollTo(): identical in a real
  // browser, but jsdom has no scrollTo implementation and logs an error for it
  // on every single test, which would hide a genuine boot error in the noise.
  const se = document.scrollingElement || document.documentElement;
  if(se) se.scrollTop = 0;
  // Settings is a place you visit, not where you add things from.
  document.getElementById('actbar').style.display = v==='more' ? 'none' : '';
  render();
  if(changed) fadeIn(document.getElementById('view-'+v));
}

// v50: backup status lives in the header on every screen. It replaced a
// paragraph on the home screen that was easy to scroll past.
function renderBackupPill(){
  const el = document.getElementById('bk-pill');
  if(!el) return;
  const hasData = accts.length > 0 || txns.length > 0;
  let days = null;
  if(settings.lastBackup) days = Math.floor((parseYMD(todayYMD()) - parseYMD(settings.lastBackup))/86400000);
  const due = hasData && (days === null || days >= BACKUP_EVERY_DAYS);
  el.style.visibility = hasData ? '' : 'hidden';
  el.className = 'bk-pill ' + (due ? 'due' : 'ok');
  const shield = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>'+
    (due ? '<path d="M12 8v5M12 16.5v.01"/>' : '<path d="M9 12l2 2 4-4"/>')+'</svg>';
  el.innerHTML = shield + (due ? (days === null ? 'Back up' : 'Back up · '+days+'d') : 'Safe');
  el.setAttribute('aria-label', due
    ? (days === null ? 'Never backed up. Tap to back up now.' : 'Last backup '+days+' days ago. Tap to back up now.')
    : (days === 0 ? 'Backed up today' : 'Backed up '+days+' day'+(days===1?'':'s')+' ago'));
}

// v51: a sound each time net worth passes a new £10,000 mark. Only the
// highest mark reached is kept (settings.nwMilestone), so dipping under and
// back over the same line does not celebrate twice. The first time it runs it
// just records where you are, silently.
const MILESTONE_STEP = 10000;
let appBooted = false;
function checkMilestone(){
  if(!appBooted) return;
  try{
    if(!accts.length && !hasAssets()) return;
    const level = Math.floor(netWorthAt(todayYMD()) / MILESTONE_STEP);
    const had = Number(settings.nwMilestone);
    if(!isFinite(had) || settings.nwMilestone == null){ settings.nwMilestone = level; save(K.settings, settings); return; }
    if(level > had){ settings.nwMilestone = level; save(K.settings, settings); sfx('milestone'); }
  }catch(e){}
}

// ---------------- v56: gentle motion ----------------
// Figures count to their new value, bars fill once when they first show or
// change, a view fades in when you switch to it. All of it is skipped when
// the phone is set to reduce motion.
const reduceMotion = ()=>{ try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } };
function animFig(el, n, fmt){
  if(!el) return;
  const prev = el._fig;
  el._fig = n;
  cancelAnimationFrame(el._raf || 0);
  // First paint counts up the last tenth; after that, from the old figure.
  const from = prev === undefined ? n * 0.9 : prev;
  if(from === n || !isFinite(n) || !isFinite(from) || reduceMotion() || document.hidden){ el.innerHTML = fmt(n); return; }
  const t0 = performance.now(), D = prev === undefined ? 700 : 480;
  const step = now=>{
    const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = fmt(k < 1 ? from + (n - from) * e : n);
    if(k < 1) el._raf = requestAnimationFrame(step);
  };
  step(t0);
}
// Plays the fill-in once per change: `sig` is whatever the bars depend on.
function growOnce(el, sig){
  if(!el || el._sig === sig) return;
  el._sig = sig;
  if(reduceMotion()) return;
  el.classList.remove('grow'); void el.offsetWidth; el.classList.add('grow');
  clearTimeout(el._growT);
  el._growT = setTimeout(()=> el.classList.remove('grow'), 750);
}
function fadeIn(el){
  if(!el || reduceMotion()) return;
  el.classList.remove('view-in'); void el.offsetWidth; el.classList.add('view-in');
}

// ---------------- v56: Home sections fold ----------------
// Which sections are open is a preference for this phone, kept beside the
// other look-and-feel choices (not part of your data, so not in backups).
const FOLD_KEY = 'ledger:homefold';
// v68: what the compact look keeps tucked away until tapped. Stored beside the
// fold state (a look setting), absent = tucked away.
const XKEYS = {xHero:'x-hero', xFree:'x-free', xDue:'x-due', xCmp:'x-cmp', xNw:'x-nw', xPay:'x-pay', xCalShut:'x-calshut'};
function applyX(){
  let st = {}; try{ st = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; }catch(e){}
  for(const k in XKEYS) document.body.classList.toggle(XKEYS[k], !!st[k]);
}
function toggleX(k){
  let st = {}; try{ st = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; }catch(e){}
  if(!st || typeof st !== 'object') st = {};
  st[k] = st[k] ? 0 : 1;
  try{ localStorage.setItem(FOLD_KEY, JSON.stringify(st)); }catch(e){}
  applyX(); syncDueX();
}
function syncDueX(){
  const b = document.getElementById('due-x'); if(!b) return;
  const n = document.querySelectorAll('#sub-findings .finding').length;
  const hasTotal = !!document.querySelector('#committed-block .total-card');
  const open = document.body.classList.contains('x-due');
  b.classList.toggle('on', n > 0 || hasTotal);
  b.classList.toggle('alert', n > 0 && !open);
  b.textContent = open ? 'Show less'
    : (n ? n + ' thing' + (n === 1 ? '' : 's') + ' to check · ' : '') + 'Monthly total and more';
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
}
document.addEventListener('click', e=>{
  const t = e.target;
  if(t.closest('#due-x')){ toggleX('xDue'); return; }
  if(t.closest('.fr-head')){ toggleX('xFree'); return; }
  if(t.closest('button, a, input, select, .tile button')) return;
  if(t.closest('#view-home .hero')){ toggleX('xHero'); return; }
  if(t.closest('#s-cmp')){ toggleX('xCmp'); return; }
  if(t.closest('#nw-card') && !t.closest('#nw-chart, #nw-months, .nw-horizon')){ toggleX('xNw'); return; }
});
if(document.body) applyX(); else document.addEventListener('DOMContentLoaded', applyX);
const FOLD_DEFAULT = {due:1, accts:1, recent:1, history:0, dueAll:0, pots:1};
function foldState(){
  let st = null;
  try{ st = JSON.parse(localStorage.getItem(FOLD_KEY)); }catch(e){}
  return Object.assign({}, FOLD_DEFAULT, (st && typeof st === 'object') ? st : {});
}
function setFold(k, v){
  const st = foldState(); st[k] = v ? 1 : 0;
  try{ localStorage.setItem(FOLD_KEY, JSON.stringify(st)); }catch(e){}
}
function applyFolds(){
  const st = foldState();
  document.querySelectorAll('[data-fold]').forEach(b=>{
    const open = !!st[b.dataset.fold];
    b.classList.toggle('shut', !open);
    const h = document.querySelector('[data-foldh="'+b.dataset.fold+'"]');
    if(h){ h.classList.toggle('shut', !open); h.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  });
}
function wireFolds(){
  document.querySelectorAll('[data-foldh]').forEach(h=>{
    const go = e=>{
      if(e.target.closest('.rule-link')) return;      // "See all" is its own button
      const k = h.dataset.foldh, open = !foldState()[k];
      setFold(k, open);
      applyFolds();
      if(open) fadeIn(document.querySelector('[data-fold="'+k+'"]'));
    };
    h.onclick = go;
    h.onkeydown = e=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(e); } };
  });
}
let histAll = false;      // older months shown, this visit only
const HIST_SHOWN = 6, RECENT_SHOWN = 3, DUE_MIN = 3;

function render(){
  memoBegin();
  try{ renderNow(); } finally{ memoEnd(); }
}
function renderNow(){
  checkMilestone();
  renderBackupPill();
  renderWeekChip();
  // Sits above the subscription list on the home view, so a wrong interval or a
  // price rise is seen where the subscriptions are, not on a separate screen.
  if(currentView==='home') renderSubFindings();
  if(currentView==='home') renderHome();
  if(currentView==='home') syncDueX();
  if(currentView==='home'){ try{ renderPayday(); renderPots(); }catch(e){} }
  if(currentView==='spend') renderSpend();
  if(currentView==='assets') renderAssets();
  if(currentView==='more') renderMore();
  // The strapline names the section, so the wordmark never has to move.
  const subs = {
    home: new Date().toLocaleDateString('en-GB',{weekday:'long', day:'numeric', month:'long'}),
    spend:'Spending', assets:'Assets', more:'Settings and data'
  };
  document.getElementById('view-sub').textContent = subs[currentView] || '';
}

// ---------------- Home ----------------
function renderHome(){
  const liquid = liquidTotal();
  const net = liquid + assetsValue();
  animFig(document.getElementById('net-amt'), net, moneyPair0);

  const trading = tradingTotal();
  const bits = [];
  bits.push(money0(liquid)+' in accounts');
  if(hasAssets()) bits.push(money0(assetsValue())+' in assets');
  if(trading) bits.push(money0(trading)+' trading capital not counted here');
  document.getElementById('net-delta').textContent = bits.join(' · ');

  const mt = monthTotals(monthKey(new Date()));
  animFig(document.getElementById('m-in'), mt.inn, moneyPair0);
  animFig(document.getElementById('m-out'), mt.out, moneyPair0);

  // running total for the month so far
  const run = document.getElementById('m-running');
  const runFig = document.getElementById('m-running-fig');
  const runLine = document.getElementById('m-running-line');
  const monthNet = mt.net;   // `net` above is the net POSITION, a different figure
  run.className = 'hero-foot running ' + (Math.abs(monthNet) < 0.01 ? 'flat' : (monthNet > 0 ? 'up' : 'down'));
  // v50: in against out as one bar, so the month reads before the words do.
  const flow = mt.inn + mt.out;
  document.getElementById('m-bar-in').style.width  = (flow > 0 ? mt.inn/flow*100 : 0) + '%';
  document.getElementById('m-bar-out').style.width = (flow > 0 ? mt.out/flow*100 : 0) + '%';
  const nowD = new Date();
  const mName = nowD.toLocaleDateString('en-GB',{month:'long'});
  document.querySelectorAll('.m-name').forEach(e=> e.textContent = mName);
  const dim = new Date(nowD.getFullYear(), nowD.getMonth()+1, 0).getDate();
  document.getElementById('m-days').textContent = 'Day '+nowD.getDate()+' of '+dim;
  runFig.innerHTML = (monthNet > 0 ? '+' : monthNet < 0 ? '−' : '') + money0(Math.abs(monthNet)) +
    (secOn() ? '<span class="sec">'+secAmount(Math.abs(monthNet), true)+'</span>' : '');
  runLine.textContent = mt.inn === 0 && mt.out === 0
    ? 'Nothing recorded this month yet.'
    : monthNet > 0 ? money0(monthNet)+' more came in than went out.'
    : monthNet < 0 ? money0(Math.abs(monthNet))+' more went out than came in.'
    : 'Exactly level.';

  renderHistory();
  renderFreedom();

  // warnings that actually matter
  const warn = document.getElementById('home-warn');
  const msgs = [];
  if(accts.length===0) msgs.push('Start by adding an account (tap the gear, then Set up, then Accounts), then import a statement or add a few transactions by hand.');
  else if(txns.length===0) msgs.push('No transactions yet. Tap Import at the bottom and pick a CSV statement from your bank. It reads the whole file at once.');
  // v52: untagged transactions are a button now, straight into the sort list.
  const uncat = txns.filter(needsCat).length, unmemo = txns.filter(needsMemo).length;
  const orphans = orphanTxns().length;
  if(orphans > 0) msgs.push(orphans+' transaction'+(orphans===1?'':'s')+' point at an account that no longer exists, so they are counted in your spending but not in any balance. Export a backup before clearing them.');
  // Backup reminders moved to the pill in the header (v50), which turns amber
  // when one is due and backs up in one tap.
  const saTitle = [uncat ? uncat+' need'+(uncat===1?'s':'')+' a category' : '', unmemo ? unmemo+' need'+(unmemo===1?'s':'')+' a note' : ''].filter(Boolean).join(' · ');
  const saSub = uncat ? 'They show as "Needs a category" in your spending until sorted' : 'Other and Transfers need a few words on what they were';
  warn.innerHTML = ((uncat || unmemo) ? '<button class="sort-alert" id="sort-alert">'+
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>'+
      '<span class="sa-t"><b class="sa-short">'+(uncat + unmemo)+' to sort</b><b>'+saTitle+'</b><small>'+saSub+'</small></span>'+
      '<span class="sa-go">Sort</span></button>' : '') +
    (msgs.length ? '<div class="warn" style="margin-top:14px;">'+msgs.join('<br><br>')+'</div>' : '');
  const sa = document.getElementById('sort-alert');
  if(sa) sa.onclick = openSort;

  // Subscriptions — ALL of them, soonest first. Previously this only listed
  // items due in the next seven days, so anything further out simply never
  // appeared on the dashboard and looked like it had not saved.
  const cm = committedMonthly();
  document.getElementById('committed-total').textContent = recur.length ? money0(cm)+'/mo' : '';
  const cb = document.getElementById('committed-block');
  if(recur.length === 0){
    cb.innerHTML = '<div class="estate"><i class="ti ti-repeat" aria-hidden="true"></i><div class="et">Nothing locked in yet</div><div class="es">Add your subscriptions and bills and Ledger will tell you what leaves every month before you spend a penny.</div><button data-estate="recurring">Add a bill</button></div>';
  } else {
    // v47: measured against LAST month, which is finished. A share of a month
    // still in progress reads high on the 4th and low on the 28th.
    const lastMk = shiftMonth(monthKey(new Date()), -1);
    const lastMt = monthTotals(lastMk);
    const lastName = parseYMD(lastMk + '-01').toLocaleDateString('en-GB', {month:'long'});
    const share = lastMt.inn > 0 ? Math.round(cm / lastMt.inn * 100) : null;
    const sorted = [...recur].sort((a,b)=> nextDueDate(a) - nextDueDate(b));
    const midnight = new Date().setHours(0,0,0,0);

    // v56: what is due in the next week (never fewer than three), with the
    // rest one tap away - and the count on the button, so nothing looks lost.
    const daysTo = r => Math.round((nextDueDate(r) - midnight)/86400000);
    let cut = Math.max(DUE_MIN, sorted.filter(r=> daysTo(r) <= 7).length);
    if(sorted.length - cut < 2) cut = sorted.length;
    const dueAll = !!foldState().dueAll || cut >= sorted.length;
    const listed = dueAll ? sorted : sorted.slice(0, cut);
    const hidden = sorted.length - listed.length;
    cb.innerHTML =
      '<div class="card">' + listed.map(r=>{
        const d = nextDueDate(r);
        const days = Math.round((d - midnight)/86400000);
        // The countdown is the thing you actually want at a glance, so it gets
        // its own column rather than being buried in a sentence.
        const cd = days===0 ? 'today' : days===1 ? '1<span>day</span>' : days+'<span>days</span>';
        const tone = days<=1 ? ' now' : days<=7 ? ' soon' : '';
        const per = r.cadence==='days' ? ('every '+everyDays(r)+' days')
                  : ({weekly:'weekly', fortnightly:'every 2 weeks', monthly:'monthly',
                     quarterly:'quarterly', yearly:'yearly'}[r.cadence] || '');
        return '<div class="swipe-wrap">'+
          '<button class="swipe-del" data-delrecur="'+r.id+'" aria-label="Delete"><i class="ti ti-trash"></i>Delete</button>'+
          '<div class="lrow tap subrow'+(days<=7?' due-soon':'')+'" data-recur="'+r.id+'">'+
          '<div class="countdown'+tone+'">'+cd+'</div>'+
          '<div class="submid"><div class="d1">'+esc(r.name)+'</div>'+
          '<div class="d2">'+d.toLocaleDateString('en-GB',{day:'numeric', month:'short'})+(per?' · '+per:'')+'</div></div>'+
          '<div class="amtcol out">'+moneyPair(r.amount)+'</div></div></div>';
      }).join('') +
      (hidden ? '<button class="more-row" id="due-more">Show all '+sorted.length+' <span>'+hidden+' more, later on</span></button>'
              : (cut < sorted.length ? '<button class="more-row" id="due-more">Show less</button>' : '')) + '</div>' +
      // the total belongs under the list it is the total OF
      '<div class="card pad total-card">'+
      '<div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px;">'+
      '<span style="font-size:13px; color:var(--text2);">Leaves every month, no matter what</span>'+
      '<span class="fig" style="font-size:18px; font-weight:600; white-space:nowrap;">'+money0(cm)+'</span></div>'+
      '<div class="note" style="margin-top:5px;">'+
      money0(cm*12)+' a year'+(share!==null ? ' · about '+share+'% of what came in during '+lastName : '')+'.</div>'+
      '</div>';

    const dm = document.getElementById('due-more');
    if(dm) dm.onclick = ()=>{ setFold('dueAll', !foldState().dueAll); render(); };
    document.querySelectorAll('[data-recur]').forEach(el=>{
      el.onclick = e=>{
        if(openSwipe === el){ e.stopPropagation(); closeSwipe(); return; }
        openRecur(el.dataset.recur);
      };
    });
    document.querySelectorAll('[data-delrecur]').forEach(b=>{
      b.onclick = ()=>{
        recur = recur.filter(r=>r.id!==b.dataset.delrecur);
        save(K.recur, recur);
        openSwipe = null;
        render();
      };
    });
  }

  document.getElementById('liquid-total').innerHTML = accts.length ? money0(liquid) : '';
  document.getElementById('acct-list').innerHTML = accts.length===0
    ? '<div class="estate"><i class="ti ti-building-bank" aria-hidden="true"></i><div class="et">No accounts yet</div><div class="es">Add where your money actually sits and every figure in Ledger starts working from a real balance.</div><button data-estate="accounts">Add an account</button></div>'
    : '<div class="card">' + accts.map(a=>{
        const b = acctBalance(a.id);
        // Defensive: a record from an older backup may carry no type at all,
        // and a throw here takes the whole dashboard with it.
        const ty = String(a.type || 'current');
        const label = ty==='trading' ? 'Trading capital' :
                      ty.charAt(0).toUpperCase()+ty.slice(1);
        return '<div class="swipe-wrap">'+
          '<button class="swipe-del" data-delacct="'+a.id+'" aria-label="Delete account"><i class="ti ti-trash"></i>Delete</button>'+
          '<div class="lrow tap" data-editacct="'+a.id+'"><div><div class="d1">'+esc(a.name)+'</div><div class="d2">'+label+'</div></div>'+
          '<div class="amtcol '+(b<0?'out':'')+'">'+moneyPair(b)+'</div></div></div>';
      }).join('') + '</div>';
  document.querySelectorAll('[data-editacct]').forEach(el=>{
    el.onclick = e=>{
      if(openSwipe === el){ e.stopPropagation(); closeSwipe(); return; }
      openAcctEdit(el.dataset.editacct);
    };
  });
  document.querySelectorAll('[data-delacct]').forEach(b=> b.onclick = ()=> deleteAccount(b.dataset.delacct));

  const recent = [...txns].sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0,RECENT_SHOWN);
  document.getElementById('recent-list').innerHTML = recent.length===0
    ? '<div class="empty">Nothing recorded yet.</div>'
    : txnRowsByDay(recent);
  wireTxnRows();
  attachSwipe();   // accounts and committed rows are swipeable too
  applyFolds();
}

// ---------------- Freedom targets (v55) ----------------
// settings.freedomTargets = {keep: 0.3, runway: 6}. Added in v55; anything
// missing falls back to these defaults, so older data needs nothing.
function freedomTargets(){
  const t = settings.freedomTargets || {};
  const keep = [0.2,0.3,0.4,0.5].includes(Number(t.keep)) ? Number(t.keep) : 0.3;
  const runway = [3,6,9,12].includes(Number(t.runway)) ? Number(t.runway) : 6;
  return {keep, runway};
}
function keepTone(r){ const t = freedomTargets(); return r === null ? '' : r < 0.1 ? 'bad' : r < t.keep ? 'mid' : 'good'; }
function runTone(m){ const t = freedomTargets(); return m < t.runway/2 ? 'bad' : m < t.runway ? 'mid' : 'good'; }
function renderTargets(){
  const t = freedomTargets();
  const opt = (vals, cur, fmt, key)=> vals.map(v=>'<button class="tg-o'+(v===cur?' on':'')+'" data-tg="'+key+'" data-v="'+v+'">'+fmt(v)+'</button>').join('');
  document.getElementById('tg-keep').innerHTML = opt([0.2,0.3,0.4,0.5], t.keep, v=>Math.round(v*100)+'%', 'keep');
  document.getElementById('tg-run').innerHTML = opt([3,6,9,12], t.runway, v=>v+' mo', 'runway');
  document.getElementById('tg-keep-n').textContent = 'Red under 10% · amber 10–'+Math.round(t.keep*100)+'% · green from '+Math.round(t.keep*100)+'%';
  document.getElementById('tg-run-n').textContent = 'Red under '+(t.runway/2)+' months · amber up to '+t.runway+' · green from '+t.runway;
  document.querySelectorAll('[data-tg]').forEach(b=> b.onclick = ()=>{
    const cur = freedomTargets();
    cur[b.dataset.tg] = Number(b.dataset.v);
    settings.freedomTargets = cur; save(K.settings, settings);
    renderTargets(); render();
  });
}
document.getElementById('open-targets').onclick = ()=>{ renderTargets(); openSheet('targets-backdrop'); };
document.getElementById('targets-close').onclick = ()=> closeSheet('targets-backdrop');

// ---------------- Freedom (v54) ----------------
// Two numbers. How much of what comes in you keep, and how many months the
// money in your accounts would last if income stopped. Measured on the last
// three finished months, skipping the first month Ledger knows about (it is
// almost always only half recorded). Trading capital and assets are left out
// of runway on purpose: runway is money you could actually live on.
function freedomStats(){
  const now = monthKey(new Date());
  const months = [...new Set(txns.map(t=>String(t.date||'').slice(0,7)))].filter(m=>m && m < now).sort();
  const usable = months.length > 1 ? months.slice(1) : months;
  const last = usable.slice(-3);
  let inn = 0, out = 0;
  last.forEach(mk=>{ const t = monthTotals(mk); inn += t.inn; out += t.out; });
  const n = last.length;
  const cur = monthTotals(now);
  return {
    n, months: last,
    rate: n && inn > 0 ? (inn - out) / inn : null,
    // early in a month the figure is mostly payday and means little, so it waits until the 20th
    rateNow: cur.inn > 0 && new Date().getDate() >= 20 ? (cur.inn - cur.out) / cur.inn : null,
    avgOut: n ? out / n : 0,
    avgKept: n ? (inn - out) / n : 0,
    liquid: liquidTotal()
  };
}
function renderFreedom(){
  const box = document.getElementById('freedom');
  if(!box) return;
  const f = freedomStats();
  if(!f.n || f.avgOut <= 0){
    box.innerHTML = '<div class="fr-head"><b class="xt">Freedom</b></div>'+
      '<div class="note" style="margin-top:6px;">Shows how much you keep and how long your money would last. It needs one full month of transactions first.</div>';
    return;
  }
  const T = freedomTargets();
  const pctTxt = r => r === null ? '–' : (r < 0 ? '−' : '') + Math.abs(Math.round(r*100)) + '%';
  const runway = Math.max(0, f.liquid / f.avgOut);
  const runTxt = runway < 10 ? runway.toFixed(1) : String(Math.round(runway));
  const kTone = keepTone(f.rate), rTone = runTone(runway);
  const col = {good:'var(--in)', mid:'#e0b95f', bad:'var(--out)', '':'var(--text2)'};
  const clamp = v => Math.max(0, Math.min(1, v));

  // ---- view A: bars with a target line ----
  const kMax = Math.max(0.5, T.keep + 0.2, f.rate || 0);
  const rMax = T.runway * 2;
  const bar = (frac, tgt, tone)=> '<div class="fr-bar"><i style="width:'+(clamp(frac)*100).toFixed(1)+'%; background:'+col[tone]+'"></i>'+
    '<b style="left:'+(clamp(tgt)*100).toFixed(1)+'%"></b></div>';
  const avgIn = f.avgKept + f.avgOut;
  const needMore = T.keep * avgIn - f.avgKept;
  let gap;
  if(f.rate !== null && f.rate < T.keep) gap = 'Keep <b>'+money0(Math.max(1, needMore))+' more a month</b> to hit '+Math.round(T.keep*100)+'%.';
  else if(runway < T.runway){
    const mths = f.avgKept > 0 ? Math.ceil((T.runway * f.avgOut - f.liquid) / f.avgKept) : null;
    gap = 'On target for keeping.'+(mths ? ' Runway reaches '+T.runway+' months in about <b>'+mths+' month'+(mths===1?'':'s')+'</b>.' : '');
  } else gap = '<b>Both on target.</b> That is freedom being built.';
  const viewA =
    '<div class="fr-row"><div class="fr-lab">You keep</div><div><span class="fr-big" style="color:'+col[kTone]+'">'+pctTxt(f.rate)+'</span><span class="fr-of"> of '+Math.round(T.keep*100)+'% target</span></div></div>'+
    bar((f.rate||0)/kMax, T.keep/kMax, kTone)+
    '<div class="fr-scale"><span>0%</span><span>'+Math.round(kMax*100)+'%</span></div>'+
    '<div class="fr-row" style="margin-top:14px;"><div class="fr-lab">Runway</div><div><span class="fr-big" style="color:'+col[rTone]+'">'+runTxt+'</span><span class="fr-of"> of '+T.runway+' months</span></div></div>'+
    bar(runway/rMax, 0.5, rTone)+
    '<div class="fr-scale"><span>0</span><span>'+rMax+' mo</span></div>'+
    '<div class="fr-gap">'+gap+'</div>';

  // ---- view B: two gauges ----
  const pt = (frac, r)=>{ const a = Math.PI * (1 - clamp(frac)); return [70 + r*Math.cos(a), 70 - r*Math.sin(a)]; };
  const arc = (f1, f2, colr, on)=>{ const [x1,y1] = pt(f1,56), [x2,y2] = pt(f2,56);
    return '<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+' A56 56 0 0 1 '+x2.toFixed(1)+' '+y2.toFixed(1)+'" fill="none" stroke="'+colr+'" stroke-width="10"'+(on?'':' stroke-opacity="0.3"')+'/>'; };
  const gauge = (frac, b1, b2, tone, label, valTxt, sub)=>{
    const [nx,ny] = pt(frac, 44);
    return '<div class="fr-g"><svg width="140" height="78" viewBox="0 0 140 78" role="img" aria-label="'+label+' '+valTxt+'">'+
      arc(0, b1, '#f0897c', tone==='bad')+arc(b1, b2, '#e0b95f', tone==='mid')+arc(b2, 1, '#7fe0b0', tone==='good')+
      '<line x1="70" y1="70" x2="'+nx.toFixed(1)+'" y2="'+ny.toFixed(1)+'" stroke="#eef0f3" stroke-width="3" stroke-linecap="round"/>'+
      '<circle cx="70" cy="70" r="5" fill="#eef0f3"/></svg>'+
      '<div class="fr-gv" style="color:'+col[tone]+'">'+valTxt+'</div><div class="fr-gl">'+label+'</div><div class="fr-gs">'+sub+'</div></div>';
  };
  const viewB = '<div class="fr-gauges">'+
      gauge((f.rate||0)/kMax, 0.1/kMax, T.keep/kMax, kTone, 'You keep', pctTxt(f.rate), 'target '+Math.round(T.keep*100)+'%')+
      gauge(runway/rMax, 0.25, 0.5, rTone, 'Runway', runTxt+' mo', 'target '+T.runway+' months')+
    '</div>'+
    '<div class="fr-key"><span><i style="background:#f0897c"></i>Behind</span><span><i style="background:#e0b95f"></i>Getting there</span><span><i style="background:#7fe0b0"></i>On target</span></div>';

  const bought = f.avgKept / f.avgOut;
  const line = bought > 0
    ? 'Each month you work buys you about <b>'+(bought < 1 ? (d=> d+(d===1?' day':' days'))(Math.max(1, Math.round(bought*30))) : bought.toFixed(1)+' months')+'</b> of freedom.'
    : 'Right now more goes out than comes in, so no freedom is being bought.';
  const span = f.n === 1 ? 'last month' : 'last '+f.n+' months';
  let slide = 0; try{ slide = Number(localStorage.getItem('ledger:frslide')) === 1 ? 1 : 0; }catch(e){}
  box.innerHTML =
    '<div class="fr-head"><b class="xt">Freedom</b><span>'+span+'</span></div>'+
    '<div class="fr-slides" id="fr-slides"><div class="fr-slide">'+viewA+'</div><div class="fr-slide">'+viewB+'</div></div>'+
    '<div class="fr-dots"><button aria-label="Bars view" data-frs="0"></button><button aria-label="Gauges view" data-frs="1"></button></div>'+
    '<div class="fr-line">'+line+'</div>';
  // Swipe between the two views, like a post. The one you left on is remembered.
  const sl = document.getElementById('fr-slides');
  const dots = box.querySelectorAll('[data-frs]');
  const mark = i => dots.forEach((d,j)=> d.classList.toggle('on', i===j));
  mark(slide);
  requestAnimationFrame(()=>{ sl.scrollLeft = slide * sl.clientWidth; });
  let t = null;
  sl.addEventListener('scroll', ()=>{
    clearTimeout(t);
    t = setTimeout(()=>{ const i = Math.round(sl.scrollLeft / Math.max(1, sl.clientWidth)); mark(i); try{ localStorage.setItem('ledger:frslide', String(i)); }catch(e){} }, 80);
  }, {passive:true});
  dots.forEach(d=> d.onclick = ()=> sl.scrollTo({left: Number(d.dataset.frs) * sl.clientWidth, behavior:'smooth'}));
  growOnce(box, [Math.round((f.rate||0)*100), runTxt, T.keep, T.runway].join('|'));
}

// ---------------- History: months, expanding to weeks ----------------
let openMonth;   // undefined = never touched; null = deliberately collapsed

function renderHistory(){
  const el = document.getElementById('history-list');
  const months = monthsWithActivity();
  if(months.length === 0){ el.innerHTML = '<div class="empty">Nothing to show yet.</div>'; return; }
  if(openMonth === undefined) openMonth = months[0];   // open the latest month on first look only

  const hs = document.getElementById('history-sum');
  if(hs) hs.textContent = months.length+' month'+(months.length===1?'':'s');
  const shownMonths = histAll ? months.slice(0,24) : months.slice(0, HIST_SHOWN);
  const olderN = Math.min(months.length, 24) - shownMonths.length;
  el.innerHTML = shownMonths.map(mk=>{
    const [y,m] = mk.split('-').map(Number);
    const start = new Date(y, m-1, 1), end = new Date(y, m, 0);
    const p = periodTotals(start, end);
    const label = start.toLocaleDateString('en-GB',{month:'long', year:'numeric'});
    const cls = Math.abs(p.net) < 0.01 ? '' : (p.net > 0 ? 'up' : 'down');
    const col = p.net > 0 ? 'var(--in)' : p.net < 0 ? 'var(--out)' : 'var(--text2)';
    const isOpen = mk === openMonth;

    let html = '<button class="mrow '+(isOpen?'open':'')+'" data-month="'+mk+'">'+
      '<div><div class="mname">'+label+'</div>'+
      '<div class="mmeta">'+(p.count ? money0(p.inn)+' in · '+money0(p.out)+' out' : 'nothing recorded')+'</div></div>'+
      '<div style="display:flex; align-items:center;"><span class="mfig" style="color:'+col+'">'+
      (p.net>0?'+':p.net<0?'−':'')+money0(Math.abs(p.net))+'</span>'+
      '<i class="ti ti-chevron-right chev"></i></div></button>';

    if(isOpen){
      const weeks = weeksOfMonth(mk);
      html += '<div class="weekstrip">'+
        '<button class="wcard whole" data-period="'+ymd(start)+'|'+ymd(end)+'|'+esc(label)+'">'+
        '<div class="wlab">Whole month</div>'+
        '<div class="wfig" style="color:'+col+'">'+(p.net>0?'+':p.net<0?'−':'')+money0(Math.abs(p.net))+'</div>'+
        '<div class="wsub">'+p.count+' transaction'+(p.count===1?'':'s')+'</div></button>' +
        weeks.map((wk,i)=>{
          const wp = periodTotals(wk.start, wk.end);
          const wcls = wp.count === 0 ? 'empty-w' : (wp.net > 0 ? 'up' : wp.net < 0 ? 'down' : '');
          const wlabel = wk.stub
            ? 'Final '+wk.len+' day'+(wk.len===1?'':'s')+' of '+start.toLocaleDateString('en-GB',{month:'long'})
            : 'Week '+wk.index+' of '+start.toLocaleDateString('en-GB',{month:'long', year:'numeric'});
          return '<button class="wcard '+wcls+'" data-period="'+ymd(wk.start)+'|'+ymd(wk.end)+'|'+esc(wlabel)+'">'+
            '<div class="wlab">'+(wk.stub ? 'Last '+wk.len+' day'+(wk.len===1?'':'s') : 'Week '+wk.index)+'</div>'+
            '<div class="wfig">'+(wp.count===0 ? '—' : (wp.net>0?'+':wp.net<0?'−':'')+money0(Math.abs(wp.net)))+'</div>'+
            '<div class="wsub">'+shortD(wk.start)+' – '+shortD(wk.end)+'</div></button>';
        }).join('') + '</div>';
    }
    return html;
  }).join('') + (olderN > 0 ? '<button class="more-row solo" id="hist-more">Show '+olderN+' older month'+(olderN===1?'':'s')+'</button>' : '');
  const hm = document.getElementById('hist-more');
  if(hm) hm.onclick = ()=>{ histAll = true; renderHistory(); };

  el.querySelectorAll('[data-month]').forEach(b=>{
    b.onclick = ()=>{ openMonth = (openMonth === b.dataset.month) ? null : b.dataset.month; renderHistory(); };
  });
  el.querySelectorAll('[data-period]').forEach(b=>{
    b.onclick = ()=>{
      const [s,e,label] = b.dataset.period.split('|');
      openPeriod(parseYMD(s), parseYMD(e), label);
    };
  });
}

function openPeriod(startD, endD, label){
  const p = periodTotals(startD, endD);
  document.getElementById('per-title').textContent = label;
  document.getElementById('per-range').textContent = shortD(startD)+' – '+shortD(endD);

  const netCol = p.net > 0 ? 'var(--in)' : p.net < 0 ? 'var(--out)' : 'var(--text2)';
  document.getElementById('per-net').textContent = (p.net>0?'+':p.net<0?'−':'')+money0(Math.abs(p.net));
  document.getElementById('per-net').style.color = netCol;
  document.getElementById('per-verdict').textContent =
    p.count === 0 ? 'Nothing recorded in this period.'
    : p.net > 0 ? 'You kept '+money0(p.net)+' of what came in.'
    : p.net < 0 ? 'You spent '+money0(Math.abs(p.net))+' more than came in.'
    : 'In and out matched exactly.';

  document.getElementById('per-in').textContent = money0(p.inn);
  document.getElementById('per-out').textContent = money0(p.out);

  // where it went
  const cats = Object.entries(p.byCat).sort((a,b)=>b[1]-a[1]);
  const maxV = cats.length ? cats[0][1] : 1;
  document.getElementById('per-cats').innerHTML = cats.length === 0
    ? '<div class="note">Nothing spent in this period.</div>'
    : '<div class="card pad">' + cats.map(([cid,v])=>{
        const c = cid==='__none' ? {name:'Needs a category', colour:'#6b7684'} : catById(cid);
        return '<button class="catrow" data-catdrill="'+esc(cid)+'">'+
          '<div style="display:flex; justify-content:space-between; align-items:baseline; font-size:13.5px; gap:10px;">'+
          '<span>'+esc(c.name)+'</span><span class="fig">'+money0(v)+' <span style="color:var(--text3)">'+
          Math.round(v/p.out*100)+'%</span> <i class="ti ti-chevron-right" style="font-size:12px; color:var(--text3);"></i></span></div>'+
          '<div class="catbar"><div style="width:'+(v/maxV*100)+'%; background:'+c.colour+'"></div></div></button>';
      }).join('') + '</div>';
  document.querySelectorAll('[data-catdrill]').forEach(b=>{
    b.onclick = ()=> openCategory(b.dataset.catdrill, p, null);
  });

  // the handful that actually moved the needle
  const big = p.txns.filter(t=>t.dir==='out' && t.cat!=='invested').sort((a,b)=>b.amount-a.amount).slice(0,6);
  document.getElementById('per-big').innerHTML = big.length === 0 ? '<div class="note">Nothing spent.</div>'
    : '<div class="card">' + big.map(t=>
        '<div class="lrow"><div><div class="d1">'+esc(t.desc||'Untitled')+'</div>'+
        '<div class="d2">'+(t.cat?esc(catById(t.cat).name):'Needs a category')+' · '+
        parseYMD(t.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+'</div></div>'+
        '<div class="amtcol out">'+moneyPair(t.amount)+'</div></div>').join('') + '</div>';

  // day-by-day, so a bad week is traceable to the day it happened
  const days = [];
  for(let d = new Date(startD); d <= endD; d = new Date(d.getTime()+86400000)){
    const dp = periodTotals(d, d);
    days.push({d:new Date(d), ...dp});
  }
  const busiest = Math.max(1, ...days.map(x=>x.out));
  document.getElementById('per-days').innerHTML = p.count === 0 ? '' :
    '<div class="rule">Day by day</div><div class="card pad">' + days.map(x=>
      '<div style="display:flex; align-items:center; gap:10px; margin-bottom:9px;">'+
      '<span style="width:52px; font-size:11.5px; color:var(--text3);">'+x.d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric'})+'</span>'+
      '<div class="catbar" style="flex:1; margin:0;"><div style="width:'+(x.out/busiest*100)+'%; background:'+
      (x.out>0?'var(--out)':'transparent')+'"></div></div>'+
      '<span class="fig" style="width:62px; text-align:right; font-size:12px; color:'+(x.out>0?'var(--text2)':'var(--text3)')+'">'+
      (x.out>0?money0(x.out):'—')+'</span></div>').join('') + '</div>';

  openSheet('period-backdrop');
}

function txnRow(t){
  return '<div class="swipe-wrap">'+
    '<button class="swipe-del" data-deltxn="'+t.id+'" aria-label="Delete"><i class="ti ti-trash"></i>Delete</button>'+
    txnRowInner(t)+'</div>';
}
// v50: a list grouped under day headers — Today, Yesterday, Friday 16 Oct.
// Rows are only grouped when they arrive sorted newest first, which every
// caller does; anything else falls back to the plain list.
function dayLabel(ds){
  const d = parseYMD(ds), today = parseYMD(todayYMD());
  const diff = Math.round((today - d)/86400000);
  if(diff === 0) return 'Today';
  if(diff === 1) return 'Yesterday';
  const o = {weekday:'long', day:'numeric', month:'short'};
  if(d.getFullYear() !== today.getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('en-GB', o);
}
function txnRowsByDay(list){
  let last = null, html = '';
  for(const t of list){
    if(t.date !== last){ html += '<div class="dayhdr">'+esc(dayLabel(t.date))+'</div>'; last = t.date; }
    html += txnRow(t);
  }
  return html;
}
function txnRowInner(t){
  const acc = acctById(t.acct).name;
  let right, sub, dot;
  if(t.dir==='transfer'){
    right = '<span style="color:var(--text2)">'+money(t.amount)+'</span>';
    sub = acc+' → '+acctById(t.toAcct).name+(t.memo ? ' · '+t.memo : ' · not spending');
    dot = '<span class="cdot hollow"></span>';
  } else if(t.dir==='in'){
    right = '<span class="in">+'+money(t.amount)+'</span>';
    sub = catById(t.cat).name+(t.memo ? ' · '+t.memo : '')+' · '+acc;
    dot = '<span class="cdot" style="background:'+esc(catById(t.cat).colour||'var(--in)')+'"></span>';
  } else {
    right = '<span class="out">−'+money(t.amount)+'</span>';
    sub = (t.cat ? catById(t.cat).name+(t.memo ? ' · '+t.memo : needsMemo(t) ? ' · needs a note' : '') : 'Needs a category')+' · '+acc;
    dot = t.cat ? '<span class="cdot" style="background:'+esc(catById(t.cat).colour||'var(--text3)')+'"></span>'
                : '<span class="cdot none"></span>';
  }
  const d = parseYMD(t.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  return '<div class="lrow tap" data-txn="'+t.id+'"><div class="tx-main">'+dot+'<div class="tx-text"><div class="d1">'+esc(t.desc||'Untitled')+'</div>'+
         '<div class="d2'+((t.dir==='out' && !t.cat) || needsMemo(t) ? ' needcat' : '')+'">'+esc(sub)+'</div></div></div>'+
         '<div class="amtcol">'+right+'<span class="sub">'+d+'</span></div></div>';
}
function wireTxnRows(){
  document.querySelectorAll('[data-txn]').forEach(el=>{
    el.onclick = e=>{
      // A tap that ends a swipe should close the row, not open the editor.
      if(openSwipe === el){ e.stopPropagation(); closeSwipe(); return; }
      openTxn(el.dataset.txn);
    };
  });
  document.querySelectorAll('[data-deltxn]').forEach(b=>{
    b.onclick = ()=>{
      txns = txns.filter(t=>t.id!==b.dataset.deltxn);
      save(K.txns, txns);
      openSwipe = null;
      render();
    };
  });
  attachSwipe();
}

// ---- swipe to delete ----
const SWIPE_W = 86;
let openSwipe = null;
function closeSwipe(){
  if(!openSwipe) return;
  const el = openSwipe;
  el.classList.add('snap');
  el.style.transform = '';
  setTimeout(()=>el.classList.remove('snap'), 220);
  openSwipe = null;
}
function attachSwipe(){
  document.querySelectorAll('.swipe-wrap > .lrow').forEach(row=>{
    if(row.dataset.swipeWired) return;
    row.dataset.swipeWired = '1';
    let sx=0, sy=0, drag=false, armed=false, base=0;
    row.addEventListener('pointerdown', e=>{
      if(e.pointerType==='mouse' && e.button!==0) return;
      if(openSwipe && openSwipe !== row) closeSwipe();
      sx = e.clientX; sy = e.clientY;
      base = (openSwipe === row) ? -SWIPE_W : 0;
      armed = true; drag = false;
      row.classList.remove('snap');
    });
    row.addEventListener('pointermove', e=>{
      if(!armed) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if(!drag){
        if(Math.abs(dy) > Math.abs(dx)){ armed = false; return; }  // let the page scroll
        if(Math.abs(dx) < 8) return;
        drag = true;
        // Ask for a layer now that the row really is about to move, and give it
        // back on release. Held permanently on every row, this is what unpinned
        // the fixed nav on iOS.
        row.classList.add('swiping');
        row.setPointerCapture(e.pointerId);
      }
      let x = base + dx;
      if(x > 0) x = x/4;
      if(x < -SWIPE_W) x = -SWIPE_W - (Math.abs(x)-SWIPE_W)/4;
      row.style.transform = 'translateX('+x+'px)';
      e.preventDefault();
    });
    const rel = e=>{
      if(!armed) return;
      armed = false;
      if(!drag) return;
      drag = false;
      const x = base + (e.clientX - sx);
      row.classList.add('snap');
      if(x < -SWIPE_W/2){ row.style.transform = 'translateX(-'+SWIPE_W+'px)'; openSwipe = row; }
      else { row.style.transform = ''; if(openSwipe === row) openSwipe = null; }
      setTimeout(()=>{ row.classList.remove('snap'); row.classList.remove('swiping'); }, 220);
    };
    row.addEventListener('pointerup', rel);
    row.addEventListener('pointercancel', rel);
  });
}
document.addEventListener('pointerdown', e=>{
  if(openSwipe && !e.target.closest('.swipe-wrap')) closeSwipe();
}, true);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Every transaction behind one category bar, biggest first. The period is the
// one already on screen, so the total here always matches the bar that was tapped.
// The category sheet. Opened from a month or from any period, it shows that
// window first and then lets you step back through earlier months without
// closing it - "what do I spend on this, and is it going up" is one question,
// not two screens.
const CATD_MAX_MONTHS = 24;
let catdState = null;

function catdMonthsFor(cid){
  const seen = {};
  for(const t of txns){
    if(t.dir !== 'out') continue;
    if((t.cat || '__none') !== cid) continue;
    seen[t.date.slice(0,7)] = true;
  }
  return Object.keys(seen).sort().reverse().slice(0, CATD_MAX_MONTHS);
}

// mk === null means "the window it was opened with".
function openCategory(cid, p, mk){
  const months = catdMonthsFor(cid);
  // Opened from a whole calendar month? Then the month cards are the same thing
  // as the window, and showing both would be one card too many.
  const isWholeMonth = !!mk && p.start === mk + '-01' && p.end === ymd(monthEndDate(mk));
  catdState = {cid, p, months, isWholeMonth, sel: isWholeMonth ? mk : null};
  renderCategory();
  openSheet('cat-backdrop');
}

function renderCategory(){
  const st = catdState;
  if(!st) return;
  const cid = st.cid;
  const c = cid === '__none' ? {name:'Needs a category', colour:'#6b7684'} : catById(cid);

  // The window on screen: a chosen month, or the period the sheet was opened on.
  const win = st.sel ? monthTotals(st.sel) : st.p;
  const off = win.refundOff || {};

  const rows = win.txns
    .filter(t => t.dir === 'out' && (t.cat || '__none') === cid)
    .map(t => ({t, net: t.amount - (off[t.id] || 0), back: off[t.id] || 0}))
    .filter(r => r.net > 0.005)
    // Latest first. Two on the same day keep the order they were imported in.
    .sort((a,b) => a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0);

  const total = rows.reduce((s,r)=>s+r.net, 0);
  const backTotal = rows.reduce((s,r)=>s+r.back, 0);

  document.getElementById('catd-name').textContent = c ? c.name : 'Category';
  document.getElementById('catd-total').textContent = money0(total);

  const winLabel = st.sel
    ? parseYMD(st.sel + '-01').toLocaleDateString('en-GB',{month:'long', year:'numeric'})
    : 'this period';
  document.getElementById('catd-sub').innerHTML =
    esc(rows.length + (rows.length===1?' transaction':' transactions')) +
    (st.sel ? ' in ' + esc(winLabel) : '') +
    (win.out > 0 ? ' \u00b7 ' + Math.round(total/win.out*100) + '% of what you spent' : '') +
    (backTotal > 0.005
      ? '<br><span style="color:var(--in)">' + money0(backTotal) + ' refunded, already taken off</span>'
      : '');

  // ---- month cards ----
  const strip = document.getElementById('catd-months');
  const cards = [];
  if(!st.isWholeMonth){
    cards.push('<button class="wcard'+(st.sel===null?' on':'')+'" data-catdm="">'+
      '<div class="wlab">This period</div>'+
      '<div class="wfig">'+money0(st.p.byCat[cid] || 0)+'</div>'+
      '<div class="wsub">'+shortD(parseYMD(st.p.start))+' \u2013 '+shortD(parseYMD(st.p.end))+'</div></button>');
  }
  st.months.forEach(m=>{
    const v = monthTotals(m).byCat[cid] || 0;
    const d = parseYMD(m + '-01');
    cards.push('<button class="wcard'+(st.sel===m?' on':'')+'" data-catdm="'+m+'">'+
      '<div class="wlab">'+esc(d.toLocaleDateString('en-GB',{month:'short'}))+'</div>'+
      '<div class="wfig">'+money0(v)+'</div>'+
      '<div class="wsub">'+d.getFullYear()+'</div></button>');
  });
  strip.innerHTML = cards.join('');
  strip.style.display = cards.length > 1 ? '' : 'none';

  // ---- the list ----
  document.getElementById('catd-list').innerHTML = rows.length === 0
    ? '<div class="note">Nothing in this category for '+esc(st.sel ? winLabel : 'this period')+'.</div>'
    : '<div class="card">' + rows.map(r=>{
        const t = r.t, a = accts.find(x=>x.id===t.acct);
        return '<button class="lrow" data-catdtxn="'+esc(t.id)+'" style="width:100%; text-align:left;">'+
          '<div class="submid"><div class="d1">'+esc(t.desc||'\u2014')+'</div>'+
          '<div class="d2">'+prettyDate(t.date)+(a?' \u00b7 '+esc(a.name):'')+'</div>'+
          (r.back > 0.005
            ? '<div class="refline">'+money0(t.amount)+' out, '+money0(r.back)+' came back</div>'
            : '')+'</div>'+
          '<div class="amtcol out">'+moneyPair(r.net)+'</div></button>';
      }).join('') + '</div>';

  // Where it actually went, which a list of 40 rows does not tell you.
  const byMerchant = {};
  rows.forEach(r=>{
    const t = r.t;
    const k = merchantKey(t.desc || '') || (t.desc || '\u2014').toLowerCase();
    if(!byMerchant[k]) byMerchant[k] = {name: t.desc || '\u2014', v:0, n:0};
    byMerchant[k].v += r.net; byMerchant[k].n++;
  });
  const top = Object.keys(byMerchant).map(k=>byMerchant[k]).sort((a,b)=>b.v-a.v)[0];
  document.getElementById('catd-foot').innerHTML =
    (top && top.n > 1 && rows.length > 2)
      ? 'Biggest is <b style="color:var(--text2)">'+esc(top.name)+'</b> at '+money0(top.v)+
        ' across '+top.n+' transactions.'
      : '';

  strip.querySelectorAll('[data-catdm]').forEach(b=>{
    b.onclick = ()=>{ catdState.sel = b.dataset.catdm || null; renderCategory(); };
  });
  // Pull the chosen month back into view - stepping to June and being shown an
  // unchanged row of cards makes it look like nothing happened.
  const onCard = strip.querySelector('.wcard.on');
  if(onCard && onCard.scrollIntoView){
    try{ onCard.scrollIntoView({block:'nearest', inline:'center', behavior:'smooth'}); }catch(e){}
  }
  document.querySelectorAll('[data-catdtxn]').forEach(b=>{
    b.onclick = ()=>{
      closeSheet('cat-backdrop');
      setTimeout(()=>openTxn(b.dataset.catdtxn), 200);
    };
  });
}
