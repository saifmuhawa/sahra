// نقطة الدخول على Cloudflare: الصفحات الثابتة من assets، والـAPI تحت /api، وغرف اللعب بـ Durable Objects
import { init, apiRoute, json } from "./api.js";
import { authRoute, currentUser, spend, humanOk, limited } from "./auth.js";
import { payRoute } from "./pay.js";
export { Room } from "./room.js";
export { Poll } from "./poll.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName("room-" + code));
const codeOk = c => /^\d{4}$/.test(c || "");

async function roomRoute(req, env, path, u) {
  const op = path.slice("/room".length); // /create /state /join /leave /act /hint /ws
  if (op === "/create" && req.method === "POST") {
    let b = {}; try { b = JSON.parse(await req.text() || "{}"); } catch {}
    // الحكم بس بيحتاج حساب (لما JUDGE_LOGIN = "1")، والغرفة بتكلّف ROOM_COINS عملة (0 = ببلاش)
    const cost = +env.ROOM_COINS || 0;
    let user = null;
    if (env.JUDGE_LOGIN === "1" || cost > 0) {
      user = await currentUser(req, env);
      if (!user) return json({ error: "login" }, 401, "no-store");
    }
    for (let i = 0; i < 25; i++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const res = await roomStub(env, code).fetch("https://room/create", { method: "POST", body: JSON.stringify({ code, kind: b.kind }) });
      if (res.status === 409) continue;
      // بنخصم بعد ما الغرفة انعملت، وإذا الرصيد ما بيكفي ما بنعطي مفتاح الحكم
      if (cost > 0 && res.ok && !(await spend(env, user.id, cost, "room", code + ":" + Date.now()))) return json({ error: "coins", cost }, 402, "no-store");
      return withCors(res);
    }
    return json({ error: "busy" }, 503, "no-store");
  }
  let code = u.searchParams.get("code"), body = null;
  if (req.method === "POST") {
    const t = await req.text();
    try { const b = JSON.parse(t || "{}"); code = code || String(b.code || ""); body = JSON.stringify(b); } catch { body = "{}"; }
  }
  if (!codeOk(code)) return json({ error: "room" }, 404, "no-store");
  const target = "https://room" + op + u.search;
  if (op === "/ws") return roomStub(env, code).fetch(new Request(target, req));
  const res = await roomStub(env, code).fetch(target, { method: req.method, body, headers: { "content-type": "application/json" } });
  return withCors(res);
}
// تصويت عرض ECO 201: /api/poll/vote و /api/poll/state و /api/poll/ws ، والجلسة بـ ?s=
async function pollRoute(req, env, path, u) {
  const op = path.slice("/poll".length);
  const s = (u.searchParams.get("s") || "class").toLowerCase();
  if (!/^[a-z0-9-]{1,24}$/.test(s)) return json({ error: "session" }, 400, "no-store");
  if (!["/vote", "/state", "/ws"].includes(op)) return json({ error: "not found" }, 404, "no-store");
  const stub = env.POLLS.get(env.POLLS.idFromName("eco201-" + s));
  if (op === "/ws") return stub.fetch(new Request("https://poll/ws", req));
  const body = req.method === "POST" ? await req.text() : undefined;
  const res = await stub.fetch("https://poll" + op, { method: req.method, body, headers: { "content-type": "application/json" } });
  return withCors(res);
}
function withCors(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

// استمارة المسابقة: بتمرّ على سيرفرنا بدل ما تروح لـ Google مباشرة.
// هون منتأكد إنه مش روبوت (Turnstile)، منحدّ الطلبات، ومنمسك الفخ، وبعدها منمرّر للشيت.
// رابط الشيت صار بإعدادات السيرفر (CONTEST_URL) مش بالصفحة.
const CONTEST_FALLBACK = "https://script.google.com/macros/s/AKfycbwLTQzPc1B6H1t-KEAMAG_4LPW78QijvmZKOgaLFqWrBBfKMePWNMNvwGOGli8ZD_rwMA/exec";
async function contestRoute(req, env, u) {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, "no-store");
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== u.host) return json({ ok: false, error: "origin" }, 403, "no-store");
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const text = await req.text();
  if (text.length > 8_000_000) return json({ ok: false, error: "big" }, 413, "no-store");
  let b = {}; try { b = JSON.parse(text || "{}"); } catch { return json({ ok: false, error: "bad" }, 400, "no-store"); }
  if (b.hp === true) return json({ ok: true }, 200, "no-store"); // فخ: البوت عبّى الحقل المخفي، منكذب عليه
  if (env.DB && await limited(env, "contest:" + ip, 30, 3600e3)) return json({ ok: false, error: "slow" }, 429, "no-store");
  if (!(await humanOk(env, b.ts, req))) return json({ ok: false, error: "human" }, 403, "no-store");
  // منمرّر كل شي إلا توكن Turnstile، ومنضيف مفتاح يثبت إنه الطلب إجا من سيرفرنا (إذا انحطّ)
  const { ts, ...payload } = b;
  if (env.CONTEST_SECRET) payload.wkey = env.CONTEST_SECRET;
  try {
    const r = await fetch(env.CONTEST_URL || CONTEST_FALLBACK, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "text/plain" } });
    return new Response(await r.text(), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch { return json({ ok: false, error: "net" }, 502, "no-store"); }
}

// ترويسات حماية على كل الردود: منع التأطير (Clickjacking)، منع تخمين نوع الملف،
// سياسة إحالة آمنة، وتعطيل صلاحيات ما بنستعملها. CSP متساهل: بيمنع التأطير بس
// وما بيكسر الخطوط وTurnstile ويوتيوب (السكربتات الداخلية تبقى شغّالة).
const SEC = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};
function withSecurity(res) {
  if (res.status === 101 || res.webSocket) return res; // لا نلمس ردود WebSocket
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SEC)) if (!r.headers.has(k)) r.headers.set(k, v);
  return r;
}

async function handle(req, env, ctx) {
    const u = new URL(req.url);
    // الدومين القديم أو www → الدومين الأساسي (لما يكون محدد)
    if (env.CANONICAL_HOST && u.hostname !== env.CANONICAL_HOST && !u.hostname.endsWith(".workers.dev") && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      u.hostname = env.CANONICAL_HOST; u.port = "";
      return Response.redirect(u.toString(), 301);
    }
    if (u.pathname === "/") { u.pathname = "/index.html"; return env.ASSETS.fetch(new Request(u, req)); }
    if (u.pathname === "/eco201" || u.pathname === "/eco201/") { u.pathname = "/eco201/index.html"; return env.ASSETS.fetch(new Request(u, req)); }
    if (!u.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    init(env);
    const path = u.pathname.slice(4) || "/";
    try {
      if (path.startsWith("/room/")) return await roomRoute(req, env, path, u);
      if (path.startsWith("/poll/")) return await pollRoute(req, env, path, u);
      if (path.startsWith("/auth/")) return await authRoute(req, env, path, u);
      if (path.startsWith("/pay/")) return await payRoute(req, env, path, u);
      if (path === "/contest") return await contestRoute(req, env, u);
      return await apiRoute(path, u);
    } catch (e) {
      // التفصيل بالـ logs بس، والمستخدم بياخد رسالة عامة
      console.error("api error", path, String(e && e.stack || e));
      return json({ error: "server" }, 502, "no-store");
    }
}

export default {
  async fetch(req, env, ctx) {
    return withSecurity(await handle(req, env, ctx));
  },
};
