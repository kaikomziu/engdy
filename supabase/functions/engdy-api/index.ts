// Engdy の API（Gemini と AgentMail を、キーを隠したまま使うための中継）
// キーはブラウザに出さない。管理者が Engdy の admin 画面で設定し、DB に暗号化して保存される。
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://kaikomziu.github.io/engdy/";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-engdy-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Config = { secrets: Record<string, string>; settings: Record<string, string>; cron_secret: string };
async function config(): Promise<Config> {
  const { data, error } = await sb.rpc("engdy_internal_config");
  if (error) throw new Error("config");
  return data as Config;
}
async function account(token: unknown) {
  if (typeof token !== "string" || token.length < 32) return null;
  const { data } = await sb.rpc("engdy_internal_account", { p_token: token });
  return data as { id: string; username: string; display_name: string; is_admin: boolean } | null;
}
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

// ---------- Gemini ----------
// API キーは5つまで（gemini_key, gemini_key2〜5）。1つ目で失敗したら、2つ目、3つ目…と順に試す
type GPart = { text: string } | { inlineData: { mimeType: string; data: string } };
const KEY_NAMES = ["gemini_key", "gemini_key2", "gemini_key3", "gemini_key4", "gemini_key5"];
const geminiKeys = (cfg: Config) => KEY_NAMES.map((n) => ({ n, k: cfg.secrets[n] })).filter((x) => x.k);
// しばらく失敗したキーは、次の数分は後回しにする（同じ処理の中・連続の呼び出しで使う）
const coolDown = new Map<string, number>();

async function geminiOnce(key: string, model: string, payload: unknown) {
  return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(payload),
  });
}

async function gemini(cfg: Config, system: string, contents: { role: string; text: string; image?: { mime: string; data: string } }[], asJson = false, onlyKey?: string) {
  let keys = geminiKeys(cfg);
  if (onlyKey) keys = keys.filter((x) => x.n === onlyKey);
  if (!keys.length) throw new Error("no_gemini_key");
  const now = Date.now();
  // 休ませているキーは後ろへ
  keys.sort((x, y) => ((coolDown.get(x.n) || 0) > now ? 1 : 0) - ((coolDown.get(y.n) || 0) > now ? 1 : 0));
  const model = cfg.settings.gemini_model || "gemini-3.6-flash";
  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: contents.map((c) => ({ role: c.role === "model" ? "model" : "user", parts: [...(c.image ? [{ inlineData: { mimeType: c.image.mime, data: c.image.data } }] : []), { text: c.text }] as GPart[] })),
    generationConfig: { temperature: asJson ? 0.2 : 0.7, maxOutputTokens: 4096, ...(asJson ? { responseMimeType: "application/json" } : {}) },
  };
  let last = 0;
  for (const { n, k } of keys) {
    let res = await geminiOnce(k, model, payload);
    // 混み合い（503・500）は同じキーで1回だけやり直す。回数の上限（429）やキーの間違い（400・401・403）はすぐ次のキーへ
    if (res.status === 503 || res.status === 500) { await new Promise((r) => setTimeout(r, 1200)); res = await geminiOnce(k, model, payload); }
    if (res.ok) {
      coolDown.delete(n);
      const d = await res.json();
      return (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
    }
    last = res.status;
    coolDown.set(n, Date.now() + (res.status === 429 ? 5 * 60e3 : 60e3));
    if (![429, 500, 503, 400, 401, 403].includes(res.status)) break;   // それ以外（リクエストの中身の問題など）は、ほかのキーでも同じなのでやめる
  }
  // 全部だめで、混み合いが理由なら、少し待って1つ目でもう一度
  if ((last === 429 || last === 503) && !onlyKey) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await geminiOnce(keys[0].k, model, payload);
    if (res.ok) { const d = await res.json(); return (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join(""); }
    last = res.status;
  }
  throw new Error("gemini_" + last);
}

async function useAi(cfg: Config, acc: { id: string; is_admin: boolean }) {
  if (acc.is_admin) return true;
  const limit = Math.max(1, parseInt(cfg.settings.ai_daily_limit || "40", 10) || 40);
  const { data } = await sb.rpc("engdy_internal_ai_use", { p_account: acc.id, p_limit: limit });
  return data === true;
}

// ---------- AgentMail ----------
// 差出人の名前（受信箱の表示名）。メールごとには変えられないので、受信箱の設定を書き換える
const senderName = (cfg: Config) => (cfg.settings.sender_name || "Engdy").slice(0, 60);
async function applySender(cfg: Config, force = false) {
  const key = cfg.secrets.agentmail_key, inbox = cfg.settings.agentmail_inbox;
  if (!key || !inbox) throw new Error("no_agentmail");
  const name = senderName(cfg);
  if (!force && cfg.settings.sender_applied === `${inbox}|${name}`) return;
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ display_name: name }),
  });
  if (!res.ok) throw new Error("agentmail_name_" + res.status + " " + (await res.text()).slice(0, 120));
  await sb.rpc("engdy_internal_set_setting", { p_name: "sender_applied", p_value: `${inbox}|${name}` });
  cfg.settings.sender_applied = `${inbox}|${name}`;
}
async function sendMail(cfg: Config, to: string, subject: string, html: string, text: string) {
  const key = cfg.secrets.agentmail_key, inbox = cfg.settings.agentmail_inbox;
  if (!key || !inbox) throw new Error("no_agentmail");
  // 差出人の名前がまだ反映されていなければ、先に入れる（失敗してもメールは送る）
  try { await applySender(cfg); } catch (_e) { /* 表示名の反映に失敗しても送信は続ける */ }
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ to, subject, html, text }),
  });
  if (!res.ok) throw new Error("agentmail_" + res.status + " " + (await res.text()).slice(0, 120));
  return await res.json();
}

type Day = { day: string; seconds: number; words: number; laps: number; test_total: number; test_correct: number };
type Freq = "daily" | "weekly" | "monthly";
type Target = { account: string; email: string; unsub: string; name: string; freq: Freq; days: Day[] };
const FREQ_JA: Record<Freq, string> = { daily: "毎日", weekly: "毎週", monthly: "毎月" };
const WRAP = (inner: string) => `<div style="font-family:system-ui,'Hiragino Sans','Yu Gothic',sans-serif;max-width:560px;margin:auto;color:#22312b;line-height:1.6">${inner}</div>`;
const FOOT = (unsub: string) => `<p style="font-size:12px;color:#888;margin-top:24px">このメールは、英語学習アプリ Engdy（かるわかGAMES）の利用者が、保護者のメールアドレスとして登録したため届いています。<br>今後受け取らない場合は <a href="${unsub}">こちらから送信を停止</a> できます。</p>`;

// 期間の見出し
function periodLabel(freq: Freq, from: string, to: string) {
  if (freq === "daily") return { title: "今日の英語学習", kicker: "ENGDY DAILY", subject: "今日の学習レポート", none: "今日の記録はありませんでした。" };
  if (freq === "weekly") return { title: "1週間の英語学習", kicker: "ENGDY WEEKLY", subject: "1週間の学習レポート", none: "この1週間の記録はありませんでした。" };
  const m = Number(from.slice(5, 7));
  return { title: `${m}月の英語学習`, kicker: "ENGDY MONTHLY", subject: `${m}月の学習レポート`, none: `${m}月の記録はありませんでした。` };
}

function reportMail(t: Target, freq: Freq, from: string, to: string, comment = "") {
  const L = periodLabel(freq, from, to);
  const sum = t.days.reduce((a, d) => ({
    seconds: a.seconds + d.seconds, words: a.words + d.words, laps: a.laps + d.laps,
    test_total: a.test_total + d.test_total, test_correct: a.test_correct + d.test_correct,
  }), { seconds: 0, words: 0, laps: 0, test_total: 0, test_correct: 0 });
  const min = Math.round(sum.seconds / 60);
  const rate = sum.test_total ? Math.round((sum.test_correct / sum.test_total) * 100) + "%" : "—";
  const active = t.days.filter((d) => d.seconds > 0 || d.test_total > 0).length;
  const unsub = `${SITE}?unsub=${t.unsub}`;
  const td = "padding:6px 10px;border-bottom:1px solid #eee";
  const rows = t.days.filter((d) => d.seconds > 0 || d.test_total > 0 || d.words > 0).map((d) =>
    `<tr><td style="${td}">${esc(d.day)}</td><td style="${td};text-align:right">${Math.round(d.seconds / 60)}分</td><td style="${td};text-align:right">${d.words}語</td><td style="${td};text-align:right">${d.test_total ? Math.round(d.test_correct / d.test_total * 100) + "%" : "—"}</td></tr>`
  ).join("") || `<tr><td colspan="4" style="padding:10px;color:#888">${L.none}</td></tr>`;
  const third = freq === "daily" ? `1周した回数<br><b style="font-size:20px">${sum.laps}回</b>` : `学習した日<br><b style="font-size:20px">${active}日</b>`;
  const html = WRAP(`<p style="font-size:12px;letter-spacing:.2em;color:#5b7d6f">${L.kicker}</p>
<h1 style="font-size:20px;margin:0 0 4px">${esc(t.name)} さんの${L.title}</h1>
<p style="font-size:13px;color:#666;margin:0 0 12px">${from === to ? esc(from) : `${esc(from)} 〜 ${esc(to)}`}</p>
<table style="width:100%;border-collapse:collapse;margin:12px 0;background:#f4f7f5;border-radius:10px">
<tr><td style="padding:12px">学習時間<br><b style="font-size:20px">${min}分</b></td><td style="padding:12px">見た単語<br><b style="font-size:20px">${sum.words}語</b></td><td style="padding:12px">${third}</td><td style="padding:12px">テスト正答率<br><b style="font-size:20px">${rate}</b></td></tr></table>
${freq === "daily" ? "" : `<table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="color:#5b7d6f"><th style="text-align:left;padding:6px 10px">日付</th><th style="text-align:right;padding:6px 10px">時間</th><th style="text-align:right;padding:6px 10px">単語</th><th style="text-align:right;padding:6px 10px">正答率</th></tr>${rows}</table>`}
${comment ? `<div style="margin-top:16px;padding:12px 14px;background:#fff8e6;border-radius:10px;font-size:14px"><b style="font-size:12px;color:#8a6420">AI コーチのひとこと</b><br>${esc(comment)}</div>` : ""}
<p style="font-size:13px;color:#555;margin-top:18px">学習時間は、放置していた時間を除いた「ちゃんと取り組んだ時間」です。</p>${FOOT(unsub)}`);
  const text = `${t.name} さんの${L.title}（Engdy）\n${from === to ? from : `${from} 〜 ${to}`}\n学習時間 ${min}分 / 見た単語 ${sum.words}語 / テスト正答率 ${rate}\n\n` +
    (freq === "daily" ? "" : t.days.map((d) => `${d.day}  ${Math.round(d.seconds / 60)}分  ${d.words}語`).join("\n") + "\n\n") +
    `送信の停止: ${unsub}`;
  return { subject: `【Engdy】${t.name} さんの${L.subject}`, html, text };
}

// 認証メール（仮登録 → ボタンで本登録）
function verifyMail(name: string, token: string, freq: Freq) {
  const url = `${SITE}?verify=${token}`;
  const html = WRAP(`<p style="font-size:12px;letter-spacing:.2em;color:#5b7d6f">ENGDY</p>
<h1 style="font-size:20px;margin:0 0 12px">学習レポートの受け取りを確認してください</h1>
<p>${esc(name)} さんが、英語学習アプリ <b>Engdy</b> で、このメールアドレスを保護者の連絡先として登録しました。</p>
<p>受け取る場合は、下のボタンを押してください。<b>${FREQ_JA[freq]}</b>、学習時間・見た単語の数・テストの正答率をお知らせします。</p>
<p style="text-align:center;margin:28px 0"><a href="${url}" style="display:inline-block;background:#2f6f5e;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:999px">受け取りを認証する</a></p>
<p style="font-size:13px;color:#666">ボタンを押せない場合は、次のURLを開いてください。<br><a href="${url}" style="word-break:break-all">${url}</a></p>
<p style="font-size:13px;color:#666">このリンクは48時間有効です。心当たりがない場合は、このメールを無視してください（認証しなければ、レポートは届きません）。</p>`);
  const text = `${name} さんが、英語学習アプリ Engdy で、このメールアドレスを保護者の連絡先として登録しました。\n受け取る場合は、次のURLを開いて認証してください（48時間有効）。\n${url}\n\n心当たりがない場合は、このメールを無視してください。`;
  return { subject: "【Engdy】学習レポートの受け取りを確認してください", html, text };
}

// 今日送る頻度（日本時間）：毎日はいつも、毎週は日曜、毎月は1日
function dueFreqs(): Freq[] {
  const jst = new Date(Date.now() + 9 * 3600e3);
  const out: Freq[] = ["daily"];
  if (jst.getUTCDay() === 0) out.push("weekly");
  if (jst.getUTCDate() === 1) out.push("monthly");
  return out;
}

async function sendReports(cfg: Config, freqs: Freq[], accountId: string | null = null) {
  if (cfg.settings.mail_enabled === "off" && !accountId) return { sent: 0, failed: 0, skipped: "disabled" };
  let sent = 0, failed = 0;
  for (const freq of freqs) {
    const { data } = await sb.rpc("engdy_internal_reports", { p_freq: freq, p_account: accountId });
    const r = (data || {}) as { from: string; to: string; targets: Target[] };
    for (const t of r.targets || []) {
      try {
        const m = reportMail(t, freq, r.from, r.to, await aiComment(cfg, t, freq));
        await sendMail(cfg, t.email, m.subject, m.html, m.text);
        await sb.rpc("engdy_internal_mark", { p_account: t.account, p_ok: true, p_info: `${accountId ? "manual" : "auto"}:${freq}` });
        sent++;
      } catch (e) {
        await sb.rpc("engdy_internal_mark", { p_account: t.account, p_ok: false, p_info: `${freq}: ${String((e as Error).message)}` });
        failed++;
      }
    }
  }
  return { sent, failed };
}

// ---- AI の結果の使い回し（利用者みんなで共有） ----
const ck = (w: unknown) => String(w ?? "").trim().toLowerCase();
async function cacheGet(kind: string, keys: string[]): Promise<Record<string, unknown>> {
  if (!keys.length) return {};
  const { data } = await sb.rpc("engdy_internal_cache_get", { p_kind: kind, p_keys: [...new Set(keys)] });
  return (data || {}) as Record<string, unknown>;
}
async function cachePut(kind: string, items: Record<string, unknown>) {
  if (!Object.keys(items).length) return;
  try { await sb.rpc("engdy_internal_cache_put", { p_kind: kind, p_items: items }); } catch (_e) { /* 保存に失敗しても結果は返す */ }
}
async function aiStat(saved: number, called: number) { try { await sb.rpc("engdy_internal_ai_stat", { p_saved: saved, p_called: called }); } catch (_e) { /* 無視 */ } }

// AI の JSON の返事を読む（```json で囲まれていても大丈夫に）
function parseJson(out: string) {
  const t = out.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(t);
}
const wordsOf = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map((w) => clip(w, 60).trim()).filter(Boolean).slice(0, n);

// 保護者メール（毎週・毎月）に入れる、AI のひとこと
async function aiComment(cfg: Config, t: Target, freq: Freq) {
  if (!geminiKeys(cfg).length || freq === "daily") return "";
  const sum = t.days.reduce((a, d) => ({ s: a.s + d.seconds, w: a.w + d.words, tt: a.tt + d.test_total, tc: a.tc + d.test_correct, n: a.n + (d.seconds > 0 || d.test_total > 0 ? 1 : 0) }), { s: 0, w: 0, tt: 0, tc: 0, n: 0 });
  try {
    const out = await gemini(cfg, "あなたは英語学習アプリ Engdy のコーチです。保護者向けに、子どもの学習記録から、良かった点と次へのひとことを、やさしい日本語で3文以内で書いてください。数字を使って具体的に。絵文字や記号の装飾は使わない。",
      [{ role: "user", text: `期間: ${freq === "weekly" ? "1週間" : "1か月"}\n学習した日: ${sum.n}日\n学習時間: ${Math.round(sum.s / 60)}分\n見た単語: ${sum.w}語\nテスト: ${sum.tt}問中${sum.tc}問正解\n日ごとの記録: ${JSON.stringify(t.days.map((d) => [d.day, Math.round(d.seconds / 60), d.words]))}` }]);
    return clip(out.trim(), 400);
  } catch (_e) { return ""; }
}

// ---------- AI のプロンプト ----------
const SYS_MEANING = `あなたは中高生向けの英和辞書です。与えられた英単語・英熟語それぞれに、最も代表的な日本語の意味を短く付けてください（例:「りんご」「〜を走る、運営する」）。品詞が複数あれば主要なものを読点で2つまで。
必ず JSON オブジェクトだけを返します。形式: {"items":[{"word":"apple","meaning":"りんご"}]}。入力の順番と綴りをそのまま保ってください。英語でない・不明な語は meaning を空文字に。`;

const SYS_AGENT = `あなたは Engdy の「専属エージェント」。英単語学習を手伝う、落ち着いて優しいコーチです。
- ユーザーのテスト記録（苦手な単語＝間違いが多い単語）が渡されます。それを根拠に話してください。
- 日本語で、短い段落と箇条書きで読みやすく。Markdown は **太字** と箇条書き（- ）だけを使い、見出しや表は使わない。
- 英単語の説明には、意味・使い方・短い例文（和訳つき）・覚え方のコツを入れる。
- 勉強に関係ない依頼には、やんわり英語学習に話を戻す。個人情報は聞かない。`;

function weakText(weak: unknown) {
  if (!Array.isArray(weak)) return "（記録なし）";
  return weak.slice(0, 30).map((w: Record<string, unknown>) =>
    `- ${clip(w.w, 60)}（${clip(w.m, 60)}）: ${Number(w.miss) || 0}回まちがい / ${Number(w.total) || 0}回中`
  ).join("\n") || "（記録なし）";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "json" }, 400); }
  const action = String(body.action || "");
  let accForRefund: { id: string; is_admin: boolean } | null = null;
  try {
    const cfg = await config();

    // 定期実行（pg_cron から）
    if (action === "reports" || action === "weekly") {
      if (!cfg.cron_secret || req.headers.get("x-engdy-cron") !== cfg.cron_secret) return json({ ok: false, reason: "forbidden" }, 403);
      return json({ ok: true, ...(await sendReports(cfg, dueFreqs())) });
    }

    const acc = await account(body.ka_token);
    if (!acc) return json({ ok: false, reason: "auth" }, 401);
    accForRefund = acc;

    // 保護者のメールアドレスへ認証メールを送る（仮登録 → 本登録）
    if (action === "parent_verify_send") {
      const { data } = await sb.rpc("engdy_internal_verify_prepare", { p_account: acc.id });
      const v = data as { ok: boolean; reason?: string; email?: string; token?: string; name?: string; freq?: Freq };
      if (!v || !v.ok) return json({ ok: false, reason: v ? v.reason : "error" });
      const m = verifyMail(v.name || acc.display_name, v.token!, v.freq || "weekly");
      try {
        await sendMail(cfg, v.email!, m.subject, m.html, m.text);
        await sb.rpc("engdy_internal_mark", { p_account: acc.id, p_ok: true, p_info: "verify" });
      } catch (e) {
        await sb.rpc("engdy_internal_mark", { p_account: acc.id, p_ok: false, p_info: "verify: " + String((e as Error).message) });
        throw e;
      }
      return json({ ok: true });
    }

    // ---- 単語の意味（みんなで使い回す。保存済みの単語は AI を呼ばない） ----
    if (action === "meanings") {
      const words = (Array.isArray(body.words) ? body.words : []).map((w) => clip(w, 60).trim()).filter(Boolean).slice(0, 150);
      if (!words.length) return json({ ok: false, reason: "empty" });
      const hit = await cacheGet("meaning", words.map(ck));
      const need = words.filter((w) => !hit[ck(w)]);
      const items = words.filter((w) => hit[ck(w)]).map((w) => ({ word: w, meaning: String(hit[ck(w)]) }));
      if (need.length) {
        if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
        const out = await gemini(cfg, SYS_MEANING, [{ role: "user", text: JSON.stringify(need) }], true);
        let got: { word: string; meaning: string }[] = [];
        try { got = parseJson(out).items || []; } catch { return json({ ok: false, reason: "parse" }); }
        const put: Record<string, string> = {};
        for (const i of got) { const m = clip(i.meaning, 80); if (i.word && m) { put[ck(i.word)] = m; items.push({ word: clip(i.word, 60), meaning: m }); } }
        await cachePut("meaning", put);
      }
      await aiStat(need.length ? 0 : 1, need.length ? 1 : 0);
      return json({ ok: true, items, cached: words.length - need.length, ai: need.length > 0 });
    }

    // ---- テーマから単語リストを作る（同じテーマ・語数・むずかしさなら使い回す。「別の案」は作り直す） ----
    if (action === "gen_list") {
      const theme = clip(body.theme, 100).trim(); const n = Math.max(5, Math.min(50, Number(body.count) || 20)); const level = clip(body.level, 30);
      if (!theme) return json({ ok: false, reason: "empty" });
      const key = `${ck(theme).replace(/\s+/g, "")}|${n}|${level}`;
      if (!body.fresh) {
        const hit = await cacheGet("genlist", [key]);
        if (hit[key]) { await aiStat(1, 0); return json({ ok: true, ...(hit[key] as object), cached: true }); }
      }
      if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
      const out = await gemini(cfg, `あなたは中高生向けの英語の先生です。指定のテーマに合う英単語・英熟語を${n}個選び、それぞれ代表的な日本語の意味を短く付けてください。重複なし、実際によく使うものを優先。難しさ: ${level || "テーマに合わせて"}。
必ず JSON だけを返す: {"title":"リストのタイトル（日本語20文字以内）","items":[{"word":"...","meaning":"..."}]}`, [{ role: "user", text: theme }], true);
      try {
        const j = parseJson(out);
        const res = { title: clip(j.title, 40), items: (j.items || []).slice(0, n).map((i: Record<string, unknown>) => ({ word: clip(i.word, 60), meaning: clip(i.meaning, 80) })) };
        await cachePut("genlist", { [key]: res });
        // ついでに、単語の意味も使い回せるように保存
        await cachePut("meaning", Object.fromEntries(res.items.filter((i: { word: string; meaning: string }) => i.word && i.meaning).map((i: { word: string; meaning: string }) => [ck(i.word), i.meaning])));
        await aiStat(0, 1);
        return json({ ok: true, ...res });
      } catch (_e) { return json({ ok: false, reason: "parse" }); }
    }

    // ---- 似た単語・反対語・派生語（単語ごとに使い回す） ----
    if (action === "related") {
      const words = wordsOf(body.words, 40);
      if (!words.length) return json({ ok: false, reason: "empty" });
      type Rel = { base: string; word: string; meaning: string; type: string };
      const hit = await cacheGet("related", words.map(ck));
      const need = words.filter((w) => !hit[ck(w)]);
      let items: Rel[] = words.filter((w) => hit[ck(w)]).flatMap((w) => hit[ck(w)] as Rel[]);
      if (need.length) {
        if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
        const out = await gemini(cfg, `与えられた英単語それぞれについて、覚えておくと役に立つ「類義語」「反意語」「派生語」を、ある場合だけ合わせて1〜3個あげ、日本語の意味を付けてください。中高生がよく使うものを優先。
必ず JSON だけを返す: {"items":[{"base":"元の単語","word":"関連する単語","meaning":"意味","type":"類義語|反意語|派生語"}]}`, [{ role: "user", text: JSON.stringify(need) }], true);
        let got: Rel[] = [];
        try { got = (parseJson(out).items || []).slice(0, 120).map((i: Record<string, unknown>) => ({ base: clip(i.base, 60), word: clip(i.word, 60), meaning: clip(i.meaning, 80), type: clip(i.type, 6) })); }
        catch (_e) { return json({ ok: false, reason: "parse" }); }
        const put: Record<string, Rel[]> = {};
        for (const w of need) put[ck(w)] = got.filter((g) => ck(g.base) === ck(w));
        await cachePut("related", put);
        items = items.concat(got);
      }
      await aiStat(need.length ? 0 : 1, need.length ? 1 : 0);
      return json({ ok: true, items, cached: words.length - need.length, ai: need.length > 0 });
    }

    // ---- 穴埋め問題（単語ごとに英文をためておき、3つ以上たまった単語は AI を呼ばずにそこから出す） ----
    if (action === "cloze") {
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 10).map((i: Record<string, unknown>) => ({ w: clip(i.w, 60), m: clip(i.m, 80) })).filter((i) => i.w);
      if (!items.length) return json({ ok: false, reason: "empty" });
      type Q = { word: string; answer: string; sentence: string; ja: string };
      const hit = await cacheGet("cloze", items.map((i) => ck(i.w)));
      const pool = (w: string) => ((hit[ck(w)] as Q[]) || []);
      const ready = items.filter((i) => pool(i.w).length >= 3);
      const need = items.filter((i) => pool(i.w).length < 3);
      const qs: Q[] = ready.map((i) => { const p = pool(i.w); return p[Math.floor(Math.random() * p.length)]; });
      if (need.length) {
        if (!(await useAi(cfg, acc))) {
          // 回数の上限でも、ためてある英文があれば出す
          const some = need.filter((i) => pool(i.w).length).map((i) => pool(i.w)[0]);
          if (!qs.length && !some.length) return json({ ok: false, reason: "limit" });
          return json({ ok: true, items: [...qs, ...some], cached: true });
        }
        const out = await gemini(cfg, `中高生向けの英語の穴埋め問題を作ります。与えられた単語それぞれについて、その単語が自然に入る短い英文（8〜14語）を1つ作り、その単語の部分を「___」にしてください。動詞の活用や複数形が必要なら、answer はその形にする（例: go → went）。和訳も付ける。
必ず JSON だけを返す: {"items":[{"word":"元の単語","answer":"空所に入る形","sentence":"英文（___ を含む）","ja":"和訳"}]}`, [{ role: "user", text: JSON.stringify(need) }], true);
        let got: Q[] = [];
        try { got = (parseJson(out).items || []).slice(0, 10).map((i: Record<string, unknown>) => ({ word: clip(i.word, 60), answer: clip(i.answer, 60), sentence: clip(i.sentence, 240), ja: clip(i.ja, 200) })).filter((i: Q) => i.sentence.includes("___")); }
        catch (_e) { return json({ ok: false, reason: "parse" }); }
        const put: Record<string, Q[]> = {};
        for (const g of got) { const k = ck(g.word); const prev = put[k] || pool(g.word); if (!prev.some((x) => x.sentence === g.sentence)) put[k] = [...prev, g].slice(-8); }
        await cachePut("cloze", put);
        qs.push(...got);
      }
      await aiStat(need.length ? 0 : 1, need.length ? 1 : 0);
      return json({ ok: true, items: qs.sort(() => Math.random() - 0.5), cached: !need.length });
    }

    // ---- 英会話ロールプレイ ----
    if (action === "roleplay") {
      if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
      const scene = clip(body.scene, 60) || "自由な会話";
      const words = wordsOf(body.words, 8);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-12).map((h: Record<string, unknown>) => ({ role: h.role === "model" ? "model" : "user", text: clip(h.text, 600) }));
      const msg = clip(body.message, 400);
      const sys = `あなたは英語学習アプリの会話相手です。場面: 「${scene}」。相手は中高生の英語学習者です。
- やさしい英語（1〜2文、15語くらいまで）で、場面に合った役（店員・友だちなど）として返事をし、会話が続くように質問も入れる。
- 練習したい単語: ${words.join(", ") || "なし"}。相手が自然に使えるような流れを作る（直接「使って」とは言わない）。
- 相手の英語に間違いがあれば、feedback に日本語で短く直し方を書く（正しければ「いいね！」など短く）。最初のあいさつのときは feedback は空にする。
必ず JSON だけを返す: {"reply":"英語の返事","ja":"返事の和訳","feedback":"相手の英語へのひとこと（日本語）"}`;
      const out = await gemini(cfg, sys, msg ? [...history, { role: "user", text: msg }] : [{ role: "user", text: "（会話を始めてください。あなたから最初のひとことを）" }], true);
      try { const j = parseJson(out); return json({ ok: true, reply: clip(j.reply, 500), ja: clip(j.ja, 500), feedback: clip(j.feedback, 300) }); }
      catch (_e) { return json({ ok: false, reason: "parse" }); }
    }

    // ---- 振り返りレポート ----
    if (action === "review") {
      if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
      const text = await gemini(cfg, `${SYS_AGENT}\n\n今回は「1週間の振り返りレポート」を書きます。構成: 1) この1週間のまとめ（数字を使って） 2) 伸びたところ 3) 苦手の傾向（どんな種類の単語でまちがえやすいか） 4) 来週の目標を3つ（具体的に）。全体で400字くらい。`,
        [{ role: "user", text: `【記録】\n${clip(body.summary, 3000)}\n【苦手な単語】\n${weakText(body.weak)}` }]);
      return json({ ok: true, text: clip(text, 6000) });
    }

    // ---- 手書きメモの読み取り ----
    if (action === "ocr_memo") {
      const img = String(body.image || "");
      const m = img.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
      if (!m || m[2].length > 4_000_000) return json({ ok: false, reason: "image" });
      if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
      const out = await gemini(cfg, `画像は手書きのノートです。書かれている英単語・英熟語をすべて読み取り、それぞれに日本語の意味を付けてください。ノートに日本語の意味が書いてあればそれを優先し、なければ代表的な意味を付ける。英語でない文字や、判読できないものは除く。
必ず JSON だけを返す: {"items":[{"word":"...","meaning":"..."}]}`, [{ role: "user", text: "このノートの英単語を読み取ってください。", image: { mime: m[1], data: m[2] } }], true);
      try { const j = parseJson(out); return json({ ok: true, items: (j.items || []).slice(0, 200).map((i: Record<string, unknown>) => ({ word: clip(i.word, 60), meaning: clip(i.meaning, 80) })).filter((i: { word: string }) => i.word) }); }
      catch (_e) { return json({ ok: false, reason: "parse" }); }
    }

    // ---- ことば図鑑の解説 ----
    if (action === "dex_explain") {
      const w = clip(body.word, 40), ja = clip(body.ja, 60);
      if (!w) return json({ ok: false, reason: "empty" });
      const hit = await cacheGet("dex", [ck(w)]);
      if (hit[ck(w)]) { await aiStat(1, 0); return json({ ok: true, text: String(hit[ck(w)]), cached: true }); }
      if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
      const text = await gemini(cfg, `${SYS_AGENT}\n\n英単語を1つ、図鑑の解説のように紹介します。構成: 語源（どこから来た言葉か）／よく使う言い方（例文2つ、和訳つき）／ちょっと面白い豆知識。全体で250字くらい。呼びかけは入れず、だれが読んでも同じ文章にする。`, [{ role: "user", text: `${w}（${ja}）` }]);
      await cachePut("dex", { [ck(w)]: clip(text, 3000) });
      await aiStat(0, 1);
      return json({ ok: true, text: clip(text, 3000) });
    }

    if (action === "agent") {
      if (cfg.settings.agent_enabled === "off" && !acc.is_admin) return json({ ok: false, reason: "disabled" });
      if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
      const mode = String(body.mode || "chat");
      const ctx = `【${acc.display_name} さんのテスト記録・苦手な単語】\n${weakText(body.weak)}\n【これまでの合計】${clip(body.summary, 200)}`;
      const ask: Record<string, string> = {
        preview: "苦手な単語の中から上位5つを選んで、それぞれ予習用に説明してください。最後にひとこと励ましを。",
        quiz: "苦手な単語から5問の確認クイズを作ってください。形式は「Q1. 英文の空所に入る単語は？（選択肢4つ）」。答えと短い解説は最後に「答え」としてまとめて。",
        plan: "記録を分析して、今週の学習プラン（1日10分想定・7日分）を提案してください。どの単語をどの順に復習するか具体的に。",
        mnemonic: "苦手な単語それぞれに、語源・イメージ・ごろ合わせなど覚えやすいコツを付けてください（上位8つまで）。",
      };
      const history = (Array.isArray(body.history) ? body.history : []).slice(-10).map((h: Record<string, unknown>) => ({
        role: h.role === "model" ? "model" : "user", text: clip(h.text, 2000),
      }));
      const msg = mode === "chat" ? clip(body.message, 1000) : ask[mode] || ask.preview;
      if (!msg.trim()) return json({ ok: false, reason: "empty" });
      const text = await gemini(cfg, SYS_AGENT + "\n\n" + ctx, [...history, { role: "user", text: msg }]);
      return json({ ok: true, text: clip(text, 12000) });
    }

    // ---- ここから管理者だけ ----
    if (!acc.is_admin) return json({ ok: false, reason: "forbidden" }, 403);
    if (action === "admin_test_mail") {
      const to = clip(body.to, 254).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ ok: false, reason: "email" });
      const today = new Date(Date.now() + 9 * 3600e3);
      const days: Day[] = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today.getTime() - (6 - i) * 86400e3);
        return { day: d.toISOString().slice(0, 10), seconds: 300 + i * 120, words: 20 + i * 8, laps: 1 + (i % 2), test_total: 10, test_correct: 6 + (i % 4) };
      });
      const freq: Freq = ["daily", "weekly", "monthly"].includes(String(body.freq)) ? body.freq as Freq : "weekly";
      const m = reportMail({ account: acc.id, email: to, unsub: "test-preview-only-test-preview", name: acc.display_name + "（テスト）", freq, days: freq === "daily" ? days.slice(-1) : days }, freq, freq === "daily" ? days[6].day : days[0].day, days[6].day);
      await sendMail(cfg, to, "[テスト] " + m.subject, m.html, m.text);
      await sb.rpc("engdy_internal_mark", { p_account: null, p_ok: true, p_info: "test" });
      return json({ ok: true });
    }
    if (action === "admin_set_sender") {
      await applySender(cfg, true);
      return json({ ok: true, name: senderName(cfg) });
    }
    if (action === "admin_run_weekly" || action === "admin_run_reports") return json({ ok: true, ...(await sendReports(cfg, dueFreqs())) });
    if (action === "admin_test_ai") {
      const results: { name: string; ok: boolean; info: string }[] = [];
      for (const { n } of geminiKeys(cfg)) {
        try { const out = await gemini(cfg, "日本語で一言だけ返答してください。", [{ role: "user", text: "動作確認です。「OK」と返してください。" }], false, n); results.push({ name: n, ok: true, info: clip(out, 40) }); }
        catch (e) { results.push({ name: n, ok: false, info: String((e as Error).message) }); }
      }
      if (!results.length) return json({ ok: false, reason: "no_gemini_key" });
      return json({ ok: true, results });
    }
    return json({ ok: false, reason: "action" }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    // AI の失敗は、その日の利用回数に数えない
    if (accForRefund && !accForRefund.is_admin && /^gemini_/.test(msg)) { try { await sb.rpc("engdy_internal_ai_refund", { p_account: accForRefund.id }); } catch (_e) { /* 無視 */ } }
    return json({ ok: false, reason: msg }, 200);
  }
});
