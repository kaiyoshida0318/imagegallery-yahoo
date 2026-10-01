// ImageGallery (Yahoo版) Service Worker
// 画像を長期キャッシュして表示を高速化
// Yahoo v1.0.0
//
// ⚠️ 楽天版と同じドメイン (kaiyoshida0318.github.io) で動くため、Cache Storage は楽天版と共有になる。
//    キャッシュ名に yahoo を含め、削除は「自分の接頭辞のものだけ」に限定すること。
//    (楽天版のように「自分以外を全部消す」と、楽天版のキャッシュまで消してしまう)

const SW_VERSION = 'imagegallery-yahoo-v1';
const CACHE_PREFIX = 'imagegallery-yahoo-';
const CACHE_NAME = CACHE_PREFIX + 'images-v1';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30日

// キャッシュ対象: 画像ファイル
const IMAGE_HOSTS = [
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
];
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic)(\?|$)/i;

self.addEventListener('install', (event) => {
  // すぐにアクティブ化
  self.skipWaiting();
  console.log('[SW] install:', SW_VERSION);
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 古いキャッシュを削除
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))
    );
    // 既存タブでも即制御開始
    await self.clients.claim();
    console.log('[SW] activated:', CACHE_NAME);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isImageHost = IMAGE_HOSTS.includes(url.hostname);
  const isImageFile = IMAGE_EXT_RE.test(url.pathname);

  // 画像だけキャッシュ対象
  if (!isImageHost || !isImageFile) return;

  event.respondWith(handleImageRequest(req));
});

// キャッシュファースト戦略
async function handleImageRequest(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  if (cached) {
    // キャッシュのmetaで期限チェック
    const cachedTime = parseInt(cached.headers.get('sw-cached-time') || '0', 10);
    const age = Date.now() - cachedTime;
    if (cachedTime && age < CACHE_MAX_AGE_MS) {
      // 有効期間内なのでキャッシュから返す(超高速!)
      return cached;
    }
    // 期限切れ → ネットワークから取り直し
  }

  // キャッシュにないか期限切れ → ネットワーク取得
  try {
    const response = await fetch(req);
    if (response.ok) {
      // キャッシュに保存(タイムスタンプ入りヘッダー)
      const clone = response.clone();
      const body = await clone.blob();
      const headers = new Headers(response.headers);
      headers.set('sw-cached-time', String(Date.now()));
      const responseToCache = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      // 非同期にキャッシュ書き込み(レスポンス速度に影響しないように)
      cache.put(req, responseToCache).catch(e => console.warn('[SW] cache put failed', e));
    }
    return response;
  } catch (err) {
    // ネットワーク失敗時、期限切れでも古いキャッシュがあれば返す
    if (cached) return cached;
    throw err;
  }
}

// クライアントからのメッセージ受信 (キャッシュクリア用)
self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'CLEAR_IMAGE_CACHE') {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX)).map(k => caches.delete(k)));
    event.ports[0]?.postMessage({ ok: true });
    console.log('[SW] yahoo caches cleared');
  }
});
