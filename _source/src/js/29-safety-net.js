// ============================================================
// Safety net
// ============================================================
// Two operations rewrite data wholesale: restoring a backup and converting
// currency. Both take a snapshot first, so a mistake is one tap from undone
// rather than gone. Ordinary edits do not need this — they change one record.
const K_ROLLBACK = 'ledger:rollback';

const UNDO_DEPTH = 10;

// A stack, not a single slot. Previously a second destructive action overwrote
// the snapshot taken before the first, so undoing once left you stranded
// halfway — which is exactly how a bad conversion became unrecoverable.
function loadUndoStack(){
  try{
    const raw = JSON.parse(localStorage.getItem(K_ROLLBACK));
    if(!raw) return [];
    return Array.isArray(raw) ? raw : [raw];   // migrate the old single object
  }catch(e){ return []; }
}

function snapshot(label){
  try{
    const stack = loadUndoStack();
    stack.push({
      label, at: new Date().toISOString(),
      accts, txns, cats, rules, assets, settings, recur, budgets, invest, pots
    });
    while(stack.length > UNDO_DEPTH) stack.shift();
    localStorage.setItem(K_ROLLBACK, JSON.stringify(stack));
  }catch(e){
    // Out of space: drop the oldest entries and keep the most recent one,
    // which is the one most likely to be needed.
    try{
      localStorage.setItem(K_ROLLBACK, JSON.stringify([{
        label, at: new Date().toISOString(),
        accts, txns, cats, rules, assets, settings, recur, budgets, invest, pots
      }]));
    }catch(e2){}
  }
}

function rollbackAvailable(){
  const stack = loadUndoStack();
  return stack.length ? stack[stack.length-1] : null;
}
function undoDepth(){ return loadUndoStack().length; }

function doRollback(){
  const stack = loadUndoStack();
  const s = stack[stack.length-1];
  if(!s) return;
  const more = stack.length - 1;
  if(!confirm('Undo "'+s.label+'" and put everything back as it was?'+
    (more ? '\n\n'+more+' earlier step'+(more===1?'':'s')+' can be undone after this one.' : ''))) return;
  accts = s.accts||[]; txns = s.txns||[]; cats = s.cats||DEFAULT_CATS;
  rules = s.rules||[]; assets = s.assets||[]; settings = s.settings||{};
  recur = s.recur||[]; budgets = s.budgets||{};
  // Snapshots from before v57 have no investments: those are left as they are.
  if(s.invest && Array.isArray(s.invest.trades)){ invest = s.invest; saveInvest(); }
  if(Array.isArray(s.pots)){ pots = s.pots; savePots(); }   // v69; older steps have none
  save(K.accts,accts); save(K.txns,txns); save(K.cats,cats); save(K.rules,rules);
  save(K.assets,assets); save(K.settings,settings); save(K.recur,recur); save(K.budgets,budgets);
  stack.pop();
  if(stack.length) localStorage.setItem(K_ROLLBACK, JSON.stringify(stack));
  else localStorage.removeItem(K_ROLLBACK);
  render();
  alert('Put back as it was.' + (stack.length ? ' '+stack.length+' further step'+(stack.length===1?'':'s')+' can still be undone.' : ''));
}
