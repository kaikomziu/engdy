// 読み上げ
// 1語の単語は、まず人が録音した本物の発音（Free Dictionary API・Wikimedia Commons）を流す。
// 録音がない単語・熟語・例文は、端末の中でいちばん自然な英語の声で読み上げる。AI は使わない。
import { setSpeaker } from "./util.js";
import { S } from "./store.js";

const KEY = "engdy_pron2";
let cache = {};
try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
let saveT;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => {
  const keys = Object.keys(cache);
  if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach((k) => delete cache[k]);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {}
}, 800); };

const isWord = (t) => /^[a-z]+(?:[-'][a-z]+)?$/i.test(String(t).trim());
const pending = new Map();

// 発音記号と録音の URL を調べる（調べた結果は端末に保存）
export function pron(word) {
  const w = String(word || "").trim().toLowerCase();
  if (!isWord(w)) return Promise.resolve(null);
  if (w in cache) return Promise.resolve(cache[w] || null);
  if (pending.has(w)) return pending.get(w);
  if (!navigator.onLine) return Promise.resolve(null);
  const p = fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)
    .then((r) => (r.ok ? r.json() : r.status === 404 ? [] : Promise.reject()))
    .then(async (d) => {
      const ph = (Array.isArray(d) ? d : []).flatMap((e) => e.phonetics || []);
      const ipa = (Array.isArray(d) && d.find((e) => e.phonetic)?.phonetic) || ph.find((x) => x.text)?.text || "";
      const pick = (re) => ph.find((x) => x.audio && re.test(x.audio)) || null;
      const us = pick(/-us\.mp3$/), uk = pick(/-(uk|gb)\.mp3$/), any = ph.find((x) => x.audio) || null;
      // 録音のもと（Wikimedia Commons）から mp3 を直接もらう（辞書サイトの配信が止まっていても鳴るように）
      const ids = [us, uk, any].map((x) => x && (String(x.sourceUrl || "").match(/curid=(\d+)/) || [])[1]).filter(Boolean);
      const direct = {};
      if (ids.length) {
        try {
          const j = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&pageids=${[...new Set(ids)].join("|")}&prop=videoinfo&viprop=url|derivatives&format=json&origin=*`)).json();
          for (const [id, pg] of Object.entries(j.query?.pages || {})) {
            const vi = (pg.videoinfo || [])[0]; if (!vi) continue;
            direct[id] = ((vi.derivatives || []).find((x) => /mpeg|mp3/.test(x.type || "")) || {}).src || vi.url;
          }
        } catch (e) {}
      }
      const url = (x) => { if (!x) return ""; const id = (String(x.sourceUrl || "").match(/curid=(\d+)/) || [])[1]; return (id && direct[id]) || x.audio || ""; };
      const r = { ipa, us: url(us), uk: url(uk), any: url(any) };
      cache[w] = r.ipa || r.any ? r : 0; persist();
      return cache[w] || null;
    })
    .catch(() => null)
    .finally(() => pending.delete(w));
  pending.set(w, p);
  return p;
}

// ---- 端末の英語の声 ----
let voiceList = [];
const loadVoices = () => { try { voiceList = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang)); } catch (e) {} };
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.addEventListener?.("voiceschanged", loadVoices); }
// 自然に聞こえる声ほど上に（Natural・Online・Neural・Google・Siri など）
function score(v) {
  const n = v.name; let s = 0;
  if (/natural|neural|online/i.test(n)) s += 50;
  if (/premium|enhanced|siri/i.test(n)) s += 40;
  if (/google/i.test(n)) s += 30;
  if (/aria|jenny|guy|ava|andrew|emma|brian|samantha|daniel|libby|sonia|ryan/i.test(n)) s += 10;
  if (v.localService === false) s += 5;
  if (/compact|espeak/i.test(n)) s -= 30;
  return s;
}
export function voices() {
  if (!voiceList.length) loadVoices();
  const acc = S.settings.accent === "uk" ? /GB/i : /US/i;
  return voiceList.slice().sort((a, b) => (score(b) + (acc.test(b.lang) ? 20 : 0)) - (score(a) + (acc.test(a.lang) ? 20 : 0)));
}
function pickVoice() {
  const list = voices();
  return (S.settings.voiceName && list.find((v) => v.name === S.settings.voiceName)) || list[0] || null;
}

let audio = null;
function stopAll() {
  try { speechSynthesis.cancel(); } catch (e) {}
  if (audio) { audio.pause(); audio = null; }
}
function tts(text, rate) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = S.settings.accent === "uk" ? "en-GB" : "en-US";
    u.rate = Math.max(0.5, Math.min(1.5, rate));
    u.volume = Math.max(0, Math.min(1, S.settings.voiceVol ?? 1));
    speechSynthesis.speak(u);
  } catch (e) {}
}

// 読み上げる（util.js の speak() から呼ばれる）
export async function say(text, rate) {
  text = String(text || "").trim(); if (!text) return;
  stopAll();
  const st = S.settings;
  const r = (st.voiceRate || 0.9) * (rate ? rate / 0.9 : 1);
  if (st.voiceMode !== "tts" && isWord(text)) {
    const p = await Promise.race([pron(text), new Promise((ok) => setTimeout(() => ok(null), 1500))]);
    const url = p && (st.accent === "uk" ? p.uk || p.us || p.any : p.us || p.uk || p.any);
    if (url) {
      const a = new Audio(url);
      a.volume = Math.max(0, Math.min(1, st.voiceVol ?? 1));
      a.playbackRate = Math.max(0.6, Math.min(1.3, r / 0.9));
      audio = a;
      // 鳴らせなかったら（配信元の不調など）、合成音声に切りかえる
      const ok = await new Promise((done) => {
        a.onerror = () => done(false);
        a.play().then(() => done(true)).catch(() => done(false));
        setTimeout(() => done(!a.paused), 2500);
      });
      if (ok) return;
      audio = null;
    }
  }
  tts(text, r);
}
setSpeaker(say);

// 発音記号（設定でオフにできる）
export async function ipaOf(word) {
  if (S.settings.showIpa === false) return "";
  const p = await pron(word);
  return (p && p.ipa) || "";
}
// 次の単語を先に調べておく（待ち時間を減らす）
export const prefetch = (word) => { if (S.settings.voiceMode !== "tts" || S.settings.showIpa !== false) pron(word); };
