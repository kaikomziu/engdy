// 統計：放置を除いた学習時間・見た単語・テストの記録
import { $, esc, fmtDuration, dayKey, addDays } from "./util.js";
import { S, weakWords } from "./store.js";
import { onEnter } from "./router.js";
import { streakDays } from "./app.js";

onEnter("stats", () => {
  const st = S.stats;
  const uniq = Object.values(S.words).filter((r) => r.seen > 0).length;
  const learnedDays = Object.values(st.days).filter((d) => d.s > 0 || d.tt > 0).length;
  const rate = S.test.total ? Math.round((S.test.correct / S.test.total) * 100) : 0;

  // 直近14日の学習時間（分）
  const k0 = dayKey();
  const days = Array.from({ length: 14 }, (_, i) => addDays(k0, i - 13));
  const mins = days.map((k) => Math.round(((st.days[k] && st.days[k].s) || 0) / 60));
  const max = Math.max(5, ...mins);
  const bars = days.map((k, i) => `<div class="bar ${k === k0 ? "today" : ""}"><i style="height:${(mins[i] / max) * 100}%">${mins[i] ? `<em>${mins[i]}</em>` : ""}</i><span>${k.slice(8)}</span></div>`).join("");

  const weak = weakWords(10);
  const most = Object.entries(S.words).filter(([, r]) => r.seen > 0).sort((a, b) => b[1].seen - a[1].seen).slice(0, 10);

  $("#statsBody").innerHTML = `
    <div class="kpis">
      <div class="card kpi"><small>学習時間（放置を除く）</small><b>${fmtDuration(st.seconds)}</b></div>
      <div class="card kpi"><small>見た単語（種類）</small><b>${uniq}</b><span>語</span></div>
      <div class="card kpi"><small>見た回数（のべ）</small><b>${st.views}</b><span>回</span></div>
      <div class="card kpi"><small>閲覧を1周した回数</small><b>${st.laps}</b><span>回</span></div>
      <div class="card kpi"><small>学習した日 / 連続</small><b>${learnedDays}</b><span>日 / ${streakDays()}日</span></div>
      <div class="card kpi"><small>テスト</small><b>${rate}%</b><span>${S.test.correct}/${S.test.total}問</span></div>
    </div>
    <div class="card"><h3 class="sec">直近14日の学習時間（分）</h3><div class="chart">${bars}</div></div>
    <div class="split">
      <div class="card"><h3 class="sec">苦手な単語</h3>${weak.length ? `<table class="wtable"><tr><th>単語</th><th>意味</th><th>まちがい</th></tr>${weak.map((w) => `<tr><td>${esc(w.w)}</td><td>${esc(w.m)}</td><td><div class="meter" title="${w.miss}/${w.total}"><i style="width:${Math.round(w.rate * 100)}%"></i></div></td></tr>`).join("")}</table>` : `<p class="empty">テストをすると表示されます</p>`}</div>
      <div class="card"><h3 class="sec">よく見た単語</h3>${most.length ? `<table class="wtable"><tr><th>単語</th><th>意味</th><th>回数</th></tr>${most.map(([w, r]) => `<tr><td>${esc(w)}</td><td>${esc(r.m)}</td><td>${r.seen}</td></tr>`).join("")}</table>` : `<p class="empty">閲覧をすると表示されます</p>`}</div>
    </div>
    <p class="hint">学習時間は、閲覧の画面を開いていて、60秒以内に操作があった時間だけを数えています。</p>`;
});
