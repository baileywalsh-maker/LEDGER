// ============================================================
// v52: the Sunday check-in as one guided flow. Each step is done on its own
// screen and moves on by itself. Import and "show me why" open the existing,
// tested sheets on top of the flow rather than copies of them, so the import
// rules and the balance explanations are exactly what they were.
// ============================================================
let ciOpen = false, ciCur = null, ciMeta = {};
let ciPendingOpen = false, monthAfterCheckin = false;
const ciWeek = ()=> ymd(weekStart(new Date()));
function ciSkipped(){
  const s = settings.ciSkip;
  return (s && s.week === ciWeek() && Array.isArray(s.keys)) ? s.keys.slice() : [];
}
function ciSkip(key){
  const keys = ciSkipped();
  if(!keys.includes(key)) keys.push(key);
  settings.ciSkip = {week: ciWeek(), keys};
  save(K.settings, settings);
}
function ciSteps(){ return weekTasks().filter(t=>!t.na); }
function ciFirstOpen(){
  const s = ciSteps().find(t=>!t.done && !t.skip);
  return s ? s.key : 'done';
}
function openCheckin(){
  if(accts.length === 0){ alert('Add an account first — you will find it under Settings.'); return; }
  ciOpen = true; weekFlow = true; ciMeta = {av:{}, bal:{}, leave:{}};
  ciCur = ciFirstOpen();
  const el = document.getElementById('ci');
  el.hidden = false;
  el.classList.remove('opening'); void el.offsetWidth; el.classList.add('opening');
  document.body.classList.add('ci-open');
  ciRender(false);
}
function closeCheckin(){
  const finished = ciCur === 'done';
  ciOpen = false; weekFlow = false;
  document.getElementById('ci').hidden = true;
  document.body.classList.remove('ci-open');
  hideToast();
  // Closing part-way keeps your place, and stops it popping up again today.
  if(!finished){ settings.weekSnooze = todayYMD(); save(K.settings, settings); }
  render();
  if(monthAfterCheckin){ monthAfterCheckin = false; setTimeout(maybeMonthlyCheckin, 500); }
}
function ciNext(){
  const steps = ciSteps();
  const i = steps.findIndex(t=>t.key===ciCur);
  const after = steps.slice(i + 1).find(t=>!t.done && !t.skip);
  const any = steps.find(t=>!t.done && !t.skip && t.key !== ciCur);
  const prev = ciCur;
  hideToast();   // an undo belongs to the step it was made on
  ciCur = after ? after.key : (any ? any.key : 'done');
  if(prev === 'lastImport' && ciMeta.import) ciMeta.bannerOn = ciCur;
  ciRender(true);
}
// A task finished in a sheet on top of the flow (import, balance check).
function ciRefresh(){
  if(!ciOpen) return;
  const t = ciSteps().find(x=>x.key===ciCur);
  if(ciCur === 'lastImport' && t && t.done){ ciNext(); return; }
  ciRender(false);
}

function ciMoney(v){ return Number(String(v==null?'':v).replace(/[£$€,\s]/g,'').replace(/^A\$/,'')); }
function ciPlain(v){ const n = Math.round(Number(v)*100)/100; return isFinite(n) ? String(n) : ''; }

function ciRender(slide){
  const body = document.getElementById('ci-body');
  const steps = ciSteps();
  const idx = steps.findIndex(t=>t.key===ciCur);
  document.getElementById('ci-step').textContent = ciCur === 'done' ? 'All done' : 'Step '+(idx+1)+' of '+steps.length;
  const prog = document.getElementById('ci-prog');
  prog.style.gridTemplateColumns = 'repeat('+steps.length+', minmax(0,1fr))';
  prog.innerHTML = steps.map((t,i)=>'<i class="'+(ciCur==='done' || i <= idx ? 'on' : '')+'"></i>').join('');
  const main = document.getElementById('ci-main'), skip = document.getElementById('ci-skip');
  main.className = 'btn'; main.onclick = null; skip.onclick = null; skip.style.display = '';
  const view = CI_VIEWS[ciCur] || CI_VIEWS.done;
  const st = body.scrollTop;
  body.innerHTML = view.html();
  view.wire(main, skip);
  if(slide){ body.scrollTop = 0; body.classList.remove('slide'); void body.offsetWidth; body.classList.add('slide'); }
  else body.scrollTop = st;
}
function ciBanner(){
  if(!ciMeta.import || ciMeta.bannerOn !== ciCur) return '';
  const m = ciMeta.import;
  return '<div class="ci-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--in)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>'+
    '<span>'+(m.added ? m.added+' transaction'+(m.added===1?'':'s')+' added' : 'Nothing new in that file')+
    (m.already ? ' · '+m.already+' already in' : '')+(m.superseded ? ' · '+m.superseded+' scheduled charge'+(m.superseded===1?'':'s')+' replaced' : '')+'</span></div>';
}
function ciSkipTo(skip, label, key){
  skip.textContent = label;
  skip.onclick = ()=>{ ciSkip(key); ciNext(); };
}
const ICON_SAFE = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M15.5 12H17M12 15.5V17M8.5 12H7"/></svg>';
const ICON_BOOK = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h6M8 11h6"/></svg>';

const CI_VIEWS = {
  lastImport: {
    html(){
      const usable = accts.filter(a=>a.type !== 'trading');
      const list = usable.length ? usable : accts;
      const sel = list.some(a=>a.id===settings.ciAcct) ? settings.ciAcct : list[0].id;
      const range = importRangeLine(sel);
      return '<h1 id="ci-title">Import this week</h1>'+
        '<p class="ci-lede">In Wise, download a CSV statement. <b>'+esc(String(range.text).replace(/[.\s]+$/,''))+'</b>.</p>'+
        '<div class="ci-card"><div class="ci-row"><label for="ci-acct">Account</label></div>'+
        '<select id="ci-acct" style="margin:10px 0 0;">'+list.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===sel?' selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select></div>'+
        '<p class="note" style="margin:4px 2px 0;">Ledger reads the file by itself and shows you what is new before anything is added.</p>';
    },
    wire(main, skip){
      const sel = document.getElementById('ci-acct');
      sel.onchange = ()=>{ settings.ciAcct = sel.value; save(K.settings, settings); ciRender(false); };
      main.textContent = 'Choose the Wise file';
      main.onclick = ()=>{
        // All in one tap, so the phone still counts it as you opening the file picker.
        document.getElementById('open-import').click();
        const ia = document.getElementById('imp-acct');
        ia.value = sel.value; ia.dispatchEvent(new Event('change'));
        document.getElementById('imp-file').click();
      };
      ciSkipTo(skip, 'Skip this step', 'lastImport');
    }
  },
  tag: {
    html(){
      const list = uncatList();
      if(!list.length) return ciBanner()+'<div class="ci-hero"><div class="ic gold" style="color:var(--in);">'+TICK_SVG+'</div><h1 id="ci-title">Everything has a category</h1><p>Nothing to sort this week.</p></div>';
      const shops = new Set(list.map(t=>t.dir+'|'+sortKey(t))).size;
      return ciBanner()+'<h1 id="ci-title">Sort the new shops</h1>'+
        '<p class="ci-lede">'+shops+' shop'+(shops===1?'':'s')+' to sort. Tap a category and it is remembered for good. Other and Transfers need a quick note. <b>'+list.length+' left</b></p>'+
        '<div id="ci-sort">'+sortRowsHTML(list)+'</div>';
    },
    wire(main, skip){
      const box = document.getElementById('ci-sort');
      const n = uncatList().length;
      if(box) wireSortRows(box, ()=>{
        if(!ciOpen || ciCur !== 'tag') return;
        ciRender(false);
        if(uncatList().length === 0) setTimeout(()=>{ if(ciOpen && ciCur === 'tag') ciNext(); }, 650);
      });
      if(n){
        main.textContent = 'Sort '+n+' more to continue';
        main.className = 'btn wait';
        main.onclick = ()=>{ const b = document.getElementById('ci-body'); if(b) b.scrollTop = 0; };
        ciSkipTo(skip, 'Leave them for later', 'tag');
      } else {
        main.textContent = 'Next';
        main.onclick = ()=> ciNext();
        skip.style.display = 'none';
      }
    }
  },
  lastAssetVal: {
    html(){
      const ago = ds => { if(!ds) return ''; const n = Math.floor((parseYMD(todayYMD()) - parseYMD(ds))/86400000); return n===0 ? 'today' : n===1 ? 'yesterday' : n+' days ago'; };
      const man = manualAssets();
      const imp = settings.lastInvImport;
      // v58: one card per investment category: import its file, and for
      // anything without live prices, what each holding is worth now.
      const cb = invCatIds().filter(invCatAny).map(cat=>{
        const C = invCatInfo(cat), S = invCategory(cat);
        const last = (invest.lastImport && invest.lastImport[cat]) || (C.type==='crypto' ? imp : null);
        // v59: every holding, every category - how many and what it is worth.
        ciMeta.iv = ciMeta.iv || {};
        const box = (key, lab, val, ph)=> '<div class="ci-hf"><span>'+lab+'</span><div class="money-in"><div class="box">'+(ph?'<span>'+esc(ph)+'</span>':'')+
          '<input data-iv="'+esc(key)+'" inputmode="decimal" autocomplete="off" value="'+esc(ciMeta.iv[key] != null ? ciMeta.iv[key] : val)+'"></div></div></div>';
        const vals = S.held.map(p=>{
          const bv = byValue(cat, p.sym);
          return '<div class="ci-hold"><div class="ci-row"><b>'+esc(symName(cat,p.sym))+'</b><span class="hint">'+(bv ? '' : esc(p.sym)+' · ')+'now '+money0(p.value)+'</span></div>'+
            '<div class="ci-hfs">'+(bv ? '' : box(cat+'|'+p.sym+'|q', 'How many', +p.qty.toPrecision(8), ''))+
            box(cat+'|'+p.sym+'|v', 'Worth now', ciPlain(p.value), curSym().trim())+'</div></div>';
        }).join('');
        return '<div class="ci-card ci-inv"><div class="ci-row"><b>'+esc(C.name)+'</b><span class="hint">'+(last ? 'Last import '+ago(last) : 'Not imported yet')+'</span></div>'+
          '<p class="ci-lede" style="margin:6px 0 10px;">'+(C.type==='crypto' ? 'Drop in your latest Coinbase file if you like, then check each one.' : 'Drop in your latest file if you have one, then check each one.')+'</p>'+
          '<button class="btn ghost" data-ci-imp="'+esc(cat)+'">Import '+esc(C.name)+' file</button>'+vals+'</div>';
      }).join('');
      return ciBanner()+'<h1 id="ci-title">'+(invAny() ? 'Check everything you own' : 'What are your assets worth?')+'</h1>'+
        (man.length ? '<p class="ci-lede">'+(invAny() ? 'These still need a category. Their value is filled in; change any that moved.' : 'Last value is filled in. Change any that moved.')+'</p>' : '')+
        cb+
        man.map(a=>{
          const last = assetValue(a);
          const lastDate = (a.values||[]).reduce((m,v)=> v && v.date > m ? v.date : m, '');
          const val = ciMeta.av[a.id] != null ? ciMeta.av[a.id] : ciPlain(last);
          return '<div class="ci-card"><div class="ci-row"><label for="ci-av-'+esc(a.id)+'">'+esc(a.name)+'</label>'+
            '<span class="hint">Last '+money0(last)+(lastDate ? ' · '+ago(lastDate) : '')+'</span></div>'+
            '<div class="money-in"><div class="box"><span>'+esc(curSym().trim())+'</span>'+
            '<input id="ci-av-'+esc(a.id)+'" data-av="'+esc(a.id)+'" inputmode="decimal" autocomplete="off" value="'+esc(val)+'"></div>'+
            '<div class="res" id="ci-avr-'+esc(a.id)+'"></div></div></div>';
        }).join('')+
        '<div class="ci-card" style="display:'+(man.length ? 'flex' : 'none')+'; justify-content:space-between; padding:12px 16px;"><span style="color:var(--text2); font-size:13.5px;">Change this week</span><b class="fig" id="ci-av-total"></b></div>';
    },
    wire(main, skip){
      const upd = ()=>{
        let total = 0;
        assets.forEach(a=>{
          const inp = document.getElementById('ci-av-'+a.id); if(!inp) return;
          ciMeta.av[a.id] = inp.value;
          const v = ciMoney(inp.value), last = assetValue(a);
          const res = document.getElementById('ci-avr-'+a.id);
          if(!inp.value.trim() || !isFinite(v)){ res.className = 'res'; res.textContent = inp.value.trim() ? 'Not a number' : ''; return; }
          const dlt = v - last; total += dlt;
          res.className = 'res ' + (Math.abs(dlt) < 0.005 ? '' : dlt > 0 ? 'up' : 'down');
          res.textContent = Math.abs(dlt) < 0.005 ? 'No change' : (dlt > 0 ? '+' : '−') + money0(Math.abs(dlt));
        });
        const tt = document.getElementById('ci-av-total');
        tt.textContent = (total > 0.005 ? '+' : total < -0.005 ? '−' : '') + money0(Math.abs(total));
        tt.style.color = total > 0.005 ? 'var(--in)' : total < -0.005 ? 'var(--out)' : 'var(--text2)';
      };
      document.querySelectorAll('[data-av]').forEach(i=> i.addEventListener('input', upd));
      upd();
      document.querySelectorAll('[data-ci-imp]').forEach(b=> b.onclick = ()=> invPickFile(b.dataset.ciImp));
      ciMeta.iv = ciMeta.iv || {};
      document.querySelectorAll('[data-iv]').forEach(i=> i.addEventListener('input', ()=>{ ciMeta.iv[i.dataset.iv] = i.value; }));
      main.textContent = 'Save and continue';
      main.textContent = 'Save and continue';
      main.onclick = ()=>{
        const t = todayYMD();
        let total = 0, wrote = 0;
        assets.forEach(a=>{
          const inp = document.getElementById('ci-av-'+a.id); if(!inp) return;
          const v = ciMoney(inp.value);
          if(!inp.value.trim() || !isFinite(v) || v < 0) return;
          total += v - assetValue(a);
          a.values = a.values || [];
          const same = a.values.findIndex(x=>x.date===t);
          if(same >= 0) a.values[same].value = v; else a.values.push({date:t, value:v});
          a.values.sort((x,y)=>String(x.date).localeCompare(String(y.date)));
          wrote++;
        });
        // v59: write only what you changed, holding by holding
        let iv = 0;
        const changes = {};
        document.querySelectorAll('[data-iv]').forEach(i=>{
          const [cat, sym, f] = i.dataset.iv.split('|'), v = ciMoney(i.value);
          if(!i.value.trim() || !isFinite(v) || v < 0) return;
          (changes[cat+'|'+sym] = changes[cat+'|'+sym] || {cat, sym})[f] = v;
        });
        Object.values(changes).forEach(c=>{
          const p = invCategory(c.cat).P[c.sym]; if(!p) return;
          const q = c.q != null && Math.abs(c.q - p.qty) > Math.max(1e-9, p.qty*1e-6) ? c.q : null;   // boxes show 8 figures; ignore rounding
          const v = c.v != null && Math.abs(c.v - p.value) >= 0.5 ? c.v : (q != null ? null : null);
          if(q == null && v == null) return;
          iv += applyHoldChange(c.cat, c.sym, q, v, t, 'Sunday check-in');
        });
        if(iv){ sortTrades(); saveInvest(); }
        if(!wrote && invAny()){ settings.lastAssetVal = t; save(K.settings, settings); render(); ciNext(); return; }
        if(!wrote){ ciSkip('lastAssetVal'); ciNext(); return; }
        save(K.assets, assets);
        settings.lastAssetVal = t; save(K.settings, settings);
        ciMeta.assetDelta = total;
        buzz();
        if(total > 0.005) sfx('arcade');
        render(); ciNext();
      };
      ciSkipTo(skip, 'Skip this step', 'lastAssetVal');
    }
  },
  lastCheck: {
    html(){
      const main = accts.filter(a=>a.type !== 'trading'), trading = accts.filter(a=>a.type === 'trading');
      const shown = ciMeta.showTrading ? accts : main;
      const card = a=>{
        const mine = acctBalance(a.id);
        const typed = ciMeta.bal[a.id] || '';
        const v = ciMoney(typed);
        let res = '', cls = 'res', off = false;
        if(typed.trim() && isFinite(v)){
          const d = v - mine;
          if(Math.abs(d) < 0.01){ cls = 'res ok'; res = '✓ Matches'; }
          else { cls = 'res off'; res = money(Math.abs(d))+' out'; off = true; }
        }
        return '<div class="ci-card'+(off ? ' warn-c' : '')+'" data-balcard="'+esc(a.id)+'"><div class="ci-row"><label for="ci-bal-'+esc(a.id)+'">'+esc(a.name)+'</label>'+
          '<span class="hint">Ledger says '+money(mine)+'</span></div>'+
          '<div class="money-in"><div class="box"><span>'+esc(curSym().trim())+'</span>'+
          '<input id="ci-bal-'+esc(a.id)+'" data-bal="'+esc(a.id)+'" inputmode="decimal" autocomplete="off" placeholder="What Wise says" value="'+esc(typed)+'"></div>'+
          '<div class="'+cls+'" id="ci-balr-'+esc(a.id)+'">'+res+'</div></div>'+
          '<div class="ci-acts" data-acts="'+esc(a.id)+'"'+(off && !ciMeta.leave[a.id] ? '' : ' hidden')+'><button data-why="'+esc(a.id)+'">Show me why</button><button class="ghost2" data-leave="'+esc(a.id)+'">Leave it for now</button></div>'+
          '</div>';
      };
      return '<h1 id="ci-title">Does it match Wise?</h1>'+
        '<p class="ci-lede">Type what Wise shows for each account right now.</p>'+
        shown.map(card).join('')+
        (!ciMeta.showTrading && trading.length ? '<button class="ci-optional" id="ci-show-trading"><span>'+esc(trading.map(a=>a.name).join(', '))+' · trading</span><b>Add (optional)</b></button>' : '');
    },
    wire(main, skip){
      document.querySelectorAll('[data-bal]').forEach(inp=>{
        // Only this card changes while you type, so moving to the next box
        // never redraws the screen or drops the keyboard.
        inp.addEventListener('input', ()=>{
          const id = inp.dataset.bal;
          ciMeta.bal[id] = inp.value;
          const mine = acctBalance(id), v = ciMoney(inp.value);
          const r = document.getElementById('ci-balr-'+id);
          const card = document.querySelector('[data-balcard="'+id+'"]');
          const acts = document.querySelector('[data-acts="'+id+'"]');
          let off = false;
          if(!inp.value.trim() || !isFinite(v)){ r.className = 'res'; r.textContent = ''; }
          else if(Math.abs(v - mine) < 0.01){ r.className = 'res ok'; r.textContent = '✓ Matches'; }
          else { r.className = 'res off'; r.textContent = money(Math.abs(v - mine))+' out'; off = true; ciMeta.leave[id] = false; }
          if(card) card.classList.toggle('warn-c', off);
          if(acts) acts.hidden = !off;
        });
      });
      document.querySelectorAll('[data-why]').forEach(b=> b.onclick = ()=>{
        const id = b.dataset.why;
        document.getElementById('open-check').click();
        document.getElementById('c-acct').value = id;
        document.getElementById('c-actual').value = ciMoney(ciMeta.bal[id]);
        document.getElementById('c-compare').click();
      });
      document.querySelectorAll('[data-leave]').forEach(b=> b.onclick = ()=>{
        ciMeta.leave[b.dataset.leave] = true;
        const acts = document.querySelector('[data-acts="'+b.dataset.leave+'"]'); if(acts) acts.hidden = true;
      });
      const st = document.getElementById('ci-show-trading');
      if(st) st.onclick = ()=>{ ciMeta.showTrading = true; ciRender(false); };
      main.textContent = 'Next';
      main.onclick = ()=>{
        const typed = Object.keys(ciMeta.bal).filter(id=> String(ciMeta.bal[id]).trim() && isFinite(ciMoney(ciMeta.bal[id])) && accts.some(a=>a.id===id));
        if(!typed.length){ ciSkip('lastCheck'); ciNext(); return; }
        ciMeta.offAccts = typed.filter(id=> Math.abs(ciMoney(ciMeta.bal[id]) - acctBalance(id)) >= 0.01)
          .map(id=>({name: acctById(id).name, d: ciMoney(ciMeta.bal[id]) - acctBalance(id)}));
        settings.lastCheck = todayYMD(); save(K.settings, settings);
        buzz();
        ciNext();
      };
      ciSkipTo(skip, 'Skip this step', 'lastCheck');
    }
  },
  backup: {
    html(){
      // settings.lastBackup is the date every other screen uses, so read that.
      const n = settings.lastBackup ? Math.max(0, Math.floor((parseYMD(todayYMD()) - parseYMD(settings.lastBackup))/86400000)) : null;
      const line = !settings.lastBackup || n === null ? 'Your data only lives on this phone and has <b>never been backed up</b>.'
        : 'Your data only lives on this phone. Last saved <b style="color:#e0b95f;">'+n+' day'+(n===1?'':'s')+' ago</b>.';
      return '<div class="ci-hero"><div class="ic">'+ICON_SAFE+'</div><h1 id="ci-title">Lock the week in</h1>'+
        '<p>'+line+'</p></div>'+
        '<div class="ci-card bk-how"><b>How to save it</b><ol><li>Tap <b>Save backup</b>, then <b>Save to Files</b>.</li>'+
        '<li>Pick <b>iCloud Drive</b> and the same folder as last week.</li><li>Tap <b>Save</b>, then <b>Replace</b>. One file, always up to date.</li></ol></div>';
    },
    wire(main, skip){
      main.textContent = 'Save backup';
      main.onclick = ()=>{ runBackup().then(ok=>{ if(ok && ciOpen && ciCur === 'backup') setTimeout(ciNext, 400); }); };
      ciSkipTo(skip, 'Skip this week', 'backup');
    }
  },
  done: {
    html(){
      if(!ciMeta.finished) ciFinish();
      const ws = weekStart(new Date());
      const ps = new Date(ws.getTime() - 7*86400000), pe = new Date(ws.getTime() - 86400000);
      const inWeek = txns.filter(t=>{ const d = parseYMD(t.date); return d >= ps && d < ws; });
      const wkT = periodTotals(ps, pe);
      const out = wkT.out, inn = wkT.inn;
      const kept = inn - out;
      const range = ps.getMonth() === pe.getMonth()
        ? ps.getDate()+'–'+pe.getDate()+' '+pe.toLocaleDateString('en-GB',{month:'long'})
        : fmtDay(ymd(ps))+' – '+fmtDay(ymd(pe));
      const streak = Number(settings.weekStreak)||0;
      const nwNow = netWorthAt(todayYMD()), nwThen = netWorthAt(ymd(new Date(Date.now() - 7*86400000)));
      const nwD = nwNow - nwThen;
      const mt = monthTotals(monthKey(new Date()));
      const over = Object.keys(budgets).filter(c=> Number(budgets[c]) > 0 && (mt.byCat[c]||0) > Number(budgets[c]))
        .map(c=> catById(c).name+', '+money0((mt.byCat[c]||0) - Number(budgets[c]))+' over');
      const byCat = wkT.byCat;
      const top = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
      const later = [];
      const names = {lastImport:'Import', tag:'Sorting', lastAssetVal:'Investments', lastCheck:'Balance check', backup:'Backup'};
      ciSkipped().forEach(k=>{ if(names[k]) later.push(names[k]+' skipped'); });
      (ciMeta.offAccts||[]).forEach(o=> later.push(o.name+' is '+money(Math.abs(o.d))+' out'));
      const unc = uncatList().length; if(unc && !ciSkipped().includes('tag')) later.push(unc+' still need a category');
      const row = (a,b)=>'<div><span>'+a+'</span><span>'+b+'</span></div>';
      return '<div class="ci-hero" style="padding-top:18px;"><div class="ic gold">'+ICON_BOOK+'</div><h1 id="ci-title">Week closed</h1>'+
        '<p>'+esc(range)+(streak > 1 ? ' · '+streak+' weeks in a row' : '')+'</p></div>'+
        '<div class="ci-sum"><div><small>Spent</small><b style="color:var(--out);">'+money0(out)+'</b></div>'+
        '<div><small>Came in</small><b style="color:var(--in);">'+money0(inn)+'</b></div>'+
        '<div><small>Kept</small><b>'+(kept >= 0 ? '+' : '−')+money0(Math.abs(kept))+'</b></div></div>'+
        '<div class="ci-list">'+
          row('Net worth', money0(nwNow)+' <span style="color:'+(nwD >= 0 ? 'var(--in)' : 'var(--out)')+'; font-size:13px;">'+(nwD >= 0 ? '+' : '−')+money0(Math.abs(nwD))+'</span>')+
          row('Over budget', over.length ? '<span style="color:#e0b95f;">'+esc(over.slice(0,2).join(' · '))+'</span>' : 'Nothing')+
          (top ? row('Biggest spend', esc((top[0]==='__none' ? 'Needs a category' : catById(top[0]).name)+', '+money0(top[1]))) : '')+
          (later.length ? row('Left for later', esc(later.join(' · '))) : '')+
        '</div>';
    },
    wire(main, skip){
      main.textContent = 'Done';
      main.onclick = closeCheckin;
      skip.style.display = 'none';
    }
  }
};
// Reaching the end closes the week: the streak, the chip and the sound.
function ciFinish(){
  ciMeta.finished = true;
  const real = ciSteps();
  const allDone = real.every(t=>t.done);
  if(allDone){
    const ws = ciWeek();
    if(settings.weekStreakWeek !== ws){
      const prev = ymd(new Date(weekStart(new Date()).getTime() - 7*86400000));
      settings.weekStreak = (settings.weekStreakWeek === prev) ? (Number(settings.weekStreak)||0) + 1 : 1;
      settings.weekStreakWeek = ws;
    }
  }
  settings.weekDismissed = todayYMD();
  save(K.settings, settings);
  weekFlow = false;
  sfx('book');
  renderWeekChip();
}
document.getElementById('ci-close').onclick = closeCheckin;
