// سيرفر صغير بيدوّر على أي فيلم بقاعدة TMDB (فيها تقريباً كل أفلام IMDb) — المفتاح بيضل هون مخفي
import http from "node:http";

const KEY = process.env.TMDB_API_KEY || "";
const BASE = process.env.TMDB_BASE || "https://api.themoviedb.org/3";
const PORT = process.env.PORT || 10000;
const bearer = KEY.startsWith("eyJ");
const cache = new Map();

async function tmdb(path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!bearer) u.searchParams.set("api_key", KEY);
  const ck = u.toString();
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < 3600000) return hit.v;
  const r = await fetch(u, { headers: bearer ? { Authorization: "Bearer " + KEY, accept: "application/json" } : { accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("TMDB " + r.status);
  const v = await r.json();
  if (cache.size > 2000) cache.clear();
  cache.set(ck, { t: Date.now(), v });
  return v;
}

function shape(d) {
  const tr = (d.translations?.translations || []).find(t => t.iso_639_1 === "ar")?.data || {};
  const crew = d.credits?.crew || [];
  const jobs = (...js) => [...new Set(crew.filter(c => js.includes(c.job)).map(c => c.name))].slice(0, 6);
  const rel = [];
  for (const r of d.release_dates?.results || []) {
    const all = r.release_dates || [];
    const th = all.filter(x => x.type === 3 || x.type === 2).sort((a, b) => a.release_date.localeCompare(b.release_date))[0] || all[0];
    if (th) rel.push({ c: r.iso_3166_1, d: th.release_date.slice(0, 10) });
  }
  rel.sort((a, b) => a.d.localeCompare(b.d));
  const vids = (d.videos?.results || []).filter(v => v.site === "YouTube");
  const trailer = vids.find(v => v.type === "Trailer" && v.official) || vids.find(v => v.type === "Trailer") || vids.find(v => v.type === "Teaser");
  const imdb = d.external_ids?.imdb_id || d.imdb_id || null;
  const film = {
    id: d.id, imdb, en: d.title, ar: (tr.title || "").trim() || null,
    y: d.release_date ? +d.release_date.slice(0, 4) : null, rd: d.release_date || null, rt: d.runtime || null,
    g: (d.genres || []).map(g => g.id), lang: d.original_language, pop: d.popularity || 0,
    tv: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null, tc: d.vote_count || 0,
    p: d.poster_path || null, ov: (tr.overview || d.overview || "").trim(), tr: trailer?.key || null, l: [], ext: true,
  };
  const det = {
    id: d.id, imdb, en: d.title, orig: d.original_title, ar: film.ar,
    tag: (tr.tagline || d.tagline || "").trim() || null, ov: film.ov,
    rd: film.rd, rt: film.rt, g: film.g, lang: film.lang,
    budget: d.budget || 0, revenue: d.revenue || 0,
    companies: (d.production_companies || []).slice(0, 6).map(c => ({ n: c.name, logo: c.logo_path, c: c.origin_country })),
    countries: (d.production_countries || []).map(c => c.iso_3166_1),
    langs: (d.spoken_languages || []).map(l => l.english_name),
    col: d.belongs_to_collection?.name || null, rel: rel.slice(0, 40),
    dir: jobs("Director"), prod: jobs("Producer"), wri: jobs("Screenplay", "Writer", "Novel", "Story"), mus: jobs("Original Music Composer", "Music"), dop: jobs("Director of Photography"),
    cast: (d.credits?.cast || []).slice(0, 16).map(c => ({ n: c.name, ch: c.character, p: c.profile_path })),
  };
  return { film, det };
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=600" });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (u.pathname === "/" || u.pathname === "/health") return send(res, 200, { ok: true, key: !!KEY });
    if (!KEY) return send(res, 500, { error: "TMDB_API_KEY is missing" });
    if (u.pathname === "/search") {
      const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
      if (!q) return send(res, 400, { error: "q is required" });
      const j = await tmdb("/search/movie", { query: q, include_adult: "false", language: "en-US" });
      const out = (j?.results || []).slice(0, 10).map(m => ({
        id: m.id, en: m.title, y: m.release_date ? +m.release_date.slice(0, 4) : null, rd: m.release_date || null,
        p: m.poster_path || null, pop: m.popularity || 0, tv: m.vote_average || null, tc: m.vote_count || 0,
        lang: m.original_language, g: m.genre_ids || [], l: [], ext: true,
      }));
      return send(res, 200, { results: out });
    }
    const m = u.pathname.match(/^\/movie\/(\d+)$/);
    if (m) {
      const d = await tmdb("/movie/" + m[1], { language: "en-US", append_to_response: "videos,external_ids,translations,credits,release_dates" });
      if (!d) return send(res, 404, { error: "not found" });
      return send(res, 200, shape(d));
    }
    send(res, 404, { error: "unknown route" });
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log("sahra api on", PORT));
