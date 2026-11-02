// Service worker mínimo: permite "adicionar à tela inicial" e abrir o app sem rede.
const CACHE = 'laudo-ecv-v1';
const SHELL = ['/', '/app.css', '/js/app.js', '/js/core.js', '/js/upload.js', '/js/views/painel.js', '/js/views/loja.js', '/js/views/conf.js', '/js/views/admin.js', '/js/views/publico.js', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api') || u.pathname.startsWith('/f/') || u.pathname.startsWith('/a/')) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
