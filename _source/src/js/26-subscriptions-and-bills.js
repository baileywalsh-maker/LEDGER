// ============================================================
// Subscriptions and bills
// ============================================================
let editingRecur = null;

function renderRecur(){
  const cm = committedMonthly();
  document.getElementById('recur-summary').innerHTML = recur.length === 0 ? '' :
    '<div class="card pad" style="margin-bottom:10px;"><div style="display:flex; justify-content:space-between; align-items:baseline;">'+
    '<span style="font-size:13px; color:var(--text2);">Every month</span>'+
    '<span class="fig" style="font-size:19px; font-weight:600;">'+money0(cm)+'</span></div>'+
    '<div class="note" style="margin-top:4px;">'+money0(cm*12)+' a year.</div></div>';

  document.getElementById('recur-list').innerHTML = recur.length === 0
    ? '<div class="empty">Nothing here yet.</div>'
    : '<div class="card">' + [...recur].sort((a,b)=>recurMonthly(b)-recurMonthly(a)).map(r=>{
        const actual = recurActual(r);
        let flag = '';
        // Price rises are the whole reason to track these.
        if(actual && Math.abs(actual.amount - r.amount) > 0.01){
          const up = actual.amount > r.amount;
          flag = '<div class="d2" style="color:'+(up?'var(--out)':'var(--in)')+'">Last charged '+money(actual.amount)+
                 ' — '+(up?'up':'down')+' '+money(Math.abs(actual.amount-r.amount))+'</div>';
        }
        const per = r.cadence==='days' ? ('every '+everyDays(r)+' days')
                  : ({weekly:'a week', fortnightly:'every 2 weeks', monthly:'a month',
                      quarterly:'a quarter', yearly:'a year'}[r.cadence] || '');
        return '<div class="lrow tap" data-editrecur="'+r.id+'"><div><div class="d1">'+esc(r.name)+'</div>'+
          '<div class="d2">'+money(r.amount)+' '+per+' · next '+nextDueDate(r).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+'</div>'+flag+'</div>'+
          '<div class="amtcol">'+moneyPair0(recurMonthly(r))+'<span class="sub">a month</span></div></div>';
      }).join('') + '</div>';

  document.querySelectorAll('[data-editrecur]').forEach(el=> el.onclick = ()=> openRecur(el.dataset.editrecur));
  fillSelect(document.getElementById('rc-cat'), cats.filter(c=>c.kind==='spend'));
}

// Show the day box only when it means something, and keep the presets in step
// with whatever is typed so 28/30/31 stay one tap away.
function refreshRecurDays(){
  const sel = document.getElementById('rc-cadence');
  const row = document.getElementById('rc-days-row');
  const box = document.getElementById('rc-days');
  if(!sel || !row || !box) return;
  const on = sel.value === 'days';
  row.style.display = on ? 'block' : 'none';
  if(on && !box.value) box.value = DAYS_DEFAULT;
  const n = Math.round(Number(box.value));
  document.querySelectorAll('#rc-daypick .chip').forEach(b=>
    b.classList.toggle('on', Number(b.dataset.days) === n));
}
function wireRecurDays(){
  const sel = document.getElementById('rc-cadence');
  const box = document.getElementById('rc-days');
  if(sel) sel.onchange = refreshRecurDays;
  if(box) box.oninput = refreshRecurDays;
  document.querySelectorAll('#rc-daypick .chip').forEach(b=> b.onclick = ()=>{
    document.getElementById('rc-days').value = b.dataset.days;
    refreshRecurDays();
  });
}
wireRecurDays();

function openRecur(id){
  editingRecur = id || null;
  renderRecur();
  fillSelect(document.getElementById('rc-acct'), accts);
  const del = document.getElementById('rc-delete');
  // Editing an existing item? Put the form in view rather than leaving it
  // below a long list the user has to scroll past.
  if(id) setTimeout(()=>{
    const t = document.getElementById('recur-form-title');
    if(t && t.scrollIntoView) t.scrollIntoView({block:'start', behavior:'smooth'});
  }, 260);
  if(id){
    const r = recur.find(x=>x.id===id);
    if(!r) return;
    document.getElementById('recur-form-title').textContent = 'Edit '+r.name;
    document.getElementById('rc-name').value = r.name;
    document.getElementById('rc-amount').value = r.amount;
    document.getElementById('rc-cadence').value = r.cadence;
    document.getElementById('rc-days').value = r.cadence==='days' ? everyDays(r) : '';
    document.getElementById('rc-due').value = ymd(nextDueDate(r));
    document.getElementById('rc-match').value = r.match||'';
    if(r.cat) document.getElementById('rc-cat').value = r.cat;
    // Items created before v29 have neither field. Default them to on and to
    // the first account rather than leaving the form blank and unsaveable.
    if(r.acct) document.getElementById('rc-acct').value = r.acct;
    document.getElementById('rc-auto').checked = r.autoPost !== false;
    del.style.display = 'block';
  } else {
    document.getElementById('recur-form-title').textContent = 'Add one';
    document.getElementById('rc-name').value = '';
    document.getElementById('rc-amount').value = '';
    document.getElementById('rc-match').value = '';
    document.getElementById('rc-due').value = todayYMD();
    /* Off for anything new. A subscription is a forecast until the bank says
       otherwise; posting it on the due date and reconciling later is what
       produced the double-ups, and the statement import now does the linking
       either way. Anything already set to post keeps doing so - its own
       setting is read above, and nothing here changes it. */
    document.getElementById('rc-auto').checked = false;
    document.getElementById('rc-days').value = '';
    del.style.display = 'none';
  }
  refreshRecurDays();
  openSheet('recur-backdrop');
}

// Every empty state's button, wired in one place. Delegated, because the
// states are re-rendered constantly and per-render wiring goes stale.
document.addEventListener('click', e=>{
  const b = e.target.closest('[data-estate]');
  if(!b) return;
  const go = {
    recurring: ()=> openRecur(null),
    accounts:  ()=> document.getElementById('open-accounts').click(),
    asset:     ()=> document.getElementById('add-asset-btn').click(),
    import:    ()=> document.getElementById('open-import').click()
  }[b.dataset.estate];
  if(go) go();
});

document.getElementById('open-recurring').onclick = ()=> openRecur(null);
document.getElementById('rc-save').onclick = ()=>{
  const name = document.getElementById('rc-name').value.trim();
  const amount = Math.abs(Number(document.getElementById('rc-amount').value));
  if(!name){ alert('Give it a name.'); document.getElementById('rc-name').focus(); return; }
  if(!amount){ alert('Enter the amount.'); document.getElementById('rc-amount').focus(); return; }
  const cadence = document.getElementById('rc-cadence').value;
  // A silently corrected gap would quietly bill on the wrong day, so say so.
  let days = Math.round(Number(document.getElementById('rc-days').value));
  if(cadence === 'days' && !(days >= DAYS_MIN && days <= DAYS_MAX)){
    alert('How many days apart? Enter a number between '+DAYS_MIN+' and '+DAYS_MAX+'.');
    document.getElementById('rc-days').focus(); return;
  }
  const prev = editingRecur ? recur.find(r=>r.id===editingRecur) : null;
  const rec = { id: editingRecur || uid(), name, amount,
    cadence,
    // Kept even when the cadence moves off "days", so switching back and forth
    // does not lose the number that was set.
    everyDays: cadence === 'days' ? days : (prev && prev.everyDays) || undefined,
    nextDue: document.getElementById('rc-due').value || todayYMD(),
    cat: document.getElementById('rc-cat').value,
    match: document.getElementById('rc-match').value.trim(),
    acct: document.getElementById('rc-acct').value || null,
    autoPost: document.getElementById('rc-auto').checked,
    // The floor for catching up. Preserved on edit so changing the amount does
    // not let the catch-up reach back further than it could before.
    created: (prev && prev.created) || todayYMD() };
  if(editingRecur) recur = recur.map(r=> r.id===editingRecur ? rec : r);
  else recur.push(rec);
  save(K.recur, recur);
  runAutoPost();          // due today? then it is due now.
  reconcileAutoPosted();  // and anything the bank has since confirmed drops out
  const wasEditing = !!editingRecur;
  editingRecur = null;
  document.getElementById('rc-name').value = '';
  document.getElementById('rc-amount').value = '';
  document.getElementById('rc-match').value = '';
  document.getElementById('recur-form-title').textContent = 'Add one';
  document.getElementById('rc-delete').style.display = 'none';
  renderRecur(); render();
  // Close after saving so you land back on the dashboard and can see it there.
  // Leaving the sheet open made a saved item look like it had gone nowhere.
  closeSheet('recur-backdrop');
  if(!wasEditing && currentView !== 'home') switchView('home');
};
document.getElementById('rc-delete').onclick = ()=>{
  if(!editingRecur) return;
  recur = recur.filter(r=>r.id!==editingRecur);
  save(K.recur, recur);
  editingRecur = null;
  closeSheet('recur-backdrop');
  render();
};
