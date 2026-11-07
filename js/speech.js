// 発音チェック（ブラウザの音声認識。AI は使わない）
// 単語を声に出して読むと、正しく聞き取れたかを判定する
import { S } from "./store.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();

let rec = null;
// 聞き取って { ok, heard, near } を返す。なにも聞こえなければ heard は ""
export function listen(target, { timeout = 6000 } = {}) {
  return new Promise((resolve) => {
    if (!SR) { resolve({ ok: false, heard: "", unsupported: true }); return; }
    stopListen();
    const r = new SR();
    r.lang = S.settings.accent === "uk" ? "en-GB" : "en-US";
    r.interimResults = false;
    r.maxAlternatives = 5;
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { r.stop(); } catch (e) {} rec = null; resolve(v); };
    const t = norm(target);
    r.onresult = (e) => {
      const alts = [...e.results[0]].map((a) => norm(a.transcript));
      const hit = alts.find((a) => a === t || a.split(" ").includes(t) || a.includes(t));
      // 1文字ちがいくらいなら「おしい」
      const near = !hit && alts.some((a) => lev(a, t) <= Math.max(1, Math.floor(t.length / 5)));
      finish({ ok: !!hit, near, heard: alts[0] || "" });
    };
    r.onerror = (e) => finish({ ok: false, heard: "", error: e.error });
    r.onend = () => finish({ ok: false, heard: "" });
    setTimeout(() => finish({ ok: false, heard: "", timeout: true }), timeout);
    try { r.start(); rec = r; } catch (e) { finish({ ok: false, heard: "", error: "start" }); }
  });
}
export function stopListen() { if (rec) { try { rec.abort(); } catch (e) {} rec = null; } }

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
