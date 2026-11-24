// ===================== v72: PULL DOWN TO REFRESH =====================
// Pull down from the top of any tab. Checks for a newer Ledger first: if there is
// one, it reloads (loading screen shows, data stays on the phone). Otherwise it
// syncs with Muse, refreshes prices and the currency rate, and redraws.
// APP_VERSION must match sw.js (build.js refuses to build if it doesn't).
const APP_VERSION = 72;
const PTR_GO = 70;              // px of (damped) pull needed to refresh
let ptrBusy = false;

function ptrBlocked(){
  if(ptrBusy) return true;
  if(document.querySelector('.backdrop.open')) return true;
  const ci = document.getElementById('ci'), inv = document.getElementById('inv');
  if((ci && !ci.hidden) || (inv && !inv.hidden)) return true;
  if(document.getElementById('splash')) return true;
  return (window.scrollY || document.documentElement.scrollTop || 0) > 0;
}

async function ptrNewerVersion(){
  try{
    const r = await fetch('sw.js?v=' + Date.now(), {cache:'no-store'});
    if(!r.ok) return null;
    const m = (await r.text()).match(/ledger-v(\d+)/);
    return m ? Number(m[1]) : null;
  }catch(e){ return null; }       // offline
}

async function pullRefresh(){
  if(ptrBusy) return {did:'busy'};
  ptrBusy = true;
  const el = document.getElementById('ptr');
  if(el){ el.classList.add('spin'); el.querySelector('.ptr-t').textContent = 'Checking…'; }
  try{
    const live = await ptrNewerVersion();
    if(live === null){
      showToast('Offline · showing what\'s on your phone');
      return {did:'offline'};
    }
    // If a reload already happened for this version and the page still says older
    // (e.g. sw.js bumped without APP_VERSION), don't loop: just refresh data.
    let tried = null; try{ tried = sessionStorage.getItem('ledger-ptr-tried'); }catch(e){}
    if(live > APP_VERSION && tried !== String(live)){
      try{ sessionStorage.setItem('ledger-ptr-tried', String(live)); }catch(e){}
      if(el) el.querySelector('.ptr-t').textContent = 'Updating Ledger…';
      try{ const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if(reg) await reg.update(); }catch(e){}
      try{ if(window.__ptrReload) window.__ptrReload(); else location.reload(); }catch(e){}
      return {did:'reload', live:live};
    }
    if(el) el.querySelector('.ptr-t').textContent = 'Syncing…';
    let synced = null;
    try{ if(syncEnabled()) synced = await syncNow({manual:true, quiet:true}); }catch(e){}
    try{ await refreshInvPrices(); }catch(e){}
    try{ autoRefreshSecondary(); }catch(e){}
    render();
    let msg = 'Up to date';
    if(synced && synced.ok) msg += synced.pulled ? ' · ' + synced.pulled + ' new from Muse' : ' · synced';
    else if(synced && synced.reason === 'notoken') msg += ' · add your sync token in Settings';
    else if(synced && !synced.ok && synced.reason !== 'off') msg += ' · sync failed, try again';
    showToast(msg);
    return {did:'refresh', synced:synced};
  }finally{
    ptrBusy = false;
    ptrSet(0, false);
    if(el) el.classList.remove('spin');
  }
}

function ptrSet(dy, armed){
  const el = document.getElementById('ptr'); if(!el) return;
  const h = Math.min(dy, PTR_GO * 1.4);
  el.style.height = h + 'px';
  el.style.opacity = h ? Math.min(1, h / PTR_GO) : 0;
  el.classList.toggle('armed', !!armed);
  const t = el.querySelector('.ptr-t');
  if(t && !el.classList.contains('spin')) t.textContent = armed ? 'Let go to refresh' : 'Pull to refresh';
  const ic = el.querySelector('.ptr-i');
  if(ic && !el.classList.contains('spin')) ic.style.transform = 'rotate(' + Math.round(Math.min(1, h / PTR_GO) * 180) + 'deg)';
}

(function ptrWire(){
  let y0 = null, x0 = 0, dy = 0, live = false;
  window.addEventListener('touchstart', e=>{
    if(e.touches.length !== 1 || ptrBlocked()){ y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; live = false;
  }, {passive:true});
  window.addEventListener('touchmove', e=>{
    if(y0 === null) return;
    const ry = e.touches[0].clientY - y0, rx = e.touches[0].clientX - x0;
    if(!live){
      if(Math.abs(rx) > Math.abs(ry) || ry <= 6){ if(Math.abs(rx) > 10 || ry < -6) y0 = null; return; }
      if((window.scrollY || 0) > 0){ y0 = null; return; }
      live = true;
    }
    dy = Math.max(0, ry * 0.5);
    ptrSet(dy, dy >= PTR_GO);
  }, {passive:true});
  const end = ()=>{
    if(y0 === null) return;
    y0 = null;
    if(live && dy >= PTR_GO){ ptrSet(PTR_GO * 0.8, false); pullRefresh(); }
    else ptrSet(0, false);
    live = false; dy = 0;
  };
  window.addEventListener('touchend', end, {passive:true});
  window.addEventListener('touchcancel', end, {passive:true});
})();
window.__pullRefresh = pullRefresh;
