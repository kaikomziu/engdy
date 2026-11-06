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
async function gemini(cfg: Config, system: string, contents: { role: string; text: string }[], asJson = false) {
  const key = cfg.secrets.gemini_key;
  if (!key) throw new Error("no_gemini_key");
  const model = cfg.settings.gemini_model || "gemini-3.6-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: contents.map((c) => ({ role: c.role === "model" ? "model" : "user", parts: [{ text: c.text }] })),
      generationConfig: { temperature: asJson ? 0.2 : 0.7, maxOutputTokens: 4096, ...(asJson ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  if (!res.ok) throw new Error("gemini_" + res.status);
  const d = await res.json();
  return (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
}

async function useAi(cfg: Config, acc: { id: string; is_admin: boolean }) {
  if (acc.is_admin) return true;
  const limit = Math.max(1, parseInt(cfg.settings.ai_daily_limit || "40", 10) || 40);
  const { data } = await sb.rpc("engdy_internal_ai_use", { p_account: acc.id, p_limit: limit });
  return data === true;
}

// ---------- AgentMail ----------
async function sendMail(cfg: Config, to: string, subject: string, html: string, text: string) {
  const key = cfg.secrets.agentmail_key, inbox = cfg.settings.agentmail_inbox;
  if (!key || !inbox) throw new Error("no_agentmail");
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ to, subject, html, text }),
  });
  if (!res.ok) throw new Error("agentmail_" + res.status + " " + (await res.text()).slice(0, 120));
  return await res.json();
}

type Day = { day: string; seconds: number; words: number; laps: number; test_total: number; test_correct: number };
type Target = { account: string; email: string; unsub: string; name: string; days: Day[] };

function weeklyMail(t: Target) {
  const sum = t.days.reduce((a, d) => ({
    seconds: a.seconds + d.seconds, words: a.words + d.words, laps: a.laps + d.laps,
    test_total: a.test_total + d.test_total, test_correct: a.test_correct + d.test_correct,
  }), { seconds: 0, words: 0, laps: 0, test_total: 0, test_correct: 0 });
  const min = Math.round(sum.seconds / 60);
  const rate = sum.test_total ? Math.round((sum.test_correct / sum.test_total) * 100) + "%" : "—";
  const active = t.days.filter((d) => d.seconds > 0 || d.test_total > 0).length;
  const unsub = `${SITE}?unsub=${t.unsub}`;
  const rows = t.days.map((d) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(d.day)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${Math.round(d.seconds / 60)}分</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${d.words}語</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${d.test_total ? Math.round(d.test_correct / d.test_total * 100) + "%" : "—"}</td></tr>`
  ).join("") || `<tr><td colspan="4" style="padding:10px;color:#888">この1週間の記録はありませんでした。</td></tr>`;
  const html = `<div style="font-family:system-ui,'Hiragino Sans','Yu Gothic',sans-serif;max-width:560px;margin:auto;color:#22312b">
<p style="font-size:12px;letter-spacing:.2em;color:#5b7d6f">ENGDY WEEKLY</p>
<h1 style="font-size:20px;margin:0 0 12px">${esc(t.name)} さんの1週間の英語学習</h1>
<table style="width:100%;border-collapse:collapse;margin:12px 0;background:#f4f7f5;border-radius:10px">
<tr><td style="padding:12px">学習時間<br><b style="font-size:20px">${min}分</b></td><td style="padding:12px">見た単語<br><b style="font-size:20px">${sum.words}語</b></td><td style="padding:12px">学習した日<br><b style="font-size:20px">${active}日</b></td><td style="padding:12px">テスト正答率<br><b style="font-size:20px">${rate}</b></td></tr></table>
<table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="color:#5b7d6f"><th style="text-align:left;padding:6px 10px">日付</th><th style="text-align:right;padding:6px 10px">時間</th><th style="text-align:right;padding:6px 10px">単語</th><th style="text-align:right;padding:6px 10px">正答率</th></tr>${rows}</table>
<p style="font-size:13px;color:#555;margin-top:18px">学習時間は、放置していた時間を除いた「ちゃんと取り組んだ時間」です。</p>
<p style="font-size:12px;color:#888;margin-top:24px">このメールは、英語学習アプリ Engdy（かるわかGAMES）の利用者が、保護者のメールアドレスとして登録したため届いています。<br>今後受け取らない場合は <a href="${unsub}">こちらから送信を停止</a> できます。</p></div>`;
  const text = `${t.name} さんの1週間の英語学習（Engdy）\n学習時間 ${min}分 / 見た単語 ${sum.words}語 / 学習した日 ${active}日 / テスト正答率 ${rate}\n\n` +
    t.days.map((d) => `${d.day}  ${Math.round(d.seconds / 60)}分  ${d.words}語`).join("\n") +
    `\n\n送信の停止: ${unsub}`;
  return { subject: `【Engdy】${t.name} さんの1週間の学習レポート`, html, text };
}

async function sendWeekly(cfg: Config, accountId: string | null) {
  if (cfg.settings.mail_enabled === "off" && !accountId) return { sent: 0, failed: 0, skipped: "disabled" };
  const { data } = await sb.rpc("engdy_internal_weekly", { p_account: accountId });
  const targets = (data || []) as Target[];
  let sent = 0, failed = 0;
  for (const t of targets) {
    try {
      const m = weeklyMail(t);
      await sendMail(cfg, t.email, m.subject, m.html, m.text);
      await sb.rpc("engdy_internal_mark", { p_account: t.account, p_ok: true, p_info: accountId ? "manual" : "weekly" });
      sent++;
    } catch (e) {
      await sb.rpc("engdy_internal_mark", { p_account: t.account, p_ok: false, p_info: String((e as Error).message) });
      failed++;
    }
  }
  return { sent, failed };
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
  try {
    const cfg = await config();

    // 定期実行（pg_cron から）
    if (action === "weekly") {
      if (!cfg.cron_secret || req.headers.get("x-engdy-cron") !== cfg.cron_secret) return json({ ok: false, reason: "forbidden" }, 403);
      return json({ ok: true, ...(await sendWeekly(cfg, null)) });
    }

    const acc = await account(body.ka_token);
    if (!acc) return json({ ok: false, reason: "auth" }, 401);

    if (action === "meanings") {
      const words = (Array.isArray(body.words) ? body.words : []).map((w) => clip(w, 60).trim()).filter(Boolean).slice(0, 150);
      if (!words.length) return json({ ok: false, reason: "empty" });
      if (!(await useAi(cfg, acc))) return json({ ok: false, reason: "limit" });
      const out = await gemini(cfg, SYS_MEANING, [{ role: "user", text: JSON.stringify(words) }], true);
      let items: { word: string; meaning: string }[] = [];
      try { items = JSON.parse(out.replace(/^```json\s*|```$/g, "")).items || []; } catch { return json({ ok: false, reason: "parse" }); }
      return json({ ok: true, items: items.map((i) => ({ word: clip(i.word, 60), meaning: clip(i.meaning, 80) })) });
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
      const m = weeklyMail({ account: acc.id, email: to, unsub: "test-preview-only-test-preview", name: acc.display_name + "（テスト）", days });
      await sendMail(cfg, to, "[テスト] " + m.subject, m.html, m.text);
      await sb.rpc("engdy_internal_mark", { p_account: null, p_ok: true, p_info: "test" });
      return json({ ok: true });
    }
    if (action === "admin_run_weekly") return json({ ok: true, ...(await sendWeekly(cfg, null)) });
    if (action === "admin_test_ai") {
      const out = await gemini(cfg, "日本語で一言だけ返答してください。", [{ role: "user", text: "動作確認です。「OK」と返してください。" }]);
      return json({ ok: true, text: clip(out, 200) });
    }
    return json({ ok: false, reason: "action" }, 400);
  } catch (e) {
    return json({ ok: false, reason: String((e as Error).message || e) }, 200);
  }
});
