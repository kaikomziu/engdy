// 画面の切り替え
import { $, $$ } from "./util.js";
import { bgm } from "./audio.js";

const hooks = {};      // 画面に入ったときに呼ぶ関数
const leaves = {};     // 画面を出るときに呼ぶ関数
const MUSIC = { login: "menu", main: "menu", create: "menu", browse: "menu", stats: "menu", collection: "menu", parent: "menu", settings: "menu", credits: "menu", admin: "menu", view: "study", viewdone: "study", test: "test", agent: "study", gacha: "" };
let current = "";

export const onEnter = (name, f) => (hooks[name] = f);
export const onLeave = (name, f) => (leaves[name] = f);
export const currentScreen = () => current;

export function go(name, arg) {
  if (current && leaves[current]) { try { leaves[current](); } catch (e) { console.error(e); } }
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "s-" + name));
  current = name;
  scrollTo(0, 0);
  if (MUSIC[name] !== undefined) bgm(MUSIC[name]);
  if (hooks[name]) { try { hooks[name](arg); } catch (e) { console.error(e); } }
}

// data-go の付いたボタン
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) { e.preventDefault(); go(b.dataset.go); }
});
export const screenEl = (name) => $("#s-" + name);
