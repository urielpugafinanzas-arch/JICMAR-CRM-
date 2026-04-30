// ============================================================
// service-worker.js — CRM Ventas Pro
// ============================================================

const CACHE_NAME = 'crm-ventas-v1.1';

// FIX: solo cachear assets locales propios. Las URLs externas
// (CDN, Google Fonts) se manejan por red con fallback,
// nunca en el paso install para no bloquear la instalación.
const STATIC_ASSETS = [
  '/JICMAR-CRM-/',
  '/JICMAR-CRM-/index.html',
  '/JICMAR-CRM-/styles.css',
  '/JICMAR-CRM-/app.js',
  '/JICMAR-CRM-/firebase.js',
  '/JICMAR-CRM-/manifest.json',
  '/JICMAR-CRM-/icons/icon-192.png',
  '/JICMAR-CRM-/icons/icon-512.png'
];

// ── INSTALACIÓN ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching local static assets');
      // FIX: usar addAll solo con assets locales garantizados
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] No se pudo cachear ${url}:`, err)
          )
        )
      );
    })
  );
  self.skipWaiting();
});

// ── ACTIVACIÓN ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Eliminando caché antiguo:', name);
            return caches.delete(name);
          })
      )
    )
  );
  self.clients.claim();
});

// ── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // FIX: excluir Firebase, APIs externas y peticiones no-GET
  // Cubre todos los subdominios de googleapis y firebase
  if (
    event.request.method !== 'GET' ||
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('firebaseio.com') ||
    url.includes('firebase.googleapis.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('cloudfunctions.net')
  ) {
    return; // dejar pasar sin interceptar
  }

  // Recursos externos (fonts, CDN): Cache First con fallback a red
  if (
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com') ||
    url.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            // FIX: abrir caché una sola vez y reusar
            caches.open(CACHE_NAME).then(cache =>
              cache.put(event.request, response.clone())
            );
          }
          return response;
        }).catch(() => undefined);
      })
    );
    return;
  }

  // Recursos locales: Network First con fallback a caché
  event.respondWith(
    // FIX: abrir el caché una sola vez para leer Y escribir
    caches.open(CACHE_NAME).then(cache =>
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() =>
          cache.match(event.request).then(cached => {
            if (cached) return cached;
            // Fallback final a index.html para navegación SPA
            if (event.request.destination === 'document') {
              return cache.match('/JICMAR-CRM-/index.html');
            }
            return new Response('Sin conexión', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          })
        )
    )
  );
});

// ── NOTIFICACIONES PUSH ──────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Nueva notificación',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' }
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'CRM Ventas', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
              
