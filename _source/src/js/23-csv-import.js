// ============================================================
// CSV import
// ============================================================
function parseCSV(text){
  const rows = []; let row = []; let cur = ''; let q = false;
  text = text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(q){
      if(c === '"'){ if(text[i+1] === '"'){ cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if(c === '"') q = true;
      else if(c === ','){ row.push(cur); cur = ''; }
      else if(c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else if(c === '\r'){ /* skip */ }
      else cur += c;
    }
  }
  if(cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r=> r.some(c=>String(c).trim() !== ''));
}

const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
// A statement line is filed under a date. Banks increasingly export a
// timestamp — "2026-08-01 13:20:11" from Revolut, ISO with a T and a zone from
// others — and the time is never what the row belongs to. Strip it before
// anything else looks at the string: without this the split on / - . left
// "01 13:20:11" as the day, which is NaN, so EVERY row failed to parse and the
// whole import came back empty.
const TIME_TAIL = /[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i;
function stripTime(s){ return String(s == null ? '' : s).trim().replace(TIME_TAIL, '').trim(); }

function parseDate(s, fmt){
  s = stripTime(s);
  if(!s) return null;
  if(fmt==='dmy-txt'){
    const m = s.match(/(\d{1,2})\s*([A-Za-z]{3})[a-z]*\s*(\d{2,4})/);
    if(!m) return null;
    const mo = MONTHS[m[2].toLowerCase()];
    if(mo === undefined) return null;
    let y = Number(m[3]); if(y < 100) y += 2000;
    return ymd(new Date(y, mo, Number(m[1])));
  }
  const p = s.split(/[\/\-\.]/).map(x=>x.trim());
  if(p.length < 3) return null;
  let d,mo,y;
  if(fmt==='ymd'){ y=+p[0]; mo=+p[1]; d=+p[2]; }
  else if(fmt==='mdy'){ mo=+p[0]; d=+p[1]; y=+p[2]; }
  else { d=+p[0]; mo=+p[1]; y=+p[2]; }
  if(!d || !mo || !y) return null;
  if(y < 100) y += 2000;
  if(mo > 12 || d > 31) return null;
  return ymd(new Date(y, mo-1, d));
}
function parseAmount(s){
  if(s == null) return null;
  let t = String(s).replace(/[£$€,\s]/g,'').trim();
  if(!t) return null;
  let neg = false;
  if(/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1,-1); }
  if(t.startsWith('-')){ neg = true; t = t.slice(1); }
  if(t.startsWith('+')) t = t.slice(1);
  const n = Number(t);
  if(!isFinite(n)) return null;
  return neg ? -n : n;
}
const txnHash = t => [t.date, t.amount.toFixed(2), String(t.desc||'').toLowerCase().replace(/\s+/g,'').slice(0,24), t.acct].join('|');

let impRows = null, impCols = [];

document.getElementById('open-import').onclick = ()=>{
  if(accts.length===0){ alert('Add an account first: tap the gear, then Set up, then Accounts.'); return; }
  fillSelect(document.getElementById('imp-acct'), accts);
  // Default to the base currency, so an ordinary statement imports exactly as
  // it always did and nobody has to think about currency at all.
  impFx = {cur: curCode(), rate: 1, rateDate: null, source: null};
  buildCurrencySelect(document.getElementById('imp-cur'), curCode());
  const rt = document.getElementById('imp-rate'); if(rt) rt.value = '';
  const fr = document.getElementById('imp-fx-row'); if(fr) fr.style.display = 'none';
  const fn = document.getElementById('imp-fx-note'); if(fn) fn.textContent = '';
  impFxRates = {};
  const mb = document.getElementById('imp-multi'); if(mb) mb.innerHTML = '';
  const sc = document.getElementById('imp-cur'); if(sc) sc.disabled = false;
  document.getElementById('imp-step1').style.display = 'block';
  document.getElementById('imp-step2').style.display = 'none';
  document.getElementById('imp-file').value = '';
  renderImportFrom();
  openSheet('import-backdrop');
};

// The date to download from, for whichever account is selected. Rendered on
// open and again on every change, because two accounts are almost never
// imported up to the same day.
function renderImportFrom(){
  const box = document.getElementById('imp-from');
  const sel = document.getElementById('imp-acct');
  if(!box || !sel) return;
  const acctId = sel.value || null;
  const r = importRangeLine(acctId);
  const last = lastStatementDate(acctId);
  box.innerHTML = '<i class="ti ti-calendar" aria-hidden="true"></i><div>'+
    (r.from ? r.text.replace(/^Start from ([^\s—]+ [^\s—]+)/, 'Start from <b>$1</b>') : r.text)+
    (last ? '<span class="sub">Ledger has '+esc(acctById(acctId).name)+
            ' up to '+fmtDay(last)+'. Anything after that is missing.</span>' : '')+
    '</div>';
}
document.getElementById('imp-acct').addEventListener('change', renderImportFrom);
document.getElementById('imp-cur').addEventListener('change', ()=>{
  syncImportFxUI();
  // A rate for the previous currency must never be reused for a new one.
  if((impFx.cur||curCode()) !== curCode()){
    document.getElementById('imp-rate').value = '';
    impFx.rate = 0;
    fetchImportRate();
  }
});
document.getElementById('imp-rate').addEventListener('input', (e)=>{
  impFx.rate = Number(e.target.value) || 0;
  impFx.source = 'typed in';
  previewImport();
});
document.getElementById('imp-rate-fetch').onclick = ()=> fetchImportRate();

document.getElementById('imp-back').onclick = ()=>{
  document.getElementById('imp-step1').style.display = 'block';
  document.getElementById('imp-step2').style.display = 'none';
  document.getElementById('imp-file').value = '';
};

// A cheap content fingerprint of the file itself. Row-level checks already
// catch most re-imports, but they run after the mapping is set and they can be
// defeated by a different column mapping producing different descriptions.
// Recognising the FILE means the warning arrives before any of that.
function fileSig(text){
  const s = String(text);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for(let i=0;i<s.length;i++){
    const c = s.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = ((h2 + c) * 31 + (i & 255)) >>> 0;
  }
  return s.length.toString(36)+'-'+h1.toString(36)+'-'+h2.toString(36);
}

function importedSigs(){
  const v = settings.importSigs;
  return Array.isArray(v) ? v : [];
}
function rememberSig(sig, rows){
  // Bounded: the last 40 files is far more history than anyone needs, and this
  // rides along inside settings, which is written on every change.
  const list = importedSigs().filter(x=>x && x.sig !== sig);
  list.push({sig, rows, at: todayYMD()});
  while(list.length > 40) list.shift();
  settings.importSigs = list;
  save(K.settings, settings);
}

let pendingSig = null;

// Rates for a multi-currency statement, one entry per currency found in it.
// {CODE: {series:{ymd:rate}|null, rate:Number|0, date, source, manual:bool}}
let impFxRates = {};

// The rate for one currency on one day: the published rate for that date when a
// series was fetched, otherwise the single current rate as a fallback.
function resolveRowRate(code, day){
  if(code === curCode()) return 1;
  const e = impFxRates[code];
  if(!e) return 0;
  if(e.series){
    const r = rateOnOrBefore(e.series, day);
    if(r > 0) return r;
  }
  return Number(e.rate) || 0;
}

// The currencies a mapped currency column actually contains, so rates are only
// fetched for money that is really in the file.
function currenciesInFile(){
  const ci = impCols.indexOf('cur');
  if(ci < 0 || !impRows) return [];
  const skip = document.getElementById('imp-header').value === 'yes' ? 1 : 0;
  const seen = {};
  for(let r = skip; r < impRows.length; r++){
    const raw = String((impRows[r]||[])[ci] || '').trim().toUpperCase();
    if(CURRENCIES[raw] && raw !== curCode()) seen[raw] = true;
  }
  return Object.keys(seen);
}

// The span the statement covers, so one series request per currency covers it.
function fileDateRange(){
  const di = impCols.indexOf('date');
  const d2i = impCols.indexOf('date2');
  if(di < 0 || !impRows) return null;
  const fmt = document.getElementById('imp-datefmt').value;
  const skip = document.getElementById('imp-header').value === 'yes' ? 1 : 0;
  let lo = null, hi = null;
  for(let r = skip; r < impRows.length; r++){
    const row = impRows[r] || [];
    // Same fallback as the import itself, or a pending row at the edge of the
    // statement would shorten the span the rates are fetched for.
    const d = parseDate(row[di], fmt) || (d2i >= 0 ? parseDate(row[d2i], fmt) : null);
    if(!d) continue;
    if(!lo || d < lo) lo = d;
    if(!hi || d > hi) hi = d;
  }
  return lo && hi ? {d1: lo, d2: hi} : null;
}

async function loadImportRates(){
  const codes = currenciesInFile();
  const note = document.getElementById('imp-fx-note');
  const row = document.getElementById('imp-fx-row');
  if(!codes.length){ impFxRates = {}; previewImport(); return; }
  if(row) row.style.display = 'none';        // per-row mode: the single-rate box does not apply
  if(note) note.textContent = '';
  const box = document.getElementById('imp-multi');
  if(box) box.innerHTML = '<div class="note">Looking up rates for '+codes.join(', ')+'...</div>';

  const range = fileDateRange();
  for(const c of codes){
    if(impFxRates[c] && impFxRates[c].manual) continue;   // never overwrite a typed rate
    const e = {series:null, rate:0, date:null, source:null, manual:false};
    if(range){
      try{ e.series = await fetchRateSeries(c, curCode(), range.d1, range.d2); }catch(err){}
    }
    if(e.series){
      const days = Object.keys(e.series).sort();
      e.date = days[days.length-1];
      e.rate = e.series[e.date];
      e.source = 'rate on each transaction date';
    } else {
      try{
        const r = await fetchRate(c, curCode());
        e.rate = r.rate; e.date = r.date; e.source = "today's rate for every row";
      }catch(err){ e.source = null; }
    }
    impFxRates[c] = e;
  }
  renderImportMulti();
  previewImport();
}

// One row per currency found, each with its own override box. A rate you type
// wins over anything fetched and is never overwritten by a later refresh.
function renderImportMulti(){
  const box = document.getElementById('imp-multi');
  if(!box) return;
  const codes = currenciesInFile();
  if(!codes.length){ box.innerHTML = ''; return; }
  box.innerHTML = '<span class="lab" style="margin-top:14px;">Currencies found in this file</span>' +
    codes.map(c=>{
      const e = impFxRates[c] || {};
      const ok = Number(e.rate) > 0;
      return '<div class="card pad" style="margin-bottom:8px;">'+
        '<div style="display:flex; justify-content:space-between; align-items:baseline;">'+
        '<b style="font-size:13.5px;">'+esc(c)+' → '+esc(curCode())+'</b>'+
        '<span class="fig" style="color:'+(ok?'var(--brass)':'var(--out)')+';">'+
          (ok ? Number(e.rate).toFixed(4) : 'no rate')+'</span></div>'+
        '<div class="note" style="margin-top:3px;">'+
          (e.source ? esc(e.source) : 'Could not fetch a rate — type one below')+'</div>'+
        '<input type="number" step="0.000001" inputmode="decimal" data-impcur="'+esc(c)+'" '+
          'placeholder="Or type the rate" value="'+(e.manual && ok ? Number(e.rate) : '')+'" '+
          'style="margin-top:8px;">'+
        '</div>';
    }).join('');
  box.querySelectorAll('[data-impcur]').forEach(inp=>{
    inp.addEventListener('input', (ev)=>{
      const c = ev.target.dataset.impcur;
      const v = Number(ev.target.value) || 0;
      if(v > 0){
        // A typed rate replaces the series outright — a single number cannot be
        // date-aware, and pretending otherwise would be worse than honest.
        impFxRates[c] = {series:null, rate:v, date:todayYMD(), source:'rate you typed in', manual:true};
      } else if(impFxRates[c]){
        impFxRates[c].manual = false;
      }
      previewImport();
    });
  });
}

// What the file's amounts are in, and the rate to the base currency.
// rate === 1 and cur === base is the ordinary case: no conversion at all.
let impFx = {cur: null, rate: 1, rateDate: null, source: null};

function impFxTarget(){ return curCode(); }

function buildCurrencySelect(el, selected){
  if(!el) return;
  el.innerHTML = Object.keys(CURRENCIES).map(c=>
    '<option value="'+c+'"'+(c===selected?' selected':'')+'>'+c+' — '+CURRENCIES[c].name+'</option>').join('');
}

function syncImportFxUI(){
  const sel = document.getElementById('imp-cur');
  const row = document.getElementById('imp-fx-row');
  if(!sel || !row) return;
  const cur = sel.value || curCode();
  impFx.cur = cur;
  // A mapped currency column takes over completely: the file says what each row
  // is in, so a single sheet-wide choice would only be able to contradict it.
  if(impCols.indexOf('cur') >= 0){
    row.style.display = 'none';
    sel.disabled = true;
    previewImport();
    return;
  }
  sel.disabled = false;
  const foreign = cur !== curCode();
  row.style.display = foreign ? 'block' : 'none';
  document.getElementById('imp-fx-target').textContent = curCode();
  document.getElementById('imp-fx-source').textContent = cur;
  if(!foreign){
    impFx.rate = 1; impFx.rateDate = null; impFx.source = null;
    document.getElementById('imp-fx-note').textContent = '';
  }
  previewImport();
}

async function fetchImportRate(){
  const note = document.getElementById('imp-fx-note');
  const from = impFx.cur || curCode(), to = curCode();
  if(from === to) return;
  note.textContent = 'Looking up the rate...';
  try{
    const r = await fetchRate(from, to);
    impFx.rate = r.rate; impFx.rateDate = r.date; impFx.source = r.source || null;
    document.getElementById('imp-rate').value = r.rate;
    note.innerHTML = '1 '+from+' = '+r.rate.toFixed(4)+' '+to+
      ' · rate from '+prettyDate(r.date)+(r.source?' ('+esc(r.source)+')':'');
  }catch(err){
    note.innerHTML = '<b style="color:var(--out)">Could not reach a rate service.</b> '+
      'Type the rate in above — look it up anywhere and it works exactly the same.';
  }
  previewImport();
}

document.getElementById('imp-file').addEventListener('change', e=>{
  const f = e.target.files[0];
  if(!f) return;
  const rd = new FileReader();
  rd.onload = ()=>{
    const text = String(rd.result);
    // v57: a Coinbase history is investments, not a bank statement.
    if(typeof isCoinbaseCSV === 'function' && isCoinbaseCSV(text)){
      document.getElementById('imp-file').value = '';
      if(typeof closeSheet === 'function') closeSheet('import-backdrop');
      runCoinbaseImport(text);
      return;
    }
    impRows = parseCSV(text);
    if(impRows.length < 2){ alert('That file has no rows Ledger can read. Make sure it is a CSV export, not a PDF statement.'); return; }
    pendingSig = fileSig(text);
    const seen = importedSigs().find(x=>x.sig === pendingSig);
    if(seen){
      const when = seen.at ? prettyDate(seen.at) : 'earlier';
      if(!confirm('You have imported this exact file before, on '+when+'.\n\n'+
        'Everything in it is already in Ledger. Importing it again is what inflates '+
        'your spending.\n\nOpen it anyway? Ledger will still skip anything it recognises.')){
        document.getElementById('imp-file').value = '';
        pendingSig = null;
        return;
      }
    }
    buildImportMapper();
    document.getElementById('imp-step1').style.display = 'none';
    document.getElementById('imp-step2').style.display = 'block';
  };
  rd.onerror = ()=> alert('Could not read that file.');
  rd.readAsText(f);
});

// Guess what each column is, so most banks need no fiddling at all.
// "CARD 123456" and "TFR 0098" tell you nothing. A column earns its place in
// the description only if its values contain real words that vary between rows.
function looksInformative(vals){
  if(!vals.length) return false;
  const strs = vals.map(v=>String(v).trim()).filter(Boolean);
  if(!strs.length) return false;
  const wordy = strs.filter(s=>{
    const letters = (s.match(/[A-Za-z]/g)||[]).length;
    const digits  = (s.match(/[0-9]/g)||[]).length;
    // mostly digits, or a single short token, is a reference not a name
    if(letters < 3) return false;
    if(digits > letters) return false;
    return /[A-Za-z]{3,}/.test(s);
  }).length;
  const distinct = new Set(strs.map(s=>s.toLowerCase())).size;
  // varied AND wordy — a column that says "CARD PAYMENT" on every row is noise
  return wordy >= Math.ceil(strs.length * 0.6) && distinct > 1;
}

// COMPLETED / PENDING / REVERTED — a handful of shouted words repeated down
// the column. Recognised by shape as well as by header, because plenty of
// exports call this column something else.
const STATUS_WORDS = /^(completed|complete|posted|settled|pending|processing|reverted|reversed|declined|failed|cancelled|canceled|rejected|refunded|authorised|authorized|hold|booked)$/i;
function looksLikeStatus(vals){
  const strs = vals.map(v=>String(v).trim()).filter(Boolean);
  if(strs.length < 2) return false;
  return strs.every(s=>STATUS_WORDS.test(s));
}

// CARD_PAYMENT, TOPUP, ATM, DIRECT DEBIT — a small fixed vocabulary shouted in
// caps or snake case, repeating down the column. Not a merchant name.
function looksLikeEnum(vals){
  const strs = vals.map(v=>String(v).trim()).filter(Boolean);
  if(strs.length < 3) return false;
  // The shape alone is not enough: "TESCO STORES 3456" is also shouted. What
  // separates a vocabulary from a list of merchants is that a vocabulary
  // repeats. Loose enough to survive a short sample — four rows of Revolut can
  // easily hold three different types.
  const distinct = new Set(strs.map(s=>s.toLowerCase())).size;
  if(distinct > Math.max(2, Math.ceil(strs.length * 0.7))) return false;
  return strs.every(s=>/^[A-Z][A-Z0-9 _\-]*$/.test(s) || /_/.test(s));
}

// Money that never moved. Importing a reversal as spending is simply false.
const DEAD_STATUS = /^(reverted|reversed|declined|failed|cancelled|canceled|rejected)$/i;

// A reference is a number the bank uses to talk to itself. It is not what you
// bought. "CARD 445512" on every row, a bare 16-digit string, an auth code —
// none of them belong in a description, whatever the column is titled.
function looksLikeReference(vals){
  const strs = vals.map(v=>String(v).trim()).filter(Boolean);
  if(!strs.length) return false;
  // The identical string on every row distinguishes nothing.
  const distinct = new Set(strs.map(s=>s.toLowerCase())).size;
  if(distinct === 1 && strs.length > 2) return true;
  const refish = strs.filter(s=>{
    const letters = (s.match(/[A-Za-z]/g)||[]).length;
    const digits  = (s.match(/[0-9]/g)||[]).length;
    if(digits === 0) return false;
    if(digits >= letters) return true;                       // 445512 · CARD 445512
    // "Card transaction 4455" — a known reference word plus a run of digits.
    return /^(card|ref|reference|txn|trans|tx|pos|auth|visa|mc|mastercard)\b/i.test(s) && digits >= 4;
  }).length;
  return refish >= Math.ceil(strs.length * 0.6);
}

// Among several columns claiming the same role, keep the most plausible rather
// than the leftmost. Wise puts its FEE amount before the real amount, so
// leftmost was actively wrong.
function pickBestColumn(out, role, header, score){
  const idxs = [];
  for(let i=0;i<out.length;i++) if(out[i] === role) idxs.push(i);
  if(idxs.length <= 1) return;
  let best = idxs[0], bestScore = -Infinity;
  for(const i of idxs){
    // Ties break leftward, which is the old behaviour and usually right.
    const s = score(header[i] || '', i) - i * 0.01;
    if(s > bestScore){ bestScore = s; best = i; }
  }
  for(const i of idxs) if(i !== best) out[i] = 'ignore';
}

function guessCols(rows){
  const header = rows[0].map(h=>String(h).toLowerCase());
  const body = rows.slice(1, 12);
  const n = rows[0].length;
  const out = [];
  for(let i=0;i<n;i++){
    const h = header[i]||'';
    const vals = body.map(r=>r[i]).filter(v=>String(v||'').trim()!=='');
    let g = 'ignore';
    // An ID or row number is unique per row and tells you nothing about what
    // the transaction was — it would only clutter every description.
    if(/\b(id|uuid|guid|transaction number|txn no|row)\b/.test(h)) g = 'ignore';
    else if(/date/.test(h)) g = 'date';
    else if(/(paid in|money in|credit|received)/.test(h)) g = 'in';
    else if(/(paid out|money out|debit|spent)/.test(h)) g = 'out';
    else if(/(amount|value)/.test(h)) g = 'amount';
    // Who the money went to or came from — under any of the names a bank
    // gives that column. `payer` and `payee` differ by one letter and describe
    // opposite directions, and only one of them used to match.
    else if(/(merchant|payee|payer|counterparty|beneficiary|recipient|sender|remitter|other party|paid to|paid by|to name|from name)/.test(h)) g = 'desc';
    else if(/(desc|narrative|detail|particulars|note|memo|reason)/.test(h)) g = 'desc';
    // Explicitly never a description, however the column is titled.
    else if(/(auth code|authorisation|authorization|arn|mandate)/.test(h)) g = 'ignore';
    // A status column reads as varied words, so the description heuristic used
    // to take it and staple "COMPLETED" onto every merchant name — which also
    // breaks merchant matching, and with it duplicate detection.
    else if(/\b(state|status)\b/.test(h) || looksLikeStatus(vals)) g = 'status';
    // Same for a transaction type. It is worth keeping, just not as the name of
    // what you bought.
    else if(/\b(type|kind)\b/.test(h) && looksLikeEnum(vals)) g = 'type';
    // A "reference" column is often just a card number. Keep it only when it
    // actually carries words — otherwise it crowds out the real merchant name.
    // A currency column is what makes a holiday statement readable. Match the
    // header, or the values themselves being nothing but currency codes.
    else if(/(currency|ccy|curr\b)/.test(h)) g = 'cur';
    else if(vals.length >= 2 && vals.every(v=>CURRENCIES[String(v).trim().toUpperCase()])) g = 'cur';
    else if(/(ref|name|type|category)/.test(h)) g = looksInformative(vals) ? 'desc' : 'ignore';
    else if(vals.length && vals.every(v=>parseDate(v,'dmy') || parseDate(v,'ymd') || parseDate(v,'dmy-txt'))) g = 'date';
    else if(vals.length && vals.every(v=>parseAmount(v)!==null)) g = 'amount';
    else if(vals.length && looksInformative(vals)) g = 'desc';

    // The informativeness test used to run only on "reference"-ish headers, so a
    // column headed Description holding "CARD 445512" became the description and
    // the real merchant sat unused two columns to the right. Check every
    // candidate, not just the ones whose title admits what they are.
    if(g === 'desc' && vals.length && looksLikeReference(vals)) g = 'ignore';

    // A running balance is all numbers, so the numeric fallback above happily
    // called it the amount — and because an amount column overrides Paid in /
    // Paid out entirely, every row then imported the balance instead of the
    // payment. Veto here rather than in pickBestColumn(): when the real money is
    // in separate in/out columns, the balance is the ONLY amount candidate and
    // scoring a field of one changes nothing.
    // "Source amount (after fees)" is the real amount and mentions fees only to
    // say they are already deducted — so the fee veto must not swallow it.
    const netOfFees = /(after fee|net of fee|excluding fee|incl(?:uding)? fee)/.test(h);
    if(g === 'amount' &&
       /(balance|last four|digits|card number|running)/.test(h)){
      g = 'ignore';
    } else if(g === 'amount' && !netOfFees && /(\bfees?\b|\brate\b)/.test(h)){
      g = 'ignore';
    }

    out.push(g);
  }
  // Date and amount must be unique. Description deliberately is not: several
  // columns together usually describe a transaction better than any one.
  // Fees, balances and rates are numbers, and currency codes appear beside them.
  // Without pushing them down, Wise's "Source fee amount" and "Source fee
  // currency" beat the real columns simply by sitting further left.
  pickBestColumn(out, 'amount', header, h=>{
    let s = 0;
    if(/\bamount\b/.test(h)) s += 10;
    if(/(after fees|net)/.test(h)) s += 4;
    if(/\bfee/.test(h)) s -= 30;
    if(/(balance|running)/.test(h)) s -= 30;
    if(/\brate\b/.test(h)) s -= 30;
    if(/(last four|digits|card number)/.test(h)) s -= 40;
    // A target amount is what left your account; a source amount on a transfer
    // can be the other leg. Prefer source, but only mildly.
    if(/\bsource\b/.test(h)) s += 2;
    return s;
  });
  pickBestColumn(out, 'cur', header, h=>{
    let s = 0;
    if(/^\s*currency\s*$/.test(h)) s += 12;
    if(/\bcurrency\b/.test(h)) s += 6;
    if(/\bfee/.test(h)) s -= 30;
    if(/(exchange from|exchange to)/.test(h)) s -= 10;
    if(/\bsource\b/.test(h)) s += 2;
    return s;
  });
  // Which columns claimed to be dates BEFORE one of them wins, so the loser can
  // be kept as a fallback rather than thrown away.
  const dateClaims = [];
  for(let i=0;i<out.length;i++) if(out[i] === 'date') dateClaims.push(i);
  pickBestColumn(out, 'date', header, h=>{
    let s = 0;
    if(/\bdate\b/.test(h)) s += 10;
    if(/(finished|completed|settled|posted)/.test(h)) s += 4;
    if(/(created|initiated)/.test(h)) s += 2;
    return s;
  });
  // "Completed Date" beats "Started Date" and should — but it is EMPTY on a
  // pending transaction, and a row with no date is a row that cannot be
  // imported. The runner-up becomes the fallback, used only when the winner is
  // blank. Exactly one, and only when it really did parse as dates.
  if(dateClaims.length > 1){
    for(const i of dateClaims){
      if(out[i] === 'ignore'){ out[i] = 'date2'; break; }
    }
  }
  return out;
}

function buildImportMapper(){
  impCols = guessCols(impRows);
  // Reuse last time's mapping when the file has the same shape — this is what
  // makes the weekly import one tap. It was being saved but never loaded.
  const saved = load(K.impmap, null);
  if(saved && Array.isArray(saved.cols) && saved.cols.length === impCols.length){
    impCols = saved.cols.slice();
    if(saved.fmt) setTimeout(()=>{ document.getElementById('imp-datefmt').value = saved.fmt; }, 0);
  }
  const hasHeader = impRows[0].every(c=>parseAmount(c)===null || String(c).trim()==='') ? 'yes' : 'no';
  document.getElementById('imp-header').value = hasHeader;
  // date format guess
  const dIdx = impCols.indexOf('date');
  if(dIdx >= 0 && !(saved && saved.fmt)){
    // Pick the format that actually parses the most rows, rather than pattern-
    // matching on any one of them. A single junk row containing letters used to
    // flip this to textual-month and make every real date unreadable.
    const sample = impRows.slice(1, 30).map(r=>r[dIdx]).filter(Boolean);
    let best = 'dmy', bestHits = -1;
    for(const f of ['dmy','ymd','mdy','dmy-txt']){
      let hits = 0;
      for(const v of sample) if(parseDate(v, f)) hits++;
      if(hits > bestHits){ bestHits = hits; best = f; }
    }
    document.getElementById('imp-datefmt').value = best;
  }
  const opts = [['ignore','Ignore'],['date','Date'],['date2','Date (fallback)'],['desc','Description'],
                ['amount','Amount'],['in','Money in'],['out','Money out'],['cur','Currency'],
                ['type','Transaction type'],['status','Status']];
  const head = '<tr>' + impCols.map((g,i)=>
    '<th><select data-col="'+i+'">'+opts.map(o=>'<option value="'+o[0]+'"'+(o[0]===g?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></th>'
  ).join('') + '</tr>';
  const body = impRows.slice(0,4).map(r=>'<tr>'+impCols.map((_,i)=>'<td>'+esc(r[i]||'')+'</td>').join('')+'</tr>').join('');
  document.getElementById('imp-table').innerHTML = head + body;
  renderDescPreview();
  document.querySelectorAll('#imp-table select').forEach(s=>{
    s.onchange = ()=>{
      const was = impCols[Number(s.dataset.col)];
      impCols[Number(s.dataset.col)] = s.value;
      // Gaining or losing the currency column changes the whole shape of the
      // import: which currencies exist, and whether the sheet-wide selector
      // applies at all.
      if(was === 'cur' || s.value === 'cur'){
        impFxRates = {};
        syncImportFxUI();
        loadImportRates();
      }
      previewImport();
    };
  });
  // Both of these change which dates the rate series has to cover.
  document.getElementById('imp-datefmt').onchange = ()=>{
    if(impCols.indexOf('cur') >= 0){ impFxRates = {}; loadImportRates(); }
    previewImport();
  };
  document.getElementById('imp-header').onchange = ()=>{
    renderDescPreview();
    if(impCols.indexOf('cur') >= 0){ impFxRates = {}; loadImportRates(); }
    previewImport();
  };
  // Reflect whatever the mapping just decided, and fetch rates for a currency
  // column straight away rather than waiting for the user to touch something.
  syncImportFxUI();
  if(impCols.indexOf('cur') >= 0) loadImportRates();
  previewImport();
}

// Set several columns to "Description" and they are joined together. This
// preview is the fastest way to see whether the mapping produced something you
// can actually recognise.
function renderDescPreview(){
  const box = document.getElementById('imp-desc-preview');
  if(!box) return;
  const sIdx = impCols.map((c,i)=>c==='desc'?i:-1).filter(i=>i>=0);
  const skip = document.getElementById('imp-header').value === 'yes' ? 1 : 0;
  const sample = impRows.slice(skip, skip+3);
  if(!sIdx.length){
    box.innerHTML = '<div class="warn">No column is set to Description, so these transactions will import with no label at all. Set at least one.</div>';
    return;
  }
  const lines = sample.map(r=>{
    const d = joinDescParts(sIdx.map(i=>r[i]));
    return '<div style="font-size:12px; color:var(--text2); padding:3px 0; word-break:break-word;">'+
      (d ? esc(d) : '<span style="color:var(--out);">(empty)</span>')+'</div>';
  }).join('');
  const built = sample.map(r=>joinDescParts(sIdx.map(i=>r[i]))).filter(Boolean);
  const thin = !looksInformative(built);
  box.innerHTML = '<div class="rule" style="margin-top:14px;">They will read as</div>'+lines+
    (thin ? '<p class="note" style="margin-top:6px;">That looks like a reference rather than a merchant name. Set any column holding the payee or merchant to <b>Description</b> as well — several can be combined.</p>'
          : '<p class="note" style="margin-top:6px;">You can set more than one column to Description and they will be joined.</p>');
}

function buildImportRows(){
  const fmt = document.getElementById('imp-datefmt').value;
  const skip = document.getElementById('imp-header').value === 'yes' ? 1 : 0;
  const acct = document.getElementById('imp-acct').value || (accts[0] ? accts[0].id : '');
  const di = impCols.indexOf('date');
  const d2i = impCols.indexOf('date2');
  const sti = impCols.indexOf('status');
  const sIdx = impCols.map((c,i)=>c==='desc'?i:-1).filter(i=>i>=0);
  const ai = impCols.indexOf('amount'), ii = impCols.indexOf('in'), oi = impCols.indexOf('out');
  const headerRow = document.getElementById('imp-header').value === 'yes' ? impRows[0] : null;
  const out = [], problems = [];
  const existing = new Set(txns.map(txnHash));
  let dupes = 0;

  // A foreign currency with no usable rate must stop the import, not import raw
  // numbers as though they were already base currency. That silent fallthrough
  // is exactly how an AUD statement became GBP figures.
  const ci = impCols.indexOf('cur');
  const fxFrom  = impFx.cur || curCode();
  // With a currency column mapped, each row carries its own currency and the
  // sheet-level selector does not apply at all.
  const perRow  = ci >= 0;
  const fxNeed  = perRow ? true : (fxFrom !== curCode());
  const fxRate  = (!perRow && fxNeed) ? (Number(impFx.rate) || 0) : 1;
  let   fxError = (!perRow && fxNeed) && !(fxRate > 0);
  const seenCur = {};        // CODE -> how many rows
  const missing = {};        // currencies with no usable rate

  let deadRows = 0;
  for(let r = skip; r < impRows.length; r++){
    const row = impRows[r];
    // A reversal, a decline or a failure is money that never moved. Counted and
    // reported, not silently dropped — a row vanishing without explanation is
    // how an import quietly loses something that mattered.
    if(sti >= 0 && DEAD_STATUS.test(String(row[sti]||'').trim())){ deadRows++; continue; }
    // The winning date column is empty on a transaction that has not settled,
    // so fall back to the one that started it before giving up on the row.
    let date = di >= 0 ? parseDate(row[di], fmt) : null;
    if(!date && d2i >= 0) date = parseDate(row[d2i], fmt);
    if(!date){ problems.push('row '+(r+1)+': no readable date'); continue; }
    let amt = null, dir = null;
    if(ai >= 0){
      const v = parseAmount(row[ai]);
      if(v === null || v === 0){ problems.push('row '+(r+1)+': no amount'); continue; }
      dir = v < 0 ? 'out' : 'in';
      amt = Math.abs(v);
    } else {
      const vin = ii >= 0 ? parseAmount(row[ii]) : null;
      const vout = oi >= 0 ? parseAmount(row[oi]) : null;
      if(vin){ dir='in'; amt = Math.abs(vin); }
      else if(vout){ dir='out'; amt = Math.abs(vout); }
      else { problems.push('row '+(r+1)+': no amount'); continue; }
    }
    const desc = joinDescParts(sIdx.map(i=>row[i]));

    // Keep every remaining text field from the row. Even when the mapping is
    // imperfect, the merchant is usually in there somewhere — so you can still
    // see what a payment was when you come to categorise it, and the
    // auto-tagger has something to match against.
    const extras = [];
    for(let c=0;c<row.length;c++){
      // The status is noise in a note; the second date repeats the first.
      if(c===di || c===ai || c===ii || c===oi || c===ci || c===d2i || c===sti) continue;
      if(sIdx.indexOf(c) >= 0) continue;
      const v = String(row[c]||'').trim();
      if(!v || parseAmount(v)!==null) continue;
      const label = headerRow ? String(headerRow[c]||'').trim() : '';
      extras.push((label ? label+': ' : '') + v);
    }
    const note = extras.join(' · ').slice(0, 400);

    // Which currency THIS row is in: its own column when there is one, the
    // sheet-level choice otherwise.
    let rowCur = fxFrom;
    if(perRow){
      const raw = String(row[ci] || '').trim().toUpperCase();
      // An unreadable cell is treated as the base currency rather than guessed
      // at — a wrong currency is worse than an unconverted one you can see.
      rowCur = CURRENCIES[raw] ? raw : curCode();
    }
    seenCur[rowCur] = (seenCur[rowCur] || 0) + 1;

    let rowRate = 1;
    if(rowCur !== curCode()){
      rowRate = perRow ? resolveRowRate(rowCur, date) : fxRate;
      if(!(rowRate > 0)){ missing[rowCur] = true; rowRate = 1; }
    }

    // Convert to the base currency before anything else sees the number, so
    // categories, budgets, duplicate detection and totals all work on one
    // currency. The original is kept on the row so nothing is lost.
    const srcAmt = amt;
    if(rowRate !== 1) amt = Math.round(amt * rowRate * 100) / 100;

    const otherInCat = resolveCat('otherin');
    const rec = { id:uid(), date, amount:amt, dir, acct, toAcct:null, desc,
                  note: note || undefined,
                  // Match against the whole row, not just the description — the
                  // merchant is often in a column that did not make the cut.
                  // An unrecognised credit is filed as "Other money in", not as
                  // Income. Calling an unknown deposit a wage is a claim, and
                  // it inflates the figure everything else is measured against.
                  cat: guessCategory(desc + ' ' + note, dir) || (dir==='in' ? otherInCat : null),
                  imported:true };
    if(rowRate !== 1){
      rec.srcCur    = rowCur;                                  // what the statement said
      rec.srcAmount = Math.round(srcAmt * 100) / 100;
      rec.fxRate    = rowRate;
    }
    const h = txnHash(rec);
    if(existing.has(h)){ dupes++; continue; }
    existing.add(h);
    out.push(rec);
  }
  // Any currency the file uses that we could not price stops the import, the
  // same as a missing sheet-level rate. Silently importing raw figures is the
  // whole bug.
  const missingList = Object.keys(missing);
  if(missingList.length) fxError = true;
  return {out, problems, dupes, fxFrom, fxNeed, fxRate, fxError,
          perRow, seenCur, missing: missingList, deadRows};
}

function previewImport(){
  const {out, problems, dupes, fxFrom, fxNeed, fxRate, fxError} = buildImportRows();
  const el = document.getElementById('imp-summary');

  if(fxError){
    const {perRow, missing} = buildImportRows();
    el.innerHTML = perRow
      ? '<b style="color:var(--out)">No rate for '+esc((missing||[]).join(', '))+'.</b>'+
        '<br>Type a rate for each above, or try again with a connection. Ledger will not '+
        'import them as '+esc(curCode())+' figures — that is what makes spending read wrong.'
      : '<b style="color:var(--out)">Set the '+esc(fxFrom)+' → '+esc(curCode())+
        ' rate before importing.</b><br>Without it Ledger would file '+esc(fxFrom)+
        ' figures as '+esc(curCode())+', which is what makes your spending look wrong.';
    document.getElementById('imp-go').style.opacity = 0.4;
    return;
  }
  const uncat = out.filter(t=>t.dir==='out' && !t.cat).length;
  const tagged = out.filter(t=>t.cat).length;
  const nearDupes = findNearDupes(out).length;
  const already = findExisting(out, document.getElementById('imp-acct').value).length;
  let msg = '<b style="color:var(--brass)">'+out.length+' transaction'+(out.length===1?'':'s')+' ready to import.</b>';

  // State the mapping in words. The table above says the same thing, but nobody
  // reads a table to check something they expect to be right — and a silently
  // mis-read column is the failure that costs the most to unpick afterwards.
  if(impRows && impRows[0] && out.length){
    const hdr = document.getElementById('imp-header').value === 'yes' ? impRows[0] : null;
    const named = role => impCols.map((c,i)=> c===role ? (hdr ? String(hdr[i]||'').trim() : 'column '+(i+1)) : null)
                                 .filter(Boolean);
    const bits = [];
    const d = named('date'),  a = named('amount').concat(named('in')).concat(named('out'));
    const s = named('desc'),  c = named('cur');
    if(d.length) bits.push('date from <b>'+esc(d[0])+'</b>');
    if(a.length) bits.push('money from <b>'+esc(a.join(' / '))+'</b>');
    if(s.length) bits.push('description from <b>'+esc(s.join(' + '))+'</b>');
    if(c.length) bits.push('currency from <b>'+esc(c[0])+'</b>');
    const skipped = impCols.map((cc,i)=> cc==='ignore' && hdr ? String(hdr[i]||'').trim() : null).filter(Boolean);
    if(bits.length){
      msg += '<br><span style="color:var(--text2)">Read automatically: '+bits.join(', ')+'.' +
        (skipped.length ? ' Ignoring '+esc(skipped.join(', '))+'.' : '') +
        ' Change any of it in the table above if that is wrong.</span>';
    }
  }
  const r2 = buildImportRows();
  if(r2.perRow && out.length){
    // Name every currency and how many rows are in it, so a mis-mapped column
    // is obvious before anything is imported rather than after.
    const counts = r2.seenCur || {};
    const parts = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])
      .map(c=>esc(c)+' ('+counts[c]+')');
    const dated = Object.keys(impFxRates).some(c=>impFxRates[c] && impFxRates[c].series);
    const s = out.find(t=>t.srcAmount != null);
    msg += '<br><b style="color:var(--brass)">Currency column found: '+parts.join(', ')+'.</b>' +
      ' Everything is converted to '+esc(curCode())+
      (dated ? ' at the rate on each transaction\'s own date' : ' at the current rate') + '.' +
      (s ? ' ' + (CURRENCIES[s.srcCur]||{sym:''}).sym + s.srcAmount.toFixed(2) + ' ' +
           esc(s.srcCur) + ' becomes ' + money(s.amount) + '.' : '');
  } else if(fxNeed && out.length){
    // Show a real row being converted. An abstract rate is easy to get backwards;
    // seeing one of your own amounts change is not.
    const s = out.find(t=>t.srcAmount != null);
    msg += '<br><b style="color:var(--brass)">Converting '+esc(fxFrom)+' to '+esc(curCode())+
      ' at '+fxRate.toFixed(4)+'.</b>' +
      (s ? ' ' + (CURRENCIES[fxFrom]||{sym:''}).sym + s.srcAmount.toFixed(2) +
           ' becomes ' + money(s.amount) + '.' : '');
  }
  if((r2.perRow || fxNeed) && out.length) msg += ' The original figures are kept on every row.';
  // Say what was dropped and why. A row disappearing without explanation is how
  // an import quietly loses something that mattered.
  if(r2.deadRows) msg += '<br>'+r2.deadRows+' reversed or declined row'+(r2.deadRows===1?'':'s')+
    ' skipped — that money never left the account.';
  if(dupes) msg += '<br>'+dupes+' already in Ledger, so they will be skipped.';
  if(tagged) msg += '<br>'+tagged+' recognised and categorised automatically.';
  if(uncat) msg += '<br>'+uncat+' not recognised — categorise '+(uncat===1?'it':'them')+' once and Ledger will offer to remember it.';
  if(already) msg += '<br><b style="color:var(--brass)">'+already+' of these '+(already===1?'is':'are')+
    ' already in Ledger from a previous import.</b> Ledger can update '+(already===1?'it':'them')+
    ' with the merchant detail from this file instead of importing again — you will be asked.';
  const autoN = findAutoMatches(out).length;
  if(autoN) msg += '<br>'+autoN+' match'+(autoN===1?'es':'')+' a subscription Ledger already posted — '+
    (autoN===1?'it':'they')+' will be replaced, not added.';
  if(nearDupes) msg += '<br><b style="color:var(--brass)">'+nearDupes+' look'+(nearDupes===1?'s':'')+' like something you already added by hand.</b> Same amount, within a day. You will be asked about '+(nearDupes===1?'it':'them')+' after importing.';
  if(problems.length) msg += '<br>'+problems.length+' row'+(problems.length===1?'':'s')+' could not be read ('+esc(problems.slice(0,2).join('; '))+(problems.length>2?'...':'')+'). Check the columns above.';
  if(out.length === 0 && !dupes) msg = '<b style="color:var(--out)">Nothing readable yet.</b><br>Set the columns above so Ledger knows which holds the date, the description and the money.';
  // v50: the three numbers that matter, before the detail.
  const tiles = (out.length || dupes)
    ? impTiles([[out.length,'New','in'],[(dupes||0)+already,'Already in',''],[uncat,'No category','amber']])
    : '';
  el.innerHTML = tiles + '<div class="imp-detail">' + msg + '</div>';
  document.getElementById('imp-go').style.opacity = out.length ? 1 : 0.4;
}

document.getElementById('imp-go').onclick = ()=>{
  let {out, fxFrom, fxError, dupes: preDupes} = buildImportRows();
  let alreadyN = preDupes || 0;
  if(fxError){
    alert('Set the '+fxFrom+' → '+curCode()+' rate first.\n\nWithout it Ledger would file '+
      fxFrom+' figures as '+curCode()+' and your spending would read wrong.');
    return;
  }
  if(!out.length) return;
  if(out.some(t=>!t.acct)){ alert('Choose which account these belong to first.'); return; }
  const acct = document.getElementById('imp-acct').value;
  // Anything already present is enriched rather than added a second time.
  const existing = findExisting(out, acct);
  alreadyN += existing.length;
  if(existing.length){
    const ok = confirm(
      existing.length+' of these '+(existing.length===1?'transaction is':'transactions are')+
      ' already in Ledger.\n\nUpdate '+(existing.length===1?'it':'them')+
      ' with the merchant names and statement detail from this file?\n\n'+
      'Nothing is duplicated and your categories are kept.');
    if(ok){
      const r = enrichExisting(existing);
      const seen = new Set(existing.map(p=>p.incoming));
      out = out.filter(o=>!seen.has(o));
      setTimeout(()=>alert(
        'Updated '+existing.length+' transaction'+(existing.length===1?'':'s')+'.\n'+
        r.improvedDesc+' got a better description, '+r.addedNote+' gained statement detail, '+
        r.categorised+' were categorised automatically.'), 250);
    } else {
      const seen = new Set(existing.map(p=>p.incoming));
      out = out.filter(o=>!seen.has(o));
    }
  }
  // Whatever survived the checks above, anything that would land as an exact
  // copy of a row already present is caught here rather than inflating totals.
  const exact = out.filter(o=>txns.some(t=>
    t.acct===o.acct && t.date===o.date && t.dir===o.dir &&
    Math.abs(t.amount-o.amount) < 0.005));
  if(exact.length){
    const keep = confirm(
      exact.length+' of these exactly match transactions already in Ledger'+
      ' (same account, date and amount).\n\nSkip them? Choose Cancel only if you genuinely paid the same amount twice.');
    if(keep){
      const skip = new Set(exact);
      out = out.filter(o=>!skip.has(o));
      alreadyN += exact.length;
    }
  }
  if(!out.length){
    // Nothing was added, but the file has now demonstrably been seen. Recording
    // it means a third attempt is caught at the door instead of row by row.
    if(pendingSig){ rememberSig(pendingSig, impRows.length); pendingSig = null; }
    closeSheet('import-backdrop');
    if(ciOpen){
      // The statement is in: that is the import step done for this week.
      settings.lastImport = todayYMD(); save(K.settings, settings);
      ciMeta.import = {added:0, already: alreadyN, superseded:0};
      render(); setTimeout(ciRefresh, 300);
      return;
    }
    render();
    alert('Nothing new to import — everything in that file was already in Ledger.');
    return;
  }
  // A statement row that matches a charge Ledger posted itself replaces it.
  // No prompt: a posted charge is explicitly provisional, and being asked to
  // confirm the obvious every month is how people learn to tap through prompts.
  const autoPairs = findAutoMatches(out);
  let superseded = 0;
  if(autoPairs.length){
    const drop = new Set(autoPairs.map(p=>p.auto.id));
    txns = txns.filter(t=>!drop.has(t.id));
    superseded = drop.size;
  }

  const dupes = findNearDupes(out);
  if(out.length) snapshot('import of '+out.length+' transaction'+(out.length===1?'':'s'));
  if(out.length) txns = txns.concat(out);
  save(K.txns, txns);
  save(K.impmap, {cols:impCols, fmt:document.getElementById('imp-datefmt').value});
  settings.lastImport = todayYMD();
  if(pendingSig){ rememberSig(pendingSig, impRows.length); pendingSig = null; }
  save(K.settings, settings);
  buzz('big');   // a statement landing is the biggest write the app does
  if(out.length) sfx('typewriter');
  const wasFlowing = weekFlow;
  closeSheet('import-backdrop');
  if(ciOpen) ciMeta.import = {added: out.length, already: alreadyN, superseded};
  else switchView('spend');
  // v50: a results sheet instead of an alert, with the untagged merchants one
  // tap away. During the Sunday check-in the check-in sheet is the summary, so
  // the old short alert stays there and nothing stacks on top of it.
  if(out.length && !wasFlowing){
    setTimeout(()=>showImportDone(out, alreadyN, superseded), 260);
  } else if(out.length && !ciOpen) alert(out.length+' new transaction'+(out.length===1?'':'s')+' imported.' +
    (superseded ? '\n\n'+superseded+' scheduled charge'+(superseded===1?'':'s')+
      ' replaced by the real one'+(superseded===1?'':'s')+' — nothing is counted twice.' : ''));
  if(dupes.length) setTimeout(()=>resolveNearDupes(dupes), 700);
  if(wasFlowing) setTimeout(resumeWeekIfFlowing, dupes.length ? 1200 : 450);
};

function impTiles(items){
  return '<div class="imp-tiles">' + items.map(([n,l,tone])=>
    '<div class="imp-tile '+tone+'"><b class="fig">'+n+'</b><span>'+l+'</span></div>').join('') + '</div>';
}
function showImportDone(added, alreadyN, superseded){
  const untagged = added.filter(t=>!t.cat && t.dir!=='transfer').length;
  const conv = added.filter(t=>t.srcAmount != null).length;
  const xfer = added.filter(t=>t.dir==='transfer').length;
  const lines = [];
  const tick = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--in)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  const swap = c=>'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="'+c+'" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>';
  if(superseded) lines.push(tick+'<span>'+superseded+' scheduled charge'+(superseded===1?'':'s')+' replaced by the real one'+(superseded===1?'':'s')+' — nothing counted twice</span>');
  if(conv) lines.push(swap('#8fd3ff')+'<span>'+conv+' payment'+(conv===1?'':'s')+' converted to '+esc(curCode())+'</span>');
  if(xfer) lines.push(swap('var(--text2)')+'<span>'+xfer+' transfer'+(xfer===1?'':'s')+', not spending</span>');
  const from = added.reduce((m,t)=> !m || t.date < m ? t.date : m, null);
  const to   = added.reduce((m,t)=> !m || t.date > m ? t.date : m, null);
  const fmt = d=> parseYMD(d).toLocaleDateString('en-GB',{day:'numeric', month:'short'});
  document.getElementById('impdone-sub').textContent = from ? (from===to ? fmt(from) : fmt(from)+' – '+fmt(to)) : '';
  document.getElementById('impdone-body').innerHTML =
    impTiles([[added.length,'Added','in'],[alreadyN,'Already in',''],[untagged,'No category','amber']]) +
    (lines.length ? '<div class="imp-lines">'+lines.map(l=>'<div>'+l+'</div>').join('')+'</div>' : '');
  const tag = document.getElementById('impdone-tag');
  tag.style.display = untagged ? '' : 'none';
  tag.textContent = 'Tag '+untagged+' now';
  document.getElementById('impdone-ok').className = untagged ? 'btn ghost' : 'btn';
  openSheet('impdone-backdrop');
}
document.getElementById('impdone-tag').onclick = ()=>{
  closeSheet('impdone-backdrop');
  setTimeout(openSort, 200);
};
document.getElementById('impdone-ok').onclick = ()=> closeSheet('impdone-backdrop');
