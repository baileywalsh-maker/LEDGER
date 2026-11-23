// ============================================================
// Monthly review
// ============================================================
let reviewMonth = null;

function renderMonthSheet(){
  const mk = reviewMonth || prevMonthKey(monthKey(new Date()));
  reviewMonth = mk;
  const name = parseYMD(mk+'-01').toLocaleDateString('en-GB',{month:'long', year:'numeric'});
  document.getElementById('month-title').textContent = 'Close off '+name;

  const tasks = monthReviewTasks(mk);
  const left = tasks.filter(t=>!t.done && !t.skip).length;
  document.getElementById('month-intro').textContent = left === 0
    ? 'Everything checks out. Closing this off lets Ledger use '+name+' in your averages.'
    : 'Once these are settled, '+name+' counts towards what Ledger can tell you. Until then it is left out — a half-imported month drags every average the wrong way.';

  document.getElementById('month-steps').innerHTML = '<div class="card">'+tasks.map(t=>
    '<div class="lrow"><div><div class="d1" style="'+(t.done?'color:var(--text3); text-decoration:line-through;':'')+'">'+
    esc(t.label)+'</div><div class="d2">'+esc(t.hint)+'</div></div>'+
    '<div class="amtcol">'+(t.done
      ? '<i class="ti ti-check" style="color:var(--in); font-size:18px;"></i>'
      : t.skip ? '<span class="sub" style="color:var(--text3);">n/a</span>'
               : '<i class="ti ti-circle" style="color:var(--text3); font-size:16px;"></i>')+
    '</div></div>').join('')+'</div>';

  // The closing balances. This is the step that proves the month, so it gets
  // its own inputs rather than sending you off to another screen.
  const given = closingBalances(mk);
  document.getElementById('month-balances').innerHTML = !accts.length ? '' :
    '<div class="rule">What each account actually held on '+esc(prettyDate(ymd(monthEndDate(mk))))+'</div>'+
    accts.map(a=>{
      const mine = given[a.id];
      const calc = balanceAtMonthEnd(a.id, mk);
      const ok = mine != null && Math.abs(Number(mine) - calc) < 0.01;
      const diff = mine != null ? Number(mine) - calc : 0;
      return '<div style="margin-bottom:10px;">'+
        '<span class="lab">'+esc(a.name)+' · Ledger says '+money(calc)+'</span>'+
        '<input type="number" step="0.01" inputmode="decimal" data-closebal="'+esc(a.id)+'" '+
          'placeholder="from the statement" value="'+(mine != null ? mine : '')+'">'+
        (mine == null ? '' : ok
          ? '<div class="note" style="color:var(--in);">Matches.</div>'
          : '<div class="note" style="color:var(--out);">Out by '+money(Math.abs(diff))+
            ' — something in '+esc(mk)+' is missing or wrong.</div>')+
        '</div>';
    }).join('');
  document.querySelectorAll('[data-closebal]').forEach(inp=>{
    inp.addEventListener('change', (e)=>{
      const v = e.target.value;
      if(v === ''){ return; }
      setClosingBalance(mk, e.target.dataset.closebal, v);
      renderMonthSheet();
    });
  });

  // How the goal set a month ago turned out.
  const g = goalFor(mk);
  const gr = document.getElementById('month-goal-result');
  if(g){
    const kind = GOAL_KINDS[g.kind] || GOAL_KINDS.custom;
    const met = goalMet(mk);
    gr.innerHTML = '<div class="goalcard '+(met===true?'met':'')+'">'+
      '<div class="g-lab">'+(met===true?'Achieved':met===false?'Missed':'Not settled yet')+'</div>'+
      '<div class="g-text">'+esc(kind.describe(g))+'</div></div>';
  } else gr.innerHTML = '';

  // Goal picker for the month you are now in.
  const sel = document.getElementById('mg-kind');
  if(!sel.options.length){
    sel.innerHTML = '<option value="">— pick one —</option>' +
      Object.keys(GOAL_KINDS).map(k=>'<option value="'+k+'">'+GOAL_KINDS[k].label+'</option>').join('');
  }
  renderGoalExtra();

  document.getElementById('month-done').textContent =
    left === 0 ? 'Mark '+name+' complete' : 'Close for now';
}

function renderGoalExtra(){
  const kind = document.getElementById('mg-kind').value;
  const box = document.getElementById('mg-extra');
  if(kind === 'spend_less'){
    const spendCats = cats.filter(c=>c.kind==='spend');
    box.innerHTML = '<span class="lab">Which category</span><select id="mg-cat">'+
      spendCats.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('')+'</select>';
  } else if(kind === 'under_total'){
    box.innerHTML = '<span class="lab">Keep total spending under</span>'+
      '<input type="number" id="mg-target" inputmode="decimal" placeholder="0.00">';
  } else if(kind === 'save_pct'){
    box.innerHTML = '<span class="lab">Save at least this much of what comes in</span>'+
      '<input type="number" id="mg-target" inputmode="decimal" placeholder="20">';
  } else if(kind === 'custom'){
    box.innerHTML = '<span class="lab">In your own words</span>'+
      '<input type="text" id="mg-text" placeholder="e.g. no takeaways on weeknights">'+
      '<p class="note" style="margin:-4px 0 4px;">Ledger cannot measure this one, so it will ask you next month whether you did it.</p>';
  } else box.innerHTML = '';
}

function maybeMonthlyCheckin(){
  const mk = prevMonthKey(monthKey(new Date()));
  if(isMonthComplete(mk)) return;
  if(settings.monthDismissed === mk) return;
  if(settings.monthSnooze === todayYMD()) return;
  if(!accts.length) return;
  if(!txns.length) return;
  // v52: one thing at a time. If the Sunday check-in is up (or about to be),
  // the month review waits and appears when the check-in is closed.
  if(ciOpen || ciPendingOpen){ monthAfterCheckin = true; return; }
  reviewMonth = mk;
  renderMonthSheet();
  setTimeout(()=>{ if(ciOpen){ monthAfterCheckin = true; return; } openSheet('month-backdrop'); }, 700);
}

function monthsWithActivity(){
  const keys = [...new Set(txns.map(t=>t.date.slice(0,7)))].sort().reverse();
  const now = monthKey(new Date());
  if(!keys.includes(now)) keys.unshift(now);   // always show the month you are in
  return keys;
}

// Every week that touches this month.
// Weeks here run from the 1st of the month, not from Sunday: four equal 7-day
// blocks, then whatever is left over as a short final stretch (0-3 days).
// Weekday-anchoring produced ragged 2-day and 1-day "weeks" at the month edges
// once clipped, which made the cards impossible to compare.
// (The Sunday check-in is a separate thing — that is a routine, not a period.)
function weeksOfMonth(mk){
  const [y,m] = mk.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const out = [];
  let day = 1, n = 0;
  while(day <= lastDay){
    const endDay = Math.min(day + 6, lastDay);
    const len = endDay - day + 1;
    out.push({
      start: new Date(y, m-1, day),
      end: new Date(y, m-1, endDay),
      len,
      stub: len < 7,
      index: ++n
    });
    day = endDay + 1;
  }
  return out;
}

const shortD = d => d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
const prettyDate = s => { try{ return parseYMD(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }catch(e){ return String(s); } };
