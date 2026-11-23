// ============================================================
// Assets
// ============================================================
let editingAsset = null;
// Editing the freedom number where it is shown, rather than in a settings
// screen three taps away from the thing it changes.
document.getElementById('nw-target').onclick = function(){
  const btn = this;
  const box = document.createElement('input');
  box.type = 'number'; box.className = 'nw-target-edit';
  box.inputMode = 'numeric'; box.step = '1000';
  box.min = String(FREEDOM_MIN); box.max = String(FREEDOM_MAX);
  box.value = String(freedomTarget());
  btn.replaceWith(box);
  box.focus(); box.select();
  let done = false;
  const commit = keep=>{
    if(done) return; done = true;
    const v = Math.round(Number(box.value));
    if(keep && v >= FREEDOM_MIN && v <= FREEDOM_MAX){
      settings.freedom = v; save(K.settings, settings);
    }
    box.replaceWith(btn);
    renderNetWorth();
  };
  box.onblur = ()=> commit(true);
  box.onkeydown = e=>{
    if(e.key === 'Enter'){ e.preventDefault(); commit(true); }
    if(e.key === 'Escape'){ e.preventDefault(); commit(false); }
  };
};

document.getElementById('add-asset-btn').onclick = ()=>{
  editingAsset = null;
  document.getElementById('asset-title').textContent = 'Add an asset';
  document.getElementById('asset-new').style.display = 'block';
  document.getElementById('asset-detail').style.display = 'none';
  document.getElementById('as-name').value = '';
  document.getElementById('as-initial').value = '';
  document.getElementById('as-date').value = todayYMD();
  openSheet('asset-backdrop');
};
document.getElementById('as-save').onclick = ()=>{
  const name = document.getElementById('as-name').value.trim();
  if(!name){ alert('Give it a name.'); return; }
  const initial = Number(document.getElementById('as-initial').value)||0;
  const date = document.getElementById('as-date').value || todayYMD();
  assets.push({ id:uid(), name, type:document.getElementById('as-type').value,
    initial, initialDate:date, contribs:[], values:[{date, value:initial}] });
  save(K.assets, assets);
  closeSheet('asset-backdrop');
  render();
};

function openAsset(id){
  editingAsset = id;
  const a = assets.find(x=>x.id===id);
  if(!a) return;
  document.getElementById('asset-title').textContent = a.name;
  document.getElementById('asset-new').style.display = 'none';
  document.getElementById('asset-detail').style.display = 'block';
  renderAssetDetail();
  openSheet('asset-backdrop');
}

function renderAssetDetail(){
  const a = assets.find(x=>x.id===editingAsset);
  if(!a) return;
  document.getElementById('ad-cover').innerHTML = '<button class="chip" data-cover="">Count it</button>'+invCats().map(c=> '<button class="chip" data-cover="'+esc(c.id)+'">In '+esc(c.name)+'</button>').join('');
  document.querySelectorAll('#ad-cover [data-cover]').forEach(b=>{
    b.classList.toggle('on', (a.covered||'') === b.dataset.cover);
    b.onclick = ()=>{
      snapshot('Change what counts');
      if(b.dataset.cover) a.covered = b.dataset.cover; else delete a.covered;
      save(K.assets, assets); render(); renderAssetDetail();
    };
  });
  const inv = assetInvested(a), val = assetValue(a), gain = val - inv;
  document.getElementById('ad-invested').textContent = money(inv);
  document.getElementById('ad-value').textContent = money(val);
  document.getElementById('ad-value').className = 'val fig ' + (gain>=0?'in':'out');

  // The honest bit: separate money you added from money the asset made.
  const added = (a.contribs||[]).reduce((s,c)=>s+c.amount,0);
  let verdict;
  if((a.values||[]).length < 2){
    verdict = 'Only one reading so far. Log the value weekly and Ledger can start separating real growth from money you put in.';
  } else {
    const pct = inv > 0 ? (gain/inv*100) : 0;
    verdict = gain >= 0
      ? 'Worth '+money(Math.abs(gain))+' more than you put in ('+pct.toFixed(1)+'%).'
      : 'Worth '+money(Math.abs(gain))+' less than you put in ('+pct.toFixed(1)+'%).';
    if(added > 0){
      verdict += ' Of the '+money(inv)+' in there, '+money(added)+' is money you added since you started — the balance going up is not the same as the investment performing.';
    }
  }
  document.getElementById('ad-verdict').textContent = verdict;

  const events = []
    .concat([{date:a.initialDate, kind:'Opened with', amount:a.initial}])
    .concat((a.contribs||[]).map(c=>({date:c.date, kind:'Added', amount:c.amount})))
    .concat((a.values||[]).slice(1).map(v=>({date:v.date, kind:'Valued at', amount:v.value, reading:true})))
    .sort((x,y)=> y.date.localeCompare(x.date));

  document.getElementById('ad-history').innerHTML = '<div class="card">' + events.slice(0,20).map(e=>
    '<div class="lrow"><div><div class="d1">'+e.kind+'</div>'+
    '<div class="d2">'+parseYMD(e.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+'</div></div>'+
    '<div class="amtcol">'+moneyPair(e.amount)+'</div></div>'
  ).join('') + '</div>';
}

document.getElementById('ad-logval').onclick = ()=>{
  const v = Number(document.getElementById('ad-newval').value);
  if(!document.getElementById('ad-newval').value.trim()){ alert('Type what it is worth today.'); return; }
  const a = assets.find(x=>x.id===editingAsset);
  a.values = a.values || [];
  const t = todayYMD();
  const prevVal = assetValue(a);
  const same = a.values.findIndex(x=>x.date===t);
  if(same >= 0) a.values[same].value = v; else a.values.push({date:t, value:v});
  a.values.sort((x,y)=>x.date.localeCompare(y.date));
  save(K.assets, assets);
  if(v > prevVal) sfx('arcade');
  settings.lastAssetVal = todayYMD(); save(K.settings, settings);
  setTimeout(resumeWeekIfFlowing, 400);
  document.getElementById('ad-newval').value = '';
  renderAssetDetail(); render();
};
document.getElementById('ad-logcontrib').onclick = ()=>{
  const v = Number(document.getElementById('ad-newcontrib').value);
  if(!v){ alert('Type the amount you added.'); return; }
  const a = assets.find(x=>x.id===editingAsset);
  a.contribs = a.contribs || [];
  a.contribs.push({date:todayYMD(), amount:v});
  // adding money raises what it is worth too, otherwise the next reading looks like a gain
  const last = (a.values||[]).slice(-1)[0];
  const t = todayYMD();
  const newVal = (last ? last.value : 0) + v;
  const same = (a.values||[]).findIndex(x=>x.date===t);
  if(same >= 0) a.values[same].value = newVal; else (a.values = a.values||[]).push({date:t, value:newVal});
  save(K.assets, assets);
  document.getElementById('ad-newcontrib').value = '';
  renderAssetDetail(); render();
};
document.getElementById('ad-delete').onclick = ()=>{
  if(!confirm('Delete this asset and its whole history?')) return;
  assets = assets.filter(a=>a.id!==editingAsset);
  save(K.assets, assets);
  closeSheet('asset-backdrop');
  render();
};
