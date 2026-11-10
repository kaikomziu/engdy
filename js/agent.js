// 専属エージェント：テストの記録から苦手な単語を見つけて、Gemini と予習する
import { $, $$, esc, miniMarkdown, toast, speak, dayKey, addDays, skel } from "./util.js";
import { S, save, weakWords, agentProgress, UNLOCK, testPool } from "./store.js";
import { fn, token, reasonText } from "./api.js";
import { onEnter } from "./router.js";
import { startList } from "./lists.js";
import { tone } from "./audio.js";

let busy = false, agTab = "chat";

onEnter("agent", render);

function render() {
  const p = agentProgress();
  const body = $("#agentBody");
  if (!p.ok) {
    body.innerHTML = `<div class="card unlock-box"><img class="ill" src="assets/ill/agent-lock.webp" alt="" loading="lazy" decoding="async"><p class="kicker">LOCKED</p><h3>🔒 まだ解放されていません</h3>
      <p>テストモードをもう少しプレイすると、あなたの苦手な単語がわかるようになり、専属エージェントが使えます。</p>
      <p style="margin-top:18px">テストの回答数　${Math.min(p.answers, UNLOCK.answers)} / ${UNLOCK.answers}問</p><div class="meter"><i style="width:${Math.min(100, p.answers / UNLOCK.answers * 100)}%"></i></div>
      <p style="margin-top:10px">テストした単語　${Math.min(p.tested, UNLOCK.words)} / ${UNLOCK.words}語</p><div class="meter"><i style="width:${Math.min(100, p.tested / UNLOCK.words * 100)}%"></i></div>
      <button class="btn pri" data-go="test" style="margin-top:18px">テストモードへ</button></div>`;
    return;
  }
  const weak = weakWords(30);
  body.innerHTML = `<div class="agent-grid">
    <div class="card"><h3 class="sec">あなたの苦手な単語</h3>
      ${weak.length ? `<ul class="weak-list">${weak.slice(0, 12).map((w) => `<li><span><b>${esc(w.w)}</b> <small class="note">${esc(w.m)}</small></span><span class="note">${w.miss}/${w.total}</span></li>`).join("")}</ul>
        <button class="btn sm" id="agReview" style="margin-top:10px">苦手な単語を閲覧する</button>`
        : `<p class="hint">まちがえた単語はまだありません。すごい！</p>`}
      <p class="hint" style="margin-top:12px">テスト ${S.test.total}問 ・ 正答率 ${Math.round(S.test.correct / S.test.total * 100)}%</p>
    </div>
    <div class="card">
      <div class="tabs" id="agTabs"><button class="tab ${agTab === "chat" ? "on" : ""}" data-t="chat">💬 相談</button><button class="tab ${agTab === "rp" ? "on" : ""}" data-t="rp">🗣️ 英会話</button><button class="tab ${agTab === "review" ? "on" : ""}" data-t="review">📈 振り返り</button></div>
      <div class="ag-pane" data-p="rp" ${agTab === "rp" ? "" : "hidden"} id="rpPane"></div>
      <div class="ag-pane" data-p="review" ${agTab === "review" ? "" : "hidden"} id="rvPane"></div>
      <div class="ag-pane" data-p="chat" ${agTab === "chat" ? "" : "hidden"}>
      <div class="agent-actions" style="margin-top:12px">
        <button class="btn" data-mode="preview">📖 苦手を予習</button>
        <button class="btn" data-mode="mnemonic">💡 覚え方のコツ</button>
        <button class="btn" data-mode="quiz">📝 確認クイズ</button>
        <button class="btn" data-mode="plan">🗓️ 今週のプラン</button>
        <button class="btn ghost sm" id="agClear">会話を消す</button>
      </div>
      <div class="chat" id="chat"></div>
      <div class="chat-input"><input class="grow" id="agIn" maxlength="1000" placeholder="質問してみよう（例：affect と effect の違いは？）"><button class="btn pri" id="agSend">送る</button></div>
      <p class="hint">${token() ? "AI（Gemini）が答えます。まちがえることもあるので、気になったら辞書でも確かめましょう。" : "専属エージェントと話すには、かるわかGAMES アカウントでログインしてください。"}</p>
      </div>
    </div></div>`;
  $("#agTabs").onclick = (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    agTab = b.dataset.t;
    $$("#agTabs .tab").forEach((x) => x.classList.toggle("on", x === b));
    $$(".ag-pane").forEach((x) => (x.hidden = x.dataset.p !== agTab));
  };
  renderRoleplay(); renderReview();
  renderChat();
  body.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => ask(b.dataset.mode, b.textContent.trim())));
  $("#agSend").onclick = () => { const v = $("#agIn").value.trim(); if (v) { $("#agIn").value = ""; ask("chat", v); } };
  $("#agIn").onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) $("#agSend").click(); };
  $("#agClear").onclick = () => { S.agent.history = []; save(); renderChat(); };
  const rv = $("#agReview"); if (rv) rv.onclick = () => startList({ title: "苦手な単語", words: weak.map((w) => ({ w: w.w, m: w.m })) });
}

function renderChat(waiting) {
  const h = S.agent.history;
  $("#chat").innerHTML = (h.length ? h.map((m) => `<div class="msg ${m.role}">${m.role === "model" ? miniMarkdown(m.text) : esc(m.label || m.text)}</div>`).join("")
    : `<div class="msg model"><p>こんにちは！ あなた専属のエージェントです。</p><p>テストの記録から、苦手な単語を見つけました。上のボタンで予習を始めるか、なんでも質問してください。</p></div>`)
    + (waiting ? skel("msg", 3) : "");
  const c = $("#chat"); c.scrollTop = c.scrollHeight;
}

async function ask(mode, text) {
  if (busy) return;
  if (!token()) { toast("ログインすると使えます"); KaAccount.login("login"); return; }
  busy = true;
  const h = S.agent.history;
  h.push({ role: "user", text: mode === "chat" ? text : `（${text}）`, label: text });
  renderChat(true);
  const weak = weakWords(30).map((w) => ({ w: w.w, m: w.m, miss: w.miss, total: w.total }));
  const summary = `テスト${S.test.total}問・正答率${Math.round(S.test.correct / S.test.total * 100)}%・見た単語${Object.values(S.words).filter((r) => r.seen).length}語`;
  const r = await fn("agent", { mode, message: text, weak, summary, history: h.slice(0, -1).slice(-10).map((m) => ({ role: m.role, text: m.text })) });
  busy = false;
  if (r.ok) h.push({ role: "model", text: r.text });
  else { h.pop(); toast(reasonText(r.reason), 3500); }
  S.agent.history = h.slice(-30);
  save(); renderChat();
}

// ================= 英会話ロールプレイ =================
const SCENES = [["self", "👋 自己紹介", "初めて会った人に自己紹介する"], ["shop", "🛍️ 買い物", "お店で服やおみやげを買う"], ["way", "🗺️ 道案内", "駅への行き方をたずねる・教える"],
  ["food", "🍔 レストラン", "ファストフード店で注文する"], ["school", "🏫 学校", "友だちと学校や部活の話をする"], ["free", "💭 自由", "好きなことについて話す"]];
let RP = null;   // { scene, label, words, used:Set, msgs:[{role,text,ja,fb}] }

function pickWords() {
  const weak = weakWords(20).map((w) => w.w).filter((w) => /^[a-z' -]+$/i.test(w));
  const pool = testPool().map((x) => x.w).filter((w) => /^[a-z' -]+$/i.test(w));
  const out = [...new Set([...weak.slice(0, 3), ...pool.sort(() => Math.random() - 0.5)])].slice(0, 5);
  return out;
}
const usedIn = (text, w) => new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text.toLowerCase());

function renderRoleplay() {
  const el = $("#rpPane"); if (!el) return;
  if (!RP) {
    el.innerHTML = `<img class="ill ill-sm" src="assets/ill/talk.webp" alt="" loading="lazy" decoding="async"><p class="hint" style="margin-top:12px">AI と英語で短い会話をします。覚えた単語を会話の中で使えたら成功です。</p>
      <div class="rp-scenes">${SCENES.map(([id, t, d]) => `<button class="rp-scene" data-sc="${id}"><b>${t}</b><small>${d}</small></button>`).join("")}</div>`;
    $$("[data-sc]", el).forEach((b) => (b.onclick = () => startRp(b.dataset.sc)));
    return;
  }
  el.innerHTML = `<div class="rp-head"><span><b>${esc(RP.label)}</b> <small class="note">使ってみよう：</small></span>
      <span class="rp-words">${RP.words.map((w) => `<span class="rp-w ${RP.used.has(w) ? "on" : ""}">${RP.used.has(w) ? "✓ " : ""}${esc(w)}</span>`).join("")}</span>
      <button class="btn sm ghost" id="rpEnd">終わる</button></div>
    <div class="chat" id="rpChat">${RP.msgs.map((m) => m.role === "user"
      ? `<div class="msg user">${esc(m.text)}</div>${m.fb ? `<div class="rp-fb">💡 ${esc(m.fb)}</div>` : ""}`
      : `<div class="msg model rp-model"><p>${esc(m.text)} <button class="rp-say" data-say="${esc(m.text)}" title="読み上げ">🔊</button></p><p class="rp-ja" hidden>${esc(m.ja)}</p><button class="link rp-jabtn">和訳</button></div>`).join("")}
      ${busy ? skel("msg", 2) : ""}</div>
    <div class="chat-input"><input class="grow" id="rpIn" maxlength="400" placeholder="英語で返事をしよう" autocapitalize="off" spellcheck="true"><button class="btn pri" id="rpSend">送る</button></div>
    <p class="hint">日本語で書いても大丈夫ですが、英語で書くと練習になります。1回の送信で AI を1回使います。</p>`;
  const c = $("#rpChat"); c.scrollTop = c.scrollHeight;
  $$(".rp-jabtn", el).forEach((b) => (b.onclick = () => { b.previousElementSibling.hidden = false; b.remove(); }));
  $$("[data-say]", el).forEach((b) => (b.onclick = () => speak(b.dataset.say, 0.95)));
  $("#rpEnd").onclick = () => { RP = null; renderRoleplay(); };
  const send = () => { const v = $("#rpIn").value.trim(); if (v) { $("#rpIn").value = ""; rpSend(v); } };
  $("#rpSend").onclick = send;
  $("#rpIn").onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) send(); };
  if (!busy) setTimeout(() => $("#rpIn") && $("#rpIn").focus(), 50);
}

async function startRp(sc) {
  if (!token()) { toast("ログインすると使えます"); KaAccount.login("login"); return; }
  const s = SCENES.find((x) => x[0] === sc);
  RP = { scene: s[2], label: s[1], words: pickWords(), used: new Set(), msgs: [] };
  busy = true; renderRoleplay();
  const r = await fn("roleplay", { scene: RP.scene, words: RP.words, history: [], message: "" });
  busy = false;
  if (!r.ok) { toast(reasonText(r.reason)); RP = null; renderRoleplay(); return; }
  RP.msgs.push({ role: "model", text: r.reply, ja: r.ja });
  renderRoleplay(); speak(r.reply, 0.95);
}
async function rpSend(text) {
  if (busy || !RP) return;
  const before = RP.used.size;
  RP.words.forEach((w) => { if (usedIn(text, w)) RP.used.add(w); });
  const msg = { role: "user", text, fb: "" };
  RP.msgs.push(msg);
  busy = true; renderRoleplay();
  const r = await fn("roleplay", { scene: RP.scene, words: RP.words, history: RP.msgs.slice(0, -1).map((m) => ({ role: m.role, text: m.text })), message: text });
  busy = false;
  if (!RP) return;
  if (!r.ok) { toast(reasonText(r.reason)); RP.msgs.pop(); renderRoleplay(); return; }
  msg.fb = r.feedback;
  RP.msgs.push({ role: "model", text: r.reply, ja: r.ja });
  renderRoleplay(); speak(r.reply, 0.95);
  if (RP.used.size > before) {
    tone(RP.used.size === RP.words.length ? "combo" : "ok");
    toast(RP.used.size === RP.words.length ? "🎉 全部の単語を使えました！" : `✓ 「${[...RP.used].pop()}」を使えました（${RP.used.size}/${RP.words.length}）`);
  }
}

// ================= 1週間の振り返りレポート =================
function renderReview() {
  const el = $("#rvPane"); if (!el) return;
  const last = S.agent.review;
  el.innerHTML = `<p class="hint" style="margin-top:12px">この1週間の学習時間・見た単語・テストの記録と苦手な単語から、AI が振り返りと来週の目標をまとめます。</p>
    <button class="btn pri" id="rvGo">${last ? "もう一度まとめる" : "振り返りレポートを作る"}</button>
    ${last ? `<div class="msg model rv-out"><p class="note">${new Date(last.at).toLocaleString("ja-JP")} に作成</p>${miniMarkdown(last.text)}</div>` : ""}`;
  $("#rvGo").onclick = makeReview;
}
async function makeReview() {
  if (!token()) { toast("ログインすると使えます"); KaAccount.login("login"); return; }
  const btn = $("#rvGo"); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> まとめています…`;
  const k = dayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(k, i - 6)).map((d) => { const x = S.stats.days[d] || {}; return `${d}: ${Math.round((x.s || 0) / 60)}分・${x.w || 0}語・テスト${x.tt || 0}問中${x.tc || 0}問正解`; });
  const summary = `直近7日:\n${days.join("\n")}\n全体: 学習時間${Math.round(S.stats.seconds / 60)}分・1周${S.stats.laps}回・テスト${S.test.total}問(正答率${S.test.total ? Math.round(S.test.correct / S.test.total * 100) : 0}%)・ベスト${S.test.best}点`;
  const weak = weakWords(20).map((w) => ({ w: w.w, m: w.m, miss: w.miss, total: w.total }));
  const r = await fn("review", { summary, weak });
  if (!r.ok) { toast(reasonText(r.reason)); btn.disabled = false; btn.textContent = "振り返りレポートを作る"; return; }
  S.agent.review = { at: Date.now(), text: r.text }; save();
  renderReview();
}
