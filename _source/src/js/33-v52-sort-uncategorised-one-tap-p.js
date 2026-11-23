// ============================================================
// v52: Sort uncategorised — one tap per row. Opened from the Home alert,
// the Spending button, the import results and the check-in. Picking a
// category files every untagged payment from the same shop and remembers the
// shop as a rule, exactly as the old tagging sheet did, so nothing about how
// rules are stored has changed.
// ============================================================
function sortKey(t){
  return merchantKey(t.desc) || merchantKey(t.note) || String(t.desc||'').toLowerCase().slice(0,18) || 'unlabelled';
}
function needsCat(t){ return !!t && !t.cat && t.dir !== 'transfer'; }
function needsAttention(t){ return needsCat(t) || needsMemo(t); }
function uncatList(){
  return txns.filter(needsAttention).sort((a,b)=> String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
}
const CAT_HINTS = [
  [/fuel|petrol|esso|texaco|\bbp\b|shell/, 'transport'],
  [/stagecoach|\bbus\b|train|scotrail|lner|\buber\b(?!\s*eats)|taxi|bolt/, 'transport'],
  [/tesco|lidl|aldi|asda|sainsbury|morrisons|co-?op|iceland|waitrose|spar\b/, 'groceries'],
  [/kebab|pizza|nando|mcdonald|kfc|burger|subway|greggs|pret|costa|starbucks|cafe|coffee|restaurant|deliveroo|just eat|uber eats|takeaway/, 'eatingout'],
  [/gym|leisure|fitness|boots|pharmacy|superdrug|physio/, 'health'],
  [/amazon|ebay|argos|primark|currys|h&m|zara|tk ?maxx/, 'shopping'],
  [/spotify|netflix|icloud|apple\.com|google|disney|prime video|youtube/, 'subs'],
  [/rent|council|energy|electric|water|vodafone|\bo2\b|\bee\b|broadband/, 'rent'],
  [/\bbar\b|\bpub\b|club|cinema|odeon|\bvue\b|ticket/, 'fun'],
  [/salary|wages|payroll/, 'income'],
  [/refund/, 'refunds'],
  [/coinbase|pearler|binance|kraken|trading ?212|vanguard|freetrade|etoro|commsec|selfwealth|spaceship|raiz|swyftx|coinspot|bitpanda|revolut ?(?:invest|crypto)/, 'invested'],
];
function suggestCats(t){
  const kind = t.dir === 'in' ? 'income' : 'spend';
  const out = [];
  const add = id => { const c = cats.find(x=>x.id===id); if(c && (c.kind === kind || c.id === 'invested') && !out.includes(id)) out.push(id); };
  const key = sortKey(t);
  // 1. what this shop was filed as before
  const seen = {};
  txns.forEach(x=>{ if(x.cat && x.id !== t.id && sortKey(x) === key) seen[x.cat] = (seen[x.cat]||0) + 1; });
  Object.entries(seen).sort((a,b)=>b[1]-a[1]).forEach(([id])=>add(id));
  // 2. a rule that already matches
  try{ const r = applyRules(t.desc); if(r) add(r); }catch(e){}
  // 3. words in the name
  const d = (String(t.desc||'')+' '+String(t.note||'')).toLowerCase();
  CAT_HINTS.forEach(([re, id])=>{ if(re.test(d)) add(id); });
  // 4. whatever you use most
  const use = {};
  txns.forEach(x=>{ if(x.cat) use[x.cat] = (use[x.cat]||0) + 1; });
  // Other and Transfers only come up as a quick pick if this shop has been
  // filed that way before; otherwise they sit in More…, since they need a note.
  Object.entries(use).sort((a,b)=>b[1]-a[1]).forEach(([id])=>{ if(!noteCat(id)) add(id); });
  cats.forEach(c=>{ if(!noteCat(c.id)) add(c.id); });
  return out.slice(0,3);
}
function catOptions(t){
  const kind = t.dir === 'in' ? 'income' : 'spend';
  return cats.filter(c=>c.kind===kind).concat(cats.filter(c=>c.kind==='transfer'));
}

let toastTimer = null;
function showToast(html, undoFn){
  const el = document.getElementById('toast');
  document.getElementById('toast-t').innerHTML = html;
  const u = document.getElementById('toast-undo');
  u.style.display = undoFn ? '' : 'none';
  u.onclick = ()=>{ hideToast(); if(undoFn) undoFn(); };
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast(){ clearTimeout(toastTimer); const el = document.getElementById('toast'); if(el) el.hidden = true; }

function fileShop(t, cat){
  const key = sortKey(t);
  const ids = txns.filter(x=> needsCat(x) && x.dir === t.dir && sortKey(x) === key).map(x=>x.id);
  if(!ids.includes(t.id)) ids.push(t.id);
  const idset = new Set(ids);
  const before = {};
  txns = txns.map(x=>{ if(!idset.has(x.id)) return x; before[x.id] = x.cat; return {...x, cat}; });
  let ruleAdded = null;
  const mk = merchantKey(t.desc);
  if(mk && mk.length >= 3 && !rules.some(r=>String(r.match||'').toLowerCase() === mk)){
    rules.push({match:mk, cat}); save(K.rules, rules); ruleAdded = mk;
  }
  save(K.txns, txns);
  return {ids, before, ruleAdded, cat, name: t.desc || key};
}
function unfileShop(ch){
  txns = txns.map(x=> Object.prototype.hasOwnProperty.call(ch.before, x.id) ? {...x, cat: ch.before[x.id]} : x);
  if(ch.ruleAdded){ rules = rules.filter(r=> String(r.match||'').toLowerCase() !== ch.ruleAdded); save(K.rules, rules); }
  save(K.txns, txns);
}

const SORT_SHOW = 40;
let sortPending = {};   // row id -> a note-needing category picked, waiting for its note
function sortRowsHTML(list){
  const counts = {};
  list.forEach(x=>{ const k = x.dir+'|'+sortKey(x); counts[k] = (counts[k]||0) + 1; });
  return list.slice(0, SORT_SHOW).map(t=>{
    const sug = suggestCats(t);
    const same = counts[t.dir+'|'+sortKey(t)];
    const d = parseYMD(t.date).toLocaleDateString('en-GB',{weekday:'short', day:'numeric', month:'short'});
    const pend = sortPending[t.id] || (needsMemo(t) ? t.cat : null);
    if(pend){
      return '<div class="srow memo-mode" data-srow="'+esc(t.id)+'">'+
        '<div class="sr-top"><div style="flex:1; min-width:0;"><div class="sr-name">'+esc(t.desc||'Untitled')+'</div>'+
        '<div class="sr-sub">'+esc(d)+' · '+esc(acctById(t.acct).name)+'</div></div>'+
        '<div class="sr-amt'+(t.dir==='in'?' in':'')+'">'+(t.dir==='in'?'+':'')+money(t.amount)+'</div></div>'+
        '<label class="memo-lab" for="memo-'+esc(t.id)+'">What was this for? <span>Needed for '+esc(catById(pend).name)+'</span></label>'+
        '<div class="memo-row"><input id="memo-'+esc(t.id)+'" data-memo maxlength="80" placeholder="e.g. paid Sam back for dinner" autocapitalize="sentences" enterkeyhint="done">'+
        '<button class="memo-save" data-memosave="'+esc(pend)+'">Save</button></div>'+
        '<div class="memo-err" data-memoerr hidden>Type a few words first.</div>'+
        '<button class="memo-change" data-memochange>Pick a different category</button></div>';
    }
    return '<div class="srow" data-srow="'+esc(t.id)+'">'+
      '<div class="sr-top"><div style="flex:1; min-width:0;"><div class="sr-name">'+esc(t.desc||'Untitled')+'</div>'+
      '<div class="sr-sub">'+esc(d)+' · '+esc(acctById(t.acct).name)+(same > 1 ? ' · '+same+' from here' : '')+'</div></div>'+
      '<div class="sr-amt'+(t.dir==='in'?' in':'')+'">'+(t.dir==='in'?'+':'')+money(t.amount)+'</div></div>'+
      '<div class="chips">'+sug.map(id=>{ const c = catById(id);
        return '<button class="cchip" data-pick="'+esc(id)+'"><i style="background:'+esc(c.colour||'#6b7684')+'"></i>'+esc(c.name)+'</button>'; }).join('')+
      '<span class="cchip more">More…<select data-pickmore aria-label="All categories for '+esc(t.desc||'this payment')+'"><option value="">Choose…</option>'+
        catOptions(t).map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></span></div></div>';
  }).join('') + (list.length > SORT_SHOW ? '<div class="sort-more">'+(list.length - SORT_SHOW)+' more after these</div>' : '');
}
function wireSortRows(box, after){
  box.querySelectorAll('[data-srow]').forEach(row=>{
    const id = row.dataset.srow;
    let used = false;
    const go = cat=>{
      if(used || !cat) return;
      const t = txns.find(x=>x.id===id); if(!t || !needsAttention(t)) return;
      // A vague category waits for its note, on this payment only. It is not
      // remembered for the shop: "Other" for one payment says nothing about the next.
      if(noteCat(cat)){
        sortPending[id] = cat;
        after();
        setTimeout(()=>{ const i = document.getElementById('memo-'+id); if(i) i.focus(); }, 60);
        return;
      }
      used = true;
      const ch = fileShop(t, cat);
      buzz();
      ch.ids.forEach(i=> box.querySelectorAll('[data-srow]').forEach(r=>{ if(r.dataset.srow === i) r.classList.add('going'); }));
      const n = ch.ids.length;
      showToast('<b>'+esc(ch.name)+' → '+esc(catById(cat).name)+'</b><br><span>'+(n > 1 ? n+' sorted · ' : '')+'remembered for next time</span>',
        ()=>{ unfileShop(ch); render(); after(); });
      setTimeout(()=>{ render(); after(); }, 250);
    };
    row.querySelectorAll('[data-pick]').forEach(b=> b.onclick = ()=> go(b.dataset.pick));
    const sel = row.querySelector('[data-pickmore]');
    if(sel) sel.onchange = ()=> go(sel.value);
    // note mode
    const mi = row.querySelector('[data-memo]'), ms = row.querySelector('[data-memosave]');
    if(mi && ms){
      const saveMemo = ()=>{
        if(used) return;
        const memo = mi.value.trim();
        if(memo.length < 2){ row.querySelector('[data-memoerr]').hidden = false; mi.focus(); return; }
        const cat = ms.dataset.memosave;
        const t = txns.find(x=>x.id===id); if(!t) return;
        used = true;
        const prev = {cat: t.cat, memo: t.memo};
        txns = txns.map(x=> x.id===id ? {...x, cat, memo} : x);
        save(K.txns, txns);
        delete sortPending[id];
        buzz();
        row.classList.add('going');
        showToast('<b>'+esc(t.desc||'Payment')+' → '+esc(catById(cat).name)+'</b><br><span>“'+esc(memo)+'”</span>',
          ()=>{ txns = txns.map(x=> x.id===id ? {...x, cat: prev.cat, memo: prev.memo} : x); save(K.txns, txns); render(); after(); });
        setTimeout(()=>{ render(); after(); }, 250);
      };
      ms.onclick = saveMemo;
      mi.addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); saveMemo(); } });
      mi.addEventListener('input', ()=>{ row.querySelector('[data-memoerr]').hidden = true; });
      const ch = row.querySelector('[data-memochange]');
      if(ch) ch.onclick = ()=>{
        const t = txns.find(x=>x.id===id);
        delete sortPending[id];
        // an existing Other without a note goes back to choosing
        if(t && needsMemo(t)){ txns = txns.map(x=> x.id===id ? {...x, cat: null} : x); save(K.txns, txns); render(); }
        after();
      };
    }
  });
}

const TICK_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
let sortTotal = 0;
function renderSortSheet(){
  const list = uncatList();
  if(list.length > sortTotal) sortTotal = list.length;
  const box = document.getElementById('sort-list');
  document.getElementById('sort-left').textContent = list.length ? list.length+' left' : 'All done';
  document.getElementById('sort-bar').style.width = (sortTotal ? (sortTotal - list.length)/sortTotal*100 : 100) + '%';
  box.innerHTML = list.length ? sortRowsHTML(list)
    : '<div class="sort-done"><div class="tick">'+TICK_SVG+'</div><b>All sorted</b>'+
      '<div class="note">Everything now counts in your spending.</div>'+
      '<button class="btn" id="sort-done-btn" style="margin-top:8px;">Done</button></div>';
  wireSortRows(box, renderSortSheet);
  const db = document.getElementById('sort-done-btn');
  if(db) db.onclick = ()=>{ closeSheet('sort-backdrop'); hideToast(); };
}
function openSort(){
  sortTotal = 0; sortPending = {};
  renderSortSheet();
  openSheet('sort-backdrop');
}
document.getElementById('t-cat').addEventListener('change', updateMemoLabel);
// v54: Fix things / Export. A row in either closes its sheet first, so the
// tool it opens is never stacked on top of it.
document.getElementById('open-fix').onclick = ()=> openSheet('fix-backdrop');
// v55: settings groups
document.querySelectorAll('.set-cat').forEach(b=> b.onclick = ()=>{
  const k = b.dataset.set;
  openSheet(k === 'fix' ? 'fix-backdrop' : 'set-'+k+'-backdrop');
});
document.querySelectorAll('[data-close-sheet]').forEach(b=> b.onclick = ()=> closeSheet(b.dataset.closeSheet));
// A row that opens something else closes its group first, so sheets never stack.
document.querySelectorAll('.set-rows').forEach(list=> list.addEventListener('click', e=>{
  if(e.target.closest('.lrow.tap')) closeSheet(list.dataset.closes);
}, true));
document.getElementById('fix-close').onclick = ()=> closeSheet('fix-backdrop');
document.getElementById('open-export').onclick = ()=> openSheet('exportpick-backdrop');
document.getElementById('exportpick-close').onclick = ()=> closeSheet('exportpick-backdrop');
document.getElementById('fix-list').addEventListener('click', e=>{ if(e.target.closest('.lrow.tap')) closeSheet('fix-backdrop'); }, true);
document.getElementById('exportpick-list').addEventListener('click', e=>{ if(e.target.closest('.lrow.tap')) closeSheet('exportpick-backdrop'); }, true);
document.getElementById('t-memo').addEventListener('input', ()=>{ document.getElementById('t-memo-err').hidden = true; });
document.getElementById('sort-close').onclick = ()=>{ closeSheet('sort-backdrop'); hideToast(); };
