// 音：BGM（mp3）・効果音（mp3）・合成音（Web Audio）
// 設定：BGM のオン・オフと音量、場面ごとの曲。効果音のオン・オフと音量、種類ごとのオン・オフ
import { S } from "./store.js";

// ---- BGM の曲 ----
export const TRACKS = [
  { id: "menu", title: "ほっこりひととき", by: "ふぁいの音楽置き場" },
  { id: "study", title: "静かな図書室で", by: "ふぁいの音楽置き場" },
  { id: "test", title: "おひるすぎ", by: "ふぁいの音楽置き場" },
  { id: "tasogare", title: "黄昏メロウノート", by: "ふぁいの音楽置き場" },
  { id: "nandakke", title: "なんだっけ？", by: "ふぁいの音楽置き場" },
  { id: "rain", title: "ゆううつ雨模様", by: "ふぁいの音楽置き場" },
  { id: "hitoyasumi", title: "ひとやすみ", by: "MusMus（watson）" },
  { id: "musmus172", title: "Lightning Brain", by: "MusMus（watson）" },
  { id: "am223", title: "2:23 AM", by: "しゃろう（DOVA-SYNDROME）" },
];
// 場面（画面のまとまり）と、はじめの曲
export const SCENES = [
  ["menu", "メニュー・リスト・統計など"], ["study", "閲覧・専属エージェント"], ["test", "テスト"], ["memo", "自由メモ"], ["gacha", "ガチャ"],
];
const DEFAULT_TRACK = { menu: "menu", study: "study", test: "test", memo: "study", gacha: "none" };
export const sceneTrack = (scene) => (S.settings.bgmTracks && S.settings.bgmTracks[scene]) || DEFAULT_TRACK[scene] || "none";

// ---- 効果音の種類 ----
export const SFX_CATS = [
  ["ui", "ボタン・めくる音", "押したときや、閲覧で次へ進むときの小さな音"],
  ["judge", "正解・不正解", "テストで答えたときの音"],
  ["reward", "スタンプ・コンボ・目標", "スタンプを押したときや、連続正解・目標達成のときの音"],
  ["gacha", "ガチャの演出", "ガチャを引くときの音（爆発・ルーレットなど）"],
];
const TONE_CAT = { click: "ui", next: "ui", ok: "judge", ng: "judge", stamp: "reward", combo: "reward", coin: "reward" };
const catOn = (cat) => S.settings.sfxOn !== false && S.settings.sfx > 0 && !(S.settings.sfxCats && S.settings.sfxCats[cat] === false);
const bgmOn = () => S.settings.bgmOn !== false && S.settings.bgm > 0;

const SFX = ["roll", "tick", "stop", "boom", "pop", "slow", "flash", "shine"];
const cache = {};
let ctx, bgmEl, bgmScene = "", bgmTrack = "", unlocked = false, preview = null;

function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

// 最初の操作で音を使えるようにする
addEventListener("pointerdown", () => { if (!unlocked) { unlocked = true; ac(); if (bgmScene) bgm(bgmScene, true); } }, { passive: true });

// ガチャなどの効果音（mp3）
export function sfx(name, vol = 1) {
  if (!catOn("gacha") || !SFX.includes(name)) return;
  try {
    const a = (cache[name] ||= new Audio(`assets/sfx/${name}.mp3`)).cloneNode();
    a.volume = Math.min(1, S.settings.sfx * vol);
    a.play().catch(() => {});
  } catch (e) {}
}

// 合成音（ファイルなしで鳴らす小さな音）
const VIB = { ok: 15, ng: [40, 40, 40], stamp: [30, 50, 60], combo: [10, 30, 10], coin: 20, click: 5 };
export function tone(kind, force = false) {
  if (S.settings.vibrate !== false && VIB[kind] && navigator.vibrate && !force) { try { navigator.vibrate(VIB[kind]); } catch (e) {} }
  if (!force && !catOn(TONE_CAT[kind] || "ui")) return;
  const c = ac(); if (!c || S.settings.sfx <= 0) return;
  const v = S.settings.sfx * 0.25;
  const seq = {
    click: [[880, 0.04, "triangle"]],
    ok: [[660, 0.08, "sine"], [990, 0.14, "sine"]],
    ng: [[180, 0.18, "square"]],
    stamp: [[120, 0.12, "sine"], [240, 0.1, "triangle"]],
    coin: [[1320, 0.06, "square"], [1760, 0.12, "square"]],
    next: [[520, 0.05, "sine"]],
    combo: [[784, 0.06, "sine"], [988, 0.06, "sine"], [1318, 0.12, "sine"]],
  }[kind] || [];
  let t = c.currentTime;
  for (const [f, d, type] of seq) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v * (type === "square" ? 0.35 : 1), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.02);
    t += d * 0.85;
  }
}
// 設定画面の「試しに鳴らす」
export function testSfx(cat) {
  ({ ui: () => tone("click", true), judge: () => { tone("ok", true); setTimeout(() => tone("ng", true), 400); }, reward: () => tone("combo", true), gacha: () => playMp3("shine") })[cat]?.();
}
function playMp3(name) { try { const a = new Audio(`assets/sfx/${name}.mp3`); a.volume = Math.min(1, S.settings.sfx); a.play().catch(() => {}); } catch (e) {} }

// ---- BGM ----
// 場面を渡すと、その場面に設定された曲を流す。同じ曲が続くときは流しっぱなし
export function bgm(scene, force = false) {
  bgmScene = scene;
  const track = scene ? sceneTrack(scene) : "none";
  if (!force && track === bgmTrack && bgmEl && !bgmEl.paused) return;
  bgmTrack = track;
  if (bgmEl) { const old = bgmEl; fade(old, 0, 400, () => old.pause()); bgmEl = null; }
  if (track === "none" || !bgmOn() || !unlocked || preview) return;
  const a = new Audio(`assets/bgm/${track}.mp3`);
  a.loop = true; a.volume = 0;
  a.play().then(() => fade(a, S.settings.bgm, 800)).catch(() => {});
  bgmEl = a;
}
// 設定が変わったときに流し直す
export function refreshBgm() {
  if (!bgmOn()) { if (bgmEl) { bgmEl.pause(); bgmEl = null; } bgmTrack = ""; return; }
  if (bgmEl) bgmEl.volume = S.settings.bgm;
  bgm(bgmScene, sceneTrack(bgmScene) !== bgmTrack || !bgmEl);
}
export const setBgmVolume = () => refreshBgm();
export function duck(on) { if (bgmEl) fade(bgmEl, on ? S.settings.bgm * 0.2 : S.settings.bgm, 300); }

// 曲の試聴（約15秒）。もう一度呼ぶと止める
export function previewTrack(id, onEnd) {
  stopPreview();
  if (!id || id === "none") return;
  unlocked = true;
  if (bgmEl) bgmEl.pause();
  const a = new Audio(`assets/bgm/${id}.mp3`);
  a.volume = Math.max(0.15, S.settings.bgm || 0.35);
  a.play().catch(() => {});
  preview = { a, id, onEnd, t: setTimeout(() => fade(a, 0, 1200, () => stopPreview()), 15000) };
}
export function stopPreview() {
  if (!preview) return;
  const p = preview; preview = null;
  clearTimeout(p.t); p.a.pause();
  if (p.onEnd) p.onEnd();
  if (bgmEl && bgmOn()) bgmEl.play().catch(() => {}); else bgm(bgmScene, true);
}
export const previewing = () => (preview ? preview.id : null);

// 音量をなめらかに変える（裏のタブでも止まらないようタイマーで）
function fade(a, to, ms, done) {
  const from = a.volume, t0 = Date.now();
  const iv = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    try { a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) {}
    if (k >= 1) { clearInterval(iv); done && done(); }
  }, 40);
}
