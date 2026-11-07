// テストモード：閲覧で見た単語から4択。苦手な単語ほど出やすい
import { $, $$, esc, shuffle, speak } from "./util.js";
import { S, save, today, testPool, agentProgress, UNLOCK } from "./store.js";
import { go, onEnter, onLeave } from "./router.js";
import { tone } from "./audio.js";
import { startList } from "./lists.js";
import { fn, token, reasonText } from "./api.js";
import { toast } from "./util.js";

const Q_TIME = 12, TYPE_TIME = 30, CLOZE_TIME = 25;   // 1問の制限時間（秒）。書き取り・穴埋めは長め
let T = null;
const opt = { get n() { return S.settings.testN || 10; }, set n(v) { S.settings.testN = v; save(); }, get dir() { return S.settings.testDir || "en"; }, set dir(v) { S.settings.testDir = v; save(); } };

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
      <div class="seg" id="optDir"><button data-d="en" class="${opt.dir === "en" ? "on" : ""}">英語 → 意味</button><button data-d="ja" class="${opt.dir === "ja" ? "on" : ""}">意味 → 英語</button><button data-d="type" class="${opt.dir === "type" ? "on" : ""}">✏️ 書き取り</button><button data-d="cloze" class="${opt.dir === "cloze" ? "on" : ""}">🧩 穴埋め（AI）</button></div>
    </div>
    ${opt.dir === "cloze" ? `<p class="hint">AI が、苦手な単語を使った英文の穴埋め問題を作ります（最大10問・ログインが必要）。</p>` : ""}
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

async function start(pool) {
  if (opt.dir === "cloze") { await startCloze(pool); return; }
  T = { pool, qs: pickQuestions(pool, opt.n), i: 0, score: 0, combo: 0, maxCombo: 0, correct: 0, wrong: [], dir: opt.dir, timer: 0, t0: 0, answered: false };
  tone("click");
  showQ();
}

// ---- 穴埋め（AI が英文を作る） ----
async function startCloze(pool) {
  if (!token()) { toast("穴埋め（AI）は、ログインすると使えます"); KaAccount.login("login"); return; }
  const picks = pickQuestions(pool, Math.min(10, opt.n));
  $("#testBody").innerHTML = `<div class="card t-start"><p class="kicker">AI</p><h3><span class="spinner"></span> 問題を作っています…</h3><p class="hint">10秒ほどかかることがあります。</p></div>`;
  const r = await fn("cloze", { items: [...new Map(picks.map((x) => [x.w, { w: x.w, m: x.m }])).values()] });
  if (!document.querySelector("#s-test.active")) return;
  if (!r.ok || !r.items.length) { toast(reasonText(r.ok ? "parse" : r.reason), 3500); renderStart(); return; }
  const byWord = new Map(pool.map((x) => [x.w.toLowerCase(), x]));
  const qs = r.items.map((it) => { const base = byWord.get(String(it.word).toLowerCase()) || { w: it.word, m: "" }; return { ...base, sentence: it.sentence, ja: it.ja, answer: it.answer || base.w }; });
  T = { pool, qs, i: 0, score: 0, combo: 0, maxCombo: 0, correct: 0, wrong: [], dir: "cloze", timer: 0, t0: 0, answered: false };
  tone("click");
  showQ();
}
function showCloze(q) {
  const others = shuffle(T.qs.filter((x) => x.answer.toLowerCase() !== q.answer.toLowerCase()).map((x) => x.answer)
    .concat(shuffle(T.pool.map((x) => x.w)).slice(0, 12))).filter((v, i, a) => a.indexOf(v) === i && v.toLowerCase() !== q.answer.toLowerCase()).slice(0, 3);
  const choices = shuffle([q.answer, ...others]);
  T.answered = false; T.right = q.answer; T.t0 = performance.now();
  const sent = esc(q.sentence).replace("___", `<span class="blank">　？　</span>`);
  $("#testBody").innerHTML = `<div class="card">
    <div class="q-head"><span>Q${T.i + 1} / ${T.qs.length}</span><span>${T.combo >= 2 ? `🔥 ${T.combo}連続` : ""}</span><span>${T.score}点</span></div>
    <div class="cloze-sent">${sent}</div>
    <div style="text-align:center"><button class="btn sm ghost" id="clJa">和訳を見る</button></div>
    <p class="cloze-ja" id="clJaText" hidden>${esc(q.ja)}</p>
    <div class="q-time"><i id="qTime"></i></div>
    <div class="choices">${choices.map((c, i) => `<button class="choice en" data-c="${esc(c)}"><span class="k">${i + 1}</span><span>${esc(c)}</span></button>`).join("")}</div>
  </div>`;
  $("#clJa").onclick = () => { $("#clJaText").hidden = false; $("#clJa").hidden = true; };
  $$(".choice").forEach((b) => (b.onclick = () => answer(b)));
}

// ---- 書き取りの「おしい！」判定（1〜2文字だけ違うとき、どこが違うか見せる） ----
function editOps(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  // 正解（b）の文字ごとに、合っていたか・違ったか・抜けていたか
  const out = []; let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { out.unshift({ c: b[j - 1], ok: a[i - 1] === b[j - 1] }); i--; j--; }
    else if (j > 0 && d[i][j] === d[i][j - 1] + 1) { out.unshift({ c: b[j - 1], ok: false, miss: true }); j--; }
    else { i--; }   // 余分に打った文字
  }
  return { dist: d[m][n], ops: out };
}

// 書き取りの答え合わせ用（大文字小文字・空白・記号の違いは無視）
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]/g, "").replace(/\s+/g, " ").trim();
const qTime = () => (T.dir === "type" ? TYPE_TIME : T.dir === "cloze" ? CLOZE_TIME : Q_TIME);

function showTyping(q) {
  T.answered = false; T.right = q.w; T.t0 = performance.now();
  const hint = q.w.split(" ").map((p) => p[0] + "＿".repeat(Math.max(0, p.length - 1))).join("　");
  $("#testBody").innerHTML = `<div class="card">
    <div class="q-head"><span>Q${T.i + 1} / ${T.qs.length}</span><span>${T.combo >= 2 ? `🔥 ${T.combo}連続` : ""}</span><span>${T.score}点</span></div>
    <div class="q-word ja">${esc(q.m)}</div>
    <p class="type-hint">${esc(hint)}（${q.w.replace(/ /g, "").length}文字）</p>
    <div class="q-time"><i id="qTime"></i></div>
    <div class="type-row"><input id="tIn" class="grow" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="英語で入力して Enter"><button class="btn pri" id="tOk">答える</button></div>
    <div style="text-align:center;margin-top:10px"><button class="btn sm ghost" id="tSkip">わからない</button></div>
    <p class="type-res" id="tRes"></p>
  </div>`;
  const inp = $("#tIn"); inp.focus();
  inp.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) answer(null, inp.value); };
  $("#tOk").onclick = () => answer(null, inp.value);
  $("#tSkip").onclick = () => answer(null, "");
}

function showQ() {
  const q = T.qs[T.i];
  if (T.dir === "type") { showTyping(q); startTimer(); return; }
  if (T.dir === "cloze") { showCloze(q); startTimer(); return; }
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
  startTimer();
}
function startTimer() {
  clearInterval(T.timer);
  T.timer = setInterval(() => {
    const left = qTime() - (performance.now() - T.t0) / 1000;
    const bar = $("#qTime"); if (bar) bar.style.width = `${Math.max(0, left / qTime()) * 100}%`;
    if (left <= 0) answer(null, T.dir === "type" ? ($("#tIn") || {}).value || "" : undefined);
  }, 100);
}

document.addEventListener("keydown", (e) => {
  if (!T || !document.querySelector("#s-test.active") || T.dir === "type") return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4) { const b = $$(".choice")[n - 1]; if (b) answer(b); }
});

function answer(btn, typed) {
  if (!T || T.answered) return;
  T.answered = true; clearInterval(T.timer);
  const q = T.qs[T.i];
  const ok = typed !== undefined ? !!typed && norm(typed) === norm(q.w) : !!btn && btn.dataset.c === T.right;
  const left = Math.max(0, qTime() - (performance.now() - T.t0) / 1000);
  $$(".choice").forEach((b) => { if (b.dataset.c === T.right) b.classList.add("ok"); });
  if (typed !== undefined) {
    const inp = $("#tIn"); if (inp) { inp.disabled = true; inp.classList.add(ok ? "ok" : "ng"); }
    const e = !ok && typed ? editOps(norm(typed), norm(q.w)) : null;
    const L = norm(q.w).length, near = e && e.dist <= (L <= 4 ? 1 : L <= 9 ? 2 : 3) && e.dist < L / 2;   // 長い語ほど、少しの打ちまちがいを許す
    $("#tRes").innerHTML = ok ? "⭕ 正解！"
      : near ? `🤏 おしい！ あと少し<br><span class="spell">${e.ops.map((o) => `<span class="${o.ok ? "" : o.miss ? "miss" : "bad"}">${esc(o.c === " " ? "␣" : o.c)}</span>`).join("")}</span><br><small class="note">赤い文字がちがうところです</small>`
      : `❌ 正解は <b>${esc(q.w)}</b>`;
    speak(q.w);
  }
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
  // 穴埋めは、答えたあとに完成した英文を見せる
  if (T.dir === "cloze") { const el = $(".cloze-sent"); if (el) el.innerHTML = esc(q.sentence).replace("___", `<b class="blank-ans">${esc(q.answer)}</b>`); speak(q.sentence.replace("___", q.answer)); }
  setTimeout(() => { if (!T) return; T.i++; if (T.i >= T.qs.length) finish(); else showQ(); }, typed !== undefined ? (ok ? 900 : 2600) : T.dir === "cloze" ? (ok ? 1500 : 2600) : ok ? 650 : 1400);
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
