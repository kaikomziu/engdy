// Engdy 本体：起動・ログイン・メイン画面・スタンプカード・設定・保護者メール・admin
import { $, $$, esc, dayKey, fmtDuration, toast, modal, confirmBox, sleep } from "./util.js";
import { S, save, onSave, today, agentProgress } from "./store.js";
import { rpc, fn, token, me, reasonText } from "./api.js";
import { go, onEnter, onLeave } from "./router.js";
import { tone, bgm, refreshBgm, TRACKS, SCENES, sceneTrack, SFX_CATS, testSfx, previewTrack, stopPreview, previewing } from "./audio.js";
import { applySkin } from "./gacha.js";
import { openShared, addSample, startLast, lastListName } from "./lists.js";
import { loadLists, testPool } from "./store.js";
import { resumeView } from "./view.js";
import "./test.js";
import "./stats.js";
import "./agent.js";
import { CHANGELOG } from "./changelog.js";
import "./memo.js";
import { voices, say } from "./voice.js";
import { initPwa, install, canInstall, isStandalone, isIOS, onPwaChange, cacheMusic, musicCached, clearMusic, musicTotal } from "./pwa.js";

export const VERSION = "1.11.2";
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
    <div class="t-item"><small>テスト正答率</small><b>${S.test.total ? Math.round(S.test.correct / S.test.total * 100) + "%" : "—"}</b></div>
    ${goalHtml(t)}`;
  renderResume();
  renderNext();
  renderInstall();
  renderStamp(arg && arg.newStamp);
  updateDia();
  const p = agentProgress();
  $("#agentItem").classList.toggle("locked", !p.ok);
  $("#agentLock").hidden = p.ok;
  renderAccount();
}
onEnter("main", renderMain);

// ================= 今日の目標 =================
function goalHtml(t) {
  const gm = S.settings.goalMin, gw = S.settings.goalWords;
  if (!gm && !gw) return "";
  const pm = gm ? Math.min(1, t.s / 60 / gm) : 1, pw = gw ? Math.min(1, t.w / gw) : 1;
  const done = pm >= 1 && pw >= 1;
  return `<div class="goal"><div class="goal-head"><b>🎯 今日の目標</b><span class="note">${done ? "達成！ おつかれさま 🎉" : "設定で変えられます"}</span></div>
    ${gm ? `<div class="goal-row"><span>${Math.floor(t.s / 60)} / ${gm}分</span><div class="meter"><i style="width:${pm * 100}%"></i></div></div>` : ""}
    ${gw ? `<div class="goal-row"><span>${t.w} / ${gw}語</span><div class="meter"><i style="width:${pw * 100}%"></i></div></div>` : ""}</div>`;
}
function checkGoal() {
  const k = dayKey(), t = S.stats.days[k];
  if (!t || S.goal.done === k) return;
  const gm = S.settings.goalMin, gw = S.settings.goalWords;
  if (!gm && !gw) return;
  if ((!gm || t.s >= gm * 60) && (!gw || t.w >= gw)) { S.goal.done = k; save(); toast("🎯 今日の目標を達成しました！", 3000); tone("combo"); }
}

// ================= 次にやること =================
function renderNext() {
  const el = $("#nextCard");
  if (S.resume && S.resume.words && S.resume.words.length) { el.hidden = true; return; }
  const lists = loadLists(), t = today(), lapped = S.stamp.last === dayKey();
  let html = "";
  if (!lists.length) {
    html = `<div><p class="kicker">NEXT</p><b>まずは単語リストを用意しよう</b><p class="note">自分で作るか、サンプル（中学生向け150語）を入れてすぐ始められます。</p></div>
      <div class="row wrap"><button class="btn" data-go="create">リストを作る</button><button class="btn pri" id="nxSample">サンプルを入れる</button></div>`;
  } else if (!lapped) {
    const name = lastListName();
    html = `<div><p class="kicker">NEXT</p><b>今日の閲覧がまだです</b><p class="note">1周するとスタンプと 💎 がもらえます。</p></div>
      <div class="row wrap">${name ? `<button class="btn pri" id="nxLast">「${esc(name.length > 14 ? name.slice(0, 14) + "…" : name)}」で始める</button>` : ""}<button class="btn ${name ? "" : "pri"}" data-go="browse">リストを選ぶ</button></div>`;
  } else if (testPool().length >= 4 && !t.tt) {
    html = `<div><p class="kicker">NEXT</p><b>見た単語をテストしよう</b><p class="note">テストで覚えたかどうか確かめると、苦手な単語がわかります。</p></div>
      <div class="row wrap"><button class="btn pri" data-go="test">テストする</button></div>`;
  } else {
    el.hidden = true; return;
  }
  el.hidden = false; el.innerHTML = html;
  const s = $("#nxSample"); if (s) s.onclick = () => { addSample(); toast("サンプルの単語リスト（150語）を入れました"); renderNext(); };
  const l = $("#nxLast"); if (l) l.onclick = () => { if (!startLast()) go("browse"); };
}

// ================= アプリとしてインストール（おすすめ表示） =================
function renderInstall() {
  const el = $("#installCard");
  const show = !isStandalone() && !S.installHide && (canInstall() || isIOS()) && S.stats.laps >= 1;
  el.hidden = !show;
  if (!show) return;
  el.innerHTML = `<div><p class="kicker">APP</p><b>📲 Engdy をアプリとして使おう</b><p class="note">ホーム画面のアイコンからすぐ開けて、オフラインでも閲覧できます。</p></div>
    <div class="row"><button class="btn sm ghost" id="insHide">今はしない</button><button class="btn pri" id="insGo">インストール</button></div>`;
  $("#insGo").onclick = install;
  $("#insHide").onclick = () => { S.installHide = true; save(); el.hidden = true; toast("設定の「アプリ」から、いつでもインストールできます"); };
}

// ================= はじめての人へ =================
function welcome() {
  if (S.welcomed) return;
  S.welcomed = true; save();
  modal(`<p class="kicker">WELCOME</p><h3>Engdy へようこそ！</h3>
    <ol class="steps">
      <li><b>リストを作る</b><span>覚えたい単語を1行に1つ。サンプルも入っています。</span></li>
      <li><b>閲覧する</b><span>単語 → 意味 の順に、数秒ずつ見ていきます。毎日1周でスタンプ。</span></li>
      <li><b>テストする</b><span>見た単語を4択や書き取りで確かめます。</span></li>
    </ol>
    <p class="hint">ダイヤがたまったらガチャ、テストを続けると専属エージェントが使えるようになります。</p>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>はじめる</button></div>`);
}

// ================= 途中の閲覧を再開 =================
function renderResume() {
  const r = S.resume, el = $("#resumeCard");
  if (!r || !r.words || !r.words.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div><p class="kicker">CONTINUE</p><b>${esc(r.title)}</b> <span class="note">${r.resumeAt + 1} / ${r.words.length}語目${r.reverse ? " ・ 意味→英語" : ""}</span></div>
    <div class="row"><button class="btn sm ghost" id="resDrop">やめる</button><button class="btn pri" id="resGo">続きから再開</button></div></div>`;
  $("#resGo").onclick = resumeView;
  $("#resDrop").onclick = () => { delete S.resume; save(); renderResume(); renderNext(); };
}

// ================= お知らせ（ブラウザ通知） =================
// Engdy を開いている間（裏のタブでも）に、決めた時刻になっても今日まだ学習していなければ知らせる
setInterval(checkNotify, 30000);
async function checkNotify() {
  const st = S.settings;
  if (!st.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  const k = dayKey(); if (S.goal.notified === k) return;
  const [h, m] = (st.notifyTime || "19:00").split(":").map(Number);
  const now = new Date(Date.now() + 9 * 3600e3);
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < h * 60 + m) return;
  const t = S.stats.days[k];
  if (t && t.s >= 60) return;
  S.goal.notified = k; save();
  const opt = { body: "今日の英単語はまだです。1周だけでもやってみよう！", icon: "icon.svg", tag: "engdy-daily" };
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) reg.showNotification("Engdy", opt); else new Notification("Engdy", opt);
  } catch (e) {}
}

// ================= ショートカット一覧 =================
export function showKeys() {
  const rows = [
    ["閲覧", [["Space / Enter / →", "意味を表示・次へ"], ["←", "前の単語に戻る"], ["P", "一時停止（自動で進むのを止める）"], ["S", "発音を聞く"], ["Esc", "やめる"]]],
    ["スマホの閲覧", [["右へスワイプ", "次へ"], ["左へスワイプ", "前に戻る"], ["タップ", "意味を表示・次へ"]]],
    ["テスト", [["1〜4", "選択肢を選ぶ"], ["Enter", "書き取りで答える"]]],
    ["どこでも", [["?", "この一覧を出す"], ["Esc", "ウィンドウを閉じる"]]],
  ];
  modal(`<p class="kicker">SHORTCUTS</p><h3>ショートカット</h3>${rows.map(([h, list]) => `<h3 class="sec" style="margin-top:12px">${h}</h3><table class="wtable keys">${list.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("")}</table>`).join("")}
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" data-close>OK</button></div>`);
}
$("#keysLink").onclick = showKeys;
document.addEventListener("keydown", (e) => {
  if (e.key === "?" && !(e.target.closest && e.target.closest("input,textarea")) && $("#modal").hidden) { e.preventDefault(); showKeys(); }
});

// ================= 文字サイズ =================
export function applyFontSize() { document.documentElement.dataset.fs = S.settings.fontSize || "m"; }

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

let pendingShared = null, pendingGo = null;
function enterApp() {
  // はじめての人には、サンプルの単語リストを入れておく
  if (!S.sampleAdded) { if (!loadLists().length) addSample(); S.sampleAdded = true; save(); }
  go("main");
  if (pendingGo) { const g = pendingGo; pendingGo = null; go(g); return; }
  if (!pendingShared) setTimeout(welcome, 400);
  if (pendingShared) { const c = pendingShared; pendingShared = null; openShared(c); }
}

// ================= 1日の記録をサーバーへ（保護者メール用。ログイン中だけ） =================
let pushTimer, lastPushed = "";
onSave(() => {
  updateDia();
  checkGoal();
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
    <div class="set-row"><label>振動<small>正解・不正解・スタンプのときに、スマホを軽くふるわせる（Android など対応機種のみ）</small></label><input type="checkbox" id="setVib" ${st.vibrate !== false ? "checked" : ""}></div>
    <div class="set-row"><label>文字の大きさ<small>閲覧とテストの単語・意味の大きさ</small></label><div class="seg" id="setFs">${[["s", "小"], ["m", "中"], ["l", "大"]].map(([v, t]) => `<button data-fs="${v}" class="${(st.fontSize || "m") === v ? "on" : ""}">${t}</button>`).join("")}</div></div>
  </div>
  <div class="card"><h3 class="sec">🗣️ 読み上げ（発音）</h3>
    <div class="set-row"><label>自動で読み上げ<small>閲覧・テストで単語が出たときに、発音を流す</small></label><input type="checkbox" id="setSpeak" ${st.autoSpeak ? "checked" : ""}></div>
    <div class="set-row"><label>読み上げ方<small>「本物の発音」は、人が録音した発音を流します（1語の単語だけ。ない単語は合成音声）</small></label>
      <div class="seg" id="setVMode"><button data-v="real" class="${st.voiceMode !== "tts" ? "on" : ""}">本物の発音を優先</button><button data-v="tts" class="${st.voiceMode === "tts" ? "on" : ""}">合成音声だけ</button></div></div>
    <div class="set-row"><label>アクセント</label><div class="seg" id="setAccent"><button data-a="us" class="${st.accent !== "uk" ? "on" : ""}">🇺🇸 アメリカ</button><button data-a="uk" class="${st.accent === "uk" ? "on" : ""}">🇬🇧 イギリス</button></div></div>
    <div class="set-row"><label>声（合成音声）<small>熟語・例文・録音のない単語に使う声。上にあるほど自然な声です</small></label><select id="setVoice" style="max-width:220px"></select></div>
    <div class="set-row"><label>速さ <small id="setRateV">${Math.round((st.voiceRate || 0.9) * 100)}%</small></label><input type="range" min="0.6" max="1.3" step="0.05" id="setRate" value="${st.voiceRate || 0.9}"></div>
    <div class="set-row"><label>音量 <small id="setVVolV">${Math.round((st.voiceVol ?? 1) * 100)}%</small></label><input type="range" min="0" max="1" step="0.05" id="setVVol" value="${st.voiceVol ?? 1}"></div>
    <div class="set-row"><label>発音記号を表示<small>閲覧で、単語の下に /ˈbjuːtɪfəl/ のような発音記号を出す</small></label><input type="checkbox" id="setIpa" ${st.showIpa !== false ? "checked" : ""}></div>
    <div class="row wrap"><button class="btn sm" data-try="beautiful">▶ 単語（beautiful）</button><button class="btn sm" data-try="look forward to">▶ 熟語</button><button class="btn sm" data-try="I'm looking forward to seeing you again.">▶ 例文</button></div>
  </div>
  <div class="card"><h3 class="sec">🎵 BGM</h3>
    <div class="set-row"><label>BGM を流す</label><input type="checkbox" id="setBgmOn" ${st.bgmOn !== false ? "checked" : ""}></div>
    <div class="set-row"><label>音量 <small id="setBgmV">${Math.round(st.bgm * 100)}%</small></label><input type="range" min="0" max="1" step="0.05" id="setBgm" value="${st.bgm}"></div>
    <p class="hint" style="margin-top:10px">場面ごとに流す曲を選べます。▶ で試聴（約15秒）。</p>
    ${SCENES.map(([sc, label]) => `<div class="set-row scene-row"><label>${label}</label><span class="row"><select data-scene="${sc}">
      <option value="none">なし</option>${TRACKS.map((t) => `<option value="${t.id}" ${sceneTrack(sc) === t.id ? "selected" : ""}>${esc(t.title)}</option>`).join("")}
      </select><button class="btn sm" data-prev="${sc}" title="試聴">▶</button></span></div>`).join("")}
    <p class="hint">曲：${[...new Set(TRACKS.map((t) => t.by))].map(esc).join("・")}</p>
  </div>
  <div class="card"><h3 class="sec">🔊 効果音</h3>
    <div class="set-row"><label>効果音を鳴らす</label><input type="checkbox" id="setSfxOn" ${st.sfxOn !== false ? "checked" : ""}></div>
    <div class="set-row"><label>音量 <small id="setSfxV">${Math.round(st.sfx * 100)}%</small></label><input type="range" min="0" max="1" step="0.05" id="setSfx" value="${st.sfx}"></div>
    ${SFX_CATS.map(([c, label, desc]) => `<div class="set-row"><label>${label}<small>${desc}</small></label><span class="row"><button class="btn sm" data-test="${c}" title="試しに鳴らす">▶</button><input type="checkbox" data-cat="${c}" ${!(st.sfxCats && st.sfxCats[c] === false) ? "checked" : ""}></span></div>`).join("")}
  </div>
  <div class="card"><h3 class="sec">🎯 今日の目標</h3>
    <div class="set-row"><label>学習時間<small>0 にすると目標にしない</small></label><span><input type="number" min="0" max="300" id="setGoalMin" value="${st.goalMin}" style="width:80px"> 分</span></div>
    <div class="set-row"><label>見る単語の数<small>0 にすると目標にしない</small></label><span><input type="number" min="0" max="3000" id="setGoalWords" value="${st.goalWords}" style="width:80px"> 語</span></div>
  </div>
  <div class="card"><h3 class="sec">🔔 お知らせ</h3>
    <div class="set-row"><label>学習のお知らせ<small>決めた時刻になっても今日まだ学習していないとき、通知で知らせます</small></label><input type="checkbox" id="setNotify" ${st.notify ? "checked" : ""}></div>
    <div class="set-row"><label>時刻</label><input type="time" id="setNotifyTime" value="${st.notifyTime || "19:00"}"></div>
    <p class="hint">※ 通知は Engdy を開いている間（ほかのタブを見ていても OK）だけ届きます。スマホでは「ホーム画面に追加」して開いておくと確実です。</p>
  </div>
  <div class="card" id="appCard"></div>
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
  // 読み上げ
  const fillVoices = () => {
    const vs = voices();
    $("#setVoice").innerHTML = `<option value="">おすすめ（自動）${vs[0] ? "：" + esc(vs[0].name) : ""}</option>` + vs.map((v) => `<option value="${esc(v.name)}" ${st.voiceName === v.name ? "selected" : ""}>${esc(v.name)}（${esc(v.lang)}）</option>`).join("");
    if (!vs.length) $("#setVoice").innerHTML = `<option value="">この端末には英語の声がありません</option>`;
  };
  fillVoices();
  try { speechSynthesis.addEventListener("voiceschanged", fillVoices, { once: true }); } catch (e) {}
  $("#setVoice").onchange = (e) => { st.voiceName = e.target.value; save(); say("Hello! Nice to meet you."); };
  $("#setVMode").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; st.voiceMode = b.dataset.v; save(); $$("#setVMode button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("#setAccent").onclick = (e) => { const b = e.target.closest("[data-a]"); if (!b) return; st.accent = b.dataset.a; st.voiceName = ""; save(); $$("#setAccent button").forEach((x) => x.classList.toggle("on", x === b)); fillVoices(); say("beautiful"); };
  $("#setRate").oninput = (e) => { st.voiceRate = parseFloat(e.target.value); $("#setRateV").textContent = Math.round(st.voiceRate * 100) + "%"; save(); };
  $("#setRate").onchange = () => say("beautiful");
  $("#setVVol").oninput = (e) => { st.voiceVol = parseFloat(e.target.value); $("#setVVolV").textContent = Math.round(st.voiceVol * 100) + "%"; save(); };
  $("#setIpa").onchange = (e) => { st.showIpa = e.target.checked; save(); };
  $$("[data-try]").forEach((b) => (b.onclick = () => say(b.dataset.try)));
  // BGM
  $("#setBgmOn").onchange = (e) => { st.bgmOn = e.target.checked; save(); refreshBgm(); };
  $("#setBgm").oninput = (e) => { st.bgm = parseFloat(e.target.value); $("#setBgmV").textContent = Math.round(st.bgm * 100) + "%"; save(); refreshBgm(); };
  $$("[data-scene]").forEach((sel) => (sel.onchange = () => {
    st.bgmTracks = { ...(st.bgmTracks || {}), [sel.dataset.scene]: sel.value }; save(); refreshBgm();
  }));
  const prevBtns = () => $$("[data-prev]").forEach((b) => (b.textContent = previewing() && previewing() === sceneTrack(b.dataset.prev) && b.classList.contains("on") ? "■" : "▶"));
  $$("[data-prev]").forEach((b) => (b.onclick = () => {
    const on = b.classList.contains("on");
    $$("[data-prev]").forEach((x) => x.classList.remove("on"));
    if (on) { stopPreview(); prevBtns(); return; }
    const id = sceneTrack(b.dataset.prev);
    if (id === "none") { toast("「なし」になっています"); return; }
    b.classList.add("on");
    previewTrack(id, () => { b.classList.remove("on"); prevBtns(); });
    prevBtns();
  }));
  // 効果音
  $("#setSfxOn").onchange = (e) => { st.sfxOn = e.target.checked; save(); if (st.sfxOn) tone("click"); };
  $("#setSfx").oninput = (e) => { st.sfx = parseFloat(e.target.value); $("#setSfxV").textContent = Math.round(st.sfx * 100) + "%"; save(); };
  $("#setSfx").onchange = () => tone("click", true);
  $$("[data-cat]").forEach((c) => (c.onchange = () => { st.sfxCats = { ...(st.sfxCats || {}), [c.dataset.cat]: c.checked }; save(); }));
  $$("[data-test]").forEach((b) => (b.onclick = () => testSfx(b.dataset.test)));
  bind("#setVib", "vibrate", null, (v) => { if (v) tone("ok"); });
  $("#setFs").onclick = (e) => {
    const b = e.target.closest("[data-fs]"); if (!b) return;
    st.fontSize = b.dataset.fs; save(); applyFontSize();
    $$("#setFs button").forEach((x) => x.classList.toggle("on", x === b));
  };
  const num = (id, key, max) => { const el = $(id); el.onchange = () => { st[key] = Math.max(0, Math.min(max, parseInt(el.value, 10) || 0)); el.value = st[key]; save(); }; };
  num("#setGoalMin", "goalMin", 300); num("#setGoalWords", "goalWords", 3000);
  $("#setNotifyTime").onchange = (e) => { st.notifyTime = e.target.value || "19:00"; S.goal.notified = ""; save(); };
  $("#setNotify").onchange = async (e) => {
    if (e.target.checked) {
      if (!("Notification" in window)) { toast("このブラウザは通知に対応していません"); e.target.checked = false; return; }
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") { toast("通知が許可されませんでした（ブラウザの設定で許可できます）", 3500); e.target.checked = false; return; }
      st.notify = true; S.goal.notified = ""; toast("お知らせをオンにしました");
    } else st.notify = false;
    save();
  };
  renderAppCard();
  $("#resetAll").onclick = async () => {
    if (!(await confirmBox("記録をすべて消しますか？", "統計・スタンプ・ダイヤ・図鑑・単語リストがこの端末から消えます。元に戻せません。", "消す", true))) return;
    localStorage.removeItem("engdy_v1"); localStorage.removeItem("engdy_lists");
    location.reload();
  };
});

onLeave("settings", () => stopPreview());

// ================= 更新履歴 =================
onEnter("changelog", () => {
  $("#changelogBody").innerHTML = CHANGELOG.map((c) => `<div class="card log"><div class="log-head"><b>v${esc(c.version)}</b><span class="note">${esc(c.date)}</span></div>
    <ul>${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`).join("");
});

// ================= 設定：アプリ（PWA） =================
async function renderAppCard() {
  const el = $("#appCard"); if (!el) return;
  const n = await musicCached(), total = musicTotal();
  const st = isStandalone() ? "アプリとして開いています ✓" : canInstall() ? "このブラウザからインストールできます" : isIOS() ? "Safari の共有ボタンから「ホーム画面に追加」できます" : "ブラウザのメニューからインストールできます";
  el.innerHTML = `<h3 class="sec">📲 アプリ</h3>
    <div class="set-row"><label>アプリとしてインストール<small>${st}</small></label>${isStandalone() ? "" : `<button class="btn sm pri" id="appInstall">インストール</button>`}</div>
    <div class="set-row"><label>音楽をオフライン用に保存<small id="musicState">${n >= total ? `保存済み（${total}曲）` : n ? `${n} / ${total}曲 保存済み` : "BGM（約14MB）を端末に保存して、ネットがなくても流せるようにします"}</small></label>
      <span class="row">${n ? `<button class="btn sm ghost" id="musicClear">削除</button>` : ""}${n < total ? `<button class="btn sm" id="musicSave">保存する</button>` : ""}</span></div>
    <p class="hint">オフラインでも、自分のリストの閲覧・テスト・自由メモ・ガチャ・統計が使えます。公開・AI・保護者メールはネットが必要です。</p>`;
  const ib = $("#appInstall"); if (ib) ib.onclick = install;
  const ms = $("#musicSave"); if (ms) ms.onclick = async () => {
    ms.disabled = true;
    const ok = await cacheMusic((done, all) => {
      const s = $("#musicState"); if (s) s.textContent = `保存中… ${done} / ${all}曲`;
      if (done >= all) { toast("音楽を保存しました"); renderAppCard(); }
    });
    if (!ok) ms.disabled = false;
  };
  const mc = $("#musicClear"); if (mc) mc.onclick = async () => { await clearMusic(); toast("保存した音楽を削除しました"); renderAppCard(); };
}

// ================= 保護者メール =================
// 登録すると「仮登録」になり、そのアドレスに届く認証メールのボタンを押すと「本登録」になって、レポートが届き始める
const FREQS = [["daily", "毎日", "毎日 19:00 に、その日の学習"], ["weekly", "毎週", "毎週日曜 19:00 に、1週間の学習"], ["monthly", "毎月", "毎月1日 19:00 に、前の月の学習"]];
const freqJa = (f) => (FREQS.find((x) => x[0] === f) || FREQS[1])[1];
const freqPicker = (cur, name = "pmFreq") => `<div class="freqs">${FREQS.map(([v, t, d]) => `<label class="radio"><input type="radio" name="${name}" value="${v}" ${cur === v ? "checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`).join("")}</div>`;
async function sendVerify(quiet) {
  const x = await fn("parent_verify_send");
  if (x.ok) { if (!quiet) toast("認証メールを送りました。届いたメールのボタンを押してください", 4000); return true; }
  toast(reasonText(x.reason), 4000); return false;
}

onEnter("parent", renderParent);
async function renderParent() {
  const body = $("#parentBody");
  const about = `<p class="hint">学習時間・見た単語の数・テストの正答率を、保護者のメールアドレスへ自動で送ります。メールアドレスはサーバーで暗号化して保存され、この画面にも一部しか表示されません。メールの中のリンクからも送信を止められます。</p>`;
  if (!token()) {
    body.innerHTML = `<div class="card"><p>保護者メールは、かるわかGAMES アカウントでログインすると使えます。</p>${about}
      <button class="btn pri" id="pmLogin">ログインする</button></div>`;
    $("#pmLogin").onclick = () => KaAccount.login("login");
    return;
  }
  body.innerHTML = `<div class="card"><span class="spinner"></span> 読み込み中…</div>`;
  let r;
  try { r = await rpc("engdy_parent_get", { p_token: token() }); } catch (e) { r = null; }
  if (!r || !r.ok) { body.innerHTML = `<div class="card">${esc(reasonText(r && r.reason))}</div>`; return; }

  // ---- まだ登録していない / アドレスを変える ----
  const form = (old) => {
    body.innerHTML = `<div class="card"><h3 class="sec">${old ? "メールアドレスを変更" : "保護者のメールアドレスを登録"}</h3>${about}
      <label class="field"><span>メールアドレス</span><input id="pmEmail" type="email" maxlength="254" placeholder="parent@example.com" autocomplete="off"></label>
      <div class="field"><span>送る頻度</span>${freqPicker(old ? r.freq : "weekly")}</div>
      <label class="radio"><input type="checkbox" id="pmAgree"><span>保護者の方の了承を得ています<small>登録すると、そのアドレスに確認のメールが届きます。メールのボタンを押すまでは、レポートは届きません。</small></span></label>
      <div class="row wrap">${old ? `<button class="btn ghost" id="pmBack">やめる</button>` : ""}<button class="btn pri" id="pmSave">登録して確認メールを送る</button></div></div>`;
    if (old) $("#pmBack").onclick = renderParent;
    $("#pmSave").onclick = async () => {
      if (!$("#pmAgree").checked) { toast("保護者の方の了承を確認してください"); return; }
      const freq = $('input[name="pmFreq"]:checked').value;
      const btn = $("#pmSave"); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> 送信中…`;
      const x = await rpc("engdy_parent_set", { p_token: token(), p_email: $("#pmEmail").value, p_freq: freq }).catch(() => null);
      if (!x || !x.ok) { toast(reasonText(x && x.reason)); btn.disabled = false; btn.textContent = "登録して確認メールを送る"; return; }
      await sendVerify();
      renderParent();
    };
  };
  if (!r.set) { form(false); return; }

  // ---- 登録済み ----
  const pending = !r.verified;
  const stateHtml = pending
    ? `<b style="color:var(--gold)">仮登録（認証待ち）</b>`
    : `<b style="color:${r.active ? "var(--accent)" : "var(--warn)"}">${r.active ? `${freqJa(r.freq)}送信中` : "停止中"}</b>`;
  body.innerHTML = `<div class="card"><h3 class="sec">連携中のメールアドレス</h3>
    <p style="font-size:18px;font-family:var(--mono);margin:4px 0">${esc(r.mask)}</p>
    <p>状態：${stateHtml}${r.last_sent && !pending ? `　<span class="note">前回の送信：${new Date(r.last_sent).toLocaleString("ja-JP")}</span>` : ""}</p>
    ${pending ? `<div class="pending-box">
        <p><b>📩 確認メールを送りました。</b>保護者の方に、届いたメールの「受け取りを認証する」ボタンを押してもらってください。押すと本登録になり、レポートが届き始めます。</p>
        <p class="note">${r.verify_expired ? "確認メールの期限（48時間）が切れました。もう一度送ってください。" : r.verify_sent_at ? `送った時刻：${new Date(r.verify_sent_at).toLocaleString("ja-JP")}（48時間有効）` : ""}　届かないときは、迷惑メールのフォルダも確かめてください。</p>
        <div class="row wrap"><button class="btn pri" id="pmResend">確認メールをもう一度送る</button><button class="btn" id="pmReload">認証できたか確かめる</button></div>
      </div>` : ""}
    <div class="field" style="margin-top:12px"><span>送る頻度</span>${freqPicker(r.freq)}</div>
    ${about}
    <div class="row wrap">
      ${pending ? "" : `<button class="btn ${r.active ? "" : "pri"}" id="pmToggle">${r.active ? "送信を停止する" : "送信を再開する"}</button>`}
      <button class="btn" id="pmChange">アドレスを変更</button>
      <button class="btn danger ghost" id="pmDelete">連携を解除（削除）</button>
    </div></div>`;
  $$('input[name="pmFreq"]').forEach((el) => (el.onchange = async () => {
    const x = await rpc("engdy_parent_freq", { p_token: token(), p_freq: el.value }).catch(() => null);
    toast(x && x.ok ? `${freqJa(el.value)}送るようにしました` : reasonText(x && x.reason)); renderParent();
  }));
  if (pending) {
    $("#pmResend").onclick = async () => { const b = $("#pmResend"); b.disabled = true; await sendVerify(); renderParent(); };
    $("#pmReload").onclick = async () => { await renderParent(); toast(document.querySelector(".pending-box") ? "まだ認証されていません" : "認証されました！"); };
  } else {
    $("#pmToggle").onclick = async () => {
      const x = await rpc("engdy_parent_active", { p_token: token(), p_active: !r.active }).catch(() => null);
      toast(x && x.ok ? (r.active ? "送信を停止しました" : "送信を再開しました") : reasonText(x && x.reason)); renderParent();
    };
  }
  $("#pmChange").onclick = () => form(true);
  $("#pmDelete").onclick = async () => {
    if (!(await confirmBox("連携を解除しますか？", "登録したメールアドレスをサーバーから削除し、送信もしなくなります。", "解除する", true))) return;
    await rpc("engdy_parent_delete", { p_token: token() }).catch(() => null); toast("解除しました"); renderParent();
  };
}

// ================= admin（かるわかGAMES 管理者だけ。権限はサーバーで確認） =================
let admKeyRows = 1;   // admin に出す Gemini のキーの欄の数
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
    <div>保護者メール<b>${c.parents_active}</b></div><div>今日の AI 利用<b>${c.ai_today}</b></div>
    <div>AI の保存済み結果<b>${c.ai_cache}</b></div><div>7日で節約した呼び出し<b>${c.ai_saved_7d}</b></div><div>7日で呼んだ回数<b>${c.ai_called_7d}</b></div></div>
    <p class="hint">単語の意味・似た単語・穴埋めの英文・図鑑の解説・テーマのリストは、いちど AI に聞いた結果をみんなで使い回します。</p></div>
  <div class="card adm-grid"><h3 class="sec">Gemini（専属エージェント・意味の自動入力）</h3>
    <p class="hint">API キーは20個まで登録できます。1つ目で失敗したら（回数の上限・キーの間違いなど）、2つ目、3つ目…と順に試します。上限は Google のプロジェクトごとなので、予備は別のプロジェクトで作ったキーにしてください。</p>
    ${(() => {
      // 登録済みのキーの欄＋空の欄を1つ出す。「＋ 欄を増やす」で20個まで
      const keyName = (i) => (i === 1 ? "gemini_key" : "gemini_key" + i);
      const used = [...Array(20).keys()].map((i) => i + 1).filter((i) => sec[keyName(i)]);
      const show = Math.min(20, Math.max(admKeyRows, (used.length ? Math.max(...used) : 0) + 1));
      admKeyRows = show;
      return [...Array(show).keys()].map((i) => i + 1).map((i) => inp(keyName(i), `API キー ${i}`, i === 1 ? "AIza…（空で保存すると削除）" : "予備（なくても大丈夫）", true)).join("")
        + `<div class="row"><span class="note">登録済み ${used.length} / 20</span>${show < 20 ? `<button class="btn sm" id="admMoreKey">＋ 欄を増やす</button>` : ""}</div>`;
    })()}
    ${inp("gemini_model", "モデル", "gemini-3.6-flash")}
    ${inp("ai_daily_limit", "1人1日の AI 利用回数", "40")}
    ${inp("agent_enabled", "専属エージェント（on / off）", "on")}
    <div class="row" style="align-items:flex-start"><button class="btn" id="admAi">AI の動作確認</button><span class="note" id="admAiOut"></span></div></div>
  <div class="card adm-grid"><h3 class="sec">AgentMail（保護者へのメール）</h3>
    ${inp("agentmail_key", "API キー", "am_…（空で保存すると削除）", true)}
    ${inp("agentmail_inbox", "送信元 inbox_id", "AgentMail の inbox_id")}
    ${inp("sender_name", "差出人の名前（メールに表示される名前）", "Engdy")}
    <div class="row"><button class="btn" id="admSender">差出人の名前をいますぐ反映</button><span class="note" id="admSenderOut">${st.sender_applied ? "反映済み：" + esc(String(st.sender_applied).split("|").slice(1).join("|")) : "まだ反映していません（次の送信のときにも自動で反映します）"}</span></div>
    ${inp("mail_enabled", "自動送信（on / off）", "on")}
    <label>テスト送信先<span class="row"><input class="grow" id="admTo" type="email" placeholder="自分のメールアドレス"><select id="admFreq"><option value="daily">毎日</option><option value="weekly" selected>毎週</option><option value="monthly">毎月</option></select><button class="btn sm" id="admTest">テスト送信</button></span></label>
    <div class="row"><button class="btn" id="admRun">今日の分をいますぐ送る</button></div>
    <p class="hint">自動送信：毎日 19:00（日本時間）。毎日の人は毎日、毎週の人は日曜、毎月の人は1日（前の月の分）。認証が済んだ人だけに送ります。</p>
    <table class="wtable"><tr><th>日時</th><th>結果</th><th>内容</th></tr>${(r.mail_log || []).map((l) => `<tr><td>${new Date(l.sent_at).toLocaleString("ja-JP")}</td><td>${l.ok ? "✓" : "✕"}</td><td>${esc(l.info || "")}</td></tr>`).join("") || `<tr><td colspan="3" class="note">まだ送信していません</td></tr>`}</table>
  </div>`;
  $$("[data-save]", body).forEach((b) => b.onclick = async () => {
    const k = b.dataset.save, v = $(`[data-k="${k}"]`, body).value;
    const x = await rpc("engdy_admin_set", { p_token: token(), p_name: k, p_value: v }).catch(() => null);
    toast(x && x.ok ? "保存しました" : reasonText(x && x.reason)); if (x && x.ok) renderAdmin();
  });
  const mk = $("#admMoreKey"); if (mk) mk.onclick = () => { admKeyRows = Math.min(20, admKeyRows + 1); renderAdmin(); };
  $("#admSender").onclick = async () => { $("#admSenderOut").textContent = "反映中…"; const x = await fn("admin_set_sender"); $("#admSenderOut").textContent = x.ok ? `反映しました：${x.name}` : reasonText(x.reason); };
  $("#admAi").onclick = async () => {
    $("#admAiOut").textContent = "確認中…（キーごとに試します）";
    const x = await fn("admin_test_ai");
    $("#admAiOut").innerHTML = x.ok ? x.results.map((r) => `${r.ok ? "✓" : "✕"} キー${r.name.replace("gemini_key", "") || 1}：${esc(r.ok ? r.info : reasonText(r.info))}`).join("<br>") : esc(reasonText(x.reason));
  };
  $("#admTest").onclick = async () => { const x = await fn("admin_test_mail", { to: $("#admTo").value, freq: $("#admFreq").value }); toast(x.ok ? "テストメールを送りました" : reasonText(x.reason)); if (x.ok) renderAdmin(); };
  $("#admRun").onclick = async () => {
    if (!(await confirmBox("今日の分を送りますか？", "今日が送る日になっている人（毎日の人、日曜なら毎週の人、1日なら毎月の人）に、いますぐレポートを送ります。", "送る"))) return;
    const x = await fn("admin_run_reports"); toast(x.ok ? `送信 ${x.sent}件 / 失敗 ${x.failed}件` : reasonText(x.reason)); renderAdmin();
  };
}

// ================= 起動 =================
async function boot() {
  applySkin();
  applyFontSize();
  // アプリとして使う仕組み（インストール・更新のお知らせ・オフライン）
  initPwa();
  onPwaChange(() => { if (document.querySelector("#s-main.active")) renderInstall(); if (document.querySelector("#s-settings.active")) renderAppCard(); });
  const q = new URLSearchParams(location.search);
  // メールの「送信停止」リンク
  if (q.get("unsub")) {
    const r = await rpc("engdy_unsubscribe", { p_unsub: q.get("unsub") }).catch(() => null);
    history.replaceState(null, "", location.pathname);
    setTimeout(() => modal(`<p class="kicker">PARENT MAIL</p><h3>${r && r.ok ? "送信を停止しました" : "停止できませんでした"}</h3>
      <p>${r && r.ok ? "Engdy からの学習レポートは、今後届きません。再開は、学習する人のアプリの「保護者メール」からできます。" : "リンクが古いか、すでに解除されています。"}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>OK</button></div>`), 300);
  }
  if (q.get("verify")) {
    const r = await rpc("engdy_parent_verify", { p_verify: q.get("verify") }).catch(() => null);
    history.replaceState(null, "", location.pathname);
    const msg = r && r.ok
      ? `<h3>認証できました</h3><p>${esc(r.name || "")} さんの学習レポートが、<b>${freqJa(r.freq)}</b> このメールアドレスに届くようになりました。</p><p class="hint">いつでも、メールの中のリンクから送信を止められます。</p>`
      : `<h3>認証できませんでした</h3><p>${r && r.reason === "expired" ? "リンクの期限（48時間）が切れています。学習する人のアプリの「保護者メール」から、確認メールをもう一度送ってください。" : "リンクが正しくないか、すでに認証が済んでいます。"}</p>`;
    setTimeout(() => modal(`<p class="kicker">PARENT MAIL</p>${msg}<div class="row" style="justify-content:flex-end"><button class="btn pri" data-close>OK</button></div>`), 300);
  }
  const GO_OK = ["browse", "test", "memo", "stats", "create", "gacha"];
  if (GO_OK.includes(q.get("go"))) { pendingGo = q.get("go"); history.replaceState(null, "", location.pathname); }
  if (q.get("list")) { pendingShared = q.get("list"); history.replaceState(null, "", location.pathname); }

  if (window.KaAccount) {
    await Promise.race([KaAccount.ready, sleep(4000)]).catch(() => {});
    KaAccount.onChange((p) => {
      renderAccount();
      if (p && document.querySelector("#s-login.active")) enterApp();
      if (document.querySelector("#s-main.active")) renderMain();
    });
  }
  const offlineSession = !window.KaAccount && !!localStorage.getItem("ka_session");   // オフラインで SDK が読めないとき
  if ((window.KaAccount && KaAccount.isLoggedIn()) || localStorage.getItem("engdy_guest") === "1" || offlineSession) enterApp();
  else go("login");
}
boot();
