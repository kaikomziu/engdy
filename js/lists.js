// リスト制作（作る・保存・.engdy・公開）と、閲覧のリスト選び
import { $, $$, esc, toast, modal, confirmBox, download, readFile, shuffle } from "./util.js";
import { S, save, loadLists, saveLists, parseWords, wordsToText, parseTable } from "./store.js";
import { rpc, fn, token, reasonText } from "./api.js";
import { seal, open } from "./crypto.js";
import { go, onEnter, onLeave } from "./router.js";
import { tone } from "./audio.js";
import { SAMPLE_TITLE, SAMPLE_WORDS } from "./sample.js";

const SHARE_BASE = "https://kaikomziu.github.io/engdy/";
let lists = loadLists();
let curId = null;
const uid = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cur = () => lists.find((l) => l.id === curId) || null;
const shareUrl = (code) => `${SHARE_BASE}?list=${encodeURIComponent(code)}`;
const VIS = { public: "全体公開", password: "パスワード", url: "URL限定" };

// サンプルの単語リストを入れる（まだなければ）
export function addSample() {
  lists = loadLists();
  if (lists.some((l) => l.title === SAMPLE_TITLE)) return false;
  lists.push({ id: uid(), title: SAMPLE_TITLE, words: SAMPLE_WORDS.map((x) => ({ ...x })), updated: 1 });
  saveLists(lists);
  return true;
}

// ================= リスト制作 =================
onEnter("create", () => { lists = loadLists(); if (!cur()) curId = lists[0] ? lists[0].id : null; fillEditor(); renderMyLists(); });

// 並べ替え・検索
function view(listArr, q) {
  q = (q || "").trim().toLowerCase();
  let a = listArr.filter((l) => !q || l.title.toLowerCase().includes(q) || l.words.some((x) => x.w.toLowerCase() === q));
  const mode = S.settings.listSort || "updated";
  a = a.slice().sort(mode === "name" ? (x, y) => x.title.localeCompare(y.title, "ja") : mode === "count" ? (x, y) => y.words.length - x.words.length : (x, y) => (y.updated || 0) - (x.updated || 0));
  return a;
}
const sortOpts = () => [["updated", "更新順"], ["name", "名前順"], ["count", "語数順"]].map(([v, t]) => `<option value="${v}" ${S.settings.listSort === v ? "selected" : ""}>${t}</option>`).join("");
export function bindListTools(searchSel, sortSel, rerender) {
  const sr = $(searchSel), so = $(sortSel);
  so.innerHTML = sortOpts();
  sr.oninput = rerender;
  so.onchange = () => { S.settings.listSort = so.value; save(); document.querySelectorAll(".list-sort").forEach((x) => (x.value = so.value)); rerender(); };
}

function renderMyLists() {
  const shown = view(lists, $("#mySearch").value);
  $("#myLists").innerHTML = shown.length
    ? shown.map((l) => `<li data-id="${l.id}" class="${l.id === curId ? "on" : ""}"><b>${esc(l.title || "（無題）")}</b><small>${l.words.length}語${l.remote ? ` ・ <span class="badge ${l.remote.vis === "password" ? "pw" : l.remote.vis === "url" ? "url" : ""}">${VIS[l.remote.vis]}</span>` : ""}</small></li>`).join("")
    : `<li class="empty" style="cursor:default">${lists.length ? "見つかりません" : "まだリストがありません"}</li>`;
}
bindListTools("#mySearch", "#mySort", () => renderMyLists());
$("#myLists").onclick = (e) => {
  const li = e.target.closest("li[data-id]"); if (!li) return;
  flushAuto();
  if (dirty() && !confirm("保存していない変更があります。切り替えますか？")) return;
  curId = li.dataset.id; fillEditor(); renderMyLists();
};

function fillEditor() {
  const l = cur();
  $("#listTitle").value = l ? l.title : "";
  $("#listWords").value = l ? wordsToText(l.words) : "";
  renderPreview(); renderPubInfo();
  setState(l ? "✓ 保存済み" : "単語を入れると自動で保存されます", l ? "ok" : "");
}
function dirty() {
  const l = cur(); const t = $("#listTitle").value.trim(), w = $("#listWords").value.trim();
  if (!l) return !!(t || w);
  return t !== l.title || w !== wordsToText(l.words).trim();
}
function renderPreview() {
  const words = parseWords($("#listWords").value);
  const miss = words.filter((x) => !x.m).length;
  $("#parseInfo").textContent = words.length ? `${words.length}語${miss ? ` ・ 意味なし ${miss}語` : ""}` : "";
  $("#listPreview").innerHTML = words.length
    ? `<table>${words.slice(0, 300).map((x) => `<tr><td>${esc(x.w)}</td><td class="${x.m ? "" : "miss"}">${x.m ? esc(x.m) : "意味なし"}</td></tr>`).join("")}</table>${words.length > 300 ? `<p class="hint">…ほか ${words.length - 300}語</p>` : ""}`
    : "";
}
function renderPubInfo() {
  const l = cur();
  $("#pubInfo").innerHTML = l && l.remote
    ? `公開中（${VIS[l.remote.vis]}）：<a href="${shareUrl(l.remote.code)}" target="_blank" rel="noopener">${esc(shareUrl(l.remote.code))}</a> <button class="btn sm" id="copyUrl">URL をコピー</button> <button class="btn sm ghost" id="unpublish">公開をやめる</button>`
    : "";
  const c = $("#copyUrl"); if (c) c.onclick = () => navigator.clipboard.writeText(shareUrl(l.remote.code)).then(() => toast("コピーしました"));
  const u = $("#unpublish"); if (u) u.onclick = unpublish;
}
let pv, autoT;
function setState(t, cls = "") { const el = $("#saveState"); el.textContent = t; el.className = "save-state " + cls; }
// 書いたら少し待って自動で保存（タイトルがなければ「無題のリスト」）
function autosave() {
  clearTimeout(autoT);
  setState("編集中…");
  autoT = setTimeout(() => {
    autoT = null;
    const words = parseWords($("#listWords").value);
    if (!words.length) { setState(cur() ? "" : "単語を入れると自動で保存されます"); return; }
    if (!$("#listTitle").value.trim()) $("#listTitle").value = "無題のリスト";
    if (saveLocal(true)) setState("✓ 自動で保存しました", "ok");
  }, 900);
}
// 切り替える前・画面を出る前に、待っている自動保存をすぐ行う
function flushAuto() {
  if (!autoT) return;
  clearTimeout(autoT); autoT = null;
  if (!parseWords($("#listWords").value).length) return;
  if (!$("#listTitle").value.trim()) $("#listTitle").value = "無題のリスト";
  saveLocal(true);
}
onLeave("create", flushAuto);
$("#listWords").addEventListener("input", () => { clearTimeout(pv); pv = setTimeout(renderPreview, 200); autosave(); });
$("#listTitle").addEventListener("input", () => { if (cur()) autosave(); });

$("#newList").onclick = () => {
  flushAuto();
  if (dirty() && !confirm("保存していない変更があります。新しく作りますか？")) return;
  curId = null; fillEditor(); renderMyLists(); $("#listTitle").focus();
};

function collect() {
  const title = $("#listTitle").value.trim().slice(0, 60);
  const words = parseWords($("#listWords").value);
  if (!title) { toast("タイトルを入れてください"); return null; }
  if (!words.length) { toast("単語を1つ以上入れてください"); return null; }
  return { title, words };
}
function saveLocal(silent) {
  const d = collect(); if (!d) return null;
  let l = cur();
  if (!l) { l = { id: uid(), title: "", words: [], updated: 0 }; lists.unshift(l); curId = l.id; }
  l.title = d.title; l.words = d.words; l.updated = Date.now();
  saveLists(lists); renderMyLists();
  if (!silent) { toast("保存しました"); tone("ok"); setState("✓ 保存済み", "ok"); }
  return l;
}
$("#saveList").onclick = () => saveLocal();

$("#dupList").onclick = () => {
  const d = collect(); if (!d) return;
  const l = { id: uid(), title: (d.title + " のコピー").slice(0, 60), words: d.words.map((x) => ({ ...x })), updated: Date.now() };
  lists.unshift(l); saveLists(lists); curId = l.id; fillEditor(); renderMyLists();
  toast("複製しました（公開の設定は引き継ぎません）");
};

// Excel・スプレッドシートの表を貼り付けたら「英語, 意味」に直す
$("#listWords").addEventListener("paste", (e) => {
  const t = (e.clipboardData || window.clipboardData).getData("text");
  if (!t || !/\t/.test(t)) return;
  e.preventDefault();
  const conv = parseTable(t), ta = e.target;
  const a = ta.selectionStart, b = ta.selectionEnd;
  ta.value = ta.value.slice(0, a) + conv + ta.value.slice(b);
  ta.selectionStart = ta.selectionEnd = a + conv.length;
  renderPreview();
  toast(`表から ${conv.split("\n").filter(Boolean).length}行 を読み込みました`);
});

$("#deleteList").onclick = async () => {
  const l = cur(); if (!l) { fillEditor(); return; }
  if (!(await confirmBox("このリストを削除しますか？", `「${l.title}」をこの端末から削除します。${l.remote ? "公開も取り消します。" : ""}`, "削除", true))) return;
  if (l.remote && l.remote.id && token()) await rpc("engdy_list_delete", { p_token: token(), p_id: l.remote.id }).catch(() => {});
  lists = lists.filter((x) => x.id !== l.id); saveLists(lists);
  curId = lists[0] ? lists[0].id : null; fillEditor(); renderMyLists(); toast("削除しました");
};

// ---- 意味の自動入力（Gemini） ----
$("#autoMeaning").onclick = async () => {
  const words = parseWords($("#listWords").value);
  let need = words.filter((x) => !x.m);
  if (!need.length) { toast("意味のない単語はありません"); return; }
  // 端末の中にある意味（見た単語・ほかのリスト・サンプル）を先に使う。見つかった単語は AI に聞かない
  const local = localDict();
  let filled = 0;
  for (const x of need) { const m = local.get(x.w.toLowerCase()); if (m) { x.m = m; filled++; } }
  need = need.filter((x) => !x.m);
  if (!need.length) { $("#listWords").value = wordsToText(words); renderPreview(); autosave(); toast(`${filled}語の意味を、端末にある辞書から付けました（AI は使っていません）`, 3500); return; }
  if (!token()) {
    if (filled) { $("#listWords").value = wordsToText(words); renderPreview(); autosave(); }
    toast(`${filled ? filled + "語は端末の辞書から付けました。" : ""}残り${need.length}語の自動入力は、ログインすると使えます`, 3500); KaAccount.login("login"); return;
  }
  const btn = $("#autoMeaning"); btn.disabled = true;
  let shared = 0, usedAi = false;
  try {
    for (let i = 0; i < need.length; i += 120) {
      btn.innerHTML = `<span class="spinner"></span> ${Math.min(i + 120, need.length)} / ${need.length}`;
      const r = await fn("meanings", { words: need.slice(i, i + 120).map((x) => x.w) });
      if (!r.ok) { toast(reasonText(r.reason)); break; }
      shared += r.cached || 0; usedAi ||= !!r.ai;
      const map = new Map(r.items.map((it) => [it.word.toLowerCase(), it.meaning]));
      for (const x of need) { const m = map.get(x.w.toLowerCase()); if (m) x.m = m; }
    }
    $("#listWords").value = wordsToText(words); renderPreview(); autosave();
    const parts = [filled && `端末の辞書から${filled}語`, shared && `みんなの保存済みから${shared}語`].filter(Boolean);
    toast(`意味を付けました${parts.length ? "（" + parts.join("・") + "）" : ""}${usedAi ? "" : "。AI の回数は減っていません"}`, 3800);
  } finally { btn.disabled = false; btn.textContent = "✨ 意味を自動で付ける"; }
};

// 端末の中にある「英単語 → 意味」（見た単語・自分のリスト・サンプル）
function localDict() {
  const m = new Map();
  for (const x of SAMPLE_WORDS) m.set(x.w.toLowerCase(), x.m);
  for (const l of loadLists()) for (const x of l.words) if (x.m) m.set(x.w.toLowerCase(), x.m);
  for (const [w, r] of Object.entries(S.words)) if (r.m) m.set(w.toLowerCase(), r.m);
  return m;
}

// ---- AI：テーマから単語リストを作る ----
function needLogin() { if (token()) return false; toast("AI の機能は、ログインすると使えます"); KaAccount.login("login"); return true; }
$("#genList").onclick = async () => {
  if (needLogin()) return;
  const req = await modal(`<p class="kicker">AI</p><h3>🪄 テーマから単語リストを作る</h3>
    <label class="field"><span>テーマ</span><input id="glTheme" maxlength="100" placeholder="例：旅行で使う英語／英検3級の動詞／天気と季節"></label>
    <div class="field"><span>単語の数</span><div class="seg" id="glN">${[10, 20, 30, 50].map((n) => `<button data-n="${n}" class="${n === 20 ? "on" : ""}">${n}語</button>`).join("")}</div></div>
    <label class="field"><span>むずかしさ</span><select id="glLv"><option value="">おまかせ</option><option>中学1年</option><option>中学2年</option><option>中学3年</option><option>高校</option><option>英検3級</option><option>英検準2級</option><option>英検2級</option><option>TOEIC 600点</option></select></label>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>キャンセル</button><button class="btn pri" id="glGo">作る</button></div>`,
    (c, close) => {
      c.querySelector("#glN").onclick = (e) => { const b = e.target.closest("[data-n]"); if (b) c.querySelectorAll("#glN button").forEach((x) => x.classList.toggle("on", x === b)); };
      const go = () => { const t = c.querySelector("#glTheme").value.trim(); if (!t) { toast("テーマを入れてください"); return; } close({ theme: t, count: +c.querySelector("#glN .on").dataset.n, level: c.querySelector("#glLv").value }); };
      c.querySelector("#glGo").onclick = go; c.querySelector("#glTheme").onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) go(); };
      setTimeout(() => c.querySelector("#glTheme").focus(), 50);
    });
  if (!req) return;
  const btn = $("#genList"); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> 作成中…`;
  let r = await fn("gen_list", req);
  btn.disabled = false; btn.textContent = "🪄 テーマから作る";
  if (!r.ok) { toast(reasonText(r.reason)); return; }
  while (true) {
    const again = await showGenResult(r, req);
    if (again !== "fresh") { if (again) applyGen(r, req, again); return; }
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> 作成中…`;
    r = await fn("gen_list", { ...req, fresh: true });
    btn.disabled = false; btn.textContent = "🪄 テーマから作る";
    if (!r.ok) { toast(reasonText(r.reason)); return; }
  }
};
function showGenResult(r, req) {
  const items = r.items.filter((i) => i.word);
  return modal(`<p class="kicker">AI</p><h3>${esc(r.title || req.theme)}（${items.length}語）</h3>
    <div class="preview" style="max-height:44vh"><table>${items.map((i) => `<tr><td>${esc(i.word)}</td><td>${esc(i.meaning)}</td></tr>`).join("")}</table></div>
    <p class="hint">${r.cached ? "♻️ 同じテーマで前に作られたリストです（AI の回数は減っていません）。ちがう単語にしたいときは「別の案」を押してください。" : "AI が作ったので、意味がずれていることもあります。保存したあとで直せます。"}</p>
    <div class="row wrap" style="justify-content:flex-end"><button class="btn ghost" data-close>やめる</button><button class="btn ghost" data-how="fresh">別の案（AI）</button>${cur() || $("#listWords").value.trim() ? `<button class="btn" data-how="append">今のリストに足す</button>` : ""}<button class="btn pri" data-how="new">新しいリストにする</button></div>`,
    (c, close) => c.querySelectorAll("[data-how]").forEach((b) => (b.onclick = () => close(b.dataset.how))));
}
function applyGen(r, req, how) {
  const items = r.items.filter((i) => i.word);
  const lines = items.map((i) => `${i.word}, ${i.meaning}`).join("\n");
  if (how === "new") {
    flushAuto();
    const l = { id: uid(), title: (r.title || req.theme).slice(0, 60), words: parseWords(lines), updated: Date.now() };
    lists.unshift(l); saveLists(lists); curId = l.id; fillEditor(); renderMyLists();
  } else {
    $("#listWords").value = ($("#listWords").value.trim() ? $("#listWords").value.trim() + "\n" : "") + lines;
    renderPreview(); autosave();
  }
  tone("ok"); toast(`${items.length}語を入れました`);
}

// ---- AI：似た単語・反対語・派生語 ----
$("#relWords").onclick = async () => {
  if (needLogin()) return;
  const words = parseWords($("#listWords").value);
  if (!words.length) { toast("先に単語を入れてください"); return; }
  const btn = $("#relWords"); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> 探しています…`;
  const r = await fn("related", { words: words.slice(0, 40).map((x) => x.w) });
  btn.disabled = false; btn.textContent = "🔗 似た単語・反対語";
  if (!r.ok) { toast(reasonText(r.reason)); return; }
  if (!r.ai) toast("♻️ 保存済みの結果を使いました（AI の回数は減っていません）", 2500);
  const have = new Set(words.map((x) => x.w.toLowerCase()));
  const items = r.items.filter((i) => i.word && !have.has(i.word.toLowerCase()));
  if (!items.length) { toast("足せる単語は見つかりませんでした"); return; }
  const TYPE_CLS = { 類義語: "", 反意語: "pw", 派生語: "url" };
  const picked = await modal(`<p class="kicker">AI</p><h3>🔗 いっしょに覚えたい単語</h3>
    <p class="hint">足したい単語にチェックを入れてください。${words.length > 40 ? "（最初の40語から探しました）" : ""}</p>
    <div class="rel-list">${items.map((i, k) => `<label class="rel-item"><input type="checkbox" data-k="${k}" checked><span><b>${esc(i.word)}</b> <span class="badge ${TYPE_CLS[i.type] ?? ""}">${esc(i.type)}</span><small>${esc(i.meaning)} ・ ${esc(i.base)} の${esc(i.type)}</small></span></label>`).join("")}</div>
    <div class="row wrap" style="justify-content:flex-end"><button class="btn ghost" id="relNone">全部はずす</button><button class="btn ghost" data-close>やめる</button><button class="btn pri" id="relAdd">選んだ単語を足す</button></div>`,
    (c, close) => {
      c.querySelector("#relNone").onclick = () => c.querySelectorAll("[data-k]").forEach((x) => (x.checked = false));
      c.querySelector("#relAdd").onclick = () => close([...c.querySelectorAll("[data-k]:checked")].map((x) => items[+x.dataset.k]));
    });
  if (!picked || !picked.length) return;
  $("#listWords").value = $("#listWords").value.trim() + "\n" + picked.map((i) => `${i.word}, ${i.meaning}`).join("\n");
  renderPreview(); autosave(); tone("ok"); toast(`${picked.length}語を足しました`);
};

// 自由メモなど、ほかの画面からリストを作る
export function createListFrom(title, items) {
  lists = loadLists();
  const l = { id: uid(), title: title.slice(0, 60), words: parseWords(items.map((i) => (i.meaning ? `${i.word}, ${i.meaning}` : i.word)).join("\n")), updated: Date.now() };
  lists.unshift(l); saveLists(lists); curId = l.id;
  return l;
}

// ---- .engdy ファイル ----
$("#exportFile").onclick = async () => {
  const l = saveLocal(true); if (!l) return;
  const text = await seal({ app: "engdy", title: l.title, words: l.words });
  download(`${l.title.replace(/[\\/:*?"<>|]/g, "_")}.engdy`, text);
  toast(".engdy ファイルを書き出しました");
};
$("#importFile").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const data = await readEngdy(f); if (!data) return;
  const l = { id: uid(), title: data.title, words: data.words, updated: Date.now() };
  lists.unshift(l); saveLists(lists); curId = l.id; fillEditor(); renderMyLists();
  toast(`「${l.title}」を読み込みました`);
};
async function readEngdy(file) {
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    const text = await readFile(file);
    const words = parseWords(parseTable(text));
    if (!words.length) { toast("単語が見つかりませんでした"); return null; }
    return { title: file.name.replace(/\.(csv|tsv|txt)$/i, "").slice(0, 60), words };
  }
  try {
    const d = await open(await readFile(file));
    if (!d || !Array.isArray(d.words)) throw 0;
    return { title: String(d.title || file.name.replace(/\.engdy$/i, "")).slice(0, 60), words: parseWords(wordsToText(d.words)) };
  } catch (e) { toast("Engdy のファイルとして読み込めませんでした"); return null; }
}

// ---- 公開（Supabase） ----
$("#publishList").onclick = async () => {
  if (!token()) { toast("公開するにはログインが必要です"); KaAccount.login("login"); return; }
  const l = saveLocal(true); if (!l) return;
  const vis0 = (l.remote && l.remote.vis) || "public";
  const res = await modal(`<p class="kicker">PUBLISH</p><h3>「${esc(l.title)}」を公開</h3>
    <label class="field"><span>ひとこと説明（任意）</span><input id="pubDesc" maxlength="200" value="${esc(l.desc || "")}" placeholder="例：中2の教科書 Unit 3 の単語"></label>
    <label class="radio"><input type="radio" name="vis" value="public" ${vis0 === "public" ? "checked" : ""}><span><b>全体公開</b><small>「みんなのリスト」に表示され、だれでも使えます</small></span></label>
    <label class="radio"><input type="radio" name="vis" value="password" ${vis0 === "password" ? "checked" : ""}><span><b>パスワード</b><small>一覧には表示されますが、パスワードを入れないと使えません</small></span></label>
    <label class="radio"><input type="radio" name="vis" value="url" ${vis0 === "url" ? "checked" : ""}><span><b>URL限定</b><small>一覧には出ません。共有URLを知っている人だけが使えます</small></span></label>
    <label class="field" id="pwRow" ${vis0 === "password" ? "" : "hidden"}><span>パスワード（4〜64文字）</span><input id="pubPw" type="text" maxlength="64" autocomplete="off"></label>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>キャンセル</button><button class="btn pri" id="pubGo">公開する</button></div>`,
    (c, close) => {
      c.querySelectorAll('input[name="vis"]').forEach((r) => r.onchange = () => (c.querySelector("#pwRow").hidden = r.value !== "password" || !r.checked));
      c.querySelector("#pubGo").onclick = () => {
        const vis = c.querySelector('input[name="vis"]:checked').value, pw = c.querySelector("#pubPw").value;
        if (vis === "password" && (pw.length < 4 || pw.length > 64)) { toast("パスワードは4〜64文字にしてください"); return; }
        close({ vis, pw, desc: c.querySelector("#pubDesc").value.trim() });
      };
    });
  if (!res) return;
  const payload = await seal({ app: "engdy", title: l.title, words: l.words }, res.vis === "password" ? res.pw : null);
  const r = await rpc("engdy_list_save", { p_token: token(), p_id: (l.remote && l.remote.id) || null, p_title: l.title, p_desc: res.desc,
    p_vis: res.vis, p_password: res.vis === "password" ? res.pw : null, p_payload: payload, p_count: l.words.length }).catch(() => null);
  if (!r || !r.ok) {
    if (r && r.reason === "notfound" && l.remote) { delete l.remote; saveLists(lists); toast("以前の公開が見つからないので、新しく公開し直してください"); return; }
    toast(reasonText(r && r.reason)); return;
  }
  l.remote = { id: r.id, code: r.code, vis: res.vis }; l.desc = res.desc; saveLists(lists);
  renderMyLists(); renderPubInfo(); tone("ok");
  navigator.clipboard?.writeText(shareUrl(r.code)).catch(() => {});
  toast("公開しました（共有URLをコピーしました）", 3200);
};
async function unpublish() {
  const l = cur(); if (!l || !l.remote) return;
  if (!(await confirmBox("公開をやめますか？", "共有URLやコードでは開けなくなります。この端末のリストは残ります。", "やめる", true))) return;
  const r = await rpc("engdy_list_delete", { p_token: token(), p_id: l.remote.id }).catch(() => null);
  if (r && r.ok === false && r.reason === "auth") { toast(reasonText("auth")); return; }
  delete l.remote; saveLists(lists); renderMyLists(); renderPubInfo(); toast("公開をやめました");
}

// ================= 閲覧：リストを選ぶ =================
onEnter("browse", () => { lists = loadLists(); renderPickMine(); });
$("#browseTabs").onclick = (e) => {
  const t = e.target.closest(".tab"); if (!t) return;
  $$("#browseTabs .tab").forEach((x) => x.classList.toggle("on", x === t));
  $$("#s-browse .tabpane").forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
  if (t.dataset.tab === "public") loadPublic();
};
function renderPickMine() {
  const shown = view(lists, $("#pickSearch").value);
  $("#pickMine").innerHTML = shown.length
    ? shown.map((l) => `<li><div class="pk-main"><b>${esc(l.title)}</b><small>${l.words.length}語</small></div><button class="btn pri sm" data-start="${l.id}">開始</button></li>`).join("")
    : lists.length ? `<li class="empty" style="border:none">見つかりません</li>` : `<li class="empty" style="border:none">まだリストがありません。<br><span class="row" style="justify-content:center;margin-top:8px"><button class="btn sm" data-go="create">リストを作る</button><button class="btn sm pri" id="addSampleB">サンプルを入れる</button></span></li>`;
}
bindListTools("#pickSearch", "#pickSort", () => renderPickMine());
$("#pickMine").addEventListener("click", (e) => { if (e.target.closest("#addSampleB")) { addSample(); lists = loadLists(); renderPickMine(); toast("サンプルの単語リスト（150語）を入れました"); } });
$("#pickMine").onclick = (e) => {
  const b = e.target.closest("[data-start]"); if (!b) return;
  const l = lists.find((x) => x.id === b.dataset.start);
  if (l) startList({ id: l.id, title: l.title, words: l.words });
};

async function loadPublic() {
  const ul = $("#pickPublic");
  ul.innerHTML = `<li class="empty" style="border:none"><span class="spinner"></span></li>`;
  const r = await rpc("engdy_list_browse", { p_q: $("#pubSearch").value.trim() || null, p_limit: 100 }).catch(() => null);
  if (!Array.isArray(r)) { ul.innerHTML = `<li class="empty" style="border:none">読み込めませんでした</li>`; return; }
  ul.innerHTML = r.length ? r.map((l) => `<li><div class="pk-main"><b>${l.visibility === "password" ? "🔒 " : ""}${esc(l.title)}</b>
      <small>${esc(l.avatar || "")} ${esc(l.author)} ・ ${l.word_count}語 ・ ${l.plays}回${l.description ? " ・ " + esc(l.description) : ""}</small></div>
      <button class="btn pri sm" data-code="${esc(l.code)}">開始</button></li>`).join("")
    : `<li class="empty" style="border:none">見つかりませんでした</li>`;
}
$("#pubReload").onclick = loadPublic;
let ps; $("#pubSearch").oninput = () => { clearTimeout(ps); ps = setTimeout(loadPublic, 450); };
$("#pubSearch").onkeydown = (e) => { if (e.key === "Enter") { clearTimeout(ps); loadPublic(); } };
$("#pickPublic").onclick = (e) => { const b = e.target.closest("[data-code]"); if (b) openShared(b.dataset.code); };

$("#codeOpen").onclick = () => {
  const v = $("#codeInput").value.trim(); if (!v) return;
  let code = v;
  try { const u = new URL(v); code = u.searchParams.get("list") || v; } catch (e) {}
  openShared(code);
};
$("#browseFile").onclick = () => $("#browseFileInput").click();
$("#browseFileInput").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const d = await readEngdy(f); if (d) startList(d);
};

// 共有コードから開く（パスワードが必要なら聞く）
export async function openShared(code, password) {
  const r = await rpc("engdy_list_get", { p_code: code, p_password: password || null }).catch(() => null);
  if (!r) { toast("通信できませんでした"); return; }
  if (!r.ok && (r.reason === "need_password" || r.reason === "wrong_password")) {
    const pw = await modal(`<p class="kicker">PASSWORD</p><h3>🔒 ${esc(r.title || "パスワード付きのリスト")}</h3>
      ${r.reason === "wrong_password" ? `<p style="color:var(--warn)">パスワードが違います</p>` : `<p class="hint">このリストを使うにはパスワードが必要です。</p>`}
      <input id="pwIn" type="password" maxlength="64" style="width:100%" autocomplete="off">
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-close>キャンセル</button><button class="btn pri" id="pwGo">開く</button></div>`,
      (c, close) => { const i = c.querySelector("#pwIn"); i.focus(); const go = () => close(i.value); c.querySelector("#pwGo").onclick = go; i.onkeydown = (e) => e.key === "Enter" && go(); });
    if (pw) openShared(code, pw);
    return;
  }
  if (!r.ok) { toast(reasonText(r.reason)); return; }
  let data;
  try { data = await open(r.payload, password); } catch (e) { toast("リストを復号できませんでした"); return; }
  const words = parseWords(wordsToText(data.words || []));
  const ok = await modal(`<p class="kicker">SHARED LIST</p><h3>${esc(r.title)}</h3>
    <p class="hint">${esc(r.author)} ・ ${words.length}語${r.description ? "<br>" + esc(r.description) : ""}</p>
    <div class="row wrap" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-close>閉じる</button><button class="btn" id="shSave">自分のリストに保存</button><button class="btn pri" id="shGo">開始</button></div>`,
    (c, close) => {
      c.querySelector("#shGo").onclick = () => close("go");
      c.querySelector("#shSave").onclick = () => close("save");
    });
  if (ok === "save") {
    lists = loadLists();
    lists.unshift({ id: uid(), title: r.title, words, updated: Date.now() }); saveLists(lists);
    toast("自分のリストに保存しました"); if (document.querySelector("#s-browse.active")) renderPickMine();
  }
  if (ok === "go") startList({ code: r.code, title: r.title, words });
}

// 前回のリストですぐ始める（メイン画面の「次にやること」から）
export function startLast() {
  const l = S.last; if (!l) return false;
  if (l.id) { const x = loadLists().find((y) => y.id === l.id); if (x) { startList({ id: x.id, title: x.title, words: x.words }); return true; } }
  if (l.code) { openShared(l.code); return true; }
  return false;
}
export const lastListName = () => {
  const l = S.last; if (!l) return null;
  if (l.id) { const x = loadLists().find((y) => y.id === l.id); return x ? x.title : null; }
  return l.code ? l.title : null;
};

// 閲覧を始める。単語が多いときは「何語やるか・どこからやるか」を選んでから view.js へ
export async function startList(list) {
  const usable = list.words.filter((x) => x.w);
  if (!usable.length) { toast("単語がありません"); return; }
  if (list.id || list.code) { S.last = { title: list.title, id: list.id || null, code: list.code || null }; save(); }
  const N = usable.length;
  const full = { title: list.title, words: usable };
  if (N <= 5) { launch(full, usable, null, `${N}語`, !!S.settings.reverse); return; }

  const posKey = list.title;
  const pos = (S.pos && S.pos[posKey]) || 0;
  const def = Math.min(N, 20);
  const presets = [10, 20, 30, 50, 100].filter((n) => n < N);
  const res = await modal(`<p class="kicker">START</p><h3>${esc(list.title)}</h3>
    <p class="hint">全 <b>${N}</b> 語のうち、何語やるかを選んでください。</p>
    <div class="field"><span>やる語数</span>
      <div class="row wrap"><div class="seg" id="stN">${presets.map((n) => `<button data-n="${n}" class="${n === def ? "on" : ""}">${n}</button>`).join("")}<button data-n="${N}" class="${def === N ? "on" : ""}">全部</button></div>
      <span class="row"><input id="stNum" type="number" min="1" max="${N}" value="${def}" style="width:90px"> 語</span></div></div>
    <div class="field"><span>向き</span>
      <div class="seg" id="stDir"><button data-r="0" class="${S.settings.reverse ? "" : "on"}">英語 → 意味</button><button data-r="1" class="${S.settings.reverse ? "on" : ""}">意味 → 英語</button></div></div>
    <div class="field"><span>出し方</span>
      ${pos > 0 && pos < N ? `<label class="radio"><input type="radio" name="ord" value="cont" checked><span><b>続きから</b><small>前回の続き（${pos + 1}語目〜）</small></span></label>` : ""}
      <label class="radio"><input type="radio" name="ord" value="head" ${pos > 0 && pos < N ? "" : "checked"}><span><b>はじめから順番に</b><small>1語目から</small></span></label>
      <label class="radio"><input type="radio" name="ord" value="from"><span><b>指定した番号から</b><small><input id="stFrom" type="number" min="1" max="${N}" value="1" style="width:80px;padding:4px 8px"> 語目から</small></span></label>
      <label class="radio"><input type="radio" name="ord" value="rand"><span><b>ランダム</b><small>全体からばらばらに選ぶ</small></span></label>
      <label class="radio"><input type="radio" name="ord" value="weak"><span><b>まだ見ていない・苦手を優先</b><small>見た回数が少ない語と、テストでまちがえた語から</small></span></label>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>キャンセル</button><button class="btn pri" id="stGo">開始</button></div>`,
    (c, close) => {
      const num = c.querySelector("#stNum");
      c.querySelector("#stN").onclick = (e) => {
        const b = e.target.closest("[data-n]"); if (!b) return;
        num.value = b.dataset.n; c.querySelectorAll("#stN button").forEach((x) => x.classList.toggle("on", x === b));
      };
      c.querySelector("#stDir").onclick = (e) => {
        const b = e.target.closest("[data-r]"); if (!b) return;
        c.querySelectorAll("#stDir button").forEach((x) => x.classList.toggle("on", x === b));
      };
      num.oninput = () => c.querySelectorAll("#stN button").forEach((x) => x.classList.toggle("on", x.dataset.n === num.value));
      c.querySelector("#stFrom").onfocus = () => (c.querySelector('input[value="from"]').checked = true);
      c.querySelector("#stGo").onclick = () => {
        const n = Math.max(1, Math.min(N, parseInt(num.value, 10) || def));
        const ord = c.querySelector('input[name="ord"]:checked').value;
        const from = Math.max(1, Math.min(N, parseInt(c.querySelector("#stFrom").value, 10) || 1)) - 1;
        const reverse = c.querySelector("#stDir .on").dataset.r === "1";
        close({ n, ord, from, reverse });
      };
    });
  if (!res) return;
  S.settings.reverse = res.reverse; save();

  let picked, next = null, start = 0;
  if (res.ord === "rand") picked = shuffle(usable).slice(0, res.n);
  else if (res.ord === "weak") {
    const score = (x) => { const r = S.words[x.w]; if (!r) return -1000; return r.seen * 2 - r.ng * 5 + r.ok; };
    picked = shuffle(usable).sort((a, b) => score(a) - score(b)).slice(0, res.n);
  } else {
    start = res.ord === "cont" ? pos : res.ord === "from" ? res.from : 0;
    picked = Array.from({ length: res.n }, (_, i) => usable[(start + i) % N]);
    next = (start + res.n) % N;
  }
  const label = res.ord === "rand" ? `ランダム ${picked.length}語` : res.ord === "weak" ? `苦手優先 ${picked.length}語`
    : `${start + 1}〜${((start + res.n - 1) % N) + 1}語目（全${N}語）`;
  launch(full, picked, next == null ? null : { key: posKey, next }, label, res.reverse);
}
function launch(full, words, pos, label, reverse) {
  if (words.some((x) => !x.m)) toast("意味のない単語は、意味の欄が空のまま表示されます", 3000);
  go("view", { title: full.title, words, full, pos, label, reverse });
}
