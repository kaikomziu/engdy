// 画面の切り替え
// スマホの「戻る」（Android の戻るボタン・iPhone のスワイプ）に対応するため、履歴を使う。
// メイン画面を土台にして、ほかの画面は1段だけ積む（戻ると必ずメインに戻る）
import { $, $$ } from "./util.js";
import { bgm } from "./audio.js";

const hooks = {};      // 画面に入ったときに呼ぶ関数
const leaves = {};     // 画面を出るときに呼ぶ関数
const backs = [];      // 「戻る」を先に受け取る関数（モーダルやガチャ演出を閉じる）。true を返したら画面は移らない
const MUSIC = { login: "menu", main: "menu", create: "menu", browse: "menu", stats: "menu", collection: "menu", parent: "menu", settings: "menu", credits: "menu", changelog: "menu", admin: "menu", view: "study", viewdone: "study", test: "test", agent: "study", gacha: "" };
const ROOTS = ["main", "login"];
let current = "", pushed = false, ignorePop = false;

export const onEnter = (name, f) => (hooks[name] = f);
export const onLeave = (name, f) => (leaves[name] = f);
export const onBack = (f) => backs.push(f);
export const currentScreen = () => current;

export function go(name, arg, opt = {}) {
  if (current && leaves[current]) { try { leaves[current](); } catch (e) { console.error(e); } }
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "s-" + name));
  const from = current;
  current = name;
  document.body.dataset.screen = name;
  $$("#tabbar [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === name));
  // 履歴：土台（メイン）の上に1段だけ積む
  if (!opt.fromPop) {
    try {
      if (ROOTS.includes(name)) {
        // ボタンでメインに戻ったときは、積んだ1段をはずす（「戻る」を押してもアプリが閉じるだけにする）
        if (pushed) { pushed = false; ignorePop = true; history.back(); }
        else history.replaceState({ s: name }, "");
      } else if (!from || ROOTS.includes(from) || !pushed) { history.pushState({ s: name }, ""); pushed = true; }
      else history.replaceState({ s: name }, "");
    } catch (e) {}
  }
  scrollTo(0, 0);
  if (MUSIC[name] !== undefined) bgm(MUSIC[name]);
  if (hooks[name]) { try { hooks[name](arg); } catch (e) { console.error(e); } }
}

addEventListener("popstate", () => {
  if (ignorePop) { ignorePop = false; return; }
  // 先にモーダルなどを閉じる。閉じたら、いまの画面にとどまる
  for (const f of backs) {
    try { if (f()) { history.pushState({ s: current }, ""); return; } } catch (e) {}
  }
  if (ROOTS.includes(current)) return;
  pushed = false;
  go("main", undefined, { fromPop: true });
  // 下にまだ画面の履歴が残っていたら、メインの位置までさかのぼる
  if (history.state && history.state.s && !ROOTS.includes(history.state.s)) { ignorePop = true; history.back(); }
});

// data-go の付いたボタン
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) { e.preventDefault(); go(b.dataset.go); }
});
export const screenEl = (name) => $("#s-" + name);
