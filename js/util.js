// 小さな共通部品
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 日本時間の日付キー（YYYY-MM-DD）
export function dayKey(t = Date.now()) {
  const d = new Date(t + 9 * 3600e3);
  return d.toISOString().slice(0, 10);
}
export function addDays(key, n) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}時間${m}分`;
  if (m) return `${m}分${s ? s + "秒" : ""}`;
  return `${s}秒`;
}
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer;
export function toast(msg, ms = 2400) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// モーダル。html を入れて、閉じたら resolve
let modalClose = null, modalIgnore = false;
addEventListener("popstate", (e) => {
  if (modalIgnore) { modalIgnore = false; e.stopImmediatePropagation(); return; }
  if (modalClose) { modalClose(null); e.stopImmediatePropagation(); return; }
  // 閉じたあとに残った古い履歴は飛ばす
  if (e.state && e.state.modal) { e.stopImmediatePropagation(); history.back(); }
});
export const modalOpen = () => !!modalClose;
export function modal(html, setup) {
  return new Promise((resolve) => {
    const m = $("#modal"), c = $("#modalCard");
    c.innerHTML = html; m.hidden = false;
    // スマホの「戻る」でモーダルだけ閉じられるように、履歴を1つ積む
    try { history.pushState({ ...(history.state || {}), modal: 1 }, ""); } catch (e) {}
    modalClose = (v) => close(v, true);
    const close = (v, fromPop) => {
      if (m.hidden) return;
      m.hidden = true; c.innerHTML = ""; m.onclick = null; modalClose = null;
      document.removeEventListener("keydown", onKey);
      if (!fromPop) setTimeout(() => { if (!modalClose && history.state && history.state.modal) { modalIgnore = true; history.back(); } }, 0);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    m.onclick = (e) => { if (e.target === m || e.target.closest("[data-close]")) close(null); };
    if (setup) setup(c, close);
  });
}
export async function confirmBox(title, text, okLabel = "OK", danger = false) {
  return modal(`<p class="kicker">CONFIRM</p><h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" data-close>キャンセル</button><button class="btn ${danger ? "danger" : "pri"}" data-ok>${esc(okLabel)}</button></div>`,
    (c, close) => c.querySelector("[data-ok]").onclick = () => close(true));
}

// テキストをファイルとして保存
export function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(file); });

// AI の返事（ごく簡単な Markdown）を安全に HTML にする
export function miniMarkdown(text) {
  const lines = esc(text).split(/\r?\n/);
  let html = "", inList = false;
  for (let raw of lines) {
    let l = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^#{1,6}\s*/, "");
    const li = l.match(/^\s*(?:[-*・]|\d+[.)])\s+(.*)$/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (l.trim()) html += `<p>${l}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// 発音（ブラウザの読み上げ）
export function speak(text, rate = 0.9) {
  try {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = rate;
    const v = speechSynthesis.getVoices().find((x) => /en[-_]US/i.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
