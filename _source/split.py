import sys, os, re
src, out = sys.argv[1], sys.argv[2]
L = open(src, encoding='utf-8').read().split('\n')
# find the block boundaries (1-based line numbers)
def find(pat, start=0):
    for i in range(start, len(L)):
        if L[i].strip().startswith(pat): return i
    raise SystemExit('not found '+pat)
s1 = find('<style>'); e1 = find('</style>', s1)
s2 = find('<style>', e1); e2 = find('</style>', s2)
s3 = find('<script>', e2); e3 = find('</script>', s3)
parts = []
parts.append(('01-head.html', L[:s1+1]))
parts.append(('02-main.css', L[s1+1:e1]))
parts.append(('03-body.html', L[e1:s2+1]))
parts.append(('04-sheets.css', L[s2+1:e2]))
parts.append(('05-body.html', L[e2:s3+1]))
js = L[s3+1:e3]
# split the script at section banners: a "// ====" line followed by a title line
cuts = [0]
for i in range(1, len(js)-1):
    if js[i].startswith('// =====') and js[i+1].startswith('// ') and not js[i+1].startswith('// ====') and not js[i-1].startswith('// ') :
        if i - cuts[-1] > 60: cuts.append(i)
cuts.append(len(js))
n = 10
for a, b in zip(cuts, cuts[1:]):
    title = js[a+1] if a else 'start'
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower().replace('//','')).strip('-')[:32] or 'part'
    parts.append(('%02d-%s.js' % (n, slug), js[a:b])); n += 1
parts.append(('99-end.html', L[e3:]))
os.makedirs(out, exist_ok=True)
order = []
for name, lines in parts:
    sub = 'css' if name.endswith('.css') else 'js' if name.endswith('.js') else 'html'
    os.makedirs(os.path.join(out, sub), exist_ok=True)
    path = sub + '/' + name
    open(os.path.join(out, path), 'w', encoding='utf-8').write('\n'.join(lines))
    order.append(path)
open(os.path.join(out, 'parts.txt'), 'w').write('\n'.join(order) + '\n')
print(len(order), 'parts')
