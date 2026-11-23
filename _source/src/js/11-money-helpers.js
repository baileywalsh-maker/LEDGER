// ============================================================
// Money helpers
// ============================================================
const CURRENCIES = {
  GBP:{sym:'£', name:'British pound'},   AUD:{sym:'A$', name:'Australian dollar'},
  EUR:{sym:'€', name:'Euro'},            USD:{sym:'$', name:'US dollar'},
  NZD:{sym:'NZ$',name:'New Zealand dollar'}, CAD:{sym:'C$', name:'Canadian dollar'},
  CHF:{sym:'CHF ',name:'Swiss franc'},   JPY:{sym:'¥', name:'Japanese yen'},
  SEK:{sym:'kr ', name:'Swedish krona'}, NOK:{sym:'kr ', name:'Norwegian krone'},
  PLN:{sym:'zł ', name:'Polish z\u0142oty'}, SGD:{sym:'S$', name:'Singapore dollar'}
};
const curCode = ()=> settings.currency || 'GBP';
const curSym = ()=> (CURRENCIES[curCode()] || {sym:'£'}).sym;

// ---- secondary currency ----
// A read-only second opinion under each figure. settings.secondary holds
// {code, rate, rateDate, manual}. Stored amounts are never touched.
const secCode  = ()=> (settings.secondary && settings.secondary.code) || null;
const secRate  = ()=> (settings.secondary && Number(settings.secondary.rate)) || 0;
const secSym   = ()=> (CURRENCIES[secCode()] || {sym:''}).sym;
const secOn    = ()=> !!(secCode() && secRate() > 0 && secCode() !== curCode());

// `round` mirrors whichever formatter the main figure used, so you never see
// a rounded £43 sitting above an unrounded A$82.45.
function secAmount(n, round){
  if(!secOn()) return '';
  const v = Math.abs(n) * secRate();
  const digits = round ? 0 : 2;
  return (n < 0 ? '−' : '') + secSym() +
    v.toLocaleString('en-GB',{minimumFractionDigits:digits, maximumFractionDigits:digits});
}

// The figure with its secondary underneath. Used wherever a value is displayed
// as a block; inline places use secAmount() directly.
function moneyPair(n, opts){
  const o = opts || {};
  const main = o.round ? money0(n) : money(n);
  if(!secOn()) return main;
  return main + '<span class="sec">' + secAmount(n, !!o.round) + '</span>';
}
const moneyPair0 = n => moneyPair(n, {round:true});

// Rates drift. Say so rather than quietly showing months-old figures.
function secDaysOld(){
  if(!secOn() || !settings.secondary.rateDate) return 0;
  return Math.floor((parseYMD(todayYMD()) - parseYMD(settings.secondary.rateDate))/86400000);
}
function secDrift(){
  const d = secDaysOld();
  return d >= 30 ? ' · rate is ' + d + ' days old' : '';
}

const money = n=>{
  const neg = n < 0;
  const s = curSym() + Math.abs(n).toLocaleString('en-GB',{minimumFractionDigits:2, maximumFractionDigits:2});
  return neg ? '−'+s : s;
};
const money0 = n=>{
  const neg = n < 0;
  const s = curSym() + Math.round(Math.abs(n)).toLocaleString('en-GB');
  return neg ? '−'+s : s;
};
const catById = id => cats.find(c=>c.id===id) || {name:'Needs a category', colour:'#6b7684', kind:'spend'};
const acctById = id => accts.find(a=>a.id===id) || {name:'Unknown', type:'current'};

// An account's balance is its opening figure plus everything that has moved since.
// Transactions pointing at an account that no longer exists would otherwise sit
// in the totals invisibly. Nothing should be able to leave one behind, but the
// guard is cheap and the alternative is figures that cannot be explained.
function orphanTxns(){
  const ids = new Set(accts.map(a=>a.id));
  return txns.filter(t=> !ids.has(t.acct) || (t.dir==='transfer' && !ids.has(t.toAcct)));
}

// The starting balance is what the account held on its starting date, so only
// transactions from that date onward can move it. Anything older is already
// baked into the figure you typed — counting it again subtracts the same
// spending twice. Older transactions still count in full toward spending
// analysis; they just cannot rewrite a balance that already includes them.
/* v49: a correction you make to an account's balance is kept as a dated
   entry on the account - "on 9 Oct it was 37.50 less than Ledger thought" -
   rather than by rewriting the starting balance. Rewriting the start moved
   every past figure with it, so a month you had already closed off against a
   statement stopped matching. A dated correction only changes things from
   its date onward. It is not a transaction, so spending and income totals
   never see it. */
function acctAdj(a, upto){
  if(!a || !Array.isArray(a.adj)) return 0;
  const from = a.openingDate || '';
  let s = 0;
  a.adj.forEach(x=>{
    if(!x || !isFinite(Number(x.amount)) || !x.date) return;
    if(upto && x.date > upto) return;
    if(from && x.date < from) return;
    s += Number(x.amount);
  });
  return Math.round(s * 100) / 100;
}
// v56: one redraw asks for the same balances many times over (the hero, the
// accounts list, freedom, the check-in chip...). While a redraw is running,
// each answer is worked out once and reused; outside a redraw nothing is
// remembered, so a figure can never be stale.
let memoDepth = 0, memoStore = null;
function memo(key, fn){
  if(!memoDepth) return fn();
  if(key in memoStore) return memoStore[key];
  return (memoStore[key] = fn());
}
function memoBegin(){ if(++memoDepth === 1) memoStore = Object.create(null); }
function memoEnd(){ if(--memoDepth <= 0){ memoDepth = 0; memoStore = null; } }
// Every account's balance in ONE pass over the transactions, optionally only
// up to a date. Same rules as before: nothing before an account's start
// counts, dated corrections apply from their date.
function allBalances(upto){
  const info = {}, bal = {};
  for(const a of accts){
    const from = a.openingDate ? ymd(parseYMD(a.openingDate)) : null;
    const live = !(upto && a.openingDate && a.openingDate > upto);
    info[a.id] = {from, live};
    bal[a.id] = live ? (Number(a.opening)||0) + acctAdj(a, upto) : 0;
  }
  for(const t of txns){
    if(upto && t.date > upto) continue;
    const A = info[t.acct];
    if(A && A.live && !(A.from && t.date < A.from)){
      if(t.dir==='in') bal[t.acct] += t.amount;
      else if(t.dir==='out' || t.dir==='transfer') bal[t.acct] -= t.amount;
    }
    if(t.dir==='transfer'){
      const B = info[t.toAcct];
      if(B && B.live && !(B.from && t.date < B.from)) bal[t.toAcct] += t.amount;
    }
  }
  return bal;
}
function acctBalance(id){
  const b = memo('bal', ()=> allBalances(null));
  return (id in b) ? b[id] : 0;
}

// How many transactions sit before an account's starting date. Shown in the
// UI so the exclusion is never silent.
function preOpeningCount(id){
  const a = accts.find(x=>x.id===id);
  if(!a || !a.openingDate) return 0;
  const from = parseYMD(a.openingDate);
  return txns.filter(t=>(t.acct===id || t.toAcct===id) && parseYMD(t.date) < from).length;
}
// Spending money only. Trading capital is working capital, not savings — see the note in Accounts.
const liquidTotal = ()=> accts.filter(a=>a.type!=='trading').reduce((s,a)=>s+acctBalance(a.id),0);
const tradingTotal = ()=> accts.filter(a=>a.type==='trading').reduce((s,a)=>s+acctBalance(a.id),0);

// ---- net worth, as it stood on a given day ----
// Trading capital counts here. It is kept separate on the Ledger screen
// because it is not SPENDING money, not because it is not yours.
function acctBalanceAt(id, upto){
  const b = memo('balAt:'+upto, ()=> allBalances(upto));
  return (id in b) ? b[id] : 0;
}
// An asset is worth its last reading on or before the date. Before the first
// reading it is worth what had been put into it by then — never more, because
// a gain that has not been measured has not happened.
function assetValueAt(a, upto){
  if(a.initialDate && a.initialDate > upto) return 0;
  const vs = (a.values||[]).filter(v=>v.date <= upto);
  if(vs.length) return Number(vs[vs.length-1].value)||0;
  return (Number(a.initial)||0) +
         (a.contribs||[]).filter(c=>c.date <= upto).reduce((t,c)=>t+(Number(c.amount)||0),0);
}
function netWorthAt(upto){
  return accts.reduce((t,a)=>t+acctBalanceAt(a.id, upto), 0) +
         assets.reduce((t,a)=>t+(a.covered || a.movedTo ? 0 : assetValueAt(a, upto)), 0) +
         invValueAt(upto);
}
// The first day Ledger knows anything at all. Nothing before it is drawn,
// because a flat line back to 2019 is a made-up line.
function netWorthStart(){
  const days = [];
  accts.forEach(a=>{ if(a.openingDate) days.push(a.openingDate); });
  assets.forEach(a=>{ if(a.initialDate) days.push(a.initialDate); });
  txns.forEach(t=>{ if(t.date) days.push(t.date); });
  const fi = invFirstDay(); if(fi) days.push(fi);
  return days.length ? days.reduce((a,b)=> a<b ? a : b) : null;
}
// Month-end points up to today, newest last. Capped so the line stays legible.
const NW_MAX_MONTHS = 18;
function netWorthSeries(){
  const start = netWorthStart();
  if(!start) return [];
  const today = new Date(); today.setHours(0,0,0,0);
  const first = parseYMD(start);
  const out = [];
  let d = new Date(first.getFullYear(), first.getMonth(), 1);
  while(d <= today && out.length < 400){
    const endOfMonth = new Date(d.getFullYear(), d.getMonth()+1, 0);
    const day = endOfMonth > today ? today : endOfMonth;
    out.push({ month: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),
               date: ymd(day), value: netWorthAt(ymd(day)) });
    d = new Date(d.getFullYear(), d.getMonth()+1, 1);
  }
  return out.slice(-NW_MAX_MONTHS);
}

// The freedom number. £250k with full autonomy is the benchmark; it is a
// setting because a benchmark you cannot change is somebody else's.
const FREEDOM_DEFAULT = 250000;
const FREEDOM_MIN = 1000, FREEDOM_MAX = 100000000;
function freedomTarget(){
  const v = Number(settings.freedom);
  return (v >= FREEDOM_MIN && v <= FREEDOM_MAX) ? v : FREEDOM_DEFAULT;
}
// The rate over the last N months of REAL data. Below three months there is
// no rate, there is noise — the same rule as refusing a verdict on a trading
// strategy with twelve trades.
const NW_MIN_MONTHS = 4;   // 4 points = 3 months of change
function netWorthRate(series, months){
  if(!series || series.length < 2) return null;
  const n = Math.min(months, series.length - 1);
  const from = series[series.length - 1 - n], to = series[series.length - 1];
  if(!from || !to) return null;
  return (to.value - from.value) / n;
}
// Years to the target at that rate. Null means "not knowable", which is a
// real answer and gets said out loud rather than rounded to something.
function yearsToTarget(now, rate, target){
  if(!(rate > 0)) return null;
  if(now >= target) return 0;
  return (target - now) / rate / 12;
}

// ---- assets ----
const assetInvested = a => (Number(a.initial)||0) + (a.contribs||[]).reduce((s,c)=>s+c.amount,0);
const assetValue = a =>{
  const v = a.values||[];
  return v.length ? v[v.length-1].value : assetInvested(a);
};
// v57: "assets" = what you logged by hand + Crypto + Stocks. A hand-logged
// asset marked as covered by Crypto or Stocks is kept but not counted twice.
// v59: a hand-logged asset that has been moved into an investment category
// (movedTo) or marked as already in one (covered) is kept, never counted.
const manualAssets = ()=> assets.filter(a=> !a.covered && !a.movedTo);
const assetsValue = ()=> manualAssets().reduce((s,a)=>s+assetValue(a),0) + invTotals().value;
const assetsInvested = ()=> manualAssets().reduce((s,a)=>s+assetInvested(a),0) + invTotals().putIn;
const hasAssets = ()=> assets.length > 0 || invAny();

// A recurring item is a FORECAST, not a transaction. It never adds money movement
// on its own — the real spend arrives when you import the statement. Otherwise
// every subscription would be counted twice.
const PER_MONTH = {weekly: 52/12, fortnightly: 26/12, monthly: 1, quarterly: 1/3, yearly: 1/12};
// "Every N days" is a fixed gap, not a calendar month. A 28-day cycle drifts
// backwards through the month and the due date has to drift with it, which
// calendar-month arithmetic can never do.
const DAYS_MIN = 1, DAYS_MAX = 366, DAYS_DEFAULT = 30;
const AVG_MONTH_DAYS = 365.25 / 12;
function everyDays(r){
  const n = Math.round(Number(r && r.everyDays));
  return (n >= DAYS_MIN && n <= DAYS_MAX) ? n : DAYS_DEFAULT;
}
// One place that answers "how many days apart is this", so the match window,
// the forecast and the step can never disagree.
function cadenceDays(r){
  if(r && r.cadence === 'days') return everyDays(r);
  return (r && CADENCE_DAYS[r.cadence]) || 30;
}
const recurMonthly = r => (Number(r.amount)||0) *
  (r && r.cadence === 'days' ? AVG_MONTH_DAYS / everyDays(r) : (PER_MONTH[r.cadence]||1));
const committedMonthly = ()=> recur.reduce((s,r)=>s+recurMonthly(r),0);

const CADENCE_DAYS = {weekly:7, fortnightly:14, monthly:30, quarterly:91, yearly:365};
function nextDueDate(r){
  // Roll the due date forward until it is in the future, so a missed week self-corrects.
  // The guard is generous because a 1-day item stale by a year needs 365 steps.
  let d = parseYMD(r.nextDue || todayYMD());
  const today = new Date(); today.setHours(0,0,0,0);
  let guard = 0;
  while(d < today && guard++ < 2000){ d = stepCadence(d, r.cadence, r.everyDays); }
  return d;
}
// One step of a cadence. The ONLY place a due date advances, so posting,
// forecasting and the countdown can never drift apart by stepping differently.
function stepCadence(d, cadence, days){
  if(cadence==='monthly')   return new Date(d.getFullYear(), d.getMonth()+1, d.getDate());
  if(cadence==='quarterly') return new Date(d.getFullYear(), d.getMonth()+3, d.getDate());
  if(cadence==='yearly')    return new Date(d.getFullYear()+1, d.getMonth(), d.getDate());
  if(cadence==='days')      return new Date(d.getTime() + everyDays({everyDays: days})*86400000);
  return new Date(d.getTime() + (CADENCE_DAYS[cadence]||30)*86400000);
}

// Every occurrence from the item's next due date up to and including today.
// Bounded: turning auto-post on must not invent a year of back-history, so it
// never reaches earlier than the item's own start.
const AUTOPOST_MAX_CATCHUP = 60;
function dueOccurrences(r, upto){
  const out = [];
  if(!r || r.autoPost === false) return out;
  let d = parseYMD(r.nextDue || todayYMD());
  const floor = parseYMD(r.created || r.nextDue || todayYMD());
  if(d < floor) d = floor;
  let guard = 0;
  while(d <= upto && guard++ < AUTOPOST_MAX_CATCHUP){
    out.push(ymd(d));
    d = stepCadence(d, r.cadence, r.everyDays);
  }
  return out;
}

// Post everything that has fallen due. Safe to call on every open: the
// (recurId, dueFor) check makes it idempotent, which is what stops the app
// posting the same charge again every time it is launched.
function runAutoPost(){
  if(settings.autoPost === false) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const posted = new Set(txns.filter(t=>t.recurId).map(t=>t.recurId+'|'+t.dueFor));
  const toPost = [];
  recur.forEach(r=>{
    if(r.autoPost === false) return;
    // Nothing to deduct from means nothing to do — silently, because an item
    // without an account is a forecast exactly as it always was.
    if(!r.acct || !accts.some(a=>a.id===r.acct)) return;
    dueOccurrences(r, today).forEach(day=>{
      if(posted.has(r.id+'|'+day)) return;
      posted.add(r.id+'|'+day);
      toPost.push({r, day});
    });
  });
  if(!toPost.length) return 0;

  snapshot('Post '+toPost.length+' scheduled charge'+(toPost.length===1?'':'s'));
  toPost.forEach(({r, day})=>{
    txns.push({
      id: uid(), date: day, amount: Math.abs(Number(r.amount)) || 0, dir: 'out',
      acct: r.acct, toAcct: null, desc: r.name, cat: r.cat || null,
      auto: true, recurId: r.id, dueFor: day
    });
  });
  // Move each item's forecast past the last date posted, so the "next due"
  // shown on the dashboard is genuinely next and not the one just taken.
  const lastFor = {};
  toPost.forEach(({r, day})=>{ if(!lastFor[r.id] || day > lastFor[r.id]) lastFor[r.id] = day; });
  recur = recur.map(r=> lastFor[r.id]
    ? {...r, nextDue: ymd(stepCadence(parseYMD(lastFor[r.id]), r.cadence, r.everyDays))}
    : r);

  save(K.txns, txns); save(K.recur, recur);
  return toPost.length;
}

// Posted charges still waiting to be seen on a statement. A cancelled
// subscription would otherwise quietly overstate spending forever.
function staleAutoTxns(days){
  const cut = ymd(new Date(Date.now() - (days||35)*86400000));
  return txns.filter(t=>t.auto && t.date < cut);
}

// An incoming statement row against a charge Ledger posted itself. The bank's
// version wins. Deliberately looser than the generic near-duplicate check: the
// recurId tells us what this is meant to be, so a price rise or a bank taking
// payment a week late should still match rather than land as a second charge.
// A subscription billed abroad is converted at the bank's rate on the day, not
// at the rate Ledger posted with, so the two figures never agree exactly and
// differ by a different amount every month. Demanding an exact match is what let
// those double up.
const AUTO_AMOUNT_TOLERANCE = 0.20;

// Does an incoming row name the same merchant as a subscription? Requiring every
// word was too strict: "Spotify Premium" never matched a statement saying
// "SPOTIFY AB". One distinctive word agreeing is the real signal.
function merchantAgrees(key, incoming){
  if(!key || key.length < 3) return false;
  const hay = (String(incoming.desc||'') + ' ' + String(incoming.note||'')).toLowerCase();
  const words = key.split(' ').filter(w=>w.length >= 4);
  if(!words.length){
    // Nothing distinctive to go on — fall back to the whole key.
    return hay.indexOf(key) >= 0;
  }
  return words.some(w => hay.indexOf(w) >= 0);
}

// How far apart a posted charge and its real counterpart may sit. Generous,
// because banks take payment when they feel like it — but never so generous that
// it could reach the NEXT occurrence, which would silently delete a real charge.
function autoWindowDays(r){
  const cad = r ? cadenceDays(r) : 30;
  /* Banks are later than you would think - a card payment taken on the 1st can
     settle on the 14th - so this reaches further than it did. Still well short
     of half a cycle, which is the line that stops it swallowing the NEXT
     month's charge and deleting a real one. */
  return Math.max(3, Math.min(14, Math.floor(cad * 0.45)));
}

function findAutoMatches(incoming){
  const autos = txns.filter(t=>t.auto);
  if(!autos.length) return [];
  const used = new Set();
  const pairs = [];
  for(const inc of incoming){
    if(inc.dir !== 'out') continue;
    // Best candidate, not merely the first: with two posted charges in range the
    // nearer one in date is the one this row actually represents.
    let best = null, bestGap = Infinity;
    for(const a of autos){
      if(used.has(a.id)) continue;
      /* Same account, or an account missing on one side. A row imported before
         accounts were set up, or a subscription without one, is still the same
         charge - and refusing to match it was one of the ways a double-up
         survived. */
      if(a.acct && inc.acct && a.acct !== inc.acct) continue;
      const r = recur.find(x=>x.id === a.recurId);
      const gap = Math.abs(parseYMD(a.date) - parseYMD(inc.date)) / 86400000;
      if(gap > autoWindowDays(r)) continue;

      const key = r ? merchantKey(r.match || r.name) : merchantKey(a.desc);
      const sameMerchant = merchantAgrees(key, inc);
      const exact = Math.abs(a.amount - inc.amount) < 0.005;
      const close = a.amount > 0 &&
        Math.abs(a.amount - inc.amount) / a.amount <= AUTO_AMOUNT_TOLERANCE;
      /* The merchant has to agree. An exact amount used to be enough on its
         own, which meant a £11.99 shop on the day Spotify was posted could
         stand in for Spotify - the posted charge vanished, the shop was filed
         as the subscription, and the subscription itself was never recorded.
         A coincidence of pennies is not evidence. The one exception is a
         posted charge with nothing to match on, where the amount and the date
         are genuinely all there is. */
      const noKey = !key || key.length < 3;
      if(!(sameMerchant ? (exact || close) : (noKey && exact))) continue;

      if(gap < bestGap){ best = a; bestGap = gap; }
    }
    if(best){ used.add(best.id); pairs.push({auto:best, incoming:inc}); }
  }
  return pairs;
}

/* Reconciling, continuously.

   The import already replaced a posted charge with the statement row that
   matched it. The trouble was that import was the ONLY place it happened: a
   transaction typed in by hand, pulled in by a different route, or kept by the
   duplicate resolver left the posted charge sitting beside it, and the month
   counted the subscription twice.

   This runs on every open instead. A posted charge is provisional by
   definition, so the moment something real stands in its place it goes - and
   because the test is the same findAutoMatches() the import uses, the two can
   never disagree about what counts as the same charge. */
function reconcileAutoPosted(){
  const autos = txns.filter(t=>t.auto);
  if(!autos.length) return 0;
  // Everything that is NOT a charge Ledger posted itself is a candidate for
  // being the real version of one.
  const real = txns.filter(t=>!t.auto && t.dir === 'out');
  if(!real.length) return 0;
  const pairs = findAutoMatches(real);
  if(!pairs.length) return 0;
  const drop = new Set(pairs.map(p=>p.auto.id));
  txns = txns.filter(t=>!drop.has(t.id));
  save(K.txns, txns);
  return drop.size;
}

function dueWithin(days){
  const today = new Date(); today.setHours(0,0,0,0);
  const limit = new Date(today.getTime() + days*86400000);
  return recur.filter(r=>{ const d = nextDueDate(r); return d >= today && d <= limit; })
              .sort((a,b)=> nextDueDate(a) - nextDueDate(b));
}
// Compare what you recorded against what actually left the account.
function recurActual(r){
  const key = String(r.match || r.name).toLowerCase();
  if(!key) return null;
  const hits = txns.filter(t=> t.dir==='out' && String(t.desc||'').toLowerCase().includes(key))
                   .sort((a,b)=>b.date.localeCompare(a.date));
  return hits.length ? hits[0] : null;
}

const monthKey = d => ymd(d).slice(0,7);
function txnsInMonth(mk){ return txns.filter(t=>t.date.slice(0,7)===mk); }
// Delegates to periodTotals so a month figure can never disagree with the same
// month shown as a period card. Previously these were two separate loops.
function monthTotals(mk){
  const [y,m] = mk.split('-').map(Number);
  return periodTotals(new Date(y, m-1, 1), new Date(y, m, 0));
}
