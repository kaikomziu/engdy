// ガチャ（派手な演出）・図鑑・きせかえ
import { $, $$, esc, toast } from "./util.js";
import { S, save } from "./store.js";
import { onEnter, onBack } from "./router.js";
import { sfx, tone, duck } from "./audio.js";
import { fn, token, reasonText } from "./api.js";
import { modal, miniMarkdown, speak } from "./util.js";
import { RARITY, ORDER, COST1, COST10, PITY, DUP_REFUND, DEX, BGS, THEMES, ALL, byId, itemName, itemIcon, itemSub } from "./items.js";

// ================= きせかえを反映 =================
// 画面の明るさ（ライト／ダーク／端末に合わせる）。だれでも最初から使える。テーマ（ガチャ）はアクセントの色を決める
const DARK_BASE = { "--bg": "#16191a", "--paper": "#202425", "--ink": "#e8ebe9", "--sub": "#9aa5a0", "--line": "#343a39" };
const LIGHT_BASE = { "--bg": "#f5f3ee", "--paper": "#fffdf9", "--ink": "#1f2a27", "--sub": "#66736e", "--line": "#e2ded5" };
const DARK_THEMES = ["sumi", "midnight"];
export const isDarkMode = () => { const m = S.settings.mode || "light"; return m === "dark" || (m === "auto" && matchMedia("(prefers-color-scheme: dark)").matches); };
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if ((S.settings.mode || "light") === "auto") applySkin(); }); } catch (e) {}

// 設定で選べるアクセントカラー（"" はテーマの色のまま）
export const ACCENTS = [["", "テーマの色"], ["#2f6f5e", "深緑"], ["#2a7f86", "青緑"], ["#2f5f8f", "藍"], ["#5a55b0", "すみれ"], ["#8a4fa0", "紫"], ["#c0428a", "桃"], ["#b5543c", "れんが"], ["#c07a1f", "山吹"], ["#4b5560", "墨"]];
export function applySkin() {
  const th = byId("theme", S.equip.theme) || THEMES[0];
  const root = document.documentElement;
  ["--bg", "--paper", "--ink", "--sub", "--line", "--accent", "--accent-soft"].forEach((k) => root.style.removeProperty(k));
  const dark = isDarkMode();
  const themeIsDark = DARK_THEMES.includes(th.id);
  if (dark) {
    // ダーク：もともと暗いテーマはそのまま、明るいテーマは土台だけ暗くしてアクセントの色を残す
    const v = themeIsDark ? th.v : { ...DARK_BASE, ...(th.v["--accent"] ? { "--accent": th.v["--accent"] } : { "--accent": "#5fb59a" }) };
    for (const [k, val] of Object.entries(v)) root.style.setProperty(k, val);
    if (!themeIsDark) root.style.setProperty("--accent-soft", `color-mix(in srgb, ${v["--accent"]} 22%, ${DARK_BASE["--paper"]})`);
  } else if (themeIsDark) {
    // ライトなのに暗いテーマ：土台を明るくして、アクセントの色だけ使う
    for (const [k, val] of Object.entries(LIGHT_BASE)) root.style.setProperty(k, val);
    root.style.setProperty("--accent", th.v["--accent"]);
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${th.v["--accent"]} 16%, #fff)`);
  } else {
    for (const [k, v] of Object.entries(th.v)) root.style.setProperty(k, v);
  }
  // 自分で選んだアクセントカラー（テーマより優先）。ダークでは少し明るくして読みやすくする
  const ac = S.settings.accentColor;
  if (ac && ACCENTS.some((a) => a[0] === ac)) {
    const c = dark ? `color-mix(in srgb, ${ac} 72%, #fff)` : ac;
    root.style.setProperty("--accent", c);
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${c} ${dark ? 22 : 14}%, var(--paper))`);
  }
  root.dataset.mode = dark ? "dark" : "light";
  const mb =document.querySelector("#modeBtn"); if (mb) mb.textContent = dark ? "☀️" : "🌙";
  const bg = byId("bg", S.equip.bg) || BGS[0];
  const layer = $("#bgLayer");
  layer.style.background = bg.css === "none" ? "none" : bg.css;
  layer.style.animation = bg.anim === "aurora" ? "auroraMove 18s ease-in-out infinite alternate" : bg.anim === "drift" ? "driftMove 30s linear infinite" : "none";
  layer.style.backgroundSize = bg.anim === "aurora" ? "300% 300%" : "";
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue("--bg").trim() || "#f5f3ee";
}
const st = document.createElement("style");
st.textContent = `@keyframes auroraMove{0%{background-position:0% 50%}100%{background-position:100% 50%}}@keyframes driftMove{to{background-position:90px 180px,70px 140px,0 0}}`;
document.head.appendChild(st);

// ================= ガチャ画面 =================
onEnter("gacha", renderGacha);
function renderGacha() {
  const ownDex = DEX.filter((d) => S.owned.dex[d.id]).length;
  $("#gachaBody").innerHTML = `<div class="card g-machine">
      <p class="kicker">WORD GACHA</p><h3>ことばガチャ</h3>
      <p class="hint">英単語の図鑑・背景・テーマが当たります。ダイヤはスタンプカードでもらえます。</p>
      <div class="g-btns">
        <button class="btn pri" id="g1" ${S.diamonds < COST1 ? "disabled" : ""}>1回ひく<br><small>💎 ${COST1}</small></button>
        <button class="btn pri" id="g10" ${S.diamonds < COST10 ? "disabled" : ""}>10連ひく<br><small>💎 ${COST10}（SR以上1つ確定）</small></button>
      </div>
      <p class="rates">${ORDER.map((r) => `${r} <b>${RARITY[r].rate}%</b>`).join("　")}</p>
      <p class="rates">SSR以上まで あと <b>${PITY - S.pity}</b> 回（${PITY}回で確定）</p>
    </div>
    <div class="card"><div class="row" style="justify-content:space-between"><span>図鑑 <b>${ownDex}</b> / ${DEX.length}　背景 <b>${S.owned.bg.length - 1}</b> / ${BGS.length - 1}　テーマ <b>${S.owned.theme.length - 1}</b> / ${THEMES.length - 1}</span>
      <button class="btn sm" data-go="collection">図鑑・きせかえを見る</button></div></div>`;
  $("#g1").onclick = () => pull(1);
  $("#g10").onclick = () => pull(10);
}

// ================= 抽選 =================
function rollRarity(minIdx = 0) {
  if (S.pity >= PITY - 1) return Math.random() < 0.125 ? "UR" : "SSR";
  const pool = ORDER.slice(minIdx);
  const sum = pool.reduce((a, r) => a + RARITY[r].rate, 0);
  let x = Math.random() * sum;
  for (const r of pool) { if ((x -= RARITY[r].rate) < 0) return r; }
  return pool[pool.length - 1];
}
function rollOne(minIdx) {
  const r = rollRarity(minIdx);
  if (r === "SSR" || r === "UR") S.pity = 0; else S.pity++;
  const cands = ALL.filter((it) => it.r === r);
  // 図鑑を少し出やすく
  const dex = cands.filter((c) => c.type === "dex");
  const it = dex.length && Math.random() < 0.7 ? dex[Math.floor(Math.random() * dex.length)] : cands[Math.floor(Math.random() * cands.length)];
  return grant(it);
}
function grant(it) {
  let isNew = false, refund = 0;
  if (it.type === "dex") { isNew = !S.owned.dex[it.id]; S.owned.dex[it.id] = (S.owned.dex[it.id] || 0) + 1; }
  else {
    const arr = S.owned[it.type];
    if (arr.includes(it.id)) { refund = DUP_REFUND; S.diamonds += refund; } else { arr.push(it.id); isNew = true; }
  }
  return { it, isNew, refund };
}
function pull(n) {
  const cost = n === 10 ? COST10 : COST1;
  if (S.diamonds < cost) { toast("ダイヤが足りません"); return; }
  S.diamonds -= cost; S.pulls += n;
  const res = [];
  for (let i = 0; i < n; i++) res.push(rollOne(0));
  if (n === 10 && !res.some((x) => ORDER.indexOf(x.it.r) >= 2)) {
    // SR以上がなければ最後の1枠をSR以上に（引き直しぶんの景品は取り消す）
    const last = res.pop(); undo(last);
    res.push(rollOne(2));
  }
  save(true);
  play(res);
}
function undo(g) {
  if (g.it.type === "dex") { S.owned.dex[g.it.id]--; if (!S.owned.dex[g.it.id]) delete S.owned.dex[g.it.id]; }
  else if (g.refund) S.diamonds -= g.refund;
  else S.owned[g.it.type] = S.owned[g.it.type].filter((x) => x !== g.it.id);
}

// ================= 演出 =================
const stage = $("#gachaStage"), orb = $("#gOrb"), rays = $("#gRays"), flash = $("#gFlash"), result = $("#gResult");
let skip = false, skipResolve = null;
const wait = (ms) => new Promise((r) => { if (skip) return r(); const t = setTimeout(r, ms); skipResolve = () => { clearTimeout(t); r(); }; });
$("#gSkip").onclick = () => { skip = true; if (skipResolve) skipResolve(); };

async function play(res) {
  skip = false;
  const best = res.reduce((a, g) => Math.max(a, ORDER.indexOf(g.it.r)), 0), bestR = ORDER[best];
  stage.hidden = false; result.innerHTML = ""; result.classList.remove("on");
  $("#gSkip").hidden = false;
  duck(true); fx.start();
  // 最初はひかえめな色。SSR以上は途中で色が変わる（昇格演出）
  const startR = best >= 3 ? (Math.random() < 0.5 ? "R" : "SR") : bestR;
  setOrb(startR);
  orb.className = "g-orb"; void orb.offsetWidth;
  orb.classList.add("drop"); sfx("pop", 0.6);
  await wait(750);
  orb.className = "g-orb wobble"; sfx("roll", 0.8);
  await wait(1300);
  if (best >= 2) { rays.classList.add("on"); rays.style.setProperty("--ray", RARITY[startR].ray); }
  if (best >= 3) {
    sfx("slow"); stage.classList.add("shake"); await wait(500); stage.classList.remove("shake");
    setOrb(bestR); rays.style.setProperty("--ray", RARITY[bestR].ray); sfx("shine");
    fx.burst(innerWidth / 2, innerHeight / 2, RARITY[bestR].color, 60, 6);
    await wait(900);
    if (best >= 4) { setOrb("UR", true); sfx("flash"); stage.classList.add("shake"); await wait(700); stage.classList.remove("shake"); }
  }
  orb.className = "g-orb charge"; sfx("tick");
  await wait(1100);
  flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on");
  sfx(best >= 3 ? "boom" : best >= 2 ? "shine" : "pop", best >= 3 ? 0.9 : 0.7);
  if (best >= 3) { stage.classList.add("shake"); setTimeout(() => stage.classList.remove("shake"), 500); }
  fx.burst(innerWidth / 2, innerHeight / 2, RARITY[bestR].color, best >= 3 ? 220 : best >= 2 ? 120 : 60, best >= 3 ? 14 : 9);
  if (best >= 3) fx.confetti(best >= 4 ? 260 : 160);
  orb.className = "g-orb"; orb.style.visibility = "hidden";
  skip = false;
  $("#gSkip").hidden = true;
  if (res.length === 1) showSingle(res[0]); else await showTen(res);
}

function setOrb(r, rainbow) {
  orb.style.visibility = "";
  orb.style.setProperty("--orb", RARITY[r].orb);
  orb.style.filter = rainbow ? "hue-rotate(0deg)" : "";
  if (rainbow) orb.animate([{ filter: "hue-rotate(0deg) brightness(1.4)" }, { filter: "hue-rotate(360deg) brightness(1.4)" }], { duration: 900, iterations: Infinity });
}

function cardHtml(g) {
  const it = g.it;
  return `<div class="gi">${itemIcon(it)}</div><div class="gn">${esc(itemName(it))}</div><div class="gj">${esc(itemSub(it))}${it.type === "dex" ? "" : `：${esc(it.name)}`}</div>
    <span class="gt">${it.r}</span>${g.isNew ? `<span class="gnew">NEW</span>` : ""}${g.refund ? `<span class="gdup">もう持っているので 💎+${g.refund}</span>` : ""}
    ${it.type === "dex" ? `<p class="gj" style="margin:8px 0 0;font-style:italic">${esc(it.ex)}</p>` : ""}`;
}

function showSingle(g) {
  const r = g.it.r, c = RARITY[r].color;
  result.style.setProperty("--glow", c);
  result.innerHTML = `<div class="g-rank ${r === "UR" ? "ur" : ""}" style="--glow:${c}">${r}</div>
    <div class="g-card" style="--glow:${c}">${cardHtml(g)}</div>
    <div class="g-done">${doneBtns(1)}</div>`;
  result.classList.add("on");
  if (g.it.type === "dex") setTimeout(() => speak(g.it.en), 400);
  bindDone();
}

async function showTen(res) {
  result.innerHTML = `<div class="g-grid">${res.map((g) => `<div class="g-mini ${ORDER.indexOf(g.it.r) >= 3 ? "hi" : ""}" style="--glow:${RARITY[g.it.r].color}"><div class="in"><div class="f"></div><div class="b"><div class="gi">${itemIcon(g.it)}</div><div class="gn">${esc(itemName(g.it))}</div><span class="gt">${g.it.r}${g.isNew ? " NEW" : ""}</span></div></div></div>`).join("")}</div>
    <div class="g-done" style="visibility:hidden">${doneBtns(10)}</div>`;
  result.classList.add("on");
  $("#gSkip").hidden = false; skip = false;
  const minis = $$(".g-mini", result);
  for (let i = 0; i < minis.length; i++) {
    await wait(skip ? 0 : 260);
    minis[i].classList.add("flip");
    const ri = ORDER.indexOf(res[i].it.r);
    if (!skip) {
      sfx(ri >= 3 ? "boom" : ri >= 2 ? "shine" : "tick", ri >= 3 ? 0.7 : 0.5);
      const rc = minis[i].getBoundingClientRect();
      if (ri >= 2) fx.burst(rc.left + rc.width / 2, rc.top + rc.height / 2, RARITY[res[i].it.r].color, ri >= 3 ? 90 : 40, ri >= 3 ? 9 : 6);
      if (ri >= 3) { stage.classList.add("shake"); setTimeout(() => stage.classList.remove("shake"), 400); await wait(500); }
    }
  }
  $("#gSkip").hidden = true;
  $(".g-done", result).style.visibility = "";
  bindDone();
}

function doneBtns(n) {
  const cost = n === 10 ? COST10 : COST1;
  return `<button class="btn" id="gClose" style="color:#fff;background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3)">閉じる</button>
    <button class="btn pri" id="gAgain" ${S.diamonds < cost ? "disabled" : ""}>もう${n === 10 ? "10連" : "1回"}（💎${cost}）</button>`;
}
function bindDone() {
  $("#gClose").onclick = close;
  $("#gAgain").onclick = () => { const n = $("#gAgain").textContent.includes("10連") ? 10 : 1; close(); setTimeout(() => pull(n), 50); };
}
// スマホの「戻る」で演出を閉じる
onBack(() => { if (stage.hidden) return false; skip = true; if (skipResolve) skipResolve(); close(); return true; });
function close() {
  if (stage.hidden) return;
  stage.hidden = true; rays.classList.remove("on"); fx.stop(); duck(false);
  orb.getAnimations().forEach((a) => a.cancel());
  renderGacha();
  const d = document.querySelector("#diaCount"); if (d) d.textContent = S.diamonds.toLocaleString();
  $$(".diaMirror").forEach((e) => (e.textContent = S.diamonds.toLocaleString()));
}

// ================= パーティクル =================
const fx = (() => {
  const cv = $("#fx"), ctx = cv.getContext("2d");
  let parts = [], raf = 0, on = false;
  const resize = () => { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); };
  addEventListener("resize", resize);
  function loop() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    // 背景のきらきら
    if (Math.random() < 0.3) parts.push({ x: Math.random() * innerWidth, y: innerHeight + 10, vx: 0, vy: -0.6 - Math.random(), g: 0, life: 200, max: 200, size: 1 + Math.random() * 2, color: "#ffffff", kind: "dot" });
    ctx.globalCompositeOperation = "lighter";
    parts = parts.filter((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= p.drag || 0.99; p.life--;
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      if (p.kind === "conf") {
        ctx.globalCompositeOperation = "source-over";
        p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
        ctx.globalCompositeOperation = "lighter";
      } else {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === "spark" ? a + 0.3 : 1), 0, 7); ctx.fill();
      }
      return p.life > 0 && p.y < innerHeight + 40;
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    if (on) raf = requestAnimationFrame(loop);
  }
  return {
    start() { resize(); parts = []; on = true; cancelAnimationFrame(raf); loop(); },
    stop() { on = false; cancelAnimationFrame(raf); parts = []; ctx.clearRect(0, 0, innerWidth, innerHeight); },
    burst(x, y, color, n, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * speed + 1;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.06, drag: 0.97, life: 60 + Math.random() * 50, max: 110, size: 1.5 + Math.random() * 3, color: Math.random() < 0.3 ? "#ffffff" : color, kind: "spark" });
      }
    },
    confetti(n) {
      const colors = ["#ff5f6d", "#ffc371", "#7cffcb", "#5f9bff", "#d36bff", "#ffffff"];
      for (let i = 0; i < n; i++) parts.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, g: 0.03, drag: 0.995, life: 260, max: 260, size: 6 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, color: colors[i % colors.length], kind: "conf" });
    },
  };
})();

// 図鑑の1語をくわしく（AI の解説つき。いちど見た解説は保存しておく）
function openDex(d) {
  S.dexAI ||= {};
  const body = () => S.dexAI[d.id] ? `<div class="msg model dex-ai">${miniMarkdown(S.dexAI[d.id])}</div>` : `<button class="btn" id="dexAi">✨ AI の解説を見る</button>`;
  modal(`<p class="kicker">${d.r} ・ WORD</p><div class="dex-head"><span class="gi">${d.icon}</span><div><h3 style="margin:0">${esc(d.en)}</h3><p class="note" style="margin:0">${esc(d.ja)}</p></div></div>
    <p class="dex-ex">“${esc(d.ex)}”</p><div id="dexAiBox">${body()}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="dexSay">🔊 発音</button><button class="btn pri" data-close>閉じる</button></div>`,
    (c) => {
      c.querySelector("#dexSay").onclick = () => { speak(d.en); setTimeout(() => speak(d.ex), 1300); };
      const bind = () => { const b = c.querySelector("#dexAi"); if (b) b.onclick = async () => {
        if (!token()) { toast("AI の解説は、ログインすると見られます"); return; }
        b.disabled = true; b.innerHTML = `<span class="spinner"></span> 調べています…`;
        const r = await fn("dex_explain", { word: d.en, ja: d.ja });
        if (!r.ok) { toast(reasonText(r.reason)); b.disabled = false; b.textContent = "✨ AI の解説を見る"; return; }
        S.dexAI[d.id] = r.text; save();
        if (r.cached) toast("♻️ 保存済みの解説です（AI の回数は減っていません）", 2500);
        const box = c.querySelector("#dexAiBox"); if (box) box.innerHTML = body();
      }; };
      bind();
    });
}

// ================= 図鑑・きせかえ =================
onEnter("collection", renderCollection);
let colTab = "dex";
function renderCollection() {
  const tabs = `<div class="tabs" id="colTabs"><button class="tab ${colTab === "dex" ? "on" : ""}" data-t="dex">ことば図鑑</button><button class="tab ${colTab === "bg" ? "on" : ""}" data-t="bg">背景</button><button class="tab ${colTab === "theme" ? "on" : ""}" data-t="theme">テーマ</button></div>`;
  let inner = "";
  if (colTab === "dex") {
    const n = DEX.filter((d) => S.owned.dex[d.id]).length;
    inner = `<p class="hint">集めた単語 ${n} / ${DEX.length}。タップで発音と例文。</p><div class="dex">${DEX.map((d) => {
      const c = S.owned.dex[d.id];
      return `<div class="dex-item ${c ? "" : "unknown"}" data-dex="${d.id}"><span class="rr">${d.r}</span>${c ? `<span class="cnt">×${c}</span>` : ""}<div class="gi">${d.icon}</div><b>${c ? esc(d.en) : "？？？"}</b><small>${c ? esc(d.ja) : "&nbsp;"}</small></div>`;
    }).join("")}</div>`;
  } else {
    const list = colTab === "bg" ? BGS : THEMES;
    inner = `<div class="skin-grid">${list.map((it) => {
      const own = S.owned[colTab].includes(it.id), on = S.equip[colTab] === it.id;
      const sw = colTab === "bg" ? `background:${it.css === "none" ? "var(--bg)" : it.css};${it.anim === "aurora" ? "background-size:300% 300%" : ""}` : `background:linear-gradient(135deg,${it.v["--bg"] || "#f5f3ee"} 0 50%,${it.v["--accent"] || "#2f6f5e"} 50%)`;
      return `<button class="skin ${on ? "on" : ""} ${own ? "" : "locked"}" data-skin="${it.id}" ${own ? "" : "disabled"}><div class="sw" style="${sw}"></div><div class="sl">${own ? esc(it.ja) : "？？？"}<small>${it.r === "-" ? "はじめから" : it.r}${on ? " ・ 使用中" : ""}</small></div></button>`;
    }).join("")}</div>`;
  }
  $("#colBody").innerHTML = `<div class="card">${tabs}<div style="margin-top:14px">${inner}</div></div>`;
  $("#colTabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { colTab = b.dataset.t; renderCollection(); } };
  $$("[data-skin]").forEach((b) => (b.onclick = () => { S.equip[colTab] = b.dataset.skin; save(); applySkin(); tone("click"); renderCollection(); }));
  $$("[data-dex]").forEach((b) => (b.onclick = () => {
    const d = DEX.find((x) => x.id === b.dataset.dex); if (!S.owned.dex[d.id]) return;
    speak(d.en);
    openDex(d);
  }));
}
