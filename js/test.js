// テストモード：閲覧で見た単語から4択。苦手な単語ほど出やすい
import { $, $$, esc, shuffle, speak } from "./util.js";
import { S, save, today, testPool, agentProgress, UNLOCK } from "./store.js";
import { go, onEnter, onLeave } from "./router.js";
import { tone } from "./audio.js";
import { startList } from "./lists.js";

const Q_TIME = 12;            // 1問の制限時間（秒）
let T = null, opt = { n: 10, dir: "en" };

onEnter("test", renderStart);
onLeave("test", () => { if (T) { clearInterval(T.timer); T = null; } });

function renderStart() {
  const pool = testPool();
  const p = agentProgress();
  if (pool.length < 4) {
    $("#testBody").innerHTML = `<div class="card t-start"><p class="kicker">NOT YET</p><h3>まだテストできません</h3>
      <p>テストには、閲覧で見た（意味のある）単語が4つ以上必要です。<br>いま：${pool.length}語</p>
      <button class="btn pri" data-go="browse">閲覧へ</button></div>`;
    return;
  }
  $("#testBody").innerHTML = `<div class="card t-start"><p class="kicker">READY</p><h3>テストを始める</h3>
    <p class="hint">閲覧で見た ${pool.length}語 から出題します。間違えた単語ほど、よく出ます。</p>
    <div class="t-opts">
      <div class="seg" id="optN">${[10, 20, 30].map((n) => `<button data-n="${n}" class="${opt.n === n ? "on" : ""}">${n}問</button>`).join("")}</div>
      <div class="seg" id="optDir"><button data-d="en" class="${opt.dir === "en" ? "on" : ""}">英語 → 意味</button><button data-d="ja" class="${opt.dir === "ja" ? "on" : ""}">意味 → 英語</button></div>
    </div>
    <button class="btn pri big" style="max-width:280px" id="tGo">スタート</button>
    <p class="hint" style="margin-top:16px">これまで：${S.test.total}問 ・ 正答率 ${S.test.total ? Math.round(S.test.correct / S.test.total * 100) : 0}% ・ ベスト ${S.test.best}点</p>
    ${p.ok ? "" : `<p class="hint">専属エージェントの解放まで：あと ${Math.max(0, UNLOCK.answers - p.answers)}問・${Math.max(0, UNLOCK.words - p.tested)}語</p>`}
  </div>`;
  $("#optN").onclick = (e) => { const b = e.target.closest("[data-n]"); if (b) { opt.n = +b.dataset.n; renderStart(); } };
  $("#optDir").onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) { opt.dir = b.dataset.d; renderStart(); } };
  $("#tGo").onclick = () => start(pool);
}

// 重み付きで出題する単語を選ぶ
function pickQuestions(pool, n) {
  const w = pool.map((x) => ({ x, wt: Math.max(0.4, 1 + x.ng * 2.5 - x.ok * 0.4 + (x.ok + x.ng === 0 ? 1.5 : 0)) }));
  const out = [];
  while (out.length < n && w.length) {
    const sum = w.reduce((a, b) => a + b.wt, 0);
    let r = Math.random() * sum, i = 0;
    while (r > w[i].wt && i < w.length - 1) { r -= w[i].wt; i++; }
    out.push(w[i].x); w.splice(i, 1);
  }
  // 単語が少ないときは、もう一度まぜて足す
  while (out.length < n) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}

function start(pool) {
  T = { pool, qs: pickQuestions(pool, opt.n), i: 0, score: 0, combo: 0, maxCombo: 0, correct: 0, wrong: [], dir: opt.dir, timer: 0, t0: 0, answered: false };
  tone("click");
  showQ();
}

function showQ() {
  const q = T.qs[T.i];
  const key = T.dir === "en" ? "m" : "w";
  const right = q[key];
  const others = shuffle(T.pool.filter((x) => x[key] && x[key] !== right && x.w !== q.w)).slice(0, 3).map((x) => x[key]);
  const choices = shuffle([right, ...others]);
  T.answered = false; T.right = right; T.t0 = performance.now();
  $("#testBody").innerHTML = `<div class="card">
    <div class="q-head"><span>Q${T.i + 1} / ${T.qs.length}</span><span>${T.combo >= 2 ? `🔥 ${T.combo}連続` : ""}</span><span>${T.score}点</span></div>
    <div class="q-word ${T.dir === "ja" ? "ja" : ""}">${esc(T.dir === "en" ? q.w : q.m)}</div>
    ${T.dir === "en" ? `<div style="text-align:center"><button class="btn sm ghost" id="qSpeak">🔊 発音</button></div>` : ""}
    <div class="q-time"><i id="qTime"></i></div>
    <div class="choices">${choices.map((c, i) => `<button class="choice ${T.dir === "ja" ? "en" : ""}" data-c="${esc(c)}"><span class="k">${i + 1}</span><span>${esc(c)}</span></button>`).join("")}</div>
  </div>`;
  const sp = $("#qSpeak"); if (sp) sp.onclick = () => speak(q.w);
  if (T.dir === "en" && S.settings.autoSpeak) speak(q.w);
  $$(".choice").forEach((b) => (b.onclick = () => answer(b)));
  clearInterval(T.timer);
  T.timer = setInterval(() => {
    const left = Q_TIME - (performance.now() - T.t0) / 1000;
    const bar = $("#qTime"); if (bar) bar.style.width = `${Math.max(0, left / Q_TIME) * 100}%`;
    if (left <= 0) answer(null);
  }, 100);
}

document.addEventListener("keydown", (e) => {
  if (!T || !document.querySelector("#s-test.active")) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4) { const b = $$(".choice")[n - 1]; if (b) answer(b); }
});

function answer(btn) {
  if (!T || T.answered) return;
  T.answered = true; clearInterval(T.timer);
  const q = T.qs[T.i];
  const ok = btn && btn.dataset.c === T.right;
  const left = Math.max(0, Q_TIME - (performance.now() - T.t0) / 1000);
  $$(".choice").forEach((b) => { if (b.dataset.c === T.right) b.classList.add("ok"); });
  const r = S.words[q.w];
  if (ok) {
    T.combo++; T.maxCombo = Math.max(T.maxCombo, T.combo); T.correct++;
    const pts = 100 + Math.round(left * 8) + Math.min(10, T.combo - 1) * 20;
    T.score += pts;
    if (r) r.ok++;
    tone(T.combo >= 3 ? "combo" : "ok");
    pop(`+${pts}`);
  } else {
    if (btn) btn.classList.add("ng");
    T.combo = 0;
    if (r) { r.ng++; r.lastNg = Date.now(); }
    T.wrong.push(q);
    tone("ng");
  }
  S.test.total++; if (ok) S.test.correct++;
  const t = today(); t.tt++; if (ok) t.tc++;
  save();
  setTimeout(() => { if (!T) return; T.i++; if (T.i >= T.qs.length) finish(); else showQ(); }, ok ? 650 : 1400);
}

function pop(text) {
  const d = document.createElement("div"); d.className = "score-pop"; d.textContent = text;
  document.body.appendChild(d); setTimeout(() => d.remove(), 800);
}

function finish() {
  const best = T.score > S.test.best;
  S.test.rounds++; if (best) S.test.best = T.score;
  save(true);
  const rate = Math.round((T.correct / T.qs.length) * 100);
  const uniqWrong = [...new Map(T.wrong.map((x) => [x.w, x])).values()];
  const p = agentProgress();
  $("#testBody").innerHTML = `<div class="card t-start"><p class="kicker">RESULT</p>
    <h3>${T.score}点 ${best ? `<span class="badge">ベスト更新</span>` : ""}</h3>
    <div class="done-stats"><div><small>正解</small><b>${T.correct} / ${T.qs.length}</b></div><div><small>正答率</small><b>${rate}%</b></div><div><small>最大コンボ</small><b>${T.maxCombo}</b></div></div>
    ${uniqWrong.length ? `<h3 class="sec" style="text-align:left">まちがえた単語</h3><table class="wtable">${uniqWrong.map((x) => `<tr><td>${esc(x.w)}</td><td>${esc(x.m)}</td></tr>`).join("")}</table>` : `<div class="gain">全問正解！ 🎉</div>`}
    ${p.ok ? `<p class="hint">専属エージェントで、苦手な単語を予習できます。</p>` : ""}
    <div class="row wrap" style="justify-content:center;margin-top:16px">
      ${uniqWrong.length ? `<button class="btn" id="tReview">まちがえた単語を閲覧</button>` : ""}
      <button class="btn" id="tAgain">もう一度</button>
      <button class="btn pri" data-go="main">メインへ</button></div></div>`;
  const rv = $("#tReview"); if (rv) rv.onclick = () => startList({ title: "テストの復習", words: uniqWrong.map((x) => ({ w: x.w, m: x.m })) });
  $("#tAgain").onclick = renderStart;
  T = null;
}
