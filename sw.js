// Engdy のサービスワーカー：ホーム画面に追加したときと、オフラインで閲覧するため
// 更新したら VERSION を上げる（古いキャッシュを消して入れ直す）
const VERSION = "engdy-1.6.0";
const SHELL = [
  "./", "./index.html", "./css/style.css?v=1.6.0", "./icon.svg", "./manifest.webmanifest",
  ...["agent", "api", "app", "audio", "changelog", "crypto", "gacha", "items", "lists", "router", "stats", "store", "test", "util", "view", "memo", "sample"].map((m) => `./js/${m}.js?v=1.6.0`),
  "./icons/icon-192.png",
  "./assets/sfx/pop.mp3", "./assets/sfx/tick.mp3",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // サーバー（Supabase）やほかのサイトは、いつもネットから
  const base = new URL("./", self.registration.scope).pathname;
  if (url.origin !== location.origin || !url.pathname.startsWith(base)) return;   // 同じドメインのほかのゲーム（アカウント SDK など）も対象外
  // ページ本体はネット優先（新しい版をすぐ使う）、だめならキャッシュ
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put("./index.html", cp)); return r; }).catch(() => caches.match("./index.html")));
    return;
  }
  // それ以外（JS・CSS・音）はキャッシュ優先、なければ取ってきて保存
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.type === "basic") { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
    return r;
  })));
});

// 通知をタップしたら Engdy を開く
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
