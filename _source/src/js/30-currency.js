// ============================================================
// Currency
// ============================================================
// Rates come from Frankfurter (European Central Bank reference rates, no key
// needed). They are published once each working day, so a weekend request
// returns Friday's rate — the response tells us which day it is actually from.
// Several independent providers, each with the shape it actually returns.
// The previous version called a Frankfurter endpoint that does not exist
// (/v2/rates), so the first request always failed, and if the fallback was
// unreachable there was nothing left to try.
const RATE_SOURCES = [
  { name:'frankfurter',
    url:(f,t)=>'https://api.frankfurter.dev/v1/latest?base='+f+'&symbols='+t,
    pick:(d,t)=>({rate: d && d.rates && d.rates[t], date: d && d.date}) },
  { name:'frankfurter.app',
    url:(f,t)=>'https://api.frankfurter.app/latest?from='+f+'&to='+t,
    pick:(d,t)=>({rate: d && d.rates && d.rates[t], date: d && d.date}) },
  { name:'er-api',
    url:(f)=>'https://open.er-api.com/v6/latest/'+f,
    pick:(d,t)=>({rate: d && d.rates && d.rates[t],
                  date: d && d.time_last_update_utc ? ymd(new Date(d.time_last_update_utc)) : null}) },
  { name:'exchangerate-api',
    url:(f)=>'https://api.exchangerate-api.com/v4/latest/'+f,
    pick:(d,t)=>({rate: d && d.rates && d.rates[t], date: d && d.date}) }
];

// Frankfurter publishes a time series, so one request covers a whole statement
// rather than one request per transaction. Only Frankfurter is used here: the
// other providers in RATE_SOURCES are latest-only, and quietly substituting
// today's rate for a historical one would be a wrong answer wearing the costume
// of a right one.
const SERIES_SOURCES = [
  f=>'https://api.frankfurter.dev/v1/{range}?base={from}&symbols={to}'
      .replace('{from}', f.from).replace('{to}', f.to).replace('{range}', f.d1+'..'+f.d2),
  f=>'https://api.frankfurter.app/{range}?from={from}&to={to}'
      .replace('{from}', f.from).replace('{to}', f.to).replace('{range}', f.d1+'..'+f.d2)
];

// Returns {ymd: rate} across the range, or null if no provider answered.
async function fetchRateSeries(from, to, d1, d2){
  if(from === to) return null;
  for(const mk of SERIES_SOURCES){
    try{
      const d = await fetchJSON(mk({from, to, d1, d2}), 9000);
      const raw = d && d.rates;
      if(!raw || typeof raw !== 'object') throw new Error('no rates');
      const out = {};
      Object.keys(raw).forEach(day=>{
        const v = raw[day] && raw[day][to];
        if(v && isFinite(v)) out[day] = Number(v);
      });
      if(!Object.keys(out).length) throw new Error('empty series');
      return out;
    }catch(e){ /* try the next provider */ }
  }
  return null;
}

// Markets close. A Saturday purchase is converted at Friday's published rate,
// which is what the money was actually worth — not at the next Monday's.
function rateOnOrBefore(series, day){
  if(!series) return null;
  if(series[day]) return series[day];
  const days = Object.keys(series).sort();
  let best = null;
  for(const d of days){ if(d <= day) best = series[d]; else break; }
  // Before the series starts (a stale statement), use its earliest rate rather
  // than refusing the row outright.
  return best != null ? best : (days.length ? series[days[0]] : null);
}

// A request that never settles looks identical to a broken app, so cap each one.
async function fetchJSON(url, ms){
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(()=>ctl.abort(), ms || 7000) : null;
  try{
    const r = await fetch(url, ctl ? {signal: ctl.signal, cache:'no-store'} : {cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { if(timer) clearTimeout(timer); }
}

// Records what each provider actually did, so a failure can be explained
// rather than just reported as "could not reach the rate service".
let lastRateAttempts = [];

async function fetchRate(from, to){
  if(from === to) return {rate:1, date: todayYMD()};
  lastRateAttempts = [];
  for(const s of RATE_SOURCES){
    try{
      const d = await fetchJSON(s.url(from, to), 7000);
      const {rate, date} = s.pick(d, to);
      const n = Number(rate);
      if(!n || !isFinite(n) || n <= 0) throw new Error('no '+to+' in response');
      lastRateAttempts.push(s.name+': ok');
      return {rate: n, date: date || todayYMD(), source: s.name};
    }catch(e){
      const msg = (e && e.name === 'AbortError') ? 'timed out' : (e && e.message ? e.message : 'failed');
      lastRateAttempts.push(s.name+': '+msg);
    }
  }
  const err = new Error(lastRateAttempts.join(' · '));
  err.attempts = lastRateAttempts.slice();
  throw err;
}

// Every stored figure is a plain number in the base currency, so switching means
// multiplying all of them by one rate. That rewrites history at today's rate —
// a purchase from January is restated at August's rate, not January's. It is the
// honest trade-off for keeping one currency throughout, and it is reversible
// because the rate used is recorded below.
function applyConversion(from, to, rate, rateDate){
  snapshot('Convert '+from+' to '+to);
  const c = n => Math.round((Number(n)||0) * rate * 100) / 100;

  txns = txns.map(t=>({...t, amount: c(t.amount)}));
  accts = accts.map(a=>({...a, opening: c(a.opening), ...(Array.isArray(a.adj) ? {adj: a.adj.map(x=>({...x, amount: c(x.amount)}))} : {})}));
  recur = recur.map(r=>({...r, amount: c(r.amount)}));
  assets = assets.map(a=>({...a,
    initial: c(a.initial),
    contribs: (a.contribs||[]).map(x=>({...x, amount: c(x.amount)})),
    values: (a.values||[]).map(x=>({...x, value: c(x.value)}))
  }));
  const nb = {};
  Object.keys(budgets).forEach(k=>{ nb[k] = c(budgets[k]); });
  budgets = nb;

  settings.currency = to;
  settings.fxLog = (settings.fxLog||[]).concat([{
    on: todayYMD(), from, to, rate, rateDate: rateDate || todayYMD()
  }]);

  save(K.txns,txns); save(K.accts,accts); save(K.recur,recur);
  save(K.assets,assets); save(K.budgets,budgets); save(K.settings,settings);
  render();
}

// Reversing a conversion is just dividing by the rate that was applied. The
// figures are stored to two decimals, so a there-and-back trip can be a penny
// out on individual rows; that is inherent to rounding, not a fault in the
// arithmetic, and it is far better than leaving every number wrong.
function reverseConversion(entry){
  snapshot('Reverse '+entry.from+'→'+entry.to);
  const c = n => Math.round(((Number(n)||0) / entry.rate) * 100) / 100;
  txns   = txns.map(t=>({...t, amount: c(t.amount)}));
  accts  = accts.map(a=>({...a, opening: c(a.opening), ...(Array.isArray(a.adj) ? {adj: a.adj.map(x=>({...x, amount: c(x.amount)}))} : {})}));
  recur  = recur.map(r=>({...r, amount: c(r.amount)}));
  assets = assets.map(a=>({...a,
    initial: c(a.initial),
    contribs: (a.contribs||[]).map(x=>({...x, amount: c(x.amount)})),
    values:   (a.values||[]).map(x=>({...x, value: c(x.value)}))
  }));
  const nb = {}; Object.keys(budgets).forEach(k=>{ nb[k] = c(budgets[k]); });
  budgets = nb;

  settings.currency = entry.from;
  // Reversal always applies to the newest entry, so drop exactly that one.
  // Matching on field values removed every conversion sharing the same rate.
  settings.fxLog = (settings.fxLog||[]).slice(0, -1);
  save(K.txns,txns); save(K.accts,accts); save(K.recur,recur);
  save(K.assets,assets); save(K.budgets,budgets); save(K.settings,settings);
  render();
}

// Scoped import fixes, newest first, above the whole-app conversions. They are
// independent of each other: an import fix touches named rows, a conversion
// touches everything, so neither has to be reversed before the other.
function renderImportFxLog(){
  const fixes = (settings.fxFixes||[]).slice();
  if(!fixes.length) return '';
  return fixes.slice().reverse().map((e)=>{
    const a = accts.find(x=>x.id===e.acct);
    return '<div class="card pad" style="margin-bottom:10px;">'+
      '<div style="display:flex; justify-content:space-between; align-items:baseline;">'+
      '<b style="font-size:14px;">'+esc(e.from)+' → '+esc(e.to)+'</b>'+
      '<span class="fig" style="color:var(--brass);">×'+Number(e.rate).toFixed(4)+'</span></div>'+
      '<div class="note" style="margin-top:4px;">'+e.ids.length+' imported transaction'+
        (e.ids.length===1?'':'s')+(a?' in '+esc(a.name):'')+' · fixed '+prettyDate(e.on)+'</div>'+
      '<button class="btn ghost" data-fximprev="'+esc(e.on)+'|'+esc(e.from)+'|'+e.ids.length+
        '" style="margin-top:8px;">Undo this fix</button></div>';
  }).join('');
}

function wireImportFxLog(box){
  box.querySelectorAll('[data-fximprev]').forEach(b=>{
    b.onclick = ()=>{
      const [on, from, n] = b.dataset.fximprev.split('|');
      const e = (settings.fxFixes||[]).find(f=>f.on===on && f.from===from && String(f.ids.length)===n);
      if(!e) return;
      if(!confirm('Undo this fix? '+e.ids.length+' transaction'+(e.ids.length===1?'':'s')+
        ' go back to their figures before the conversion.')) return;
      reverseImportFx(e);
      renderFxFix();
      renderMore();
    };
  });
}

function renderFxFix(){
  const log = (settings.fxLog||[]).slice();
  const box = document.getElementById('fxfix-list');
  const fixHtml = renderImportFxLog();
  document.getElementById('fxfix-all').style.display = log.length > 1 ? 'block' : 'none';
  if(!log.length){
    box.innerHTML = fixHtml + '<div class="note">No whole-app conversions have been applied. Your figures are in '+curCode()+' exactly as you entered them.</div>';
    wireImportFxLog(box);
    return;
  }
  const sample = liquidTotal();
  box.innerHTML = fixHtml + log.slice().reverse().map((e,i)=>{
    const newest = i === 0;
    return '<div class="card pad" style="margin-bottom:10px;">'+
      '<div style="display:flex; justify-content:space-between; align-items:baseline;">'+
      '<b style="font-size:14px;">'+e.from+' → '+e.to+'</b>'+
      '<span class="fig" style="color:var(--brass);">×'+Number(e.rate).toFixed(4)+'</span></div>'+
      '<div class="note" style="margin-top:4px;">Applied '+prettyDate(e.on)+
        '. Reversing divides every figure by '+Number(e.rate).toFixed(4)+'.</div>'+
      (newest
        ? '<div class="note" style="margin-top:6px;">Your '+money0(sample)+' would become '+
            (CURRENCIES[e.from]||{sym:''}).sym+Math.round(Math.abs(sample)/e.rate).toLocaleString('en-GB')+'.</div>'+
          '<button class="btn ghost" data-fxrev="'+i+'" style="margin-top:8px;">Reverse this conversion</button>'
        : '<div class="note" style="margin-top:6px; color:var(--text3);">Reverse the one above this first.</div>')+
      '</div>';
  }).join('');
  wireImportFxLog(box);
  box.querySelectorAll('[data-fxrev]').forEach(b=>{
    b.onclick = ()=>{
      const log2 = (settings.fxLog||[]);
      const e = log2[log2.length-1];
      if(!e) return;
      if(!confirm('Reverse '+e.from+' → '+e.to+' at '+Number(e.rate).toFixed(4)+'?\n\nEvery figure is divided by that rate and your currency goes back to '+e.from+'.')) return;
      reverseConversion(e);
      renderFxFix();
    };
  });
}
