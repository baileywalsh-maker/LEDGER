// ============================================================
// Sheets
// ============================================================

// A sheet that vanishes between frames reads as a glitch. `.open` still comes
// off synchronously — state is never a lie, and anything that closes then
// immediately reopens or asserts sees the truth — while `.closing` keeps the
// backdrop painted for the 200ms the animation needs.
function playSheetExit(bd){
  if(!bd || typeof bd.animate !== 'function') return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce) return;
  const sheet = bd.querySelector('.sheet');
  bd.classList.add('closing');
  const done = ()=> bd.classList.remove('closing');
  try{
    const a = bd.animate([{opacity:1},{opacity:0}], {duration:190, easing:'ease-out'});
    a.onfinish = done;
    if(sheet && typeof sheet.animate === 'function'){
      sheet.animate([{transform:'translateY(0)'},{transform:'translateY(100%)'}],
                    {duration:210, easing:'cubic-bezier(.32,.72,.28,1)'});
    }
    // If onfinish never lands — a backgrounded tab, an interrupted animation —
    // the backdrop must not be left painted over the app.
    setTimeout(done, 400);
  }catch(e){ done(); }
}

function openSheet(id){
  if(id === 'set-data-backdrop'){ try{ paintSync(); }catch(e){} }
  const bd = document.getElementById(id);
  // Reopening mid-exit cancels the exit rather than inheriting a fading backdrop.
  bd.classList.remove('closing');
  bd.classList.add('open');
}
function closeSheet(id){
  const bd = document.getElementById(id);
  const wasOpen = bd.classList.contains('open');
  bd.classList.remove('open');
  const s = bd.querySelector('.sheet');
  if(s){ s.style.transform=''; s.classList.remove('dragging','snapback','nodrag'); }
  bd.style.background='';
  if(wasOpen) playSheetExit(bd);
}
document.querySelectorAll('.backdrop').forEach(bd=>{
  bd.addEventListener('click', e=>{ if(e.target===bd) closeSheet(bd.id); });
  const sheet = bd.querySelector('.sheet');
  if(!sheet) return;
  let sy=0, ly=0, lt=0, vel=0, drag=false, armed=false;
  // Proportional to the sheet, not a flat 120px which is most of a short one.
  const closeAt = ()=>{
    const h = sheet.offsetHeight || 0;
    return h > 0 ? Math.max(64, Math.min(130, h * 0.22)) : 90;
  };
  sheet.addEventListener('pointerdown', e=>{
    if(e.pointerType==='mouse' && e.button!==0) return;
    const onGrab = !!e.target.closest('.grab');
    if(!onGrab && e.target.closest('input,select,button,table,.scrollx,.chiprow')) return;
    if(!onGrab && sheet.scrollTop > 0) return;
    sy = ly = e.clientY; lt = performance.now(); vel = 0; armed = true; drag = false;
  });
  sheet.addEventListener('pointermove', e=>{
    if(!armed) return;
    const dy = e.clientY - sy;
    if(!drag){
      if(dy < 8){ if(dy < -4) armed=false; return; }
      drag=true;
      sheet.classList.add('dragging');
      // Freeze the sheet's own scrolling for the gesture.
      sheet.classList.add('nodrag');
      sheet.classList.remove('snapback');
      if(sheet.setPointerCapture) try{ sheet.setPointerCapture(e.pointerId); }catch(err){}
    }
    const now = performance.now();
    if(now > lt){ vel = (e.clientY-ly)/(now-lt); lt = now; ly = e.clientY; }
    sheet.style.transform = 'translateY('+(dy<0 ? dy/4 : dy)+'px)';
    bd.style.background = 'rgba(0,0,0,'+Math.max(0.15, 0.6 - dy/900)+')';
    e.preventDefault();
  });
  const rel = e=>{
    if(!armed) return; armed=false;
    if(!drag) return; drag=false;
    const dy = e.clientY - sy;
    sheet.classList.remove('dragging','nodrag');
    sheet.style.transform=''; bd.style.background='';
    // Both thresholds were too strict: a deliberate pull that stopped at 100px
    // snapped back, which reads as the sheet refusing to close.
    if(dy > closeAt() || vel > 0.45) closeSheet(bd.id);
    else { sheet.classList.add('snapback'); setTimeout(()=>sheet.classList.remove('snapback'), 240); }
  };
  sheet.addEventListener('pointerup', rel);
  sheet.addEventListener('pointercancel', rel);
});

function fillSelect(el, items, value){
  el.innerHTML = items.map(i=>'<option value="'+i.id+'">'+esc(i.name)+'</option>').join('');
  if(value) el.value = value;
}

// ---------------- transaction sheet ----------------
let editingTxn = null;
let txnDir = 'out';

function setDir(d){
  txnDir = d;
  document.querySelectorAll('#dir-seg button').forEach(b=>b.classList.toggle('on', b.dataset.dir===d));
  document.getElementById('t-to-wrap').style.display = d==='transfer' ? 'block' : 'none';
  document.getElementById('t-cat-wrap').style.display = d==='transfer' ? 'none' : 'block';
  document.getElementById('t-acct-lab').textContent = d==='transfer' ? 'From' : 'Account';
  const sel = document.getElementById('t-cat');
  // A transfer category belongs in BOTH lists — money between people moves
  // either way. Before this, `kind:'transfer'` matched neither branch, so the
  // Transfers category added in v33 could be assigned automatically and then
  // never chosen, changed, or even shown as selected.
  const list = cats.filter(c=> c.kind==='transfer' || (d==='in' ? c.kind==='income' : c.kind==='spend'));
  // A blank first option, so a saved transaction is never silently filed as
  // Groceries just because that happened to be first in the list.
  sel.innerHTML = '<option value="">Choose a category...</option>' +
    list.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
  updateMemoLabel();
}
// v53: Other, Other money in and Transfers say nothing on their own, so they
// need a note. Matched by id and by name, so a renamed or hand-made "Other"
// counts too.
function noteCatSlow(c){
  return ['other','otherin','transfers'].includes(c.id) || /^other\b/i.test(c.name||'') || /^transfers?$/i.test(String(c.name||'').trim());
}
function noteCat(id){
  if(!id) return false;
  const m = memo('noteCat', ()=>{ const o = Object.create(null); for(const c of cats) o[c.id] = noteCatSlow(c); return o; });
  return !!m[id];
}
function needsMemo(t){ return !!t && t.dir !== 'transfer' && noteCat(t.cat) && !String(t.memo||'').trim(); }
function updateMemoLabel(){
  const lab = document.getElementById('t-memo-lab'); if(!lab) return;
  const cat = txnDir === 'transfer' ? null : document.getElementById('t-cat').value;
  const need = noteCat(cat);
  lab.textContent = need ? 'What was it for? (needed for '+catById(cat).name+')' : 'Note (optional)';
  lab.classList.toggle('need', need);
  if(!need) document.getElementById('t-memo-err').hidden = true;
}
document.querySelectorAll('#dir-seg button').forEach(b=> b.onclick = ()=> setDir(b.dataset.dir));

// Everything the statement said about this transaction, shown while you are
// choosing a category — the whole point of keeping it.
function renderTxnNote(t){
  const box = document.getElementById('t-note');
  if(!box) return;
  if(!t || !t.note){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display = 'block';
  box.innerHTML = '<div class="rule" style="margin-top:4px;">From your statement</div>'+
    '<div style="font-size:12px; color:var(--text2); line-height:1.55; word-break:break-word;">'+esc(t.note)+'</div>';
}

function openTxn(id){
  if(accts.length===0){ alert('Add an account first: tap the gear, then Set up, then Accounts.'); return; }
  editingTxn = id || null;
  fillSelect(document.getElementById('t-acct'), accts);
  fillSelect(document.getElementById('t-to'), accts);
  document.getElementById('t-delete').style.display = id ? 'block' : 'none';
  document.getElementById('txn-sheet-title').textContent = id ? 'Edit transaction' : 'Add a transaction';
  if(id){
    const t = txns.find(x=>x.id===id);
    if(!t) return;
    setDir(t.dir);
    document.getElementById('t-amount').value = t.amount;
    document.getElementById('t-desc').value = t.desc||'';
    document.getElementById('t-acct').value = t.acct;
    if(t.toAcct) document.getElementById('t-to').value = t.toAcct;
    if(t.cat) document.getElementById('t-cat').value = t.cat;
    document.getElementById('t-date').value = t.date;
    document.getElementById('t-memo').value = t.memo || '';
    renderTxnNote(t);
    updateMemoLabel();
  } else {
    renderTxnNote(null);
    document.getElementById('t-memo').value = '';
    setDir('out');
    document.getElementById('t-amount').value = '';
    document.getElementById('t-desc').value = '';
    document.getElementById('t-date').value = todayYMD();
  }
  openSheet('txn-backdrop');
}

// As you type a description, offer the category the importer would have chosen.
document.getElementById('t-desc').addEventListener('input', ()=>{
  if(editingTxn) return;                       // never re-guess over a deliberate choice
  const sel = document.getElementById('t-cat');
  if(sel.value) return;                        // you have already picked one
  const g = guessCategory(document.getElementById('t-desc').value, txnDir);
  if(g && [...sel.options].some(o=>o.value===g)) sel.value = g;
});

document.getElementById('t-save').onclick = ()=>{
  // buzz fires below, only once the write has actually happened
  const amount = Math.abs(Number(document.getElementById('t-amount').value));
  if(!amount){ alert('Enter an amount.'); return; }
  const rec = {
    id: editingTxn || uid(),
    date: document.getElementById('t-date').value || todayYMD(),
    amount,
    dir: txnDir,
    acct: document.getElementById('t-acct').value,
    toAcct: txnDir==='transfer' ? document.getElementById('t-to').value : null,
    desc: document.getElementById('t-desc').value.trim(),
    cat: txnDir==='transfer' ? null : (document.getElementById('t-cat').value || null)
  };
  // Editing a transaction must never throw away what the statement said.
  if(editingTxn){
    const prev = txns.find(t=>t.id===editingTxn);
    if(prev && prev.note) rec.note = prev.note;
    if(prev && prev.imported) rec.imported = true;
  }
  if(rec.dir==='transfer' && rec.acct===rec.toAcct){ alert('Pick two different accounts for a transfer.'); return; }
  const memo = document.getElementById('t-memo').value.trim();
  rec.memo = memo || undefined;
  if(rec.dir !== 'transfer' && noteCat(rec.cat) && !memo){
    document.getElementById('t-memo-err').hidden = false;
    const mi = document.getElementById('t-memo'); mi.focus();
    mi.closest('#t-memo-wrap').classList.remove('shake'); void mi.offsetWidth; mi.closest('#t-memo-wrap').classList.add('shake');
    return;
  }
  if(editingTxn){
    const was = txns.find(t=>t.id===editingTxn);
    txns = txns.map(t=> t.id===editingTxn ? {...t, ...rec} : t);
    // If you corrected the category on an imported row, offer to remember it so
    // the same merchant files itself next month.
    if(was && was.imported && rec.cat && was.cat !== rec.cat) offerRule(rec.desc, rec.cat);
  }
  else {
    // v51 sounds: only for something new, never for an edit.
    let cue = rec.dir==='in' ? 'arcade' : rec.dir==='out' ? 'pencil' : null;
    if(rec.dir==='out' && rec.cat){
      const bud = Number(budgets[rec.cat]) || 0;
      if(bud > 0){
        const before = Number(monthTotals(monthKey(parseYMD(rec.date))).byCat[rec.cat]) || 0;
        txns.push(rec);
        const after = Number(monthTotals(monthKey(parseYMD(rec.date))).byCat[rec.cat]) || 0;
        txns.pop();
        if(before <= bud && after > bud) cue = 'lownote';
      }
    }
    txns.push(rec);
    if(cue) sfx(cue);
  }
  save(K.txns, txns);
  buzz();
  closeSheet('txn-backdrop');
  render();
};

// Pull the merchant name out of a statement line: drop card numbers, dates,
// reference codes and trailing noise, keep the first couple of real words.
function merchantKey(desc){
  const cleaned = String(desc||'').toLowerCase()
    .replace(/[^a-z\s]/g,' ')
    .replace(/\b(ltd|limited|plc|uk|gb|london|card|payment|purchase|contactless|ref|on)\b/g,' ')
    .replace(/\s+/g,' ').trim();
  const words = cleaned.split(' ').filter(w=>w.length>2);
  return words.slice(0, 2).join(' ');
}

function offerRule(desc, cat){
  const key = merchantKey(desc);
  if(!key || key.length < 3) return;
  if(rules.some(r=>r.match.toLowerCase() === key)) return;
  const cName = catById(cat).name;
  setTimeout(()=>{
    if(confirm('File anything containing "'+key+'" as '+cName+' from now on?')){
      rules.push({match:key, cat});
      save(K.rules, rules);
      // apply it to everything already sitting uncategorised
      let n = 0;
      txns = txns.map(t=>{
        if(t.dir==='out' && !t.cat && String(t.desc||'').toLowerCase().includes(key)){ n++; return {...t, cat}; }
        return t;
      });
      if(n){ save(K.txns, txns); alert(n+' other transaction'+(n===1?'':'s')+' filed as '+cName+' too.'); }
      render();
    }
  }, 260);
}
document.getElementById('t-delete').onclick = ()=>{
  if(!editingTxn) return;
  txns = txns.filter(t=>t.id!==editingTxn);
  save(K.txns, txns);
  closeSheet('txn-backdrop');
  render();
};
// The plus is the way in to everything, so nothing needs hunting for under More.
document.getElementById('fab').onclick = ()=>{
  if(currentView === 'spend'){ openTxn(null); return; }   // on Spending, the obvious intent is a transaction
  openSheet('add-backdrop');
};
document.querySelectorAll('[data-add]').forEach(el=>{
  el.onclick = ()=>{
    closeSheet('add-backdrop');
    const what = el.dataset.add;
    setTimeout(()=>{
      if(what==='txn') openTxn(null);
      if(what==='recur') openRecur(null);
      if(what==='acct') openAcctEdit(null);
      if(what==='asset') document.getElementById('add-asset-btn').click();
    }, 180);
  };
});

// ---------------- accounts ----------------
function renderAcctManage(){
  document.getElementById('acct-manage').innerHTML = accts.length===0
    ? '<div class="empty">No accounts yet.</div>'
    : '<div class="card">' + accts.map(a=>
        '<div class="lrow tap" data-manageacct="'+a.id+'"><div><div class="d1">'+esc(a.name)+'</div>'+
        '<div class="d2">'+money(a.opening)+' as at '+parseYMD(a.openingDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+
        (preOpeningCount(a.id) ? '<br><span style="color:var(--brass);">'+preOpeningCount(a.id)+' earlier transaction'+(preOpeningCount(a.id)===1?'':'s')+' — counted in spending, not in this balance</span>' : '')+
        '</div></div>'+
        '<div class="amtcol"><i class="ti ti-chevron-right" style="color:var(--text3)"></i></div></div>'
      ).join('') + '</div>';
  wireAcctManageTaps();
}
document.getElementById('open-accounts').onclick = ()=>{
  renderAcctManage(); openSheet('acct-backdrop');
};
// One way to create an account, so the two paths cannot drift apart.
document.getElementById('a-add').onclick = ()=>{
  closeSheet('acct-backdrop');
  setTimeout(()=>openAcctEdit(null), 180);
};
// tapping a name in the More list opens the same editor as the Ledger page
function wireAcctManageTaps(){
  document.querySelectorAll('[data-manageacct]').forEach(el=>{
    el.onclick = ()=>{ closeSheet('acct-backdrop'); setTimeout(()=>openAcctEdit(el.dataset.manageacct), 180); };
  });
}
// ---------------- categories and rules ----------------

// ---- Built-in merchant recognition ----
// Rules you create yourself always win; this is the fallback so a fresh import
// is not 200 uncategorised rows. Keys are matched as substrings of the
// statement description, lowercased, longest key first so "pret a manger"
// beats a stray "pret".
const MERCHANT_RULES = {
  groceries: ['tesco','sainsbury','asda','morrison','aldi','lidl','waitrose','co-op','coop food',
    'marks and spencer food','m&s food','iceland','farmfoods','budgens','spar','nisa','londis',
    'costcutter','premier stores','booths','whole foods','ocado','gousto','hellofresh','riverford',
    'abel and cole','butcher','greengrocer','fishmonger','bakery','food warehouse'],

  eatingout: ['mcdonald','burger king','kfc','nando','greggs','subway','pret','costa','starbucks',
    'caffe nero','pizza hut','domino','papa john','five guys','wagamama','yo sushi','itsu','leon',
    'wasabi','chipotle','taco bell','pizza express','zizzi','ask italian','bella italia','prezzo',
    'wetherspoon','harvester','toby carvery','beefeater','miller and carter','frankie','tgi',
    'nandos','deliveroo','uber eats','just eat','justeat','foodhub','kebab','chippy','fish and chip',
    'takeaway','restaurant','bistro','trattoria','cafe','coffee','sushi','curry','tandoori','balti',
    'noodle','ramen','burrito','bakehouse','patisserie','creams','gelato','ben and jerry'],

  transport: ['tfl','transport for london','oyster','trainline','national rail','lner','avanti',
    'gwr','great western','southeastern','southern rail','thameslink','crosscountry','northern rail',
    'scotrail','transpennine','greater anglia','c2c','merseyrail','stagecoach','first bus','arriva',
    'megabus','national express','flixbus','uber','bolt','free now','addison lee','taxi','cab',
    'ryanair','easyjet','british airways','jet2','wizz air','tui airways','emirates','klm','lufthansa',
    'shell','bp ','esso','texaco','gulf ','jet petrol','morrisons petrol','tesco petrol','sainsburys petrol',
    'euro car parks','ncp','ringo','parkingeye','justpark','pay by phone','paybyphone','dvla','congestion charge',
    'dart charge','severn bridge','eurotunnel','p&o ferries','brittany ferries','zipcar','enterprise rent',
    'hertz','avis','europcar','sixt','halfords','kwik fit','national tyres','atsonline','mot '],

  rent: ['rent','landlord','letting','council tax','british gas','edf energy','eon','e.on','octopus energy',
    'ovo energy','scottish power','sse ','shell energy','bulb','utilita','thames water','severn trent',
    'united utilities','anglian water','yorkshire water','southern water','wessex water','south west water',
    'northumbrian water','affinity water','tv licen','virgin media','sky digital','sky uk','bt group',
    'plusnet','talktalk','hyperoptic','community fibre','vodafone','ee ','o2 ','three uk','giffgaff',
    'lebara','lycamobile','smarty','id mobile','tesco mobile','sky mobile','voxi','mortgage','service charge',
    'ground rent','insurance','aviva','axa','admiral','direct line','churchill','hastings direct','lv=',
    'more than','esure','saga insurance'],

  subs: ['netflix','spotify','disney','amazon prime','prime video','apple.com/bill','apple services',
    'itunes','google storage','google one','youtube premium','dropbox','icloud','microsoft 365','office 365',
    'adobe','canva','notion','figma','openai','anthropic','claude.ai','chatgpt','audible','kindle unlimited',
    'nowtv','now tv','paramount','discovery plus','britbox','crunchyroll','twitch','patreon','substack',
    'medium.com','duolingo','babbel','strava','myfitnesspal','whoop','peloton','headspace','calm.com',
    'nordvpn','expressvpn','lastpass','1password','github','namecheap','godaddy','squarespace','wix',
    'shopify','mailchimp','zoom.us','slack','xbox','playstation','nintendo','steam games','ea play'],

  shopping: ['amazon','ebay','etsy','argos','john lewis','currys','ao.com','very.co.uk','next retail',
    'primark','h&m','zara','uniqlo','asos','boohoo','pretty little','shein','tk maxx','sports direct',
    'jd sports','footasylum','size?','schuh','clarks','nike','adidas','under armour','decathlon',
    'go outdoors','mountain warehouse','ikea','dunelm','the range','wilko','b&q','homebase','screwfix',
    'toolstation','wickes','hobbycraft','the works','waterstones','whsmith','game.co.uk','cex ',
    'music magpie','vinted','depop','temu','aliexpress','wish.com','matalan','peacocks','new look',
    'river island','topshop','urban outfitters','superdrug','boots','the body shop','lush','sephora'],

  health: ['pure gym','puregym','the gym group','david lloyd','virgin active','nuffield health',
    'anytime fitness','fitness first','bannatyne','everlast gym','snap fitness','gymshark','myprotein',
    'bulk.com','holland and barrett','protein works','grenade','optimum nutrition','pharmacy','chemist',
    'lloyds pharmacy','well pharmacy','nhs ','dentist','dental','optician','specsavers','vision express',
    'physio','osteopath','chiropract','therapy','bupa','vitality health','simplyhealth','barber',
    'hairdress','salon','beauty'],

  fun: ['odeon','vue cinema','cineworld','picturehouse','everyman cinema','showcase cinema','imax',
    'ticketmaster','see tickets','eventbrite','dice.fm','skiddle','fatsoma','o2 academy','the o2',
    'wembley','alexandra palace','roundhouse','pub','tavern','arms','brewery','brewdog','beavertown',
    'camden town brewery','bar ','nightclub','club ','bowling','hollywood bowl','tenpin','escape room',
    'laser tag','trampoline park','go ape','alton towers','thorpe park','legoland','merlin entertain',
    'zsl','london zoo','national trust','english heritage','museum','gallery','theatre','playhouse',
    'airbnb','booking.com','hotels.com','expedia','premier inn','travelodge','hilton','marriott',
    'ibis','holiday inn','youth hostel','yha '],

  other: ['cash withdrawal','atm ','link atm','post office','royal mail','dpd','evri','hermes parcel',
    'yodel','parcelforce','ups ','fedex','dhl','paypal','klarna','clearpay','laybuy','zilch',
    'monzo pot','starling goal','savings transfer','charity','justgiving','gofundme','oxfam',
    'cancer research','british heart','rspca','dogs trust'],

  // Earnings only. A refund is not a wage.
  income: ['salary','wages','payroll','universal credit','dwp ','pension credit','child benefit',
    'dividend','interest paid','bacs credit','faster payment received'],

  // Money back on something already paid for. Fuel stations are the reason this
  // exists: a pay-at-pump pre-authorisation takes more than the fuel cost and
  // refunds the difference days later, which is not income by any definition.
  refunds: ['refund','refunded','reimburse','chargeback','cashback','price adjustment',
    'pre-auth reversal','preauth reversal','authorisation reversal','difference refund',
    'returned item','return credit','goodwill'],

  // Anything the state gives back.
  taxrebate: ['hmrc','tax refund','tax rebate','rebate','council tax refund','p800',
    'self assessment refund','vat refund'],
};

// Longest keys first, so a specific merchant beats a generic word.
const MERCHANT_INDEX = (()=>{
  const out = [];
  for(const cat of Object.keys(MERCHANT_RULES)){
    for(const key of MERCHANT_RULES[cat]) out.push({key, cat});
  }
  return out.sort((a,b)=> b.key.length - a.key.length);
})();

// What kind of thing a category id is, whether or not the user still has it.
// Needed because the guesser reasons about direction, and a category the user
// deleted still has a knowable kind from the defaults.
function catKind(id){
  const mine = cats.find(c=>c.id===id);
  if(mine) return mine.kind;
  const def = DEFAULT_CATS.find(c=>c.id===id);
  return def ? def.kind : 'spend';
}

// Resolve a built-in category id against the user's actual category list, which
// they can rename or delete. Falls back by kind, then gives up gracefully.
function resolveCat(id){
  if(cats.some(c=>c.id===id)) return id;
  const kind = catKind(id);
  const alt = cats.find(c=> c.kind===kind) || cats.find(c=> c.kind==='spend');
  return alt ? alt.id : null;
}

// Guess a category from a statement description. User rules win.
// "To John Smith", "From Sarah", "Transfer to Mum", "Bank transfer from Dan".
// A person's name is not in any merchant list and never will be, so the shape
// of the line is the only signal there is.
const PERSON_TRANSFER = /^(to|from)\s+[a-z]+(\s+[a-z]+)?$|\b(bank\s+)?transfer\s+(to|from)\b|\bsent\s+(to|from)\b|\bpayment\s+(to|from)\b|\bfaster\s+payment\b/i;
function looksLikePersonTransfer(desc){
  const d = String(desc||'').trim();
  if(!d) return false;
  // A merchant with a real trading name is not a person transfer, whatever the
  // preposition — "Payment to Amazon" is shopping.
  return PERSON_TRANSFER.test(d);
}

/* A merchant name has to appear as a WORD, not as a run of letters inside
   another one. Plain `includes` filed anything containing "boots" under
   Pharmacy - "Bootstrap Ltd" included - and a wrong category stated with
   confidence is worse than none at all, because you stop checking. Short keys
   are dropped entirely for the same reason. */
function merchantInLine(line, key){
  const k = String(key || '').toLowerCase().trim();
  if(k.length < 4) return false;
  const i = line.indexOf(k);
  if(i < 0) return false;
  const before = i === 0 ? ' ' : line.charAt(i - 1);
  const after = (i + k.length >= line.length) ? ' ' : line.charAt(i + k.length);
  const edge = c => !/[a-z0-9]/.test(c);
  // A trailing 's' is a possessive or a plural, not a different shop.
  return edge(before) && (edge(after) || (after === 's' && edge(
    (i + k.length + 1 >= line.length) ? ' ' : line.charAt(i + k.length + 1))));
}

function guessCategory(desc, dir){
  const d = String(desc||'').toLowerCase();
  if(!d.trim()) return null;
  // A rule the user wrote themselves always wins.
  for(const r of rules){ if(d.includes(r.match.toLowerCase())) return r.cat; }
  for(const m of MERCHANT_INDEX){
    if(merchantInLine(d, m.key)){
      // An income keyword on a spend line is noise, and vice versa — but the
      // test is the category's KIND, not its id. This used to compare against
      // the literal string 'income', so the moment a SECOND income category
      // existed it could never be guessed on a money-in row.
      const kind = catKind(m.cat);
      if(kind === 'income' && dir === 'out') continue;
      if(kind === 'spend'  && dir === 'in')  continue;
      return resolveCat(m.cat);
    }
  }
  // Checked AFTER the merchant list, so a real business named in the line still
  // wins: "Payment to Amazon" is shopping, "Payment to Dan" is a transfer.
  if(looksLikePersonTransfer(desc) && cats.some(c=>c.id === 'transfers')) return 'transfers';
  return null;
}

// Banks scatter the useful text across columns. Join what is mapped, dropping
// empties and anything already contained in an earlier part, so you get
// "PRET A MANGER · Card payment" rather than "CARD 123456".
function joinDescParts(parts){
  const out = [];
  for(const p of parts){
    const v = String(p||'').trim().replace(/\s+/g,' ');
    if(!v) continue;
    const lower = v.toLowerCase();
    if(out.some(o=>o.toLowerCase().includes(lower))) continue;
    out.push(v);
  }
  return out.join(' · ').slice(0, 200);
}

// Rows that are already in Ledger from a previous import of the same file.
// Matched on account, direction, date and amount — a statement line is
// effectively unique on those.
function findExisting(incoming, acct){
  // Prefer the chosen account, but fall back to any account. Importing the same
  // statement against a different account is an easy mistake and produced a
  // full set of duplicates rather than being recognised.
  let mine = txns.filter(t=>t.imported && t.acct===acct);
  if(!mine.length) mine = txns.filter(t=>t.imported);
  const used = new Set();
  const pairs = [];
  for(const inc of incoming){
    for(const t of mine){
      if(used.has(t.id)) continue;
      if(t.dir !== inc.dir) continue;
      if(Math.abs(t.amount - inc.amount) > 0.005) continue;
      if(t.date !== inc.date) continue;
      used.add(t.id);
      pairs.push({existing:t, incoming:inc});
      break;
    }
  }
  return pairs;
}

// Bring the detail from a re-imported file onto rows already saved: the fuller
// description, the statement note, and a category if one can now be worked out.
function enrichExisting(pairs){
  snapshot('Enrich '+pairs.length+' imported transaction'+(pairs.length===1?'':'s'));
  let improvedDesc = 0, addedNote = 0, categorised = 0;
  const byId = {};
  pairs.forEach(p=>{ byId[p.existing.id] = p.incoming; });
  txns = txns.map(t=>{
    const inc = byId[t.id];
    if(!inc) return t;
    const next = {...t};
    // Only replace a description if the new one carries more information.
    if(inc.desc && inc.desc.length > String(t.desc||'').length){ next.desc = inc.desc; improvedDesc++; }
    if(inc.note && !t.note){ next.note = inc.note; addedNote++; }
    if(!t.cat){
      const g = guessCategory((next.desc||'')+' '+(next.note||''), t.dir);
      if(g){ next.cat = g; categorised++; }
    }
    return next;
  });
  save(K.txns, txns);
  render();
  return {improvedDesc, addedNote, categorised};
}

// Exact dedupe catches import-against-import, but a transaction you typed in
// yourself has a different description from the bank's, so it slips through and
// you end up with the coffee twice. Match on amount and a date within a day.
function findNearDupes(incoming){
  // Auto-posted charges have their own, better-informed path in
  // findAutoMatches(). Leaving them here too would offer to resolve the same
  // row twice, with the second offer acting on something already removed.
  const manual = txns.filter(t=>!t.imported && !t.auto && t.dir!=='transfer');
  const hits = [];
  for(const inc of incoming){
    for(const m of manual){
      if(m.dir !== inc.dir) continue;
      if(Math.abs(m.amount - inc.amount) > 0.005) continue;
      const gap = Math.abs(parseYMD(m.date) - parseYMD(inc.date));
      if(gap > 86400000) continue;
      hits.push({manual:m, incoming:inc});
      break;
    }
  }
  return hits;
}

// After importing, offer to drop the hand-typed copies — the bank's line is the
// authoritative one, so it keeps the imported row and its category.
function resolveNearDupes(hits){
  if(!hits.length) return;
  const lines = hits.slice(0,6).map(h=>
    '• '+money0(h.manual.amount)+' — you typed "'+(h.manual.desc||'no description')+
    '", bank says "'+(h.incoming.desc||'no description')+'"').join('\n');
  const more = hits.length > 6 ? '\n...and '+(hits.length-6)+' more' : '';
  const ok = confirm(hits.length+' imported transaction'+(hits.length===1?' matches':'s match')+
    ' something you added by hand:\n\n'+lines+more+
    '\n\nRemove your manual copies and keep the bank\'s version?');
  if(!ok) return;
  const drop = new Set(hits.map(h=>h.manual.id));
  txns = txns.filter(t=>!drop.has(t.id));
  save(K.txns, txns);
  render();
}

// kept for the rules screen, which only ever asks about user rules
function applyRules(desc){
  const d = String(desc||'').toLowerCase();
  for(const r of rules){ if(d.includes(r.match.toLowerCase())) return r.cat; }
  return null;
}
function renderRules(){
  document.getElementById('rules-count').textContent = rules.length || '';
  document.getElementById('rules-list').innerHTML = rules.length===0
    ? '<div class="estate"><i class="ti ti-wand" aria-hidden="true"></i><div class="et">No rules yet</div><div class="es">A rule files a merchant into a category once, and every future import does it for you.</div></div>'
    : '<div class="card">' + rules.map((r,i)=>
        '<div class="lrow"><div><div class="d1">'+esc(r.match)+'</div><div class="d2">files as '+esc(catById(r.cat).name)+'</div></div>'+
        '<div class="amtcol"><button data-del-rule="'+i+'" style="color:var(--out); font-size:13px;">Remove</button></div></div>'
      ).join('') + '</div>';
  document.querySelectorAll('[data-del-rule]').forEach(b=>{
    b.onclick = ()=>{ rules.splice(Number(b.dataset.delRule),1); save(K.rules,rules); renderRules(); };
  });
  document.getElementById('cat-manage').innerHTML = '<div class="card">' + cats.map(c=>
    '<div class="lrow tap" data-editcat="'+c.id+'"><div><div class="d1"><span style="display:inline-block; width:9px; height:9px; border-radius:2px; background:'+c.colour+'; margin-right:7px;"></span>'+esc(c.name)+'</div>'+
    '<div class="d2">'+(c.kind==='income'?'Money in':c.kind==='transfer'?'Transfer':'Spending')+'</div></div>'+
    '<div class="amtcol"><button data-del-cat="'+c.id+'" style="color:var(--out); font-size:13px;">Remove</button></div></div>'
  ).join('') + '</div><p class="note" style="margin-top:6px;">Tap a category to rename it or change its colour.</p>';
  document.querySelectorAll('[data-editcat]').forEach(r=> r.onclick = e=>{ if(e.target.closest('[data-del-cat]')) return; openCatEdit(r.dataset.editcat); });
  document.querySelectorAll('[data-del-cat]').forEach(b=>{
    b.onclick = e=>{ e.stopPropagation();
      const id = b.dataset.delCat;
      const n = txns.filter(t=>t.cat===id).length;
      if(n && !confirm(n+' transactions use that category. They will become uncategorised. Continue?')) return;
      cats = cats.filter(c=>c.id!==id);
      txns = txns.map(t=> t.cat===id ? {...t, cat:null} : t);
      rules = rules.filter(r=>r.cat!==id);
      save(K.cats,cats); save(K.txns,txns); save(K.rules,rules);
      renderRules(); render();
    };
  });
  fillSelect(document.getElementById('r-cat'), cats);
}
document.getElementById('open-rules').onclick = ()=>{ renderRules(); openSheet('rules-backdrop'); };
document.getElementById('r-add').onclick = ()=>{
  const m = document.getElementById('r-match').value.trim();
  if(!m){ alert('Type the words to look for in a transaction description.'); return; }
  rules.push({match:m, cat:document.getElementById('r-cat').value});
  save(K.rules, rules);
  document.getElementById('r-match').value = '';
  // apply it to anything already sitting uncategorised
  let n = 0;
  txns = txns.map(t=>{
    if(t.dir==='out' && !t.cat){ const c = applyRules(t.desc); if(c){ n++; return {...t, cat:c}; } }
    return t;
  });
  if(n){ save(K.txns, txns); }
  renderRules(); render();
};
document.getElementById('r-recat').onclick = ()=>{
  let n = 0;
  txns = txns.map(t=>{
    if(t.cat) return t;
    const g = guessCategory(t.desc, t.dir);
    if(g){ n++; return {...t, cat:g}; }
    return t;
  });
  if(n){ save(K.txns, txns); render(); }
  const left = txns.filter(t=>!t.cat && t.dir==='out').length;
  alert(n ? n+' transaction'+(n===1?'':'s')+' categorised. '+left+' still unrecognised.'
          : 'Nothing else could be matched automatically. '+left+' left to do by hand.');
  renderRules();
};

document.getElementById('cat-add').onclick = ()=>{
  const n = document.getElementById('cat-new').value.trim();
  if(!n){ alert('Give the category a name.'); return; }
  const palette = ['#4aa87a','#d0574f','#5b8dd6','#c9a227','#9b6dd6','#d68b4a','#4ab5b0','#d64a8b'];
  cats.push({id:uid(), name:n, kind:document.getElementById('cat-kind').value, colour:palette[cats.length % palette.length]});
  save(K.cats, cats);
  document.getElementById('cat-new').value = '';
  renderRules();
};
