// 掲示板：勉強している人どうしで話せる場所。読むのはだれでも、書くのはログインした人だけ
// 入る前にルールへの同意が必要。個人情報・リンク・ひどい言葉はサーバーではじき、3人に通報されると自動で隠れる
import { $, $$, esc, toast, modal, confirmBox } from "./util.js";
import { S, save } from "./store.js";
import { rpc, token, me, reasonText } from "./api.js";
import { go, onEnter } from "./router.js";
import { tone } from "./audio.js";
import { openShared } from "./lists.js";

const RULES_V = 1;   // ルールを変えたら上げる（もう一度同意してもらう）
export const CATS = [["chat", "💬", "雑談"], ["question", "❓", "質問"], ["report", "📖", "勉強報告"], ["list", "📝", "リスト紹介"], ["goal", "🎯", "目標宣言"]];
const catOf = (c) => CATS.find((x) => x[0] === c) || CATS[0];
const REASONS = ["悪口・いじめ", "個人情報", "宣伝・スパム", "勉強と関係ない", "その他"];
let cat = "", posts = [], openId = null, loading = false;

const ago = (t) => {
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return "たった今";
  if (s < 3600) return Math.floor(s / 60) + "分前";
  if (s < 86400) return Math.floor(s / 3600) + "時間前";
  if (s < 86400 * 7) return Math.floor(s / 86400) + "日前";
  return new Date(t).toLocaleDateString("ja-JP");
};
const bodyHtml = (b) => esc(b).replace(/\n/g, "<br>").replace(/(https:\/\/kaikomziu\.github\.io\/[^\s<]*)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

// ================= ルール（入る前に同意） =================
const RULES = `<ol class="rules">
  <li><b>やさしく話そう</b><span>悪口・からかい・いじめ・荒らしはしません。相手の気持ちを考えて書こう。</span></li>
  <li><b>個人情報は書かない</b><span>本名・学校名・住所・電話番号・メールアドレス・SNS や LINE の ID は、自分のも人のも書きません。会う約束もしません。</span></li>
  <li><b>勉強に関係あることを</b><span>英語の質問・勉強の報告・目標・おすすめの単語リストなど。関係ない宣伝やスパムは書きません。</span></li>
  <li><b>ほかのサイトのリンクは貼れません</b><span>Engdy のリスト（共有 URL）だけ貼れます。</span></li>
  <li><b>同じことを何度も書かない</b><span>連続投稿はできません（投稿は30秒に1回、1日10件まで）。</span></li>
  <li><b>困ったら「通報」</b><span>いやな書き込みを見つけたら、⋯ から通報してください。3人から通報されると自動で見えなくなり、管理者が確認します。</span></li>
</ol>
<p class="hint">ルールを守らない書き込みは、予告なく消したり、書き込みできなくしたりすることがあります。</p>`;

async function needRules() {
  if (S.boardRules === RULES_V) return true;
  const ok = await modal(`<img class="ill" src="assets/ill/board-rules.webp" alt="" loading="lazy" decoding="async"><p class="kicker">BOARD RULES</p><h3>📌 掲示板のルール</h3>
    <p>みんなが気持ちよく使えるように、次のルールを守ってください。</p>${RULES}
    <label class="radio"><input type="checkbox" id="rlAgree"><span><b>ルールを読んで、守ることに同意します</b></span></label>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>同意しない</button><button class="btn pri" id="rlOk" disabled>同意して入る</button></div>`,
    (c, close) => {
      const cb = c.querySelector("#rlAgree"), okb = c.querySelector("#rlOk");
      cb.onchange = () => (okb.disabled = !cb.checked);
      okb.onclick = () => close(true);
    });
  if (!ok) return false;
  S.boardRules = RULES_V; save();
  return true;
}
export const showRules = () => modal(`<p class="kicker">BOARD RULES</p><h3>📌 掲示板のルール</h3>${RULES}<div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>OK</button></div>`);

// ================= 画面 =================
onEnter("board", async (arg) => {
  $("#boardBody").innerHTML = "";
  if (!(await needRules())) { go("main"); return; }
  openId = null;
  renderShell();
  await load(true);
  if (arg && arg.compose) compose(arg.compose);
});

function renderShell() {
  $("#boardBody").innerHTML = `<div class="board-top">
      <div class="tabs" id="bdCats"><button class="tab ${cat === "" ? "on" : ""}" data-c="">すべて</button>${CATS.map(([k, ic, t]) => `<button class="tab ${cat === k ? "on" : ""}" data-c="${k}">${ic} ${t}</button>`).join("")}</div>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <span class="row"><button class="btn sm ghost" id="bdReload">↻ 更新</button><button class="btn sm ghost" id="bdRules">📌 ルール</button></span>
        <button class="btn pri" id="bdNew">＋ 投稿する</button></div>
    </div>
    <div id="bdList" class="bd-list"></div>
    <div id="bdMore"></div>`;
  $("#bdCats").onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return; cat = b.dataset.c; $$("#bdCats .tab").forEach((x) => x.classList.toggle("on", x === b)); load(true); };
  $("#bdReload").onclick = () => load(true);
  $("#bdRules").onclick = showRules;
  $("#bdNew").onclick = () => compose();
}

async function load(reset) {
  if (loading) return; loading = true;
  if (reset) { posts = []; $("#bdList").innerHTML = `<p class="empty"><span class="spinner"></span></p>`; }
  const before = !reset && posts.length ? posts[posts.length - 1].created_at : null;
  const r = await rpc("engdy_board_list", { p_cat: cat || null, p_before: before, p_token: token() }).catch(() => null);
  loading = false;
  if (!r || !r.ok) { $("#bdList").innerHTML = `<p class="empty">${esc(reasonText(r && r.reason))}</p>`; return; }
  posts = reset ? r.posts : posts.concat(r.posts);
  renderList();
  $("#bdMore").innerHTML = r.posts.length >= 30 ? `<div style="text-align:center"><button class="btn" id="bdMoreB">もっと見る</button></div>` : "";
  const mb = $("#bdMoreB"); if (mb) mb.onclick = () => load(false);
}

function postCard(p, detail) {
  const [, ic, t] = catOf(p.cat);
  return `<article class="bd-post ${p.hidden ? "is-hidden" : ""}" data-id="${p.id}">
    <div class="bd-head"><span class="bd-av">${esc(p.avatar || "👤")}</span><b>${esc(p.name)}</b><span class="badge">${ic} ${t}</span><span class="note">${ago(p.created_at)}</span>
      <button class="bd-menu link" data-menu="post" data-id="${p.id}" data-mine="${p.mine ? 1 : 0}" title="メニュー">⋯</button></div>
    ${p.hidden ? `<p class="note">⚠️ 通報が多いため、ほかの人には見えなくなっています</p>` : ""}
    <div class="bd-body">${bodyHtml(p.body)}</div>
    ${p.list_code ? `<button class="btn sm bd-list-btn" data-code="${esc(p.list_code)}">📝 このリストを見る</button>` : ""}
    <div class="bd-foot"><button class="bd-like ${p.liked ? "on" : ""}" data-like="${p.id}">${p.liked ? "❤️" : "🤍"} <span>${p.likes}</span></button>
      ${detail ? "" : `<button class="bd-open link" data-open="${p.id}">💬 ${p.replies ? p.replies + "件の返信" : "返信する"}</button>`}</div>
  </article>`;
}

function renderList() {
  const el = $("#bdList");
  el.innerHTML = posts.length ? posts.map((p) => postCard(p, false)).join("") : `<p class="empty">まだ投稿がありません。最初の1つを書いてみよう！</p>`;
  bindCards(el);
}

function bindCards(el) {
  $$("[data-like]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); like(b); }));
  $$("[data-open]", el).forEach((b) => (b.onclick = () => openPost(b.dataset.open)));
  $$(".bd-body", el).forEach((b) => { if (!openId) b.onclick = () => openPost(b.closest(".bd-post").dataset.id); });
  $$("[data-code]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openShared(b.dataset.code); }));
  $$("[data-menu]", el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); menu(b.dataset.menu, b.dataset.id, b.dataset.mine === "1"); }));
}

// ================= 1つの投稿（返信つき） =================
async function openPost(id) {
  openId = id;
  $("#boardBody").innerHTML = `<button class="btn sm ghost" id="bdBack">← 一覧へ</button><div id="bdDetail"><p class="empty"><span class="spinner"></span></p></div>`;
  $("#bdBack").onclick = () => { openId = null; renderShell(); renderList(); };
  scrollTo(0, 0);
  const r = await rpc("engdy_board_get", { p_id: id, p_token: token() }).catch(() => null);
  if (openId !== id) return;
  if (!r || !r.ok) { $("#bdDetail").innerHTML = `<p class="empty">${esc(reasonText(r && r.reason))}</p>`; return; }
  $("#bdDetail").innerHTML = postCard(r.post, true) + `<h3 class="sec" style="margin:14px 4px 8px">返信 ${r.replies.length}件</h3>
    <div class="bd-replies">${r.replies.map((x) => `<div class="bd-reply ${x.hidden ? "is-hidden" : ""}"><div class="bd-head"><span class="bd-av">${esc(x.avatar || "👤")}</span><b>${esc(x.name)}</b><span class="note">${ago(x.created_at)}</span>
      <button class="bd-menu link" data-menu="reply" data-id="${x.id}" data-mine="${x.mine ? 1 : 0}">⋯</button></div>${x.hidden ? `<p class="note">⚠️ 見えなくなっている返信です</p>` : ""}<div class="bd-body">${bodyHtml(x.body)}</div></div>`).join("") || `<p class="note" style="padding:0 6px">まだ返信はありません。</p>`}</div>
    ${token() ? `<div class="bd-replybox"><textarea id="bdReply" rows="3" maxlength="300" placeholder="返信を書く（300文字まで）"></textarea>
      <div class="row" style="justify-content:space-between"><span class="note" id="bdReplyN">0 / 300</span><button class="btn pri" id="bdReplyGo">返信する</button></div></div>`
      : `<div class="bd-replybox"><p class="note">返信するには、ログインしてください。</p><button class="btn sm pri" id="bdLogin">ログイン</button></div>`}`;
  bindCards($("#bdDetail"));
  const lg = $("#bdLogin"); if (lg) lg.onclick = () => KaAccount.login("login");
  const ta = $("#bdReply");
  if (ta) {
    ta.oninput = () => ($("#bdReplyN").textContent = `${ta.value.length} / 300`);
    $("#bdReplyGo").onclick = async () => {
      const b = $("#bdReplyGo"); b.disabled = true;
      const x = await rpc("engdy_board_reply", { p_token: token(), p_post: id, p_body: ta.value }).catch(() => null);
      b.disabled = false;
      if (!x || !x.ok) { toast(boardReason(x && x.reason), 3500); return; }
      tone("ok"); toast("返信しました"); openPost(id);
    };
  }
}

// ================= 投稿する =================
export async function compose(pre = {}) {
  if (!token()) { toast("投稿するには、ログインしてください"); KaAccount.login("login"); return; }
  if (!(await needRules())) return;
  const res = await modal(`<p class="kicker">NEW POST</p><h3>投稿する</h3>
    <div class="field"><span>カテゴリ</span><div class="seg wrap-seg" id="cpCat">${CATS.map(([k, ic, t]) => `<button data-c="${k}" class="${(pre.cat || "chat") === k ? "on" : ""}">${ic} ${t}</button>`).join("")}</div></div>
    <label class="field"><span>本文（500文字まで）</span><textarea id="cpBody" rows="6" maxlength="500" placeholder="例：今日は中学英単語を20語覚えた！ 明日はテストに挑戦します">${esc(pre.body || "")}</textarea></label>
    <p class="note" id="cpN">0 / 500</p>
    <label class="field" id="cpListRow" ${(pre.cat || "chat") === "list" ? "" : "hidden"}><span>紹介するリストの共有コード（公開したリストのコード、または共有 URL）</span><input id="cpList" placeholder="例：LyneeewZSahe" value="${esc(pre.code || "")}"></label>
    <p class="hint">⚠️ 個人情報（本名・学校・住所・電話・メール・SNS の ID）は書かないでください。</p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>やめる</button><button class="btn pri" id="cpGo">投稿する</button></div>`,
    (c, close) => {
      const ta = c.querySelector("#cpBody"), n = c.querySelector("#cpN");
      const upd = () => (n.textContent = `${ta.value.length} / 500`); upd(); ta.oninput = upd;
      c.querySelector("#cpCat").onclick = (e) => {
        const b = e.target.closest("[data-c]"); if (!b) return;
        c.querySelectorAll("#cpCat button").forEach((x) => x.classList.toggle("on", x === b));
        c.querySelector("#cpListRow").hidden = b.dataset.c !== "list";
      };
      c.querySelector("#cpGo").onclick = () => {
        let code = c.querySelector("#cpList").value.trim();
        try { const u = new URL(code); code = u.searchParams.get("list") || code; } catch (e) {}
        close({ cat: c.querySelector("#cpCat .on").dataset.c, body: ta.value, code });
      };
      setTimeout(() => ta.focus(), 50);
    });
  if (!res) return;
  const r = await rpc("engdy_board_post", { p_token: token(), p_cat: res.cat, p_body: res.body, p_list_code: res.cat === "list" ? res.code || null : null }).catch(() => null);
  if (!r || !r.ok) { toast(boardReason(r && r.reason), 4000); if (r && ["personal", "link", "ng", "long", "list_code"].includes(r.reason)) compose(res); return; }
  tone("ok"); toast("投稿しました");
  if (document.querySelector("#s-board.active")) { cat = ""; openId = null; renderShell(); load(true); } else go("board");
}

// ================= いいね・メニュー（通報・削除） =================
async function like(b) {
  if (!token()) { toast("いいねするには、ログインしてください"); return; }
  const r = await rpc("engdy_board_like", { p_token: token(), p_post: b.dataset.like }).catch(() => null);
  if (!r || !r.ok) return;
  b.classList.toggle("on", r.liked); b.innerHTML = `${r.liked ? "❤️" : "🤍"} <span>${r.likes}</span>`;
  const p = posts.find((x) => x.id === b.dataset.like); if (p) { p.liked = r.liked; p.likes = r.likes; }
  if (r.liked) tone("click");
}

async function menu(kind, id, mine) {
  const admin = me() && me().is_admin;
  const act = await modal(`<p class="kicker">MENU</p><h3>${kind === "post" ? "投稿" : "返信"}のメニュー</h3>
    <div class="adm-grid">${mine || admin ? `<button class="btn danger" data-a="del">🗑️ 削除する</button>` : ""}
      ${!mine ? `<button class="btn" data-a="report">🚩 通報する</button>` : ""}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>閉じる</button></div>`,
    (c, close) => c.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => close(b.dataset.a))));
  if (!act) return;
  if (act === "del") {
    if (!(await confirmBox("削除しますか？", "元に戻せません。", "削除する", true))) return;
    const r = await rpc("engdy_board_delete", { p_token: token(), p_kind: kind, p_id: id }).catch(() => null);
    if (!r || !r.ok) { toast(boardReason(r && r.reason)); return; }
    toast("削除しました");
    if (kind === "post") { posts = posts.filter((x) => x.id !== id); openId = null; renderShell(); renderList(); } else openPost(openId);
  }
  if (act === "report") {
    if (!token()) { toast("通報するには、ログインしてください"); return; }
    const reason = await modal(`<p class="kicker">REPORT</p><h3>🚩 通報する</h3><p class="hint">理由を選んでください。だれが通報したかは、書いた人にはわかりません。</p>
      <div class="adm-grid">${REASONS.map((x) => `<button class="btn" data-r="${x}">${x}</button>`).join("")}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>やめる</button></div>`,
      (c, close) => c.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => close(b.dataset.r))));
    if (!reason) return;
    const r = await rpc("engdy_board_report", { p_token: token(), p_kind: kind, p_id: id, p_reason: reason }).catch(() => null);
    toast(r && r.ok ? "通報しました。ありがとうございます" : boardReason(r && r.reason));
  }
}

export function boardReason(r) {
  const map = {
    personal: "個人情報（メール・電話・SNS の ID など）は書けません", link: "ほかのサイトのリンクは貼れません（Engdy の URL だけ貼れます）",
    ng: "人を傷つける言葉は書けません", long: "長すぎます", empty: "本文を書いてください", too_fast: "少し待ってから書いてください",
    limit: "今日はこれ以上書けません", banned: "書き込みが制限されています", list_code: "その共有コードのリストが見つかりません", cat: "カテゴリを選んでください",
  };
  return map[r] || reasonText(r);
}

// ================= 管理者：通報の確認 =================
export async function renderBoardAdmin(el) {
  const r = await rpc("engdy_board_admin_list", { p_token: token() }).catch(() => null);
  if (!r || !r.ok) { el.innerHTML = `<p class="note">${esc(reasonText(r && r.reason))}</p>`; return; }
  el.innerHTML = r.items.length ? r.items.map((x) => `<div class="bd-adm ${x.hidden ? "is-hidden" : ""}">
      <p class="note">${x.kind === "post" ? "投稿" : "返信"} ・ ${esc(x.name)} ・ ${ago(x.created_at)} ・ 通報 ${x.n}件${x.reasons ? "（" + esc(x.reasons) + "）" : ""}${x.hidden ? " ・ 非表示中" : ""}${x.banned ? " ・ 書き込み禁止中" : ""}</p>
      <p>${bodyHtml(x.body)}</p>
      <div class="row wrap"><button class="btn sm" data-ba="show" data-k="${x.kind}" data-i="${x.id}">問題なし（表示に戻す）</button>
        <button class="btn sm" data-ba="hide" data-k="${x.kind}" data-i="${x.id}">隠す</button>
        <button class="btn sm danger" data-bd="${x.kind}" data-i="${x.id}">削除</button>
        <button class="btn sm danger ghost" data-ba="${x.banned ? "unban" : "ban"}" data-k="${x.kind}" data-i="${x.id}">${x.banned ? "書き込み禁止をとく" : "この人を書き込み禁止"}</button></div></div>`).join("")
    : `<p class="note">通報された書き込みはありません。</p>`;
  $$("[data-ba]", el).forEach((b) => (b.onclick = async () => {
    const x = await rpc("engdy_board_admin_act", { p_token: token(), p_kind: b.dataset.k, p_id: b.dataset.i, p_act: b.dataset.ba }).catch(() => null);
    toast(x && x.ok ? "しました" : reasonText(x && x.reason)); renderBoardAdmin(el);
  }));
  $$("[data-bd]", el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox("削除しますか？", "元に戻せません。", "削除する", true))) return;
    const x = await rpc("engdy_board_delete", { p_token: token(), p_kind: b.dataset.bd, p_id: b.dataset.i }).catch(() => null);
    toast(x && x.ok ? "削除しました" : reasonText(x && x.reason)); renderBoardAdmin(el);
  }));
}
