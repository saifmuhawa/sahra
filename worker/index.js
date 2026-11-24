// نقطة الدخول على Cloudflare: الصفحات الثابتة من assets، والـAPI تحت /api، وغرف اللعب بـ Durable Objects
import { init, apiRoute, json } from "./api.js";
export { Room } from "./room.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName("room-" + code));
const codeOk = c => /^\d{4}$/.test(c || "");

async function roomRoute(req, env, path, u) {
  const op = path.slice("/room".length); // /create /state /join /leave /act /hint /ws
  if (op === "/create" && req.method === "POST") {
    let b = {}; try { b = JSON.parse(await req.text() || "{}"); } catch {}
    for (let i = 0; i < 25; i++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const res = await roomStub(env, code).fetch("https://room/create", { method: "POST", body: JSON.stringify({ code, kind: b.kind }) });
      if (res.status !== 409) return withCors(res);
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
function withCors(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    // الدومين القديم أو www → الدومين الأساسي (لما يكون محدد)
    if (env.CANONICAL_HOST && u.hostname !== env.CANONICAL_HOST && !u.hostname.endsWith(".workers.dev") && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      u.hostname = env.CANONICAL_HOST; u.port = "";
      return Response.redirect(u.toString(), 301);
    }
    if (u.pathname === "/") { u.pathname = "/index.html"; return env.ASSETS.fetch(new Request(u, req)); }
    if (!u.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    init(env);
    const path = u.pathname.slice(4) || "/";
    try {
      if (path.startsWith("/room/")) return await roomRoute(req, env, path, u);
      return await apiRoute(path, u);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502, "no-store");
    }
  },
};
