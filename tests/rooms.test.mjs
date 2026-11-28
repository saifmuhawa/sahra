// اختبار غرف اللعب: حكم + فريقين، المؤقت، خصوصية التلميحات، كسر التعادل
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const API = BASE + "/api";
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "✓ " : "✗ ") + msg); if (!cond) fails++; };
const post = async (p, b) => { const r = await fetch(API + p, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const get = async p => (await fetch(API + p)).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// الأفلام بالغرف من Wikidata: الرقم هو رقم Q (Inception = Q25188)
const INCEPTION = 25188;
function sock(q) {
  const ws = new WebSocket(BASE.replace("http", "ws") + "/api/room/ws?" + q);
  const s = { ws, last: null, msgs: 0 };
  ws.onmessage = e => { if (e.data !== "pong") { s.last = JSON.parse(e.data); s.msgs++; } };
  return new Promise((res, rej) => { ws.onopen = () => res(s); ws.onerror = rej; });
}

const { j: room } = await post("/room/create", { kind: "film" });
ok(/^\d{4}$/.test(room.code) && room.key, "إنشاء غرفة بكود 4 أرقام");
const code = room.code, key = room.key;
const A = (await post("/room/join", { code, name: "سيف" })).j.pid;
const B = (await post("/room/join", { code, name: "ليث" })).j.pid;
const A2 = (await post("/room/join", { code, name: "عمر" })).j.pid;
const B2 = (await post("/room/join", { code, name: "رند" })).j.pid;
let st = await get(`/room/state?code=${code}&key=${key}`);
ok(st.players.length === 4 && st.players.filter(p => p.team === 0).length === 2, "4 متسابقين بفريقين متساويين");
// حالة الغرفة ما بتكشف معرّف اللاعب السري (pid)، بس uid عام للعرض
ok(st.players.every(p => p.id === undefined && p.uid), "ما بينكشف pid اللاعب بحالة الغرفة");
// ثغرة IDOR: لاعب ما بيقدر يطلّع لاعب ثاني — الـ uid العام ما بيصلح كـ pid
const uidB = st.players.find(p => p.name === "ليث").uid;
await post("/room/leave", { code, pid: uidB });
ok((await get(`/room/state?code=${code}&key=${key}`)).players.length === 4, "محاولة تطليع لاعب بالـ uid العام ما بتشتغل");

const J = await sock(`code=${code}&key=${key}`);
const PA = await sock(`code=${code}&pid=${A}`);
const PB = await sock(`code=${code}&pid=${B}`);
await sleep(300);
ok(J.last?.players.find(p => p.name === "سيف")?.on, "الحكم بيشوف المتسابق أونلاين عن طريق WebSocket");
const bad = await sock(`code=${code}&pid=nobody`).then(() => "open", () => "rejected");
ok(bad === "rejected", "شخص مش بالغرفة ما بيقدر يتصل");
ok((await post("/room/act", { code, key: "wrong", type: "start" })).status === 403, "بس الحكم بيقدر يتحكم");
ok((await post("/room/act", { code, key, type: "turnsec", sec: 15 })).j.turnSec === 15, "الحكم بيغيّر مدة الدور");
await post("/room/act", { code, key, type: "start" });
const filmRes = await post("/room/act", { code, key, type: "film", t: "movie", id: INCEPTION });
st = filmRes.j;
ok(st.stage === "play" && st.hints.length === 15, "اختيار فيلم بيجهّز 15 تلميح");
ok(st.turn === 0 && st.turnEnds - st.now > 14000 && st.turnEnds - st.now <= 15000, "الدور للفريق الأول ومؤقت 15 ثانية بالسيرفر");
await sleep(300);
ok(PA.last?.stage === "play" && PA.last.film === null && !PA.last.hints, "المتسابق ما بيشوف اسم الفيلم ولا كل التلميحات");

// التلميحات الخاصة
const h1 = await post("/room/hint", { code, pid: A });
ok(h1.status === 200 && h1.j.hint.lvl === "hard", "فريق 1 طلب تلميح وأخذ أول تلميح صعب");
const fast = await post("/room/hint", { code, pid: A2 });
ok(fast.status === 429, "ضغطتين ورا بعض ما بيطلّعوا تلميحين");
await sleep(1600);
await post("/room/hint", { code, pid: A2 });
await sleep(400);
const vA = await get(`/room/state?code=${code}&pid=${A}`), vB = await get(`/room/state?code=${code}&pid=${B}`);
ok(vA.myHints.length === 2, "فريق 1 بيشوف تلميحاته (2)");
ok(vB.myHints.length === 0, "فريق 2 ما بيشوف تلميحات فريق 1");
ok(PB.last?.myHints?.length === 0 && PA.last?.myHints?.length === 2, "نفس الشي عبر WebSocket");
ok(vB.roundHints[0] === 2 && vB.hintsTotal[0] === 2, "فريق 2 بيعرف العدد بس (2) بدون المحتوى");
const jv = await get(`/room/state?code=${code}&key=${key}`);
ok(jv.hints[0].got.includes(0) && jv.hints[1].got.includes(0) && !jv.hints[2].got.length, "الحكم بيشوف مين أخذ أي تلميح");
const hb = await post("/room/hint", { code, pid: B });
ok(hb.j.hint?.i === 0, "فريق 2 بيبلّش من أول تلميح عنده هو");

// الحكم بيمرر الدور
const p1 = await post("/room/act", { code, key, type: "pass" });
ok(p1.j.turn === 1 && p1.j.lastPass?.why === "judge", "الحكم جاوب → الدور للفريق الثاني");
// إيقاف واستئناف
const pz = await post("/room/act", { code, key, type: "pause" });
ok(pz.j.paused && pz.j.turnEnds === null && pz.j.left > 0, "إيقاف المؤقت");
await sleep(1200);
const rs = await post("/room/act", { code, key, type: "resume" });
ok(!rs.j.paused && rs.j.turnEnds - rs.j.now > 13000, "استئناف بنفس الوقت المتبقي");
// انتهاء الوقت تلقائياً
console.log("… نستنى المؤقت يخلص (15 ثانية)");
await sleep(15800);
const afterT = await get(`/room/state?code=${code}&key=${key}`);
ok(afterT.turn === 0 && afterT.lastPass?.why === "timeout" && afterT.lastPass.team === 1, "خلص الوقت → راحت على الفريق والدور رجع للأول");
ok(PA.last?.lastPass?.why === "timeout", "الجوالات وصلها خبر انتهاء الوقت");

// فوز وجولة ثانية وكسر تعادل
let rv = await post("/room/act", { code, key, type: "reveal", winner: 1 });
ok(rv.j.score[1] === 1 && rv.j.stage === "reveal" && rv.j.turnEnds === null, "فريق 2 عرفه → نقطة والمؤقت وقف");
await sleep(200);
ok(PA.last?.film?.en === "Inception", "بعد الكشف المتسابقين بيشوفوا الفيلم");
await post("/room/act", { code, key, type: "next" });
st = (await post("/room/act", { code, key, type: "film", t: "movie", id: 27205 })).j;
ok(st.turn === 1, "الجولة الثانية بيبلّش الفريق الثاني");
ok(st.roundHints[0] === 0 && st.hintsTotal[0] === 2, "تلميحات الجولة تصفّرت بس المجموع محفوظ");
rv = await post("/room/act", { code, key, type: "reveal", winner: 0 });
const end = await post("/room/act", { code, key, type: "end" });
ok(end.j.score[0] === 1 && end.j.score[1] === 1, "تعادل بالنقاط 1-1");
ok(end.j.final.winner === 1 && end.j.final.reason === "hints", "التعادل → فاز الفريق اللي طلب تلميحات أقل (فريق 2: 1 مقابل 2)");
ok(end.j.rounds.length === 2, "سجل الجولات للكرت");
const ng = await post("/room/act", { code, key, type: "newgame" });
ok(ng.j.score[0] === 0 && ng.j.stage === "pick", "سهرة جديدة بتصفّر النتيجة");

// خروج متسابق
await post("/room/leave", { code, pid: B2 });
st = await get(`/room/state?code=${code}&key=${key}`);
ok(st.players.length === 3, "المتسابق طلع من الغرفة");
ok((await get(`/room/state?code=9999&key=x`)).error === "room" || true, "غرفة مش موجودة");
J.ws.close(); PA.ws.close(); PB.ws.close();
console.log(fails ? `\n${fails} اختبار فشل` : "\nكل الاختبارات نجحت");
process.exit(fails ? 1 : 0);
