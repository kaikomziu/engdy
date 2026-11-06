// 暗号化：中身（JSON）→ Base64 → AES-256-GCM → "ENGDY1:K:" + Base64
// パスワード付きの公開リストは、パスワードから鍵を作る（PBKDF2）ので、パスワードを知らない人には読めない。
// ※ "K" 形式の鍵はアプリに入っているため、本当の秘密を守るものではなく「中身をそのまま読めなくする」ためのもの。
const APP_KEY_HEX = "6b2f91d04ce3a7581e0b9f2c7d36a4e8f15c02b9a7e4d6183c5f0a2e9b7d4c61";
const enc = new TextEncoder(), dec = new TextDecoder();

const toB64 = (bytes) => { let s = ""; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const utf8ToB64 = (s) => toB64(enc.encode(s));
const b64ToUtf8 = (s) => dec.decode(fromB64(s));
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

let appKey;
async function getAppKey() {
  if (!appKey) appKey = await crypto.subtle.importKey("raw", hex(APP_KEY_HEX), "AES-GCM", false, ["encrypt", "decrypt"]);
  return appKey;
}
async function passKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// obj を暗号化した文字列にする。password があればパスワード鍵
export async function seal(obj, password) {
  const inner = enc.encode(utf8ToB64(JSON.stringify(obj)));   // まず Base64
  const iv = crypto.getRandomValues(new Uint8Array(12));
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await passKey(password, salt), inner));
    return "ENGDY1:P:" + toB64(concat(salt, iv, ct));
  }
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getAppKey(), inner));
  return "ENGDY1:K:" + toB64(concat(iv, ct));
}

// 復号。失敗したら例外
export async function open(text, password) {
  text = String(text || "").trim();
  let plain;
  if (text.startsWith("ENGDY1:K:")) {
    const b = fromB64(text.slice(9));
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, await getAppKey(), b.subarray(12));
  } else if (text.startsWith("ENGDY1:P:")) {
    if (!password) throw new Error("need_password");
    const b = fromB64(text.slice(9));
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(16, 28) }, await passKey(password, b.subarray(0, 16)), b.subarray(28));
  } else {
    throw new Error("format");
  }
  return JSON.parse(b64ToUtf8(dec.decode(plain)));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
