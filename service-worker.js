// ── Versión del cache ──
const CACHE_NAME = 'jicmar-crm-v1.0.1';

const ASSETS = [
  './index.html',
  './manifest.json',
  './app.js',
  './firebase.js',
  './styles.css'
];

// ── INSTALL ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.warn('SW install cache error:', err))
  );
  self.skipWaiting();
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH ──
self.addEventListener('fetch', e => {
  const url = e.request.url;

  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // index.html — red primero, caché como fallback
  if (url.endsWith('/') || url.includes('index.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request)
          .then(cached => cached || new Response('<h1>Sin conexión</h1><p>Conéctate para usar Jicmar CRM.</p>', {
            headers: { 'Content-Type': 'text/html' }
          }))
        )
    );
    return;
  }

  // Firebase y Google — solo red, sin cachear
  if (
    url.includes('gstatic.com') ||
    url.includes('googleapis.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('firebaseio.com') ||
    url.includes('cloudfunctions.net')
  ) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Resto de assets — caché primero, red como fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          if (!res || res.status !== 200 || res.type === 'opaque') return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => new Response('', { status: 503 }));
    })
  );
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', e => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { title: 'Jicmar CRM', body: e.data ? e.data.text() : '' };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'jicmar-crm',
    requireInteraction: true,
    data: { url: data.url || './' }
  };
  e.waitUntil(self.registration.showNotification(data.title || 'Jicmar CRM', options));
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (let c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
