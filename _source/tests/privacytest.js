// This repo is PUBLIC. Fails if anything private is about to be pushed.
// Run from anywhere:  node _source/tests/privacytest.js
// Checks every tracked file (and anything staged) for: GitHub tokens, backup
// files, real bank exports, a real name in test data, and the private sync file.
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const files = execSync('git ls-files --cached --others --exclude-standard', { cwd: root })
  .toString().split('\n').filter(Boolean);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if(!c) fails++; };

const text = f => { try{ return fs.readFileSync(path.join(root, f), 'utf8'); }catch(e){ return ''; } };
const isText = f => /\.(html|js|json|md|csv|txt|css)$/i.test(f);

ok(!files.some(f => /ledger-sync\.json$/i.test(f)), 'the private sync file is not in this repo');
ok(!files.some(f => /backup/i.test(f) && /\.json$/i.test(f)), 'no backup files');
ok(!files.some(f => /\.json$/i.test(f) && f !== 'manifest.json'), 'no data files (only manifest.json)');

const self = path.relative(root, __filename);
const hits = (re) => files.filter(isText).filter(f => f !== self && re.test(text(f)));
ok(!hits(/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/).length, 'no GitHub tokens');
ok(!hits(/"__suite"\s*:/).length, 'no backup contents pasted into a file');

// Test CSVs must use made-up people: any card holder / payer / payee name has to be "Test Person".
const csvBad = files.filter(f => /\.csv$/i.test(f)).filter(f => {
  const rows = text(f).split(/\r?\n/).filter(Boolean);
  if(rows.length < 2) return false;
  const head = rows[0].split(',').map(h => h.replace(/"/g,'').trim().toLowerCase());
  const cols = head.map((h,i) => /holder|payer name|payee name/.test(h) ? i : -1).filter(i => i >= 0);
  return rows.slice(1).some(r => { const c = r.split(','); return cols.some(i => (c[i]||'').replace(/"/g,'').trim() && (c[i]||'').replace(/"/g,'').trim() !== 'Test Person'); });
});
ok(!csvBad.length, 'test CSVs only name "Test Person"' + (csvBad.length ? ' (check ' + csvBad.join(', ') + ')' : ''));
ok(!hits(new RegExp(['bai','ley'].join('') + '\\s+' + ['wal','sh'].join(''), 'i')).length, 'his full name is not in any file');

console.log(fails ? '\n' + fails + ' problem(s): do NOT push.' : '\nSafe to push.');
process.exit(fails ? 1 : 0);
