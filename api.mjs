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

// ===== ذكاء صناعي: يعرف الفيلم من قصته =====
const PROMPT = s => `You are a film expert. Someone describes the plot of a movie (in Arabic or English, possibly vague or with mistakes). Identify the movie.
Return ONLY JSON: {"candidates":[{"title":"<official English title>","year":<release year>,"why":"<one short sentence in Arabic explaining the match>"}]}
Give up to 3 candidates, most likely first. Prefer real, well-known feature films.
Plot: """${s}"""`;
async function postJSON(url, body, headers = {}) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(url.split("/")[2] + " " + r.status + " " + t.slice(0, 200));
  return JSON.parse(t);
}
async function askAI(story, errs = [], mk = PROMPT) {
  const p = mk(story);
  const ok = (source, text) => (parseCandidates(text).length ? { source, text } : (errs.push(source + ": no json"), null));
  if (process.env.GROQ_API_KEY) {
    for (const model of [process.env.GROQ_MODEL, "openai/gpt-oss-120b", "llama-3.3-70b-versatile"].filter(Boolean)) {
      try {
        const j = await postJSON("https://api.groq.com/openai/v1/chat/completions", { model, temperature: 0.2, messages: [{ role: "user", content: p }] }, { authorization: "Bearer " + process.env.GROQ_API_KEY });
        const r = ok("groq", j.choices?.[0]?.message?.content || ""); if (r) return r;
      } catch (e) { errs.push(String(e.message || e)); console.warn(String(e)); }
    }
  }
  if (process.env.GEMINI_API_KEY) {
    for (const model of [...new Set([process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest"].filter(Boolean))]) {
      try {
        const j = await postJSON(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { contents: [{ parts: [{ text: p }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }, { "x-goog-api-key": process.env.GEMINI_API_KEY });
        const r = ok("gemini", j.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("") || ""); if (r) return r;
      } catch (e) { errs.push(model + " " + String(e.message || e)); console.warn(model, String(e)); }
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const j = await postJSON("https://api.anthropic.com/v1/messages", { model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 500, messages: [{ role: "user", content: p }] }, { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" });
      const r = ok("claude", j.content?.map(x => x.text || "").join("") || ""); if (r) return r;
    } catch (e) { errs.push(String(e.message || e)); console.warn(String(e)); }
  }
  return null;
}
function parseCandidates(text) {
  const m = (text || "").match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { return (JSON.parse(m[0]).candidates || []).filter(c => c && c.title).slice(0, 3); } catch { return []; }
}
async function wikiGuess(story) {
  const u = "https://en.wikipedia.org/w/api.php?format=json&action=query&list=search&srlimit=3&srsearch=" + encodeURIComponent(story + ' hastemplate:"Infobox film"');
  const r = await fetch(u, { headers: { "user-agent": "sahra-film-site/1.0" } });
  const j = await r.json();
  return (j.query?.search || []).map(s => {
    const y = s.title.match(/\((\d{4}) film\)/);
    return { title: s.title.replace(/\s*\((\d{4} )?film\)\s*$/, ""), year: y ? +y[1] : null, why: "" };
  });
}
async function resolve(c) {
  const params = { query: c.title, include_adult: "false", language: "en-US" };
  let j = c.year ? await tmdb("/search/movie", { ...params, year: String(c.year) }) : null;
  if (!j?.results?.length) j = await tmdb("/search/movie", params);
  const m = j?.results?.[0];
  if (!m) return null;
  return { id: m.id, en: m.title, y: m.release_date ? +m.release_date.slice(0, 4) : null, rd: m.release_date || null, p: m.poster_path || null, pop: m.popularity || 0, tv: m.vote_average || null, tc: m.vote_count || 0, lang: m.original_language, g: m.genre_ids || [], l: [], ext: true, why: c.why || "" };
}

// ===== الأنمي (مسلسلات وأفلام) =====
const isAnime = m => (m.genre_ids || (m.genres || []).map(g => g.id) || []).includes(16) && (m.original_language === "ja" || (m.origin_country || []).includes("JP"));
const animeItem = (m, t) => ({ id: m.id, t, en: t === "tv" ? m.name : m.title, orig: t === "tv" ? m.original_name : m.original_title, y: +((t === "tv" ? m.first_air_date : m.release_date) || "").slice(0, 4) || null, p: m.poster_path || null, pop: m.popularity || 0, tv: m.vote_average || null, tc: m.vote_count || 0, g: m.genre_ids || [] });
async function animeSearch(q) {
  const params = { query: q, include_adult: "false", language: "en-US" };
  const [a, b] = await Promise.all([tmdb("/search/tv", params).catch(() => null), tmdb("/search/movie", params).catch(() => null)]);
  const out = [...(a?.results || []).filter(isAnime).map(m => animeItem(m, "tv")), ...(b?.results || []).filter(isAnime).map(m => animeItem(m, "movie"))];
  return out.sort((x, y) => y.tc - x.tc).slice(0, 10);
}
function animeShape(d, t) {
  const tr = (d.translations?.translations || []).find(x => x.iso_639_1 === "ar")?.data || {};
  const tv = t === "tv";
  const crew = d.credits?.crew || d.aggregate_credits?.crew || [];
  const jobs = (...js) => [...new Set(crew.filter(c => js.includes(c.job) || (c.jobs || []).some(j => js.includes(j.job))).map(c => c.name))].slice(0, 6);
  const cast = tv
    ? (d.aggregate_credits?.cast || []).slice(0, 16).map(c => ({ n: c.name, ch: (c.roles || []).map(r => r.character).filter(Boolean).slice(0, 2).join(" / "), p: c.profile_path }))
    : (d.credits?.cast || []).slice(0, 16).map(c => ({ n: c.name, ch: c.character, p: c.profile_path }));
  return {
    id: d.id, t, imdb: d.external_ids?.imdb_id || d.imdb_id || null,
    en: tv ? d.name : d.title, orig: tv ? d.original_name : d.original_title, ar: (tr.name || tr.title || "").trim() || null,
    tag: (tr.tagline || d.tagline || "").trim() || null, ov: (tr.overview || d.overview || "").trim(),
    y: +((tv ? d.first_air_date : d.release_date) || "").slice(0, 4) || null,
    first: (tv ? d.first_air_date : d.release_date) || null, last: tv ? d.last_air_date || null : null,
    status: d.status || null, inprod: tv ? !!d.in_production : false,
    seasons: tv ? d.number_of_seasons || 0 : 0, episodes: tv ? d.number_of_episodes || 0 : 0,
    seasonList: tv ? (d.seasons || []).filter(x => x.season_number > 0).map(x => ({ n: x.season_number, name: x.name, ep: x.episode_count, y: (x.air_date || "").slice(0, 4) })) : [],
    rt: tv ? (d.episode_run_time || [])[0] || null : d.runtime || null,
    budget: d.budget || 0, revenue: d.revenue || 0,
    g: (d.genres || []).map(g => g.id), p: d.poster_path || null,
    tv: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null, tc: d.vote_count || 0,
    studios: (d.production_companies || []).slice(0, 6).map(c => ({ n: c.name, logo: c.logo_path })),
    networks: (d.networks || []).slice(0, 4).map(c => ({ n: c.name, logo: c.logo_path })),
    creators: tv ? (d.created_by || []).map(c => c.name) : [],
    dir: jobs("Director", "Series Director"), wri: jobs("Original Concept", "Comic Book", "Novel", "Series Composition", "Screenplay", "Writer", "Story"), mus: jobs("Original Music Composer", "Music"), chr: jobs("Character Designer"),
    cast,
  };
}
const ANIME_PROMPT = s => `You are an anime expert. Someone describes the plot of an anime series or anime film (in Arabic or English, possibly vague or with mistakes). Identify the anime.
Return ONLY JSON: {"candidates":[{"title":"<most common English or romaji title>","year":<first release year>,"why":"<one short sentence in Arabic explaining the match>"}]}
Give up to 3 candidates, most likely first. Only real Japanese anime.
Plot: """${s}"""`;

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=600" });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (u.pathname === "/" || u.pathname === "/health") return send(res, 200, { ok: true, key: !!KEY, ai: ["GROQ_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"].filter(k => process.env[k]).map(k => k.split("_")[0].toLowerCase()) });
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
    if (u.pathname === "/guess") {
      const story = (u.searchParams.get("story") || "").trim().slice(0, 800);
      if (story.length < 8) return send(res, 400, { error: "story is too short" });
      let source = "wikipedia", cands = [];
      const errs = [];
      const ai = await askAI(story, errs).catch(e => (errs.push(String(e)), null));
      if (ai) { source = ai.source; cands = parseCandidates(ai.text); }
      if (!cands.length) { source = "wikipedia"; cands = await wikiGuess(story).catch(() => []); }
      const seen = new Set(), results = [];
      for (const c of cands) { const f = await resolve(c).catch(() => null); if (f && !seen.has(f.id)) { seen.add(f.id); results.push(f); } }
      return send(res, 200, errs.length && source === "wikipedia" ? { source, results, aiError: errs.join(" | ").slice(0, 600) } : { source, results });
    }
    if (u.pathname === "/anime/search") {
      const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
      if (!q) return send(res, 400, { error: "q is required" });
      return send(res, 200, { results: await animeSearch(q) });
    }
    if (u.pathname === "/anime/random") {
      const page = 1 + Math.floor(Math.random() * 5);
      const j = await tmdb("/discover/tv", { with_genres: "16", with_original_language: "ja", sort_by: "vote_count.desc", page: String(page), language: "en-US" });
      const list = (j?.results || []).map(m => animeItem(m, "tv"));
      if (!list.length) return send(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" });
      return res.end(JSON.stringify(list[Math.floor(Math.random() * list.length)]));
    }
    if (u.pathname === "/anime/guess") {
      const story = (u.searchParams.get("story") || "").trim().slice(0, 800);
      if (story.length < 8) return send(res, 400, { error: "story is too short" });
      const errs = [];
      const ai = await askAI(story, errs, ANIME_PROMPT).catch(e => (errs.push(String(e)), null));
      const cands = ai ? parseCandidates(ai.text) : [];
      const seen = new Set(), results = [];
      for (const c of cands) {
        const list = await animeSearch(c.title).catch(() => []);
        const f = list.find(x => c.year && x.y && Math.abs(x.y - c.year) <= 1) || list[0];
        if (f && !seen.has(f.t + f.id)) { seen.add(f.t + f.id); results.push({ ...f, why: c.why || "" }); }
      }
      return send(res, 200, results.length ? { source: ai.source, results } : { source: "none", results, aiError: errs.join(" | ").slice(0, 600) });
    }
    const am = u.pathname.match(/^\/anime\/(tv|movie)\/(\d+)$/);
    if (am) {
      const tv = am[1] === "tv";
      const d = await tmdb("/" + am[1] + "/" + am[2], { language: "en-US", append_to_response: (tv ? "aggregate_credits" : "credits") + ",external_ids,translations" });
      if (!d) return send(res, 404, { error: "not found" });
      return send(res, 200, animeShape(d, am[1]));
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
