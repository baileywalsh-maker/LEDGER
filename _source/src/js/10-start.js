// ============================================================
// Storage
// ============================================================
const K = {
  accts:'ledger:accounts', txns:'ledger:txns', cats:'ledger:cats',
  rules:'ledger:rules', assets:'ledger:assets', settings:'ledger:settings',
  impmap:'ledger:importmap', recur:'ledger:recurring', budgets:'ledger:budgets'
};
const load = (k, fb)=>{ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }catch(e){ return fb; } };
/* v49: the undo history keeps up to ten full copies of everything, and on a
   phone's small storage allowance that can be what fills it - at which point
   the change you just made is the thing that fails to save. Now, when a save
   is refused, the oldest undo steps are dropped one at a time to make room,
   and only if that is not enough do you see the warning. */
const save = (k, v)=>{
  // v66: stamping and the sync timer live here, the one place every save
  // passes through. Both are no-ops while sync is off. Guarded: save()
  // also runs while the app is loading, before the sync section below
  // has run, so a failure here must never stop a save.
  try{ syncStampForSave(k, v); }catch(e){}
  try{ syncSoon(); }catch(e){}
  const text = JSON.stringify(v);
  try{ localStorage.setItem(k, text); return true; }catch(e){}
  // v58: the saved daily prices are only a cache - they go first.
  try{ if(k !== 'ledger:invpx' && localStorage.getItem('ledger:invpx')){ localStorage.removeItem('ledger:invpx'); localStorage.setItem(k, text); return true; } }catch(e){}
  try{
    let stack = JSON.parse(localStorage.getItem('ledger:rollback'));
    stack = Array.isArray(stack) ? stack : (stack ? [stack] : []);
    while(stack.length){
      stack.shift();
      try{
        if(stack.length) localStorage.setItem('ledger:rollback', JSON.stringify(stack));
        else localStorage.removeItem('ledger:rollback');
      }catch(e2){ continue; }
      try{ localStorage.setItem(k, text); return true; }catch(e3){}
    }
  }catch(e){}
  alert('Could not save. Your device storage may be full.');
  return false;
};
const uid = ()=> Date.now().toString(36) + Math.random().toString(36).slice(2,7);


// =====================================================================
// Sync with Muse — v66. Opt-in, off by default. Mirrors Jot's sync (v35).
// ---------------------------------------------------------------------
// How it works: your money is copied to ONE file, ledger-sync.json, in a
// PRIVATE repo (baileywalsh-maker/ledger-sync) that only you can see.
// Muse reads and writes that same file. Your phone and Muse never talk
// to each other directly — the private repo is the meeting point.
// - What syncs: transactions, monthly budgets, categories, sort rules,
//   accounts, hand-logged assets, subscriptions/bills, investments
//   (trades, investment categories, tracked-by-value flags) and the
//   remembered CSV column mapping. That is the whole Ledger, so the
//   file Muse sees is the Ledger you see.
// - What NEVER syncs, and never leaves this phone:
//   · the live price caches (ledger:invpx and invest.prices — fetched
//     again from the price feed, so there is nothing to lose);
//   · settings (display currency, Freedom targets, dismissals —
//     this phone's preferences, not your money);
//   · the undo stack (ledger:rollback), the pre-migration copy
//     (ledger:premigrate), the backup marker (ledger:lastbackupday);
//   · COACH's half of the shared backup (ledger:carry — COACH gets
//     its own sync later, Ledger is not a pipe for it);
//   · the sync token and the sync state below.
//   Ledger never holds bank logins or credentials at all — money only
//   arrives as a CSV you download yourself — so there is nothing of
//   that kind to leak. What does leave the phone is your transactions
//   and balances, to a private repo only you and Muse can see. That is
//   the same trust level as the phone itself.
// - The token that lets this phone write to the private repo is typed
//   in by you in Settings → Your data → Sync with Muse. It lives ONLY
//   in this phone's storage ('ledger:sync-token'), is never written
//   into a backup, never put in the app's code, and is only ever sent
//   to api.github.com. Make it a fine-grained token that can only
//   read/write the ledger-sync repo, and revoke it in GitHub any time
//   to stop syncing.
// - Merge: each side remembers what the data looked like at the last
//   successful sync (a snapshot). Something changed on one side only
//   is taken from that side; something added on either side is kept;
//   something deleted on one side and unchanged on the other is
//   deleted. Something changed on BOTH sides keeps the newer copy for
//   transactions and investment trades (each carries an `upd` stamp,
//   set in save() below whenever sync is on), and keeps this phone's
//   copy for everything else — and Settings says so. Nothing is ever
//   deleted silently without that rule.
// - Placement: this section sits right after save(), before any data
//   is loaded, on purpose. save() calls syncStampForSave() and
//   syncSoon(), and the first save happens while the app is loading —
//   so every sync variable here must already exist by then. Do not
//   move this section further down the file.
// =====================================================================
const SYNC_OWNER = 'baileywalsh-maker';
const SYNC_REPO = 'ledger-sync';
const SYNC_PATH = 'ledger-sync.json';
const SYNC_API = 'https://api.github.com/repos/' + SYNC_OWNER + '/' + SYNC_REPO + '/contents/' + SYNC_PATH;
const SYNC_KEY = 'ledger:sync';          // sync state (snapshot, version) — not a backup
const SYNC_TOKEN_KEY = 'ledger:sync-token'; // the token — never in a backup, never in code
const SYNC_INV_KEY = 'ledger:invest';
let syncBusy = false, syncSoonTimer = null, syncApplying = false;
let _updPrevTxns = null, _updPrevTrades = null;   // id -> hash, for stamping upd on change

function syncHash(s){
  let h = 5381;
  s = String(s);
  for(let i = 0; i < s.length; i++){ h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
  return h.toString(36);
}
function syncItemHash(n){ return syncHash(JSON.stringify(n)); }
// settings is still in its temporal dead zone while the app loads, and this
// is called from save() during that load — so a miss here means "off".
function syncEnabled(){
  try{ return !!(typeof settings !== 'undefined' && settings && settings.syncEnabled); }
  catch(e){ return false; }
}
function syncState(){
  const s = load(SYNC_KEY, null);
  return s && typeof s === 'object' ? s : {version:0, sha:null, snapshot:null, lastSync:null, lastError:null, conflicts:[]};
}
function syncSaveState(s){ try{ localStorage.setItem(SYNC_KEY, JSON.stringify(s)); }catch(e){} }
function syncToken(){ try{ const v = localStorage.getItem(SYNC_TOKEN_KEY); return v ? JSON.parse(v) : null; }catch(e){ return null; } }
function syncSetToken(t){
  try{
    if(t) localStorage.setItem(SYNC_TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(SYNC_TOKEN_KEY);
    return true;
  }catch(e){ return false; }
}
// The investment half of the file: trades, investment categories and the
// tracked-by-value flags. invest.prices is a live-price cache and is
// deliberately left out — it is rebuilt from the price feed.
function syncInvestPack(inv){
  inv = inv || {};
  return {
    trades: Array.isArray(inv.trades) ? inv.trades : [],
    cats: Array.isArray(inv.cats) ? inv.cats : [],
    byValue: (inv.byValue && typeof inv.byValue === 'object') ? inv.byValue : {}
  };
}
function syncSnapOf(pack){
  const snap = {txns:{}, budgets:{}, cats:{}, rules:'', accts:{}, assets:{}, recur:{},
    invest:{trades:{}, cats:{}, byValue:{}}, impmap:''};
  const byId = (list, into)=>{ (list || []).forEach(n=>{ if(n && n.id) into[n.id] = syncItemHash(n); }); };
  // Maps are snapshotted per key, so the merge can tell which side changed
  // which key — a whole-map hash could not.
  const byKey = (map, into)=>{ Object.keys(map || {}).forEach(k=>{ into[k] = syncHash(JSON.stringify(map[k])); }); };
  byId(pack.txns, snap.txns);
  byId(pack.cats, snap.cats);
  byId(pack.accts, snap.accts);
  byId(pack.assets, snap.assets);
  byId(pack.recur, snap.recur);
  byId(pack.invest && pack.invest.trades, snap.invest.trades);
  byId(pack.invest && pack.invest.cats, snap.invest.cats);
  byKey(pack.budgets, snap.budgets);
  byKey(pack.invest && pack.invest.byValue, snap.invest.byValue);
  snap.rules = syncHash(JSON.stringify(pack.rules || []));
  snap.impmap = syncHash(JSON.stringify(pack.impmap || null));
  return snap;
}
function syncPackLocal(){
  const st = syncState();
  let impmap = null;
  try{ impmap = JSON.parse(localStorage.getItem(K.impmap)); }catch(e){ impmap = null; }
  return {
    __ledgerSync: 1, version: (st.version || 0) + 1,
    updatedAt: new Date().toISOString(), updatedBy: 'phone',
    schema: (typeof SCHEMA !== 'undefined' ? SCHEMA : 1),
    txns: txns, budgets: budgets, cats: cats, rules: rules,
    accts: accts, assets: assets, recur: recur,
    invest: syncInvestPack(typeof invest !== 'undefined' ? invest : null),
    impmap: impmap
  };
}
// Every transaction / trade change is stamped with when it changed, so an
// entry edited on both sides can keep the newer copy. Stamping happens
// here, in the one place every save passes through — not in each button
// handler. Only while sync is on: with sync off this costs nothing and
// changes nothing.
function syncStampList(v, prev){
  const now = Date.now();
  if(!prev){
    prev = {};
    v.forEach(n=>{ if(n && n.id) prev[n.id] = syncItemHash(n); });
    return prev;
  }
  v.forEach(n=>{
    if(!n || !n.id) return;
    const h = syncItemHash(n);
    if(prev[n.id] !== h){ n.upd = now; prev[n.id] = syncItemHash(n); }
  });
  Object.keys(prev).forEach(id=>{ if(!v.some(n=>n && n.id === id)) delete prev[id]; });
  return prev;
}
function syncStampForSave(k, v){
  if(syncApplying || !syncEnabled()) return;
  if(k === K.txns && Array.isArray(v)) _updPrevTxns = syncStampList(v, _updPrevTxns);
  if(k === SYNC_INV_KEY && v && Array.isArray(v.trades)) _updPrevTrades = syncStampList(v.trades, _updPrevTrades);
}
// Three-way merge for one list of records with stable ids. useUpd picks the
// newer copy when both sides changed (transactions, trades); without it the
// phone's copy wins and the clash is reported.
function syncMergeList(local, remote, snap, useUpd, label){
  snap = snap || {};
  const conflicts = [];
  const byId = {};
  (local || []).forEach(n=>{ if(n && n.id) (byId[n.id] = byId[n.id] || {}).local = n; });
  (remote || []).forEach(n=>{ if(n && n.id) (byId[n.id] = byId[n.id] || {}).remote = n; });
  const merged = [];
  Object.keys(byId).forEach(id=>{
    const e = byId[id], inSnap = snap[id];
    const lHash = e.local ? syncItemHash(e.local) : null;
    const rHash = e.remote ? syncItemHash(e.remote) : null;
    const name = String((e.local && (e.local.desc || e.local.name)) || (e.remote && (e.remote.desc || e.remote.name)) || id).slice(0, 40);
    if(e.local && !e.remote){
      if(!inSnap){ merged.push(e.local); return; }                        // added here
      if(lHash !== inSnap){ merged.push(e.local); conflicts.push('Kept your newer copy of “' + name + '” — it was deleted in the synced copy.'); return; }
      return;                                                             // deleted over there, unchanged here
    }
    if(e.remote && !e.local){
      if(!inSnap){ merged.push(e.remote); return; }                       // added over there
      if(rHash !== inSnap){ merged.push(e.remote); conflicts.push('Kept the synced copy of “' + name + '” — it was deleted on this phone.'); return; }
      return;                                                             // deleted here, unchanged over there
    }
    if(lHash === rHash){ merged.push(e.local); return; }
    const lChanged = inSnap && lHash !== inSnap, rChanged = inSnap && rHash !== inSnap;
    if(lChanged && !rChanged){ merged.push(e.local); return; }
    if(rChanged && !lChanged){ merged.push(e.remote); return; }
    if(!inSnap){ merged.push(e.local); return; }                          // both added it: same id, keep this phone's
    if(useUpd){
      const lUpd = (e.local.upd || 0), rUpd = (e.remote.upd || 0);
      const pick = rUpd > lUpd ? e.remote : e.local;
      merged.push(pick);
      conflicts.push('“' + name + '” was changed in both places — kept the newer copy.');
    }else{
      merged.push(e.local);
      conflicts.push('“' + name + '” was changed in both places — kept this phone’s copy.');
    }
  });
  return {list: merged, conflicts: conflicts};
}
// Three-way merge for one flat map (budgets, tracked-by-value flags),
// against the per-key snapshot hashes. A key changed on one side only
// is taken from that side; changed on both keeps this phone's and says so.
function syncMergeMap(local, remote, snap, label){
  local = local || {}; remote = remote || {}; snap = snap || {};
  const conflicts = [];
  const out = {};
  const keys = {};
  Object.keys(local).forEach(k=>{ keys[k] = 1; });
  Object.keys(remote).forEach(k=>{ keys[k] = 1; });
  Object.keys(keys).forEach(k=>{
    const inL = Object.prototype.hasOwnProperty.call(local, k);
    const inR = Object.prototype.hasOwnProperty.call(remote, k);
    const inSnap = Object.prototype.hasOwnProperty.call(snap, k);
    const lHash = inL ? syncHash(JSON.stringify(local[k])) : null;
    const rHash = inR ? syncHash(JSON.stringify(remote[k])) : null;
    if(inL && !inR){
      if(!inSnap){ out[k] = local[k]; return; }                          // added here
      if(lHash !== snap[k]){ out[k] = local[k]; conflicts.push('Kept your newer ' + label + ' for “' + String(k).slice(0, 40) + '” — it was deleted in the synced copy.'); return; }
      return;                                                            // deleted over there, unchanged here
    }
    if(inR && !inL){
      if(!inSnap){ out[k] = remote[k]; return; }                         // added over there
      if(rHash !== snap[k]){ out[k] = remote[k]; conflicts.push('Kept the synced ' + label + ' for “' + String(k).slice(0, 40) + '” — it was deleted on this phone.'); return; }
      return;                                                            // deleted here, unchanged over there
    }
    if(lHash === rHash){ out[k] = local[k]; return; }
    const lChanged = inSnap && lHash !== snap[k], rChanged = inSnap && rHash !== snap[k];
    if(lChanged && !rChanged){ out[k] = local[k]; return; }
    if(rChanged && !lChanged){ out[k] = remote[k]; return; }
    out[k] = local[k];
    conflicts.push('The ' + label + ' for “' + String(k).slice(0, 40) + '” was changed in both places — kept this phone’s.');
  });
  return {map: out, conflicts: conflicts};
}
// Rules are {match, cat} rows, keyed by the match text.
function syncMergeRules(local, remote, snapHash){
  const toMap = list=>{
    const m = {};
    (list || []).forEach(r=>{ if(r && r.match) m[String(r.match).toLowerCase()] = r; });
    return m;
  };
  const merged = syncMergeMap(toMap(local), toMap(remote), snapHash, 'rule');
  return {list: Object.keys(merged.map).map(k=> merged.map[k]), conflicts: merged.conflicts};
}
// Three-way merge: local (this phone) vs remote (the private repo),
// against the snapshot from the last good sync. Returns {pack, conflicts}.
function syncMerge(local, remote, snap){
  snap = snap || {txns:{}, budgets:{}, cats:{}, rules:'', accts:{}, assets:{}, recur:{},
    invest:{trades:{}, cats:{}, byValue:{}}, impmap:''};
  const conflicts = [];
  const mTxns = syncMergeList(local.txns, remote.txns, snap.txns, true, 'transaction');
  const mCats = syncMergeList(local.cats, remote.cats, snap.cats, false, 'category');
  const mAccts = syncMergeList(local.accts, remote.accts, snap.accts, false, 'account');
  const mAssets = syncMergeList(local.assets, remote.assets, snap.assets, false, 'asset');
  const mRecur = syncMergeList(local.recur, remote.recur, snap.recur, false, 'subscription');
  const mTrades = syncMergeList(local.invest && local.invest.trades, remote.invest && remote.invest.trades, snap.invest && snap.invest.trades, true, 'investment entry');
  const mInvCats = syncMergeList(local.invest && local.invest.cats, remote.invest && remote.invest.cats, snap.invest && snap.invest.cats, false, 'investment category');
  const mBudgets = syncMergeMap(local.budgets, remote.budgets, snap.budgets, 'budget');
  const mByValue = syncMergeMap(local.invest && local.invest.byValue, remote.invest && remote.invest.byValue, snap.invest && snap.invest.byValue, 'tracked-by-value flag');
  const mRules = syncMergeRules(local.rules, remote.rules, snap.rules);
  conflicts.push.apply(conflicts, mTxns.conflicts.concat(mCats.conflicts, mAccts.conflicts,
    mAssets.conflicts, mRecur.conflicts, mTrades.conflicts, mInvCats.conflicts,
    mBudgets.conflicts, mByValue.conflicts, mRules.conflicts));
  // The column mapping is one small object: changed on one side wins,
  // changed on both keeps this phone's. Missing on a side means "never
  // set there", not a change — so the first sync never reports a clash.
  let impmap = local.impmap;
  if(local.impmap == null && remote.impmap != null) impmap = remote.impmap;
  else if(local.impmap != null && remote.impmap != null &&
      JSON.stringify(local.impmap) !== JSON.stringify(remote.impmap)){
    const lChanged = syncHash(JSON.stringify(local.impmap)) !== snap.impmap;
    const rChanged = syncHash(JSON.stringify(remote.impmap)) !== snap.impmap;
    if(rChanged && !lChanged) impmap = remote.impmap;
    else if(lChanged && rChanged) conflicts.push('The remembered CSV columns were changed in both places — kept this phone’s.');
  }
  return {
    pack: {
      __ledgerSync: 1, version: Math.max(local.version || 0, remote.version || 0) + 1,
      updatedAt: new Date().toISOString(), updatedBy: 'phone',
      schema: local.schema || remote.schema || 1,
      txns: mTxns.list, budgets: mBudgets.map, cats: mCats.list, rules: mRules.list,
      accts: mAccts.list, assets: mAssets.list, recur: mRecur.list,
      invest: {trades: mTrades.list, cats: mInvCats.list, byValue: mByValue.map},
      impmap: impmap
    },
    conflicts: conflicts
  };
}
function syncApply(pack){
  syncApplying = true;
  try{
    txns = Array.isArray(pack.txns) ? pack.txns : txns;
    if(pack.budgets && typeof pack.budgets === 'object') budgets = pack.budgets;
    if(Array.isArray(pack.cats) && pack.cats.length) cats = pack.cats;
    if(Array.isArray(pack.rules)) rules = pack.rules;
    if(Array.isArray(pack.accts)) accts = pack.accts;
    if(Array.isArray(pack.assets)) assets = pack.assets;
    if(Array.isArray(pack.recur)) recur = pack.recur;
    if(pack.invest && typeof pack.invest === 'object'){
      // invest.prices stays exactly as it is on this phone — it is a
      // live-price cache, not synced data.
      const keepPrices = (typeof invest !== 'undefined' && invest && invest.prices) ? invest.prices : {};
      invest = {trades: Array.isArray(pack.invest.trades) ? pack.invest.trades : [],
        cats: Array.isArray(pack.invest.cats) ? pack.invest.cats : [],
        byValue: (pack.invest.byValue && typeof pack.invest.byValue === 'object') ? pack.invest.byValue : {},
        prices: keepPrices};
      try{ if(typeof sortTrades === 'function') sortTrades(); }catch(e){}
    }
    save(K.txns, txns); save(K.budgets, budgets); save(K.cats, cats); save(K.rules, rules);
    save(K.accts, accts); save(K.assets, assets); save(K.recur, recur); saveInvest();
    if(pack.impmap) save(K.impmap, pack.impmap);
    _updPrevTxns = {}; txns.forEach(n=>{ if(n && n.id) _updPrevTxns[n.id] = syncItemHash(n); });
    _updPrevTrades = {}; (invest.trades || []).forEach(n=>{ if(n && n.id) _updPrevTrades[n.id] = syncItemHash(n); });
  }finally{ syncApplying = false; }
}
async function syncFetch(token){
  let r;
  try{
    r = await fetch(SYNC_API, {headers:{'Authorization':'Bearer ' + token, 'Accept':'application/vnd.github+json'}, cache:'no-store'});
  }catch(e){ const err = new Error('offline'); err.code = 'offline'; throw err; }
  if(r.status === 404) return {pack:null, sha:null};
  if(r.status === 401 || r.status === 403){ const err = new Error('auth'); err.code = 'auth'; throw err; }
  if(!r.ok){ const err = new Error('http ' + r.status); err.code = 'http'; throw err; }
  const d = await r.json();
  let pack = null;
  try{ pack = JSON.parse(decodeURIComponent(escape(atob(String(d.content || '').replace(/\n/g, ''))))); }catch(e){ pack = null; }
  if(!pack || pack.__ledgerSync !== 1){ const err = new Error('bad file'); err.code = 'badfile'; throw err; }
  return {pack: pack, sha: d.sha};
}
async function syncPut(token, pack, sha){
  const body = {message:'Ledger sync v' + pack.version + ' (' + pack.updatedBy + ')',
    content:btoa(unescape(encodeURIComponent(JSON.stringify(pack))))};
  if(sha) body.sha = sha;
  let r;
  try{
    r = await fetch(SYNC_API, {method:'PUT', headers:{'Authorization':'Bearer ' + token, 'Accept':'application/vnd.github+json', 'Content-Type':'application/json'}, body:JSON.stringify(body)});
  }catch(e){ const err = new Error('offline'); err.code = 'offline'; throw err; }
  if(r.status === 401 || r.status === 403){ const err = new Error('auth'); err.code = 'auth'; throw err; }
  if(r.status === 409){ const err = new Error('conflict'); err.code = 'conflict'; throw err; }
  if(!r.ok){ const err = new Error('http ' + r.status); err.code = 'http'; throw err; }
  const d = await r.json();
  return d.content && d.content.sha ? d.content.sha : sha;
}
function syncSnapEqual(a, b){
  if(!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
function syncLocalChanged(st){
  if(!st.snapshot) return true;
  const cur = syncSnapOf(syncPackLocal());
  return !syncSnapEqual(cur, st.snapshot);
}
function syncStatusText(){
  const st = syncState();
  if(!syncEnabled()) return 'Off — switch it on to let Muse help with your money';
  if(!syncToken()) return 'On, but no token yet — paste one below';
  if(st.lastError) return 'Last sync failed: ' + st.lastError;
  if(st.lastSync){
    const d = Math.floor((Date.now() - new Date(st.lastSync).getTime()) / 60000);
    const when = d < 1 ? 'just now' : d < 60 ? d + ' min ago' : Math.floor(d / 60) + 'h ago';
    return 'Last synced ' + when + (st.conflicts && st.conflicts.length ? ' — ' + st.conflicts.length + ' thing' + (st.conflicts.length > 1 ? 's' : '') + ' changed in both places, kept the newer copy' : '');
  }
  return 'On — not synced yet';
}
function paintSync(){
  const t = document.getElementById('t-sync'); if(!t) return;
  // Ledger's toggle is a chip button (On/Off text), like the sound toggles.
  t.textContent = syncEnabled() ? 'On' : 'Off';
  t.classList.toggle('on', syncEnabled());
  t.setAttribute('aria-checked', syncEnabled() ? 'true' : 'false');
  const setup = document.getElementById('sync-setup');
  if(setup) setup.style.display = syncEnabled() ? '' : 'none';
  const tok = document.getElementById('sync-token');
  if(tok && document.activeElement !== tok) tok.value = syncToken() || '';
  const stEl = document.getElementById('sync-state');
  if(stEl) stEl.textContent = syncStatusText();
  const cfEl = document.getElementById('sync-conflicts');
  if(cfEl){
    const st = syncState();
    cfEl.textContent = (st.conflicts && st.conflicts.length)
      ? st.conflicts.join(' ') : '';
    cfEl.style.display = (st.conflicts && st.conflicts.length) ? '' : 'none';
  }
}
// The main sync. Quiet when automatic (opening the app, leaving it);
// chatty when you tap Sync now. Returns a small result for tests.
async function syncNow(opts){
  opts = opts || {};
  if(syncBusy) return {ok:false, reason:'busy'};
  if(!syncEnabled()) return {ok:false, reason:'off'};
  const token = syncToken();
  if(!token){
    if(!opts.quiet) showToast('Add your sync token in Settings first');
    return {ok:false, reason:'notoken'};
  }
  syncBusy = true;
  const stEl = document.getElementById('sync-state');
  if(stEl) stEl.textContent = 'Syncing…';
  try{
    const st = syncState();
    let fetched;
    try{ fetched = await syncFetch(token); }
    catch(e){
      st.lastError = e.code === 'auth' ? 'GitHub did not accept the token — check it, or make a new one'
        : e.code === 'offline' ? 'No connection — try again when you are back online'
        : 'GitHub said no (' + e.message + ')';
      syncSaveState(st); paintSync();
      if(!opts.quiet) showToast(st.lastError);
      return {ok:false, reason:e.code};
    }
    const local = syncPackLocal();
    if(!fetched.pack){
      // First sync ever: this phone's Ledger becomes the synced copy.
      const sha = await syncPut(token, local, null);
      const ns = {version:local.version, sha:sha, snapshot:syncSnapOf(local), lastSync:new Date().toISOString(), lastError:null, conflicts:[]};
      syncSaveState(ns); paintSync(); render();
      if(!opts.quiet) showToast('Synced — ' + local.txns.length + ' transactions now shared with Muse');
      return {ok:true, pushed:local.txns.length, pulled:0, conflicts:[]};
    }
    const remote = fetched.pack;
    const localChanged = syncLocalChanged(st);
    // Changed remotely if the remote copy no longer matches the snapshot —
    // version numbers alone are not trusted, Muse may write any version.
    const remoteChanged = !st.snapshot || !syncSnapEqual(syncSnapOf(remote), st.snapshot);
    if(!localChanged && !remoteChanged){
      st.lastSync = new Date().toISOString(); st.lastError = null; syncSaveState(st); paintSync();
      if(!opts.quiet) showToast('Already up to date');
      return {ok:true, pushed:0, pulled:0, conflicts:[]};
    }
    let merged = syncMerge(local, remote, st.snapshot);
    let sha = fetched.sha, tries = 0;
    while(tries < 2){
      try{ sha = await syncPut(token, merged.pack, sha); break; }
      catch(e){
        if(e.code !== 'conflict' || tries) throw e;
        tries++;
        const again = await syncFetch(token);
        if(!again.pack) throw e;
        merged = syncMerge(syncPackLocal(), again.pack, st.snapshot);
        sha = again.sha;
      }
    }
    const before = txns.length;
    syncApply(merged.pack);
    const ns = {version:merged.pack.version, sha:sha, snapshot:syncSnapOf(merged.pack),
      lastSync:new Date().toISOString(), lastError:null, conflicts:merged.conflicts};
    syncSaveState(ns); paintSync(); render();
    const pulled = merged.pack.txns.length - before;
    if(!opts.quiet){
      showToast(merged.conflicts.length ? 'Synced — kept the newer copy of ' + merged.conflicts.length + ' thing' + (merged.conflicts.length > 1 ? 's' : '') + ' changed in both places'
        : pulled > 0 ? 'Synced — ' + pulled + ' transaction' + (pulled > 1 ? 's' : '') + ' came in from Muse'
        : 'Synced');
    }
    return {ok:true, pushed:localChanged ? 1 : 0, pulled:pulled, conflicts:merged.conflicts};
  }catch(e){
    const st = syncState();
    st.lastError = e.code === 'auth' ? 'GitHub did not accept the token — check it, or make a new one'
      : e.code === 'offline' ? 'No connection — try again when you are back online'
      : 'Sync failed (' + (e.message || 'unknown') + ')';
    syncSaveState(st); paintSync();
    if(!opts.quiet) showToast(st.lastError);
    return {ok:false, reason:e.code || 'error'};
  }finally{ syncBusy = false; }
}
function syncSoon(){
  if(syncApplying || !syncEnabled() || !syncToken()) return;
  clearTimeout(syncSoonTimer);
  syncSoonTimer = setTimeout(()=>{ syncNow({auto:true, quiet:true}); }, 8000);
}
// Settings wiring for sync. Runs at load; the Settings sheet exists by then.
document.getElementById('t-sync').onclick = ()=>{
  settings.syncEnabled = !syncEnabled(); save(K.settings, settings); paintSync();
  if(settings.syncEnabled && !syncToken()) showToast('Paste your sync token below, then tap Sync now');
  else if(settings.syncEnabled) syncNow({auto:true, quiet:true});
};
document.getElementById('sync-token').onchange = e=>{
  const v = e.target.value.trim();
  if(v){ syncSetToken(v); showToast('Token saved — it stays on this phone'); }
  else syncSetToken(null);
  paintSync();
};
document.getElementById('sync-now').onclick = ()=>{ syncNow({manual:true}); };
document.getElementById('sync-forget').onclick = ()=>{
  if(!confirm('Remove the sync token? Sync switches off too. Your money stays on this phone.')) return;
  syncSetToken(null); settings.syncEnabled = false; save(K.settings, settings);
  const st = syncState(); st.lastError = null; syncSaveState(st);
  paintSync(); showToast('Sync is off and the token is gone');
};
// For tests and for Muse's own checks — not a user feature.
window.__ledgerSync = {now:syncNow, merge:syncMerge, pack:syncPackLocal, state:syncState, apply:syncApply};
paintSync();
setTimeout(()=>{ if(syncEnabled()) syncNow({auto:true, quiet:true}); }, 2000);   // pull in anything Muse added, if sync is on
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) syncNow({auto:true, quiet:true}); });
window.addEventListener('online', ()=>{ syncNow({auto:true, quiet:true}); });

// Local calendar date — never toISOString(), which shifts to UTC and lands a day early in BST.
const ymd = d=>{ const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); };
const parseYMD = s=>{ const [y,m,d]=String(s).split('-').map(Number); return new Date(y,(m||1)-1,d||1); };
const todayYMD = ()=> ymd(new Date());

const DEFAULT_CATS = [
  {id:'groceries', name:'Groceries', kind:'spend', colour:'#4aa87a'},
  {id:'eatingout', name:'Eating out', kind:'spend', colour:'#d0574f'},
  {id:'transport', name:'Transport', kind:'spend', colour:'#5b8dd6'},
  {id:'rent', name:'Rent and bills', kind:'spend', colour:'#c9a227'},
  {id:'subs', name:'Subscriptions', kind:'spend', colour:'#9b6dd6'},
  {id:'shopping', name:'Shopping', kind:'spend', colour:'#d68b4a'},
  {id:'health', name:'Health and fitness', kind:'spend', colour:'#4ab5b0'},
  {id:'fun', name:'Going out', kind:'spend', colour:'#d64a8b'},
  {id:'other', name:'Other', kind:'spend', colour:'#6b7684'},
  {id:'income', name:'Income', kind:'income', colour:'#4aa87a'},
  {id:'trading', name:'Trading', kind:'income', colour:'#c9a227'},
  // Money arriving is not all earnings. A fuel station refunding the difference
  // is not income, and filing it as income overstates what you actually make —
  // which is the figure every other number in the app is measured against.
  {id:'refunds',   name:'Refunds',         kind:'income', colour:'#5b8dd6'},
  {id:'taxrebate', name:'Tax and rebates', kind:'income', colour:'#4ab5b0'},
  {id:'otherin',   name:'Other money in',  kind:'income', colour:'#8a94a6'},
  // Money between people is neither spending nor income. Filing a friend
  // paying you back as income, or your half of a bill as spending, distorts
  // every average built on top of them.
  {id:'transfers', name:'Transfers', kind:'transfer', colour:'#8a94a6'},
  // v64: money moved into (or back out of) your investments - Coinbase,
  // Pearler and the like. It is still yours, just somewhere else, so it is
  // never spending and never earnings. Added to existing phones by the merge below.
  {id:'invested',  name:'Investing', kind:'transfer', colour:'#d9b44a'}
];

let accts   = load(K.accts, []);
let txns    = load(K.txns, []);
let cats    = load(K.cats, DEFAULT_CATS);
// Categories are stored per install, so anything added to DEFAULT_CATS after
// the first run was invisible to an existing one. Append what is missing, by
// id, and touch nothing that has been renamed, recoloured or added by hand.
(function mergeDefaultCats(){
  const have = new Set(cats.map(c=>c.id));
  let added = false;
  for(const d of DEFAULT_CATS){ if(!have.has(d.id)){ cats.push(Object.assign({}, d)); added = true; } }
  if(added) save(K.cats, cats);
})();
let rules   = load(K.rules, []);
let assets  = load(K.assets, []);
let settings= load(K.settings, {lastBackup:null});
let recur   = load(K.recur, []);
let budgets = load(K.budgets, {});

// v57: investments (Crypto and Stocks) live in their own key, so nothing
// saved before is touched. Loaded here, before anything draws, because net
// worth counts them.
const K_INV = 'ledger:invest', K_INVPX = 'ledger:invpx';
let invest = (()=>{ try{ const v = JSON.parse(localStorage.getItem(K_INV)); return (v && typeof v==='object') ? v : null; }catch(e){ return null; } })()
  || {trades:[], prices:{}};
if(!Array.isArray(invest.trades)) invest.trades = [];
if(!invest.prices || typeof invest.prices !== 'object') invest.prices = {};
// In time order, to the second: a coin bought and sold on the same day must
// be bought first, or the sale would look like it came from nothing.
const tKey = t => (t.ts || (t.date+' 12:00:00'));
function sortTrades(){ invest.trades.sort((a,b)=> tKey(a) < tKey(b) ? -1 : tKey(a) > tKey(b) ? 1 : 0); }
function saveInvest(){ return save(K_INV, invest); }

// Daily closing prices, fetched once and kept: {usd:{SYM:{day:close}}, fx:{day:USD->GBP}}.
// A cache only - deleting it loses nothing, it is fetched again.
let invPx = (()=>{ try{ const v = JSON.parse(localStorage.getItem(K_INVPX)); return (v && typeof v==='object') ? v : null; }catch(e){ return null; } })() || {usd:{}, fx:{}};
if(!invPx.usd || typeof invPx.usd !== 'object') invPx.usd = {};
if(!invPx.fx || typeof invPx.fx !== 'object') invPx.fx = {};
function saveInvPx(){ try{ localStorage.setItem(K_INVPX, JSON.stringify(invPx)); }catch(e){ /* a cache: fetched again next time */ } }

// ------------------------------------------------------------
// v56: a data version, and one place where old or odd data is made safe.
//
// Every build so far has read whatever was on the phone by being careful in
// a hundred separate places. This puts a number on the shape of the data
// ('ledger:schema') and runs each step between that number and SCHEMA once,
// in order, on load. Steps only ever ADD or REPAIR - they never delete a
// record that can be read. A backup carries the number too, so restoring an
// old file runs the same steps.
//
// To change the shape later: bump SCHEMA, add MIGRATIONS[n] = d => {...}.
// ------------------------------------------------------------
const SCHEMA = 1, K_SCHEMA = 'ledger:schema';
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// Makes a data set safe to render. Returns what it had to do, so the caller
// can say so; touches nothing that is already fine.
function tidyData(d){
  const did = {reshaped:[], dropped:0, repaired:0};
  for(const k of ['accts','txns','rules','assets','recur']){
    if(!Array.isArray(d[k])){ if(d[k] != null) did.reshaped.push(k); d[k] = []; }
  }
  if(!Array.isArray(d.cats) || !d.cats.length){ if(d.cats != null && !Array.isArray(d.cats)) did.reshaped.push('cats'); d.cats = DEFAULT_CATS.map(c=>Object.assign({}, c)); }
  for(const k of ['settings','budgets']){
    if(!isObj(d[k])){ if(d[k] != null) did.reshaped.push(k); d[k] = {}; }
  }
  const dateOK = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
  const keep = [];
  for(const t of d.txns){
    if(!isObj(t) || !dateOK(t.date)){ did.dropped++; continue; }
    if(typeof t.amount !== 'number'){
      const n = Number(t.amount);
      if(!isFinite(n)){ did.dropped++; continue; }
      t.amount = n; did.repaired++;
    } else if(!isFinite(t.amount)){ did.dropped++; continue; }
    if(!t.id){ t.id = uid(); did.repaired++; }
    keep.push(t);
  }
  if(keep.length !== d.txns.length) d.txns = keep;
  const objs = a => a.filter(x=>{ const ok = isObj(x); if(!ok) did.dropped++; return ok; });
  for(const k of ['accts','assets','recur','rules','cats']){
    const f = objs(d[k]); if(f.length !== d[k].length) d[k] = f;
  }
  did.changed = !!(did.reshaped.length || did.dropped || did.repaired);
  return did;
}
const MIGRATIONS = {
  // 1: everything up to v55 had no number. Nothing changes shape; the data is
  //    checked once so a damaged record cannot stop the app opening.
  1: d => tidyData(d)
};
function migrateData(d, from){
  let changed = false;
  for(let n = (from|0) + 1; n <= SCHEMA; n++){
    const r = MIGRATIONS[n] ? MIGRATIONS[n](d) : null;
    if(r && r.changed) changed = true;
  }
  return changed;
}
(function migrateOnLoad(){
  let from = 0;
  try{ from = parseInt(localStorage.getItem(K_SCHEMA), 10) || 0; }catch(e){}
  if(from >= SCHEMA) return;           // up to date, or written by a newer build: leave it be
  const d = {accts, txns, cats, rules, assets, settings, recur, budgets};
  let changed = false;
  try{ changed = migrateData(d, from); }catch(e){ return; }   // never block opening
  if(changed){
    // Keep the untouched originals once, before anything is rewritten.
    try{
      if(!localStorage.getItem('ledger:premigrate')){
        const raw = {};
        Object.values(K).forEach(k=>{ const v = localStorage.getItem(k); if(v != null) raw[k] = v; });
        localStorage.setItem('ledger:premigrate', JSON.stringify({at:new Date().toISOString(), from, raw}));
      }
    }catch(e){}
    ({accts, txns, cats, rules, assets, settings, recur, budgets} = d);
    save(K.accts,accts); save(K.txns,txns); save(K.cats,cats); save(K.rules,rules);
    save(K.assets,assets); save(K.settings,settings); save(K.recur,recur); save(K.budgets,budgets);
  }
  try{ localStorage.setItem(K_SCHEMA, String(SCHEMA)); }catch(e){}
})();

// Sunday-anchored week: the week runs Sunday through Saturday, and the
// check-in is a Sunday routine.
function weekStart(d){
  const r = new Date(d);
  r.setHours(0,0,0,0);
  const day = r.getDay();             // Sunday = 0
  r.setDate(r.getDate() - day);
  return r;
}
