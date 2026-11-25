import { alSearch, alRandom, alDetail } from "./anilist.js";
import { tmSearch, tmRandom, tmDetail } from "./tvmaze.js";
import { wdSearch, wdFind, wdDetail } from "./wikidata.js";
// سيرفر صغير بيدوّر على أي فيلم بقاعدة TMDB (فيها تقريباً كل أفلام IMDb) — المفتاح بيضل هون مخفي

// بيئة Cloudflare: المفاتيح بتيجي من env (أسرار الـWorker)
export let E = {};
let KEY = "", BASE = "https://api.themoviedb.org/3", bearer = false;
export function init(env) { E = env || {}; KEY = E.TMDB_API_KEY || ""; BASE = E.TMDB_BASE || "https://api.themoviedb.org/3"; bearer = KEY.startsWith("eyJ"); }
export const hasKey = () => !!KEY;
const cache = new Map();

export async function tmdb(path, params = {}) {
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

export function shape(d) {
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
async function postJSON(url, body, headers = {}, ms = 12000) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const t = await r.text();
  if (!r.ok) throw new Error(url.split("/")[2] + " " + r.status + " " + t.slice(0, 200));
  return JSON.parse(t);
}
export async function askAI(story, errs = [], mk = PROMPT, check = t => parseCandidates(t).length, ms = 20000) {
  const p = mk(story);
  const ok = (source, text) => (check(text) ? { source, text } : (errs.push(source + ": no json: " + String(text).slice(0, 120)), null));
  if (E.GROQ_API_KEY) {
    for (const model of [E.GROQ_MODEL, "openai/gpt-oss-120b", "llama-3.3-70b-versatile"].filter(Boolean)) {
      try {
        const j = await postJSON("https://api.groq.com/openai/v1/chat/completions", { model, temperature: 0.2, messages: [{ role: "user", content: p }] }, { authorization: "Bearer " + E.GROQ_API_KEY }, ms);
        const r = ok("groq", j.choices?.[0]?.message?.content || ""); if (r) return r;
      } catch (e) { errs.push(String(e.message || e)); console.warn(String(e)); }
    }
  }
  if (E.GEMINI_API_KEY) {
    for (const model of [E.GEMINI_MODEL, "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.8-flash"].filter(Boolean)) {
      try {
        const j = await postJSON(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { contents: [{ parts: [{ text: p }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }, { "x-goog-api-key": E.GEMINI_API_KEY }, ms);
        const r = ok("gemini", j.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("") || ""); if (r) return r;
      } catch (e) { errs.push(model + " " + String(e.message || e)); console.warn(model, String(e)); }
    }
  }
  if (E.ANTHROPIC_API_KEY) {
    try {
      const j = await postJSON("https://api.anthropic.com/v1/messages", { model: E.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 1500, messages: [{ role: "user", content: p }] }, { "x-api-key": E.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, ms);
      const r = ok("claude", j.content?.map(x => x.text || "").join("") || ""); if (r) return r;
    } catch (e) { errs.push(String(e.message || e)); console.warn(String(e)); }
  }
  return null;
}
function parseCandidates(text) {
  const t = (text || "").trim();
  let j = null;
  for (const src of [t, (t.match(/\{[\s\S]*\}/) || [])[0], (t.match(/\[[\s\S]*\]/) || [])[0]]) {
    if (!src) continue;
    try { j = JSON.parse(src); break; } catch {}
  }
  if (!j) return [];
  const arr = Array.isArray(j) ? j : j.candidates || j.results || j.movies || j.anime || (j.title ? [j] : []);
  return (Array.isArray(arr) ? arr : []).filter(c => c && c.title).slice(0, 3);
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
  const f = await wdFind(c.title, c.year);
  return f ? { ...f, why: c.why || "" } : null;
}

// ===== الأنمي (مسلسلات وأفلام) =====
const isAnime = m => (m.genre_ids || (m.genres || []).map(g => g.id) || []).includes(16) && (m.original_language === "ja" || (m.origin_country || []).includes("JP"));
export const animeItem = (m, t) => ({ id: m.id, t, en: t === "tv" ? m.name : m.title, orig: t === "tv" ? m.original_name : m.original_title, y: +((t === "tv" ? m.first_air_date : m.release_date) || "").slice(0, 4) || null, p: m.poster_path || null, pop: m.popularity || 0, tv: m.vote_average || null, tc: m.vote_count || 0, g: m.genre_ids || [] });
export async function animeSearch(q) {
  const params = { query: q, include_adult: "false", language: "en-US" };
  const [a, b] = await Promise.all([tmdb("/search/tv", params).catch(() => null), tmdb("/search/movie", params).catch(() => null)]);
  const out = [...(a?.results || []).filter(isAnime).map(m => animeItem(m, "tv")), ...(b?.results || []).filter(isAnime).map(m => animeItem(m, "movie"))];
  return out.sort((x, y) => y.tc - x.tc).slice(0, 10);
}
export function animeShape(d, t) {
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
export const ANIME_PROMPT = s => `You are an anime expert. Someone describes the plot of an anime series or anime film (in Arabic or English, possibly vague or with mistakes). Identify the anime.
Return ONLY JSON: {"candidates":[{"title":"<most common English or romaji title>","year":<first release year>,"why":"<one short sentence in Arabic explaining the match>"}]}
Give up to 3 candidates, most likely first. Only real Japanese anime.
Plot: """${s}"""`;


export const GENRE_AR = {28:"أكشن",12:"مغامرة",16:"رسوم متحركة",35:"كوميدي",80:"جريمة",99:"وثائقي",18:"دراما",10751:"عائلي",14:"فانتازيا",36:"تاريخي",27:"رعب",10402:"موسيقي",9648:"غموض",10749:"رومانسي",878:"خيال علمي",53:"إثارة",10752:"حرب",37:"ويسترن",10770:"تلفزيوني",10759:"أكشن ومغامرة",10762:"أطفال",10765:"خيال علمي وفانتازيا",10768:"حرب وسياسة"};
export const regionAr = (() => { try { const d = new Intl.DisplayNames(["ar"], { type: "region" }); return c => { try { return d.of(c); } catch { return c; } }; } catch { return c => c; } })();
export const langAr = (() => { try { const d = new Intl.DisplayNames(["ar"], { type: "language" }); return c => { try { return d.of(c); } catch { return c; } }; } catch { return c => c; } })();
export const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
export const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
// كلمات الاسم عشان ما تنكشف بالهنتات
export function titleWords(...names) {
  const stop = new Set(["the", "and", "of", "a", "an", "in", "on", "to", "no", "wa"]);
  const ws = new Set();
  for (const n of names.filter(Boolean)) for (const w of String(n).toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3 && !stop.has(w)) ws.add(w);
  return [...ws];
}
export const leaks = (text, ws) => { const t = String(text).toLowerCase(); return ws.some(w => t.includes(w)); };
const mask = (text, ws) => ws.reduce((t, w) => t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "…"), String(text));
const firstSentence = t => (String(t).split(/(?<=[.!؟?])\s/)[0] || "").slice(0, 220);
const decadeAr = y => { if (!y) return ""; const d = Math.floor(y / 10) * 10; return { 1950: "الخمسينات", 1960: "الستينات", 1970: "السبعينات", 1980: "الثمانينات", 1990: "التسعينات", 2000: "الألفينات", 2010: "العشرية 2010", 2020: "العشرية 2020" }[d] || ("فترة " + d); };
const moneyAr = n => n >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, "") + " مليار دولار" : n >= 1e6 ? Math.round(n / 1e6) + " مليون دولار" : "";
const durAr = m => { if (!m) return ""; const h = Math.floor(m / 60), r = m % 60; return (h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h ? h + " ساعات" : "") + (h && r ? " و" : "") + (r ? r + " دقيقة" : ""); };
const wordsAr = n => n === 1 ? "كلمة وحدة" : n === 2 ? "كلمتين" : n + " كلمات";
export function fillLevels(c) {
  const out = { hard: [], mid: [], easy: [] };
  for (const k of ["hard", "mid", "easy"]) out[k] = [...new Set(c[k].filter(Boolean))];
  // إذا مستوى ناقص، نستلف من اللي جنبه
  const take = (to, from) => { while (out[to].length < 5 && out[from].length > 5) out[to].push(out[from].splice(out[from].length - 1, 1)[0]); };
  take("hard", "mid"); take("mid", "easy"); take("mid", "hard"); take("easy", "mid"); take("hard", "easy");
  return [...out.hard.slice(0, 5).map(text => ({ lvl: "hard", text })), ...out.mid.slice(0, 5).map(text => ({ lvl: "mid", text })), ...out.easy.slice(0, 5).map(text => ({ lvl: "easy", text }))];
}
export function dataHintsMovie(film, det) {
  const ws = titleWords(film.en, film.ar, det.orig);
  const ok = t => t && !leaks(t, ws);
  const g = (det.g || []).map(x => GENRE_AR[x]).filter(Boolean);
  const cast = det.cast || [];
  const c = { hard: [], mid: [], easy: [] };
  if (g.length) c.hard.push("نوعه: " + g.slice(0, 3).join("، "));
  if (film.y) c.hard.push("نزل بفترة " + decadeAr(film.y));
  if (det.countries?.length) c.hard.push("من إنتاج: " + det.countries.slice(0, 2).map(regionAr).join(" و"));
  if (det.rt) c.hard.push("مدته حوالي " + durAr(det.rt));
  if (det.lang && det.lang !== "en") c.hard.push("لغته الأصلية " + langAr(det.lang));
  const co = (det.companies || []).map(x => x.n).filter(ok);
  if (co.length) c.hard.push("من شركات إنتاجه " + co[co.length - 1]);
  if (det.mus?.length) c.hard.push("الموسيقى من تأليف " + det.mus[0]);
  if (film.y) c.mid.push("سنة الإصدار " + film.y);
  if (det.dir?.length) c.mid.push("المخرج " + det.dir[0]);
  if (cast[3]) c.mid.push("من الممثلين فيه " + cast[3].n);
  if (cast[4]) c.mid.push("كمان فيه " + cast[4].n);
  if (det.wri?.length && det.wri[0] !== det.dir?.[0]) c.mid.push("من كتّابه " + det.wri[0]);
  if (det.revenue > 1e6) c.mid.push("جاب بشباك التذاكر حوالي " + moneyAr(det.revenue));
  if (det.tag) c.mid.push("جملته الدعائية: \"" + mask(det.tag, ws) + "\"");
  if (cast[2]) c.easy.push("من أبطاله " + cast[2].n);
  if (cast[1]) c.easy.push("البطلة أو البطل الثاني " + cast[1].n);
  if (cast[0]?.ch && ok(cast[0].ch)) c.easy.push("اسم شخصية البطل " + cast[0].ch);
  if (cast[0]) c.easy.push("بطولة " + cast[0].n);
  if (det.ov) c.easy.push("القصة: " + mask(firstSentence(det.ov), ws));
  const name = film.en || ""; if (name) c.easy.push("اسمه بالإنجليزي " + wordsAr(name.split(/\s+/).length) + "، وبيبلش بحرف " + name.replace(/^the\s+/i, "")[0].toUpperCase());
  for (const k in c) c[k] = c[k].filter(ok);
  return fillLevels(c);
}
export function dataHintsAnime(d) {
  const ws = titleWords(d.en, d.ar, d.orig);
  const ok = t => t && !leaks(t, ws);
  const g = (d.g || []).map(x => GENRE_AR[x]).filter(x => x && x !== "رسوم متحركة");
  const cast = d.cast || [];
  const tv = d.t === "tv";
  const c = { hard: [], mid: [], easy: [] };
  if (g.length) c.hard.push("نوعه: " + g.slice(0, 3).join("، "));
  if (d.y) c.hard.push("بلّش بفترة " + decadeAr(d.y));
  const st = (d.studios || []).map(x => x.n).filter(ok);
  if (st.length) c.hard.push("من إنتاج " + st[0]);
  if (tv && d.status) c.hard.push(d.status === "Ended" ? "الأنمي خلص" : d.status === "Returning Series" ? "الأنمي لسا مستمر" : "حالته: " + d.status);
  if (d.mus?.length) c.hard.push("الموسيقى من تأليف " + d.mus[0]);
  if (!tv) c.hard.push("هو فيلم أنمي مش مسلسل");
  if (d.y) c.mid.push("أول ما نزل كان سنة " + d.y);
  if (tv && d.episodes) c.mid.push("عدد حلقاته " + d.episodes + (d.seasons > 1 ? " على " + d.seasons + " مواسم" : ""));
  if (d.dir?.length) c.mid.push("من مخرجيه " + d.dir[0]);
  if (d.wri?.length) c.mid.push("من كتّابه أو مؤلفيه " + d.wri[0]);
  if (cast[3]?.ch && ok(cast[3].ch)) c.mid.push("فيه شخصية اسمها " + cast[3].ch.replace(/\s*\(voice\)/i, ""));
  if (d.chr?.length) c.mid.push("تصميم الشخصيات " + d.chr[0]);
  if (cast[0]?.ch && ok(cast[0].ch)) c.easy.push("البطل اسمه " + cast[0].ch.replace(/\s*\(voice\)/i, ""));
  if (cast[1]?.ch && ok(cast[1].ch)) c.easy.push("فيه شخصية مهمة اسمها " + cast[1].ch.replace(/\s*\(voice\)/i, ""));
  if (cast[0]) c.easy.push("صوت البطل " + cast[0].n);
  if (d.ov) c.easy.push("القصة: " + mask(firstSentence(d.ov), ws));
  const name = d.en || ""; if (name) c.easy.push("اسمه بالإنجليزي " + wordsAr(name.split(/\s+/).length) + "، وبيبلش بحرف " + name.replace(/^the\s+/i, "")[0].toUpperCase());
  for (const k in c) c[k] = c[k].filter(ok);
  return fillLevels(c);
}
export function dataHintsSeries(d) {
  const ws = titleWords(d.en, d.ar, d.orig);
  const ok = t => t && !leaks(t, ws);
  const g = (d.g || []).map(x => GENRE_AR[x]).filter(Boolean);
  const cast = d.cast || [];
  const c = { hard: [], mid: [], easy: [] };
  if (g.length) c.hard.push("نوعه: " + g.slice(0, 3).join("، "));
  if (d.y) c.hard.push("بلّش بفترة " + decadeAr(d.y));
  if (d.countries?.length) c.hard.push("من إنتاج " + regionAr(d.countries[0]));
  if (d.status) c.hard.push(d.status === "Ended" ? "المسلسل خلص" : d.status === "Returning Series" ? "المسلسل لسا مستمر" : "حالته: " + d.status);
  if (d.lang && d.lang !== "English") c.hard.push("لغته الأصلية مش إنجليزي");
  if (d.y) c.mid.push("أول حلقة نزلت سنة " + d.y);
  if (d.seasons) c.mid.push("عدد مواسمه " + d.seasons + (d.episodes ? " وحلقاته تقريباً " + d.episodes : ""));
  const net = (d.networks || []).map(x => x.n).filter(ok);
  if (net.length) c.mid.push("انعرض على " + net[0]);
  if (d.creators?.length) c.mid.push("من صنّاعه " + d.creators[0]);
  if (cast[3]?.ch && ok(cast[3].ch)) c.mid.push("فيه شخصية اسمها " + cast[3].ch);
  if (cast[2]) c.mid.push("من ممثليه " + cast[2].n);
  if (cast[0]?.ch && ok(cast[0].ch)) c.easy.push("البطل اسمه " + cast[0].ch);
  if (cast[0]) c.easy.push("بطولة " + cast[0].n);
  if (cast[1]) c.easy.push("ومعه " + cast[1].n);
  if (d.ov) c.easy.push("القصة: " + mask(firstSentence(d.ov), ws));
  const name = d.en || ""; if (name) c.easy.push("اسمه بالإنجليزي " + wordsAr(name.split(/\s+/).length) + "، وبيبلش بحرف " + name.replace(/^the\s+/i, "")[0].toUpperCase());
  for (const k in c) c[k] = c[k].filter(ok);
  return fillLevels(c);
}
export const SERIES_PROMPT = s => `You are a TV expert. Someone describes the plot of a TV series (in Arabic or English, possibly vague or with mistakes). Identify the series.
Return ONLY JSON: {"candidates":[{"title":"<English title>","year":<first air year>,"why":"<one short sentence in Arabic explaining the match>"}]}
Give up to 3 candidates, most likely first. Only real TV series (not films, not anime).
Plot: """${s}"""`;
export const HINTS_PROMPT = (kindAr, info) => `You write hints for a party guessing game in Jordanian Arabic. Two teams must guess the ${kindAr} below by asking the judge questions; a team can ask for a hint, which only that team sees, starting with the hardest.
Write exactly 15 short hints in Arabic (one sentence each): 5 "hard" (vague: genre, era, mood, setting), 5 "medium" (specific: a famous scene, the director, a supporting actor, a key plot point, a production fact), 5 "easy" (almost gives it away: lead actor, main character name, iconic line or object).
If "wikipedia" text is included, use it to make the medium hints accurate and specific (real scenes, real behind-the-scenes facts). Write everything in your own Arabic words; never copy sentences.
NEVER write the title, any word from the title, or a sequel/franchise name. No numbering.
Return ONLY JSON: {"hard":["..."],"medium":["..."],"easy":["..."]}
Details: ${JSON.stringify(info)}`;
export function parseHints(text) {
  const t = String(text || "").trim();
  for (const src of [t, (t.match(/\{[\s\S]*\}/) || [])[0]]) { if (!src) continue; try { const j = JSON.parse(src); if (j && Array.isArray(j.hard) && Array.isArray(j.medium || j.mid) && Array.isArray(j.easy)) return { hard: j.hard, mid: j.medium || j.mid, easy: j.easy }; } catch {} }
  return null;
}

// ===== ويكيبيديا: ملخص القصة ومعلومات الإنتاج عشان الذكاء الاصطناعي يكتب تلميحات أدق =====
// نص ويكيبيديا برخصة CC BY-SA 4.0، وبنستخدمه كمصدر للذكاء الاصطناعي بس (مذكور بصفحة المصادر)
const WIKI_UA = { "user-agent": "SahraFilm/2.0 (https://sahrafilm.com; party film game)" };
function section(text, names) {
  const parts = String(text || "").split(/\n(?===+ [^=]+ ==+\n)/);
  for (const p of parts) { const h = (p.match(/^==+ ([^=]+?) ==+/) || [])[1]; if (h && names.some(n => h.toLowerCase().includes(n))) return p.replace(/^==+[^\n]*\n/, "").replace(/\n==+[^\n]*==+\n/g, "\n").trim(); }
  return "";
}
export async function wikiFacts(title, year, kind) {
  try {
    const tmpl = kind === "anime" ? 'hastemplate:"Infobox animanga"' : kind === "series" ? 'hastemplate:"Infobox television"' : 'hastemplate:"Infobox film"';
    const q = `${title} ${year || ""} ${tmpl}`.trim();
    const s = await (await fetch("https://en.wikipedia.org/w/api.php?format=json&action=query&list=search&srlimit=1&srsearch=" + encodeURIComponent(q), { headers: WIKI_UA, signal: AbortSignal.timeout(6000) })).json();
    const page = s.query?.search?.[0]?.title;
    if (!page) return null;
    const e = await (await fetch("https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts|langlinks&explaintext=1&exsectionformat=wiki&lllang=ar&redirects=1&titles=" + encodeURIComponent(page), { headers: WIKI_UA, signal: AbortSignal.timeout(6000) })).json();
    const pg = Object.values(e.query?.pages || {})[0] || {};
    const txt = pg.extract || "";
    const intro = txt.split(/\n==/)[0].trim();
    const plot = section(txt, ["plot", "synopsis", "premise", "story"]);
    const prod = section(txt, ["production", "development", "filming"]);
    let ar = "";
    const arTitle = pg.langlinks?.[0]?.["*"];
    if (arTitle) {
      try {
        const a = await (await fetch("https://ar.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=" + encodeURIComponent(arTitle), { headers: WIKI_UA, signal: AbortSignal.timeout(5000) })).json();
        ar = (Object.values(a.query?.pages || {})[0]?.extract || "").trim();
      } catch {}
    }
    return { page, intro: intro.slice(0, 700), plot: plot.slice(0, 1800), production: prod.slice(0, 900), arabicIntro: ar.slice(0, 600) };
  } catch { return null; }
}

// ===== مسارات الـAPI العامة (بحث، تفاصيل، ذكاء اصطناعي، صور) =====
const JH = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
export const json = (obj, code = 200, cache = "public, max-age=600") => new Response(JSON.stringify(obj), { status: code, headers: { ...JH, "cache-control": cache } });

export { alDetail, tmDetail, wdDetail };
export const filmItem = d => ({ id: d.id, q: d.q, imdb: d.imdb, en: d.en, ar: d.ar, y: d.y, rd: d.rd, rt: d.rt, g: d.g, lang: d.lang, pop: d.pop, p: d.p, ov: (d.ov || "").slice(0, 230), tr: d.tr, l: [] });
export async function apiRoute(path, u) {
  if (path === "/" || path === "/health") return json({ ok: true, key: !!KEY, ai: ["GROQ_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"].filter(k => E[k]).map(k => k.split("_")[0].toLowerCase()), host: "cloudflare" }, 200, "no-store");
  // بروكسي للبوسترات عشان كرت الستوري يقدر يرسمها على canvas بدون مشاكل CORS
  const im = path.match(/^\/img\/(w92|w154|w185|w342|w500|w780)\/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$/);
  if (im) {
    const r = await fetch(`https://image.tmdb.org/t/p/${im[1]}/${im[2]}`, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return new Response("not found", { status: 404 });
    return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "public, max-age=86400" } });
  }
  // بوستر من TheTVDB حسب رقم IMDb: /api/poster/tt1234567(.jpg)?s=t  (t = صورة صغيرة)
  const pm = path.match(/^\/poster\/(tt\d{5,10})(?:\.jpg)?$/);
  if (pm) return poster(pm[1], u.searchParams.get("s") === "t");
  if (path === "/series/search") {
    const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
    if (!q) return json({ error: "q is required" }, 400);
    return json({ results: await tmSearch(q) });
  }
  if (path === "/series/random") {
    const a = await tmRandom();
    return a ? json(a, 200, "no-store") : json({ error: "not found" }, 404);
  }
  if (path === "/series/guess") {
    const story = (u.searchParams.get("story") || "").trim().slice(0, 800);
    if (story.length < 8) return json({ error: "story is too short" }, 400);
    const errs = [];
    const ai = await askAI(story, errs, SERIES_PROMPT).catch(e => (errs.push(String(e)), null));
    const cands = ai ? parseCandidates(ai.text) : [];
    const seen = new Set(), results = [];
    for (const c of cands) {
      const list = await tmSearch(c.title).catch(() => []);
      const f = list.find(x => c.year && x.y && Math.abs(x.y - c.year) <= 1) || list[0];
      if (f && !seen.has(f.id)) { seen.add(f.id); results.push({ ...f, why: c.why || "" }); }
    }
    return json(results.length ? { source: ai.source, results } : { source: "none", results, aiError: errs.join(" | ").slice(0, 600) });
  }
  const sm = path.match(/^\/series\/(?:tv\/)?(\d+)$/);
  if (sm) {
    const d = await tmDetail(sm[1]);
    if (!d) return json({ error: "not found" }, 404);
    return json(d);
  }
  if (path === "/anime/search") {
    const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
    if (!q) return json({ error: "q is required" }, 400);
    return json({ results: await alSearch(q) });
  }
  if (path === "/anime/random") {
    const a = await alRandom();
    return a ? json(a, 200, "no-store") : json({ error: "not found" }, 404);
  }
  if (path === "/anime/guess") {
    const story = (u.searchParams.get("story") || "").trim().slice(0, 800);
    if (story.length < 8) return json({ error: "story is too short" }, 400);
    const errs = [];
    const ai = await askAI(story, errs, ANIME_PROMPT).catch(e => (errs.push(String(e)), null));
    const cands = ai ? parseCandidates(ai.text) : [];
    const seen = new Set(), results = [];
    for (const c of cands) {
      const list = await alSearch(c.title).catch(() => []);
      const f = list.find(x => c.year && x.y && Math.abs(x.y - c.year) <= 1) || list[0];
      if (f && !seen.has(f.t + f.id)) { seen.add(f.t + f.id); results.push({ ...f, why: c.why || "" }); }
    }
    return json(results.length ? { source: ai.source, results } : { source: "none", results, aiError: errs.join(" | ").slice(0, 600) });
  }
  const am = path.match(/^\/anime\/(tv|movie)\/(\d+)$/);
  if (am) {
    const d = await alDetail(am[2]);
    if (!d) return json({ error: "not found" }, 404);
    return json(d);
  }
  if (path === "/search") {
    const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
    if (!q) return json({ error: "q is required" }, 400);
    return json({ results: await wdSearch(q) });
  }
  if (path === "/guess") {
    const story = (u.searchParams.get("story") || "").trim().slice(0, 800);
    if (story.length < 8) return json({ error: "story is too short" }, 400);
    let source = "wikipedia", cands = [];
    const errs = [];
    const ai = await askAI(story, errs).catch(e => (errs.push(String(e)), null));
    if (ai) { source = ai.source; cands = parseCandidates(ai.text); }
    if (!cands.length) { source = "wikipedia"; cands = await wikiGuess(story).catch(() => []); }
    const seen = new Set(), results = [];
    for (const c of cands) { const f = await resolve(c).catch(() => null); if (f && !seen.has(f.id)) { seen.add(f.id); results.push(f); } }
    return json(errs.length && source === "wikipedia" ? { source, results, aiError: errs.join(" | ").slice(0, 600) } : { source, results });
  }
  const m = path.match(/^\/movie\/Q?(\d+)$/);
  if (m) {
    const det = await wdDetail(m[1]);
    if (!det) return json({ error: "not found" }, 404);
    return json({ film: filmItem(det), det });
  }
  return json({ error: "unknown route" }, 404);
}

// ===== TheTVDB (مجاني لحد ٥٠ ألف دولار دخل بالسنة، مع ذكر المصدر) =====
let tvdbTok = null;
async function tvdbToken() {
  if (tvdbTok && Date.now() - tvdbTok.t < 20 * 864e5) return tvdbTok.v;
  const r = await fetch("https://api4.thetvdb.com/v4/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apikey: E.TVDB_API_KEY }) });
  if (!r.ok) throw new Error("TVDB login " + r.status);
  tvdbTok = { t: Date.now(), v: (await r.json()).data.token };
  return tvdbTok.v;
}
export async function tvdb(path) {
  const go = async () => fetch("https://api4.thetvdb.com/v4" + path, { headers: { authorization: "Bearer " + await tvdbToken(), accept: "application/json" } });
  let r = await go();
  if (r.status === 401) { tvdbTok = null; r = await go(); }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("TVDB " + r.status);
  return (await r.json()).data;
}
async function poster(imdb, small) {
  const c = caches.default;
  const key = new Request(`https://sahrafilm.com/api/poster/${imdb}${small ? "?s=t" : ""}`);
  const hit = await c.match(key);
  if (hit) return hit;
  const miss = () => new Response(null, { status: 404, headers: { "cache-control": "public, max-age=21600", "access-control-allow-origin": "*" } });
  if (!E.TVDB_API_KEY) return miss();
  let url = null;
  try {
    const hits = await tvdb("/search/remoteid/" + imdb) || [];
    const h = hits.find(x => x.movie) || hits.find(x => x.series) || {};
    const it = h.movie || h.series;
    url = it?.image || null;
    if (url && !/^https?:/.test(url)) url = "https://artworks.thetvdb.com" + url;
  } catch (e) { return new Response(null, { status: 503, headers: { "cache-control": "no-store" } }); }
  if (!url) { const m = miss(); await c.put(key, m.clone()); return m; }
  let r = null;
  if (small) { r = await fetch(url.replace(/(\.\w+)$/, "_t$1"), { cf: { cacheTtl: 2592000, cacheEverything: true } }); if (!r.ok) r = null; }
  if (!r) r = await fetch(url, { cf: { cacheTtl: 2592000, cacheEverything: true } });
  if (!r.ok) return miss();
  const out = new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "public, max-age=2592000", "access-control-allow-origin": "*" } });
  await c.put(key, out.clone());
  return out;
}
