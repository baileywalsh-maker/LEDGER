const CACHE = 'ledger-v65';
const ASSETS = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

// Network-first for the app shell so a redeploy lands without a hard refresh;
// cache-first for everything else so icons and fonts stay instant offline.
self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  // Never touch cross-origin requests. Exchange-rate lookups must go straight
  // to the network — routing them through the cache logic below turned a
  // recoverable network error into a hard failure with no usable message.
  if(!req.url.startsWith(self.location.origin)) return;
  const isShell = req.mode === 'navigate' || req.url.includes('index.html');
  if(isShell){
    e.respondWith(
      fetch(req).then(r=>{
        // fetch() resolves for 402, 404, 503 and every other error status, so
        // without this check a paused host or a billing wall gets cached over
        // the app and served from then on, offline, forever. Only a response
        // the server actually called OK is allowed to replace the shell.
        if(!r || !r.ok) throw new Error('bad shell response ' + (r && r.status));
        const copy = r.clone();
        caches.open(CACHE).then(c=>c.put(req, copy));
        return r;
      // Offline, or the server returned something that is not the app: keep
      // running the last good copy rather than replacing it with an error.
      }).catch(()=>caches.match(req).then(r=>r || caches.match('./index.html')).then(r=> r || Response.error()))
    );
  } else {
    e.respondWith(
      caches.match(req).then(r=> r || fetch(req).then(resp=>{
        if(resp.ok && req.url.startsWith(self.location.origin)){
          const copy = resp.clone();
          caches.open(CACHE).then(c=>c.put(req, copy));
        }
        return resp;
      }).catch(()=>r || Response.error()))
    );
  }
});
