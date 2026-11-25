// المسلسلات من TVmaze (البيانات برخصة CC BY-SA، والاستخدام التجاري مسموح مع ذكر المصدر)
const TM = "https://api.tvmaze.com";
const cache = new Map();
async function get(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < 3600000) return hit.v;
  const r = await fetch(TM + path, { headers: { accept: "application/json" }, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("TVmaze " + r.status);
  const v = await r.json();
  if (cache.size > 1000) cache.clear();
  cache.set(path, { t: Date.now(), v });
  return v;
}
const G = { Action: 28, Adventure: 12, Comedy: 35, Crime: 80, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, "Science-Fiction": 878, Thriller: 53, War: 10752, Western: 37, Supernatural: 14, Espionage: 53, Legal: 18, Medical: 18, Sports: 18, Anime: 16 };
const genres = gs => [...new Set((gs || []).map(g => G[g]).filter(Boolean))];
const strip = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const year = s => +(s.premiered || "").slice(0, 4) || null;
const ok = s => s && s.type !== "Sports" && s.type !== "News" && s.type !== "Talk Show" && s.type !== "Award Show";
const item = s => ({ id: s.id, t: "tv", en: s.name, orig: s.name, y: year(s), p: s.image?.medium || null, pop: s.weight || 0, tv: s.rating?.average || null, tc: s.weight || 0, g: genres(s.genres), lang: s.language, imdb: s.externals?.imdb || null, src: "tvmaze" });

export async function tmSearch(q) {
  const j = await get("/search/shows?q=" + encodeURIComponent(q)) || [];
  return j.map(x => x.show).filter(ok).map(item).slice(0, 10);
}

export async function tmRandom() {
  for (let i = 0; i < 4; i++) {
    const list = (await get("/shows?page=" + Math.floor(Math.random() * 120)) || [])
      .filter(s => ok(s) && s.type === "Scripted" && (s.weight || 0) >= 90 && (s.rating?.average || 0) >= 7.5 && s.image);
    if (list.length) return item(list[Math.floor(Math.random() * list.length)]);
  }
  return null;
}

async function arabicName(id) {
  try {
    const q = `SELECT ?ar WHERE { ?x wdt:P8600 "${id}"; rdfs:label ?ar FILTER(LANG(?ar)="ar") } LIMIT 1`;
    const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { accept: "application/sparql-results+json", "user-agent": "SahraFilm/2.0 (https://sahrafilm.com)" }, signal: AbortSignal.timeout(4000), cf: { cacheTtl: 604800, cacheEverything: true } });
    return (await r.json()).results.bindings[0]?.ar?.value || null;
  } catch { return null; }
}

export async function tmDetail(id) {
  const [s, crew, ar] = await Promise.all([get(`/shows/${+id}?embed[]=cast&embed[]=seasons`), get(`/shows/${+id}/crew`).catch(() => []), arabicName(+id)]);
  if (!s) return null;
  const seasons = (s._embedded?.seasons || []).filter(x => x.number > 0);
  const who = (...types) => [...new Set((crew || []).filter(c => types.includes(c.type)).map(c => c.person.name))].slice(0, 6);
  return {
    id: s.id, t: "tv", imdb: s.externals?.imdb || null, tvmaze: s.id, url: s.url,
    en: s.name, orig: s.name, ar, tag: null, ov: strip(s.summary),
    y: year(s), first: s.premiered || null, last: s.ended || null,
    status: s.status === "Running" ? "Returning Series" : s.status || null, inprod: s.status === "Running",
    seasons: seasons.length, episodes: seasons.reduce((n, x) => n + (x.episodeOrder || 0), 0),
    seasonList: seasons.map(x => ({ n: x.number, name: x.name || "", ep: x.episodeOrder || 0, y: (x.premiereDate || "").slice(0, 4) })),
    rt: s.averageRuntime || s.runtime || null, budget: 0, revenue: 0,
    g: genres(s.genres), gen: s.genres || [], lang: s.language, p: s.image?.original || s.image?.medium || null,
    tv: s.rating?.average || null, tc: s.weight || 0,
    studios: [], networks: [s.network || s.webChannel].filter(Boolean).map(n => ({ n: n.name, logo: null, c: n.country?.code || null })),
    countries: [s.network?.country?.code || s.webChannel?.country?.code].filter(Boolean),
    creators: who("Creator", "Developer"), dir: who("Director"), wri: who("Creator", "Developer", "Writer"), prod: who("Executive Producer", "Showrunner"), mus: who("Composer", "Music"),
    cast: (s._embedded?.cast || []).slice(0, 16).map(c => ({ n: c.person.name, ch: c.character?.name || "", p: c.character?.image?.medium || c.person.image?.medium || null })),
  };
}
