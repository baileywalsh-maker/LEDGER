// ============================================================
// Goals and achievements
// ============================================================
// Only things Ledger can measure are offered as templates. Anything else is
// free text, self-marked — honest about which is which.
const GOAL_KINDS = {
  spend_less: {
    label:'Spend less on a category',
    describe: g => 'Spend less on ' + (catById(g.cat) || {name:'a category'}).name + ' than last month',
    measurable: true
  },
  under_total: {
    label:'Keep total spending under an amount',
    describe: g => 'Keep total spending under ' + money0(g.target),
    measurable: true
  },
  no_new_subs: {
    label:'Add no new subscriptions',
    describe: () => 'Add no new subscriptions',
    measurable: true
  },
  save_pct: {
    label:'Save a percentage of what comes in',
    describe: g => 'Save at least ' + Math.round(g.target) + '% of what comes in',
    measurable: true
  },
  custom: {
    label:'Something else (you mark it yourself)',
    describe: g => g.text || 'Your own goal',
    measurable: false
  }
};

function allGoals(){
  const g = settings.goals;
  return (g && typeof g === 'object' && !Array.isArray(g)) ? g : {};
}
function goalFor(mk){ return allGoals()[mk] || null; }
function setGoal(mk, goal){
  const all = {...allGoals()};
  if(goal) all[mk] = goal; else delete all[mk];
  settings.goals = all;
  save(K.settings, settings);
}

// Did the goal set for `mk` come off? Returns true / false / null (cannot say).
function goalMet(mk){
  const g = goalFor(mk);
  if(!g) return null;
  if(g.met != null) return g.met;                 // self-marked, or already settled
  if(!isMonthComplete(mk)) return null;           // never judge a half-imported month
  const now = monthTotals(mk), prev = monthTotals(prevMonthKey(mk));
  if(g.kind === 'spend_less'){
    const a = now.byCat[g.cat] || 0, b = prev.byCat[g.cat] || 0;
    if(!isMonthComplete(prevMonthKey(mk))) return null;   // nothing fair to compare against
    return a < b;
  }
  if(g.kind === 'under_total') return now.out < Number(g.target);
  if(g.kind === 'no_new_subs'){
    return !recur.some(r => r.created && r.created.slice(0,7) === mk);
  }
  if(g.kind === 'save_pct'){
    if(now.inn <= 0) return null;
    return ((now.inn - now.out) / now.inn) * 100 >= Number(g.target);
  }
  return null;                                     // custom, not yet marked
}
