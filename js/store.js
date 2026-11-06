// 端末に保存するデータ。ログイン中はかるわかGAMES SDK が engdy_v1 / engdy_lists をクラウドへ同期する
import { dayKey } from "./util.js";

const KEY = "engdy_v1", LKEY = "engdy_lists";

function fresh() {
  return {
    v: 1,
    diamonds: 0,
    stamp: { card: [], last: "", cards: 0 },              // card: 押した日の配列（7個で1枚）
    stats: { seconds: 0, laps: 0, views: 0, days: {} },    // days[YYYY-MM-DD] = {s, w, l, tt, tc}
    words: {},                                             // words[英語] = {m, seen, last, ok, ng, lastNg}
    test: { total: 0, correct: 0, rounds: 0, best: 0 },
    owned: { bg: ["plain"], theme: ["forest"], dex: {} },
    equip: { bg: "plain", theme: "forest" },
    pity: 0, pulls: 0,
    settings: { showDelay: 3, nextDelay: 3, bgm: 0.35, sfx: 0.7, autoSpeak: false, shuffle: false },
    agent: { history: [] },
    pos: {},                                               // pos[リスト名] = 続きから始める位置
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) {
      const f = fresh();
      // 足りない項目を補う（古いセーブとの互換）
      for (const k of Object.keys(f)) if (s[k] === undefined) s[k] = f[k];
      s.settings = { ...f.settings, ...s.settings };
      s.owned = { ...f.owned, ...s.owned };
      s.stats = { ...f.stats, ...s.stats };
      s.stamp = { ...f.stamp, ...s.stamp };
      return s;
    }
  } catch (e) {}
  return fresh();
}

export const S = load();
const subs = new Set();
export const onSave = (f) => subs.add(f);
let timer;
export function save(now = false) {
  clearTimeout(timer);
  const run = () => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    subs.forEach((f) => { try { f(); } catch (e) {} });
  };
  if (now) run(); else timer = setTimeout(run, 300);
}
addEventListener("pagehide", () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} });

export function today() {
  const k = dayKey();
  return (S.stats.days[k] ||= { s: 0, w: 0, l: 0, tt: 0, tc: 0 });
}

// ---- 単語の記録 ----
export function wordRec(w, m) {
  const key = w.trim();
  const r = (S.words[key] ||= { m: m || "", seen: 0, last: 0, ok: 0, ng: 0 });
  if (m) r.m = m;
  return r;
}

// テストに使える単語（意味があり、閲覧で見たもの）
export function testPool() {
  return Object.entries(S.words).filter(([, r]) => r.seen > 0 && r.m).map(([w, r]) => ({ w, ...r }));
}

// 苦手な単語（間違い率の高い順）
export function weakWords(n = 30) {
  return Object.entries(S.words)
    .filter(([, r]) => r.ng > 0)
    .map(([w, r]) => ({ w, m: r.m, miss: r.ng, total: r.ok + r.ng, rate: r.ng / (r.ok + r.ng) }))
    .sort((a, b) => b.rate - a.rate || b.miss - a.miss)
    .slice(0, n);
}

// 専属エージェントの解放条件
export const UNLOCK = { answers: 60, words: 15 };
export function agentProgress() {
  const tested = Object.values(S.words).filter((r) => r.ok + r.ng > 0).length;
  const a = Math.min(1, S.test.total / UNLOCK.answers), b = Math.min(1, tested / UNLOCK.words);
  return { tested, answers: S.test.total, ok: a >= 1 && b >= 1, ratio: (a + b) / 2 };
}

// ---- 単語リスト（端末） ----
export function loadLists() {
  try { const l = JSON.parse(localStorage.getItem(LKEY)); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
export function saveLists(lists) {
  try { localStorage.setItem(LKEY, JSON.stringify(lists)); } catch (e) {}
}

// 「apple, りんご」などの行を {w, m} にする
export function parseWords(text) {
  const out = [], seen = new Set();
  for (let line of String(text || "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    let w = line, m = "";
    const mm = line.match(/^(.+?)\s*(?:\t|,|，|、|：|:|\s=\s|\s-\s)\s*(.*)$/);
    if (mm) { w = mm[1].trim(); m = mm[2].trim(); }
    w = w.slice(0, 60); m = m.slice(0, 80);
    if (!w || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push({ w, m });
  }
  return out.slice(0, 3000);
}
export const wordsToText = (words) => words.map((x) => (x.m ? `${x.w}, ${x.m}` : x.w)).join("\n");
