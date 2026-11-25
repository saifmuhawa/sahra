const PAGE_OF = k => ({ anime: "anime.html", series: "series.html" })[k] || "game.html";
/* لعبة الغرف المشتركة بين خمّن الفيلم وخمّن الأنمي. الصفحة بتعرّف KIND و THING و GAME_TITLE و loadInfo و subLine */
const API = "/api";
const LS_J = "sahra-judge-" + KIND, LS_P = "sahra-player-" + KIND;
const get = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const WAIT = "";
const LVL = {hard: ["صعب", "🔴"], mid: ["متوسط", "🟡"], easy: ["سهل", "🟢"]};
const TCLS = ["t0", "t1"];

let role = null, code = null, key = null, pid = null, S = null, lastV = -1, infoKey = null, busy = false;
let ws = null, wsTimer = null, pollTimer = null, pingTimer = null, wsTries = 0, offset = 0, live = false;

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
function setCodes() { ["#k-code", "#g-code", "#r-code", "#f-code"].forEach(s => { const e = $(s); if (e) e.textContent = "غرفة " + code; }); ["#k-vs", "#g-vs", "#r-vs", "#f-vs"].forEach(s => { const e = $(s); if (e) e.innerHTML = vsLine(); }); }
const hintsWord = n => n === 0 ? "ولا تلميح" : n === 1 ? "تلميح واحد" : n === 2 ? "تلميحين" : n >= 3 && n <= 10 ? n + " تلميحات" : n + " تلميح";

// ===== الاتصال المباشر (WebSocket) مع احتياط بالاستطلاع =====
function connect() {
  disconnect();
  lastV = -1;
  openSocket();
  pollTimer = setInterval(() => { if (!live) poll(); }, 3000);
  poll();
}
function disconnect() {
  live = false;
  [wsTimer, pingTimer].forEach(t => t && clearTimeout(t));
  if (pollTimer) clearInterval(pollTimer);
  wsTimer = pingTimer = pollTimer = null;
  if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} ws = null; }
}
function openSocket() {
  const q = role === "judge" ? "key=" + encodeURIComponent(key) : "pid=" + encodeURIComponent(pid);
  try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + API + "/room/ws?code=" + code + "&" + q); }
  catch (e) { return retrySocket(); }
  ws.onopen = () => { live = true; wsTries = 0; ping(); };
  ws.onmessage = e => { if (e.data === "pong") return; try { apply(JSON.parse(e.data)); } catch (err) {} };
  ws.onclose = ev => { live = false; ws = null; if (ev.code === 4000) return roomGone(); if (ev.code === 4001) { if (role === "player") { S && (S.me = null); return render(true); } } retrySocket(); };
  ws.onerror = () => {};
}
function ping() { pingTimer = setTimeout(() => { try { ws && ws.readyState === 1 && ws.send("ping"); } catch (e) {} ping(); }, 25000); }
function retrySocket() { if (!role) return; wsTimer = setTimeout(openSocket, Math.min(10000, 800 * 2 ** wsTries++)); }
let pollErr = 0;
async function poll() {
  try {
    const q = role === "judge" ? "key=" + encodeURIComponent(key) : "pid=" + encodeURIComponent(pid);
    const st = await call("/room/state?code=" + code + "&" + q);
    pollErr = 0;
    apply(st);
  } catch (e) {
    if (e.status === 404) return roomGone();
    if (++pollErr === 3) toast("الاتصال ضعيف… عم نحاول");
  }
}
function apply(st) {
  if (!role) return;
  if (st.kind && st.kind !== KIND) { location.href = PAGE_OF(st.kind) + "?room=" + code; return; }
  if (st.v < lastV) return; // نسخة أقدم وصلت متأخرة
  if (st.now) offset = st.now - Date.now();
  const prev = S;
  const changed = st.v !== lastV; S = st; lastV = st.v;
  if (prev && st.lastPass && st.lastPass.at !== prev.lastPass?.at) announcePass(st.lastPass);
  render(changed);
}
function roomGone() {
  disconnect();
  if (role === "judge") put(LS_J, null); else put(LS_P, null);
  role = null; S = null;
  goHome("الغرفة خلصت أو انسكّرت. اعمل غرفة جديدة أو ادخل كود ثاني.");
}
function toast(t) { const m = el("div", {class: "toast", role: "status"}, esc(t)); document.body.appendChild(m); setTimeout(() => m.remove(), 2600); }

// ===== المؤقت: السيرفر بيحدد متى بيخلص الدور، والجوال بيعدّ لتحت =====
const serverNow = () => Date.now() + offset;
function secsLeft() {
  if (!S || S.stage !== "play") return null;
  if (S.paused) return Math.ceil((S.left || 0) / 1000);
  if (!S.turnEnds) return null;
  return Math.max(0, Math.ceil((S.turnEnds - serverNow()) / 1000));
}
let buzzedFor = null;
setInterval(() => {
  const s = secsLeft();
  document.querySelectorAll("[data-cd]").forEach(e => {
    if (s == null) { e.textContent = ""; return; }
    e.textContent = s;
    e.classList.toggle("hot", !S.paused && s <= 5);
  });
  document.querySelectorAll("[data-ring]").forEach(e => {
    const frac = s == null ? 0 : Math.max(0, Math.min(1, ((S.paused ? S.left : S.turnEnds - serverNow()) || 0) / (S.turnSec * 1000)));
    e.style.setProperty("--p", frac);
  });
  // اهتزاز آخر 5 ثواني لفريق الدور
  if (role === "player" && S?.me && S.stage === "play" && !S.paused && S.turn === S.me.team && s != null && s <= 5 && s > 0) {
    const k = S.turnEnds; if (buzzedFor !== k) { buzzedFor = k; navigator.vibrate?.([80, 60, 80]); }
  }
}, 200);
function announcePass(lp) {
  if (lp.why !== "timeout") return;
  if (role === "player" && S?.me) toast(lp.team === S.me.team ? "⏱️ خلص الوقت، راحت عليكم!" : "⏱️ خلص وقت " + teamName(lp.team) + "، دوركم!");
  else toast("⏱️ خلص وقت " + teamName(lp.team) + "، الدور انتقل");
  if (role === "player" && S?.me && lp.team !== S.me.team) navigator.vibrate?.(200);
}

function render(changed) {
  if (role === "judge") return renderJudge(changed);
  if (!S.me) { disconnect(); put(LS_P, null); show("s-name"); $("#name-code").textContent = "غرفة " + code; $("#name-msg").textContent = "الحكم طلّعك من الغرفة، أو انتهت جلستك. ادخل من جديد."; return; }
  renderPlayer(changed);
}

// ===== البداية =====
function goHome(msg) {
  disconnect(); show("s-home"); $("#home-msg").textContent = msg || "";
  const j = get(LS_J), p = get(LS_P);
  const box = $("#resume"); box.innerHTML = "";
  if (j) box.insertAdjacentHTML("beforeend", `<button class="bigbtn ghost" type="button" id="resume-j">👑 رجوع لغرفتك ${esc(j.code)}</button>`);
  if (p) box.insertAdjacentHTML("beforeend", `<button class="bigbtn ghost" type="button" id="resume-p">🎮 رجوع لغرفة ${esc(p.code)} باسم ${esc(p.name)}</button>`);
  box.hidden = !j && !p;
  $("#resume-j")?.addEventListener("click", () => { role = "judge"; code = j.code; key = j.key; show("s-lobby"); lobbyInit(); connect(); });
  $("#resume-p")?.addEventListener("click", () => { role = "player"; code = p.code; pid = p.pid; show("s-player"); connect(); });
}
$("#create-btn").addEventListener("click", async () => {
  const b = $("#create-btn"); b.disabled = true; $("#home-msg").textContent = "عم نعمل الغرفة…";
  try {
    const r = await call("/room/create", {kind: KIND});
    role = "judge"; code = r.code; key = r.key; put(LS_J, {code, key});
    $("#home-msg").textContent = ""; show("s-lobby"); lobbyInit(); connect();
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
  $("#home-msg").textContent = "عم ندوّر على الغرفة…";
  try {
    const st = await call("/room/state?code=" + c);
    if (st.kind !== KIND) { location.href = PAGE_OF(st.kind) + "?room=" + c; return; }
    code = c; $("#home-msg").textContent = "";
    const p = get(LS_P);
    if (p && p.code === c && st.players.some(x => x.id === p.pid)) { role = "player"; pid = p.pid; show("s-player"); connect(); return; }
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
    show("s-player"); connect();
  } catch (err) { $("#name-msg").textContent = err.status === 404 ? "الغرفة مش موجودة." : err.message === "full" ? "الغرفة مليانة." : "ما زبطت، جرّب كمان مرة."; }
  b.disabled = false;
});
document.querySelectorAll("[data-home]").forEach(b => b.addEventListener("click", () => goHome()));

// ===== أجزاء مشتركة =====
function scoreBar() {
  const s = S.score || [0, 0], h = S.hintsTotal || [0, 0];
  return `<div class="scorebar" aria-label="النتيجة">
    <div class="sb t0"><b>${esc(teamName(0))}</b><span class="pts">${s[0]}</span><small>💡 ${h[0]}</small></div>
    <div class="sb-mid">النتيجة</div>
    <div class="sb t1"><b>${esc(teamName(1))}</b><span class="pts">${s[1]}</span><small>💡 ${h[1]}</small></div>
  </div>`;
}
function turnCard(myTeam) {
  const t = S.turn, mine = myTeam === t;
  const head = myTeam == null ? `دور ${esc(teamName(t))}` : mine ? "دوركم! 🎤" : `دور ${esc(teamName(t))}`;
  const sub = S.paused ? "⏸ الحكم وقّف الوقت" : myTeam == null ? "سؤال واحد للحكم قبل ما يخلص الوقت" : mine ? "اسألوا الحكم سؤال واحد قبل ما يخلص الوقت" : "استنوا، دوركم بعدهم";
  return `<div class="turn ${TCLS[t]}${mine ? " mine" : ""}${S.paused ? " paused" : ""}">
    <div class="ring" data-ring><span class="cd" data-cd></span></div>
    <div class="turn-txt"><h2>${head}</h2><p>${sub}</p></div>
  </div>`;
}

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
    body.innerHTML = `<div class="card-g center big-status ${TCLS[t]}-glow"><p class="lbl">إنت بـ</p><h2 class="tname ${TCLS[t]}">${esc(teamName(t))}</h2><p>استنى الحكم يبلّش اللعبة<span class="dots"></span></p></div>
      <div class="card-g rules"><b>كيف بنلعب؟</b><p>كل فريق إله ${S.turnSec} ثانية يسأل الحكم سؤال واحد، وإذا خلص الوقت بيروح الدور عليه. بتقدروا تطلبوا تلميحات قد ما بدكم، وبتوصلكم إنتو بس. ولو تعادلتوا بالنقاط، بيفوز الفريق اللي طلب تلميحات أقل.</p></div>${teamsHtml}`;
  } else if (S.stage === "pick") {
    body.innerHTML = `${S.round ? scoreBar() : ""}<div class="card-g center big-status"><div class="spin">🎬</div><h2>الحكم عم يختار ${THING}<span class="dots"></span></h2><p>جهّزوا أسئلتكم!</p></div>${teamsHtml}`;
  } else if (S.stage === "play") {
    const hs = (S.myHints || []).slice().reverse();
    const fresh = (S.myHints || []).length > seenHints;
    const other = 1 - t, left = S.hintsLeft?.[t] ?? 0;
    body.innerHTML = `${scoreBar()}${turnCard(t)}
      <button class="bigbtn hintbtn" type="button" id="p-hint"${left ? "" : " disabled"}>💡 بدنا تلميح</button>
      <p class="note center">التلميح بيوصل لفريقكم بس. هالجولة: إنتو ${hintsWord(S.roundHints[t])} · ${esc(teamName(other))} ${hintsWord(S.roundHints[other])}</p>
      <div class="hint-feed">${hs.length ? hs.map((h, k) => `<div class="hcard ${h.lvl}${fresh && k === 0 ? " pop" : ""}"><span class="hl">${LVL[h.lvl][1]} تلميح ${LVL[h.lvl][0]}</span><p>${esc(h.text)}</p></div>`).join("") : `<p class="note center">لسا ما طلبتوا تلميحات. كل ما تطلبوا أقل، أحسن لكم بالتعادل.</p>`}</div>${teamsHtml}`;
    if (fresh && navigator.vibrate) navigator.vibrate(120);
    seenHints = (S.myHints || []).length;
    $("#p-hint")?.addEventListener("click", askHint);
  } else if (S.stage === "reveal") {
    seenHints = 0;
    body.innerHTML = revealHtml(t) + scoreBar() + `<p class="note center">استنوا الحكم يختار ${THING} الجاي أو يخلّص السهرة</p>` + teamsHtml;
  } else if (S.stage === "final") {
    seenHints = 0;
    body.innerHTML = finalHtml(t);
    mountCard();
  }
}
async function askHint() {
  const b = $("#p-hint"); if (!b || b.disabled) return;
  b.disabled = true; b.textContent = "عم نجيب التلميح…";
  try { await call("/room/hint", {code, pid}); toast("💡 وصلكم تلميح"); if (!live) poll(); }
  catch (e) { toast(e.message === "none" ? "خلصت التلميحات لهالجولة" : e.message === "slow" ? "استنى ثانية، التلميح عالطريق" : "ما زبطت، جرّب كمان مرة"); b.disabled = false; b.textContent = "💡 بدنا تلميح"; }
}
function revealHtml(myTeam) {
  const f = S.film || {};
  const w = S.winner;
  const head = w === 0 || w === 1 ? `🏆 ${esc(teamName(w))} عرفه!` : "ما حدا عرفه 😅";
  const mine = myTeam == null || w == null || w < 0 ? "" : w === myTeam ? `<p class="win-me">فريقك أخذ النقطة! 🎉</p>` : `<p class="note">المرة الجاي إلكم 💪</p>`;
  const poster = f.p ? `<img class="rposter" src="${posterUrl(f, "w342")}" alt="">` : "";
  return `<div class="card-g center reveal-card ${w === 0 || w === 1 ? TCLS[w] + "-glow" : ""}"><p class="lbl">${THING} كان</p>${poster}<h2 class="rtitle">${esc(f.ar || f.en || "")}</h2><div class="en" dir="ltr">${esc(f.en || "")}${f.y ? " · " + f.y : ""}</div><h3 class="rwin">${head}</h3>${mine}</div>`;
}
function finalText() {
  const F = S.final || {winner: -1, reason: "draw"};
  if (F.winner < 0) return {head: "تعادل! 🤝", sub: "نفس النقاط ونفس عدد التلميحات"};
  return {head: `🏆 ${teamName(F.winner)} فاز بالسهرة!`, sub: F.reason === "hints" ? "تعادلوا بالنقاط، وفاز لأنه طلب تلميحات أقل" : ""};
}
function finalHtml(myTeam) {
  const F = S.final || {winner: -1}, ft = finalText();
  const mine = myTeam == null || F.winner < 0 ? "" : F.winner === myTeam ? `<p class="win-me">فريقك فاز! 🎉</p>` : `<p class="note">المرة الجاي إلكم 💪</p>`;
  const rows = (S.rounds || []).map(r => `<li><span class="tdot ${r.winner >= 0 ? TCLS[r.winner] : "none"}"></span><b>${esc(r.ar || r.en)}</b><small>${r.winner >= 0 ? esc(teamName(r.winner)) : "ما حدا عرفه"}</small></li>`).join("");
  return `<div class="card-g center reveal-card ${F.winner >= 0 ? TCLS[F.winner] + "-glow" : ""}"><p class="lbl">نتيجة السهرة</p><h2 class="rtitle">${esc(ft.head)}</h2>${ft.sub ? `<p class="note">${esc(ft.sub)}</p>` : ""}${mine}</div>
    ${scoreBar()}
    ${rows ? `<div class="card-g"><b>اللي لعبناه</b><ul class="rounds">${rows}</ul></div>` : ""}
    <div class="card-g center story-box"><b>كرت النتيجة للستوري 📸</b><div class="card-prev" id="card-prev"><p class="note">عم نجهّز الكرت…</p></div>
      <div class="row2"><button class="bigbtn gold" type="button" id="card-share">شارك</button><a class="bigbtn ghost" id="card-dl" download="sahra-result.png">حمّل الصورة</a></div></div>`;
}
function teamBox(t, judge) {
  const ps = teamOf(t);
  return `<div class="team ${TCLS[t]}"><div class="thead"><b>${esc(teamName(t))}</b><span>${ps.length}</span></div>
    ${ps.length ? ps.map(p => `<div class="pchip${p.on ? "" : " off"}"><span class="pn">${esc(p.name)}${!judge && S.me && p.id === S.me.id ? " (إنت)" : ""}</span>${judge ? `<span class="pbtns"><button type="button" class="mini" data-move="${p.id}" aria-label="انقل ${esc(p.name)} للفريق الثاني">⇄</button><button type="button" class="mini" data-kick="${p.id}" aria-label="طلّع ${esc(p.name)}">✕</button></span>` : ""}</div>`).join("") : `<p class="note">ما في حدا لسا</p>`}</div>`;
}

// ===== كرت الستوري =====
let cardFor = null, cardBlob = null;
async function mountCard() {
  const box = $("#card-prev"); if (!box) return;
  const sig = S.v + ":" + (S.rounds || []).length;
  const wire = () => {
    $("#card-share")?.addEventListener("click", shareCard);
  };
  if (cardFor === sig && cardBlob) { showCard(); wire(); return; }
  cardFor = sig; cardBlob = null;
  try {
    const ft = finalText();
    cardBlob = await makeStoryCard({
      game: GAME_TITLE, thing: THING, teams: [teamName(0), teamName(1)], score: S.score, hints: S.hintsTotal,
      winner: S.final?.winner ?? -1, head: ft.head, sub: ft.sub, rounds: S.rounds || [], host: location.host,
    });
    showCard();
  } catch (e) { box.innerHTML = `<p class="warn">ما قدرنا نجهّز الكرت على هالجوال.</p>`; }
  wire();
}
function showCard() {
  const box = $("#card-prev"); if (!box || !cardBlob) return;
  const url = URL.createObjectURL(cardBlob);
  box.innerHTML = `<img src="${url}" alt="كرت نتيجة السهرة">`;
  const dl = $("#card-dl"); if (dl) dl.href = url;
}
async function shareCard() {
  if (!cardBlob) return;
  const file = new File([cardBlob], "sahra-result.png", {type: "image/png"});
  try {
    if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: "نتيجة سهرة فيلم", text: "لعبنا " + GAME_TITLE + " على سهرة فيلم 🎬 @saiflex.u"}); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  $("#card-dl")?.click();
  toast("حمّلنا الصورة، نزّلها ستوري من الاستديو");
}

// ===== الحكم =====
async function act(type, extra = {}) {
  const st = await call("/room/act", Object.assign({code, key, type}, extra));
  apply(st); return st;
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
$("#l-sec").addEventListener("click", e => { const b = e.target.closest("[data-sec]"); if (b) act("turnsec", {sec: +b.dataset.sec}).catch(() => {}); });
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
    $("#l-sec").querySelectorAll("[data-sec]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.sec === S.turnSec));
    const a = teamOf(0).length, b = teamOf(1).length;
    const ok = a > 0 && a === b;
    $("#l-start").disabled = !ok;
    $("#l-msg").textContent = !a && !b ? "استنى المتسابقين يدخلوا…" : ok ? (a === 1 ? "متنافسين وجهاً لوجه ✓" : `فريقين متساويين، ${a} ضد ${b} ✓`) : `لازم الفريقين يكونوا بنفس العدد (هلأ ${a} ضد ${b}). اضغط ⇄ عشان تنقل حدا.`;
  } else if (st === "pick") {
    if ($("#s-pick").hidden) { show("s-pick"); $("#sugg").innerHTML = ""; $("#pick-in").value = ""; infoKey = null; }
    $("#k-score").innerHTML = S.round ? scoreBar() : "";
  } else if (st === "play") {
    if ($("#s-play").hidden) { show("s-play"); setTab("hints"); }
    if (changed) renderPlay();
  } else if (st === "reveal") {
    if ($("#s-reveal").hidden) show("s-reveal");
    if (changed) $("#r-body").innerHTML = revealHtml(null) + scoreBar();
  } else if (st === "final") {
    if ($("#s-final").hidden) show("s-final");
    if (changed) { $("#f-body").innerHTML = finalHtml(null); mountCard(); }
  }
}
function renderPlay() {
  const f = S.film; if (!f) return;
  $("#g-turn").innerHTML = scoreBar() + turnCard(null) + `<div class="row2 turnbtns">
      <button type="button" class="bigbtn ${TCLS[1 - S.turn]}" id="g-pass">✓ جاوبت، دور ${esc(teamName(1 - S.turn))}</button>
      <button type="button" class="bigbtn ghost" id="g-pause">${S.paused ? "▶ كمّل الوقت" : "⏸ وقّف الوقت"}</button></div>`;
  $("#g-head").innerHTML = `${f.p ? `<img src="${posterUrl(f, "w154")}" alt="">` : `<div class="noposter"></div>`}<div><h2>${esc(f.ar || f.en)}</h2><div class="en" dir="ltr">${esc(f.en)}${f.y ? " · " + f.y : ""}</div><p class="note">بس إنت شايف هالمعلومات</p></div>`;
  const tag = h => h.got.map(t => `<span class="gchip ${TCLS[t]}">${esc(teamName(t))}</span>`).join("");
  const groups = ["hard", "mid", "easy"].map(l => {
    const items = S.hints.filter(h => h.lvl === l);
    return `<div class="hgroup ${l}"><h3>${LVL[l][1]} ${LVL[l][0]}</h3>${items.map(h => `<div class="hrow${h.got.length ? " done" : ""}"><p>${esc(h.text)}</p><span class="gots">${tag(h)}</span></div>`).join("")}</div>`;
  }).join("");
  const src = S.hintsSrc === "ai+wiki" ? "🤖 التلميحات من الذكاء الاصطناعي ومعلومات ويكيبيديا. " : S.hintsSrc === "ai" ? "🤖 التلميحات من الذكاء الاصطناعي. " : "";
  $("#g-hints").innerHTML = `<p class="note">${src}الفرق بتطلب التلميحات من جوالاتها، وكل فريق بيشوف تلميحاته بس. هون بتشوف مين أخذ شو. (${esc(teamName(0))}: ${S.roundHints[0]} · ${esc(teamName(1))}: ${S.roundHints[1]})</p>${groups}`;
  $("#g-who").innerHTML = [0, 1].map(t => `<button type="button" class="bigbtn ${TCLS[t]}" data-win="${t}">${esc(teamName(t))}</button>`).join("");
  const key2 = f.t + f.id;
  if (infoKey !== key2) { infoKey = key2; loadInfo({id: f.id, t: f.t, en: f.en, ar: f.ar, y: f.y, p: f.p}); }
}
$("#g-turn").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "g-pass") { b.disabled = true; act("pass").catch(() => { b.disabled = false; }); }
  if (b.id === "g-pause") act(S.paused ? "resume" : "pause").catch(() => {});
});
$("#g-who").addEventListener("click", e => { const b = e.target.closest("[data-win]"); if (b) act("reveal", {winner: +b.dataset.win}).catch(() => {}); });
$("#g-nobody").addEventListener("click", () => act("reveal", {winner: -1}).catch(() => {}));
$("#g-change").addEventListener("click", () => act("next").catch(() => {}));
$("#r-next").addEventListener("click", () => act("next").catch(() => {}));
$("#r-end").addEventListener("click", () => act("end").catch(() => {}));
$("#k-end").addEventListener("click", () => act("end").catch(() => {}));
$("#f-new").addEventListener("click", () => act("newgame").catch(() => {}));
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
  $("#sugg").innerHTML = `<p class="note">عم نجهّز ${THING} والتلميحات…</p>`;
  try {
    window.PICKED = f;
    await act("film", {t: KIND === "film" ? "movie" : f.t, id: f.id});
  } catch (e) { $("#sugg").innerHTML = `<p class="warn">ما قدرنا نجيب معلوماته هلأ. جرّب كمان مرة أو اختار غيره.</p>`; }
  busy = false;
}
$("#story-form").addEventListener("submit", async e => {
  e.preventDefault();
  const s = $("#story-in").value.trim(); if (s.length < 8) return;
  $("#sugg").innerHTML = `<p class="note">🤖 عم يفكّر…</p>`;
  let j = null;
  try { j = await call(({ anime: "/anime/guess", series: "/series/guess" }[KIND] || "/guess") + "?story=" + encodeURIComponent(s)); } catch (err) {}
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
document.addEventListener("visibilitychange", () => { if (!document.hidden && role && !live) { poll(); if (!ws) openSocket(); } });

// ===== كتيّب التعليمات: بيطلع أول مرة قبل اللعب، وبيضل موجود بزر "كيف بنلعب؟" =====
const GUIDE_KEY = "sahra-guide-v2";
const GUIDE = [
  ["🎬", "سهرة " + ({ anime: "أنمي", series: "مسلسلات" }[KIND] || "أفلام") + " بخطوات بسيطة", "واحد منكم بيكون الحكم، والباقي بينقسموا فريقين متساويين. كل واحد بيلعب من جواله."],
  ["👑", "الحكم بيعمل غرفة", "بيكبس «أنا الحكم» وبيطلعله كود من 4 أرقام وباركود. الحكم بيختار " + THING + " وبيشوف كل معلوماته، والمتسابقين ما بيشوفوا إشي."],
  ["📱", "المتسابقين بيدخلوا", "صوّروا الباركود أو اكتبوا الكود، وبعدين اكتبوا أسماءكم. الحكم بيرتّب الفرق، ولازم يكونوا بنفس العدد."],
  ["⏱️", "سؤال واحد بالدور", "كل فريق إله 30 ثانية يسأل الحكم سؤال واحد، والحكم بيجاوب. إذا خلص الوقت قبل السؤال، راح الدور عليكم وانتقل للفريق الثاني."],
  ["💡", "التلميحات إلكم بس", "اكبسوا «بدنا تلميح» وقت ما بدكم. التلميح بيطلع على جوالات فريقكم بس، وبيبلّش من الصعب للسهل."],
  ["🏆", "مين بيفوز؟", "اللي بيعرف " + THING + " بياخذ نقطة. بآخر السهرة الأعلى نقاط بيفوز، ولو تعادلتوا بيفوز الفريق اللي طلب تلميحات أقل. وبتطلعلكم صورة النتيجة للستوري!"],
];
let guidePage = 0, guideAfter = null;
function guideInit() {
  const d = el("dialog", {class: "guide", id: "guide", "aria-labelledby": "guide-t"});
  d.innerHTML = `<div class="g-top"><span class="g-step" id="guide-step"></span><button type="button" class="linkbtn" id="guide-skip">تخطّى</button></div>
    <div class="g-page" aria-live="polite"><div class="g-ico" id="guide-ico"></div><h2 id="guide-t"></h2><p id="guide-p"></p></div>
    <div class="g-dots" id="guide-dots">${GUIDE.map((_, i) => `<button type="button" aria-label="الصفحة ${i + 1}" data-gp="${i}"></button>`).join("")}</div>
    <div class="row2"><button type="button" class="bigbtn ghost" id="guide-prev">رجوع</button><button type="button" class="bigbtn gold" id="guide-next">التالي</button></div>`;
  document.body.appendChild(d);
  d.querySelector("#guide-skip").addEventListener("click", guideClose);
  d.querySelector("#guide-prev").addEventListener("click", () => guideGo(guidePage - 1));
  d.querySelector("#guide-next").addEventListener("click", () => guidePage < GUIDE.length - 1 ? guideGo(guidePage + 1) : guideClose());
  d.querySelector("#guide-dots").addEventListener("click", e => { const b = e.target.closest("[data-gp]"); if (b) guideGo(+b.dataset.gp); });
  d.addEventListener("cancel", e => { e.preventDefault(); guideClose(); });
  let sx = null; // سحب يمين/يسار على الجوال
  d.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, {passive: true});
  d.addEventListener("touchend", e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) guideGo(guidePage + (dx > 0 ? 1 : -1)); });
  const btn = el("button", {type: "button", class: "bigbtn ghost guide-open", id: "guide-open"}, "📖 كيف بنلعب؟");
  btn.addEventListener("click", () => guideOpen());
  $("#s-home .hero-g").after(btn);
}
function guideGo(i) {
  guidePage = Math.max(0, Math.min(GUIDE.length - 1, i));
  const [ico, t, p] = GUIDE[guidePage];
  $("#guide-ico").textContent = ico; $("#guide-t").textContent = t; $("#guide-p").textContent = p;
  $("#guide-step").textContent = (guidePage + 1) + " من " + GUIDE.length;
  document.querySelectorAll("#guide-dots button").forEach((b, k) => b.setAttribute("aria-current", k === guidePage));
  $("#guide-prev").disabled = guidePage === 0;
  $("#guide-next").textContent = guidePage === GUIDE.length - 1 ? "يلا نلعب 🎮" : "التالي";
  const pg = document.querySelector(".g-page"); pg.classList.remove("in"); void pg.offsetWidth; pg.classList.add("in");
}
function guideOpen(after) {
  guideAfter = after || null;
  guideGo(0);
  const d = $("#guide");
  try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
  $("#guide-next").focus();
}
function guideClose() {
  put(GUIDE_KEY, 1);
  const d = $("#guide"); try { d.close(); } catch (e) { d.removeAttribute("open"); }
  const f = guideAfter; guideAfter = null; if (f) f();
}
guideInit();
// أول مرة بيفوت حدا على اللعبة: الكتيّب قبل أي إشي
window.addEventListener("DOMContentLoaded", () => { if (!get(GUIDE_KEY)) guideOpen(); });
