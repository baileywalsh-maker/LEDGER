// ============================================================
// Streaks — showing up, which is a different thing from achieving
// ============================================================
function monthStreak(){
  const done = monthsComplete();
  if(!done.length) return 0;
  let mk = prevMonthKey(monthKey(new Date())), n = 0;
  while(done.indexOf(mk) >= 0){ n++; mk = prevMonthKey(mk); }
  return n;
}
function goalStreak(){
  let mk = prevMonthKey(monthKey(new Date())), n = 0, guard = 0;
  while(guard++ < 60 && goalMet(mk) === true){ n++; mk = prevMonthKey(mk); }
  return n;
}
function weeklyStreak(){
  // settings.weekStreak is bumped when a check-in is closed as done.
  return Number(settings.weekStreak) || 0;
}

// ============================================================
// Tips
// ============================================================
// The partial month you are standing in never counts. That is the whole point.
function completeMonthsDesc(){
  const now = monthKey(new Date());
  return monthsComplete().filter(m => m < now).sort().reverse();
}

function monthStats(mk){
  const t = monthTotals(mk);
  const committed = recur.reduce((s, r) => s + recurMonthly(r), 0);
  return {mk, out: t.out, inn: t.inn, net: t.net, byCat: t.byCat, committed};
}

const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

// Each tip: {tone, title, body, basis}. `tone` drives the visual weight —
// 'watch' is a number to notice, 'good' is something going right, 'note' is
// neutral description.
function buildTips(){
  const months = completeMonthsDesc();
  const n = months.length;
  const tips = [];
  if(!n) return tips;

  const cur = monthStats(months[0]);
  const nice = mk => parseYMD(mk + '-01').toLocaleDateString('en-GB', {month:'long'});

  // ---- one complete month: observation only, no claims about "typical" ----
  const cats = Object.entries(cur.byCat).filter(([c]) => c !== '__none').sort((a,b) => b[1]-a[1]);
  if(cats.length){
    const [cid, v] = cats[0];
    tips.push({tone:'note', title:(catById(cid)||{name:'A category'}).name,
      figure: money0(v),
      body:'Your biggest spending category in '+nice(cur.mk)+' — '+pct(v, cur.out)+'% of everything you spent.',
      basis:'1 month'});
  }
  if(cur.committed > 0 && cur.inn > 0){
    tips.push({tone: pct(cur.committed, cur.inn) > 40 ? 'watch' : 'note',
      title:'Committed before you decide anything',
      figure: money0(cur.committed),
      body:'Subscriptions and bills come to '+pct(cur.committed, cur.inn)+'% of what came in. '+
           'That part of the month is spent before you make a single choice.',
      basis:'your current subscriptions'});
  }
  if(cur.inn > 0){
    const rate = Math.round((cur.net / cur.inn) * 100);
    tips.push({tone: rate > 0 ? 'good' : 'watch',
      title: rate >= 0 ? 'You kept' : 'You went through',
      figure: rate + '%',
      body: rate >= 0
        ? 'of what came in during '+nice(cur.mk)+'. '+money0(cur.net)+' stayed with you.'
        : 'more than came in during '+nice(cur.mk)+'. '+money0(-cur.net)+' came out of savings.',
      basis:'1 month'});
  }

  // ---- two: comparison, stated with some confidence ----
  if(n >= 2){
    const prev = monthStats(months[1]);
    const diff = cur.out - prev.out;
    if(Math.abs(diff) > 1){
      tips.push({tone: diff < 0 ? 'good' : 'watch',
        title: diff < 0 ? 'Spending fell' : 'Spending rose',
        figure: (diff < 0 ? '−' : '+') + money0(Math.abs(diff)),
        body: nice(cur.mk)+' against '+nice(prev.mk)+'. '+
              (diff < 0 ? 'Keep that and it is ' + money0(Math.abs(diff) * 12) + ' a year.'
                        : 'Repeat that every month and it is ' + money0(Math.abs(diff) * 12) + ' a year.'),
        basis:'2 complete months'});
    }
    const movers = Object.keys({...cur.byCat, ...prev.byCat})
      .filter(c => c !== '__none')
      .map(c => ({c, d: (cur.byCat[c]||0) - (prev.byCat[c]||0)}))
      .sort((a,b) => Math.abs(b.d) - Math.abs(a.d));
    if(movers.length && Math.abs(movers[0].d) > 1){
      const m = movers[0];
      tips.push({tone: m.d < 0 ? 'good' : 'watch',
        title:(catById(m.c)||{name:'A category'}).name+(m.d < 0 ? ' is down' : ' is up'),
        figure:(m.d < 0 ? '−' : '+') + money0(Math.abs(m.d)),
        body:'The biggest single change between '+nice(prev.mk)+' and '+nice(cur.mk)+'.',
        basis:'2 complete months'});
    }
  }

  // ---- three or more: patterns, with the range, and only now a runway ----
  if(n >= 3){
    const outs = months.map(m => monthTotals(m).out);
    const avg = outs.reduce((s,v) => s+v, 0) / outs.length;
    const lo = Math.min(...outs), hi = Math.max(...outs);
    tips.push({tone:'note', title:'A normal month costs you',
      figure: money0(avg),
      body:'Across '+n+' complete months it has ranged from '+money0(lo)+' to '+money0(hi)+
           '. The spread matters as much as the average.',
      basis:n+' complete months'});

    if(avg > 0){
      const liquid = liquidTotal();
      const monthsLeft = liquid / avg;
      tips.push({tone: monthsLeft < 3 ? 'watch' : 'good',
        title:'Your money would last',
        figure: (monthsLeft >= 10 ? Math.round(monthsLeft) : (Math.round(monthsLeft*10)/10)) + ' months',
        body:'If everything coming in stopped tomorrow and you carried on spending as you do. '+
             money0(liquid)+' at '+money0(avg)+' a month.',
        basis:n+' complete months'});
    }

    // Consistently over a budget is a pattern; once is a bad month.
    Object.keys(budgets).forEach(cid => {
      const bud = Number(budgets[cid]) || 0;
      if(bud <= 0) return;
      const overs = months.filter(m => (monthTotals(m).byCat[cid] || 0) > bud).length;
      if(overs >= Math.ceil(n * 0.67) && overs >= 2){
        const avgCat = months.reduce((s,m) => s + (monthTotals(m).byCat[cid]||0), 0) / n;
        tips.push({tone:'watch', title:(catById(cid)||{name:'A category'}).name+' is over budget most months',
          figure: money0(avgCat),
          body:'Over your '+money0(bud)+' limit in '+overs+' of '+n+' months. Either the habit moves or the budget does — a limit you always break is not a limit.',
          basis:n+' complete months'});
      }
    });
  }

  return tips;
}

// What a sensible budget would be, from what actually happened rather than a
// guess. Offered only once there is a complete month to base it on.
function suggestBudgets(){
  const months = completeMonthsDesc();
  if(!months.length) return null;
  const per = {};
  months.forEach(m => {
    const b = monthTotals(m).byCat;
    Object.keys(b).forEach(c => { if(c !== '__none') (per[c] = per[c] || []).push(b[c]); });
  });
  const out = {};
  Object.keys(per).forEach(c => {
    const vals = per[c];
    const avg = vals.reduce((s,v) => s+v, 0) / vals.length;
    // Round up to a clean figure. A budget of £287 invites being ignored.
    const step = avg < 100 ? 10 : (avg < 500 ? 25 : 50);
    out[c] = Math.max(step, Math.ceil(avg / step) * step);
  });
  return {months: months.length, budgets: out};
}
