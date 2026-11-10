// 自由メモ：ページを自由に増やせる手書きノート
// 道具：ペン・蛍光ペン・消しゴム・定規（まっすぐな線）・まる・四角・文字。色と太さを変えられる
// データは engdy_memo（ログイン中はかるわかGAMES のクラウドにも同期）
import { $, $$, esc, toast, modal, confirmBox } from "./util.js";
import { onEnter, onLeave } from "./router.js";
import { tone } from "./audio.js";
import { fn, token, reasonText } from "./api.js";
import { createListFrom } from "./lists.js";
import { go } from "./router.js";

const KEY = "engdy_memo";
const W = 1000, H = 1400;                 // ページの大きさ（論理座標。画面に合わせて縮める）
const PAPER = "#fffdf8";
const COLORS = ["#1f2a27", "#d23a2c", "#2d5f8a", "#2f8f5e", "#e08a1e", "#8a4fbf", "#e85a9a", "#ffffff"];
const HL_COLORS = ["#ffe94d", "#7cf29a", "#7cd6ff", "#ff9ecf", "#ffb86b"];
const BGS = [["plain", "無地"], ["ruled", "罫線"], ["grid", "方眼"], ["dots", "ドット"]];
const TOOLS = [
  ["pen", "✏️", "ペン"], ["hl", "🖍️", "蛍光ペン"], ["eraser", "🧽", "消しゴム"],
  ["line", "📏", "定規"], ["circle", "⭕", "まる"], ["rect", "⬜", "四角"], ["text", "🔤", "文字"],
];

let M = load();
let tool = "pen", color = COLORS[0], hlColor = HL_COLORS[0], width = 5, hlWidth = 28;
let base, live, bctx, lctx, scale = 1;
let drawing = null, penSeen = 0;
const undo = new Map(), redo = new Map();   // ページごとの元に戻す / やり直す

function load() {
  try { const m = JSON.parse(localStorage.getItem(KEY)); if (m && Array.isArray(m.pages) && m.pages.length) return m; } catch (e) {}
  return { pages: [newPage(1)], cur: 0 };
}
function newPage(n) { return { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: `ページ ${n}`, bg: "ruled", items: [] }; }
let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(M)); }
    catch (e) { toast("保存できる容量がいっぱいです。いらないページを消してください", 4000); }
  }, 400);
}
const page = () => M.pages[M.cur];

// ================= 画面 =================
onEnter("memo", (arg) => {
  M = load();
  if (arg && Number.isInteger(arg.page)) M.cur = arg.page;   // 検索から開いたページ
  if (M.cur >= M.pages.length || M.cur < 0) M.cur = 0;
  buildToolbar();
  fit(); renderPage();
});
onLeave("memo", () => { clearTimeout(saveTimer); try { localStorage.setItem(KEY, JSON.stringify(M)); } catch (e) {} });
addEventListener("resize", () => { if (document.querySelector("#s-memo.active")) { fit(); renderPage(); } });

function buildToolbar() {
  $("#memoTools").innerHTML = TOOLS.map(([id, ic, name]) => `<button class="mtool ${tool === id ? "on" : ""}" data-tool="${id}" title="${name}"><span>${ic}</span><small>${name}</small></button>`).join("");
  renderColors();
  $("#memoWidth").value = tool === "hl" ? hlWidth : width;
}
function renderColors() {
  const list = tool === "hl" ? HL_COLORS : COLORS;
  const curC = tool === "hl" ? hlColor : color;
  $("#memoColors").innerHTML = list.map((c) => `<button class="msw ${c === curC ? "on" : ""}" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join("")
    + `<label class="msw custom" title="ほかの色"><input type="color" id="memoCustom" value="${curC.length === 7 ? curC : "#000000"}"></label>`;
  $("#memoCustom").oninput = (e) => setColor(e.target.value);
  const hide = tool === "eraser";
  $("#memoColors").style.visibility = hide ? "hidden" : "";
  $("#memoWidthWrap").style.visibility = tool === "text" ? "hidden" : "";
}
function setColor(c) { if (tool === "hl") hlColor = c; else color = c; renderColors(); }

$("#memoTools").onclick = (e) => {
  const b = e.target.closest("[data-tool]"); if (!b) return;
  tool = b.dataset.tool; tone("click"); buildToolbar();
};
$("#memoColors").onclick = (e) => { const b = e.target.closest("[data-color]"); if (b) setColor(b.dataset.color); };
$("#memoWidth").oninput = (e) => { const v = +e.target.value; if (tool === "hl") hlWidth = v; else width = v; };

// キャンバスを画面に合わせる
function fit() {
  const stage = $("#memoStage");
  base = $("#memoBase"); live = $("#memoLive");
  const r = stage.getBoundingClientRect();
  scale = Math.min((r.width - 16) / W, (r.height - 16) / H);
  scale = Math.max(0.2, scale);
  const cw = Math.round(W * scale), ch = Math.round(H * scale), dpr = Math.min(3, devicePixelRatio || 1);
  for (const c of [base, live]) {
    c.style.width = cw + "px"; c.style.height = ch + "px";
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
  }
  $("#memoPaper").style.width = cw + "px"; $("#memoPaper").style.height = ch + "px";
  bctx = base.getContext("2d"); lctx = live.getContext("2d");
  bctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  lctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}

// ================= 描く =================
function renderPage() {
  const p = page(); if (!bctx) return;
  $("#memoTitle").value = p.title;
  $("#memoPageNo").textContent = `${M.cur + 1} / ${M.pages.length}`;
  $("#memoPrev").disabled = M.cur === 0;
  $("#memoNext").textContent = M.cur === M.pages.length - 1 ? "＋" : "▶";
  $("#memoNext").title = M.cur === M.pages.length - 1 ? "ページを増やす" : "次のページ";
  $("#memoUndo").disabled = !(undo.get(p.id) || []).length;
  $("#memoRedo").disabled = !(redo.get(p.id) || []).length;
  drawBg(bctx, p.bg);
  for (const it of p.items) drawItem(bctx, it);
  lctx.clearRect(0, 0, W, H);
}
function drawBg(ctx, bg) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#d9e2ec"; ctx.fillStyle = "#c9d3dd"; ctx.lineWidth = 1.5;
  if (bg === "ruled") { for (let y = 120; y < H; y += 56) line(ctx, 40, y, W - 40, y); ctx.strokeStyle = "#f1c6c0"; line(ctx, 110, 0, 110, H); }
  if (bg === "grid") { for (let x = 0; x <= W; x += 40) line(ctx, x, 0, x, H); for (let y = 0; y <= H; y += 40) line(ctx, 0, y, W, y); }
  if (bg === "dots") { for (let x = 40; x < W; x += 40) for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); } }
  ctx.restore();
}
function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function drawItem(ctx, it) {
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = it.c; ctx.fillStyle = it.c; ctx.lineWidth = it.w;
  if (it.t === "hl") { ctx.globalAlpha = 0.4; ctx.globalCompositeOperation = "multiply"; ctx.lineCap = "butt"; }
  if (it.t === "pen" || it.t === "hl") {
    const p = it.p;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    if (p.length === 2) ctx.lineTo(p[0] + 0.1, p[1]);
    for (let i = 2; i < p.length - 2; i += 2) { const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2; ctx.quadraticCurveTo(p[i], p[i + 1], mx, my); }
    if (p.length > 2) ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  } else if (it.t === "line") {
    line(ctx, it.x1, it.y1, it.x2, it.y2);
  } else if (it.t === "circle") {
    ctx.beginPath();
    ctx.ellipse((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, Math.abs(it.x2 - it.x1) / 2, Math.abs(it.y2 - it.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (it.t === "rect") {
    ctx.strokeRect(Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1));
  } else if (it.t === "text") {
    ctx.font = `${it.bold ? "700" : "500"} ${it.s}px "Segoe UI","Hiragino Sans","Yu Gothic UI",sans-serif`;
    ctx.textBaseline = "top";
    String(it.txt).split("\n").forEach((ln, i) => ctx.fillText(ln, it.x, it.y + i * it.s * 1.3));
  }
  ctx.restore();
}

// 画面の座標 → ページの座標
function pt(e) {
  const r = live.getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
}
// 定規：0°・45°・90° の近くならぴったりに
function snapLine(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  let ang = Math.atan2(dy, dx);
  const step = Math.PI / 4, near = Math.round(ang / step) * step;
  if (Math.abs(ang - near) < (6 * Math.PI) / 180) ang = near;
  return [x1, y1, Math.round(x1 + Math.cos(ang) * len), Math.round(y1 + Math.sin(ang) * len)];
}
// まる・四角：縦横がほぼ同じなら、ぴったりの円・正方形に
function snapBox(x1, y1, x2, y2, force) {
  const w = x2 - x1, h = y2 - y1;
  if (force || Math.abs(Math.abs(w) - Math.abs(h)) < Math.max(Math.abs(w), Math.abs(h)) * 0.12) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    return [x1, y1, x1 + Math.sign(w || 1) * s, y1 + Math.sign(h || 1) * s];
  }
  return [x1, y1, x2, y2];
}

function onDown(e) {
  if (e.pointerType === "pen") penSeen = Date.now();
  // ペンを使っているときは、手のひらのタッチを無視する
  if (e.pointerType === "touch" && Date.now() - penSeen < 3000) return;
  if (drawing) return;
  e.preventDefault();
  live.setPointerCapture(e.pointerId);
  const [x, y] = pt(e);
  if (tool === "text") { textAt(x, y); return; }
  drawing = { id: e.pointerId, x0: x, y0: y, pts: [x, y], erased: false, shift: e.shiftKey };
  if (tool === "eraser") { eraseAt(x, y); return; }
  drawLive(x, y);
}
function onMove(e) {
  if (!drawing || e.pointerId !== drawing.id) return;
  e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) {
    const [x, y] = pt(ev);
    if (tool === "eraser") { eraseAt(x, y); continue; }
    if (tool === "pen" || tool === "hl") {
      const p = drawing.pts, lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) >= 2) p.push(x, y);
    } else { drawing.x = x; drawing.y = y; drawing.shift = e.shiftKey; }
  }
  drawLive();
}
function onUp(e) {
  if (!drawing || e.pointerId !== drawing.id) return;
  const d = drawing; drawing = null;
  lctx.clearRect(0, 0, W, H);
  if (tool === "eraser") { if (d.erased) { persist(); renderPage(); } return; }
  const it = makeItem(d);
  if (!it) return;
  pushUndo();
  page().items.push(it);
  drawItem(bctx, it);
  persist();
  renderPageButtons();
}
function makeItem(d) {
  const x = d.x ?? d.x0, y = d.y ?? d.y0;
  if (tool === "pen") return { t: "pen", c: color, w: width, p: d.pts };
  if (tool === "hl") return { t: "hl", c: hlColor, w: hlWidth, p: d.pts };
  if (Math.hypot(x - d.x0, y - d.y0) < 4) return null;
  if (tool === "line") { const [x1, y1, x2, y2] = snapLine(d.x0, d.y0, x, y); return { t: "line", c: color, w: width, x1, y1, x2, y2 }; }
  const [x1, y1, x2, y2] = snapBox(d.x0, d.y0, x, y, d.shift);
  return { t: tool, c: color, w: width, x1, y1, x2, y2 };
}
function drawLive() {
  if (!drawing) return;
  lctx.clearRect(0, 0, W, H);
  const it = makeItem(drawing);
  if (!it) return;
  drawItem(lctx, it.t === "hl" ? { ...it, t: "hl" } : it);
  // 定規は長さと角度を表示
  if (it.t === "line") {
    const len = Math.round(Math.hypot(it.x2 - it.x1, it.y2 - it.y1) / 10);
    const deg = Math.round((Math.atan2(-(it.y2 - it.y1), it.x2 - it.x1) * 180) / Math.PI);
    lctx.save(); lctx.font = "600 22px sans-serif"; lctx.fillStyle = "rgba(31,42,39,.75)";
    lctx.fillText(`${len} mm ・ ${deg}°`, it.x2 + 14, it.y2 - 14); lctx.restore();
  }
}

// 消しゴム：さわった線や図形・文字をまるごと消す
function eraseAt(x, y) {
  const p = page(), R = 18;
  const hit = (it) => {
    if (it.t === "pen" || it.t === "hl") { const q = it.p; for (let i = 0; i < q.length - 2; i += 2) if (segDist(x, y, q[i], q[i + 1], q[i + 2], q[i + 3]) < R + it.w / 2) return true; return q.length === 2 && Math.hypot(x - q[0], y - q[1]) < R + it.w; }
    if (it.t === "line") return segDist(x, y, it.x1, it.y1, it.x2, it.y2) < R + it.w / 2;
    if (it.t === "rect") { const a = [it.x1, it.y1, it.x2, it.y1, it.x2, it.y2, it.x1, it.y2, it.x1, it.y1]; for (let i = 0; i < 8; i += 2) if (segDist(x, y, a[i], a[i + 1], a[i + 2], a[i + 3]) < R + it.w / 2) return true; return false; }
    if (it.t === "circle") { const cx = (it.x1 + it.x2) / 2, cy = (it.y1 + it.y2) / 2, rx = Math.abs(it.x2 - it.x1) / 2 || 1, ry = Math.abs(it.y2 - it.y1) / 2 || 1; const k = Math.hypot((x - cx) / rx, (y - cy) / ry); return Math.abs(k - 1) * Math.min(rx, ry) < R + it.w / 2; }
    if (it.t === "text") { const b = textBox(it); return x > b.x - R && x < b.x + b.w + R && y > b.y - R && y < b.y + b.h + R; }
    return false;
  };
  const keep = p.items.filter((it) => !hit(it));
  if (keep.length !== p.items.length) {
    if (!drawing.erased) pushUndo();
    drawing.erased = true; p.items = keep; renderPage();
  }
  // 消しゴムの位置を表示
  lctx.clearRect(0, 0, W, H);
  lctx.save(); lctx.strokeStyle = "rgba(0,0,0,.35)"; lctx.lineWidth = 2; lctx.beginPath(); lctx.arc(x, y, R, 0, 7); lctx.stroke(); lctx.restore();
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function textBox(it) {
  bctx.save(); bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.font = `${it.bold ? "700" : "500"} ${it.s}px sans-serif`;
  const lines = String(it.txt).split("\n");
  const w = Math.max(...lines.map((l) => bctx.measureText(l).width));
  bctx.restore();
  return { x: it.x, y: it.y, w, h: lines.length * it.s * 1.3 };
}

// 文字：タップした場所に書く。すでにある文字をタップすると直せる
async function textAt(x, y) {
  const p = page();
  const idx = p.items.findLastIndex((it) => it.t === "text" && (() => { const b = textBox(it); return x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8; })());
  const old = idx >= 0 ? p.items[idx] : null;
  const sizes = [[28, "小"], [40, "中"], [60, "大"], [90, "特大"]];
  const res = await modal(`<p class="kicker">TEXT</p><h3>${old ? "文字を直す" : "文字を書く"}</h3>
    <textarea id="mtText" rows="4" maxlength="500" style="font-family:var(--sans)" placeholder="英単語や例文など">${old ? esc(old.txt) : ""}</textarea>
    <div class="row wrap" style="margin-top:10px"><div class="seg" id="mtSize">${sizes.map(([s, l]) => `<button data-s="${s}" class="${(old ? old.s : 40) === s ? "on" : ""}">${l}</button>`).join("")}</div>
      <label class="row" style="gap:6px"><input type="checkbox" id="mtBold" ${old && old.bold ? "checked" : ""}> 太字</label></div>
    <div class="row" style="justify-content:flex-end">${old ? `<button class="btn danger ghost" id="mtDel">消す</button>` : ""}<button class="btn ghost" data-close>キャンセル</button><button class="btn pri" id="mtOk">決定</button></div>`,
    (c, close) => {
      const ta = c.querySelector("#mtText"); setTimeout(() => ta.focus(), 50);
      c.querySelector("#mtSize").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) c.querySelectorAll("#mtSize button").forEach((x) => x.classList.toggle("on", x === b)); };
      c.querySelector("#mtOk").onclick = () => close({ txt: ta.value.replace(/\s+$/, ""), s: +c.querySelector("#mtSize .on").dataset.s, bold: c.querySelector("#mtBold").checked });
      const d = c.querySelector("#mtDel"); if (d) d.onclick = () => close({ del: true });
    });
  if (!res) return;
  pushUndo();
  if (res.del || (!res.txt && old)) { p.items.splice(idx, 1); }
  else if (res.txt) {
    const it = { t: "text", c: color === "#ffffff" ? COLORS[0] : color, x: old ? old.x : x, y: old ? old.y : y, s: res.s, bold: res.bold, txt: res.txt };
    if (old) p.items[idx] = it; else p.items.push(it);
  } else { (undo.get(p.id) || []).pop(); return; }
  persist(); renderPage();
}

// ================= 元に戻す / やり直す =================
function pushUndo() {
  const p = page();
  const u = undo.get(p.id) || []; u.push(JSON.stringify(p.items)); if (u.length > 60) u.shift();
  undo.set(p.id, u); redo.set(p.id, []);
}
function doUndo() {
  const p = page(), u = undo.get(p.id) || []; if (!u.length) return;
  (redo.get(p.id) || redo.set(p.id, []).get(p.id)).push(JSON.stringify(p.items));
  p.items = JSON.parse(u.pop()); persist(); renderPage();
}
function doRedo() {
  const p = page(), r = redo.get(p.id) || []; if (!r.length) return;
  (undo.get(p.id) || undo.set(p.id, []).get(p.id)).push(JSON.stringify(p.items));
  p.items = JSON.parse(r.pop()); persist(); renderPage();
}
function renderPageButtons() {
  const p = page();
  $("#memoUndo").disabled = !(undo.get(p.id) || []).length;
  $("#memoRedo").disabled = !(redo.get(p.id) || []).length;
}
$("#memoUndo").onclick = doUndo;
$("#memoRedo").onclick = doRedo;
document.addEventListener("keydown", (e) => {
  if (!document.querySelector("#s-memo.active") || !$("#modal").hidden || (e.target.closest && e.target.closest("input,textarea"))) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); doRedo(); return; }
  const map = { p: "pen", h: "hl", e: "eraser", l: "line", o: "circle", r: "rect", t: "text" };
  if (!e.ctrlKey && !e.metaKey && map[k]) { tool = map[k]; buildToolbar(); }
});

// ================= ページ =================
function goPage(i) { M.cur = Math.max(0, Math.min(M.pages.length - 1, i)); persist(); renderPage(); }
function addPage(after = M.cur) {
  const p = newPage(M.pages.length + 1); p.bg = page() ? page().bg : "ruled";
  M.pages.splice(after + 1, 0, p); goPage(after + 1); toast("ページを増やしました");
}
$("#memoPrev").onclick = () => goPage(M.cur - 1);
$("#memoNext").onclick = () => (M.cur === M.pages.length - 1 ? addPage() : goPage(M.cur + 1));
$("#memoTitle").onchange = (e) => { page().title = e.target.value.trim().slice(0, 40) || `ページ ${M.cur + 1}`; persist(); };
// ページを左右にスワイプ（2本指）で移動
let sw = null;
$("#memoStage").addEventListener("touchstart", (e) => { if (e.touches.length === 2) sw = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2 }; }, { passive: true });
$("#memoStage").addEventListener("touchend", (e) => {
  if (!sw || !e.changedTouches.length) return;
  const dx = e.changedTouches[0].clientX - sw.x; sw = null;
  if (Math.abs(dx) > 80) { if (drawing) { drawing = null; lctx.clearRect(0, 0, W, H); } goPage(M.cur + (dx < 0 ? 1 : -1)); }
}, { passive: true });

$("#memoMenu").onclick = openMenu;
async function openMenu() {
  const p = page();
  const act = await modal(`<p class="kicker">PAGES</p><h3>ページ</h3>
    <ul class="memo-pages">${M.pages.map((x, i) => `<li class="${i === M.cur ? "on" : ""}" data-i="${i}"><span class="mp-no">${i + 1}</span><b>${esc(x.title)}</b><small>${x.items.length}個</small>
      <span class="mp-ops"><button class="btn sm ghost" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn sm ghost" data-down="${i}" ${i === M.pages.length - 1 ? "disabled" : ""}>↓</button></span></li>`).join("")}</ul>
    <h3 class="sec" style="margin-top:14px">このページの背景</h3>
    <div class="seg" id="mBg">${BGS.map(([v, t]) => `<button data-bg="${v}" class="${p.bg === v ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="row wrap" style="margin-top:14px">
      <button class="btn pri" data-act="ocr">📷 書いた英単語をリストにする（AI）</button>
      <button class="btn" data-act="add">＋ ページを増やす</button>
      <button class="btn" data-act="dup">このページを複製</button>
      <button class="btn" data-act="png">画像で保存</button>
      <button class="btn danger ghost" data-act="clear">このページを白紙に</button>
      <button class="btn danger ghost" data-act="del" ${M.pages.length < 2 ? "disabled" : ""}>このページを削除</button>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>閉じる</button></div>`,
    (c, close) => {
      c.onclick = (e) => {
        const li = e.target.closest("li[data-i]"), up = e.target.closest("[data-up]"), dn = e.target.closest("[data-down]");
        if (up || dn) {
          const i = +(up ? up.dataset.up : dn.dataset.down), j = up ? i - 1 : i + 1;
          [M.pages[i], M.pages[j]] = [M.pages[j], M.pages[i]];
          if (M.cur === i) M.cur = j; else if (M.cur === j) M.cur = i;
          persist(); close("reopen"); return;
        }
        if (li) { close({ go: +li.dataset.i }); return; }
        const b = e.target.closest("[data-bg]");
        if (b) { p.bg = b.dataset.bg; persist(); renderPage(); c.querySelectorAll("#mBg button").forEach((x) => x.classList.toggle("on", x === b)); return; }
        const a = e.target.closest("[data-act]"); if (a) close(a.dataset.act);
      };
    });
  if (!act) return;
  if (act === "reopen") { renderPage(); openMenu(); return; }
  if (act.go !== undefined) { goPage(act.go); return; }
  if (act === "add") addPage();
  if (act === "dup") { const cp = JSON.parse(JSON.stringify(p)); cp.id = newPage(0).id; cp.title = (p.title + " のコピー").slice(0, 40); M.pages.splice(M.cur + 1, 0, cp); goPage(M.cur + 1); toast("複製しました"); }
  if (act === "png") exportPng();
  if (act === "ocr") ocrPage();
  if (act === "clear") { if (await confirmBox("このページを白紙にしますか？", "書いたものがすべて消えます（元に戻すボタンで戻せます）。", "白紙にする", true)) { pushUndo(); p.items = []; persist(); renderPage(); } }
  if (act === "del") {
    if (!(await confirmBox("このページを削除しますか？", `「${p.title}」を削除します。元に戻せません。`, "削除", true))) return;
    M.pages.splice(M.cur, 1); undo.delete(p.id); redo.delete(p.id); goPage(Math.min(M.cur, M.pages.length - 1)); toast("削除しました");
  }
}
// 書いた英単語を AI に読み取ってもらい、単語リストにする
async function ocrPage() {
  if (!token()) { toast("AI の機能は、ログインすると使えます"); KaAccount.login("login"); return; }
  const p = page();
  if (!p.items.length) { toast("このページには、まだ何も書いていません"); return; }
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d"); drawBg(ctx, "plain"); for (const it of p.items) drawItem(ctx, it);
  toast("読み取っています…", 8000);
  const r = await fn("ocr_memo", { image: c.toDataURL("image/jpeg", 0.85) });
  if (!r.ok) { toast(reasonText(r.reason === "image" ? "payload" : r.reason)); return; }
  if (!r.items.length) { toast("英単語が見つかりませんでした", 3000); return; }
  const picked = await modal(`<p class="kicker">AI</p><h3>📷 読み取った英単語（${r.items.length}語）</h3>
    <p class="hint">リストに入れる単語にチェックを入れてください。意味はあとで直せます。</p>
    <div class="rel-list">${r.items.map((i, k) => `<label class="rel-item"><input type="checkbox" data-k="${k}" checked><span><b>${esc(i.word)}</b><small>${esc(i.meaning)}</small></span></label>`).join("")}</div>
    <label class="field" style="margin-top:10px"><span>リストの名前</span><input id="ocrTitle" maxlength="60" value="${esc("メモ：" + p.title)}"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>やめる</button><button class="btn pri" id="ocrOk">リストを作る</button></div>`,
    (cc, close) => cc.querySelector("#ocrOk").onclick = () => close({ title: cc.querySelector("#ocrTitle").value.trim() || "メモから", items: [...cc.querySelectorAll("[data-k]:checked")].map((x) => r.items[+x.dataset.k]) }));
  if (!picked || !picked.items.length) return;
  const l = createListFrom(picked.title, picked.items);
  tone("ok");
  const goNow = await confirmBox("単語リストを作りました", `「${l.title}」（${l.words.length}語）を作りました。リスト制作の画面で開きますか？`, "開く");
  if (goNow) go("create");
}

function exportPng() {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d"); drawBg(ctx, page().bg); for (const it of page().items) drawItem(ctx, it);
  c.toBlob((b) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(b);
    a.download = `${page().title.replace(/[\\/:*?"<>|]/g, "_")}.png`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }, "image/png");
}

// ペン入力
const lv = $("#memoLive");
lv.addEventListener("pointerdown", onDown);
lv.addEventListener("pointermove", onMove);
lv.addEventListener("pointerup", onUp);
lv.addEventListener("pointercancel", (e) => { if (drawing && e.pointerId === drawing.id) { drawing = null; lctx.clearRect(0, 0, W, H); } });
lv.addEventListener("contextmenu", (e) => e.preventDefault());
