/**
 * Service worker — same-origin GET caching only.
 * - Never intercepts or caches non-GET requests (POST/PUT/DELETE).
 * - Never intercepts cross-origin requests (external AI provider APIs stay uncached).
 * - Never caches /api/* backend calls.
 * - Network-first for navigations; stale-while-revalidate for same-origin static assets.
 */
const CACHE = 'ai-class-notes:v33';
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Strictly ignore non-GET requests (POST to AI providers, /api/*, etc.)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept cross-origin traffic (OpenRouter, Groq, Gemini, Tavily, etc.)
  if (url.origin !== self.location.origin) return;

  // Never cache local backend API calls
  if (url.pathname.startsWith('/api/')) return;

  // Navigations (index.html): network-first so fresh deploys arrive immediately
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put('./index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request)
        .then(response => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
