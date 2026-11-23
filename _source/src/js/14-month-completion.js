// ============================================================
// Month completion
// ============================================================
// All of this lives in `settings`, which exportJSON already carries, so it is
// backed up and restored with no extra wiring.

function monthsComplete(){
  const v = settings.monthsComplete;
  return Array.isArray(v) ? v.slice().sort() : [];
}
function isMonthComplete(mk){ return monthsComplete().indexOf(mk) >= 0; }
function markMonthComplete(mk, on){
  let list = monthsComplete().filter(m => m !== mk);
  if(on !== false) list.push(mk);
  settings.monthsComplete = list.sort();
  save(K.settings, settings);
}

const prevMonthKey = (mk) => {
  const [y, m] = (mk || monthKey(new Date())).split('-').map(Number);
  return monthKey(new Date(y, m - 2, 1));
};
const monthEndDate = (mk) => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0);
};

// What Ledger thinks an account held on the last day of a month. The same walk
// as acctBalance(), stopped at the month end — so a mismatch against the
// statement means something really is missing rather than merely late.
function balanceAtMonthEnd(id, mk){
  const a = accts.find(x => x.id === id);
  if(!a) return 0;
  const end = ymd(monthEndDate(mk));
  let bal = (Number(a.opening) || 0) + acctAdj(a, end);
  const from = a.openingDate || null;
  for(const t of txns){
    if(t.date > end) continue;
    if(from && t.date < from) continue;
    if(t.dir === 'in'  && t.acct === id) bal += t.amount;
    if(t.dir === 'out' && t.acct === id) bal -= t.amount;
    if(t.dir === 'transfer'){
      if(t.acct === id)   bal -= t.amount;
      if(t.toAcct === id) bal += t.amount;
    }
  }
  return bal;
}

// Closing balances you typed in from the statement, per month per account.
function closingBalances(mk){
  const all = settings.closeBal && typeof settings.closeBal === 'object' ? settings.closeBal : {};
  return (all[mk] && typeof all[mk] === 'object') ? all[mk] : {};
}
function setClosingBalance(mk, acctId, value){
  const all = settings.closeBal && typeof settings.closeBal === 'object' ? {...settings.closeBal} : {};
  all[mk] = {...(all[mk] || {}), [acctId]: Number(value)};
  settings.closeBal = all;
  save(K.settings, settings);
}
// Within a penny, per account, is a reconciliation.
function monthReconciles(mk){
  if(!accts.length) return false;
  const given = closingBalances(mk);
  return accts.every(a => given[a.id] != null &&
    Math.abs(Number(given[a.id]) - balanceAtMonthEnd(a.id, mk)) < 0.01);
}

// The checklist. Every item is answerable from the data, so "complete" is a
// fact rather than an opinion.
function monthReviewTasks(mk){
  const start = mk + '-01', end = ymd(monthEndDate(mk));
  const inMonth = txns.filter(t => t.date >= start && t.date <= end);
  const uncat = inMonth.filter(t => !t.cat && t.dir === 'out').length;
  const unconfirmed = inMonth.filter(t => t.auto).length;
  const scan = duplicateScan();
  const dupes = scan.certain.reduce((s, g) => s + g.length - 1, 0);
  return [
    {key:'txns',   done: inMonth.length > 0,  skip:false,
     label:'Statements imported',
     hint: inMonth.length ? inMonth.length+' transactions in '+mk : 'Nothing here yet — import the statement covering this month.'},
    {key:'cat',    done: uncat === 0,         skip: inMonth.length === 0,
     label:'Everything categorised',
     hint: uncat ? uncat+' still need a category' : 'Nothing left uncategorised.'},
    {key:'dupes',  done: dupes === 0,         skip:false,
     label:'No duplicates',
     hint: dupes ? dupes+' duplicate'+(dupes===1?'':'s')+' to clear first' : 'Nothing duplicated.'},
    {key:'subs',   done: unconfirmed === 0,   skip:false,
     label:'Subscriptions confirmed',
     hint: unconfirmed ? unconfirmed+' posted charge'+(unconfirmed===1?'':'s')+' not yet seen on a statement'
                       : 'Every scheduled charge matched a real one.'},
    {key:'balance',done: monthReconciles(mk), skip: accts.length === 0,
     label:'Closing balance matches',
     hint: monthReconciles(mk)
       ? 'Reconciled — nothing can be missing.'
       : 'Type what each account actually held on '+prettyDate(ymd(monthEndDate(mk)))+'.'}
  ];
}
function monthReviewOutstanding(mk){
  return monthReviewTasks(mk).filter(t => !t.done && !t.skip).length;
}
