// 暗号化（ENGDY2）
//   中身（JSON）→ gzip で圧縮 → Base64 → AES-256-GCM（ヘッダーも改ざん検知の対象）
//   形："ENGDY2." + ヘッダー（Base64URL の JSON） + "." + 暗号文（Base64URL）
// 鍵の種類（ヘッダーの m）
//   k：アプリの鍵。中身をそのまま読めなくするためのもの（鍵がアプリに入っているので、本当の秘密は守れない）
//   p：パスワードから作る鍵（PBKDF2-SHA256・60万回）。パスワードを知らない人には読めない
//   r：その場で作るランダムな鍵（256ビット）。鍵は共有 URL の「#」より後ろだけに入れ、サーバーには送らない
// 古い形（ENGDY1:K: / ENGDY1:P:）も、そのまま読める
const APP_KEY_HEX = "6b2f91d04ce3a7581e0b9f2c7d36a4e8f15c02b9a7e4d6183c5f0a2e9b7d4c61";
const PBKDF2_ITER = 600000;          // 新しく作るパスワード鍵（OWASP の目安）
const PBKDF2_ITER_V1 = 150000;       // 古い形（ENGDY1:P:）
const enc = new TextEncoder(), dec = new TextDecoder();

// ---- 変換の小物 ----
const toB64 = (bytes) => { let s = ""; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const toB64u = (bytes) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => fromB64(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---- 圧縮（使えないブラウザでは圧縮しない） ----
const canZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
const gzip = (b) => pipe(b, new CompressionStream("gzip"));
const gunzip = (b) => pipe(b, new DecompressionStream("gzip"));

// ---- 鍵 ----
let appKey;
async function getAppKey() {
  if (!appKey) appKey = await crypto.subtle.importKey("raw", hex(APP_KEY_HEX), "AES-GCM", false, ["encrypt", "decrypt"]);
  return appKey;
}
async function passKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(String(password).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const rawKey = (bytes) => crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);

// ---- 暗号化 ----
// seal(obj)：アプリの鍵 ／ seal(obj, "パスワード") または seal(obj, { password })：パスワード鍵
export async function seal(obj, opt) {
  const o = typeof opt === "string" ? { password: opt } : opt || {};
  return (await sealWith(obj, o.password ? "p" : "k", o)).text;
}
// ランダムな鍵で暗号化して、鍵も返す（URL 限定の共有用）。{ text, key }
export async function sealWithNewKey(obj) {
  const key = rand(32);
  const r = await sealWith(obj, "r", { keyBytes: key });
  return { text: r.text, key: toB64u(key) };
}
async function sealWith(obj, m, o) {
  let body = enc.encode(JSON.stringify(obj));
  const z = canZip ? 1 : 0;
  if (z) body = await gzip(body);
  const inner = enc.encode(toB64(body));             // Base64 にしてから暗号化（最初の仕様どおり）
  const iv = rand(12);
  const head = { v: 2, m, iv: toB64u(iv), z };
  let key;
  if (m === "p") { const s = rand(16); head.s = toB64u(s); head.it = PBKDF2_ITER; key = await passKey(o.password, s, PBKDF2_ITER); }
  else if (m === "r") key = await rawKey(o.keyBytes);
  else key = await getAppKey();
  const h = toB64u(enc.encode(JSON.stringify(head)));
  // ヘッダーを「追加認証データ」にして、ヘッダーを書きかえると復号できないようにする
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(h) }, key, inner));
  return { text: `ENGDY2.${h}.${toB64u(ct)}` };
}

// どの鍵が必要かを調べる："k"（いらない）・"p"（パスワード）・"r"（URL の鍵）
export function lockType(text) {
  text = String(text || "").trim();
  if (text.startsWith("ENGDY1:P:")) return "p";
  if (text.startsWith("ENGDY1:K:")) return "k";
  if (text.startsWith("ENGDY2.")) { try { return JSON.parse(dec.decode(fromB64u(text.split(".")[1]))).m || "k"; } catch (e) { return "?"; } }
  return "?";
}

// ---- 復号（失敗したら例外。"need_password" / "need_key" / "format"） ----
// open(text) ／ open(text, "パスワード") ／ open(text, { password, key })
export async function open(text, opt) {
  const o = typeof opt === "string" ? { password: opt } : opt || {};
  text = String(text || "").trim();
  // 古い形
  if (text.startsWith("ENGDY1:K:")) {
    const b = fromB64(text.slice(9));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, await getAppKey(), b.subarray(12));
    return JSON.parse(dec.decode(fromB64(dec.decode(plain))));
  }
  if (text.startsWith("ENGDY1:P:")) {
    if (!o.password) throw new Error("need_password");
    const b = fromB64(text.slice(9));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(16, 28) }, await passKey(o.password, b.subarray(0, 16), PBKDF2_ITER_V1), b.subarray(28));
    return JSON.parse(dec.decode(fromB64(dec.decode(plain))));
  }
  // 新しい形
  if (!text.startsWith("ENGDY2.")) throw new Error("format");
  const [, h, c] = text.split(".");
  if (!h || !c) throw new Error("format");
  let head;
  try { head = JSON.parse(dec.decode(fromB64u(h))); } catch (e) { throw new Error("format"); }
  let key;
  if (head.m === "p") { if (!o.password) throw new Error("need_password"); key = await passKey(o.password, fromB64u(head.s), Math.min(5e6, Math.max(1e5, head.it | 0))); }
  else if (head.m === "r") { if (!o.key) throw new Error("need_key"); key = await rawKey(fromB64u(o.key)); }
  else key = await getAppKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(head.iv), additionalData: enc.encode(h) }, key, fromB64u(c));
  let body = fromB64(dec.decode(plain));
  if (head.z) body = await gunzip(body);
  return JSON.parse(dec.decode(body));
}
