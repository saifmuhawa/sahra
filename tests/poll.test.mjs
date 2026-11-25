// اختبار تصويت ECO 201: شغّل wrangler dev أول، بعدين: node tests/poll.test.mjs
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const S = "t" + Date.now().toString(36);
let fails = 0;
const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails++; };
const vote = (voter, price, s = S) => fetch(`${BASE}/api/poll/vote?s=${s}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voter, price }) });
const state = async (s = S) => (await fetch(`${BASE}/api/poll/state?s=${s}`)).json();

// 1) جلسة جديدة فاضية
let st = await state();
ok(st.n === 0 && st.prices.length === 0, "new session starts empty");

// 2) WebSocket بيستقبل التحديث فورًا
const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/poll/ws?s=${S}`);
const msgs = [];
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error("ws timeout")), 5000); });
ws.onmessage = e => { if (e.data !== "pong") msgs.push(JSON.parse(e.data)); };
await new Promise(r => setTimeout(r, 300));
ok(msgs.length >= 1 && msgs.at(-1).n === 0, "live screen connects and gets the current state");

// 3) أصوات صحيحة
const voters = Array.from({ length: 12 }, (_, i) => "voter" + String(i).padStart(4, "0") + "abc");
const prices = [30, 35, 40, 40, 45, 45, 45, 50, 50, 55, 60, 80];
const t0 = Date.now();
await Promise.all(voters.map((v, i) => vote(v, prices[i]).then(r => r.ok)));
st = await state();
ok(st.n === 12, `12 students voted at the same time → server counted ${st.n}`);
ok(JSON.stringify(st.prices) === JSON.stringify(prices.slice().sort((a, b) => a - b)), "every price stored correctly");
await new Promise(r => setTimeout(r, 400));
ok(msgs.at(-1)?.n === 12, `live screen updated over WebSocket (${msgs.length} pushes, last n=${msgs.at(-1)?.n}) in ${Date.now() - t0} ms`);

// 4) نفس الجوال يغيّر جوابه بدل ما ينحسب مرتين
let r = await vote(voters[0], 70);
st = await state();
ok(r.ok && st.n === 12 && st.prices.includes(70) && !st.prices.includes(30), "same phone changing its answer replaces it (no double count)");

// 5) رفض المدخلات الغلط
const bad = await Promise.all([
  vote("voter-bad-1", -5), vote("voter-bad-2", 9999), vote("voter-bad-3", "abc"), vote("x", 40),
  fetch(`${BASE}/api/poll/vote?s=${S}`, { method: "POST", body: "not json" }),
]);
ok(bad.every(x => x.status === 400), "rejects negative, huge, text prices, bad ids and broken requests (all 400)");
ok((await state()).n === 12, "rejected votes were not counted");

// 6) كسور بتتقرّب
r = await (await vote("voter-decimal-1", 44.6)).json();
ok(r.price === 45, "decimal 44.6 rounded to 45");

// 7) الجلسات منفصلة
st = await state(S + "x");
ok(st.n === 0, "a different session (?s=) is separate, so test votes never mix with the real class");
ok((await fetch(`${BASE}/api/poll/state?s=BAD%20NAME!`)).status === 400, "invalid session names rejected");
ok((await fetch(`${BASE}/api/poll/nope?s=${S}`)).status === 404, "unknown poll endpoints → 404");

// 8) الحفظ بيضل بعد إعادة الاتصال
ws.close();
const ws2 = new WebSocket(`${BASE.replace("http", "ws")}/api/poll/ws?s=${S}`);
const first = await new Promise((res, rej) => { ws2.onmessage = e => res(JSON.parse(e.data)); setTimeout(() => rej(new Error("ws2 timeout")), 5000); });
ok(first.n === 13, `reconnecting screen gets all votes back (n=${first.n})`);
ws2.close();

// 9) ضغط: 60 طالب
const big = "load" + Date.now().toString(36);
const t1 = Date.now();
const res = await Promise.all(Array.from({ length: 60 }, (_, i) => vote("loadvoter" + i + "xyz", 20 + (i % 50), big)));
ok(res.every(x => x.ok) && (await state(big)).n === 60, `60 simultaneous votes all saved in ${Date.now() - t1} ms`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
