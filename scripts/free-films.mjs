// قائمة الأفلام من مصادر مجانية ومسموحة تجارياً:
//   Wikidata (CC0): الأسماء، التاريخ، المدة، الأنواع، الطاقم، الممثلين والشخصيات، شباك التذاكر، الإعلان
//   Wikipedia (CC BY-SA): ترتيب الممثلين من صندوق المعلومات، ملخص عربي، وقصة الفيلم (للذكاء الاصطناعي بس)
// بيطلّع نفس شكل الملفات اللي بتقرأها الصفحات: films.json + d/<id>.json
// التشغيل: node scripts/free-films.mjs   (OUT_DIR=data2 افتراضياً)
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT_DIR = process.env.OUT_DIR || "data2";
const SEED = process.env.SEED_FILE || "data/films.json"; // أفلام الموقع الحالية عشان ما نخسر ولا فيلم
const MAX = +process.env.MAX_FILMS || 4000;
const UA = { "user-agent": "SahraFilm/2.0 (https://sahrafilm.com; saiflex.u@gmail.com) node-fetch", accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ===== أدوات =====
async function getJSON(url, opt = {}, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(90000) });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(r.status + " " + url.slice(0, 120));
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(2000 * (i + 1)); }
  }
}
const sparql = q => getJSON("https://query.wikidata.org/sparql", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/sparql-results+json" }, body: "query=" + encodeURIComponent(q) }).then(j => j.results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value]))));
const qid = uri => uri.replace(/^.*\/entity\//, "");
const num = q => +q.replace(/^Q/, "");
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { console.warn("!", String(e).slice(0, 160)); } } }));
  return out;
}
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const today = new Date().toISOString().slice(0, 10);
const dayShift = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

// أنواع Wikidata → أرقام الأنواع اللي بتستخدمها الصفحات (نفس أرقام TMDB القديمة عشان ما نغيّر الواجهة)
const GENRE = {
  Q188473: 28, Q319221: 12, Q202866: 16, Q20650540: 16, Q157443: 35, Q859369: 35, Q959790: 80, Q93204: 99, Q130232: 18, Q1361932: 10751, Q157394: 14,
  Q17013749: 36, Q645928: 36, Q200092: 27, Q1342372: 27, Q842256: 10402, Q2421031: 10402, Q1200678: 9648, Q1054574: 10749, Q248583: 10749, Q471839: 878,
  Q2484376: 53, Q2973181: 53, Q369747: 10752, Q172980: 37, Q20442589: 80, Q1535153: 18, Q52162262: 28, Q3072049: 53, Q24925: 878, Q663106: 35, Q860626: 35,
  Q1146335: 10751, Q622548: 18, Q226540: 28, Q853630: 10749, Q2143665: 10749,
};

async function main() {
  // ١. مين الأفلام؟
  const pick = new Map(); // qid -> Set(lists)
  const add = (q, l) => { if (!pick.has(q)) pick.set(q, new Set()); if (l) pick.get(q).add(l); };

  let seedImdb = [];
  try { seedImdb = JSON.parse(await readFile(SEED, "utf8")).films.map(f => f.imdb).filter(Boolean); } catch {}
  log("seed imdb ids:", seedImdb.length);
  for (const part of chunks(seedImdb, 300)) {
    const rows = await sparql(`SELECT ?f ?imdb WHERE { VALUES ?imdb { ${part.map(i => `"${i}"`).join(" ")} } ?f wdt:P345 ?imdb . }`);
    for (const r of rows) add(qid(r.f));
  }
  log("from seed:", pick.size);

  const lists = [
    ["pop", `SELECT ?f WHERE { ?f wdt:P31 wd:Q11424; wikibase:sitelinks ?sl; wdt:P345 []. FILTER(?sl >= 45) } ORDER BY DESC(?sl) LIMIT 2500`],
    ["top", `SELECT ?f (COUNT(DISTINCT ?aw) AS ?n) WHERE { ?f wdt:P31 wd:Q11424; wdt:P166 ?aw. ?aw wdt:P31 wd:Q19020. } GROUP BY ?f ORDER BY DESC(?n) LIMIT 300`],
    ["now", `SELECT DISTINCT ?f WHERE { ?f wdt:P31 wd:Q11424; wdt:P577 ?d. FILTER(?d >= "${dayShift(-75)}"^^xsd:dateTime && ?d <= "${today}"^^xsd:dateTime) ?w schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>. } LIMIT 400`],
    ["up", `SELECT DISTINCT ?f WHERE { ?f wdt:P31 wd:Q11424; wdt:P577 ?d. FILTER(?d > "${today}"^^xsd:dateTime && ?d <= "${dayShift(150)}"^^xsd:dateTime) ?w schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>. } LIMIT 300`],
    ["ar", `SELECT ?f WHERE { ?f wdt:P31 wd:Q11424; wdt:P364 wd:Q13955; wikibase:sitelinks ?sl. FILTER(?sl >= 6) } ORDER BY DESC(?sl) LIMIT 400`],
    ["anime", `SELECT ?f WHERE { ?f wdt:P31 wd:Q11424; wdt:P364 wd:Q5287; wdt:P136 ?g; wikibase:sitelinks ?sl. VALUES ?g { wd:Q202866 wd:Q20650540 wd:Q1107 } FILTER(?sl >= 12) } ORDER BY DESC(?sl) LIMIT 300`],
  ];
  for (const [name, q] of lists) {
    try { const rows = await sparql(q); rows.forEach(r => add(qid(r.f), name)); log("list", name, rows.length); }
    catch (e) { console.warn("list failed", name, String(e).slice(0, 200)); }
  }
  const ids = [...pick.keys()];
  log("films to build:", ids.length);

  // ٢. المعلومات الأساسية
  const F = new Map();
  await pool(chunks(ids, 120), 3, async part => {
    const V = part.map(q => "wd:" + q).join(" ");
    const rows = await sparql(`SELECT ?f (SAMPLE(?imdb) AS ?imdb) (SAMPLE(?en) AS ?en) (SAMPLE(?ar) AS ?ar) (SAMPLE(?ard) AS ?ard) (MIN(?date) AS ?date) (MAX(?dur) AS ?dur)
      (SAMPLE(?sl) AS ?sl) (SAMPLE(?yt) AS ?yt) (MAX(?box) AS ?box) (MAX(?bud) AS ?bud) (SAMPLE(?lang) AS ?lang) (SAMPLE(?orig) AS ?orig) (SAMPLE(?enw) AS ?enw) (SAMPLE(?arw) AS ?arw)
      WHERE { VALUES ?f { ${V} }
        OPTIONAL { ?f wdt:P345 ?imdb } OPTIONAL { ?f rdfs:label ?en FILTER(LANG(?en)="en") } OPTIONAL { ?f rdfs:label ?ar FILTER(LANG(?ar)="ar") }
        OPTIONAL { ?f schema:description ?ard FILTER(LANG(?ard)="ar") }
        OPTIONAL { ?f wdt:P577 ?date } OPTIONAL { ?f p:P2047/psv:P2047 [ wikibase:quantityAmount ?dur ] }
        OPTIONAL { ?f wikibase:sitelinks ?sl } OPTIONAL { ?f wdt:P1651 ?yt } OPTIONAL { ?f wdt:P2142 ?box } OPTIONAL { ?f wdt:P2130 ?bud }
        OPTIONAL { ?f wdt:P364/wdt:P218 ?lang } OPTIONAL { ?f wdt:P1476 ?orig }
        OPTIONAL { ?enw schema:about ?f; schema:isPartOf <https://en.wikipedia.org/> } OPTIONAL { ?arw schema:about ?f; schema:isPartOf <https://ar.wikipedia.org/> }
      } GROUP BY ?f`);
    for (const r of rows) {
      const q = qid(r.f);
      F.set(q, {
        q, id: num(q), imdb: r.imdb || null, en: r.en || r.orig || null, ar: r.ar || null, ard: r.ard || null,
        rd: r.date ? r.date.slice(0, 10) : null, rt: r.dur ? Math.round(+r.dur) : null, sl: +(r.sl || 0), tr: r.yt || null,
        revenue: r.box ? Math.round(+r.box) : 0, budget: r.bud ? Math.round(+r.bud) : 0, lang: r.lang || null, orig: r.orig || null,
        enw: r.enw ? decodeURIComponent(r.enw.replace("https://en.wikipedia.org/wiki/", "")).replace(/_/g, " ") : null,
        arw: r.arw ? decodeURIComponent(r.arw.replace("https://ar.wikipedia.org/wiki/", "")).replace(/_/g, " ") : null,
        g: new Set(), dir: [], prod: [], wri: [], mus: [], dop: [], cast: [], companies: [], countries: [], l: [...(pick.get(q) || [])],
      });
    }
  });
  log("basic info:", F.size);

  // ٣. الأنواع والطاقم والممثلين والشركات والدول
  await pool(chunks([...F.keys()], 80), 3, async part => {
    const V = part.map(q => "wd:" + q).join(" ");
    const g = await sparql(`SELECT ?f ?g WHERE { VALUES ?f { ${V} } { ?f wdt:P136 ?g } UNION { ?f wdt:P31 ?g } }`);
    for (const r of g) { const id = GENRE[qid(r.g)]; if (id) F.get(qid(r.f))?.g.add(id); }
    const crew = await sparql(`SELECT ?f ?p ?n WHERE { VALUES ?f { ${V} } VALUES ?p { wdt:P57 wdt:P58 wdt:P86 wdt:P344 wdt:P162 } ?f ?p ?x. ?x rdfs:label ?n FILTER(LANG(?n)="en") }`);
    const key = { P57: "dir", P58: "wri", P86: "mus", P344: "dop", P162: "prod" };
    for (const r of crew) { const f = F.get(qid(r.f)); const k = key[r.p.split("/").pop()]; if (f && k && !f[k].includes(r.n) && f[k].length < 6) f[k].push(r.n); }
    const cast = await sparql(`SELECT ?f ?n (SAMPLE(?chl) AS ?ch) (SAMPLE(?chs) AS ?chs) WHERE { VALUES ?f { ${V} } ?f p:P161 ?st. ?st ps:P161 ?a. ?a rdfs:label ?n FILTER(LANG(?n)="en")
      OPTIONAL { ?st pq:P453 ?c. ?c rdfs:label ?chl FILTER(LANG(?chl)="en") } OPTIONAL { ?st pq:P4633 ?chs } } GROUP BY ?f ?n`);
    for (const r of cast) { const f = F.get(qid(r.f)); if (f && f.cast.length < 30) f.cast.push({ n: r.n, ch: r.ch || r.chs || "" }); }
    const misc = await sparql(`SELECT ?f ?k ?v WHERE { VALUES ?f { ${V} } { ?f wdt:P272 ?x. ?x rdfs:label ?v FILTER(LANG(?v)="en") BIND("co" AS ?k) } UNION { ?f wdt:P495 ?x. ?x wdt:P297 ?v BIND("cn" AS ?k) } }`);
    for (const r of misc) { const f = F.get(qid(r.f)); if (!f) continue; if (r.k === "co" && f.companies.length < 6 && !f.companies.some(c => c.n === r.v)) f.companies.push({ n: r.v }); if (r.k === "cn" && !f.countries.includes(r.v)) f.countries.push(r.v); }
  });
  log("details from Wikidata done");

  // ٤. ويكيبيديا الإنجليزية: ترتيب الممثلين من صندوق المعلومات + القصة. والعربية: الملخص
  const films = [...F.values()].filter(f => f.en);
  let infobox = 0, plots = 0, arOv = 0;
  await pool(films.filter(f => f.enw), 6, async f => {
    const j = await getJSON("https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions|extracts&rvprop=content&rvslots=main&rvsection=0&explaintext=1&redirects=1&titles=" + encodeURIComponent(f.enw));
    const pg = j.query?.pages?.[0] || {};
    const wt = pg.revisions?.[0]?.slots?.main?.content || "";
    const starring = (wt.match(/\|\s*starring\s*=([\s\S]*?)\n\s*\|\s*[a-z_ ]+=/i) || [])[1] || "";
    const names = [...starring.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]|\*\s*([^\n\[{}|]+)|(?:^|<br\s*\/?>|\{\{(?:plainlist|ubl|unbulleted list)\|)\s*([A-Z][^|\n{}<\[\]]+)/gim)]
      .map(m => (m[2] || m[1] || m[3] || m[4] || "").replace(/\s*\(.*?\)\s*/g, "").trim()).filter(n => n && n.length < 40 && !/plainlist|ubl|unbulleted|^br$/i.test(n));
    if (names.length) {
      infobox++;
      const byName = new Map(f.cast.map(c => [c.n.toLowerCase(), c]));
      const ordered = [...new Set(names)].map(n => byName.get(n.toLowerCase()) || { n, ch: "" });
      f.cast = [...ordered, ...f.cast.filter(c => !ordered.some(o => o.n.toLowerCase() === c.n.toLowerCase()))];
    }
    const txt = pg.extract || "";
    const plot = (txt.split(/\n(?===+ )/).find(s => /^==+ (Plot|Synopsis|Premise|Story)/i.test(s)) || "").replace(/^==+[^\n]*\n/, "").trim();
    if (plot) { f.plotEn = plot.slice(0, 1500); plots++; }
    f.introEn = txt.split(/\n==/)[0].trim().slice(0, 500);
    if (!f.dir.length) { const d = (wt.match(/\|\s*director\s*=\s*\[\[([^\]|]+)/i) || [])[1]; if (d) f.dir.push(d); }
  });
  for (const part of chunks(films.filter(f => f.arw), 20)) {
    try {
      const j = await getJSON("https://ar.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&prop=extracts&exintro=1&explaintext=1&exlimit=20&redirects=1&titles=" + encodeURIComponent(part.map(f => f.arw).join("|")));
      const norm = new Map([...(j.query?.normalized || []), ...(j.query?.redirects || [])].map(x => [x.from, x.to]));
      const byT = new Map((j.query?.pages || []).map(p => [p.title, p.extract || ""]));
      for (const f of part) { const t = byT.get(norm.get(f.arw) || f.arw) || ""; if (t) { f.ovAr = t.replace(/\s+/g, " ").trim(); arOv++; } }
    } catch (e) { console.warn("arwiki", String(e).slice(0, 120)); }
    await sleep(200);
  }
  log(`wikipedia: infobox cast ${infobox}, plots ${plots}, arabic summaries ${arOv}`);

  // ٥. الحفظ بنفس شكل الموقع
  await mkdir(OUT_DIR + "/d", { recursive: true });
  const cut = s => s && s.length > 230 ? s.slice(0, 228).replace(/\s\S*$/, "") + "…" : s || "";
  const list = films.map(f => ({
    id: f.id, q: f.q, imdb: f.imdb, en: f.en, ar: f.ar, y: f.rd ? +f.rd.slice(0, 4) : null, rd: f.rd, rt: f.rt, g: [...f.g], lang: f.lang,
    pop: f.sl, p: f.imdb ? "imdb:" + f.imdb : null, ov: cut(f.ovAr || f.ard || ""), tr: f.tr, l: f.l,
  })).sort((a, b) => (b.l.length ? 1 : 0) - (a.l.length ? 1 : 0) || b.pop - a.pop).slice(0, MAX);
  const keep = new Set(list.map(f => f.id));
  let n = 0;
  for (const f of films) {
    if (!keep.has(f.id)) continue;
    const det = {
      id: f.id, q: f.q, imdb: f.imdb, en: f.en, orig: f.orig, ar: f.ar, tag: null, ov: f.ovAr || f.ard || "", plotEn: f.plotEn || f.introEn || "",
      rd: f.rd, rt: f.rt, g: [...f.g], lang: f.lang, budget: f.budget, revenue: f.revenue, companies: f.companies, countries: f.countries, langs: [], col: null, rel: [],
      dir: f.dir, prod: f.prod, wri: f.wri, mus: f.mus, dop: f.dop, cast: f.cast.slice(0, 16).map(c => ({ n: c.n, ch: c.ch, p: null })),
      wiki: { en: f.enw, ar: f.arw },
    };
    await writeFile(`${OUT_DIR}/d/${f.id}.json`, JSON.stringify(det)); n++;
  }
  // تقرير التغطية
  const kept = films.filter(f => keep.has(f.id)); const P = fn => Math.round(100 * kept.filter(fn).length / kept.length) + "%";
  const report = { films: kept.length, arTitle: P(f => f.ar), date: P(f => f.rd), runtime: P(f => f.rt), genres: P(f => f.g.size), director: P(f => f.dir.length), cast5: P(f => f.cast.length >= 5), chars3: P(f => f.cast.filter(c => c.ch).length >= 3), ovAr: P(f => f.ovAr || f.ard), plotEn: P(f => f.plotEn), trailer: P(f => f.tr), boxOffice: P(f => f.revenue), imdb: P(f => f.imdb),
    lists: Object.fromEntries(["now", "up", "pop", "top", "ar", "anime"].map(l => [l, kept.filter(f => f.l.includes(l)).length])) };
  await writeFile(`${OUT_DIR}/films.json`, JSON.stringify({ updated: new Date().toISOString(), source: "Wikidata + Wikipedia", count: list.length, films: list }));
  await writeFile(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 1));
  log("written", list.length, "films,", n, "detail files");
  console.log(JSON.stringify(report, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
