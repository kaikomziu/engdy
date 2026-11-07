// みんなとつながる機能：今日の名言・Discord への報告・ランキング
import { $, $$, esc, toast, speak, dayKey } from "./util.js";
import { S, save } from "./store.js";
import { rpc, fn, token, me, reasonText } from "./api.js";
import { onEnter } from "./router.js";
import { DEX } from "./items.js";

// ================= 今日の名言（ZenQuotes。和訳は1日1回だけ AI で、みんなで使い回す） =================
export async function renderQuote() {
  const el = $("#quoteCard"); if (!el) return;
  if (S.settings.showQuote === false) { el.hidden = true; return; }
  const k = dayKey();
  let q = null;
  try { const c = JSON.parse(localStorage.getItem("engdy_quote")); if (c && c.day === k) q = c; } catch (e) {}
  if (!q && navigator.onLine) {
    const r = await fn("quote").catch(() => null);
    if (r && r.ok) { q = { day: k, q: r.q, a: r.a, ja: r.ja }; try { localStorage.setItem("engdy_quote", JSON.stringify(q)); } catch (e) {} }
  }
  if (!q) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="row" style="justify-content:space-between"><p class="kicker">TODAY'S QUOTE</p><button class="link" id="qtSay">🔊</button></div>
    <blockquote>“${esc(q.q)}”</blockquote><p class="qa">— ${esc(q.a)}</p>
    ${q.ja ? `<p class="note" id="qtJa" hidden>${esc(q.ja)}</p><button class="link" id="qtJaB">和訳を見る</button>` : ""}
    <p class="note" style="font-size:10px;margin:4px 0 0">Quotes by ZenQuotes.io</p>`;
  $("#qtSay").onclick = () => speak(q.q, 0.9);
  const jb = $("#qtJaB"); if (jb) jb.onclick = () => { $("#qtJa").hidden = false; jb.remove(); };
}

// ================= Discord に報告（Webhook） =================
export const DISCORD_EVENTS = [
  ["lap", "今日の閲覧が終わったとき（スタンプ）"], ["card", "スタンプカードが完成したとき"],
  ["goal", "今日の目標を達成したとき"], ["best", "テストのベスト記録を更新したとき"],
];
export async function notify(kind, text) {
  const st = S.settings;
  if (!st.discordUrl || !token()) return;
  if (st.discordEvents && st.discordEvents[kind] === false) return;
  const u = me();
  const name = u ? u.display_name || u.username : "だれか";
  const r = await fn("discord", { url: st.discordUrl, content: `📘 **${name}** さん：${text}` }).catch(() => null);
  if (r && !r.ok && /^webhook/.test(r.reason || "")) toast("Discord に送れませんでした（Webhook の URL を確かめてください）", 3500);
}
export async function testDiscord(url) {
  const u = me();
  const r = await fn("discord", { url, content: `📘 Engdy から${u ? `（${u.display_name || u.username} さん）` : ""}テスト送信です。これから学習の報告が届きます。` });
  return r;
}

// ================= ランキング =================
const KINDS = [["streak", "🔥 連続学習", "日"], ["best", "🏅 テストのベスト", "点"], ["dex", "📚 図鑑", "語"], ["minutes", "⏱️ 学習時間", "分"]];
let rankKind = "streak", pushT, lastPush = "";

export function pushRank(streak) {
  if (!token() || S.settings.rankJoin === false) return;
  clearTimeout(pushT);
  pushT = setTimeout(async () => {
    const v = { p_streak: streak(), p_best: S.test.best || 0, p_dex: DEX.filter((d) => S.owned.dex[d.id]).length, p_minutes: Math.floor(S.stats.seconds / 60) };
    const sig = JSON.stringify(v); if (sig === lastPush) return;
    const r = await rpc("engdy_rank_push", { p_token: token(), ...v }).catch(() => null);
    if (r && r.ok) lastPush = sig;
  }, 10000);
}

onEnter("ranking", renderRanking);
async function renderRanking() {
  const body = $("#rankBody");
  const tabs = `<div class="tabs" id="rkTabs">${KINDS.map(([k, t]) => `<button class="tab ${k === rankKind ? "on" : ""}" data-k="${k}">${t}</button>`).join("")}</div>`;
  body.innerHTML = `<div class="card">${tabs}<div id="rkList" style="margin-top:12px"><span class="spinner"></span></div></div>`;
  $("#rkTabs").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { rankKind = b.dataset.k; renderRanking(); } };
  const r = await rpc("engdy_rank_list", { p_kind: rankKind, p_token: token() }).catch(() => null);
  const unit = KINDS.find((x) => x[0] === rankKind)[2];
  if (!r || !r.ok) { $("#rkList").innerHTML = `<p class="empty">${esc(reasonText(r && r.reason))}</p>`; return; }
  const myName = me() ? me().display_name || me().username : null;
  const head = !token() ? `<div class="rank-me"><span>ログインすると、ランキングに参加できます</span><button class="btn sm pri" id="rkLogin">ログイン</button></div>`
    : S.settings.rankJoin === false ? `<div class="rank-me"><span>ランキングに参加していません</span><button class="btn sm pri" id="rkJoin">参加する</button></div>`
    : r.me ? `<div class="rank-me"><span>あなたは <b>${r.me.rank}位</b>（${r.total}人中）</span><b>${r.me.v.toLocaleString()} ${unit}</b></div>`
    : `<div class="rank-me"><span>記録を送っています。少しあとで、もう一度開いてください</span></div>`;
  $("#rkList").innerHTML = head + (r.top.length
    ? `<ol class="rank-list">${r.top.map((x, i) => `<li class="${x.name === myName ? "me" : ""}"><span class="rk ${i < 3 ? "r" + (i + 1) : ""}">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span><span>${esc(x.avatar || "👤")} ${esc(x.name)}</span><b>${Number(x.v).toLocaleString()} <small class="note">${unit}</small></b></li>`).join("")}</ol>`
    : `<p class="empty">まだだれもいません。最初の1人になろう！</p>`)
    + `<p class="hint">ランキングに出るのは、かるわかGAMES の表示名とアイコンだけです。参加は設定でやめられます。</p>`;
  const lb = $("#rkLogin"); if (lb) lb.onclick = () => KaAccount.login("login");
  const jb = $("#rkJoin"); if (jb) jb.onclick = () => { S.settings.rankJoin = true; save(); toast("ランキングに参加しました"); lastPush = ""; renderRanking(); };
}
export async function leaveRank() { if (token()) await rpc("engdy_rank_leave", { p_token: token() }).catch(() => null); lastPush = ""; }
