// ============================================================
// Budgets
// ============================================================
function openBudgets(){
  const spendCats = cats.filter(c=>c.kind==='spend');
  document.getElementById('budget-form').innerHTML = spendCats.map(c=>
    '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">'+
    '<span style="flex:1; font-size:14px;"><span style="display:inline-block; width:9px; height:9px; border-radius:2px; background:'+c.colour+'; margin-right:7px;"></span>'+esc(c.name)+'</span>'+
    '<input type="number" inputmode="decimal" data-bud="'+c.id+'" value="'+(budgets[c.id]||'')+'" placeholder="no limit" style="width:120px; margin:0; text-align:right;"></div>'
  ).join('');
  updateBudgetNote();
  document.querySelectorAll('[data-bud]').forEach(i=> i.addEventListener('input', updateBudgetNote));
  renderInsights();
  renderBudgetSuggest();
  openSheet('budget-backdrop');
}
function updateBudgetNote(){
  let total = 0;
  document.querySelectorAll('[data-bud]').forEach(i=>{ total += Number(i.value)||0; });
  const cm = committedMonthly();
  const el = document.getElementById('budget-note');
  if(total === 0){ el.innerHTML = ''; return; }
  // Budgets that ignore fixed commitments are fiction, so say it plainly.
  let msg = 'Your limits add up to '+money0(total)+' a month.';
  if(cm > 0) msg += ' Subscriptions and bills take another '+money0(cm)+', so you are planning to spend '+money0(total+cm)+' in total.';
  // v47: last month's income, because this month's is not all in yet.
  const lastMk = shiftMonth(monthKey(new Date()), -1);
  const mt = monthTotals(lastMk);
  if(mt.inn > 0) msg += ' '+money0(mt.inn)+' came in during '+
    parseYMD(lastMk + '-01').toLocaleDateString('en-GB', {month:'long'})+'.';
  el.innerHTML = '<div class="warn" style="margin-top:10px;">'+msg+'</div>';
}
document.getElementById('open-budgets').onclick = openBudgets;

document.getElementById('mg-kind').addEventListener('change', renderGoalExtra);
document.getElementById('mg-save').onclick = ()=>{
  const kind = document.getElementById('mg-kind').value;
  if(!kind){ alert('Pick something to aim at first.'); return; }
  const g = {kind, met:null, set: todayYMD()};
  if(kind === 'spend_less') g.cat = document.getElementById('mg-cat').value;
  if(kind === 'under_total' || kind === 'save_pct'){
    g.target = Number(document.getElementById('mg-target').value) || 0;
    if(!g.target){ alert('Give it a number.'); return; }
  }
  if(kind === 'custom'){
    g.text = (document.getElementById('mg-text').value || '').trim();
    if(!g.text){ alert('Say what you are aiming at.'); return; }
  }
  setGoal(monthKey(new Date()), g);
  renderInsights();
  alert('Set. Ledger will check this when you close the month off.');
};
document.getElementById('month-later').onclick = ()=>{
  settings.monthSnooze = todayYMD(); save(K.settings, settings);
  closeSheet('month-backdrop');
};
document.getElementById('month-done').onclick = ()=>{
  const mk = reviewMonth || prevMonthKey(monthKey(new Date()));
  const left = monthReviewOutstanding(mk);
  if(left === 0){
    markMonthComplete(mk, true);
    closeSheet('month-backdrop');
    render();
    alert(parseYMD(mk+'-01').toLocaleDateString('en-GB',{month:'long'})+
      ' is closed off. It now counts towards everything Ledger tells you.');
  } else {
    // Not finished is not a failure — but it must not silently pass either.
    settings.monthDismissed = mk; save(K.settings, settings);
    closeSheet('month-backdrop');
    render();
  }
};
document.getElementById('open-currency').onclick = openCurrency;
document.getElementById('do-undo').onclick = doRollback;
document.getElementById('bud-save').onclick = ()=>{
  const next = {};
  document.querySelectorAll('[data-bud]').forEach(i=>{
    const v = Number(i.value)||0;
    if(v > 0) next[i.dataset.bud] = v;
  });
  budgets = next;
  save(K.budgets, budgets);
  closeSheet('budget-backdrop');
  render();
};
