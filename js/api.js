// サーバーとのやりとり（Supabase の RPC と Edge Function）
const URL_BASE = "https://kifnzvktwbomxthzvvgy.supabase.co";
// 公開用の anon key（かるわかGAMES の SDK と同じ。公開しても問題ないキー）
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZm56dmt0d2JvbXh0aHp2dmd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MzgxMzgsImV4cCI6MjA5MzQxNDEzOH0.M7nXP-u--6J_6rRpgz1cJj21_7KX6MtfTmZy77Xf_IE";

export const token = () => (window.KaAccount && KaAccount.token()) || null;
export const me = () => (window.KaAccount && KaAccount.user()) || null;

export async function rpc(fn, args = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

export async function fn(action, args = {}) {
  const res = await fetch(`${URL_BASE}/functions/v1/engdy-api`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ka_token: token(), ...args }),
  });
  try { return await res.json(); } catch (e) { return { ok: false, reason: "http " + res.status }; }
}

// サーバーの理由コードを日本語に
export function reasonText(r) {
  const map = {
    auth: "ログインが必要です（ログインし直してください）", forbidden: "権限がありません", limit: "今日の利用回数の上限に達しました",
    no_gemini_key: "AI がまだ設定されていません（管理者が設定します）", no_agentmail: "メール送信がまだ設定されていません（管理者が設定します）",
    disabled: "いまは停止中です", email: "メールアドレスの形が正しくありません", title: "タイトルを入れてください（60文字まで）",
    password: "パスワードは4〜64文字にしてください", wrong_password: "パスワードが違います", too_many: "失敗が多すぎます。10分ほど待ってください",
    notfound: "リストが見つかりません", count: "単語の数が多すぎるか、ありません", payload: "データが大きすぎます", parse: "AI の返事を読み取れませんでした。もう一度試してください",
  };
  if (!r) return "通信できませんでした";
  if (map[r]) return map[r];
  if (/^gemini_/.test(r)) return "AI の呼び出しに失敗しました（" + r + "）";
  if (/^agentmail_/.test(r)) return "メール送信に失敗しました（" + r.slice(0, 40) + "）";
  return "エラー：" + r;
}
