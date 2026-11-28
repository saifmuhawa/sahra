// الدفع عبر PayPal: شراء عملات سهرة.
// الباقات والأسعار محدّدة هون بالسيرفر — العميل بس بيبعت رقم الباقة، فما حدا بيقدر يتلاعب بالسعر.
// التدفق: /api/pay/config (الباقات + المعرّف العام) ← /create (ينشئ طلب PayPal) ← /capture (يقبض ويضيف العملات).
// العملات بتنضاف مرة وحدة لكل عملية قبض (ref = capture id)، فما في ازدواج.
import { currentUser, credit, balance, limited } from "./auth.js";

const CURRENCY = "USD";

// الباقات: id ثابت ما بيتغيّر، coins = كم عملة، price = السعر بالدولار (نص فيه خانتين).
// التدرّج بيخلّي سعر العملة الواحدة يرخص كل ما الباقة تكبر — الصفحة بتبيّن "وفّر ٪" لحالها.
// سهل التعديل: غيّر الأرقام بس. (الأسعار مبدئية لحد ما نثبّت تكلفة الغرفة والجوائز.)
export const PACKS = [
  { id: "starter", coins: 100,  price: "0.99" },
  { id: "popular", coins: 550,  price: "3.99",  badge: "الأكثر شعبية" },
  { id: "value",   coins: 1500, price: "8.99",  badge: "أفضل قيمة" },
  { id: "mega",    coins: 3500, price: "18.99" },
];
const packOf = id => PACKS.find(p => p.id === id);

// منفذ PayPal: sandbox بالتجربة، live بالنشر. PAYPAL_API بيسمح بسيرفر وهمي بالاختبارات.
const apiBase = env => env.PAYPAL_API || (env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
const configured = env => !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// توكن وصول PayPal (client_credentials)، بنخبّيه بالذاكرة لحد ما يقرب يخلص
let tok = { v: null, exp: 0 };
async function token(env) {
  const now = Date.now();
  if (tok.v && now < tok.exp) return tok.v;
  const auth = btoa(String(env.PAYPAL_CLIENT_ID).trim() + ":" + String(env.PAYPAL_SECRET).trim());
  const r = await fetch(apiBase(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: { authorization: "Basic " + auth, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("paypal auth " + r.status);
  const j = await r.json();
  tok = { v: j.access_token, exp: now + Math.max(0, (j.expires_in || 300) - 60) * 1000 };
  return tok.v;
}

export async function payRoute(req, env, path, u) {
  if (!env.DB) return reply({ error: "unavailable" }, 503);
  const op = path.slice("/pay".length); // /config /create /capture
  const packsPublic = PACKS.map(({ id, coins, price, badge }) => ({ id, coins, price, badge: badge || null, currency: CURRENCY }));

  // الإعدادات: الباقات + معرّف PayPal العام (مش سري) + هل الدفع جاهز
  if (op === "/config") return reply({ ready: configured(env), clientId: env.PAYPAL_CLIENT_ID || null, currency: CURRENCY, packs: packsPublic });

  if (req.method !== "POST") return reply({ error: "method" }, 405);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== u.host) return reply({ error: "origin" }, 403);
  if (!configured(env)) return reply({ error: "soon" }, 503); // لسا ما انحطّت مفاتيح PayPal

  const me = await currentUser(req, env);
  if (!me) return reply({ error: "login" }, 401);

  let b = {}; try { b = JSON.parse(await req.text() || "{}"); } catch { return reply({ error: "body" }, 400); }

  // إنشاء طلب دفع: السعر بيتحدّد بالسيرفر من رقم الباقة
  if (op === "/create") {
    if (await limited(env, "pay:" + me.id, 20, 3600e3)) return reply({ error: "slow" }, 429);
    const pk = packOf(b.pack);
    if (!pk) return reply({ error: "pack" }, 400);
    const r = await fetch(apiBase(env) + "/v2/checkout/orders", {
      method: "POST",
      headers: { authorization: "Bearer " + await token(env), "content-type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: pk.id,
          custom_id: me.id + ":" + pk.id,                 // بنربط الطلب بالمستخدم والباقة
          description: pk.coins + " عملة · سهرة فيلم",
          amount: { currency_code: CURRENCY, value: pk.price },
        }],
        application_context: { brand_name: "سهرة فيلم", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) { console.error("pp create", r.status, JSON.stringify(j).slice(0, 300)); return reply({ error: "paypal" }, 502); }
    return reply({ id: j.id });
  }

  // قبض الدفع: بنتأكد من الحالة والمستخدم والمبلغ، وبنضيف العملات مرة وحدة
  if (op === "/capture") {
    const orderID = String(b.orderID || "");
    if (!/^[A-Z0-9]{5,32}$/i.test(orderID)) return reply({ error: "order" }, 400);
    const r = await fetch(apiBase(env) + "/v2/checkout/orders/" + orderID + "/capture", {
      method: "POST",
      headers: { authorization: "Bearer " + await token(env), "content-type": "application/json" },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status !== "COMPLETED") { console.error("pp capture", r.status, JSON.stringify(j).slice(0, 300)); return reply({ error: "capture" }, 502); }
    const pu = j.purchase_units?.[0] || {};
    const cap = pu.payments?.captures?.[0] || {};
    const [uid, packId] = String(cap.custom_id || pu.custom_id || "").split(":");
    const pk = packOf(packId);
    // أمان: الطلب لازم يكون لنفس المستخدم، والمبلغ المقبوض = سعر الباقة بالضبط
    if (!pk || uid !== me.id) return reply({ error: "mismatch" }, 400);
    const paid = cap.amount;
    if (!paid || paid.currency_code !== CURRENCY || paid.value !== pk.price) return reply({ error: "amount" }, 400);
    if (!cap.id) return reply({ error: "capture" }, 502);
    const added = await credit(env, me.id, pk.coins, "payment", "pp:" + cap.id);
    return reply({ ok: true, added: added ? pk.coins : 0, coins: await balance(env, me.id) });
  }

  return reply({ error: "not found" }, 404);
}
