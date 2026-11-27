// اختبار البوتات: الحكم بيضيف بوت، والبوت بيلعب دور فريقه لحاله (تلميح، وبعدها تخمين أو تمرير)
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const API = BASE + "/api";
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "✓ " : "✗ ") + msg); if (!cond) fails++; };
const post = async (p, b) => { const r = await fetch(API + p, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const get = async p => (await fetch(API + p)).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const INCEPTION = 25188;

const { j: room } = await post("/room/create", { kind: "film" });
const code = room.code, key = room.key;
const act = (type, extra = {}) => post("/room/act", { code, key, type, ...extra });

let st = (await act("addbot", { team: 1, lvl: "hard" })).j;
const bot = st.players.find(p => p.bot);
ok(bot && bot.team === 1 && bot.lvl === "hard" && bot.on, "الحكم ضاف بوت صعب للفريق الثاني، وهو أونلاين");
const second = (await act("addbot", { team: 1 })).j.players.filter(p => p.bot).find(p => p.id !== bot.id);
ok((await act("addbot", { team: 1 })).status === 400, "ما في أكثر من بوتين بالفريق");
st = (await act("kick", { pid: second.id })).j;
ok(st.players.filter(p => p.bot).length === 1 && st.players.some(p => p.id === bot.id), "الحكم شال البوت الزيادة");

const A = (await post("/room/join", { code, name: "سيف" })).j.pid;
st = await get(`/room/state?code=${code}&key=${key}`);
ok(st.players.find(p => p.id === A)?.team === 0, "اللاعب دخل الفريق الأول (1 ضد البوت)");
ok((await post("/room/hint", { code, pid: bot.id })).status === 403, "ما حدا بيقدر يطلب تلميح باسم البوت");
ok((await post("/room/join", { code, name: "منتحل", pid: bot.id })).j.pid !== bot.id, "ما حدا بيقدر ياخد مكان البوت");
await post("/room/leave", { code, pid: bot.id });
ok((await get(`/room/state?code=${code}&key=${key}`)).players.some(p => p.id === bot.id), "ما حدا بيقدر يطلّع البوت غير الحكم");
// المنتحل دخل كلاعب جديد: نطلّعه عشان الفرق تكون 1 ضد 1
st = (await get(`/room/state?code=${code}&key=${key}`));
for (const p of st.players.filter(p => !p.bot && p.id !== A)) await act("kick", { pid: p.id });

ok((await act("start")).status === 200, "اللعبة بلّشت (لاعب ضد بوت)");
st = (await act("film", { t: "movie", id: INCEPTION })).j;
ok(st.stage === "play" && st.turn === 0, "الدور للفريق الأول (البشر)" + (st.error ? " — " + st.error : ""));
st = (await act("pass")).j;
ok(st.turn === 1, "الحكم مرّر → دور البوت");

// البوت: بعد 4 ثواني تلميح، وبعد 4 ثانية كمان يخمّن أو يمرّر. بنلعب لحد 4 أدوار
let sawHint = false, sawDecision = false, guessedRight = false, decisions = 0, lastAt = 0;
for (let k = 0; k < 5 && !guessedRight; k++) {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    st = await get(`/room/state?code=${code}&key=${key}`);
    const b = st.lastBot;
    if (!b || b.at === lastAt) continue;
    lastAt = b.at;
    if (b.act === "hint") sawHint = true;
    if (b.act === "guess" || b.act === "pass") { sawDecision = true; decisions++; if (b.act === "guess") guessedRight = true; break; }
  }
  if (guessedRight) break;
  if (st.stage === "play" && st.turn === 0) st = (await act("pass")).j; // رجّع الدور للبوت
}
console.log(`  (البوت لعب ${decisions} أدوار، وأخذ ${st.hintsTotal?.[1]} تلميحات، ${guessedRight ? "وعرفها" : "وما عرفها لسا"})`);
ok(decisions >= 2 || guessedRight, "البوت كمّل يلعب بكل دور إله");
ok(sawHint, "البوت طلب تلميح بدوره");
ok(sawDecision, "البوت قرّر: خمّن أو مرّر");
st = await get(`/room/state?code=${code}&key=${key}`);
ok(st.hintsTotal[1] >= 1 && st.hintsTotal[0] === 0, `تلميحات البوت انحسبت على فريقه بس (${st.hintsTotal[1]})`);
if (guessedRight) ok(st.stage === "reveal" && st.winner === 1 && st.score[1] === 1 && st.lastBot.text, "البوت عرفها وأخذ النقطة لحاله");
else ok(st.stage === "play", "البوت مرّر، واللعبة كمّلت");

// الحكم بيوقف الوقت: البوت كمان بيوقف
if (st.stage === "play") {
  if (st.turn === 0) st = (await act("pass")).j;
  st = (await act("pause")).j;
  const before = st.lastBot?.at;
  await sleep(5000);
  st = await get(`/room/state?code=${code}&key=${key}`);
  ok(st.lastBot?.at === before, "لما الوقت واقف البوت ما بيتحرك");
  await act("resume");
}

console.log(fails ? `\n${fails} اختبار فشل` : "\nكل الاختبارات نجحت");
process.exit(fails ? 1 : 0);
