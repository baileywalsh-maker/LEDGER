// ============================================================
// Insights UI
// ============================================================
function renderInsights(){
  const box = document.getElementById('insights');
  if(!box) return;
  const months = completeMonthsDesc();
  const tips = buildTips();
  let html = '';

  // Achievement for the month just gone, then the goal now running.
  const lastMk = months.length ? months[0] : prevMonthKey(monthKey(new Date()));
  const lastGoal = goalFor(lastMk);
  if(lastGoal){
    const met = goalMet(lastMk);
    const kind = GOAL_KINDS[lastGoal.kind] || GOAL_KINDS.custom;
    html += '<div class="goalcard '+(met === true ? 'met' : met === false ? 'missed' : '')+'">'+
      '<div class="g-lab">'+(met === true ? 'Achieved · ' : met === false ? 'Missed · ' : 'Waiting on you · ')+
        esc(parseYMD(lastMk+'-01').toLocaleDateString('en-GB',{month:'long'}))+'</div>'+
      '<div class="g-text">'+esc(kind.describe(lastGoal))+'</div>'+
      (met == null && !kind.measurable
        ? '<div style="display:flex; gap:8px; margin-top:10px;">'+
          '<button class="chip" data-goalmark="1">I did it</button>'+
          '<button class="chip" data-goalmark="0">I did not</button></div>'
        : met == null
          ? '<div class="note" style="margin-top:6px;">Close off '+esc(lastMk)+' to settle this.</div>'
          : '')+
      '</div>';
  }
  const curGoal = goalFor(monthKey(new Date()));
  if(curGoal){
    const kind = GOAL_KINDS[curGoal.kind] || GOAL_KINDS.custom;
    html += '<div class="goalcard"><div class="g-lab">This month you are trying to</div>'+
      '<div class="g-text">'+esc(kind.describe(curGoal))+'</div></div>';
  }

  // Streaks: showing up, which is not the same as achieving.
  const ws = weeklyStreak(), ms = monthStreak(), gs = goalStreak();
  if(ws || ms || gs){
    html += '<div class="medals" style="margin-bottom:16px;">'+
      (ws ? '<span class="medal on"><i class="ti ti-flame"></i>'+ws+' week'+(ws===1?'':'s')+' checked in</span>' : '')+
      (ms ? '<span class="medal on"><i class="ti ti-calendar-check"></i>'+ms+' month'+(ms===1?'':'s')+' closed off</span>' : '')+
      (gs ? '<span class="medal on"><i class="ti ti-target-arrow"></i>'+gs+' goal'+(gs===1?'':'s')+' running</span>' : '')+
      '</div>';
  }

  if(!tips.length){
    html += '<div class="locked"><b>Nothing to show yet.</b><br>'+
      'Insights are built from complete months only — a half-imported month would drag every '+
      'average down and quietly tell you the wrong thing. Close off a month in the review '+
      'that appears on the 1st, and this fills in.</div>';
  } else {
    html += tips.map(t=>
      '<div class="tip '+esc(t.tone)+'">'+
      '<div class="t-title">'+esc(t.title)+'</div>'+
      '<div class="t-fig">'+esc(t.figure)+'</div>'+
      '<div class="t-body">'+esc(t.body)+'</div>'+
      '<div class="t-basis">based on '+esc(t.basis)+'</div></div>').join('');

    // Say plainly what more data would buy, rather than hiding it.
    const n = months.length;
    if(n < 3){
      const need = 3 - n;
      html += '<div class="locked"><b>'+need+' more complete month'+(need===1?'':'s')+
        '</b> and Ledger can tell you what a normal month costs you, how much that varies, '+
        'and how long your money would last if everything coming in stopped. '+
        'With '+n+' month'+(n===1?'':'s')+' it can only describe what happened, not what is usual.</div>';
    }
  }

  box.innerHTML = html;

  box.querySelectorAll('[data-goalmark]').forEach(b=>{
    b.onclick = ()=>{
      const g = goalFor(lastMk); if(!g) return;
      setGoal(lastMk, {...g, met: b.dataset.goalmark === '1'});
      renderInsights();
    };
  });
}

// Budgets you have not got round to setting are the reason half of this cannot
// speak. Offer real figures from a real month rather than asking for a guess.
function renderBudgetSuggest(){
  const box = document.getElementById('budget-suggest');
  if(!box) return;
  const anyBudget = Object.values(budgets).some(v=>Number(v) > 0);
  const s = suggestBudgets();
  if(anyBudget || !s){
    box.innerHTML = s ? '' : '<div class="note" style="margin-bottom:10px;">Once a month is closed off, '+
      'Ledger can suggest limits from what you actually spent.</div>';
    return;
  }
  const rows = Object.entries(s.budgets).sort((a,b)=>b[1]-a[1]).slice(0, 8);
  box.innerHTML = '<div class="warn" style="margin-bottom:12px;">'+
    '<b>Suggested from what you actually spent</b> across '+s.months+' complete month'+(s.months===1?'':'s')+
    ', rounded up to something you could plausibly hold to.<br>'+
    rows.map(([c,v])=>esc((catById(c)||{name:c}).name)+' '+money0(v)).join(' · ')+
    '<br><button class="chip" id="bud-accept" style="margin-top:9px;">Use these</button></div>';
  const btn = document.getElementById('bud-accept');
  if(btn) btn.onclick = ()=>{
    budgets = {...budgets, ...s.budgets};
    save(K.budgets, budgets);
    openBudgets();
    render();
  };
}
