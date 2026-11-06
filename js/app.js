// Engdy 本体：起動・ログイン・メイン画面・スタンプカード・設定・保護者メール・admin
import { $, $$, esc, dayKey, fmtDuration, toast, modal, confirmBox, sleep } from "./util.js";
import { S, save, onSave, today, agentProgress } from "./store.js";
import { rpc, fn, token, me, reasonText } from "./api.js";
import { go, onEnter } from "./router.js";
import { tone, setBgmVolume, bgm } from "./audio.js";
import { applySkin } from "./gacha.js";
import { openShared } from "./lists.js";
import "./view.js";
import "./test.js";
import "./stats.js";
import "./agent.js";

export const VERSION = "1.0.0";
export const STAMP_DIA = 30, CARD_BONUS = 100;

// ================= スタンプカード =================
// 閲覧を1周したら呼ぶ。その日はじめてならスタンプ＋ダイヤ
export function awardLap() {
  const k = dayKey();
  if (S.stamp.last === k) return { stamped: false, gained: 0 };
  S.stamp.last = k;
  S.stamp.card.push(k);
  let gained = STAMP_DIA, cardDone = false;
  if (S.stamp.card.length >= 7) { gained += CARD_BONUS; cardDone = true; }
  S.diamonds += gained;
  save(true);
  return { stamped: true, gained, cardDone, slot: S.stamp.card.length };
}
// カードが埋まったら、次にメインを開いたとき新しいカードにする
function rollCard() {
  if (S.stamp.card.length >= 7 && S.stamp.last !== dayKey()) { S.stamp.card = []; S.stamp.cards++; save(); }
}

function renderStamp(highlightNew = false) {
  rollCard();
  const n = S.stamp.card.length, done = S.stamp.last === dayKey();
  const cells = Array.from({ length: 7 }, (_, i) => {
    const on = i < n;
    const d = on ? S.stamp.card[i].slice(5).replace("-", "/") : i + 1;
    const rw = i === 6 ? `+${STAMP_DIA + CARD_BONUS}` : `+${STAMP_DIA}`;
    return `<div class="stamp ${on ? "on" : ""} ${on && highlightNew && i === n - 1 ? "new" : ""}">${on ? "✓" : d}<span class="reward">${on ? d : "💎" + rw}</span></div>`;
  }).join("");
  $("#stampCard").innerHTML = `<div class="sc-head"><b>スタンプカード <small class="note">${S.stamp.cards + 1}枚目</small></b>
    <span class="note">${done ? "今日のスタンプは押しました ✓" : "閲覧を1周すると、今日のスタンプ"}</span></div><div class="stamps">${cells}</div><div style="height:14px"></div>`;
}

// ================= メイン画面 =================
function renderMain(arg) {
  const t = today();
  const streak = streakDays();
  $("#todayCard").innerHTML = `
    <div class="t-item"><small>今日の学習</small><b>${fmtDuration(t.s)}</b></div>
    <div class="t-item"><small>今日見た単語</small><b>${t.w}</b></div>
    <div class="t-item"><small>連続学習</small><b>${streak}日</b></div>
    <div class="t-item"><small>テスト正答率</small><b>${S.test.total ? Math.round(S.test.correct / S.test.total * 100) + "%" : "—"}</b></div>`;
  renderStamp(arg && arg.newStamp);
  updateDia();
  const p = agentProgress();
  $("#agentItem").classList.toggle("locked", !p.ok);
  $("#agentLock").hidden = p.ok;
  renderAccount();
}
onEnter("main", renderMain);

export function streakDays() {
  let n = 0, k = dayKey();
  const has = (d) => { const x = S.stats.days[d]; return x && (x.s > 0 || x.tt > 0); };
  if (!has(k)) k = addDay(k, -1);
  while (has(k)) { n++; k = addDay(k, -1); }
  return n;
}
const addDay = (k, n) => { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function updateDia() {
  $("#diaCount").textContent = S.diamonds.toLocaleString();
  $$(".diaMirror").forEach((e) => (e.textContent = S.diamonds.toLocaleString()));
}

function renderAccount() {
  const u = me();
  $("#acctBtn").textContent = u ? `${u.avatar || "👤"} ${u.display_name || u.username}` : "ゲスト（ログイン）";
  $$(".admin-only").forEach((e) => (e.hidden = !(u && u.is_admin)));
}
$("#acctBtn").onclick = () => { if (window.KaAccount) (KaAccount.isLoggedIn() ? KaAccount.openPanel() : KaAccount.login("login")); };

// ================= ログイン画面 =================
$("#s-login").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  tone("click");
  if (b.dataset.act === "guest") { localStorage.setItem("engdy_guest", "1"); enterApp(); return; }
  if (!window.KaAccount) { toast("アカウント機能を読み込めませんでした。ゲストで始めてください"); return; }
  KaAccount.login(b.dataset.act === "register" ? "register" : "login");
});

let pendingShared = null;
function enterApp() {
  go("main");
  if (pendingShared) { const c = pendingShared; pendingShared = null; openShared(c); }
}

// ================= 1日の記録をサーバーへ（保護者メール用。ログイン中だけ） =================
let pushTimer, lastPushed = "";
onSave(() => {
  updateDia();
  if (!token()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushDaily, 8000);
});
async function pushDaily() {
  if (!token()) return;
  const k = dayKey(), t = S.stats.days[k];
  if (!t) return;
  const sig = k + JSON.stringify(t);
  if (sig === lastPushed) return;
  try {
    const r = await rpc("engdy_daily_push", { p_token: token(), p_day: k, p_seconds: Math.round(t.s), p_words: t.w, p_laps: t.l, p_test_total: t.tt, p_test_correct: t.tc });
    if (r && r.ok) lastPushed = sig;
  } catch (e) {}
}

// ================= 設定 =================
onEnter("settings", () => {
  const st = S.settings;
  $("#settingsBody").innerHTML = `<div class="card">
    <div class="set-row"><label>意味が出るまで<small>閲覧で、単語が出てから意味を表示するまでの秒数</small></label><span><input type="range" min="1" max="10" step="0.5" id="setShow" value="${st.showDelay}"> <b id="setShowV">${st.showDelay}秒</b></span></div>
    <div class="set-row"><label>次の単語まで<small>意味が出てから次へ進むまでの秒数</small></label><span><input type="range" min="1" max="10" step="0.5" id="setNext" value="${st.nextDelay}"> <b id="setNextV">${st.nextDelay}秒</b></span></div>
    <div class="set-row"><label>発音を自動で読み上げ<small>単語が出たときに英語の音声を流す</small></label><input type="checkbox" id="setSpeak" ${st.autoSpeak ? "checked" : ""}></div>
    <div class="set-row"><label>BGM の音量</label><input type="range" min="0" max="1" step="0.05" id="setBgm" value="${st.bgm}"></div>
    <div class="set-row"><label>効果音の音量</label><input type="range" min="0" max="1" step="0.05" id="setSfx" value="${st.sfx}"></div>
  </div>
  <div class="card"><h3 class="sec">データ</h3>
    <p class="hint">${me() ? "ログイン中なので、記録はかるわかGAMES のクラウドに自動で保存されます。" : "ゲストの記録はこのブラウザだけに保存されます。アカウントでログインすると、ほかの端末でも続きができます。"}</p>
    <button class="btn danger ghost" id="resetAll">この端末の記録をすべて消す</button></div>`;
  const bind = (id, key, label, after) => {
    const el = $(id);
    el.oninput = () => { st[key] = el.type === "checkbox" ? el.checked : parseFloat(el.value); if (label) $(label).textContent = st[key] + "秒"; after && after(st[key]); save(); };
    el.onchange = el.oninput;
  };
  bind("#setShow", "showDelay", "#setShowV");
  bind("#setNext", "nextDelay", "#setNextV");
  bind("#setSpeak", "autoSpeak");
  bind("#setBgm", "bgm", null, (v) => setBgmVolume(v));
  bind("#setSfx", "sfx", null, () => tone("click"));
  $("#resetAll").onclick = async () => {
    if (!(await confirmBox("記録をすべて消しますか？", "統計・スタンプ・ダイヤ・図鑑・単語リストがこの端末から消えます。元に戻せません。", "消す", true))) return;
    localStorage.removeItem("engdy_v1"); localStorage.removeItem("engdy_lists");
    location.reload();
  };
});

// ================= 保護者メール =================
onEnter("parent", renderParent);
async function renderParent() {
  const body = $("#parentBody");
  if (!token()) {
    body.innerHTML = `<div class="card"><p>保護者メールは、かるわかGAMES アカウントでログインすると使えます。</p>
      <p class="hint">毎週日曜の夜に、1週間の学習時間・見た単語の数・テストの正答率を、登録したメールアドレスへ自動で送ります。</p>
      <button class="btn pri" id="pmLogin">ログインする</button></div>`;
    $("#pmLogin").onclick = () => KaAccount.login("login");
    return;
  }
  body.innerHTML = `<div class="card"><span class="spinner"></span> 読み込み中…</div>`;
  let r;
  try { r = await rpc("engdy_parent_get", { p_token: token() }); } catch (e) { r = null; }
  if (!r || !r.ok) { body.innerHTML = `<div class="card">${esc(reasonText(r && r.reason))}</div>`; return; }
  const info = `<p class="hint">毎週日曜 19:00（日本時間）に、直近1週間の学習レポートを送ります。メールアドレスはサーバーで暗号化して保存され、この画面にも一部しか表示されません。メールの中のリンクからも送信を止められます。</p>`;
  if (!r.set) {
    body.innerHTML = `<div class="card"><h3 class="sec">保護者のメールアドレスを登録</h3>${info}
      <label class="field"><span>メールアドレス</span><input id="pmEmail" type="email" maxlength="254" placeholder="parent@example.com" autocomplete="off"></label>
      <label class="radio"><input type="checkbox" id="pmAgree"><span>保護者の方の了承を得ています<small>週に1回、学習レポートのメールが届くことを伝えてから登録してください。</small></span></label>
      <button class="btn pri" id="pmSave">登録する</button></div>`;
    $("#pmSave").onclick = async () => {
      if (!$("#pmAgree").checked) { toast("保護者の方の了承を確認してください"); return; }
      const x = await rpc("engdy_parent_set", { p_token: token(), p_email: $("#pmEmail").value }).catch(() => null);
      if (x && x.ok) { toast("登録しました"); renderParent(); } else toast(reasonText(x && x.reason));
    };
    return;
  }
  body.innerHTML = `<div class="card"><h3 class="sec">連携中のメールアドレス</h3>
    <p style="font-size:18px;font-family:var(--mono)">${esc(r.mask)}</p>
    <p>状態：<b style="color:${r.active ? "var(--accent)" : "var(--warn)"}">${r.active ? "毎週送信中" : "停止中"}</b>${r.last_sent ? `　<span class="note">前回の送信：${new Date(r.last_sent).toLocaleString("ja-JP")}</span>` : ""}</p>
    ${info}
    <div class="row wrap">
      <button class="btn ${r.active ? "" : "pri"}" id="pmToggle">${r.active ? "送信を停止する" : "送信を再開する"}</button>
      <button class="btn" id="pmChange">アドレスを変更</button>
      <button class="btn danger ghost" id="pmDelete">連携を解除（削除）</button>
    </div></div>`;
  $("#pmToggle").onclick = async () => {
    const x = await rpc("engdy_parent_active", { p_token: token(), p_active: !r.active }).catch(() => null);
    toast(x && x.ok ? (r.active ? "送信を停止しました" : "送信を再開しました") : reasonText(x && x.reason)); renderParent();
  };
  $("#pmChange").onclick = async () => {
    await rpc("engdy_parent_delete", { p_token: token() }).catch(() => null); renderParent();
  };
  $("#pmDelete").onclick = async () => {
    if (!(await confirmBox("連携を解除しますか？", "登録したメールアドレスをサーバーから削除し、送信もしなくなります。", "解除する", true))) return;
    await rpc("engdy_parent_delete", { p_token: token() }).catch(() => null); toast("解除しました"); renderParent();
  };
}

// ================= admin（かるわかGAMES 管理者だけ。権限はサーバーで確認） =================
onEnter("admin", renderAdmin);
async function renderAdmin() {
  const body = $("#adminBody");
  body.innerHTML = `<div class="card"><span class="spinner"></span> 確認中…</div>`;
  const r = await rpc("engdy_admin_get", { p_token: token() }).catch(() => null);
  if (!r || !r.ok) { body.innerHTML = `<div class="card">${esc(reasonText(r && r.reason))}</div>`; return; }
  const st = r.settings || {}, sec = r.secrets || {}, c = r.counts || {};
  const inp = (name, label, ph, secret) => `<label>${label}${secret && sec[name] ? ` <span class="badge">設定済み ${esc(sec[name])}</span>` : ""}
    <span class="row"><input class="grow" data-k="${name}" ${secret ? 'type="password" autocomplete="new-password"' : ""} placeholder="${esc(ph)}" value="${secret ? "" : esc(st[name] || "")}"><button class="btn sm" data-save="${name}">保存</button></span></label>`;
  body.innerHTML = `
  <div class="card"><h3 class="sec">利用状況</h3><div class="adm-kpi">
    <div>リスト<b>${c.lists}</b></div><div>全体公開<b>${c.public_lists}</b></div><div>7日の学習者<b>${c.learners_7d}</b></div>
    <div>保護者メール<b>${c.parents_active}</b></div><div>今日の AI 利用<b>${c.ai_today}</b></div></div></div>
  <div class="card adm-grid"><h3 class="sec">Gemini（専属エージェント・意味の自動入力）</h3>
    ${inp("gemini_key", "API キー", "AIza…（空で保存すると削除）", true)}
    ${inp("gemini_model", "モデル", "gemini-3.6-flash")}
    ${inp("ai_daily_limit", "1人1日の AI 利用回数", "40")}
    ${inp("agent_enabled", "専属エージェント（on / off）", "on")}
    <div class="row"><button class="btn" id="admAi">AI の動作確認</button><span class="note" id="admAiOut"></span></div></div>
  <div class="card adm-grid"><h3 class="sec">AgentMail（保護者への週次メール）</h3>
    ${inp("agentmail_key", "API キー", "am_…（空で保存すると削除）", true)}
    ${inp("agentmail_inbox", "送信元 inbox_id", "AgentMail の inbox_id")}
    ${inp("mail_enabled", "週次メール（on / off）", "on")}
    <label>テスト送信先<span class="row"><input class="grow" id="admTo" type="email" placeholder="自分のメールアドレス"><button class="btn sm" id="admTest">テスト送信</button></span></label>
    <div class="row"><button class="btn" id="admRun">いますぐ全員に週次メールを送る</button></div>
    <p class="hint">自動送信：毎週日曜 19:00（日本時間）</p>
    <table class="wtable"><tr><th>日時</th><th>結果</th><th>内容</th></tr>${(r.mail_log || []).map((l) => `<tr><td>${new Date(l.sent_at).toLocaleString("ja-JP")}</td><td>${l.ok ? "✓" : "✕"}</td><td>${esc(l.info || "")}</td></tr>`).join("") || `<tr><td colspan="3" class="note">まだ送信していません</td></tr>`}</table>
  </div>`;
  $$("[data-save]", body).forEach((b) => b.onclick = async () => {
    const k = b.dataset.save, v = $(`[data-k="${k}"]`, body).value;
    const x = await rpc("engdy_admin_set", { p_token: token(), p_name: k, p_value: v }).catch(() => null);
    toast(x && x.ok ? "保存しました" : reasonText(x && x.reason)); if (x && x.ok) renderAdmin();
  });
  $("#admAi").onclick = async () => { $("#admAiOut").textContent = "確認中…"; const x = await fn("admin_test_ai"); $("#admAiOut").textContent = x.ok ? "OK：" + x.text : reasonText(x.reason); };
  $("#admTest").onclick = async () => { const x = await fn("admin_test_mail", { to: $("#admTo").value }); toast(x.ok ? "テストメールを送りました" : reasonText(x.reason)); if (x.ok) renderAdmin(); };
  $("#admRun").onclick = async () => {
    if (!(await confirmBox("週次メールを送りますか？", "送信中になっている全員に、いますぐレポートを送ります。", "送る"))) return;
    const x = await fn("admin_run_weekly"); toast(x.ok ? `送信 ${x.sent}件 / 失敗 ${x.failed}件` : reasonText(x.reason)); renderAdmin();
  };
}

// ================= 起動 =================
async function boot() {
  applySkin();
  const q = new URLSearchParams(location.search);
  // メールの「送信停止」リンク
  if (q.get("unsub")) {
    const r = await rpc("engdy_unsubscribe", { p_unsub: q.get("unsub") }).catch(() => null);
    history.replaceState(null, "", location.pathname);
    setTimeout(() => modal(`<p class="kicker">PARENT MAIL</p><h3>${r && r.ok ? "送信を停止しました" : "停止できませんでした"}</h3>
      <p>${r && r.ok ? "Engdy からの週次レポートは、今後届きません。再開は、学習する人のアプリの「保護者メール」からできます。" : "リンクが古いか、すでに解除されています。"}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>OK</button></div>`), 300);
  }
  if (q.get("list")) { pendingShared = q.get("list"); history.replaceState(null, "", location.pathname); }

  if (window.KaAccount) {
    await Promise.race([KaAccount.ready, sleep(4000)]).catch(() => {});
    KaAccount.onChange((p) => {
      renderAccount();
      if (p && document.querySelector("#s-login.active")) enterApp();
      if (document.querySelector("#s-main.active")) renderMain();
    });
  }
  if ((window.KaAccount && KaAccount.isLoggedIn()) || localStorage.getItem("engdy_guest") === "1") enterApp();
  else go("login");
}
boot();
