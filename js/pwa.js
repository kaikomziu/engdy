// アプリとして使うための仕組み（PWA）
// インストール（ホーム画面に追加）・新しい版のお知らせ・オフライン表示・音楽のオフライン保存
import { $, esc, toast, modal } from "./util.js";
import { TRACKS } from "./audio.js";

let deferred = null;       // Chrome などの「インストール」ダイアログ
let waitingSW = null;      // 待っている新しい版
const listeners = new Set();
const notify = () => listeners.forEach((f) => { try { f(); } catch (e) {} });
export const onPwaChange = (f) => listeners.add(f);

export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const canInstall = () => !!deferred;

addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; notify(); });
addEventListener("appinstalled", () => { deferred = null; toast("Engdy をインストールしました 🎉", 3000); notify(); });

// インストールする（できない環境では、やり方を案内）
export async function install() {
  if (isStandalone()) { toast("すでにアプリとして開いています"); return; }
  if (deferred) {
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    if (r && r.outcome === "accepted") deferred = null;
    notify();
    return;
  }
  const ios = isIOS();
  modal(`<p class="kicker">INSTALL</p><h3>ホーム画面に追加する</h3>
    ${ios ? `<ol class="steps"><li><b>Safari で開く</b><span>ほかのアプリの中のブラウザでは追加できないことがあります。</span></li>
      <li><b>共有ボタン（□に↑）を押す</b><span>画面の下（iPad は上）にあります。</span></li>
      <li><b>「ホーム画面に追加」を選ぶ</b><span>名前を確かめて「追加」を押すと、アプリのアイコンができます。</span></li></ol>`
    : `<ol class="steps"><li><b>ブラウザのメニューを開く</b><span>右上の「︙」や、アドレスバーの右にあるインストールのアイコン。</span></li>
      <li><b>「アプリをインストール」または「ホーム画面に追加」を選ぶ</b><span>Chrome・Edge・Android のブラウザで使えます。</span></li></ol>`}
    <p class="hint">追加すると、アイコンからすぐ開けて、画面いっぱいに表示されます。オフラインでも自分のリストを閲覧できます。</p>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>OK</button></div>`);
}

// ---- 新しい版のお知らせ ----
function showUpdate() {
  let bar = $("#updateBar");
  if (!bar) {
    bar = document.createElement("div"); bar.id = "updateBar"; bar.className = "update-bar";
    bar.innerHTML = `<span>✨ 新しいバージョンがあります</span><button class="btn sm pri" id="updGo">更新する</button><button class="btn sm ghost" id="updLater">あとで</button>`;
    document.body.appendChild(bar);
    $("#updGo").onclick = () => { if (waitingSW) waitingSW.postMessage("skipWaiting"); else location.reload(); };
    $("#updLater").onclick = () => bar.remove();
  }
}

export function initPwa() {
  // オフラインの表示
  const net = () => { document.body.classList.toggle("offline", !navigator.onLine); };
  addEventListener("online", () => { net(); toast("オンラインに戻りました"); });
  addEventListener("offline", () => { net(); toast("オフラインです。自分のリストの閲覧・テスト・メモは使えます", 3500); });
  net();

  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    const watch = (sw) => {
      if (!sw) return;
      sw.addEventListener("statechange", () => { if (sw.state === "installed" && navigator.serviceWorker.controller) { waitingSW = sw; showUpdate(); } });
    };
    if (reg.waiting && navigator.serviceWorker.controller) { waitingSW = reg.waiting; showUpdate(); }
    watch(reg.installing);
    reg.addEventListener("updatefound", () => watch(reg.installing));
    // 開きっぱなしでも、1時間ごとに新しい版がないか確かめる
    setInterval(() => reg.update().catch(() => {}), 3600e3);
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading && waitingSW) { reloading = true; location.reload(); } });
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "musicProgress") musicProg && musicProg(e.data.done, e.data.total); });
}

// ---- 音楽をオフライン用に保存 ----
let musicProg = null;
const musicFiles = () => TRACKS.map((t) => `./assets/bgm/${t.id}.mp3`);
export async function musicCached() {
  if (!("caches" in window)) return 0;
  try {
    const c = await caches.open("engdy-music");
    const keys = await c.keys();
    return keys.length;
  } catch (e) { return 0; }
}
export async function cacheMusic(onProgress) {
  const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
  if (!reg || !reg.active) { toast("この環境では保存できません（公開中のサイトで使ってください）"); return false; }
  musicProg = onProgress;
  reg.active.postMessage({ type: "cacheMusic", files: musicFiles() });
  return true;
}
export async function clearMusic() { try { await caches.delete("engdy-music"); } catch (e) {} }
export const musicTotal = () => TRACKS.length;
