// ============================================================
// Backup / restore / export
// ============================================================
function download(name, text, type){
  const blob = new Blob([text], {type: type||'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
// ============================================================
// One backup, both apps. The same envelope COACH writes:
//
//   { __suite:1, exported:ISO, <your own half at the top level>, <other app>:{...} }
//
// Your own half stays at the TOP level, in exactly the shape your app has
// always written, so a build from before this change still reads the file.
// The other app's half sits under its own key and is carried through
// untouched. After one round trip a single file is the whole backup. The rule
// that makes it safe: a file with no Ledger half changes nothing in Ledger.
// ============================================================

// ============================================================
// The backup interval.
//
// iOS clears a web app's storage after roughly a week of not opening it, so a
// warning that waits a fortnight arrives after the thing it was meant to
// prevent. Seven days.
//
// The filename never changes. iOS cannot silently overwrite a file, but a
// SAVE with a name already in that folder offers Replace — so one tap a week
// keeps exactly one backup, instead of forty numbered copies in Files.
// ============================================================
const BACKUP_EVERY_DAYS = 7;
const BACKUP_FILENAME = 'ledger-backup.json';
function daysSinceBackup(){
  const last = localStorage.getItem('ledger:lastbackupday');
  if(!last) return null;
  const n = Math.floor((parseYMD(todayYMD()) - parseYMD(last))/86400000);
  return isFinite(n) ? n : null;
}
function backupDue(){
  const n = daysSinceBackup();
  return n === null || n >= BACKUP_EVERY_DAYS;
}

const SUITE_VERSION = 1;
const CARRY_KEY = 'ledger:carry';        // COACH's half, held for the shared file
const CARRYWHEN_KEY = 'ledger:carrywhen';
function loadCarry(){ try{ return JSON.parse(localStorage.getItem(CARRY_KEY)) || null; }catch(e){ return null; } }
function carryDate(){ return localStorage.getItem(CARRYWHEN_KEY) || null; }
function setCarry(section, when){
  if(!section) return;
  try{
    localStorage.setItem(CARRY_KEY, JSON.stringify(section));
    localStorage.setItem(CARRYWHEN_KEY, when || todayYMD());
  }catch(e){}
}
function ledgerSection(){
  // v49: the column choices remembered for each bank's CSV travel too, so a
  // restored phone does not ask you to map your statement all over again.
  let impmap = null;
  try{ impmap = JSON.parse(localStorage.getItem(K.impmap)); }catch(e){ impmap = null; }
  return { version:1, schema:SCHEMA, accts, txns, cats, rules, assets, settings, recur, budgets, impmap, invest, pots, look: lookPrefs() };
}
// v65: the look-and-feel switches (sound, moment sounds, haptics, folded home
// sections, Freedom card view) travel in the backup too, so restoring onto a
// new web address - which starts empty - brings Ledger back exactly as it was.
// Stored as the raw saved text, so they go back byte for byte.
const LOOK_KEYS = ['ledger:sound', 'ledger:fx', 'ledger:haptic', 'ledger:homefold', 'ledger:frslide'];
function lookPrefs(){
  const out = {};
  for(const k of LOOK_KEYS){ try{ const v = localStorage.getItem(k); if(v !== null) out[k] = v; }catch(e){} }
  return out;
}
// Find each app's half wherever it sits: under its own key, or at the top
// level in that app's own legacy shape. The same three lines run in COACH.
function coachHalf(d){
  if(d && d.coach && d.coach.store) return d.coach;
  if(d && d.store) return { store: d.store };
  return null;
}
function ledgerHalf(d){
  if(d && d.ledger && d.ledger.txns) return d.ledger;
  if(d && d.txns && d.accts) return d;
  return null;
}
function readSuite(data){
  if(!data || typeof data !== 'object') return null;
  const ledger = ledgerHalf(data), coach = coachHalf(data);
  if(!ledger && !coach) return null;
  return { ledger, coach, exported: data.exported, shared: !!data.__suite };
}

/* Was inline on the Settings row. The weekly check-in asks for a backup too
   now, and two copies of this would eventually disagree about what a backup
   contains - so there is one. */
// v54: the backup goes through the share sheet, so on iPhone it is
// "Save to Files" straight into the same iCloud folder each week (Replace keeps
// one file). Returns a promise: true once saved, false if you backed out.
// It is only marked as backed up when it actually was.
function backupMarkDone(){
  settings.lastBackup = todayYMD(); save(K.settings, settings);
  try{ localStorage.setItem('ledger:lastbackupday', todayYMD()); }catch(e){}
  sfx('safe');
  render();
}
function runBackup(){
  // The Ledger fields stay at the top level — the shape every build before v38
  // wrote and can still read. Only COACH's half is nested. (v69: built in one
  // place, backupPayloadText, so the cloud copy is the very same file.)
  const text = backupPayloadText(true);
  let file = null;
  try{ file = new File([text], BACKUP_FILENAME, {type:'application/json'}); }catch(e){}
  const canShareFile = !!(file && navigator.canShare && navigator.share && (()=>{ try{ return navigator.canShare({files:[file]}); }catch(e){ return false; } })());
  if(canShareFile){
    return navigator.share({files:[file], title:'Ledger backup'}).then(()=>{ backupMarkDone(); return true; }, err=>{
      if(err && err.name === 'AbortError') return false;     // you closed the sheet: nothing saved
      download(BACKUP_FILENAME, text);                          // sharing failed: fall back to a download
      backupMarkDone(); return true;
    });
  }
  // No share sheet (a computer): the old download, same single filename.
  download(BACKUP_FILENAME, text);
  backupMarkDone();
  return Promise.resolve(true);
}
document.getElementById('do-backup').onclick = runBackup;
document.getElementById('do-restore').onclick = ()=> document.getElementById('restore-file').click();
// v56: a backup is checked and shown before it replaces anything. You see
// what is in the file next to what is on the phone, and only then decide.
let restorePending = null;
function inspectBackup(text){
  let raw;
  try{ raw = JSON.parse(text); }catch(e){ return {error:'That file could not be read. It may be damaged or not a backup.'}; }
  const suite = readSuite(raw);
  if(!suite) return {error:'That file is not a Ledger backup.'};
  // A shared file with no Ledger half must not touch Ledger.
  if(!suite.ledger || !Array.isArray(suite.ledger.txns) || !Array.isArray(suite.ledger.accts)){
    if(suite.coach) return {coachOnly:true, suite};
    return {error:'That file is not a Ledger backup.'};
  }
  const src = suite.ledger;
  const fileSchema = parseInt(src.schema, 10) || 0;
  // Work on a copy, so the file's contents are only cleaned, never the live data.
  let d;
  try{
    d = JSON.parse(JSON.stringify({accts:src.accts, txns:src.txns, cats:src.cats, rules:src.rules,
        assets:src.assets, settings:src.settings, recur:src.recur, budgets:src.budgets}));
    // Investments travel too (v57+). An older backup has none: then what is on
    // this phone is kept, never emptied.
    if(src.invest && Array.isArray(src.invest.trades))
      d.invest = JSON.parse(JSON.stringify(Object.assign({}, src.invest, {trades: src.invest.trades.filter(t=> t && typeof t==='object' && /^\d{4}-\d{2}-\d{2}/.test(t.date||'') && isFinite(t.qty)), prices: src.invest.prices || {}})));
  }catch(e){ return {error:'That file could not be read. It may be damaged.'}; }
  // v69: savings pots. An older backup has none: then this phone's are kept.
  if(Array.isArray(src.pots)) d.pots = JSON.parse(JSON.stringify(src.pots.filter(p=> p && typeof p === 'object' && p.id)));
  const did = tidyData(d);
  if(fileSchema < SCHEMA){ try{ migrateData(d, fileSchema); }catch(e){} }
  const dates = d.txns.map(t=>t.date.slice(0,10)).sort();
  return { suite, d, did, fileSchema, newer: fileSchema > SCHEMA,
           impmap: (src.impmap && typeof src.impmap === 'object') ? src.impmap : null,
           saved: suite.exported ? String(suite.exported).slice(0,10) : null,
           first: dates[0] || null, last: dates[dates.length-1] || null };
}
function renderRestorePreview(info){
  const nice = s => s ? parseYMD(s).toLocaleDateString('en-GB',{day:'numeric', month:'short', year:'numeric'}) : '—';
  const mine = txns.map(t=>String(t.date).slice(0,10)).sort();
  const myLast = mine[mine.length-1] || null;
  const d = info.d;
  const row = (label, a, b)=> '<div class="rs-row"><span>'+label+'</span><b>'+a+'</b><b class="rs-now">'+b+'</b></div>';
  const warn = [];
  if(info.newer) warn.push(['bad','This backup was made by a newer Ledger. Update the app first, then restore.']);
  const lost = info.last ? txns.filter(t=>String(t.date).slice(0,10) > info.last).length : txns.length;
  if(!info.newer && lost && d.txns.length <= txns.length)
    warn.push(['amber','This backup is older than what is on your phone. '+lost+' newer entr'+(lost===1?'y':'ies')+' here would be lost.']);
  if(info.did.dropped) warn.push(['amber', info.did.dropped+' damaged entr'+(info.did.dropped===1?'y':'ies')+' in the file will be left out.']);
  if(!d.txns.length) warn.push(['amber','This backup has no transactions in it.']);
  document.getElementById('restore-body').innerHTML =
    '<div class="rs-table">'+
      '<div class="rs-row rs-head"><span></span><b>In the file</b><b class="rs-now">On this phone</b></div>'+
      row('Saved', nice(info.saved), 'now')+
      row('Transactions', d.txns.length.toLocaleString('en-GB'), txns.length.toLocaleString('en-GB'))+
      row('Newest entry', nice(info.last), nice(myLast))+
      row('Accounts', d.accts.length, accts.length)+
      row('Assets', d.assets.length, assets.length)+
      row('Bills and subs', d.recur.length, recur.length)+
      row('Investment entries', d.invest ? d.invest.trades.length.toLocaleString('en-GB') : 'not in file', invest.trades.length.toLocaleString('en-GB'))+
    '</div>'+
    warn.map(w=>'<div class="rs-warn '+w[0]+'">'+esc(w[1])+'</div>').join('')+
    (info.suite.coach ? '<div class="note" style="margin-top:10px;">Also holds COACH data. That is carried into your next backup.</div>' : '')+
    '<div class="note" style="margin-top:10px;">What is on the phone now is kept as an undo step.</div>';
  const go = document.getElementById('restore-go');
  go.disabled = !!info.newer;
  go.style.opacity = info.newer ? '.4' : '';
}
function applyRestore(info){
  const d = info.d;
  snapshot('Restore from backup');
  accts = d.accts; txns = d.txns; cats = d.cats; rules = d.rules;
  assets = d.assets; settings = d.settings; recur = d.recur; budgets = d.budgets;
  save(K.accts,accts); save(K.txns,txns); save(K.cats,cats);
  save(K.rules,rules); save(K.assets,assets); save(K.settings,settings);
  save(K.recur,recur); save(K.budgets,budgets);
  // Older backups do not have it; then what is on the phone is kept.
  if(info.impmap) save(K.impmap, info.impmap);
  if(d.invest){
    // v62: a backup from before v58 has no categories - keep this phone's.
    // And every entry must have a category, or its money silently drops out
    // of every total.
    const cats0 = Array.isArray(d.invest.cats) && d.invest.cats.length ? d.invest.cats : invCats().map(c=>Object.assign({}, c));
    const have = new Set(cats0.map(c=>c.id));
    for(const t of d.invest.trades){ if(t.cat && t.cat !== 'cash' && !have.has(t.cat)){ have.add(t.cat); cats0.push({id:t.cat, name:t.cat.charAt(0).toUpperCase()+t.cat.slice(1), type: t.cat==='crypto' ? 'crypto' : 'other'}); } }
    d.invest.cats = cats0;
    invest = d.invest; saveInvest();
  }
  if(Array.isArray(d.pots)){ pots = d.pots; savePots(); }
  try{ localStorage.setItem(K_SCHEMA, String(SCHEMA)); }catch(e){}
  if(info.suite.coach) setCarry(info.suite.coach, info.saved || todayYMD());
  // v65: older backups have no look settings; then this phone's are kept.
  const look = info.suite.ledger && info.suite.ledger.look;
  if(look && typeof look === 'object'){
    for(const k of LOOK_KEYS){ if(typeof look[k] === 'string'){ try{ localStorage.setItem(k, look[k]); }catch(e){} } }
    try{ applyFolds(); }catch(e){}
  }
  render();
  showToast('Restored '+txns.length.toLocaleString('en-GB')+' transactions', ()=> doRollback());
}
document.getElementById('restore-file').addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const rd = new FileReader();
  rd.onload = ()=> openRestoreText(String(rd.result));
  rd.onerror = ()=> alert('That file could not be read.');
  rd.readAsText(f);
  e.target.value = '';
});
// v69: one way in for a backup's text, from a file or from the cloud.
function openRestoreText(text){
    const info = inspectBackup(text);
    if(info.error){ alert(info.error); return; }
    if(info.coachOnly){
      setCarry(info.suite.coach, info.suite.exported ? info.suite.exported.slice(0,10) : todayYMD());
      renderMore();
      alert('That file holds no Ledger data, so nothing here was changed.\n\n'+
            'Its COACH data is now carried in your next Ledger backup, so one file covers both apps.');
      return;
    }
    restorePending = info;
    renderRestorePreview(info);
    openSheet('restore-backdrop');
}
document.getElementById('restore-cancel').onclick = ()=>{ restorePending = null; closeSheet('restore-backdrop'); };
document.getElementById('restore-go').onclick = ()=>{
  const info = restorePending; if(!info || info.newer) return;
  restorePending = null;
  closeSheet('restore-backdrop');
  applyRestore(info);
};
/* ---- exporting a period at a time ----

   The whole-file export answers "give me my transactions". This answers the
   question you actually ask a spreadsheet: what went out, week by week or month
   by month, and on what. Long format rather than a column per category, because
   categories come and go and a ragged header is no use to a pivot table. */
function periodSlices(kind, howMany){
  const out = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if(kind === 'week'){
    let st = weekStart(today);
    for(let i = 0; i < howMany; i++){
      const a = new Date(st.getTime() - i * 7 * 86400000);
      const b = new Date(a.getTime() + 6 * 86400000);
      out.push({a, b, label: ymd(a)});
    }
  } else {
    for(let i = 0; i < howMany; i++){
      const a = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const b = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
      out.push({a, b, label: ymd(a).slice(0, 7)});
    }
  }
  return out.reverse();
}

function exportPeriods(kind, howMany){
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['period', 'kind', 'start', 'end', 'category',
                 'money_in', 'money_out', 'net', 'transactions', 'currency'].join(',')];
  let any = 0;
  periodSlices(kind, howMany).forEach(sl=>{
    const t = periodTotals(sl.a, sl.b);
    if(!t.count && !t.inn && !t.out) return;
    any++;
    rows.push([q(sl.label), kind, ymd(sl.a), ymd(sl.b), q('(all)'),
               t.inn.toFixed(2), t.out.toFixed(2), t.net.toFixed(2),
               t.count, curCode()].join(','));
    Object.keys(t.byCat).sort((x, y)=>t.byCat[y] - t.byCat[x]).forEach(cid=>{
      const name = cid === '__none' ? 'Needs a category' : (catById(cid) || {name: cid}).name;
      rows.push([q(sl.label), kind, ymd(sl.a), ymd(sl.b), q(name),
                 '', t.byCat[cid].toFixed(2), '', '', curCode()].join(','));
    });
  });
  if(!any){ alert('Nothing recorded in that stretch yet.'); return; }
  download('ledger-' + kind + 'ly-' + todayYMD() + '.csv', rows.join('\n'), 'text/csv');
}

function renderExportOpts(){
  const box = document.getElementById('export-opts');
  if(!box) return;
  const opts = [
    ['week', 12, 'Last 12 weeks'],
    ['week', 52, 'Last 52 weeks'],
    ['month', 6, 'Last 6 months'],
    ['month', 12, 'Last 12 months'],
    ['month', 36, 'Last 3 years']
  ];
  box.innerHTML = '<div class="card">' + opts.map(([k, n, label], i)=>
    '<div class="lrow tap" data-exp="' + i + '"><div><div class="d1">' + label + '</div>'+
    '<div class="d2">' + (k === 'week' ? 'One row per week' : 'One row per month') +
    ', plus its categories</div></div>'+
    '<div class="amtcol"><i class="ti ti-download" style="color:var(--text3)"></i></div></div>'
  ).join('') + '</div>';
  box.querySelectorAll('[data-exp]').forEach(el=>{
    el.onclick = ()=>{ const [k, n] = opts[Number(el.dataset.exp)]; exportPeriods(k, n); };
  });
}

document.getElementById('do-periods').onclick = ()=>{
  renderExportOpts();
  openSheet('export-backdrop');
};
document.getElementById('export-close').onclick = ()=> closeSheet('export-backdrop');

document.getElementById('do-csv').onclick = ()=>{
  const rows = [['date','type','description','category','account','to_account','amount','currency','note']];
  [...txns].sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>{
    rows.push([t.date, t.dir, '"'+String(t.desc||'').replace(/"/g,'""')+'"',
      t.cat?catById(t.cat).name:'', acctById(t.acct).name,
      t.toAcct?acctById(t.toAcct).name:'', t.amount.toFixed(2), curCode(), '"'+String(t.memo||'').replace(/"/g,'""')+'"']);
  });
  download('ledger-transactions-'+todayYMD()+'.csv', rows.map(r=>r.join(',')).join('\n'), 'text/csv');
};
