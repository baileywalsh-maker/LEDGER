const { chromium } = require('playwright'); const path=require('path');
(async()=>{ const b=await chromium.launch({executablePath:'/usr/bin/google-chrome'}); const ctx=await b.newContext({viewport:{width:390,height:844}});
await ctx.addInitScript({path: path.join(__dirname,'seed.js')}); await ctx.route('**/sw.js', r=>r.abort());
const p=await ctx.newPage(); p.on('dialog',d=>d.dismiss());
await p.goto('file://'+path.resolve('../app/index.html')); await p.waitForTimeout(2600);
console.log((await p.evaluate(()=>ciOpen && !document.getElementById('month-backdrop').classList.contains('open'))?'PASS':'FAIL')+' month review waits while check-in is open');
await p.click('#ci-close'); await p.waitForTimeout(1500);
console.log((await p.evaluate(()=>document.getElementById('month-backdrop').classList.contains('open'))?'PASS':'FAIL')+' month review appears after closing the check-in');
await b.close(); })();
