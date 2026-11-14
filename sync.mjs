// تحديث قائمة الأفلام كل ساعة: TMDB (الأفلام، البوسترات، التريلرات، وين تحضر بالإمارات) + تقييمات IMDb (ملفات IMDb المجانية)
// بيشتغل من GitHub Actions. المفتاح بيجي من السر TMDB_API_KEY.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const KEY = process.env.TMDB_API_KEY || "";
const BASE = process.env.TMDB_BASE || "https://api.themoviedb.org/3";
const IMDB_RATINGS = process.env.IMDB_RATINGS_URL || "https://datasets.imdbws.com/title.ratings.tsv.gz";
const OUT = "data/films.json";
const REGION = "AE";
if (!KEY) { console.error("TMDB_API_KEY is missing"); process.exit(1); }

const bearer = KEY.startsWith("eyJ");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!bearer) u.searchParams.set("api_key", KEY);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(u, { headers: bearer ? { Authorization: "Bearer " + KEY, accept: "application/json" } : { accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
    return r.json();
  }
  throw new Error("TMDB retries exhausted " + path);
}

// القوائم اللي بنسحب منها كل ساعة
const LISTS = [
  ["now",   "/movie/now_playing", { region: REGION }, 5],
  ["up",    "/movie/upcoming",    { region: REGION }, 3],
  ["trend", "/trending/movie/day", {}, 3],
  ["pop",   "/movie/popular",     {}, 40],
  ["top",   "/movie/top_rated",   {}, 40],
  ["ar",    "/discover/movie", { with_original_language: "ar", sort_by: "popularity.desc", "vote_count.gte": 5 }, 10],
  ["anime", "/discover/movie", { with_genres: "16", with_original_language: "ja", sort_by: "popularity.desc", "vote_count.gte": 20 }, 10],
];

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(e => (console.warn(String(e)), null)); }
  }));
  return out;
}

async function main() {
  let old = { films: [] };
  try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const byId = new Map(old.films.filter(f => f.id).map(f => [f.id, f]));

  // ١. القوائم
  const membership = new Map(); // id -> Set(lists)
  const basic = new Map();
  for (const [name, path, params, pages] of LISTS) {
    const reqs = Array.from({ length: pages }, (_, p) => p + 1);
    const res = await pool(reqs, 6, page => tmdb(path, { ...params, page }));
    for (const r of res) for (const m of (r?.results || [])) {
      if (m.adult) continue;
      if (!membership.has(m.id)) membership.set(m.id, new Set());
      membership.get(m.id).add(name);
      basic.set(m.id, m);
    }
  }
  console.log("ids from lists:", membership.size);

  // ٢. التفاصيل: الجديد كله + شريحة دوّارة من القديم (كل فيلم بيتحدّث كل ٣ أيام تقريباً) + السينما والقادم كل ساعة
  const hour = Math.floor(Date.now() / 3600000);
  const ids = [...new Set([...membership.keys(), ...byId.keys()])];
  const need = ids.filter(id => {
    const f = byId.get(id);
    const lists = membership.get(id);
    return !f || !f.en || id % 72 === hour % 72 || (lists && (lists.has("now") || lists.has("up")));
  });
  console.log("details to fetch:", need.length);
  const details = await pool(need, 8, id => tmdb(`/movie/${id}`, { language: "en-US", append_to_response: "videos,external_ids,watch/providers,translations" }));

  for (let k = 0; k < need.length; k++) {
    const d = details[k]; if (!d) continue;
    const tr = (d.translations?.translations || []).find(t => t.iso_639_1 === "ar")?.data || {};
    const vids = (d.videos?.results || []).filter(v => v.site === "YouTube");
    const trailer = vids.find(v => v.type === "Trailer" && v.official) || vids.find(v => v.type === "Trailer") || vids.find(v => v.type === "Teaser");
    const prov = d["watch/providers"]?.results?.[REGION] || {};
    const ov = (tr.overview || d.overview || "").replace(/\s+/g, " ").trim();
    byId.set(d.id, {
      id: d.id,
      imdb: d.external_ids?.imdb_id || d.imdb_id || null,
      en: d.title,
      ar: (tr.title || "").trim() || null,
      y: d.release_date ? +d.release_date.slice(0, 4) : null,
      rd: d.release_date || null,
      rt: d.runtime || null,
      g: (d.genres || []).map(g => g.id),
      lang: d.original_language,
      pop: Math.round((d.popularity || 0) * 10) / 10,
      tv: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      tc: d.vote_count || 0,
      p: d.poster_path || null,
      ov: ov.length > 230 ? ov.slice(0, 228).replace(/\s\S*$/, "") + "…" : ov,
      tr: trailer?.key || null,
      pr: [...new Set((prov.flatrate || []).concat(prov.free || [], prov.ads || []).map(x => x.provider_name))].slice(0, 4),
      rb: !!((prov.rent || []).length || (prov.buy || []).length),
    });
  }

  // ٣. عضوية القوائم الحالية
  for (const f of byId.values()) f.l = [...(membership.get(f.id) || [])];

  // ٤. تقييمات IMDb
  const wanted = new Set([...byId.values()].map(f => f.imdb).filter(Boolean));
  try {
    const r = await fetch(IMDB_RATINGS);
    if (!r.ok) throw new Error("IMDb " + r.status);
    const txt = gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8");
    let hits = 0;
    for (const line of txt.split("\n")) {
      const tab = line.indexOf("\t"); if (tab < 0) continue;
      const tt = line.slice(0, tab);
      if (!wanted.has(tt)) continue;
      const [, rating, votes] = line.split("\t");
      for (const f of byId.values()) if (f.imdb === tt) { f.ir = +rating; f.iv = +votes; }
      hits++;
    }
    console.log("imdb ratings matched:", hits);
  } catch (e) { console.warn("IMDb ratings skipped:", String(e)); }

  // ٥. حفظ: الأشهر أول، وحد أقصى ٤٠٠٠ فيلم
  const films = [...byId.values()].filter(f => f.en)
    .sort((a, b) => (b.l.length ? 1 : 0) - (a.l.length ? 1 : 0) || b.pop - a.pop)
    .slice(0, 4000);
  const out = { updated: new Date().toISOString(), source: "TMDB + IMDb", count: films.length, films };
  const oldCore = JSON.stringify(old.films || []);
  const newCore = JSON.stringify(films);
  if (oldCore === newCore) { console.log("no changes"); return; }
  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log("written", films.length, "films");
}

main().catch(e => { console.error(e); process.exit(1); });
