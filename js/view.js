// 閲覧：単語 →（タップ or 数秒）→ 意味 →（タップ or 数秒）→ 次の単語
// 放置対策：60秒操作がないと止める。画面が隠れている間・止まっている間の時間は記録しない
// 操作：タップ / Space / → で進む、← で戻る、P で一時停止、スマホは右スワイプで次・左スワイプで戻る
import { $, esc, fmtDuration, speak, toast } from "./util.js";
import { S, save, today, wordRec } from "./store.js";
import { go, onEnter, onLeave } from "./router.js";
import { tone } from "./audio.js";
import { awardLap, updateDia } from "./app.js";
import { startList } from "./lists.js";
import { ipaOf, prefetch } from "./voice.js";

const IDLE_MS = 60000, MIN_WORDS_FOR_STAMP = 5;
let V = null;     // いまの閲覧

onEnter("view", (list) => {
  if (!list) { go("browse"); return; }
  V = {
    title: list.title, words: list.words, src: list.full || { title: list.title, words: list.words }, pos: list.pos || null, label: list.label || "",
    reverse: !!list.reverse, i: Math.min(list.resumeAt || 0, list.words.length - 1), counted: new Set(list.counted || []),
    phase: "word", phaseAt: 0, seconds: 0, lastInput: Date.now(), paused: false, hold: false, timer: 0, last: performance.now(),
  };
  $("#viewTitle").textContent = (list.label ? `${list.title} ・ ${list.label}` : list.title) + (V.reverse ? " ・ 意味→英語" : "");
  $("#idleBox").hidden = true;
  setHold(false);
  showWord();
  V.timer = setInterval(tick, 200);
  if (list.resumeAt) toast(`${V.i + 1}語目から再開します`);
});
onLeave("view", stop);

function stop() {
  if (!V) return;
  clearInterval(V.timer);
  save(true);
  try { speechSynthesis.cancel(); } catch (e) {}
}

// 途中でやめても続きから再開できるように覚えておく
function remember() {
  S.resume = { title: V.title, words: V.words, full: V.src, pos: V.pos, label: V.label, reverse: V.reverse, resumeAt: V.i, counted: [...V.counted], at: Date.now() };
  save();
}

const front = (x) => (V.reverse ? x.m || "（意味なし）" : x.w);
const back = (x) => (V.reverse ? x.w : x.m || "（意味が登録されていません）");

function showWord() {
  const x = V.words[V.i];
  V.phase = "word"; V.phaseAt = 0;
  const w = $("#vWord"); w.textContent = front(x); w.classList.toggle("ja", V.reverse);
  w.style.animation = "none"; void w.offsetWidth; w.style.animation = "";
  const m = $("#vMean"); m.textContent = ""; m.classList.remove("show"); m.classList.toggle("en", V.reverse);
  $("#vHint").textContent = V.reverse ? "英語を思い出したら、タップで答え" : "タップで意味を表示";
  $("#viewCount").textContent = `${V.i + 1} / ${V.words.length}`;
  $("#viewBar").style.width = `${(V.i / V.words.length) * 100}%`;
  $("#vBack").disabled = V.i === 0;
  if (S.settings.autoSpeak && !V.reverse) speak(x.w);
  showIpa(x, !V.reverse);
  const nx = V.words[V.i + 1]; if (nx) prefetch(nx.w);
  remember();
}
function reveal() {
  const x = V.words[V.i];
  V.phase = "mean"; V.phaseAt = 0;
  $("#vMean").textContent = back(x);
  $("#vMean").classList.add("show");
  $("#vHint").textContent = V.i + 1 < V.words.length ? "タップで次へ" : "タップで完了";
  if (S.settings.autoSpeak && V.reverse) speak(x.w);
  if (V.reverse) showIpa(x, true);
  // 見た単語として記録（戻って見直したぶんは数えない）
  if (!V.counted.has(V.i)) {
    V.counted.add(V.i);
    const r = wordRec(x.w, x.m);
    r.seen++; r.last = Date.now();
    today().w++; S.stats.views++;
  }
  save();
}
// 発音記号（英語が見えているときだけ）
function showIpa(x, visible) {
  const el = $("#vIpa"); el.textContent = "";
  if (!visible) return;
  const i = V.i;
  ipaOf(x.w).then((ipa) => { if (V && V.i === i && ipa) el.textContent = ipa; });
}
function next() {
  tone("next");
  if (V.i + 1 >= V.words.length) { finish(); return; }
  V.i++; showWord();
}
function prev() {
  if (!V || V.paused) return;
  if (V.phase === "mean") { showWord(); return; }
  if (V.i === 0) return;
  V.i--; showWord(); reveal(); tone("click");
}
function advance() {
  if (!V || V.paused) return;
  if (V.phase === "word") reveal(); else next();
}
// 自動で進むのを止める（自分のペースでめくる）
function setHold(on) {
  if (V) V.hold = on;
  $("#vPause").textContent = on ? "▶ 自動で進める" : "⏸ 一時停止";
  $("#vPause").classList.toggle("on", on);
  $("#vTimer").style.width = "0";
}

function tick() {
  if (!V) return;
  const now = performance.now(), dt = Math.min(1000, now - V.last); V.last = now;
  const visible = document.visibilityState === "visible";
  if (!V.paused && Date.now() - V.lastInput > IDLE_MS) { V.paused = true; $("#idleBox").hidden = false; }
  if (V.paused || !visible) return;
  // ちゃんと見ている時間だけ数える
  const sec = dt / 1000;
  V.seconds += sec; S.stats.seconds += sec; today().s += sec;
  if (V.hold) return;
  // 自動で進む
  V.phaseAt += dt;
  const lim = (V.phase === "word" ? S.settings.showDelay : S.settings.nextDelay) * 1000;
  $("#vTimer").style.width = `${Math.min(100, (V.phaseAt / lim) * 100)}%`;
  if (V.phaseAt >= lim) advance();
}

function input() { if (V) V.lastInput = Date.now(); }
let swiped = false;
$("#viewer").addEventListener("click", (e) => {
  if (e.target.closest("#viewSpeak")) return;
  if (swiped) { swiped = false; return; }
  input(); advance();
});
// スワイプ（右へ＝次、左へ＝戻る）
let sx = 0, sy = 0;
$("#viewer").addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
$("#viewer").addEventListener("touchend", (e) => {
  const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    swiped = true; setTimeout(() => (swiped = false), 400);
    input();
    if (dx > 0) { if (V && V.phase === "word") reveal(); next(); } else prev();
  }
}, { passive: true });
$("#viewSpeak").onclick = (e) => { e.stopPropagation(); input(); if (V) speak(V.words[V.i].w); };
$("#vBack").onclick = () => { input(); prev(); };
$("#vNext").onclick = () => { input(); advance(); };
$("#vPause").onclick = () => { input(); if (V) setHold(!V.hold); };
document.addEventListener("keydown", (e) => {
  if (!document.querySelector("#s-view.active") || !V || (e.target.closest && e.target.closest("input,textarea"))) return;
  input();
  if (V.paused) { if (e.key === "Enter" || e.key === " ") resume(); return; }
  if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); advance(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  else if (e.key === "p" || e.key === "P") setHold(!V.hold);
  else if (e.key === "s" || e.key === "S") speak(V.words[V.i].w);
  else if (e.key === "Escape") quit();
});
["pointermove", "touchstart", "wheel"].forEach((ev) => document.addEventListener(ev, () => { if (V && !V.paused) input(); }, { passive: true }));
function resume() { if (!V) return; V.paused = false; V.lastInput = Date.now(); V.last = performance.now(); $("#idleBox").hidden = true; }
$("#idleResume").onclick = resume;

$("#viewQuit").onclick = quit;
function quit() {
  if (!V) return;
  const left = V.words.length - V.i;
  if (left > 1 && !confirm(`あと ${left}語 で終わりです。やめますか？\n（ここまでの記録は残り、メイン画面から続きを再開できます）`)) return;
  stop(); V = null; go("main");
}

function finish() {
  $("#viewBar").style.width = "100%";
  S.stats.laps++; today().l++;
  if (V.pos) S.pos[V.pos.key] = V.pos.next;   // 次は続きから
  delete S.resume;
  const lap = V.words.length >= MIN_WORDS_FOR_STAMP ? awardLap() : { stamped: false, gained: 0, tooShort: true };
  save(true); updateDia();
  const done = V; stop(); V = null;
  tone(lap.stamped ? "stamp" : "ok");
  const partial = done.words.length < done.src.words.length;
  $("#viewDone").innerHTML = `<p class="kicker">LAP COMPLETE</p><h3>${esc(done.title)} ${partial ? `${done.words.length}語 完了` : "を1周しました"}</h3>${done.label ? `<p class="hint">${esc(done.label)}</p>` : ""}
    <div class="done-stats"><div><small>単語</small><b>${done.words.length}</b></div><div><small>学習時間</small><b>${fmtDuration(done.seconds)}</b></div><div><small>今日の合計</small><b>${fmtDuration(today().s)}</b></div></div>
    ${lap.stamped ? `<div class="gain">🎉 今日のスタンプを押しました！ 💎 +${lap.gained}${lap.cardDone ? "<br>スタンプカードがいっぱいになりました（ボーナス込み）" : ""}</div>`
      : lap.tooShort ? `<p class="hint">スタンプは ${MIN_WORDS_FOR_STAMP}語以上やり終えるともらえます。</p>` : `<p class="hint">今日のスタンプは押してあります。また明日！</p>`}
    <div class="row wrap" style="justify-content:center;margin-top:14px">
      <button class="btn" id="vdAgain">${done.pos ? "続きをやる" : "もう1周"}</button>
      <button class="btn" data-go="test">テストする</button>
      <button class="btn pri" id="vdHome">メインへ</button></div>`;
  go("viewdone");
  $("#vdAgain").onclick = () => startList(done.src);
  $("#vdHome").onclick = () => go("main", { newStamp: lap.stamped });
  if (lap.stamped) toast(`💎 +${lap.gained}`);
}

// メイン画面の「続きから再開」
export function resumeView() {
  if (!S.resume || !S.resume.words || !S.resume.words.length) return;
  go("view", S.resume);
}
