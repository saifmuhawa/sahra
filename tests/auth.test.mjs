// اختبار الحسابات والعملات (D1) مع wrangler dev
// شغّل السيرفر هيك عشان روابط الإيميل ترجع بالرد بدل ما تنبعث:
//   npx wrangler d1 migrations apply sahra-db --local
//   npx wrangler dev --var DEV_MAIL_LINKS:1 --var ROOM_COINS:100
const BASE = process.env.BASE || "http://127.0.0.1:8787";
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "✓ " : "✗ ") + msg); if (!cond) fails++; };

// متصفح صغير بيحفظ الكوكيز
function browser() {
  const jar = new Map();
  return async (path, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
    const r = await fetch(BASE + "/api" + path, body === undefined ? { headers: { cookie, ...headers } } : { method: "POST", headers: { "content-type": "text/plain", cookie, ...headers }, body: JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)); }
    return { status: r.status, j: await r.json().catch(() => ({})), jar };
  };
}
const tokenOf = link => new URL(link, BASE).search.split("=")[1];

const email = `t${Date.now()}@example.com`, pass = "sahra-pass-123";
const A = browser();

ok((await A("/auth/config")).j.welcome === 100, "الإعدادات بترجع");
ok((await A("/auth/me")).j.user === null, "قبل التسجيل: ما في حساب");
ok((await A("/auth/register", { email: "bad", name: "سيف", password: pass })).j.error === "email", "إيميل غلط مرفوض");
ok((await A("/auth/register", { email, name: "سيف", password: "123" })).j.error === "password", "كلمة سر قصيرة مرفوضة");

const reg = await A("/auth/register", { email, name: "سيف", password: pass });
ok(reg.status === 200 && reg.j.devLink, "تسجيل حساب جديد");
ok(reg.jar.has("sahra_s") && reg.jar.get("sahra_in") === "1", "التسجيل بيدخّلك وبيحط الكوكي");
let me = (await A("/auth/me")).j;
ok(me.user?.email === email && me.user.verified === false && me.coins === 0, "داخل، والإيميل لسا مش مأكّد، والرصيد 0");
ok((await A("/auth/register", { email: email.toUpperCase(), name: "ثاني", password: pass })).status === 409, "نفس الإيميل ما بيتسجّل مرتين (حتى بأحرف كبيرة)");

// تأكيد الإيميل والهدية
const vt = tokenOf(reg.j.devLink);
const v1 = await A("/auth/verify", { token: vt });
ok(v1.j.ok && v1.j.gift === 100, "تأكيد الإيميل بيعطي 100 عملة");
ok((await A("/auth/verify", { token: vt })).j.error === "link", "رابط التأكيد ما بينستعمل مرتين");
me = (await A("/auth/me")).j;
ok(me.user.verified && me.coins === 100 && me.history[0]?.reason === "welcome", "الرصيد 100 والسجل فيه الهدية");

// الدخول والخروج
const B = browser();
ok((await B("/auth/login", { email, password: "wrong-pass" })).status === 401, "كلمة سر غلط ما بتدخّل");
ok((await B("/auth/login", { email: "nobody@example.com", password: pass })).j.error === "wrong", "إيميل مش موجود: نفس الرد");
ok((await B("/auth/login", { email: email.toUpperCase(), password: pass })).status === 200, "دخول بكلمة السر الصح");
ok((await B("/auth/me")).j.coins === 100, "من جهاز ثاني نفس الرصيد");
await B("/auth/logout", {});
ok((await B("/auth/me")).j.user === null, "بعد الخروج ما في حساب");

// الطلب من موقع ثاني مرفوض
ok((await A("/auth/logout", {}, { origin: "https://evil.example" })).status === 403, "طلب من موقع ثاني مرفوض");

// الغرفة بتكلّف 100 (السيرفر شغّال بـ ROOM_COINS=100)
const cfg = (await A("/auth/config")).j;
if (cfg.roomCoins === 100) {
  const anon = browser();
  ok((await anon("/room/create", { kind: "film" })).j.error === "login", "بدون حساب: لازم تسجّل دخول عشان تعمل غرفة");
  const r1 = await A("/room/create", { kind: "film" });
  ok(r1.status === 200 && r1.j.key, "الحكم عمل غرفة بـ 100 عملة");
  ok((await A("/auth/me")).j.coins === 0, "الرصيد صار 0");
  const r2 = await A("/room/create", { kind: "film" });
  ok(r2.status === 402 && r2.j.error === "coins" && !r2.j.key, "ما في رصيد: ما في غرفة ولا مفتاح حكم");
} else console.log("… (تخطّينا اختبار تكلفة الغرفة: شغّل السيرفر بـ --var ROOM_COINS:100)");

// نسيت كلمة السر
const C = browser();
ok((await C("/auth/forgot", { email: "nobody@example.com" })).j.ok, "نسيت كلمة السر لإيميل مش موجود: نفس الرد");
const fg = await C("/auth/forgot", { email });
ok(fg.j.ok && fg.j.devLink, "رابط استرجاع كلمة السر");
const newPass = "brand-new-pass-456";
ok((await C("/auth/reset", { token: tokenOf(fg.j.devLink), password: newPass })).j.ok, "غيّرنا كلمة السر");
ok((await A("/auth/me")).j.user === null, "الجلسات القديمة طلعت بعد تغيير كلمة السر");
ok((await C("/auth/me")).j.user?.email === email, "وإنت داخل بالجلسة الجديدة");
ok((await browser()("/auth/login", { email, password: pass })).status === 401, "كلمة السر القديمة ما عادت تزبط");
ok((await browser()("/auth/login", { email, password: newPass })).status === 200, "الجديدة بتزبط");
ok((await C("/auth/reset", { token: tokenOf(fg.j.devLink), password: "another-pass-789" })).j.error === "link", "رابط الاسترجاع ما بينستعمل مرتين");
ok((await C("/auth/me")).j.coins === (cfg.roomCoins === 100 ? 0 : 100), "الهدية ما انضافت مرة ثانية");

console.log(fails ? `\n${fails} اختبار فشل` : "\nكل الاختبارات نجحت");
process.exit(fails ? 1 : 0);
