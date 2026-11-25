// الأنمي من AniList — بيشتغل من المتصفح (AniList بيمنع سيرفرات Cloudflare)
// الأنمي من AniList (مجاني، والاستخدام التجاري مسموح لحد دخل بسيط، مع ذكر المصدر)
// بيرجّع نفس الشكل اللي كانت بترجّعه دوال TMDB عشان الصفحات ما تتغيّر
const AL = "https://graphql.anilist.co";
const cache = new Map();

async function gql(query, variables) {
  const ck = query.length + JSON.stringify(variables);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < 3600000) return hit.v;
  const r = await fetch(AL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query, variables }) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("AniList " + r.status);
  const j = await r.json();
  if (j.errors?.length && !j.data) throw new Error("AniList " + j.errors[0].message);
  if (cache.size > 1000) cache.clear();
  cache.set(ck, { t: Date.now(), v: j.data });
  return j.data;
}

// أنواع AniList → أرقام الأنواع اللي بتفهمها الصفحات
const G = { Action: 28, Adventure: 12, Comedy: 35, Drama: 18, Fantasy: 14, Horror: 27, Mystery: 9648, Romance: 10749, "Sci-Fi": 878, Thriller: 53, Music: 10402, Psychological: 53, Supernatural: 14, Mecha: 878, "Slice of Life": 18, Sports: 18 };
const genres = gs => [...new Set((gs || []).map(g => G[g]).filter(Boolean))];
const typeOf = m => (m.format === "MOVIE" ? "movie" : "tv");
const yearOf = m => m.startDate?.year || m.seasonYear || null;
const dateOf = d => (d?.year ? `${d.year}-${String(d.month || 1).padStart(2, "0")}-${String(d.day || 1).padStart(2, "0")}` : null);
const strip = s => String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\(Source:[^)]*\)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
const title = m => m.title?.english || m.title?.romaji || m.title?.native || "";

const LIST = `id format title { romaji english native } startDate { year } seasonYear coverImage { large medium } averageScore popularity genres isAdult`;
const item = m => ({ id: m.id, t: typeOf(m), en: title(m), orig: m.title?.native || m.title?.romaji || null, y: yearOf(m), p: m.coverImage?.large || null, pop: m.popularity || 0, tv: m.averageScore ? m.averageScore / 10 : null, tc: m.popularity || 0, g: genres(m.genres), src: "anilist" });

export async function alSearch(q) {
  const d = await gql(`query($q:String){ Page(perPage:12){ media(search:$q, type:ANIME, isAdult:false, sort:[SEARCH_MATCH, POPULARITY_DESC]){ ${LIST} } } }`, { q });
  return (d?.Page?.media || []).filter(m => !m.isAdult && m.format !== "MUSIC").map(item).slice(0, 10);
}

export async function alRandom() {
  const page = 1 + Math.floor(Math.random() * 6);
  const d = await gql(`query($p:Int){ Page(page:$p, perPage:50){ media(type:ANIME, isAdult:false, sort:POPULARITY_DESC, format_in:[TV, MOVIE]){ ${LIST} } } }`, { p: page });
  const list = (d?.Page?.media || []).map(item);
  return list[Math.floor(Math.random() * list.length)] || null;
}

// الاسم العربي من Wikidata (P8729 = رقم AniList)
async function arabicName(id) {
  try {
    const q = `SELECT ?ar ?arw WHERE { ?x wdt:P8729 "${id}". OPTIONAL { ?x rdfs:label ?ar FILTER(LANG(?ar)="ar") } OPTIONAL { ?arw schema:about ?x; schema:isPartOf <https://ar.wikipedia.org/> } } LIMIT 1`;
    const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(4000), cf: { cacheTtl: 604800, cacheEverything: true } });
    const b = (await r.json()).results.bindings[0] || {};
    return b.ar?.value || null;
  } catch { return null; }
}

export async function alDetail(id) {
  const d = await gql(`query($id:Int){ Media(id:$id, type:ANIME){
    id idMal format status episodes duration season seasonYear title { romaji english native } synonyms
    startDate { year month day } endDate { year month day } description(asHtml:false) coverImage { extraLarge large } bannerImage
    averageScore popularity genres isAdult source countryOfOrigin trailer { id site }
    studios { edges { isMain node { name isAnimationStudio } } }
    staff(sort:RELEVANCE, perPage:25) { edges { role node { name { full } } } }
    characters(sort:[ROLE, RELEVANCE], perPage:16) { edges { role node { name { full } image { medium } } voiceActors(language:JAPANESE) { name { full } image { medium } } } }
    relations { edges { relationType node { id format title { romaji english } startDate { year } } } }
  } }`, { id: +id });
  const m = d?.Media;
  if (!m || m.isAdult) return null;
  const t = typeOf(m), tv = t === "tv";
  const staff = (...roles) => [...new Set((m.staff?.edges || []).filter(e => roles.some(r => (e.role || "").startsWith(r))).map(e => e.node.name.full))].slice(0, 6);
  const studios = (m.studios?.edges || []).filter(e => e.node.isAnimationStudio).map(e => ({ n: e.node.name, logo: null }));
  const seq = (m.relations?.edges || []).filter(e => ["SEQUEL", "PREQUEL"].includes(e.relationType) && e.node.format === "TV");
  return {
    id: m.id, t, imdb: null, al: m.id, mal: m.idMal || null,
    en: title(m), orig: m.title?.native || m.title?.romaji || null, romaji: m.title?.romaji || null, ar: await arabicName(m.id),
    tag: null, ov: strip(m.description),
    y: yearOf(m), first: dateOf(m.startDate), last: tv ? dateOf(m.endDate) : null,
    status: { FINISHED: "Ended", RELEASING: "Returning Series", NOT_YET_RELEASED: "Upcoming", CANCELLED: "Canceled" }[m.status] || null, inprod: m.status === "RELEASING",
    seasons: tv ? 1 + seq.filter(e => e.relationType === "SEQUEL").length : 0, episodes: tv ? m.episodes || 0 : 0, seasonList: [],
    rt: m.duration || null, budget: 0, revenue: 0,
    g: genres(m.genres), gen: m.genres || [], p: m.coverImage?.extraLarge || m.coverImage?.large || null, banner: m.bannerImage || null,
    tv: m.averageScore ? m.averageScore / 10 : null, tc: m.popularity || 0,
    studios: studios.length ? studios : (m.studios?.edges || []).filter(e => e.isMain).map(e => ({ n: e.node.name, logo: null })), networks: [],
    creators: staff("Original Creator", "Original Story"),
    dir: staff("Director", "Chief Director", "Series Director"), wri: staff("Original Creator", "Original Story", "Series Composition", "Script", "Screenplay"),
    mus: staff("Music"), chr: staff("Character Design", "Original Character Design"),
    source: m.source || null, tr: m.trailer?.site === "youtube" ? m.trailer.id : null,
    cast: (m.characters?.edges || []).map(e => ({ ch: e.node.name.full, n: e.voiceActors?.[0]?.name?.full || "", p: e.node.image?.medium || null, va: e.voiceActors?.[0]?.image?.medium || null, main: e.role === "MAIN" })),
  };
}

// تنظيف المعلومات اللي بتيجي من جوال الحكم قبل ما الغرفة تستخدمها
export function cleanAnime(d) {
  const str = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
  const arr = (v, n = 6) => (Array.isArray(v) ? v : []).slice(0, n).map(x => str(x, 80)).filter(Boolean);
  if (!d || typeof d !== "object" || !+d.id) return null;
  return {
    id: +d.id, t: d.t === "movie" ? "movie" : "tv", en: str(d.en, 150), ar: d.ar ? str(d.ar, 150) : null, orig: d.orig ? str(d.orig, 150) : null,
    y: +d.y || null, status: d.status ? str(d.status, 30) : null, episodes: +d.episodes || 0, seasons: +d.seasons || 0,
    g: (Array.isArray(d.g) ? d.g : []).slice(0, 8).map(Number).filter(Boolean), p: /^https:\/\/s4\.anilist\.co\//.test(d.p || "") ? str(d.p, 300) : null,
    ov: str(d.ov, 1500), studios: (Array.isArray(d.studios) ? d.studios : []).slice(0, 6).map(x => ({ n: str(x?.n, 80) })),
    dir: arr(d.dir), wri: arr(d.wri), mus: arr(d.mus), chr: arr(d.chr),
    cast: (Array.isArray(d.cast) ? d.cast : []).slice(0, 16).map(c => ({ ch: str(c?.ch, 80), n: str(c?.n, 80) })),
  };
}
