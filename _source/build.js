// Ledger build: glues _source/src/ (in the order of src/parts.txt) into the one
// index.html at the top of the repo. Refuses if the script has an error.
//   node _source/build.js          build index.html from src/
//   node _source/build.js --check  exit 1 if index.html was changed without src/
//                                  (e.g. Muse edited index.html directly). Then run
//                                  python3 _source/split.py index.html _source/src
//                                  (and rename src/order.txt to parts.txt) so src/
//                                  holds those changes before you edit anything.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..'), src = path.join(__dirname, 'src');
const parts = fs.readFileSync(path.join(src, 'parts.txt'), 'utf8').split('\n').filter(Boolean);
const html = parts.map(f => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
const out = path.join(root, 'index.html');

if (process.argv.includes('--check')) {
  const live = fs.readFileSync(out, 'utf8');
  if (live === html) { console.log('index.html matches src/'); process.exit(0); }
  console.error('index.html does NOT match src/: someone edited index.html directly. Re-split before editing.');
  process.exit(1);
}
const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
try { scripts.forEach(s => new vm.Script(s)); }
catch (e) { console.error('BUILD REFUSED: the script has an error:\n' + e.message); process.exit(1); }
const ver = (fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/ledger-v(\d+)/) || [])[1];
const appVer = (html.match(/const APP_VERSION = (\d+);/) || [])[1];
if (appVer !== ver) { console.error('BUILD REFUSED: APP_VERSION (' + appVer + ') in js/37c-pull-refresh.js must match sw.js (v' + ver + ').'); process.exit(1); }
fs.writeFileSync(out, html);
console.log('Built index.html (v' + ver + ', ' + html.split('\n').length + ' lines, ' + parts.length + ' parts)');
