// اختبار مسار المسابقة عبر السيرفر — بسيرفر وهمي محلي، ما بيلمس شيت Google الحقيقي أبداً.
// شغّل السيرفر هيك (السري اللي دايماً بينجح من Cloudflare، ورابط وهمي محلي):
//   npx wrangler dev --var CONTEST_URL:http://127.0.0.1:8799 --var CONTEST_SECRET:test-wkey \
//     --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA
import http from "node:http";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
let fails = 0;
const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails++; };
const post = async b => { const r = await fetch(BASE + "/api/contest", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

// سيرفر وهمي بمكان Apps Script: بيسجّل آخر طلب وصله
let lastSeen = null, hits = 0;
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    hits++; try { lastSeen = JSON.parse(body); } catch { lastSeen = body; }
    const dup = lastSeen?.phone === "500000000";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(dup ? { ok: false, error: "dup" } : { ok: true }));
  });
});
await new Promise(r => mock.listen(8799, "127.0.0.1", r));

const good = { name: "سيف محمد", email: "a@b.com", phone: "501234567", ig: "saif", emirate: "dubai", film: "both", agree: true, ts: "dummy-token" };

// 1) بدون توكن Turnstile → مرفوض، والشيت ما انلمس
let h0 = hits;
let r = await post({ ...good, ts: "" });
ok(r.status === 403 && r.j.error === "human", "بدون Turnstile: مرفوض");
ok(hits === h0, "ولا وصل للشيت");

// 2) الفخ (honeypot) → منكذب على البوت بـ ok، وما منمرّر
h0 = hits;
r = await post({ ...good, hp: true });
ok(r.j.ok === true && hits === h0, "الفخ: البوت بياخد ok بس ما بيوصل للشيت");

// 3) مشاركة صحيحة → بتمرّر، والرد بيرجع، وبدون توكن، ومعها مفتاح السيرفر
h0 = hits;
r = await post({ ...good });
ok(r.j.ok === true && hits === h0 + 1, "مشاركة صحيحة بتوصل للشيت");
ok(lastSeen && lastSeen.name === "سيف محمد" && lastSeen.ts === undefined, "التوكن ما بينمرّر للشيت");
ok(lastSeen.wkey === "test-wkey", "السيرفر بيضيف مفتاح يثبت إنه الطلب منه");

// 4) رد الخطأ من الشيت (تكرار) بيوصل للمتصفح زي ما هو
r = await post({ ...good, phone: "500000000" });
ok(r.j.ok === false && r.j.error === "dup", "خطأ التكرار من الشيت بيوصل للمتصفح");

// 5) حد الطلبات لكل IP: بعد عدد كبير بيصير slow
let sawOk = false, sawSlow = false;
for (let i = 0; i < 40; i++) {
  const x = await post({ ...good });
  if (x.j.ok) sawOk = true;
  if (x.status === 429 && x.j.error === "slow") { sawSlow = true; break; }
}
ok(sawOk, "الأول بيمرّ");
ok(sawSlow, "بعد كثير طلبات من نفس الـ IP بيتوقف (slow)");

mock.close();
console.log(fails ? `\n${fails} اختبار فشل` : "\nكل الاختبارات نجحت");
process.exit(fails ? 1 : 0);
