/* لعبة الغرف المشتركة بين خمّن الفيلم وخمّن الأنمي. الصفحة بتعرّف KIND و THING و GAME_TITLE و loadInfo و subLine */
const API = "https://sahra-api-kxww.onrender.com";
fetch(API + "/health").catch(() => {});
const LS_J = "sahra-judge-" + KIND, LS_P = "sahra-player-" + KIND;
const get = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const WAIT = "(أول مرة ممكن تاخذ لحد دقيقة، السيرفر بيصحى)";
const LVL = {hard: ["صعب", "🔴"], mid: ["متوسط", "🟡"], easy: ["سهل", "🟢"]};
const TCLS = ["t0", "t1"];

let role = null, code = null, key = null, pid = null, S = null, lastV = -1, timer = null, infoKey = null, busy = false;

async function call(path, body) {
  const opt = body ? {method: "POST", headers: {"content-type": "text/plain"}, body: JSON.stringify(body)} : {cache: "no-store"};
  const r = await fetch(API + path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || String(r.status)); e.status = r.status; e.data = j; throw e; }
  return j;
}
function show(id) { document.querySelectorAll(".scr").forEach(s => s.hidden = s.id !== id); window.scrollTo(0, 0); }
const roomUrl = c => location.origin + location.pathname + "?room=" + c;
const teamName = t => S?.teams?.[t] || ["الفريق الأحمر", "الفريق الذهبي"][t];
const teamOf = t => (S?.players || []).filter(p => p.team === t);
function vsLine() { const a = teamOf(0).length, b = teamOf(1).length; return `<span class="tdot t0"></span>${a} ضد ${b}<span class="tdot t1"></span>`; }
function setCodes() { ["#k-code", "#g-code", "#r-code"].forEach(s => $(s).textContent = "غرفة " + code); ["#k-vs", "#g-vs", "#r-vs"].forEach(s => $(s).innerHTML = vsLine()); }

// ===== الاستطلاع =====
function startPoll() { stopPoll(); lastV = -1; poll(); timer = setInterval(poll, role === "judge" ? 2000 : 1500); }
function stopPoll() { if (timer) clearInterval(timer); timer = null; }
let pollErr = 0;
async function poll() {
  try {
    const q = role === "judge" ? "key=" + encodeURIComponent(key) : "pid=" + encodeURIComponent(pid);
    const st = await call("/room/state?code=" + code + "&" + q);
    pollErr = 0;
    if (st.kind && st.kind !== KIND) { location.href = (st.kind === "anime" ? "anime.html" : "game.html") + "?room=" + code; return; }
    const changed = st.v !== lastV; S = st; lastV = st.v;
    render(changed);
  } catch (e) {
    if (e.status === 404) return roomGone();
    if (++pollErr === 4) toast("الاتصال ضعيف… عم نحاول");
  }
}
function roomGone() {
  stopPoll();
  if (role === "judge") put(LS_J, null); else put(LS_P, null);
  role = null; S = null;
  goHome("الغرفة خلصت أو انسكّرت. اعمل غرفة جديدة أو ادخل كود ثاني.");
}
function toast(t) { const m = el("div", {class: "toast", role: "status"}, esc(t)); document.body.appendChild(m); setTimeout(() => m.remove(), 2600); }

function render(changed) {
  if (role === "judge") return renderJudge(changed);
  if (!S.me) { stopPoll(); put(LS_P, null); show("s-name"); $("#name-code").textContent = "غرفة " + code; $("#name-msg").textContent = "الحكم طلّعك من الغرفة، أو انتهت جلستك. ادخل من جديد."; return; }
  renderPlayer(changed);
}

// ===== البداية =====
function goHome(msg) {
  stopPoll(); show("s-home"); $("#home-msg").textContent = msg || "";
  const j = get(LS_J), p = get(LS_P);
  const box = $("#resume"); box.innerHTML = "";
  if (j) box.insertAdjacentHTML("beforeend", `<button class="bigbtn ghost" type="button" id="resume-j">👑 رجوع لغرفتك ${esc(j.code)}</button>`);
  if (p) box.insertAdjacentHTML("beforeend", `<button class="bigbtn ghost" type="button" id="resume-p">🎮 رجوع لغرفة ${esc(p.code)} باسم ${esc(p.name)}</button>`);
  box.hidden = !j && !p;
  $("#resume-j")?.addEventListener("click", () => { role = "judge"; code = j.code; key = j.key; show("s-lobby"); lobbyInit(); startPoll(); });
  $("#resume-p")?.addEventListener("click", () => { role = "player"; code = p.code; pid = p.pid; show("s-player"); startPoll(); });
}
$("#create-btn").addEventListener("click", async () => {
  const b = $("#create-btn"); b.disabled = true; $("#home-msg").textContent = "عم نعمل الغرفة… " + WAIT;
  try {
    const r = await call("/room/create", {kind: KIND});
    role = "judge"; code = r.code; key = r.key; put(LS_J, {code, key});
    $("#home-msg").textContent = ""; show("s-lobby"); lobbyInit(); startPoll();
  } catch (e) { $("#home-msg").textContent = "ما زبطت، جرّب كمان مرة."; }
  b.disabled = false;
});
$("#code-in").addEventListener("input", e => { e.target.value = e.target.value.replace(/[^0-9٠-٩]/g, "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).slice(0, 4); });
$("#code-form").addEventListener("submit", async e => {
  e.preventDefault();
  const c = $("#code-in").value.trim();
  if (c.length !== 4) { $("#home-msg").textContent = "الكود 4 أرقام."; return; }
  await openJoin(c);
});
async function openJoin(c) {
  $("#home-msg").textContent = "عم ندوّر على الغرفة… " + WAIT;
  try {
    const st = await call("/room/state?code=" + c);
    if (st.kind !== KIND) { location.href = (st.kind === "anime" ? "anime.html" : "game.html") + "?room=" + c; return; }
    code = c; $("#home-msg").textContent = "";
    const p = get(LS_P);
    if (p && p.code === c && st.players.some(x => x.id === p.pid)) { role = "player"; pid = p.pid; show("s-player"); startPoll(); return; }
    show("s-name"); $("#name-code").textContent = "غرفة " + c; $("#name-msg").textContent = ""; $("#name-in").value = p?.name || ""; $("#name-in").focus();
  } catch (e) { show("s-home"); $("#home-msg").textContent = e.status === 404 ? "ما في غرفة بهالكود. تأكد منه." : "ما قدرنا نوصل للسيرفر، جرّب كمان مرة."; }
}
$("#name-form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#name-in").value.trim(); if (!name) return $("#name-in").focus();
  const b = e.target.querySelector("button"); b.disabled = true;
  try {
    const old = get(LS_P);
    const r = await call("/room/join", {code, name, pid: old && old.code === code ? old.pid : undefined});
    role = "player"; pid = r.pid; put(LS_P, {code, pid, name});
    show("s-player"); startPoll();
  } catch (err) { $("#name-msg").textContent = err.status === 404 ? "الغرفة مش موجودة." : err.message === "full" ? "الغرفة مليانة." : "ما زبطت، جرّب كمان مرة."; }
  b.disabled = false;
});
document.querySelectorAll("[data-home]").forEach(b => b.addEventListener("click", () => goHome()));

// ===== المتسابق =====
$("#p-leave").addEventListener("click", async () => {
  if (!confirmLeave()) return;
  try { await call("/room/leave", {code, pid}); } catch (e) {}
  put(LS_P, null); role = null; goHome();
});
function confirmLeave() { const b = $("#p-leave"); if (b.dataset.sure) return true; b.dataset.sure = "1"; b.textContent = "متأكد؟ اضغط كمان مرة"; setTimeout(() => { delete b.dataset.sure; b.textContent = "اطلع"; }, 3000); return false; }
let seenHints = 0;
function renderPlayer(changed) {
  $("#p-code").textContent = "غرفة " + code;
  const me = S.me, t = me.team;
  $("#p-me").innerHTML = `<span class="tdot ${TCLS[t]}"></span>${esc(me.name)}`;
  if (!changed) return;
  const body = $("#p-body");
  const teamsHtml = `<div class="teams">${[0, 1].map(x => teamBox(x, false)).join("")}</div>`;
  if (S.stage === "lobby") {
    body.innerHTML = `<div class="card-g center big-status ${TCLS[t]}-glow"><p class="lbl">إنت بـ</p><h2 class="tname ${TCLS[t]}">${esc(teamName(t))}</h2><p>استنى الحكم يبلّش اللعبة<span class="dots"></span></p></div>${teamsHtml}`;
  } else if (S.stage === "pick") {
    body.innerHTML = `<div class="card-g center big-status"><div class="spin">🎬</div><h2>الحكم عم يختار ${THING}<span class="dots"></span></h2><p>جهّزوا أسئلتكم!</p></div>${teamsHtml}`;
  } else if (S.stage === "play") {
    const hs = S.shown.slice().reverse();
    const fresh = S.shown.length > seenHints;
    body.innerHTML = `<div class="card-g center"><h2>الحكم اختار ${THING}! 🎯</h2><p>اسألوا الحكم أسئلة وخمّنوا. الهنتات بتطلع هون لما الحكم يكشفها.</p></div>
      <div class="hint-feed">${hs.length ? hs.map((h, k) => `<div class="hcard ${h.lvl}${fresh && k === 0 ? " pop" : ""}"><span class="hl">${LVL[h.lvl][1]} هنت ${LVL[h.lvl][0]}</span><p>${esc(h.text)}</p></div>`).join("") : `<p class="note center">لسا ما في هنتات. الحكم بيكشفها لما تقربوا.</p>`}</div>${teamsHtml}`;
    if (fresh && navigator.vibrate) navigator.vibrate(120);
    seenHints = S.shown.length;
  } else if (S.stage === "reveal") {
    seenHints = 0;
    body.innerHTML = revealHtml(t) + teamsHtml;
  }
}
function revealHtml(myTeam) {
  const f = S.film || {};
  const w = S.winner;
  const head = w === 0 || w === 1 ? `🏆 ${esc(teamName(w))} عرفه!` : "ما حدا عرفه 😅";
  const mine = myTeam == null || w == null || w < 0 ? "" : w === myTeam ? `<p class="win-me">فريقك ربح! 🎉</p>` : `<p class="note">المرة الجاي إلكم 💪</p>`;
  const poster = f.p ? `<img class="rposter" src="${IMG}w342${f.p}" alt="">` : "";
  return `<div class="card-g center reveal-card ${w === 0 || w === 1 ? TCLS[w] + "-glow" : ""}"><p class="lbl">${THING} كان</p>${poster}<h2 class="rtitle">${esc(f.ar || f.en || "")}</h2><div class="en" dir="ltr">${esc(f.en || "")}${f.y ? " · " + f.y : ""}</div><h3 class="rwin">${head}</h3>${mine}</div>`;
}
function teamBox(t, judge) {
  const ps = teamOf(t);
  return `<div class="team ${TCLS[t]}"><div class="thead"><b>${esc(teamName(t))}</b><span>${ps.length}</span></div>
    ${ps.length ? ps.map(p => `<div class="pchip${p.on ? "" : " off"}"><span class="pn">${esc(p.name)}${!judge && S.me && p.id === S.me.id ? " (إنت)" : ""}</span>${judge ? `<span class="pbtns"><button type="button" class="mini" data-move="${p.id}" aria-label="انقل ${esc(p.name)} للفريق الثاني">⇄</button><button type="button" class="mini" data-kick="${p.id}" aria-label="طلّع ${esc(p.name)}">✕</button></span>` : ""}</div>`).join("") : `<p class="note">ما في حدا لسا</p>`}</div>`;
}

// ===== الحكم =====
async function act(type, extra = {}) {
  const st = await call("/room/act", Object.assign({code, key, type}, extra));
  S = st; lastV = st.v; render(true); return st;
}
function lobbyInit() {
  $("#l-code").textContent = code;
  const url = roomUrl(code), box = $("#l-qr");
  try { const q = qrcode(0, "M"); q.addData(url); q.make(); box.innerHTML = q.createSvgTag({cellSize: 6, margin: 2, scalable: true}); }
  catch (e) { box.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(url)}" alt="باركود الغرفة" width="220" height="220">`; }
}
$("#l-share").addEventListener("click", async () => {
  const url = roomUrl(code), text = "تعال العب " + GAME_TITLE + " بسهرة فيلم! كود الغرفة " + code;
  try { if (navigator.share) { await navigator.share({title: "سهرة فيلم", text, url}); return; } } catch (e) { return; }
  try { await navigator.clipboard.writeText(url); toast("انسخ الرابط ✓"); } catch (e) { prompt("انسخ الرابط:", url); }
});
$("#j-close").addEventListener("click", () => {
  const b = $("#j-close"); if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "متأكد؟ اضغط كمان مرة"; setTimeout(() => { delete b.dataset.sure; b.textContent = "سكّر الغرفة"; }, 3000); return; }
  put(LS_J, null); role = null; goHome("سكّرت الغرفة.");
});
$("#l-teams").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.move) await act("move", {pid: b.dataset.move}).catch(() => {});
  if (b.dataset.kick) await act("kick", {pid: b.dataset.kick}).catch(() => {});
});
$("#l-shuffle").addEventListener("click", () => act("shuffle").catch(() => {}));
$("#l-start").addEventListener("click", async () => {
  try { await act("start"); } catch (e) { $("#l-msg").textContent = "لازم الفريقين يكونوا بنفس العدد."; }
});
document.querySelectorAll("[data-lobby]").forEach(b => b.addEventListener("click", () => act("lobby").catch(() => {})));

function renderJudge(changed) {
  setCodes();
  const st = S.stage;
  if (st === "lobby") {
    if ($("#s-lobby").hidden) { show("s-lobby"); lobbyInit(); }
    $("#l-teams").innerHTML = [0, 1].map(t => teamBox(t, true)).join("");
    const a = teamOf(0).length, b = teamOf(1).length;
    const ok = a > 0 && a === b;
    $("#l-start").disabled = !ok;
    $("#l-msg").textContent = !a && !b ? "استنى المتسابقين يدخلوا…" : ok ? (a === 1 ? "متنافسين وجهاً لوجه ✓" : `فريقين متساويين، ${a} ضد ${b} ✓`) : `لازم الفريقين يكونوا بنفس العدد (هلأ ${a} ضد ${b}). اضغط ⇄ عشان تنقل حدا.`;
  } else if (st === "pick") {
    if ($("#s-pick").hidden) { show("s-pick"); $("#sugg").innerHTML = ""; $("#pick-in").value = ""; infoKey = null; }
  } else if (st === "play") {
    if ($("#s-play").hidden) { show("s-play"); setTab("hints"); }
    if (changed) renderPlay();
  } else if (st === "reveal") {
    if ($("#s-reveal").hidden) show("s-reveal");
    if (changed) $("#r-body").innerHTML = revealHtml(null);
  }
}
function renderPlay() {
  const f = S.film; if (!f) return;
  $("#g-head").innerHTML = `${f.p ? `<img src="${IMG}w154${f.p}" alt="">` : `<div class="noposter"></div>`}<div><h2>${esc(f.ar || f.en)}</h2><div class="en" dir="ltr">${esc(f.en)}${f.y ? " · " + f.y : ""}</div><p class="note">بس إنت شايف هالمعلومات</p></div>`;
  const shown = new Set(S.shown.map(h => h.i));
  const groups = ["hard", "mid", "easy"].map(l => {
    const items = S.hints.map((h, i) => ({...h, i})).filter(h => h.lvl === l);
    return `<div class="hgroup ${l}"><h3>${LVL[l][1]} ${LVL[l][0]}</h3>${items.map(h => `<div class="hrow${shown.has(h.i) ? " done" : ""}"><p>${esc(h.text)}</p><button type="button" class="hbtn" data-hint="${h.i}">${shown.has(h.i) ? "✓ انكشف" : "اكشف"}</button></div>`).join("")}</div>`;
  }).join("");
  $("#g-hints").innerHTML = `<p class="note">${S.hintsSrc === "ai" ? "🤖 الهنتات من الذكاء الاصطناعي. " : ""}اكشف الهنت لما المتسابقين يقربوا، وبيطلع على تلفوناتهم فوراً. (${S.shown.length} من ${S.hints.length} انكشفوا)</p>${groups}`;
  $("#g-who").innerHTML = [0, 1].map(t => `<button type="button" class="bigbtn ${TCLS[t]}" data-win="${t}">${esc(teamName(t))}</button>`).join("");
  const key2 = f.t + f.id;
  if (infoKey !== key2) { infoKey = key2; loadInfo({id: f.id, t: f.t, en: f.en, ar: f.ar, y: f.y, p: f.p}); }
}
$("#g-hints").addEventListener("click", async e => {
  const b = e.target.closest("[data-hint]"); if (!b) return;
  const i = +b.dataset.hint, done = S.shown.some(h => h.i === i);
  b.disabled = true;
  try { await act(done ? "unhint" : "hint", {i}); } catch (err) { b.disabled = false; }
});
$("#g-who").addEventListener("click", e => { const b = e.target.closest("[data-win]"); if (b) act("reveal", {winner: +b.dataset.win}).catch(() => {}); });
$("#g-nobody").addEventListener("click", () => act("reveal", {winner: -1}).catch(() => {}));
$("#g-change").addEventListener("click", () => act("next").catch(() => {}));
$("#r-next").addEventListener("click", () => act("next").catch(() => {}));
function setTab(t) { $("#tab-hints").setAttribute("aria-selected", t === "hints"); $("#tab-info").setAttribute("aria-selected", t === "info"); $("#g-hints").hidden = t !== "hints"; $("#g-info").hidden = t !== "info"; }
$("#tab-hints").addEventListener("click", () => setTab("hints"));
$("#tab-info").addEventListener("click", () => setTab("info"));

// ===== اختيار الفيلم =====
function suggest(list, note) {
  const box = $("#sugg"); box.innerHTML = note ? `<p class="note">${note}</p>` : "";
  list.forEach(f => {
    const b = el("button", {type: "button", class: "result"});
    b.innerHTML = `${posterBox(f, "w92")}<span><b dir="ltr">${esc(f.en)}</b><small>${esc(subLine(f))}</small>${f.why ? `<span class="ai">🤖 ${esc(f.why)}</span>` : ""}</span>`;
    b.addEventListener("click", () => choose(f));
    box.appendChild(b);
  });
}
async function choose(f) {
  if (busy) return; busy = true;
  $("#sugg").innerHTML = `<p class="note">عم نجهّز ${THING} والهنتات… ${WAIT}</p>`;
  try {
    window.PICKED = f;
    await act("film", {t: KIND === "anime" ? f.t : "movie", id: f.id});
  } catch (e) { $("#sugg").innerHTML = `<p class="warn">ما قدرنا نجيب معلوماته هلأ. جرّب كمان مرة أو اختار غيره.</p>`; }
  busy = false;
}
$("#story-form").addEventListener("submit", async e => {
  e.preventDefault();
  const s = $("#story-in").value.trim(); if (s.length < 8) return;
  $("#sugg").innerHTML = `<p class="note">🤖 عم يفكّر… ${WAIT}</p>`;
  let j = null;
  try { j = await call((KIND === "anime" ? "/anime/guess" : "/guess") + "?story=" + encodeURIComponent(s)); } catch (err) {}
  const list = j?.results || [];
  if (!list.length) { $("#sugg").innerHTML = `<p class="warn">ما قدرنا نعرفه من هالوصف. زيد تفاصيل: اسم شخصية، ممثل، أو مشهد مشهور، وجرّب كمان مرة.</p>`; return; }
  suggest(list, "🤖 هاي توقعات الذكاء الاصطناعي، اختار الصح:");
});

// ===== التشغيل =====
window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(location.search);
  const rc = (params.get("room") || "").replace(/\D/g, "").slice(0, 4);
  if (rc) { history.replaceState(null, "", location.pathname); show("s-home"); return openJoin(rc); }
  goHome();
});
