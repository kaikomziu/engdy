// 専属エージェント：テストの記録から苦手な単語を見つけて、Gemini と予習する
import { $, esc, miniMarkdown, toast } from "./util.js";
import { S, save, weakWords, agentProgress, UNLOCK } from "./store.js";
import { fn, token, reasonText } from "./api.js";
import { onEnter } from "./router.js";
import { startList } from "./lists.js";

let busy = false;

onEnter("agent", render);

function render() {
  const p = agentProgress();
  const body = $("#agentBody");
  if (!p.ok) {
    body.innerHTML = `<div class="card unlock-box"><p class="kicker">LOCKED</p><h3>🔒 まだ解放されていません</h3>
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
      <div class="agent-actions">
        <button class="btn" data-mode="preview">📖 苦手を予習</button>
        <button class="btn" data-mode="mnemonic">💡 覚え方のコツ</button>
        <button class="btn" data-mode="quiz">📝 確認クイズ</button>
        <button class="btn" data-mode="plan">🗓️ 今週のプラン</button>
        <button class="btn ghost sm" id="agClear">会話を消す</button>
      </div>
      <div class="chat" id="chat"></div>
      <div class="chat-input"><input class="grow" id="agIn" maxlength="1000" placeholder="質問してみよう（例：affect と effect の違いは？）"><button class="btn pri" id="agSend">送る</button></div>
      <p class="hint">${token() ? "AI（Gemini）が答えます。まちがえることもあるので、気になったら辞書でも確かめましょう。" : "専属エージェントと話すには、かるわかGAMES アカウントでログインしてください。"}</p>
    </div></div>`;
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
    + (waiting ? `<div class="msg model wait"><span class="spinner"></span> 考えています…</div>` : "");
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
