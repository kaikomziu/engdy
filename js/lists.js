// リスト制作（作る・保存・.engdy・公開）と、閲覧のリスト選び
import { $, $$, esc, toast, modal, confirmBox, download, readFile } from "./util.js";
import { loadLists, saveLists, parseWords, wordsToText } from "./store.js";
import { rpc, fn, token, reasonText } from "./api.js";
import { seal, open } from "./crypto.js";
import { go, onEnter } from "./router.js";
import { tone } from "./audio.js";

const SHARE_BASE = "https://kaikomziu.github.io/engdy/";
let lists = loadLists();
let curId = null;
const uid = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cur = () => lists.find((l) => l.id === curId) || null;
const shareUrl = (code) => `${SHARE_BASE}?list=${encodeURIComponent(code)}`;
const VIS = { public: "全体公開", password: "パスワード", url: "URL限定" };

// ================= リスト制作 =================
onEnter("create", () => { lists = loadLists(); if (!cur()) curId = lists[0] ? lists[0].id : null; fillEditor(); renderMyLists(); });

function renderMyLists() {
  $("#myLists").innerHTML = lists.length
    ? lists.map((l) => `<li data-id="${l.id}" class="${l.id === curId ? "on" : ""}"><b>${esc(l.title || "（無題）")}</b><small>${l.words.length}語${l.remote ? ` ・ <span class="badge ${l.remote.vis === "password" ? "pw" : l.remote.vis === "url" ? "url" : ""}">${VIS[l.remote.vis]}</span>` : ""}</small></li>`).join("")
    : `<li class="empty" style="cursor:default">まだリストがありません</li>`;
}
$("#myLists").onclick = (e) => {
  const li = e.target.closest("li[data-id]"); if (!li) return;
  if (dirty() && !confirm("保存していない変更があります。切り替えますか？")) return;
  curId = li.dataset.id; fillEditor(); renderMyLists();
};

function fillEditor() {
  const l = cur();
  $("#listTitle").value = l ? l.title : "";
  $("#listWords").value = l ? wordsToText(l.words) : "";
  renderPreview(); renderPubInfo();
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
let pv; $("#listWords").addEventListener("input", () => { clearTimeout(pv); pv = setTimeout(renderPreview, 200); });

$("#newList").onclick = () => {
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
  if (!silent) { toast("保存しました"); tone("ok"); }
  return l;
}
$("#saveList").onclick = () => saveLocal();

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
  const need = words.filter((x) => !x.m);
  if (!need.length) { toast("意味のない単語はありません"); return; }
  if (!token()) { toast("意味の自動入力は、ログインすると使えます"); KaAccount.login("login"); return; }
  const btn = $("#autoMeaning"); btn.disabled = true;
  try {
    for (let i = 0; i < need.length; i += 120) {
      btn.innerHTML = `<span class="spinner"></span> ${Math.min(i + 120, need.length)} / ${need.length}`;
      const r = await fn("meanings", { words: need.slice(i, i + 120).map((x) => x.w) });
      if (!r.ok) { toast(reasonText(r.reason)); break; }
      const map = new Map(r.items.map((it) => [it.word.toLowerCase(), it.meaning]));
      for (const x of need) { const m = map.get(x.w.toLowerCase()); if (m) x.m = m; }
    }
    $("#listWords").value = wordsToText(words); renderPreview();
    toast("意味を付けました（確認して保存してください）");
  } finally { btn.disabled = false; btn.textContent = "✨ 意味を自動で付ける"; }
};

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
  $("#pickMine").innerHTML = lists.length
    ? lists.map((l) => `<li><div class="pk-main"><b>${esc(l.title)}</b><small>${l.words.length}語</small></div><button class="btn pri sm" data-start="${l.id}">開始</button></li>`).join("")
    : `<li class="empty" style="border:none">まだリストがありません。<br><button class="btn sm" data-go="create" style="margin-top:8px">リストを作る</button></li>`;
}
$("#pickMine").onclick = (e) => {
  const b = e.target.closest("[data-start]"); if (!b) return;
  const l = lists.find((x) => x.id === b.dataset.start);
  if (l) startList({ title: l.title, words: l.words });
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
$("#pubSearch").onkeydown = (e) => { if (e.key === "Enter") loadPublic(); };
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
  if (ok === "go") startList({ title: r.title, words });
}

// 閲覧を始める（view.js が受け取る）
export function startList(list) {
  const usable = list.words.filter((x) => x.w);
  if (!usable.length) { toast("単語がありません"); return; }
  if (usable.some((x) => !x.m)) toast("意味のない単語は、意味の欄が空のまま表示されます", 3000);
  go("view", { title: list.title, words: usable });
}
