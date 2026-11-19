// Fake v49-shaped data, built relative to today so it always looks current.
(function(){
  if (localStorage.getItem('ledger:accounts')) return;
  const p=n=>String(n).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  const today=new Date(); today.setHours(0,0,0,0);
  const back=n=>{const d=new Date(today); d.setDate(d.getDate()-n); return ymd(d);};
  let seq=0; const id=()=> 'seed'+(seq++).toString(36);
  const start=back(180);
  const accts=[
    {id:'wgbp', name:'Wise GBP', type:'current', opening:1800, openingDate:start},
    {id:'waud', name:'Wise AUD', type:'savings', opening:600, openingDate:start},
    {id:'hl',   name:'Hyperliquid', type:'trading', opening:3000, openingDate:start},
  ];
  const txns=[];
  const merchants=[['Tesco','groceries',18,45],['Lidl','groceries',12,30],['Stagecoach','transport',3,6],
    ['Pret A Manger','eatingout',5,12],['Nandos','eatingout',14,28],['Amazon','shopping',9,60],
    ['PureGym','health',24,24],['Fuel Stop',null,25,40],['Town Leisure',null,32,32],['Boots','shopping',4,15]];
  let r=7;
  const rnd=()=>{ r=(r*9301+49297)%233280; return r/233280; };
  for(let n=179;n>=0;n--){
    const k = Math.floor(rnd()*3);
    for(let j=0;j<k;j++){
      const m=merchants[Math.floor(rnd()*merchants.length)];
      const amt=Math.round((m[2]+rnd()*(m[3]-m[2]))*100)/100;
      txns.push({id:id(), date:back(n), dir:'out', amount:amt, desc:m[0], cat: (n<12 ? m[1] : (m[1]||'other')), acct:'wgbp'});
    }
    if(n%14===2) txns.push({id:id(), date:back(n), dir:'in', amount:412+Math.round(rnd()*80), desc:'Acme Payroll', cat:'income', acct:'wgbp'});
    if(n%30===5) txns.push({id:id(), date:back(n), dir:'out', amount:450, desc:'Rent', cat:'rent', acct:'wgbp'});
    if(n%30===20) txns.push({id:id(), date:back(n), dir:'transfer', amount:200, desc:'To Hyperliquid', acct:'wgbp', toAcct:'hl'});
  }
  const nd=n=>{const d=new Date(today); d.setDate(d.getDate()+n); return ymd(d);};
  const recur=[
    {id:'r1', name:'Spotify', amount:11.99, cadence:'monthly', nextDue:nd(1), acct:'wgbp', cat:'subs', created:start},
    {id:'r2', name:'Phone plan', amount:18, cadence:'monthly', nextDue:nd(4), acct:'wgbp', cat:'rent', created:start},
    {id:'r3', name:'PureGym', amount:24, cadence:'monthly', nextDue:nd(12), acct:'wgbp', cat:'health', created:start, autoPost:false},
    {id:'r4', name:'iCloud', amount:2.99, cadence:'monthly', nextDue:nd(22), acct:'wgbp', cat:'subs', created:start},
  ];
  const assets=[
    {id:'a1', name:'Index fund', initial:4000, initialDate:back(170), contribs:[{date:back(120),amount:500},{date:back(60),amount:500}],
      values:[{date:back(90),value:4700},{date:back(30),value:5400},{date:back(2),value:5900}]},
    {id:'a2', name:'BTC spot', initial:2000, initialDate:back(150), contribs:[], values:[{date:back(60),value:2150},{date:back(10),value:2500}]},
  ];
  const budgets={groceries:450, eatingout:150, shopping:120, health:60};
  const settings={lastBackup:back(3), currency:'GBP'};
  localStorage.setItem('ledger:accounts', JSON.stringify(accts));
  localStorage.setItem('ledger:txns', JSON.stringify(txns));
  localStorage.setItem('ledger:recurring', JSON.stringify(recur));
  localStorage.setItem('ledger:assets', JSON.stringify(assets));
  localStorage.setItem('ledger:budgets', JSON.stringify(budgets));
  localStorage.setItem('ledger:settings', JSON.stringify(settings));
})();
