// ============================================================
// Where the next statement should start.
//
// "Download a CSV from your banking app" left the date range to memory. Ledger
// already knows it: the newest row it holds that came from a statement. A
// manual entry does not count — typing a transaction in by hand does not mean
// the bank's version of that week has been imported.
// ============================================================
function lastStatementDate(acctId){
  let best = null;
  for(const t of txns){
    if(acctId && t.acct !== acctId) continue;
    if(!t.imported) continue;
    if(!t.date) continue;
    if(!best || t.date > best) best = t.date;
  }
  // Nothing flagged: either this account has never been imported, or its rows
  // predate the flag. Fall back to what is there rather than claiming nothing.
  if(!best){
    for(const t of txns){
      if(acctId && t.acct !== acctId) continue;
      if(!t.date) continue;
      if(!best || t.date > best) best = t.date;
    }
  }
  return best;
}
// The day after, because the last day imported is already covered. Banks are
// inclusive on both ends of a range, so starting on the same day just makes
// duplicates for the de-duper to catch.
function nextImportFrom(acctId){
  const last = lastStatementDate(acctId);
  if(!last) return null;
  return ymd(new Date(parseYMD(last).getTime() + 86400000));
}
function daysSince(ds){
  if(!ds) return null;
  const n = Math.floor((parseYMD(todayYMD()) - parseYMD(ds))/86400000);
  return isFinite(n) ? n : null;
}
const fmtDay = ds => parseYMD(ds).toLocaleDateString('en-GB',{day:'numeric', month:'short'});
// One sentence, used on the check-in and again on the import sheet.
function importRangeLine(acctId){
  const from = nextImportFrom(acctId);
  if(!from){
    return { from:null, text:'Nothing imported yet, so download as far back as your bank will give you.' };
  }
  const gap = daysSince(from);
  const tail = gap === null ? ''
    : gap < 0  ? ''
    : gap === 0 ? ' — that is today.'
    : gap > 45  ? ' — that is ' + gap + ' days, so expect a big file.'
    : ' — ' + gap + ' day' + (gap===1?'':'s') + ' to catch up on.';
  return { from: from, text: 'Start from ' + fmtDay(from) + tail };
}

// ============================================================
// Sunday check-in
// ============================================================
function weekTasks(){
  // v52: five steps, shared by the Home card and the guided flow. `na` means
  // the step does not apply (no assets); `skip` also covers steps you chose to
  // skip this week, so the card can close once the week has been handled.
  const ws = weekStart(new Date());
  const doneThisWeek = k => settings[k] && parseYMD(settings[k]) >= ws;
  const skipped = ciSkipped();
  const list = [
    {key:'lastImport', label:'Import last week\'s statement', action:'Import',
     hint:'Download a CSV from your banking app, then drop it in. '+importRangeLine(null).text,
     done: doneThisWeek('lastImport')},
    {key:'tag', label:'Sort the new shops', action:'Sort', hint:'Give anything new a category.',
     done: !txns.some(needsAttention)},
    {key:'lastAssetVal', label:'Check everything you own', action:'Check',
     hint: invAny() ? 'Go through each holding: how many, and what it is worth.' : manualAssets().length ? 'One reading each keeps real growth separate from money you added.' : 'Nothing tracked yet — nothing to do here.',
     na: manualAssets().length === 0 && !invAny(), done: doneThisWeek('lastAssetVal')},
    {key:'lastCheck', label:'Check the balance matches', action:'Check',
     hint:'Ten seconds, and it catches anything missing before it piles up.', done: doneThisWeek('lastCheck')},
    {key:'backup', label:'Save a backup', action:'Back up', hint:'One file, saved over last week\'s.',
     done: !!settings.lastBackup && parseYMD(settings.lastBackup) >= ws},
  ];
  return list.map(t=>({...t, na: !!t.na, skip: !!t.na || skipped.includes(t.key), fn: openCheckin}));
}

/* Everything Ledger knows is on this phone and nowhere else, and iOS throws a
   web app's storage away after about a week of not opening it. There is a
   warning on the Settings screen, but a warning on a screen you do not visit
   is not a warning. The check-in is the one time you deliberately sit down
   with Ledger, so that is where the ask belongs. */
function weekBackupHTML(){
  const last = settings.lastBackup;
  const n = daysSinceBackup();
  const due = backupDue();
  let line;
  if(!last) line = 'Every transaction Ledger holds is on this phone and nowhere else. '+
    'One tap saves a copy you can restore from.';
  else if(n === 0) line = 'Saved today. Nothing to do.';
  else if(due) line = 'Last saved '+n+' day'+(n===1?'':'s')+' ago. '+
    'Save over the same file - one backup, not forty.';
  else line = 'Last saved '+n+' day'+(n===1?'':'s')+' ago. You can save again now if you like.';
  return '<div class="wk-bk'+(due ? ' due' : '')+'" id="wk-bk">'+
    '<h4>'+(due ? 'Back this week up' : 'Your backup')+'</h4>'+
    '<p>'+line+'</p>'+
    (n === 0
      ? '<div class="ok"><i class="ti ti-check"></i>Backed up today</div>'
      : '<button class="btn'+(due ? '' : ' ghost')+'" id="wk-bk-go">Save a backup</button>')+
  '</div>';
}

function wireWeekBackup(){
  const b = document.getElementById('wk-bk-go');
  if(!b) return;
  b.onclick = ()=>{
    runBackup().then(ok=>{ if(!ok) return;
    const box = document.getElementById('wk-bk');
    if(box){
      box.classList.remove('due');
      box.innerHTML = '<h4>Your backup</h4>'+
        '<p>Saved. Same file as last time, so there is still only one.</p>'+
        '<div class="ok"><i class="ti ti-check"></i>Backed up today</div>';
    }
    });
  };
}

function renderWeekSheet(){
  const tasks = weekTasks();
  const lastWeek = monthTotals(monthKey(new Date()));
  const dow = new Date().getDay();
  document.getElementById('week-intro').textContent = dow === 0
    ? 'Sunday. Three things keep Ledger honest, and they take about five minutes together.'
    : 'Your Sunday check-in is still open. Three things keep Ledger honest, and they take about five minutes together.';

  document.getElementById('week-steps').innerHTML = '<div class="card">' + tasks.map(t=>
    '<div class="lrow"><div><div class="d1" style="'+(t.done?'color:var(--text3); text-decoration:line-through;':'')+'">'+t.label+'</div>'+
    '<div class="d2">'+esc(t.hint)+'</div></div>'+
    '<div class="amtcol">'+(t.done
      ? '<i class="ti ti-check" style="color:var(--in); font-size:18px;"></i>'
      : t.skip
        ? '<span class="sub" style="color:var(--text3);">n/a</span>'
        : '<button data-week-task="'+t.key+'" class="chip">'+t.action+'</button>')+'</div></div>'
  ).join('') + '</div>';

  document.querySelectorAll('[data-week-task]').forEach(b=>{
    const t = tasks.find(x=>x.key===b.dataset.weekTask);
    b.onclick = t.fn;
  });

  const remaining = tasks.filter(t=>!t.done && !t.skip).length;
  document.getElementById('week-done').textContent =
    remaining === 0 ? 'All done — close for this week' : 'Done for this week';

  // a short recap of the week just gone
  const ws = weekStart(new Date());
  const prevStart = new Date(ws.getTime() - 7*86400000);
  const inWeek = txns.filter(t=>{ const d = parseYMD(t.date); return d >= prevStart && d < ws; });
  // v63: the same sum as every month figure (refunds paired, transfers out)
  const wkT = periodTotals(prevStart, new Date(ws.getTime() - 86400000));
  const out = wkT.out, inn = wkT.inn;
  document.getElementById('week-recap').innerHTML = (inWeek.length === 0
    ? '<div class="note" style="margin-top:12px;">Nothing recorded for last week yet — that is what the import is for.</div>'
    : '<div class="rule">Last week</div><div class="card">'+
      '<div class="lrow"><div class="d1">Spent</div><div class="amtcol out">'+moneyPair(out)+'</div></div>'+
      '<div class="lrow"><div class="d1">Received</div><div class="amtcol in">'+moneyPair(inn)+'</div></div>'+
      '<div class="lrow"><div class="d1">Net</div><div class="amtcol '+(inn-out>=0?'in':'out')+'">'+moneyPair(inn-out)+'</div></div></div>')
    + weekBackupHTML();
  wireWeekBackup();
}

// The chip is the durable half of the routine: the sheet can be closed by any
// task that navigates away, but this stays until the week is genuinely done.
function renderWeekChip(){
  const chip = document.getElementById('week-chip');
  if(!chip) return;
  const tasks = weekTasks();
  const left = tasks.filter(t=>!t.done && !t.skip).length;
  // No dismissal. It goes when the work is done and not before - a checklist
  // you can wave away without doing anything is just a notification.
  if(left === 0 || accts.length === 0){
    chip.classList.remove('on');
    const steps = document.getElementById('week-steps-inline');
    if(steps){ steps.className = ''; steps.style.display = 'none'; }
    return;
  }
  chip.classList.add('on');
  // Count only tasks that actually apply. With no assets tracked, that step is
  // not something you can do, so it must not inflate the "done" figure.
  const real = tasks.filter(t=>!t.na);
  const done = real.filter(t=>t.done).length;
  const go = document.getElementById('week-chip-go');
  if(go) go.textContent = done === 0 && !ciSkipped().length ? 'Start' : 'Continue';
  // v50: name the next step rather than counting them, so the card says what to do.
  const next = tasks.find(t=>!t.done && !t.skip);
  document.getElementById('week-chip-sub').textContent = next ? 'Next: ' + next.label.charAt(0).toLowerCase() + next.label.slice(1) : '';

  // The ring carries the count, so progress reads before the words do.
  const R = 23, C = 2 * Math.PI * R;
  const frac = real.length ? done / real.length : 0;
  const ring = document.getElementById('week-chip-ring');
  if(ring){
    ring.innerHTML =
      '<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">'+
        '<circle cx="28" cy="28" r="'+R+'" fill="none" stroke="var(--line)" stroke-width="6"/>'+
        (frac > 0 ? '<circle cx="28" cy="28" r="'+R+'" fill="none" stroke="var(--brass)" stroke-width="6" '+
          'stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" '+
          'stroke-dashoffset="'+(C*(1-frac)).toFixed(1)+'" transform="rotate(-90 28 28)"/>' : '')+
      '</svg><b>'+done+'/'+real.length+'</b>';
  }

  const steps = document.getElementById('week-steps-inline');
  if(steps){
    steps.className = 'on';
    steps.style.display = '';
    steps.innerHTML = tasks.map(t=>
      '<span class="wstep'+(t.done?' done':t.skip?' skip':'')+'">'+
      '<span class="wbx">'+(t.done?'&#10003;':'')+'</span>'+esc(t.label)+
      (t.skip?' <span style="font-size:10.5px;">(nothing to do)</span>':'')+'</span>').join('');
  }
}

document.getElementById('week-chip').onclick = ()=> openCheckin();

// Set while you are working through the routine, so finishing a task returns
// you to the list instead of dropping you wherever the task left off.
let weekFlow = false;

function resumeWeekIfFlowing(){
  if(!weekFlow) return;
  if(ciOpen){ render(); ciRefresh(); return; }
  const left = weekTasks().filter(t=>!t.done && !t.skip).length;
  render();
  if(left === 0){
    weekFlow = false;
    // Everything is done — close the loop rather than reopening an empty list.
    settings.weekDismissed = todayYMD(); save(K.settings, settings);
    renderWeekChip();
    sfx('book');
    setTimeout(()=>alert('Weekly check-in done. Everything is up to date.'), 1100);
    return;
  }
  setTimeout(()=>{ renderWeekSheet(); openSheet('week-backdrop'); }, 500);
}

// Sunday routine. Previously this had no day gate at all — it fired on the
// first open of any new week, which is why it turned up on a Wednesday.
function maybeWeeklyCheckin(){
  const now = new Date();
  const ws = weekStart(now);
  if(settings.weekDismissed && parseYMD(settings.weekDismissed) >= ws) return;
  if(settings.weekSnooze === todayYMD()) return;
  if(accts.length === 0) return;   // nothing to check yet
  // Nothing more is needed: the week now starts on Sunday, and weekDismissed
  // above already suppresses it for the rest of the week once you are done. So
  // it appears on Sunday, and if you do not open the app that day it is waiting
  // on Monday instead of disappearing for a week.
  // v52: the guided flow, picking up wherever you left it.
  ciPendingOpen = true;
  setTimeout(()=>{ ciPendingOpen = false; if(!ciOpen && !document.querySelector('.backdrop.open')) openCheckin(); }, 450);
}
document.getElementById('week-done').onclick = ()=>{
  weekFlow = false;
  // Only a genuinely finished check-in extends the streak. Closing the sheet
  // with things outstanding is dismissing it, which is a different act.
  const left = weekTasks().filter(t=>!t.done && !t.skip).length;
  if(left === 0){
    sfx('book');
    const ws = ymd(weekStart(new Date()));
    if(settings.weekStreakWeek !== ws){
      const prev = ymd(new Date(weekStart(new Date()).getTime() - 7*86400000));
      settings.weekStreak = (settings.weekStreakWeek === prev)
        ? (Number(settings.weekStreak)||0) + 1
        : 1;
      settings.weekStreakWeek = ws;
    }
  }
  settings.weekDismissed = todayYMD();
  save(K.settings, settings);
  closeSheet('week-backdrop');
};
document.getElementById('week-later').onclick = ()=>{
  weekFlow = false;
  settings.weekSnooze = todayYMD();
  save(K.settings, settings);
  closeSheet('week-backdrop');
};
