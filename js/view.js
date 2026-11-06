// 閲覧：単語 →（タップ or 数秒）→ 意味 →（タップ or 数秒）→ 次の単語
// 放置対策：60秒操作がないと止める。画面が隠れている間・止まっている間の時間は記録しない
import { $, esc, fmtDuration, speak, toast } from "./util.js";
import { S, save, today, wordRec } from "./store.js";
import { go, onEnter, onLeave } from "./router.js";
import { tone } from "./audio.js";
import { awardLap, updateDia } from "./app.js";
import { startList } from "./lists.js";

const IDLE_MS = 60000, MIN_WORDS_FOR_STAMP = 5;
let V = null;     // いまの閲覧

onEnter("view", (list) => {
  if (!list) { go("browse"); return; }
  V = { title: list.title, words: list.words, src: list.full || list, pos: list.pos || null, label: list.label || "", i: 0, phase: "word", phaseAt: 0, seconds: 0, seen: 0, lastInput: Date.now(), paused: false, timer: 0, last: performance.now() };
  $("#viewTitle").textContent = list.label ? `${list.title} ・ ${list.label}` : list.title;
  $("#idleBox").hidden = true;
  showWord();
  V.timer = setInterval(tick, 200);
});
onLeave("view", stop);

function stop() {
  if (!V) return;
  clearInterval(V.timer);
  save(true);
  try { speechSynthesis.cancel(); } catch (e) {}
}

function showWord() {
  const x = V.words[V.i];
  V.phase = "word"; V.phaseAt = 0;
  const w = $("#vWord"); w.textContent = x.w; w.style.animation = "none"; void w.offsetWidth; w.style.animation = "";
  $("#vMean").textContent = ""; $("#vMean").classList.remove("show");
  $("#vHint").textContent = "タップで意味を表示";
  $("#viewCount").textContent = `${V.i + 1} / ${V.words.length}`;
  $("#viewBar").style.width = `${(V.i / V.words.length) * 100}%`;
  if (S.settings.autoSpeak) speak(x.w);
}
function reveal() {
  const x = V.words[V.i];
  V.phase = "mean"; V.phaseAt = 0;
  $("#vMean").textContent = x.m || "（意味が登録されていません）";
  $("#vMean").classList.add("show");
  $("#vHint").textContent = V.i + 1 < V.words.length ? "タップで次へ" : "タップで完了";
  // 見た単語として記録
  const r = wordRec(x.w, x.m);
  r.seen++; r.last = Date.now();
  today().w++; S.stats.views++; V.seen++;
  save();
}
function next() {
  tone("next");
  if (V.i + 1 >= V.words.length) { finish(); return; }
  V.i++; showWord();
}
function advance() {
  if (!V || V.paused) return;
  if (V.phase === "word") reveal(); else next();
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
  // 自動で進む
  V.phaseAt += dt;
  const lim = (V.phase === "word" ? S.settings.showDelay : S.settings.nextDelay) * 1000;
  $("#vTimer").style.width = `${Math.min(100, (V.phaseAt / lim) * 100)}%`;
  if (V.phaseAt >= lim) advance();
}

function input() { if (V) V.lastInput = Date.now(); }
$("#viewer").addEventListener("click", (e) => {
  if (e.target.closest("#viewSpeak")) return;
  input(); advance();
});
$("#viewSpeak").onclick = (e) => { e.stopPropagation(); input(); if (V) speak(V.words[V.i].w); };
document.addEventListener("keydown", (e) => {
  if (!document.querySelector("#s-view.active") || !V) return;
  input();
  if (V.paused) { if (e.key === "Enter" || e.key === " ") resume(); return; }
  if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); advance(); }
  if (e.key === "Escape") quit();
});
["pointermove", "touchstart", "wheel"].forEach((ev) => document.addEventListener(ev, () => { if (V && !V.paused) input(); }, { passive: true }));
function resume() { if (!V) return; V.paused = false; V.lastInput = Date.now(); V.last = performance.now(); $("#idleBox").hidden = true; }
$("#idleResume").onclick = resume;

$("#viewQuit").onclick = quit;
function quit() {
  if (!V) return;
  const left = V.words.length - V.i;
  if (left > 1 && !confirm(`あと ${left}語 で1周です。やめますか？\n（ここまでの時間と単語は記録されます）`)) return;
  stop(); V = null; go("browse");
}

function finish() {
  $("#viewBar").style.width = "100%";
  S.stats.laps++; today().l++;
  if (V.pos) S.pos[V.pos.key] = V.pos.next;   // 次は続きから
  const lap = V.words.length >= MIN_WORDS_FOR_STAMP ? awardLap() : { stamped: false, gained: 0, tooShort: true };
  save(true); updateDia();
  const done = V; stop(); V = null;
  tone(lap.stamped ? "stamp" : "ok");
  $("#viewDone").innerHTML = `<p class="kicker">LAP COMPLETE</p><h3>${esc(done.title)} ${done.label && done.words.length < done.src.words.length ? `${done.words.length}語 完了` : "を1周しました"}</h3>${done.label ? `<p class="hint">${esc(done.label)}</p>` : ""}
    <div class="done-stats"><div><small>単語</small><b>${done.words.length}</b></div><div><small>学習時間</small><b>${fmtDuration(done.seconds)}</b></div><div><small>今日の合計</small><b>${fmtDuration(today().s)}</b></div></div>
    ${lap.stamped ? `<div class="gain">🎉 今日のスタンプを押しました！ 💎 +${lap.gained}${lap.cardDone ? "<br>スタンプカードがいっぱいになりました（ボーナス込み）" : ""}</div>`
      : lap.tooShort ? `<p class="hint">スタンプは ${MIN_WORDS_FOR_STAMP}語以上のリストを1周するともらえます。</p>` : `<p class="hint">今日のスタンプは押してあります。また明日！</p>`}
    <div class="row wrap" style="justify-content:center;margin-top:14px">
      <button class="btn" id="vdAgain">${done.pos ? "続きをやる" : "もう1周"}</button>
      <button class="btn" data-go="test">テストする</button>
      <button class="btn pri" id="vdHome">メインへ</button></div>`;
  go("viewdone");
  $("#vdAgain").onclick = () => startList(done.src);
  $("#vdHome").onclick = () => go("main", { newStamp: lap.stamped });
  if (lap.stamped) toast(`💎 +${lap.gained}`);
}
