// Service worker do app: rede primeiro, cache só como reserva (para abrir sem internet).
// Dados ao vivo do TSE (outro domínio) nunca passam por aqui.
const CACHE = 'apuracao-sc-v1'
const BASE = ['./', 'index.html', 'manifest.webmanifest', 'img/icones/icone-192.png']
self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (ev) => {
  const req = ev.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  ev.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok && r.type === 'basic') {
          const copia = r.clone()
          caches.open(CACHE).then((c) => c.put(req, copia))
        }
        return r
      })
      .catch(() => caches.match(req, { ignoreSearch: false }).then((r) => r || caches.match(req, { ignoreSearch: true })).then((r) => r || Response.error())),
  )
})
