// اختبار الدفع عبر PayPal — بسيرفر PayPal وهمي محلي، ما بيلمس PayPal الحقيقي أبداً.
// شغّل السيرفر هيك (بعد wrangler d1 migrations apply sahra-db --local):
//   npx wrangler dev --var PAYPAL_CLIENT_ID:test-cid --var PAYPAL_SECRET:test-sec \
//     --var PAYPAL_API:http://127.0.0.1:8798 --var PAYPAL_ENV:sandbox \
//     --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA
import http from "node:http";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
let fails = 0;
const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails++; };

// ===== سيرفر PayPal وهمي =====
const orders = new Map(); // orderId -> { custom_id, value, currency }
let seq = 1000;
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const send = o => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/v1/oauth2/token") return send({ access_token: "tok", expires_in: 3600 });
    if (req.url === "/v2/checkout/orders" && req.method === "POST") {
      const pu = JSON.parse(body).purchase_units[0];
      const id = "ORD" + (++seq);
      orders.set(id, { custom_id: pu.custom_id, value: pu.amount.value, currency: pu.amount.currency_code });
      return send({ id, status: "CREATED" });
    }
    const m = req.url.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (m && req.method === "POST") {
      const id = m[1];
      // طلبات وهمية لاختبار الحمايات
      if (id === "GHOST") return send({ status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAPG", custom_id: "ghost-user:value", amount: { currency_code: "USD", value: "8.99" } }] } }] });
      const o = orders.get(id);
      if (!o) { res.writeHead(404); return res.end("{}"); }
      const packId = o.custom_id.split(":")[1];
      // تلاعب بالمبلغ لباقة mega عشان نتأكد السيرفر بيرفض
      const value = packId === "mega" ? "1.00" : o.value;
      return send({ status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP-" + id, custom_id: o.custom_id, amount: { currency_code: o.currency, value } }] } }] });
    }
    res.writeHead(404); res.end("{}");
  });
});
await new Promise(r => mock.listen(8798, "127.0.0.1", r));

// ===== أدوات =====
let cookie = "";
const api = async (p, b) => {
  const r = await fetch(BASE + "/api" + p, { method: b === undefined ? "GET" : "POST", headers: { "content-type": "text/plain", ...(cookie ? { cookie } : {}) }, body: b });
  const sc = r.headers.getSetCookie?.() || [];
  for (const c of sc) if (c.startsWith("sahra_s=")) cookie = c.split(";")[0];
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

// ===== الاختبارات =====
// 1) الإعدادات: 4 باقات بالدولار
let r = await api("/pay/config");
ok(r.j.ready === true && r.j.packs.length === 4 && r.j.currency === "USD", "الإعدادات بترجّع الباقات وإنه الدفع جاهز");
const value = r.j.packs.find(p => p.id === "value");
ok(value.coins === 1500, "باقة 'أفضل قيمة' = 1500 عملة");

// 2) بدون تسجيل دخول: ممنوع
ok((await api("/pay/create", JSON.stringify({ pack: "value" }))).status === 401, "بدون حساب ما بتقدر تشتري");

// 3) تسجيل حساب جديد (بياخد كوكي جلسة)
const email = `pay${Date.now()}@test.com`;
r = await api("/auth/register", JSON.stringify({ email, name: "دافع", password: "pass1234", adult: true, ts: "x" }));
ok(r.j.ok === true && cookie, "تسجيل حساب جديد وجلسة");
const start = (await api("/auth/me")).j.coins || 0;

// 4) باقة غلط
ok((await api("/pay/create", JSON.stringify({ pack: "nope" }))).status === 400, "باقة مش موجودة بترفض");

// 5) شراء ناجح: إنشاء ثم قبض → العملات بتنضاف
const o = await api("/pay/create", JSON.stringify({ pack: "value" }));
ok(o.j.id, "إنشاء طلب دفع رجّع id");
let cap = await api("/pay/capture", JSON.stringify({ orderID: o.j.id }));
ok(cap.j.ok && cap.j.added === 1500, "القبض أضاف 1500 عملة");
ok(cap.j.coins === start + 1500, "الرصيد زاد 1500");

// 6) ما بتنضاف مرتين لنفس العملية
cap = await api("/pay/capture", JSON.stringify({ orderID: o.j.id }));
ok(cap.j.ok && cap.j.added === 0 && cap.j.coins === start + 1500, "نفس القبض ما بيضيف عملات مرتين");

// 7) تلاعب بالمبلغ (mega رجع $1 بدل $18.99) → مرفوض وما بتنضاف عملات
const mo = await api("/pay/create", JSON.stringify({ pack: "mega" }));
const mc = await api("/pay/capture", JSON.stringify({ orderID: mo.j.id }));
ok(mc.status === 400 && mc.j.error === "amount", "مبلغ مش مطابق لسعر الباقة بينرفض");
ok((await api("/auth/me")).j.coins === start + 1500, "ما انضافت عملات من الطلب المرفوض");

// 8) طلب لمستخدم ثاني → مرفوض
const g = await api("/pay/capture", JSON.stringify({ orderID: "GHOST" }));
ok(g.status === 400 && g.j.error === "mismatch", "قبض طلب مربوط بمستخدم ثاني بينرفض");

mock.close();
console.log(fails ? `\n${fails} اختبار فشل` : "\nكل الاختبارات نجحت");
process.exit(fails ? 1 : 0);
