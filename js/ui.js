// 画面まわりの共通の工夫
//   下のメニューの並べ替え・どこでも検索・はじめてのガイド・機能が解放されたときのお知らせ・キーボード対策
//   （読み込み中の仮の表示 skel は util.js）
import { $, $$, esc, toast, modal, speak } from "./util.js";
import { S, save, onSave, loadLists, agentProgress } from "./store.js";
import { go, onAnyEnter, currentScreen } from "./router.js";
import { tone } from "./audio.js";
import { editList } from "./lists.js";
import { COST1 } from "./items.js";

// ================= 下のメニュー（スマホ）：自分で選んで並べ替え =================
export const TAB_CHOICES = [
  ["browse", "📖", "閲覧"], ["test", "📝", "テスト"], ["stats", "📊", "統計"], ["gacha", "💎", "ガチャ"],
  ["create", "✏️", "リスト"], ["memo", "🗒️", "メモ"], ["board", "💬", "掲示板"], ["agent", "🤖", "エージェント"],
  ["collection", "📚", "図鑑"], ["ranking", "🏆", "ランキング"], ["settings", "⚙️", "設定"], ["search", "🔍", "検索"],
];
const DEFAULT_TABS = ["browse", "test", "stats", "gacha"];
export const TAB_MAX = 4;
const tabKeys = () => {
  const t = Array.isArray(S.settings.tabs) ? S.settings.tabs.filter((k) => TAB_CHOICES.some((c) => c[0] === k)) : [];
  return (t.length ? t : DEFAULT_TABS).slice(0, TAB_MAX);
};
export function renderTabbar() {
  const btn = (k) => { const c = TAB_CHOICES.find((x) => x[0] === k); return k === "search" ? `<button data-gsearch><span>${c[1]}</span>${c[2]}</button>` : `<button data-go="${k}"><span>${c[1]}</span>${c[2]}</button>`; };
  $("#tabbar").innerHTML = `<button data-go="main"><span>🏠</span>ホーム</button>${tabKeys().map(btn).join("")}`;
  $$("#tabbar [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === currentScreen()));
}

// 設定画面の「下のメニュー」編集
export function tabEditor(box) {
  const draw = () => {
    const keys = tabKeys();
    const rest = TAB_CHOICES.filter((c) => !keys.includes(c[0]));
    box.innerHTML = `<ol class="tab-edit">${keys.map((k, i) => { const c = TAB_CHOICES.find((x) => x[0] === k); return `<li><span class="te-ic">${c[1]}</span><b>${c[2]}</b>
        <span class="te-ops"><button class="btn sm ghost" data-tu="${i}" ${i === 0 ? "disabled" : ""} aria-label="左へ">↑</button><button class="btn sm ghost" data-td="${i}" ${i === keys.length - 1 ? "disabled" : ""} aria-label="右へ">↓</button><button class="btn sm ghost" data-tx="${i}" ${keys.length <= 1 ? "disabled" : ""} aria-label="外す">✕</button></span></li>`; }).join("")}</ol>
      <p class="hint">${keys.length >= TAB_MAX ? "4つまで選べます。入れかえるときは、どれかを ✕ で外してください。" : "追加できるもの（タップで追加）"}</p>
      <div class="te-add">${rest.map((c) => `<button class="chip" data-ta="${c[0]}" ${keys.length >= TAB_MAX ? "disabled" : ""}>${c[1]} ${c[2]}</button>`).join("")}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn sm ghost" id="teReset">はじめの並びに戻す</button></div>`;
  };
  const set = (keys) => { S.settings.tabs = keys; save(); renderTabbar(); draw(); };
  box.onclick = (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const keys = tabKeys().slice();
    if (b.dataset.tu) { const i = +b.dataset.tu; [keys[i - 1], keys[i]] = [keys[i], keys[i - 1]]; set(keys); }
    else if (b.dataset.td) { const i = +b.dataset.td; [keys[i + 1], keys[i]] = [keys[i], keys[i + 1]]; set(keys); }
    else if (b.dataset.tx) { keys.splice(+b.dataset.tx, 1); set(keys); }
    else if (b.dataset.ta) { keys.push(b.dataset.ta); set(keys); }
    else if (b.id === "teReset") set(DEFAULT_TABS.slice());
  };
  draw();
}

// ================= どこでも検索 =================
const SCREENS = [
  ["create", "✏️", "リスト制作", "作る 単語 追加 編集 リスト"], ["browse", "📖", "閲覧", "見る 覚える 単語帳"], ["stats", "📊", "統計", "記録 グラフ 学習時間"],
  ["test", "📝", "テストモード", "4択 書き取り 穴埋め 発音"], ["agent", "🤖", "専属エージェント", "AI 先生 苦手 質問"], ["gacha", "💎", "ガチャ", "ダイヤ 景品"],
  ["memo", "🗒️", "自由メモ", "ノート 手書き ペン"], ["board", "💬", "掲示板", "質問 話す 報告"], ["ranking", "🏆", "ランキング", "順位"],
  ["collection", "📚", "図鑑・きせかえ", "テーマ 背景 着がえ"], ["parent", "👪", "保護者メール", "親 レポート メール"], ["settings", "⚙️", "設定", "せってい"],
  ["changelog", "📰", "更新履歴", "アップデート 新機能"], ["credits", "ℹ️", "クレジット", "バージョン 作者"],
];
const SETTINGS = [
  ["study", "閲覧の速さ", "秒数 意味 次 自動"], ["study", "今日の目標", "学習時間 語数 ゴール"], ["study", "お知らせ（通知）", "通知 時刻 リマインド"],
  ["sound", "BGM", "音楽 音量 曲"], ["sound", "効果音", "音 SE 音量"], ["sound", "発音・声", "読み上げ 声 発音 速さ 音声"], ["sound", "振動", "バイブ"],
  ["look", "ライト／ダーク", "暗い 明るさ ダークモード 夜"], ["look", "文字の大きさ", "フォント サイズ 大きく 小さく"], ["look", "アクセントカラー", "色 カラー ボタンの色"],
  ["look", "下のメニュー", "タブ 並べ替え スマホ"], ["look", "今日の名言", "名言 メイン"], ["link", "Discord に報告", "ディスコード webhook"], ["link", "ランキングに参加", "ランキング 公開"],
  ["app", "アプリとしてインストール", "PWA ホーム画面 オフライン"], ["app", "使い方ガイド", "ヘルプ 説明 はじめて"], ["app", "記録をすべて消す", "リセット 削除 初期化"],
  ["app", "ショートカット", "キーボード キー"], ["app", "お問い合わせ", "連絡 メール 不具合"],
];
const norm = (s) => String(s || "").toLowerCase().normalize("NFKC");
function memoPages() { try { const m = JSON.parse(localStorage.getItem("engdy_memo")); return m && Array.isArray(m.pages) ? m.pages : []; } catch (e) { return []; } }

function searchAll(q) {
  q = norm(q).trim();
  if (!q) return [];
  const out = [], has = (...xs) => xs.some((x) => norm(x).includes(q));
  const lists = loadLists();
  // 単語（完全一致・前方一致を先に）
  const words = [];
  for (const l of lists) for (const x of l.words) {
    if (!x.w) continue;
    const w = norm(x.w), m = norm(x.m);
    const rank = w === q ? 0 : w.startsWith(q) ? 1 : w.includes(q) ? 2 : m.includes(q) ? 3 : -1;
    if (rank >= 0) words.push({ rank, x, l });
  }
  words.sort((a, b) => a.rank - b.rank || a.x.w.length - b.x.w.length);
  const seen = new Set();
  for (const { x, l } of words) { const k = x.w + "\u0000" + l.id; if (seen.has(k)) continue; seen.add(k); out.push({ g: "単語", ic: "🔤", t: x.w, s: `${x.m || "意味なし"} ・ ${l.title}`, act: () => editList(l.id), say: x.w }); if (seen.size >= 20) break; }
  for (const l of lists) if (has(l.title)) out.push({ g: "リスト", ic: "📒", t: l.title, s: `${l.words.length}語`, act: () => editList(l.id) });
  memoPages().forEach((p, i) => { if (has(p.title)) out.push({ g: "メモ", ic: "🗒️", t: p.title || `ページ ${i + 1}`, s: `${i + 1}ページ目`, act: () => go("memo", { page: i }) }); });
  for (const [k, ic, t, kw] of SCREENS) if (has(t, kw)) out.push({ g: "画面", ic, t, s: "ひらく", act: () => go(k) });
  for (const [tab, t, kw] of SETTINGS) if (has(t, kw)) out.push({ g: "設定", ic: "⚙️", t, s: "設定で開く", act: () => go("settings", { tab }) });
  return out;
}

export function openSearch() {
  if ($("#modal") && !$("#modal").hidden) return;
  modal(`<p class="kicker">SEARCH</p><h3>🔍 さがす</h3>
    <input id="gsIn" type="search" class="gs-in" placeholder="単語・意味・リスト・メモ・設定" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
    <div id="gsRes" class="gs-res"><p class="hint">英語でも日本語でも探せます。例：apple ／ りんご ／ 文字 ／ 通知</p></div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>閉じる</button></div>`,
    (c, close) => {
      const inp = c.querySelector("#gsIn"), box = c.querySelector("#gsRes");
      let items = [], sel = 0;
      const draw = () => {
        items = searchAll(inp.value);
        if (!inp.value.trim()) { box.innerHTML = `<p class="hint">英語でも日本語でも探せます。例：apple ／ りんご ／ 文字 ／ 通知</p>`; return; }
        if (!items.length) { box.innerHTML = `<p class="empty">見つかりませんでした</p>`; return; }
        sel = Math.min(sel, items.length - 1);
        let g = "";
        box.innerHTML = items.map((r, i) => { const head = r.g !== g ? `<p class="gs-g">${(g = r.g)}</p>` : ""; return `${head}<button class="gs-item ${i === sel ? "on" : ""}" data-i="${i}"><span class="gs-ic">${r.ic}</span><span class="gs-t"><b>${esc(r.t)}</b><small>${esc(r.s)}</small></span>${r.say ? `<span class="gs-say" data-say="${i}" role="button" aria-label="発音を聞く">🔊</span>` : ""}</button>`; }).join("");
      };
      const pick = (i) => { const r = items[i]; if (!r) return; close(); r.act(); };   // すぐ移る（モーダルの履歴の後始末と順番がずれないように）
      inp.oninput = () => { sel = 0; draw(); };
      inp.onkeydown = (e) => {
        if (e.isComposing) return;
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); box.querySelector(".gs-item.on")?.scrollIntoView({ block: "nearest" }); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); box.querySelector(".gs-item.on")?.scrollIntoView({ block: "nearest" }); }
        else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
      };
      box.onclick = (e) => {
        const s = e.target.closest("[data-say]"); if (s) { e.stopPropagation(); speak(items[+s.dataset.say].say); return; }
        const b = e.target.closest(".gs-item"); if (b) pick(+b.dataset.i);
      };
      setTimeout(() => inp.focus(), 60);
    });
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-gsearch]")) { e.preventDefault(); openSearch(); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest("input,textarea,select,[contenteditable]")) return;
  if (["login", "view", "test", "memo"].includes(currentScreen())) return;
  e.preventDefault(); openSearch();
});

// ================= はじめての人へのガイド =================
const GUIDE = [
  ["welcome", "WELCOME", "Engdy へようこそ！", "自分で作った単語リストを「見て・テストして」、毎日すこしずつ覚えていくアプリです。最初に、使い方を30秒で紹介します。"],
  ["m-create", "STEP 1", "リストを作る", "覚えたい単語を1行に1つ書くだけ。意味は自動で付けられます。中学生向けのサンプル（150語）も入っています。"],
  ["m-browse", "STEP 2", "閲覧する", "単語 → 意味 の順に、数秒ずつ見ていきます。毎日1周するとスタンプが押されて、💎 ダイヤがもらえます。"],
  ["m-test", "STEP 3", "テストする", "見た単語を4択・書き取り・発音などで確かめます。まちがえた単語ほど、よく出るようになります。"],
  ["m-gacha", "MORE", "ごほうびと AI", "ダイヤがたまったらガチャでテーマや背景を。テストを続けると、苦手を教えてくれる専属エージェントが使えるようになります。上の 🔍 からは、単語や設定をすぐ探せます。"],
];
export function showGuide() {
  let i = 0;
  return modal(`<div class="guide" id="gd"></div>`, (c, close) => {
    const box = c.querySelector("#gd");
    const draw = (dir = 0) => {
      const [img, k, h, p] = GUIDE[i], last = i === GUIDE.length - 1;
      box.innerHTML = `<div class="gd-slide ${dir > 0 ? "from-r" : dir < 0 ? "from-l" : ""}"><img class="ill" src="assets/ill/${img}.webp" alt="" decoding="async"><p class="kicker">${k}</p><h3>${h}</h3><p>${p}</p></div>
        <div class="gd-dots">${GUIDE.map((_, j) => `<button class="${j === i ? "on" : ""}" data-j="${j}" aria-label="${j + 1}枚目"></button>`).join("")}</div>
        <div class="row" style="justify-content:space-between"><button class="btn ghost" id="gdSkip">${last ? "" : "スキップ"}</button><span class="row">${i ? `<button class="btn" id="gdPrev">戻る</button>` : ""}<button class="btn pri" id="gdNext">${last ? "はじめる" : "次へ"}</button></span></div>`;
      box.querySelector("#gdNext").onclick = () => { if (last) close(true); else { i++; draw(1); } };
      const pv = box.querySelector("#gdPrev"); if (pv) pv.onclick = () => { i--; draw(-1); };
      box.querySelector("#gdSkip").onclick = () => close(false);
      box.querySelector(".gd-dots").onclick = (e) => { const b = e.target.closest("[data-j]"); if (b) { const j = +b.dataset.j; const d = j - i; i = j; draw(d); } };
    };
    // スワイプでもめくれる
    let x0 = null;
    box.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
    box.addEventListener("touchend", (e) => {
      if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (dx < -50 && i < GUIDE.length - 1) { i++; draw(1); } else if (dx > 50 && i > 0) { i--; draw(-1); }
    });
    draw();
  });
}

// ================= 機能が解放されたときのお知らせ =================
const UNLOCKS = {
  agent: { ok: () => agentProgress().ok, ic: "🤖", t: "専属エージェントが使えるようになりました！", p: "テストの記録から、あなたの苦手な単語がわかるようになりました。AI のエージェントが、覚え方や予習を手伝ってくれます。", go: "agent", btn: "エージェントを開く" },
  gacha: { ok: () => S.diamonds >= COST1, ic: "💎", t: "ガチャが引けるようになりました！", p: `ダイヤが ${COST1} 個たまりました。ガチャで、英単語の図鑑・テーマ・背景が当たります。`, go: "gacha", btn: "ガチャへ" },
};
const queue = [];
let checking = false;
function checkUnlocks() {
  if (checking) return;
  checking = true;
  try {
    if (!S.unlocked) {
      // はじめて：今の状態を「もう知っている」として記録するだけ（いきなり出さない）
      S.unlocked = {}; for (const [k, u] of Object.entries(UNLOCKS)) S.unlocked[k] = !!u.ok() || (k === "gacha" && S.pulls > 0);
      save(); return;
    }
    for (const [k, u] of Object.entries(UNLOCKS)) {
      if (S.unlocked[k] || !u.ok()) continue;
      S.unlocked[k] = true; save();
      if (!queue.includes(k)) queue.push(k);
    }
  } finally { checking = false; }
  setTimeout(maybeShow, 400);
}
const QUIET = ["login", "view", "test", "memo", "gacha"];
function maybeShow() {
  if (!queue.length || QUIET.includes(currentScreen()) || !$("#modal").hidden) return;
  const k = queue.shift(), u = UNLOCKS[k];
  if (k === "gacha" && currentScreen() === "gacha") return;
  tone("stamp");
  $("#modal").classList.add("center");
  modal(`<div class="unlock"><div class="ul-burst" aria-hidden="true"></div><div class="ul-ic">${u.ic}</div><p class="kicker">UNLOCKED</p><h3>${esc(u.t)}</h3><p>${esc(u.p)}</p></div>
    <div class="row" style="justify-content:center"><button class="btn ghost" data-close>あとで</button><button class="btn pri" id="ulGo">${esc(u.btn)}</button></div>`,
    (c, close) => (c.querySelector("#ulGo").onclick = () => close("go")))
    .then((v) => { $("#modal").classList.remove("center"); if (v === "go") go(u.go); else setTimeout(maybeShow, 400); });
}
onSave(checkUnlocks);
onAnyEnter(checkUnlocks);   // 画面を開いたときにも調べる（記録が変わらなくても、ダイヤが足りていれば知らせる）

// ================= キーボードが出ても、入力欄と決定ボタンを隠さない =================
if (window.visualViewport) {
  const vv = window.visualViewport, root = document.documentElement;
  const upd = () => {
    root.style.setProperty("--vvh", vv.height + "px");
    root.style.setProperty("--vvt", vv.offsetTop + "px");
    document.body.classList.toggle("kb-open", innerHeight - vv.height > 140);
  };
  vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); upd();
}
const TYPING = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]),textarea,[contenteditable]";
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (!el.matches || !el.matches(TYPING) || !matchMedia("(max-width:760px)").matches) return;
  // キーボードが出きってから、入力欄を見えるところへ
  setTimeout(() => { if (document.activeElement === el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 320);
});
