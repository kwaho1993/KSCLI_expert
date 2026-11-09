const CACHE = 'kscli-2026-v2';
const MAX_AGE = 8 * 60 * 60 * 1000; // 8시간 (밀리초)

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // WebP 이미지 → cache-first (8시간 유효기간)
    if (url.pathname.endsWith('.webp')) {
        e.respondWith(cacheFirst(e.request));
        return;
    }

    // metadata.json → stale-while-revalidate (즉시 응답 + 백그라운드 갱신)
    if (url.pathname.endsWith('metadata.json')) {
        e.respondWith(staleWhileRevalidate(e.request));
        return;
    }

    // index.html, sw.js 등 → network-first (항상 최신 유지)
    e.respondWith(networkFirst(e.request));
});

async function cacheFirst(req) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    if (cached) {
        const cachedTime = cached.headers.get('sw-cache-time');
        const isExpired = !cachedTime || (Date.now() - parseInt(cachedTime, 10) > MAX_AGE);
        if (!isExpired) {
            return cached;
        }
    }

    try {
        const res = await fetch(req);
        if (res.ok) {
            const headers = new Headers(res.headers);
            headers.set('sw-cache-time', Date.now().toString());

            const blob = await res.blob();
            const responseToCache = new Response(blob, {
                status: res.status,
                statusText: res.statusText,
                headers: headers
            });

            await cache.put(req, responseToCache.clone());
            return responseToCache;
        }
        return res;
    } catch {
        // 네트워크 연결 실패 시 만료된 캐시라도 반환(오프라인 폴백)
        return cached ?? Response.error();
    }
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    return cached ?? fresh;
}

async function networkFirst(req) {
    try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
    } catch {
        return (await caches.match(req)) ?? Response.error();
    }
}
