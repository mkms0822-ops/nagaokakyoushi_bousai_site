/* DWA防災情報センター Service Worker
   - HTML:ネットワーク優先(通信できないときはキャッシュ → トップページ → オフライン案内)
   - そのほか(画像・CSS・JSなど):キャッシュを先に返し、裏で新しい版に更新(stale-while-revalidate)
   - 動画・音声・字幕と、範囲指定(Range)のリクエストには関与しない
     (動画は少しずつ分けて読み込むため、途中の断片をキャッシュすると再生が止まる)
   - キャッシュ名を変えると、古いキャッシュは自動で削除される */
const CACHE_NAME = 'dwa-bousai-2026-11-12-01';
const PRECACHE = ['./', './index.html', './manifest.json'];
const MEDIA_RE = /\.(mp4|m4v|mov|webm|ogv|mp3|m4a|aac|wav|ogg|vtt|srt)$/i;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (err) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const d = e.data;
  const type = (d && d.type) || d;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'CLEAR_CACHE') {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

/* 完全な応答(200)だけを保存する。部分応答(206)や不透明な応答は保存しない */
function putCache(req, res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return Promise.resolve();
  return caches.open(CACHE_NAME).then((c) => c.put(req, res)).catch(() => {});
}

function isMedia(req, url) {
  if (req.headers.has('range')) return true;
  const d = req.destination;
  if (d === 'video' || d === 'audio' || d === 'track') return true;
  return MEDIA_RE.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (isMedia(req, url)) return;   /* 動画などはブラウザに直接任せる */

  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.indexOf('text/html') !== -1;

  if (isHTML) {
    e.respondWith((async () => {
      try {
        const pre = await e.preloadResponse;
        const res = pre || await fetch(req);
        e.waitUntil(putCache(req, res.clone()));
        return res;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const top = await caches.match('./index.html');
        if (top) return top;
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<title>オフライン</title><p style="font-family:sans-serif;padding:24px;line-height:1.8">'
          + '通信できないため、このページを表示できません。<br>電波の届く場所で、もう一度開いてください。</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then((res) => {
      e.waitUntil(putCache(req, res.clone()));
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    return res || new Response('', { status: 504 });
  })());
});
