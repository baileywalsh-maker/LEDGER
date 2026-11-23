// ============================================================
// v69: automatic daily cloud backup
// ============================================================
// Once a day, on the first open, Ledger saves the same backup file it shares to
// Files into the private sync repo, as backups/ledger-backup.json. GitHub keeps
// every earlier version of that file, so "Put back" can offer any day, and the
// repo stays small (one file, versions kept as history).
// Uses the sync token already on the phone (Contents read/write on that private
// repo only). Off when sync is off. The token is never in the file.
// A day counts as backed up only once GitHub confirms the save.
const CLOUD_PATH = 'backups/ledger-backup.json';
const CLOUD_BASE = 'https://api.github.com/repos/' + SYNC_OWNER + '/' + SYNC_REPO;
const CLOUD_API = CLOUD_BASE + '/contents/' + CLOUD_PATH;
const CLOUD_DAY_KEY = 'ledger:cloudday';   // the day of the last confirmed cloud save (phone only)
let cloudBusy = false;

function backupPayloadText(pretty){
  const payload = Object.assign({ __suite: SUITE_VERSION, exported:new Date().toISOString() },
                                ledgerSection(), { coach: loadCarry() });
  return JSON.stringify(payload, null, pretty ? 2 : 0);
}
function cloudBackupOn(){ return syncEnabled() && !!syncToken(); }
function cloudLastDay(){ try{ return localStorage.getItem(CLOUD_DAY_KEY) || null; }catch(e){ return null; } }
function cloudHeaders(token, raw){
  return {'Authorization':'Bearer ' + token, 'Accept': raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'};
}
async function cloudBackupNow(opts){
  opts = opts || {};
  if(cloudBusy) return {ok:false, reason:'busy'};
  if(!cloudBackupOn()){ if(!opts.quiet) showToast('Turn on Sync with Muse first: cloud backup uses the same private repo'); return {ok:false, reason:'off'}; }
  const token = syncToken();
  cloudBusy = true;
  try{
    let sha = null, r;
    try{ r = await fetch(CLOUD_API, {headers:cloudHeaders(token), cache:'no-store'}); }
    catch(e){ throw Object.assign(new Error('offline'), {code:'offline'}); }
    if(r.status === 401 || r.status === 403) throw Object.assign(new Error('auth'), {code:'auth'});
    if(r.ok){ const d = await r.json(); sha = d && d.sha || null; }
    else if(r.status !== 404) throw Object.assign(new Error('http ' + r.status), {code:'http'});
    const day = todayYMD();
    const body = {message:'Ledger backup ' + day, content:btoa(unescape(encodeURIComponent(backupPayloadText(false))))};
    if(sha) body.sha = sha;
    try{
      r = await fetch(CLOUD_API, {method:'PUT', headers:Object.assign(cloudHeaders(token), {'Content-Type':'application/json'}), body:JSON.stringify(body)});
    }catch(e){ throw Object.assign(new Error('offline'), {code:'offline'}); }
    if(r.status === 401 || r.status === 403) throw Object.assign(new Error('auth'), {code:'auth'});
    if(!r.ok) throw Object.assign(new Error('http ' + r.status), {code:'http'});
    // Confirmed by GitHub: this day is backed up.
    try{ localStorage.setItem(CLOUD_DAY_KEY, day); localStorage.setItem('ledger:lastbackupday', day); }catch(e){}
    settings.lastBackup = day; save(K.settings, settings);
    if(!opts.quiet){ sfx('safe'); showToast('Backed up to your private GitHub'); }
    render(); if(typeof renderMore === 'function') try{ renderMore(); }catch(e){}
    return {ok:true};
  }catch(e){
    if(!opts.quiet) showToast(e.code === 'auth' ? 'GitHub did not accept the token. Check it in Sync with Muse'
      : e.code === 'offline' ? 'No connection. Ledger tries again next time you open it'
      : 'Cloud backup failed (' + e.message + ')');
    return {ok:false, reason:e.code};
  }finally{ cloudBusy = false; }
}
// First open of each day (and when Ledger comes back to the front on a new day).
function cloudBackupDaily(){
  if(!cloudBackupOn() || cloudLastDay() === todayYMD()) return;
  cloudBackupNow({quiet:true});
}
setTimeout(cloudBackupDaily, 6000);   // after sync has pulled in anything from Muse
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) setTimeout(cloudBackupDaily, 1500); });

// ---- Put back: pick a day ----
async function cloudListDays(){
  const token = syncToken();
  let r;
  try{ r = await fetch(CLOUD_BASE + '/commits?path=' + encodeURIComponent(CLOUD_PATH) + '&per_page=60', {headers:cloudHeaders(token), cache:'no-store'}); }
  catch(e){ throw Object.assign(new Error('offline'), {code:'offline'}); }
  if(r.status === 401 || r.status === 403) throw Object.assign(new Error('auth'), {code:'auth'});
  if(!r.ok) throw Object.assign(new Error('http ' + r.status), {code:'http'});
  const list = await r.json();
  // One per day: the newest save of each day.
  const seen = {}, out = [];
  for(const c of (Array.isArray(list) ? list : [])){
    const when = c && c.commit && (c.commit.author && c.commit.author.date || c.commit.committer && c.commit.committer.date);
    if(!when) continue;
    const d = new Date(when), day = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if(seen[day]) continue;
    seen[day] = 1; out.push({day, sha:c.sha});
  }
  return out;
}
async function cloudFetchAt(sha){
  const token = syncToken();
  let r;
  try{ r = await fetch(CLOUD_API + '?ref=' + encodeURIComponent(sha), {headers:cloudHeaders(token, true), cache:'no-store'}); }
  catch(e){ throw Object.assign(new Error('offline'), {code:'offline'}); }
  if(!r.ok) throw Object.assign(new Error('http ' + r.status), {code:r.status === 401 || r.status === 403 ? 'auth' : 'http'});
  return await r.text();
}
async function openCloudPutBack(){
  const body = document.getElementById('cloud-body');
  if(!cloudBackupOn()){
    body.innerHTML = '<div class="note">Cloud backup uses the same private repo as Sync with Muse. Turn sync on (Settings → Your data) and it starts the next day you open Ledger.</div>';
    openSheet('cloud-backdrop'); return;
  }
  body.innerHTML = '<div class="note">Looking up your backups…</div>';
  openSheet('cloud-backdrop');
  try{
    const days = await cloudListDays();
    if(!days.length){ body.innerHTML = '<div class="note">No cloud backups yet. The first is saved the next time you open Ledger.</div>'; return; }
    const nice = s => parseYMD(s).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
    body.innerHTML = '<div class="card">' + days.map((x, i) =>
      '<div class="lrow tap" data-cloudsha="' + esc(x.sha) + '"><div><div class="d1">' + nice(x.day) + '</div>' +
      (i === 0 ? '<div class="d2">Newest</div>' : '') + '</div><div class="amtcol"><i class="ti ti-chevron-right" style="color:var(--text3)"></i></div></div>').join('') + '</div>' +
      '<p class="note" style="margin:8px 2px 0;">You see what\'s in it next to what\'s on your phone before anything changes.</p>';
    body.querySelectorAll('[data-cloudsha]').forEach(row => row.onclick = async ()=>{
      row.querySelector('.d1').textContent += ' · opening…';
      try{
        const text = await cloudFetchAt(row.dataset.cloudsha);
        closeSheet('cloud-backdrop');
        openRestoreText(text);
      }catch(e){ showToast(e.code === 'offline' ? 'No connection' : 'Could not open that backup (' + e.message + ')'); }
    });
  }catch(e){
    body.innerHTML = '<div class="note">' + (e.code === 'auth' ? 'GitHub did not accept the token. Check it in Sync with Muse.'
      : e.code === 'offline' ? 'No connection. Try again when you are online.' : 'Could not reach GitHub (' + esc(e.message) + ').') + '</div>';
  }
}
document.getElementById('do-cloud-putback').onclick = openCloudPutBack;
document.getElementById('cloud-close').onclick = ()=> closeSheet('cloud-backdrop');
function paintCloudRow(){
  const el = document.getElementById('cloud-sub'); if(!el) return;
  if(!cloudBackupOn()){ el.textContent = 'Turn on Sync with Muse to back up every day'; return; }
  const d = cloudLastDay();
  el.textContent = d === todayYMD() ? 'Every day · saved today'
    : d ? 'Every day · last saved ' + parseYMD(d).toLocaleDateString('en-GB', {day:'numeric', month:'short'})
    : 'Every day · first one saves next time you open Ledger';
}
paintCloudRow();
