// ============================================================
// Investments (v57 preview): Crypto and Stocks, each with its own history
// ============================================================
// Kept in its own key, 'ledger:invest', so nothing that was saved before is
// touched. Every trade is stored as it happened (date, coin, amount, and its
// value in pounds on that day), and every figure on screen is worked out from
// that list - so a stat can always be traced back to the lines behind it.
//
// Average cost: what you hold cost the average of what you paid for it.
// Selling part of a holding takes that average cost with it, so "profit from
// sales" and "not yet sold" never count the same pound twice.
// v58: categories are yours - add, rename or remove them. Each has a type,
// which decides the words used and whether Ledger can fetch prices for it:
//   crypto - live prices from Coinbase; shares and other - you log the value.
const INV_TYPES = {
  crypto: {label:'Crypto', unit:'coin', units:'coins', reward:'Rewards', rewardSub:'free coins earned'},
  shares: {label:'Shares', unit:'holding', units:'holdings', reward:'Dividends', rewardSub:'paid to you'},
  other:  {label:'Other', unit:'holding', units:'holdings', reward:'Income', rewardSub:'paid to you'}
};
const INV_DEFAULT_CATS = [{id:'crypto', name:'Crypto', type:'crypto'}, {id:'stocks', name:'Stocks', type:'shares'}];
function invCats(){
  if(!Array.isArray(invest.cats) || !invest.cats.length) invest.cats = INV_DEFAULT_CATS.map(c=>Object.assign({}, c));
  return invest.cats;
}
function invCatIds(){ return invCats().map(c=>c.id); }
function invCatInfo(id){
  const c = invCats().find(x=>x.id===id) || {id, name:id, type:'other'};
  return Object.assign({}, INV_TYPES[c.type] || INV_TYPES.other, c);
}
const isCryptoCat = id => invCatInfo(id).type === 'crypto';
const COIN_NAMES = {BTC:'Bitcoin', ETH:'Ethereum', SOL:'Solana', USDC:'USD Coin', USDT:'Tether', DOGE:'Dogecoin',
  SHIB:'Shiba Inu', XRP:'XRP', SUI:'Sui', PEPE:'Pepe', WIF:'dogwifhat', ARB:'Arbitrum', GRT:'The Graph', VET:'VeChain',
  VVV:'Venice', ALEPH:'Aleph', AMP:'Amp', GAL:'Galxe', HOPR:'HOPR', VARA:'Vara', ABT:'Arcblock'};
const SYM_COLOURS = {BTC:'#f2a33a', ETH:'#8f9cff', SOL:'#5ee0c0', USDC:'#5b9bf0', DOGE:'#d9b44a', SHIB:'#f0897c'};
const symColour = s => SYM_COLOURS[s] || ('hsl('+([...s].reduce((h,c)=>h*31+c.charCodeAt(0),7)%360)+' 45% 62%)');

// ---------------- reading a Coinbase history file ----------------
const usdNum = s => { const n = Number(String(s == null ? '' : s).replace(/[$,\s]/g,'')); return isFinite(n) ? n : 0; };
function isCoinbaseCSV(text){ return /Transaction Type/.test(text) && /Quantity Transacted/.test(text) && /Price at Transaction/.test(text); }
// Returns rows in a plain shape, still in dollars. Staking moves between
// Coinbase's own wallets are skipped: they move nothing in or out.
function parseCoinbase(text){
  const rows = parseCSV(text);
  const hi = rows.findIndex(r=> r.includes('Transaction Type') && r.includes('Asset'));
  if(hi < 0) return null;
  // Coinbase has used a few header names over the years ("Spot Price at
  // Transaction", "Spot Price Currency"...), so match on the words, not exactly.
  const H = rows[hi].map(h=> String(h).trim()), col = n => { const i = H.indexOf(n); return i >= 0 ? i : H.findIndex(h=> h.toLowerCase().includes(n.toLowerCase())); };
  const c = {id:col('ID'), ts:col('Timestamp'), type:col('Transaction Type'), sym:col('Asset'), qty:col('Quantity Transacted'),
    price:col('Price at Transaction'), sub:col('Subtotal'), tot:col('Total (inclusive of fees and/or spread)'), fee:col('Fees and/or Spread'), note:col('Notes')};
  const out = [];
  for(const r of rows.slice(hi+1)){
    if(r.length < 6) continue;
    const type = r[c.type], sym = r[c.sym], qty = usdNum(r[c.qty]);
    const ts = String(r[c.ts]||'').replace(' UTC','').trim(), date = ts.slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !sym || !qty) continue;
    if(/Staking Transfer|Unstaking Transfer/i.test(type)) continue;
    const note = r[c.note] || '';
    const id = c.id >= 0 && r[c.id] ? r[c.id] : [ts, type, sym, r[c.qty]].join('|');
    const base = {ext:'cb:'+id, date, ts, sym, qty:Math.abs(qty), price:usdNum(r[c.price]),
      usd:Math.abs(usdNum(r[c.sub])), usdTot:Math.abs(usdNum(r[c.tot])), feeUsd:Math.abs(usdNum(r[c.fee])), note};
    let kind = null;
    if(sym === 'AUD' || sym === 'USD' || sym === 'GBP'){
      if(/Deposit/i.test(type)) kind = 'deposit'; else if(/Withdraw/i.test(type)) kind = 'withdraw';
      if(!kind) continue;
      out.push(Object.assign(base, {kind, cash:true}));
      continue;
    }
    if(/^Buy$|Advanced Trade Buy/i.test(type)) kind = 'buy';
    else if(/^Sell$|Advanced Trade Sell/i.test(type)) kind = 'sell';
    else if(/Convert/i.test(type)){
      // Older Coinbase files put a conversion on ONE row ("Converted 0.5 ETH
      // to 10 SOL"); newer ones use two rows, one minus and one plus.
      const m = note.match(/Converted\s+([\d.,]+)\s+([A-Z0-9]+)\s+to\s+([\d.,]+)\s+([A-Z0-9]+)/i);
      if(qty > 0 && m && m[2].toUpperCase() === sym){
        const usd = Math.abs(usdNum(r[c.sub]));
        out.push(Object.assign({}, base, {kind:'sell', viaConvert:true}));
        out.push(Object.assign({}, base, {ext:base.ext+':to', sym:m[4].toUpperCase(), qty:Math.abs(usdNum(m[3])), usd, usdTot:usd,
          price: usdNum(m[3]) ? usd/Math.abs(usdNum(m[3])) : 0, feeUsd:0, kind:'buy', viaConvert:true}));
        continue;
      }
      kind = qty > 0 ? 'buy' : 'sell';
    }
    else if(/Staking Income|Reward|Learning|Incentive/i.test(type)) kind = 'reward';
    else if(/Receive/i.test(type)) kind = 'in';
    else if(/Send/i.test(type)) kind = 'out';
    if(!kind) continue;
    // Bought straight from a bank card is new money in. Bought with cash already
    // on Coinbase, or by converting another coin, is not.
    const fromBank = kind === 'buy' && /^Buy$/i.test(type) && /using \d{4}\*+/.test(note);
    out.push(Object.assign(base, {kind, fromBank, viaConvert: /Convert/i.test(type)}));
  }
  return out;
}

// Dollars to pounds at each day's published rate. Falls back to the nearest
// known rate, and marks the trade so it can be corrected once online.
async function usdToGbpSeries(rows){
  if(!rows.length) return {};
  const days = rows.map(r=>r.date).sort();
  try{ return await fetchRateSeries('USD','GBP', days[0], days[days.length-1]) || {}; }catch(e){ return {}; }
}
function rateOn(series, day, fallback){
  if(series[day]) return series[day];
  const ks = Object.keys(series).filter(k=> k <= day).sort();
  if(ks.length) return series[ks[ks.length-1]];
  const after = Object.keys(series).sort();
  return after.length ? series[after[0]] : fallback;
}
async function importCoinbase(text){
  const rows = parseCoinbase(text);
  if(!rows) return {error:'That is not a Coinbase history file.'};
  if(!invCats().some(c=>c.id==='crypto')) invest.cats.unshift({id:'crypto', name:'Crypto', type:'crypto'});
  const have = new Set(invest.trades.map(t=>t.ext));
  const fresh = rows.filter(r=> !have.has(r.ext));
  const fx = fresh.length ? await usdToGbpSeries(fresh) : {};
  Object.assign(invPx.fx, fx); if(Object.keys(fx).length) saveInvPx();
  const noRates = !Object.keys(fx).length;
  for(const r of fresh){
    // Offline: a stand-in rate, flagged, and corrected the next time Ledger
    // is online (the dollar figures are kept for exactly that).
    const rate = noRates ? (usdGbpOn(r.date) || 0.78) : rateOn(fx, r.date, 0.78);
    const usd = (r.kind==='buy' && !r.viaConvert) ? r.usdTot : r.usd;
    invest.trades.push({id:uid(), ext:r.ext, src:'coinbase', cat:r.cash ? 'cash' : 'crypto', date:r.date, ts:r.ts, sym:r.sym, kind:r.kind,
      qty:r.qty, usd, usdFee:r.feeUsd, usdPrice:r.price, gbp: usd * rate, fee:r.feeUsd * rate, price: r.price * rate,
      fromBank: !!r.fromBank, note:r.note, fxGuess: noRates && !usdGbpOn(r.date) ? 1 : 0});
  }
  sortTrades();
  saveInvest();
  return {added: fresh.length, skipped: rows.length - fresh.length, guessed: noRates ? fresh.length : 0};
}
// Puts the right pounds figure on anything imported while offline.
function fixGuessedRates(){
  let n = 0;
  for(const t of invest.trades){
    if(!t.fxGuess || !(t.usd >= 0)) continue;
    const rate = usdGbpOn(t.date); if(!rate) continue;
    t.gbp = t.usd * rate; t.fee = (t.usdFee||0) * rate; t.price = (t.usdPrice||0) * rate; t.fxGuess = 0; n++;
  }
  if(n) saveInvest();
  return n;
}

// ---------------- the maths ----------------
// Cash-statement entries: money in/out, fees and rewards. Never a holding.
const CASH_KINDS = {deposit:1, withdraw:1, cfee:1, creward:1};
// One pass over a category's trades gives every coin's position.
function invPositions(cat){
  const P = {};
  const get = s => P[s] || (P[s] = {sym:s, qty:0, cost:0, bought:0, sold:0, realised:0, rewards:0, rewardQty:0, fees:0,
    first:null, last:null, n:0, prices:[], trades:[], years:{}});
  for(const t of invest.trades){
    if(t.cat !== cat || CASH_KINDS[t.kind]) continue;
    const p = get(t.sym), y = t.date.slice(0,4);
    const Y = p.years[y] || (p.years[y] = {bought:0, sold:0, realised:0, rewards:0, fees:0});
    p.n++; p.trades.push(t); p.fees += t.fee||0; Y.fees += t.fee||0;
    if(!p.first) p.first = t.date; p.last = t.date;
    if(t.price > 0) p.prices.push([t.date, t.price]);
    if(t.kind === 'deposit' || t.kind === 'withdraw') continue;   // money in/out of a broker, not a holding
    if(t.kind === 'value') continue;          // a value reading only sets the price
    if(t.kind === 'adjust'){
      // v59: "I hold this many now" - the amount changes at the average cost,
      // so correcting a number never invents a profit or a loss.
      if(t.qty > 0){ p.qty += t.qty; p.cost += t.gbp; }
      else { const part = Math.min(-t.qty, p.qty), avg = p.qty > 1e-12 ? p.cost/p.qty : 0; p.cost -= avg*part; p.qty -= part; if(p.qty < 1e-12){ p.qty = 0; p.cost = 0; } }
      continue;
    }
    if(t.kind === 'buy' || t.kind === 'in' || t.kind === 'reward'){
      const cost = t.kind === 'reward' ? 0 : t.gbp;
      p.qty += t.qty; p.cost += cost;
      if(t.kind === 'buy'){ p.bought += t.gbp; Y.bought += t.gbp; }
      if(t.kind === 'reward'){ p.rewards += t.gbp; p.rewardQty += t.qty; Y.rewards += t.gbp; }
    } else {
      const part = Math.min(t.qty, p.qty), avg = p.qty > 1e-12 ? p.cost/p.qty : 0;
      if(t.kind === 'sell'){ const r = t.gbp - avg*part; p.realised += r; Y.realised += r; p.sold += t.gbp; Y.sold += t.gbp; }
      p.cost -= avg*part; p.qty -= part;
      if(p.qty < 1e-12){ p.qty = 0; p.cost = 0; }
    }
  }
  for(const s in P){
    const p = P[s];
    p.price = invPrice(cat, s, p);
    p.value = p.qty * p.price;
    p.unreal = p.value - p.cost;
    p.unrealPct = p.cost > 0 ? p.unreal / p.cost * 100 : null;
    p.avg = p.qty > 0 ? p.cost / p.qty : 0;
    // Dust - a few pence left over after a sale - is not a holding.
    p.held = p.value >= 1;
  }
  return P;
}
// Live price: crypto-type categories share one price per coin.
function livePrice(cat, sym){
  if(!isCryptoCat(cat)) return 0;
  const a = invest.prices['crypto:'+sym], b = invest.prices[cat+':'+sym];
  const x = [a,b].filter(v=> v && v.gbp > 0).sort((u,v)=> String(v.at).localeCompare(String(u.at)))[0];
  return x ? x.gbp : 0;
}
function invPrice(cat, sym, p){
  const live = livePrice(cat, sym);
  // A value you typed in after the live price was fetched wins.
  const lastTyped = p && p.trades.filter(t=>t.kind==='value').pop();
  if(live && !(lastTyped && lastTyped.date >= String((invest.prices['crypto:'+sym]||{}).at||'').slice(0,10))) return live;
  return p && p.prices.length ? p.prices[p.prices.length-1][1] : 0;
}
function invCategory(cat){
  return memo('inv:'+cat, ()=>{
    const P = invPositions(cat), list = Object.values(P);
    const S = {cat, P, held: list.filter(p=>p.held).sort((a,b)=> b.value - a.value),
      past: list.filter(p=>!p.held).sort((a,b)=> b.realised - a.realised),
      value:0, cost:0, realised:0, rewards:0, fees:0, putIn:0, takenOut:0, years:{}};
    const Y = y => S.years[y] || (S.years[y] = {putIn:0, takenOut:0, realised:0, fees:0, rewards:0});
    for(const p of list){
      S.value += p.value; S.cost += p.cost; S.realised += p.realised; S.rewards += p.rewards; S.fees += p.fees;
      for(const y in p.years){ const a = Y(y), b = p.years[y]; a.realised += b.realised; a.fees += b.fees; a.rewards += b.rewards; }
    }
    // Money in and out: cash deposits and card buys in; bank withdrawals out;
    // coins moved in or out of the account count at their value that day.
    for(const t of invest.trades){
      const mine = t.cat === cat || (cat === 'crypto' && t.cat === 'cash' && t.src === 'coinbase');
      if(!mine) continue;
      const y = t.date.slice(0,4);
      if(t.kind === 'cfee'){ S.fees += t.gbp; Y(y).fees += t.gbp; continue; }
      if(t.kind === 'creward'){ S.rewards += t.gbp; Y(y).rewards += t.gbp; continue; }
      // Coinbase says where money came from. Anything else (a broker file, or
      // logged by hand) is treated simply: buying puts money in, selling and
      // cash dividends take it out.
      const simple = t.src !== 'coinbase';
      const inn = t.kind === 'deposit' || t.fromBank || t.kind === 'in' || (simple && t.kind === 'buy');
      const outt = t.kind === 'withdraw' || t.kind === 'out' || (simple && (t.kind === 'sell' || (t.kind === 'reward' && !t.qty)));
      if(inn){ S.putIn += t.gbp; Y(y).putIn += t.gbp; }
      if(outt){ S.takenOut += t.gbp; Y(y).takenOut += t.gbp; }
    }
    S.unreal = S.value - S.cost;
    S.total = S.value + S.takenOut - S.putIn;
    S.totalPct = S.putIn > 0 ? S.total / S.putIn * 100 : null;
    return S;
  });
}
// Your investment's value every day: what you held that day times that day's
// price. The price is the day's close when Ledger has it (fetched once, kept),
// otherwise the last price Ledger saw - from your own trades. Returns
// [[date, value]] from your first entry to today.
const STABLE = {USDC:1, USDT:1, DAI:1, USD:1};
function usdGbpOn(day){
  const f = invPx.fx;
  if(f[day]) return f[day];
  for(let i = 1; i < 8; i++){ const d = ymd(new Date(parseYMD(day).getTime() - i*864e5)); if(f[d]) return f[d]; }
  return 0;
}
function dayPrice(cat, sym, day){
  if(!isCryptoCat(cat)) return 0;
  const px = invPx.usd[sym], fx = usdGbpOn(day);
  if(!fx) return 0;
  if(STABLE[sym]) return fx;
  return px && px[day] ? px[day] * fx : 0;
}
function invSeries(cat, sym){
  return memo('ser:'+cat+':'+(sym||''), ()=>{
    const trades = invest.trades.filter(t=> t.cat === cat && (!sym || t.sym === sym));
    if(!trades.length) return [];
    const qty = {}, last = {}, out = [];
    const today = todayYMD();
    let i = 0, d = parseYMD(trades[0].date);
    const end = parseYMD(today);
    while(d <= end){
      const day = ymd(d);
      while(i < trades.length && trades[i].date <= day){
        const t = trades[i++], s = t.sym;
        qty[s] = qty[s] || 0;
        if(t.price > 0) last[s] = t.price;
        if(t.kind === 'value' || CASH_KINDS[t.kind]) continue;
        if(t.kind === 'adjust'){ qty[s] = Math.max(0, qty[s] + t.qty); continue; }
        if(t.kind === 'buy' || t.kind === 'in' || t.kind === 'reward') qty[s] += t.qty;
        else qty[s] = Math.max(0, qty[s] - t.qty);
      }
      let v = 0;
      for(const s in qty){
        if(qty[s] <= 0) continue;
        let p = dayPrice(cat, s, day);
        if(day === today){ const lp = livePrice(cat, s); if(lp) p = lp; }
        if(p > 0) last[s] = p; else p = last[s] || 0;
        v += qty[s] * p;
      }
      out.push([day, v]);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1);
    }
    return out;
  });
}
// Worth on a given day (for net worth). 0 before your first entry.
function invValueAt(upto){
  let v = 0;
  for(const cat of invCatIds()){
    const ser = invSeries(cat);
    if(!ser.length || upto < ser[0][0]) continue;
    let lo = 0, hi = ser.length - 1;
    while(lo < hi){ const m = (lo + hi + 1) >> 1; if(ser[m][0] <= upto) lo = m; else hi = m - 1; }
    v += ser[lo][1];
  }
  return v;
}
function invAny(){ return invest.trades.some(t=> t.cat !== 'cash'); }
function invCatAny(cat){ return invest.trades.some(t=> t.cat === cat); }
function invFirstDay(){ const t = invest.trades.find(t=> t.cat !== 'cash'); return t ? t.date : null; }
// Totals across both categories, for the Holdings card.
function invTotals(){
  let value = 0, putIn = 0, takenOut = 0, total = 0;
  for(const cat of invCatIds()){ const S = invCategory(cat); value += S.value; putIn += S.putIn; takenOut += S.takenOut; total += S.total; }
  return {value, putIn, takenOut, total};
}

// ---------------- prices (online only; never blocks, never needed) ----------------
// Price now: Coinbase's public spot price. Daily history: Coinbase's public
// daily candles in dollars, turned into pounds with each day's published
// rate. Everything is kept, so this only ever fetches days it has not got.
async function refreshInvPrices(){
  let changed = false;
  const syms = new Set();
  invCatIds().filter(isCryptoCat).forEach(c=> invCategory(c).held.forEach(p=> syms.add(p.sym)));
  for(const sym of syms){
    const p = {sym};
    if(STABLE[p.sym]) continue;
    try{
      const d = await fetchJSON('https://api.coinbase.com/v2/prices/'+p.sym+'-GBP/spot', 7000);
      const v = Number(d && d.data && d.data.amount);
      if(v > 0){ invest.prices['crypto:'+p.sym] = {gbp:v, at:new Date().toISOString()}; changed = true; }
    }catch(e){}
  }
  if(changed){ saveInvest(); render(); if(invOpen) invDraw(); }
}
// The days each coin was actually held - no point fetching the rest.
function heldRanges(){
  const R = {}, q = {}, today = todayYMD();
  for(const t of invest.trades){
    if(!isCryptoCat(t.cat) || STABLE[t.sym] || t.kind === 'value' || CASH_KINDS[t.kind]) continue;
    const s = t.sym, r = R[s] || (R[s] = {from:t.date, to:t.date, peak:0});
    q[s] = (q[s]||0) + ((t.kind === 'sell' || t.kind === 'out') ? -t.qty : t.qty);
    if(q[s] < 0) q[s] = 0;
    r.to = t.date; r.peak = Math.max(r.peak, q[s]);
    // Crumbs left after a sale (under 1% of the most you held) do not count as still holding.
    r.open = q[s] > r.peak * 0.01;
  }
  for(const s in R) if(R[s].open) R[s].to = today;
  return R;
}
let invHistBusy = false;
async function fetchInvHistory(){
  if(invHistBusy || !invAny()) return;
  invHistBusy = true;
  let got = false;
  try{
    const R = heldRanges(), today = todayYMD();
    // Rates first: without them no dollar price can become pounds.
    const days = Object.values(R).map(r=>r.from).concat(invest.trades.filter(t=>isCryptoCat(t.cat)).map(t=>t.date)).sort();
    if(days.length){
      const have = Object.keys(invPx.fx).sort();
      const from = have.length && have[0] <= days[0] ? have[have.length-1] : days[0];
      if(from < today){
        const fx = await fetchRateSeries('USD', 'GBP', from, today);
        if(fx){ Object.assign(invPx.fx, fx); got = true; }
      }
    }
    for(const s in R){
      const px = invPx.usd[s] || (invPx.usd[s] = {});
      if(px.__none) continue;                       // Coinbase does not list it
      let start = parseYMD(R[s].from), stop = parseYMD(R[s].to);
      const known = Object.keys(px).filter(k=>k[0]==='2').sort();
      if(known.length && known[0] <= R[s].from){ start = parseYMD(known[known.length-1]); }
      let failed = 0;
      while(start <= stop && failed < 2){
        const chunkEnd = new Date(Math.min(stop.getTime(), start.getTime() + 299*864e5));
        try{
          const url = 'https://api.exchange.coinbase.com/products/'+s+'-USD/candles?granularity=86400&start='+
            ymd(start)+'T00:00:00Z&end='+ymd(chunkEnd)+'T23:59:59Z';
          const rows = await fetchJSON(url, 9000);
          if(!Array.isArray(rows)) throw new Error('no rows');
          rows.forEach(r=>{ if(Array.isArray(r) && r[4] > 0) px[ymd(new Date(r[0]*1000))] = Number(r[4]); });
          got = true;
        }catch(e){
          failed++;
          if(String(e && e.message).includes('404')){ px.__none = 1; break; }
        }
        start = new Date(chunkEnd.getTime() + 864e5);
      }
    }
  } finally {
    invHistBusy = false;
  }
  if(got){ saveInvPx(); fixGuessedRates(); render(); if(invOpen) invDraw(); }
}

// ---------------- drawing ----------------
const fmtQty = q => q >= 1000 ? Math.round(q).toLocaleString('en-GB') : q >= 1 ? (+q.toFixed(4)).toString() : (+q.toPrecision(4)).toString();
const signed = (v, d) => (v >= 0 ? '+' : '−') + money0(Math.abs(v));
const pctTxt = v => v === null || !isFinite(v) ? '' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
const tone = v => v > 0.5 ? 'in' : v < -0.5 ? 'out' : '';
const byValue = (cat, s) => !!(invest.byValue && invest.byValue[cat+':'+s]);
const holdTxt = (cat, p) => byValue(cat, p.sym) ? 'tracked by value' : fmtQty(p.qty)+' '+p.sym;
const symName = (cat, s) => (invest.names && invest.names[cat+':'+s]) || (isCryptoCat(cat) ? (COIN_NAMES[s] || s) : s);

function invChartSVG(series, opt){
  opt = opt || {};
  const W = 340, H = opt.h || 150, P = 8;
  if(series.length < 2) return '<div class="inv-nochart">Not enough history to draw yet.</div>';
  const t0 = parseYMD(series[0][0]).getTime(), t1 = parseYMD(series[series.length-1][0]).getTime() || t0+1;
  const vals = series.flatMap(r=> opt.withCost ? [r[1], r[2]] : [r[1]]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if(opt.zero) lo = Math.min(0, lo);
  if(hi - lo < 1e-9) hi = lo + 1;
  const X = d => P + (parseYMD(d).getTime() - t0) / Math.max(1, t1 - t0) * (W - 2*P);
  const Yv = v => H - P - (v - lo) / (hi - lo) * (H - 2*P);
  const line = k => series.map((r,i)=> (i?'L':'M') + X(r[0]).toFixed(1) + ' ' + Yv(r[k]).toFixed(1)).join(' ');
  const col = opt.colour || 'var(--brass)';
  const id = 'g'+Math.random().toString(36).slice(2,8);
  const main = line(1);
  const area = main + ' L' + X(series[series.length-1][0]).toFixed(1) + ' ' + (H-P) + ' L' + X(series[0][0]).toFixed(1) + ' ' + (H-P) + ' Z';
  let marks = '';
  if(opt.marks) marks = opt.marks.map(m=> '<circle cx="'+X(m.date).toFixed(1)+'" cy="'+Yv(m.v).toFixed(1)+'" r="3.4" fill="'+(m.kind==='sell'?'#f0897c':'#7fe0b0')+'" stroke="#121419" stroke-width="1.5"/>').join('');
  const end = series[series.length-1];
  return '<svg class="inv-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="'+esc(opt.label||'Chart')+'">'+
    '<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+col+'" stop-opacity=".25"/><stop offset="100%" stop-color="'+col+'" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+area+'" fill="url(#'+id+')"/>'+
    (opt.withCost ? '<path d="'+line(2)+'" fill="none" stroke="#7d848f" stroke-width="1.5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>' : '')+
    '<path d="'+main+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'+
    marks+
    '<circle cx="'+X(end[0]).toFixed(1)+'" cy="'+Yv(end[1]).toFixed(1)+'" r="3.4" fill="'+col+'"/>'+
  '</svg>';
}
function rangeSeries(series, range){
  if(range === 'all' || !series.length) return series;
  const days = {'1y':365, '3m':92}[range] || 365;
  const from = ymd(new Date(Date.now() - days*864e5));
  const inside = series.filter(r=> r[0] >= from);
  const before = series.filter(r=> r[0] < from).pop();
  return before ? [[from, before[1]]].concat(inside) : inside;
}
function axisLabels(series){
  if(series.length < 2) return '';
  const f = d => parseYMD(d).toLocaleDateString('en-GB', {month:'short', year:'2-digit'});
  const mid = series[Math.floor(series.length/2)][0];
  return '<div class="inv-axis"><span>'+f(series[0][0])+'</span><span>'+f(mid)+'</span><span>'+f(series[series.length-1][0])+'</span></div>';
}
function rangeChips(cur){
  return '<div class="inv-ranges">'+[['3m','3M'],['1y','1Y'],['all','All']].map(r=>
    '<button class="inv-range'+(cur===r[0]?' on':'')+'" data-range="'+r[0]+'">'+r[1]+'</button>').join('')+'</div>';
}
function statTile(lab, val, cls, sub){
  return '<div class="inv-tile"><div class="inv-tl">'+lab+'</div><div class="inv-tv fig '+(cls||'')+'">'+val+'</div>'+(sub?'<div class="inv-ts">'+sub+'</div>':'')+'</div>';
}

// Assets tab: one card per category.
function renderInvCards(){
  const box = document.getElementById('inv-cards');
  if(!box) return;
  box.innerHTML = invCatIds().map(cat=>{
    const S = invCategory(cat), C = invCatInfo(cat);
    const any = S.held.length || S.past.length || S.putIn > 0 || S.takenOut > 0;
    const ser = any ? rangeSeries(invSeries(cat), '1y') : [];
    return '<button class="inv-card" data-invcat="'+esc(cat)+'">'+
      '<div class="inv-ch"><span class="inv-cn">'+esc(C.name)+'</span>'+
        (any ? '<span class="inv-cc">'+S.held.length+' '+(S.held.length===1?C.unit:C.units)+'</span>' : '<span class="inv-cc">Nothing yet</span>')+
        '<i class="ti ti-chevron-right" aria-hidden="true"></i></div>'+
      (any ? '<div class="inv-cv fig">'+money0(S.value)+'</div>'+
        '<div class="inv-cs"><b class="'+tone(S.total)+'">'+signed(S.total)+'</b> all time'+(S.totalPct!==null?' · '+pctTxt(S.totalPct):'')+'</div>'+
        '<div class="inv-spark">'+invChartSVG(ser, {h:44, colour: C.type==='crypto' ? '#d9b44a' : '#8fd3ff', label:C.name+' over the last year'})+'</div>'+
        '<div class="inv-alloc">'+S.held.map(p=> '<i style="flex:'+Math.max(p.value,0.0001)+';background:'+symColour(p.sym)+'"></i>').join('')+'</div>'
      : '<div class="inv-cs">'+(C.type==='crypto' ? 'Import your Coinbase history, or add what you hold by hand.' : 'Import a file from your broker, or add what you hold by hand.')+'</div>')+
    '</button>';
  }).join('') + '<button class="inv-addcat" id="inv-addcat"><i class="ti ti-plus" aria-hidden="true"></i>Add a category</button>';
  document.getElementById('inv-addcat').onclick = ()=> openInvCatSheet(null);
  box.querySelectorAll('[data-invcat]').forEach(b=> b.onclick = ()=> openInv(b.dataset.invcat));
}

// Full-screen pages: a category, then a coin inside it.
let invOpen = false, invStack = [], invRange = {};
function openInv(cat, sym){
  invStack = [{cat}]; if(sym) invStack.push({cat, sym});
  invOpen = true;
  const el = document.getElementById('inv');
  el.hidden = false; document.body.classList.add('ci-open');
  invDraw();
}
function invBack(){
  invStack.pop();
  if(!invStack.length){ invOpen = false; document.getElementById('inv').hidden = true; document.body.classList.remove('ci-open'); return; }
  invDraw();
}
function invDraw(){
  const top = invStack[invStack.length-1];
  memoBegin();
  try{
    document.getElementById('inv-title').textContent = top.sym ? symName(top.cat, top.sym) : invCatInfo(top.cat).name;
    const ed = document.getElementById('inv-edit');
    ed.textContent = top.sym ? 'Rename' : 'Edit';
    document.getElementById('inv-body').innerHTML = top.sym ? invCoinHTML(top.cat, top.sym) : invCatHTML(top.cat);
  } finally { memoEnd(); }
  const body = document.getElementById('inv-body');
  body.scrollTop = 0;
  body.querySelectorAll('[data-range]').forEach(b=> b.onclick = ()=>{ invRange[top.cat+':'+(top.sym||'')] = b.dataset.range; invDraw(); });
  body.querySelectorAll('[data-invsym]').forEach(b=> b.onclick = ()=>{ invStack.push({cat:top.cat, sym:b.dataset.invsym}); invDraw(); });
  body.querySelectorAll('[data-invtoggle]').forEach(b=> b.onclick = ()=>{ const sec = b.closest('.inv-sec'); sec.classList.toggle('open'); if(b.classList.contains('more-row')) b.textContent = sec.classList.contains('open') ? 'Show less' : 'Show all '+sec.querySelectorAll('.lrow').length; });
  const sold = document.getElementById('inv-sold'); if(sold) sold.onclick = ()=> openInvEntry({cat:top.cat, sym:top.sym, kind:'sell'});
  const more = document.getElementById('inv-more'); if(more) more.onclick = ()=> openInvEntry({cat:top.cat, sym:top.sym, kind:'buy'});
  const hb = document.getElementById('inv-hold'); if(hb) hb.onclick = ()=> openHoldEdit(top.cat, top.sym);
  body.querySelectorAll('[data-inv-import]').forEach(b=> b.onclick = ()=> invPickFile(top.cat));
  body.querySelectorAll('[data-inv-add]').forEach(b=> b.onclick = ()=> openInvEntry({cat:top.cat, kind:'buy', fresh:true}));
  body.querySelectorAll('[data-entry]').forEach(r=> r.onclick = ()=> { const t = invest.trades.find(x=>x.id===r.dataset.entry); if(t) openInvEntry({edit:t}); });
}
function invCatHTML(cat){
  const S = invCategory(cat), C = invCatInfo(cat);
  const actions = '<div class="inv-btns inv-acts"><button class="btn ghost" data-inv-import><i class="ti ti-download" aria-hidden="true"></i> Import file</button>'+
    '<button class="btn ghost" data-inv-add><i class="ti ti-plus" aria-hidden="true"></i> Add by hand</button></div>';
  if(!S.held.length && !S.past.length && !(S.putIn > 0) && !(S.takenOut > 0)){
    return '<div class="estate"><i class="ti ti-chart-line" aria-hidden="true"></i><div class="et">Nothing in '+esc(C.name)+' yet</div>'+
      '<div class="es">'+(C.type==='crypto' ? 'Import your Coinbase history file, or add what you hold by hand.' : 'Import your broker\'s history file (Pearler, Trading 212 and most others), or add by hand.')+'</div></div>'+
      actions;
  }
  const rk = invRange[cat+':'] || '1y';
  const ser = rangeSeries(invSeries(cat), rk);
  const years = Object.keys(S.years).sort().reverse();
  const yr = String(new Date().getFullYear());
  const thisY = S.years[yr] || {putIn:0, takenOut:0, realised:0, fees:0};
  return ''+
    '<div class="inv-hero">'+
      '<div class="inv-lab">Worth now</div>'+
      '<div class="inv-big fig">'+moneyPair0(S.value)+'</div>'+
      '<div class="inv-sub"><b class="'+tone(S.total)+'">'+signed(S.total)+'</b> all time'+(S.totalPct!==null?' ('+pctTxt(S.totalPct)+' on what you put in)':'')+'</div>'+
      rangeChips(rk)+
      '<div class="inv-chart">'+invChartSVG(ser, {label:C.name+' value'})+'</div>'+axisLabels(ser)+
    '</div>'+
    actions+
    '<div class="inv-grid">'+
      statTile('Put in', money0(S.putIn), '', 'from your bank')+
      statTile('Taken out', money0(S.takenOut), '', 'back to your bank')+
      (!Object.keys(S.P).length && (S.putIn || S.takenOut)
        ? statTile('Result', signed(S.total), tone(S.total), 'taken out minus put in')
        : statTile('Profit from sales', signed(S.realised), tone(S.realised), 'already locked in'))+
      statTile('Not yet sold', signed(S.unreal), tone(S.unreal), S.cost>0 ? pctTxt(S.unreal/S.cost*100)+' on cost' : '')+
      statTile(C.reward, money0(S.rewards), S.rewards>0.5?'in':'', C.rewardSub)+
      statTile('Fees', money0(S.fees), '', money0(thisY.fees)+' this year')+
    '</div>'+
    (S.held.length ? '<div class="rule">Holding now</div>'+
    '<div class="inv-alloc big">'+S.held.map(p=> '<i style="flex:'+p.value+';background:'+symColour(p.sym)+'"></i>').join('')+'</div>'+
    '<div class="card">'+S.held.map(p=> invRowHTML(cat, p, S.value)).join('')+'</div>'
    : '<div class="rule">Holding now</div><div class="card"><div class="lrow"><div><div class="d1">Nothing held right now</div><div class="d2">'+
      (S.putIn||S.takenOut ? 'From your files: '+money0(S.putIn)+' went in, '+money0(S.takenOut)+' came back out.' : '')+'</div></div></div></div>')+
    '<div class="rule">By year</div>'+
    '<div class="card inv-years"><div class="iy-row iy-h"><span></span><b>Put in</b><b>Taken out</b><b>Sales profit</b></div>'+
      years.map(y=>{ const a = S.years[y]; return '<div class="iy-row"><span>'+y+'</span><b class="fig">'+money0(a.putIn)+'</b><b class="fig">'+money0(a.takenOut)+'</b><b class="fig '+tone(a.realised)+'">'+(Object.keys(S.P).length ? signed(a.realised) : '—')+'</b></div>'; }).join('')+
    '</div>'+
    (S.past.length ? '<div class="inv-sec"><button class="rule fold-h inv-sec-h" data-invtoggle>Past '+C.units+' <span class="fold-r"><b>'+S.past.length+' · '+signed(S.past.reduce((t,p)=>t+p.realised,0))+'</b><i class="ti ti-chevron-down"></i></span></button>'+
      '<div class="inv-sec-b"><div class="card">'+S.past.map(p=>
        '<button class="lrow tap inv-row" data-invsym="'+esc(p.sym)+'"><span class="inv-dot" style="background:'+symColour(p.sym)+'">'+esc(p.sym.slice(0,4))+'</span>'+
        '<div><div class="d1">'+esc(symName(cat,p.sym))+'</div><div class="d2">'+p.first.slice(0,4)+(p.last.slice(0,4)!==p.first.slice(0,4)?'–'+p.last.slice(2,4):'')+' · sold for '+money0(p.sold)+'</div></div>'+
        '<div class="amtcol"><b class="fig '+tone(p.realised)+'">'+signed(p.realised)+'</b><span class="sub">profit</span></div></button>').join('')+'</div></div></div>' : '')+
    '<p class="note" style="margin-top:14px;">'+(C.type==='crypto' ? 'Values update by themselves when you are online.' : 'Update values on Sundays, or tap a holding to edit it.')+' In pounds at each day\'s rate.</p>';
}
function invRowHTML(cat, p, total){
  const ser = rangeSeries(invSeries(cat, p.sym), '3m');
  return '<button class="lrow tap inv-row" data-invsym="'+esc(p.sym)+'">'+
    '<span class="inv-dot" style="background:'+symColour(p.sym)+'">'+esc(p.sym.slice(0,4))+'</span>'+
    '<div><div class="d1">'+esc(symName(cat,p.sym))+'</div><div class="d2">'+fmtQty(p.qty)+' '+esc(p.sym)+' · '+Math.round(p.value/Math.max(total,1e-9)*100)+'%</div></div>'+
    '<div class="inv-mini">'+invChartSVG(ser, {h:30, colour:symColour(p.sym), label:p.sym+' last 3 months'})+'</div>'+
    '<div class="amtcol">'+moneyPair0(p.value)+'<span class="sub '+tone(p.unreal)+'">'+pctTxt(p.unrealPct)+'</span></div>'+
  '</button>';
}
function invCoinHTML(cat, sym){
  const S = invCategory(cat), p = S.P[sym];
  if(!p) return '';
  const rk = invRange[cat+':'+sym] || 'all';
  const ser = rangeSeries(invSeries(cat, sym), rk);
  // Daily staking rewards are grouped by month, so the list stays readable.
  const hist = [], rw = {};
  for(const t of p.trades.slice().reverse()){
    if(t.kind === 'reward' && t.src === 'coinbase'){ const m = t.date.slice(0,7); if(!rw[m]){ rw[m] = {kind:'rewardm', date:m+'-01', qty:0, gbp:0, n:0}; hist.push(rw[m]); } rw[m].qty += t.qty; rw[m].gbp += t.gbp; rw[m].n++; }
    else hist.push(t);
  }
  const LBL = {buy:'Bought', sell:'Sold', in:'Moved in', out:'Moved out', rewardm:'Rewards', reward:invCatInfo(cat).reward, value:'Value update', adjust:'Amount corrected'};
  const years = Object.keys(p.years).sort().reverse();
  const col = symColour(sym);
  return ''+
    '<div class="inv-hero">'+
      '<div class="inv-coinhead"><span class="inv-dot lg" style="background:'+col+'">'+esc(sym.slice(0,4))+'</span><div><div class="inv-lab">'+(p.held ? 'You hold '+fmtQty(p.qty)+' '+esc(sym) : 'All sold')+'</div>'+
        '<div class="inv-big fig">'+(p.held ? moneyPair0(p.value) : signed(p.realised))+'</div></div></div>'+
      '<div class="inv-sub">'+(p.held
        ? '<b class="'+tone(p.unreal)+'">'+signed(p.unreal)+'</b> not yet sold'+(p.unrealPct!==null?' ('+pctTxt(p.unrealPct)+')':'')
        : 'profit from selling it')+'</div>'+
      rangeChips(rk)+
      '<div class="inv-chart">'+invChartSVG(ser, {colour:col, label:'Value of your '+sym})+'</div>'+axisLabels(ser)+
    '</div>'+
    '<div class="inv-grid">'+
      (byValue(cat,sym) ? statTile('Worth now', money0(p.value), '', 'what you last logged') : statTile('Price now', moneyPair(p.price), '', p.held ? 'you paid '+money(p.avg)+' on average' : ''))+
      statTile('Cost of what you hold', money0(p.cost), '', '')+
      statTile('Bought', money0(p.bought), '', 'in total')+
      statTile('Sold for', money0(p.sold), '', '')+
      statTile('Profit from sales', signed(p.realised), tone(p.realised), 'locked in')+
      statTile(invCatInfo(cat).reward, money0(p.rewards), p.rewards>0.5?'in':'', p.rewardQty ? fmtQty(p.rewardQty)+' '+esc(sym)+' free' : '')+
      statTile('Fees', money0(p.fees), '', '')+
      statTile('First bought', parseYMD(p.first).toLocaleDateString('en-GB',{month:'short', year:'numeric'}), '', p.n+' entries')+
    '</div>'+
    '<div class="inv-btns"><button class="btn ghost" id="inv-more">I bought more</button><button class="btn ghost" id="inv-sold"'+(p.held?'':' disabled')+'>I sold some</button></div>'+
    '<button class="btn" id="inv-hold" style="margin-top:8px;">Edit what you hold</button>'+
    '<div class="rule">By year</div>'+
    '<div class="card inv-years"><div class="iy-row iy-h"><span></span><b>Bought</b><b>Sold</b><b>Sales profit</b></div>'+
      years.map(y=>{ const a = p.years[y]; return '<div class="iy-row"><span>'+y+'</span><b class="fig">'+money0(a.bought)+'</b><b class="fig">'+money0(a.sold)+'</b><b class="fig '+tone(a.realised)+'">'+(a.sold?signed(a.realised):'—')+'</b></div>'; }).join('')+
    '</div>'+
    '<div class="rule">History</div>'+
    '<div class="inv-sec'+(hist.length<=8?' open':'')+'"><div class="card">'+hist.slice(0, 200).map((t,i)=>{
      const d = t.kind==='rewardm' ? parseYMD(t.date).toLocaleDateString('en-GB',{month:'long', year:'numeric'}) : prettyDate(t.date);
      const sub = t.kind==='rewardm' ? t.n+' payouts · '+fmtQty(t.qty)+' '+esc(sym) : fmtQty(t.qty)+' '+esc(sym)+(t.price?' at '+money(t.price):'');
      const out = t.kind==='sell' || t.kind==='out';
      const subx = t.kind==='value' ? 'worth '+money(t.gbp) : t.kind==='adjust' ? (t.qty>0?'+':'−')+fmtQty(Math.abs(t.qty))+' '+esc(sym) : (byValue(cat,sym) && t.kind==='buy') ? 'money added' : sub;
      return '<div class="lrow'+(t.id?' tap" data-entry="'+esc(t.id):'')+'"><div><div class="d1">'+LBL[t.kind]+'</div><div class="d2">'+d+' · '+subx+'</div></div>'+
        '<div class="amtcol"><b class="fig '+(t.kind==='rewardm'||t.kind==='reward'?'in':'')+'">'+(t.kind==='value'||t.kind==='adjust' ? '' : t.gbp>0 && t.gbp<0.005 ? '+&lt;£0.01' : (out?'−':'+')+money(t.gbp))+'</b></div></div>';
    }).join('').replace(/<div class="lrow/g, (()=>{ let i = 0; return m=> (++i > 8 ? '<div class="inv-extra lrow' : m); })())+
    (hist.length>8 ? '<button class="more-row" data-invtoggle>Show all '+hist.length+'</button>' : '')+'</div></div>';
}

document.getElementById('inv-back').onclick = invBack;
// Used by the investments page, the Sunday check-in and the main Import
// button: a Coinbase file is recognised wherever it is dropped in.
async function runCoinbaseImport(text){
  showToast('Reading your Coinbase history…');
  const r = await importCoinbase(text);
  if(r.error){ hideToast(); alert(r.error); return null; }
  settings.lastInvImport = todayYMD(); save(K.settings, settings);
  render(); if(invOpen) invDraw();
  if(typeof ciOpen !== 'undefined' && ciOpen && typeof ciRefresh === 'function') ciRefresh();
  showToast(r.added ? r.added+' new entr'+(r.added===1?'y':'ies')+' added' : 'Nothing new - you are up to date');
  if(r.added){ sfx('typewriter'); fetchInvHistory(); }
  return r;
}
// Which category the next file goes into. A Coinbase file always goes to
// your Crypto; anything else opens the column matcher for this category.
let invFileCat = null;
function invPickFile(cat){ invFileCat = cat; document.getElementById('inv-file').click(); }
document.getElementById('inv-file').addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const cat = invFileCat; invFileCat = null;
  const rd = new FileReader();
  rd.onload = ()=>{
    const text = String(rd.result);
    if(isCoinbaseCSV(text)){ runCoinbaseImport(text); return; }
    if(!cat){ alert('That is not a Coinbase history file. Open the category it belongs to and import it there.'); return; }
    openInvImport(cat, text, f.name);
  };
  rd.readAsText(f); e.target.value = '';
});
setTimeout(()=>{ if(navigator.onLine !== false){ refreshInvPrices(); fetchInvHistory(); } }, 2500);