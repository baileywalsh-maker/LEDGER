// ============================================================
// Periods — one function does months, weeks and anything else,
// so a month card and a week card can never disagree.
// ============================================================
// ------------------------------------------------------------
// Refunds are not income, and the thing they refund is not spending
// ------------------------------------------------------------
// The fuel pump takes 99 pounds, you put 37 pounds in the tank, and days later
// the difference comes back. Counting the 99 as spending and the 62 as money in
// makes both figures wrong even though they cancel out: the category is
// overstated, and a month's "income" includes money that was always yours.
// So a refund is matched back to what it refunds, and both sides drop away.
//
// Two rules keep this from ever inventing a number:
//   - it only pairs rows inside the window being measured, so money in minus
//     money out is left exactly as it was and every balance check still agrees;
//   - a refund can never exceed what was actually spent with that merchant.
const REFUND_WINDOW_DAYS = 21;

// Money in that you have filed as real earnings is never a refund, whatever the
// description says. Your own filing beats any guess this could make.
const NOT_A_REFUND = {income:1, trading:1, transfers:1};

const daysApart = (a, b) => Math.round((parseYMD(b) - parseYMD(a)) / 86400000);

function matchRefunds(list){
  const off = {}, used = {};
  const outs = [], ins = [];
  for(const t of list){
    if(t.dir === 'out' && !t.auto) outs.push(t);
    else if(t.dir === 'in' && !NOT_A_REFUND[t.cat || '']) ins.push(t);
  }
  if(!outs.length || !ins.length) return {off, used};

  // Oldest refund first, so an early one cannot be taken by a later one.
  const queue = ins.slice().sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for(const r of queue){
    const key = merchantKey(r.desc || '');
    if(!key || key.length < 3) continue;
    let best = null, bestGap = null;
    for(const t of outs){
      const gap = daysApart(t.date, r.date);
      if(gap < 0 || gap > REFUND_WINDOW_DAYS) continue;
      if(!merchantAgrees(key, t)) continue;
      // Never hand back more than was spent - that is a rebate, not a reversal.
      if((t.amount - (off[t.id] || 0)) < r.amount - 0.005) continue;
      if(bestGap === null || gap < bestGap){ best = t; bestGap = gap; }
    }
    if(best){ off[best.id] = (off[best.id] || 0) + r.amount; used[r.id] = true; }
  }
  return {off, used};
}

function periodTotals(startD, endD){
  const s = ymd(startD), e = ymd(endD);
  const inRange = txns.filter(t=> t.date >= s && t.date <= e);
  const paired = matchRefunds(inRange);
  const off = paired.off, used = paired.used;
  let inn = 0, out = 0, refundsBack = 0, movedOut = 0, movedIn = 0;
  const byCat = {};
  for(const t of inRange){
    // v64: moved to or from your investments - not spending, not earnings
    if(t.cat === 'invested' && t.dir !== 'transfer'){
      if(t.dir === 'out') movedOut += t.amount; else if(t.dir === 'in') movedIn += t.amount;
      continue;
    }
    if(t.dir === 'in' && !used[t.id]){
      // v63: filed as Refunds but not paired with a purchase in this window:
      // still not earnings. It comes off spending, so "You keep" is honest
      // and money in minus money out is unchanged.
      if(t.cat === 'refunds') refundsBack += t.amount;
      else inn += t.amount;
    }
    if(t.dir === 'out'){
      const amt = t.amount - (off[t.id] || 0);
      if(amt <= 0.005) continue;          // refunded in full: it never happened
      out += amt;
      const c = t.cat || '__none';
      byCat[c] = (byCat[c]||0) + amt;
    }
    // transfers are movement between your own pots, never income or spending
  }
  out -= refundsBack;
  return {inn, out, net: inn - out, refundsBack, movedOut, movedIn, count: inRange.length, byCat, txns: inRange,
          start: s, end: e, refundOff: off, refundUsed: used};
}
