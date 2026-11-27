// الحسابات والعملات (المرحلة ٢): D1 بـ binding اسمه DB
// - كلمة السر: PBKDF2-SHA256 بـ 150,000 مرة (وإذا Cloudflare رفض، 100,000)، وعدد المرات بينحفظ مع كل حساب
// - الجلسة: توكن عشوائي بكوكي httpOnly لمدة 30 يوم، وبقاعدة البيانات بس الـ hash تبعه
// - العملات: سجل حركات ما بينعدّل، والرصيد = المجموع. هدية 100 عملة بعد تأكيد الإيميل
// - الإيميل عن طريق Resend (RESEND_API_KEY)، والحماية من البوتات بـ Turnstile (TURNSTILE_SECRET)

const DAY = 864e5;
const SESSION_DAYS = 30;
const COOKIE = "sahra_s";
const WELCOME_COINS = 100;
const ITER = [150000, 100000];

const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async s => b64url(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const newId = () => crypto.randomUUID();

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  for (const iter of ITER) {
    try { return { hash: b64(await pbkdf2(password, salt, iter)), salt: b64(salt), iter }; }
    catch (e) { if (iter === ITER[ITER.length - 1]) throw e; }
  }
}
async function checkPassword(password, u) {
  const got = new Uint8Array(await pbkdf2(password, unb64(u.pass_salt), u.pass_iter));
  const want = unb64(u.pass_hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ===== ردود =====
function reply(obj, status = 200, cookies = []) {
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(JSON.stringify(obj), { status, headers: h });
}
const err = (code, status = 400, extra = {}) => reply({ error: code, ...extra }, status);
function sessionCookies(token, secure) {
  const s = secure ? "; Secure" : "";
  const age = token ? SESSION_DAYS * 86400 : 0;
  return [
    `${COOKIE}=${token || ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${s}`,
    // كوكي عادية بس عشان الصفحات تعرف إنك داخل بدون ما تسأل السيرفر
    `sahra_in=${token ? 1 : ""}; Path=/; SameSite=Lax; Max-Age=${age}${s}`,
  ];
}
const cookieOf = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="))?.slice(name.length + 1) || "";
const isSecure = u => u.protocol === "https:";
const ipOf = req => req.headers.get("cf-connecting-ip") || "local";

// ===== تحقق من المدخلات =====
const cleanEmail = s => String(s || "").trim().toLowerCase();
const emailOk = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const cleanName = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
const passOk = p => typeof p === "string" && p.length >= 8 && p.length <= 200;

// ===== حد المحاولات =====
async function limited(env, key, max, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare("INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start").bind(key, now).run();
    return false;
  }
  if (row.count >= max) return true;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return false;
}

// ===== Turnstile =====
async function humanOk(env, token, req) {
  if (!env.TURNSTILE_SECRET) return true; // لسا ما انحطّ المفتاح
  if (!token) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", String(token));
  body.append("remoteip", ipOf(req));
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    return !!(await r.json()).success;
  } catch { return false; }
}

// ===== الإيميل =====
async function sendMail(env, to, subject, text, link) {
  // بالتجربة المحلية بس: الرابط بيرجع بالرد (مسار نسبي عشان يفتح على نفس السيرفر المحلي)
  if (!env.RESEND_API_KEY) return { sent: false, devLink: env.DEV_MAIL_LINKS === "1" ? link.replace(/^https?:\/\/[^/]+/, "") : undefined };
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.7;color:#1b0d12">
    <p>${text}</p><p><a href="${link}" style="background:#c8323c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">اضغط هون</a></p>
    <p style="color:#7a6a60;font-size:13px">إذا ما طلبت هالإشي، تجاهل الإيميل.<br>سهرة فيلم · sahrafilm.com</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM || "سهرة فيلم <no-reply@sahrafilm.com>", to: [to], subject, html, text: text + "\n\n" + link }),
  });
  return { sent: r.ok };
}
async function mailToken(env, user, kind, origin) {
  const token = randomToken();
  const ttl = kind === "verify" ? 2 * DAY : 3600e3; // التأكيد يومين، والاسترجاع ساعة
  await env.DB.prepare("INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), user.id, kind, Date.now() + ttl).run();
  const link = `${env.CANONICAL_HOST ? "https://" + env.CANONICAL_HOST : origin}/login.html?${kind}=${token}`;
  return kind === "verify"
    ? sendMail(env, user.email, "أكّد حسابك بسهرة فيلم", `أهلاً ${user.name}! اضغط الزر عشان تأكّد إيميلك وتاخذ ${WELCOME_COINS} عملة هدية.`, link)
    : sendMail(env, user.email, "استرجاع كلمة السر · سهرة فيلم", "طلبت تغيّر كلمة السر؟ اضغط الزر خلال ساعة.", link);
}
async function useToken(env, token, kind) {
  if (!token || typeof token !== "string") return null;
  const id = await sha256(token);
  // بخطوة وحدة: بنعلّم التوكن إنه انستعمل بس إذا لسا صالح، عشان ما ينستعمل مرتين
  const row = await env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE id = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id")
    .bind(Date.now(), id, kind, Date.now()).first();
  return row?.user_id || null;
}

// ===== الجلسات =====
async function startSession(env, userId) {
  const token = randomToken(), now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY).run();
  return token;
}
export async function currentUser(req, env) {
  const token = cookieOf(req, COOKIE);
  if (!token || !env.DB) return null;
  return env.DB.prepare("SELECT u.id, u.email, u.name, u.verified_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?")
    .bind(await sha256(token), Date.now()).first();
}

// ===== العملات =====
export async function balance(env, userId) {
  return (await env.DB.prepare("SELECT COALESCE(SUM(delta), 0) AS b FROM coin_ledger WHERE user_id = ?").bind(userId).first())?.b || 0;
}
// إضافة (هدية، دفعة، جائزة): ما بتتكرر لنفس (reason, ref)
export async function credit(env, userId, amount, reason, ref = "") {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO coin_ledger (user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)").bind(userId, amount, reason, ref, Date.now()).run();
  return r.meta.changes > 0;
}
// خصم: بخطوة وحدة بس إذا الرصيد بيكفي، عشان طلبين مع بعض ما يخلّوا الرصيد بالسالب
export async function spend(env, userId, amount, reason, ref) {
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO coin_ledger (user_id, delta, reason, ref, created_at)
    SELECT ?1, -?2, ?3, ?4, ?5 WHERE (SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE user_id = ?1) >= ?2`).bind(userId, amount, reason, ref, Date.now()).run();
  return r.meta.changes > 0;
}

// ===== المسارات: /api/auth/... =====
export async function authRoute(req, env, path, u) {
  if (!env.DB) return err("unavailable", 503);
  const op = path.slice("/auth".length);
  if (op === "/config") return reply({ turnstile: env.TURNSTILE_SITE_KEY || null, judgeLogin: env.JUDGE_LOGIN === "1", roomCoins: +env.ROOM_COINS || 0, welcome: WELCOME_COINS });
  if (op === "/me") {
    const me = await currentUser(req, env);
    if (!me) return reply({ user: null });
    const hist = await env.DB.prepare("SELECT delta, reason, created_at FROM coin_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 20").bind(me.id).all();
    return reply({ user: { email: me.email, name: me.name, verified: !!me.verified_at }, coins: await balance(env, me.id), history: hist.results });
  }
  if (req.method !== "POST") return err("method", 405);
  // الطلبات اللي بتغيّر إشي لازم تيجي من نفس الموقع
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== u.host) return err("origin", 403);
  let b = {}; try { b = JSON.parse(await req.text() || "{}"); } catch { return err("body"); }
  const ip = ipOf(req), now = Date.now();

  if (op === "/register") {
    const email = cleanEmail(b.email), name = cleanName(b.name);
    if (!emailOk(email)) return err("email");
    if (name.length < 2) return err("name");
    if (!passOk(b.password)) return err("password");
    if (b.adult !== true) return err("adult"); // الحساب لـ 18+ وموافق على الشروط
    if (await limited(env, "reg:" + ip, 5, 3600e3)) return err("slow", 429);
    if (!(await humanOk(env, b.ts, req))) return err("human", 403);
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) return err("exists", 409);
    const p = await hashPassword(b.password);
    const user = { id: newId(), email, name };
    try {
      await env.DB.prepare("INSERT INTO users (id, email, name, pass_hash, pass_salt, pass_iter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(user.id, email, name, p.hash, p.salt, p.iter, now).run();
    } catch { return err("exists", 409); }
    const mail = await mailToken(env, user, "verify", u.origin);
    const token = await startSession(env, user.id);
    return reply({ ok: true, mailSent: mail.sent, devLink: mail.devLink }, 200, sessionCookies(token, isSecure(u)));
  }

  if (op === "/login") {
    const email = cleanEmail(b.email);
    if (!emailOk(email) || typeof b.password !== "string") return err("wrong", 401);
    if (await limited(env, "login:" + email, 10, 900e3) || await limited(env, "loginip:" + ip, 30, 900e3)) return err("slow", 429);
    if (!(await humanOk(env, b.ts, req))) return err("human", 403);
    const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user || !(await checkPassword(b.password, user))) return err("wrong", 401);
    const token = await startSession(env, user.id);
    return reply({ ok: true }, 200, sessionCookies(token, isSecure(u)));
  }

  if (op === "/logout") {
    const token = cookieOf(req, COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
    return reply({ ok: true }, 200, sessionCookies(null, isSecure(u)));
  }

  if (op === "/verify") {
    const userId = await useToken(env, b.token, "verify");
    if (!userId) return err("link", 400);
    await env.DB.prepare("UPDATE users SET verified_at = COALESCE(verified_at, ?) WHERE id = ?").bind(now, userId).run();
    const gift = await credit(env, userId, WELCOME_COINS, "welcome");
    return reply({ ok: true, gift: gift ? WELCOME_COINS : 0 });
  }

  if (op === "/resend") {
    const me = await currentUser(req, env);
    if (!me) return err("login", 401);
    if (me.verified_at) return reply({ ok: true, already: true });
    if (await limited(env, "resend:" + me.id, 3, 3600e3)) return err("slow", 429);
    const mail = await mailToken(env, me, "verify", u.origin);
    return reply({ ok: true, mailSent: mail.sent, devLink: mail.devLink });
  }

  if (op === "/forgot") {
    const email = cleanEmail(b.email);
    if (!emailOk(email)) return err("email");
    if (await limited(env, "forgot:" + email, 3, 3600e3) || await limited(env, "forgotip:" + ip, 10, 3600e3)) return err("slow", 429);
    if (!(await humanOk(env, b.ts, req))) return err("human", 403);
    const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?").bind(email).first();
    // نفس الرد سواء الإيميل موجود أو لا، عشان ما حدا يعرف مين مسجّل
    if (!user) return reply({ ok: true });
    const mail = await mailToken(env, user, "reset", u.origin);
    return reply({ ok: true, devLink: mail.devLink });
  }

  if (op === "/reset") {
    if (!passOk(b.password)) return err("password");
    const userId = await useToken(env, b.token, "reset");
    if (!userId) return err("link", 400);
    const p = await hashPassword(b.password);
    // كلمة سر جديدة = كل الجلسات القديمة بتطلع، والإيميل صار مأكّد لأنه وصله الرابط
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, verified_at = COALESCE(verified_at, ?) WHERE id = ?").bind(p.hash, p.salt, p.iter, now, userId),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    ]);
    await credit(env, userId, WELCOME_COINS, "welcome");
    const token = await startSession(env, userId);
    return reply({ ok: true }, 200, sessionCookies(token, isSecure(u)));
  }

  return err("not found", 404);
}
