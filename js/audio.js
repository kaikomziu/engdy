// 音：BGM（mp3）・効果音（mp3）・合成音（Web Audio）
import { S } from "./store.js";

const SFX = ["roll", "tick", "stop", "boom", "pop", "slow", "flash", "shine"];
const cache = {};
let ctx, bgmEl, bgmName = "", unlocked = false;

function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

// 最初の操作で音を使えるようにする
addEventListener("pointerdown", () => { if (!unlocked) { unlocked = true; ac(); if (bgmName) bgm(bgmName, true); } }, { once: false, passive: true });

export function sfx(name, vol = 1) {
  if (S.settings.sfx <= 0) return;
  if (!SFX.includes(name)) return;
  try {
    const a = (cache[name] ||= new Audio(`assets/sfx/${name}.mp3`)).cloneNode();
    a.volume = Math.min(1, S.settings.sfx * vol);
    a.play().catch(() => {});
  } catch (e) {}
}

// 合成音（ファイルなしで鳴らす小さな音）
export function tone(kind) {
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

// BGM（menu / study / test / なし）
export function bgm(name, force = false) {
  if (name === bgmName && !force && bgmEl && !bgmEl.paused) return;
  bgmName = name;
  if (bgmEl) { const old = bgmEl; fade(old, 0, 400, () => old.pause()); bgmEl = null; }
  if (!name || S.settings.bgm <= 0 || !unlocked) return;
  const a = new Audio(`assets/bgm/${name}.mp3`);
  a.loop = true; a.volume = 0;
  a.play().then(() => fade(a, S.settings.bgm, 800)).catch(() => {});
  bgmEl = a;
}
export function setBgmVolume(v) { if (bgmEl) bgmEl.volume = v; if (v > 0 && !bgmEl && bgmName) bgm(bgmName, true); if (v <= 0 && bgmEl) { bgmEl.pause(); bgmEl = null; } }
export function duck(on) { if (bgmEl) fade(bgmEl, on ? S.settings.bgm * 0.2 : S.settings.bgm, 300); }

function fade(a, to, ms, done) {
  const from = a.volume, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    try { a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) {}
    if (k < 1) requestAnimationFrame(step); else done && done();
  };
  requestAnimationFrame(step);
}
