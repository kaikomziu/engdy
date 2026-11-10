// Engdy のサービスワーカー：ホーム画面に追加したアプリとして動かすため・オフラインで使うため
// 更新したら VERSION を上げる（古いキャッシュを消して入れ直す）
const VERSION = "engdy-1.15.0";
const V = "?v=1.15.0";
const MUSIC = "engdy-music";
const SHELL = [
  "./", "./index.html", `./css/style.css${V}`, "./icon.svg", "./manifest.webmanifest",
  ...["agent", "api", "app", "audio", "changelog", "crypto", "gacha", "items", "lists", "router", "stats", "store", "test", "util", "view", "memo", "sample", "pwa", "voice", "speech", "social", "board"].map((m) => `./js/${m}.js${V}`),
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  ...["roll", "tick", "stop", "boom", "pop", "slow", "flash", "shine"].map((n) => `./assets/sfx/${n}.mp3`),
];
// かるわかGAMES のアカウント SDK（同じドメインの別のサイト）。ネット優先で、オフラインのときだけ保存したものを使う
const SDK = "/game-links/js/karuwaka-account.js";

self.addEventListener("install", (e) => {
  // 新しい版は、ページから「更新する」と言われるまで待つ（学習中に急に切り替わらないように）
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== MUSIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
  // 音楽をまとめてオフライン用に保存
  if (e.data && e.data.type === "cacheMusic") {
    e.waitUntil(caches.open(MUSIC).then(async (c) => {
      let done = 0;
      for (const f of e.data.files) {
        const u = new URL(f, self.registration.scope).href;
        try { if (!(await c.match(u))) { const r = await fetch(u); if (r.ok && r.status === 200) await c.put(u, r); } } catch (err) {}
        done++;
        (await self.clients.matchAll()).forEach((x) => x.postMessage({ type: "musicProgress", done, total: e.data.files.length }));
      }
    }));
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // Supabase などほかのサイトは、いつもネットから
  if (url.pathname === SDK) {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(SDK, cp)); return r; }).catch(() => caches.match(SDK)));
    return;
  }
  const base = new URL("./", self.registration.scope).pathname;
  if (!url.pathname.startsWith(base)) return;   // 同じドメインのほかのゲームは対象外
  // ページ本体はネット優先（新しい版をすぐ使う）、だめならキャッシュ
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put("./index.html", cp)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // 音楽：オフライン用に保存してあればそれを使う
  if (url.pathname.includes("/assets/bgm/")) {
    e.respondWith(caches.open(MUSIC).then((c) => c.match(url.origin + url.pathname)).then((hit) => hit || fetch(req)));
    return;
  }
  // それ以外（JS・CSS・効果音）はキャッシュ優先、なければ取ってきて保存
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.status === 200 && r.type === "basic") { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
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
