// ============================================================
// v59: edit what you hold, one place for everything you own
// ============================================================

// The one way any holding gets corrected: from its page, from the Sunday
// check-in, or when a hand-logged asset moves in. Amount and value are both
// optional; only what changed is written, as a dated entry you can see.
function applyHoldChange(cat, sym, newQty, newValue, date, note){
  date = date || todayYMD();
  const p = invCategory(cat).P[sym];
  const bv = byValue(cat, sym);
  const oldQty = p ? p.qty : 0;
  let qty = oldQty, wrote = 0;
  // today's correction goes after everything already there today
  const ts = date === todayYMD() ? new Date().toISOString().replace('T',' ').slice(0,19).replace(/^(.{10}) .*/, (m,d)=> d+' 23:59:59') : date+' 12:00:00';
  const base = {cat, sym, date, ts, fee:0, src:'manual', note: note || 'Corrected in Ledger'};
  if(!bv && newQty != null && isFinite(newQty) && newQty >= 0 && Math.abs(newQty - oldQty) > Math.max(1e-9, oldQty*1e-6)){
    const d = newQty - oldQty;
    // more than Ledger thought: added at your average cost (or today's value
    // if there is no cost yet), so a correction never shows up as profit
    const each = p && p.avg > 0 ? p.avg : (newValue > 0 && newQty > 0 ? newValue/newQty : (p ? p.price : 0));
    invest.trades.push(Object.assign({id:uid(), ext:'me:'+uid(), kind:'adjust', qty:d, gbp: d > 0 ? d*each : 0, price:0}, base));
    qty = newQty; wrote++;
  }
  const held = bv ? 1 : qty;
  if(newValue != null && isFinite(newValue) && newValue >= 0 && held > 0){
    const nowVal = held * (p ? p.price : 0);
    if(Math.abs(newValue - nowVal) >= 0.5 || wrote){
      invest.trades.push(Object.assign({id:uid(), ext:'me:'+uid(), kind:'value', qty:0, gbp:newValue, price:newValue/held}, base));
      wrote++;
    }
  }
  return wrote;
}

let holdEditing = null;
function openHoldEdit(cat, sym){
  holdEditing = {cat, sym};
  const p = invCategory(cat).P[sym], bv = byValue(cat, sym);
  document.getElementById('ih-title').textContent = symName(cat, sym);
  document.getElementById('ih-name').value = symName(cat, sym) === sym ? '' : symName(cat, sym);
  document.getElementById('ih-code').textContent = sym;
  document.getElementById('ih-qty-wrap').style.display = bv ? 'none' : '';
  document.getElementById('ih-qty').value = p && !bv ? +p.qty.toPrecision(8) : '';
  document.getElementById('ih-val').value = p ? p.value.toFixed(2) : '';
  document.getElementById('ih-note').textContent = isCryptoCat(cat) && !bv
    ? 'The price updates by itself. Change how many you hold if your import is behind; change the value only if the price looks wrong.'
    : 'Type what it is all worth today. Do this on Sundays to keep growth honest.';
  openSheet('invhold-backdrop');
}
document.getElementById('ih-save').onclick = ()=>{
  const {cat, sym} = holdEditing;
  const num = id=>{ const v = String(document.getElementById(id).value||'').replace(/[£,\s]/g,''); return v === '' ? null : Number(v); };
  const q = num('ih-qty'), v = num('ih-val');
  if(q != null && !(q >= 0)){ alert('How many needs to be a number.'); return; }
  if(v != null && !(v >= 0)){ alert('The value needs to be a number.'); return; }
  snapshot('Edit '+sym);
  const nm = document.getElementById('ih-name').value.trim();
  invest.names = invest.names || {};
  if(nm && nm !== sym) invest.names[cat+':'+sym] = nm; else delete invest.names[cat+':'+sym];
  applyHoldChange(cat, sym, q, v);
  sortTrades(); saveInvest(); closeSheet('invhold-backdrop'); render(); if(invOpen) invDraw();
  buzz(); sfx('pencil');
};

// ---------------- moving hand-logged assets into categories ----------------
const COIN_BY_NAME = Object.fromEntries(Object.entries(COIN_NAMES).map(([k,v])=>[v.toLowerCase(), k]));
function guessHome(a){
  const n = String(a.name||'').toLowerCase();
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  let coin = Object.keys(COIN_NAMES).find(k=> words.includes(k.toLowerCase())) || Object.keys(COIN_BY_NAME).map(k=> n.includes(k) ? COIN_BY_NAME[k] : null).find(Boolean);
  const cryptoCat = invCats().find(c=> c.type==='crypto');
  if((coin || a.type === 'crypto') && cryptoCat) return {cat: cryptoCat.id, sym: coin || codeFrom(a.name)};
  const other = /^(property|pension|other)$/.test(a.type||'') && invCats().find(c=> c.type==='other');
  const shares = other || invCats().find(c=> c.type==='shares') || invCats().find(c=> c.type!=='crypto') || invCats()[0];
  return {cat: shares.id, sym: codeFrom(a.name)};
}
function codeFrom(name){
  const w = String(name||'ASSET').toUpperCase().replace(/[^A-Z0-9 ]/g,'').split(' ').filter(Boolean);
  return (w[0] || 'ASSET').slice(0, 8);
}
function unmovedAssets(){ return assets.filter(a=> !a.covered && !a.movedTo); }
function openMoveSheet(){
  const list = unmovedAssets();
  const opts = sel => invCats().map(c=> '<option value="'+esc(c.id)+'"'+(c.id===sel?' selected':'')+'>'+esc(c.name)+'</option>').join('');
  document.getElementById('mv-list').innerHTML = list.map(a=>{
    const g = guessHome(a);
    return '<div class="mv-item" data-mv="'+esc(a.id)+'"><div class="ci-row"><b>'+esc(a.name)+'</b><span class="hint">'+money0(assetValue(a))+'</span></div>'+
      '<div class="two"><div><span class="lab">Category</span><select data-mv-cat>'+opts(g.cat)+'</select></div>'+
      '<div><span class="lab">Code</span><input data-mv-sym value="'+esc(g.sym)+'" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12"></div></div>'+
      '<div class="mv-what" data-mv-what></div></div>';
  }).join('');
  const describe = item=>{
    const cat = item.querySelector('[data-mv-cat]').value, sym = item.querySelector('[data-mv-sym]').value.trim().toUpperCase();
    const p = invCategory(cat).P[sym];
    item.querySelector('[data-mv-what]').textContent = p && p.qty > 0 && !byValue(cat, sym)
      ? 'Already in '+invCatInfo(cat).name+' ('+fmtQty(p.qty)+' '+sym+'). Its value becomes your figure. Check how many you hold after.'
      : 'Becomes a new holding in '+invCatInfo(cat).name+', with all its history.';
  };
  document.querySelectorAll('#mv-list .mv-item').forEach(item=>{
    item.querySelectorAll('select, input').forEach(el=> el.addEventListener('input', ()=> describe(item)));
    describe(item);
  });
  openSheet('invmove-backdrop');
}
document.getElementById('mv-go').onclick = ()=>{
  const items = [...document.querySelectorAll('#mv-list .mv-item')];
  for(const it of items){ if(!/^[A-Z0-9.\-]{1,12}$/.test(it.querySelector('[data-mv-sym]').value.trim().toUpperCase())){ alert('Each one needs a short code (letters and numbers).'); return; } }
  snapshot('Move into categories');
  let n = 0;
  invest.names = invest.names || {}; invest.byValue = invest.byValue || {};
  for(const it of items){
    const a = assets.find(x=> x.id === it.dataset.mv); if(!a) continue;
    const cat = it.querySelector('[data-mv-cat]').value, sym = it.querySelector('[data-mv-sym]').value.trim().toUpperCase();
    const p = invCategory(cat).P[sym];
    const last = (a.values||[]).reduce((m,v)=> v && v.date > m.date ? v : m, {date:'', value:null});
    if(p && p.qty > 0 && !byValue(cat, sym)){
      // Already there (from a file): your hand figure is the value now.
      // your hand figure is today's figure: it goes after anything from the file
      applyHoldChange(cat, sym, null, assetValue(a), todayYMD(), 'From '+a.name+' (logged by hand)');
      a.movedTo = {cat, sym, mode:'value', at:todayYMD()};
    } else {
      // A new holding, tracked by value, carrying its whole history.
      invest.byValue[cat+':'+sym] = true;
      if(!invest.names[cat+':'+sym] && a.name.toUpperCase() !== sym) invest.names[cat+':'+sym] = a.name;
      const ext = k=> 'asset:'+a.id+':'+k;
      const add = (o)=> invest.trades.push(Object.assign({id:uid(), src:'manual', cat, sym, fee:0, note:'From '+a.name+' (logged by hand)'}, o, {ts:o.date+' 12:00:00'}));
      const d0 = a.initialDate || (last.date || todayYMD());
      add({ext:ext('start'), kind:'buy', date:d0, qty:1, gbp:Number(a.initial)||0, price:0});
      (a.contribs||[]).forEach((c,i)=> add({ext:ext('c'+i), kind:'buy', date:c.date||d0, qty:0, gbp:Number(c.amount)||0, price:0}));
      (a.values||[]).forEach((v,i)=> add({ext:ext('v'+i), kind:'value', date:v.date||d0, qty:0, gbp:Number(v.value)||0, price:Number(v.value)||0}));
      a.movedTo = {cat, sym, mode:'new', at:todayYMD()};
    }
    n++;
  }
  save(K.assets, assets); sortTrades(); saveInvest();
  closeSheet('invmove-backdrop'); render();
  showToast(n+' moved into your categories', ()=> doRollback());
};

// "Add an asset" now adds to a category.
document.getElementById('add-asset-btn').onclick = ()=>{
  const c = invCats().find(x=> x.type !== 'crypto') || invCats()[0];
  openInvEntry({cat:c.id, kind:'buy', fresh:true, pickCat:true});
};