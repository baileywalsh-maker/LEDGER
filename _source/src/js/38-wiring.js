// ============================================================
// Wiring
// ============================================================
document.querySelectorAll('.tabs button').forEach(b=> b.onclick = ()=> switchView(b.dataset.view));
// The gear toggles: tap it again and you are back where you were.
let viewBeforeMore = 'home';
document.getElementById('tb-more').onclick = ()=>{
  if(currentView === 'more'){ switchView(viewBeforeMore || 'home'); return; }
  viewBeforeMore = currentView;
  switchView('more');
};
document.getElementById('tb-search').onclick = ()=>{
  if(currentView !== 'spend') switchView('spend');
  const box = document.getElementById('txn-search');
  // After the view has painted, so the field is on screen when the keyboard opens.
  box.scrollIntoView({block:'center'});
  box.focus();
};
document.getElementById('act-import').onclick = ()=> document.getElementById('open-import').click();
document.getElementById('bk-pill').onclick = ()=> document.getElementById('do-backup').click();
document.getElementById('recent-all').onclick = ()=> switchView('spend');
wireFolds();
document.getElementById('s-uncat').onclick = ()=> openSort();
// Debounced, because re-rendering the list on every keystroke of a
// thousand-row search is the one place this app can feel slow.
let searchTimer = null;
document.getElementById('txn-search').addEventListener('input', e=>{
  const v = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>{
    txnQuery = v; txnPageSize = TXN_FIRST; renderSpend();
  }, 160);
});
document.getElementById('txn-search-x').onclick = ()=>{
  document.getElementById('txn-search').value = '';
  txnQuery = ''; txnPageSize = TXN_FIRST; renderSpend();
};

document.getElementById('m-prev').onclick = ()=>{ spendMonth = shiftMonth(spendMonth,-1); catFilter=null; txnPageSize=TXN_FIRST; renderSpend(); };
document.getElementById('m-next').onclick = ()=>{
  const now = monthKey(new Date());
  if(spendMonth >= now) return;
  spendMonth = shiftMonth(spendMonth,1); catFilter=null; txnPageSize=TXN_FIRST; renderSpend();
};

// ---- day watcher ----
// The app stays resident on the home screen for days at a time, so anything
// computed once at load goes stale: the Spending screen would sit on August
// into September, and the Sunday check-in would never appear if the app was
// already open on Sunday night.
let watchedDay = todayYMD();
let watchedMonth = monthKey(new Date());

// v55: keep the second currency's rate fresh by itself, at most once a day,
// whenever there is a connection. A failed lookup quietly keeps the old rate.
let secRefreshing = false;
function autoRefreshSecondary(){
  try{
    if(!secOn() || secRefreshing) return;
    const sec = settings.secondary;
    if(sec.rateDate === todayYMD() || sec.checkedOn === todayYMD()) return;
    if(navigator.onLine === false) return;
    secRefreshing = true;
    fetchRate(curCode(), sec.code).then(r=>{
      if(r && r.rate > 0){
        settings.secondary = {...settings.secondary, rate: r.rate, rateDate: r.date || todayYMD(), manual: false, checkedOn: todayYMD()};
        save(K.settings, settings); render();
      }
    }, ()=>{}).finally(()=>{ secRefreshing = false; });
  }catch(e){ secRefreshing = false; }
}
function handleDayRollover(){
  autoRefreshSecondary();
  const now = todayYMD();
  if(now === watchedDay) return;
  const prevMonth = watchedMonth;
  const nowMonth = monthKey(new Date());
  // only follow the calendar forward if you were looking at the current month
  const followMonth = (spendMonth === prevMonth);
  watchedDay = now;
  watchedMonth = nowMonth;
  if(followMonth) spendMonth = nowMonth;
  // A new day may have brought a subscription due. Post before rendering so the
  // balance the user sees is already correct rather than correcting itself a
  // moment later.
  runAutoPost();
  render();
  maybeWeeklyCheckin();
  maybeMonthlyCheckin();
}

document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) handleDayRollover(); });
window.addEventListener('focus', handleDayRollover);
window.addEventListener('pageshow', handleDayRollover);
setInterval(handleDayRollover, 60000);

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

// Catch up anything that fell due while the app was closed, before the first
// paint, so no figure is ever shown pre-deduction and then quietly changed.
runAutoPost();
// And drop any posted charge the bank has since confirmed for real.
reconcileAutoPosted();

switchView('home');
appBooted = true;
setTimeout(autoRefreshSecondary, 1500);
// Hold the opening screen just long enough to read, then fade it.
(function(){
  const sp = document.getElementById('splash'); if(!sp) return;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = Math.max(0, (reduce ? 300 : 1100) - performance.now());
  setTimeout(()=>{ sp.classList.add('out'); setTimeout(()=> sp.remove(), 450); }, wait);
})();
checkMilestone();   // records the starting mark silently on first run
maybeWeeklyCheckin();
maybeMonthlyCheckin();