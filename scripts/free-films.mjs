// قائمة الأفلام من مصادر مجانية ومسموحة تجارياً:
//   Wikidata (CC0): الأسماء، التاريخ، المدة، الأنواع، الطاقم، الممثلين والشخصيات، شباك التذاكر، الإعلان
//   Wikipedia (CC BY-SA): ترتيب الممثلين من صندوق المعلومات، ملخص عربي، وقصة الفيلم (للذكاء الاصطناعي بس)
// بيطلّع نفس شكل الملفات اللي بتقرأها الصفحات: films.json + d/<id>.json
// التشغيل: node scripts/free-films.mjs   (OUT_DIR=data افتراضياً)
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";

const OUT_DIR = process.env.OUT_DIR || "data";
const SEED = process.env.SEED_FILE || "data/films.json"; // أفلام الموقع الحالية عشان ما نخسر ولا فيلم
const MAX = +process.env.MAX_FILMS || 4500;
const UA = { "user-agent": "SahraFilm/2.0 (https://sahrafilm.com; saiflex.u@gmail.com) node-fetch", accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ===== أدوات =====
async function getJSON(url, opt = {}, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.method === "POST" ? 90000 : 20000) });
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
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { console.warn("!", String(e).slice(0, 400)); } } }));
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

  const nextDate = new Map();
  const lists = [
    ["pop", `SELECT ?f WHERE { VALUES ?c { wd:Q11424 wd:Q29168811 wd:Q20650540 } ?f wdt:P31 ?c; wikibase:sitelinks ?sl; wdt:P345 []. FILTER(?sl >= 30) } ORDER BY DESC(?sl) LIMIT 2500`],
    ["top", `SELECT ?f (COUNT(DISTINCT ?aw) AS ?n) WHERE { ?f wdt:P31 wd:Q11424; wdt:P166 ?aw. ?aw wdt:P31 wd:Q19020. } GROUP BY ?f ORDER BY DESC(?n) LIMIT 300`],
    ["now", `SELECT DISTINCT ?f WHERE { ?f wdt:P31 wd:Q11424; wdt:P577 ?d. FILTER(?d >= "${dayShift(-75)}"^^xsd:dateTime && ?d <= "${today}"^^xsd:dateTime) ?w schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>. } LIMIT 400`],
    ["up", `SELECT ?f (MIN(?d) AS ?nd) WHERE { ?f wdt:P31 wd:Q11424; wdt:P577 ?d. FILTER(?d > "${today}"^^xsd:dateTime && ?d <= "${dayShift(150)}"^^xsd:dateTime) ?w schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>. } GROUP BY ?f LIMIT 300`],
    ["ar", `SELECT ?f ?sl WHERE { ?f wdt:P364 wd:Q13955; wdt:P31 wd:Q11424; wikibase:sitelinks ?sl. FILTER(?sl >= 8) }`],
    // أفلام عربية مشهورة عندنا: إلها مقالة بويكيبيديا العربية ومن بلد عربي (مصر، سوريا، لبنان، الأردن، الخليج، المغرب العربي…)
    ["ar", `SELECT ?f ?sl WHERE { VALUES ?c { wd:Q79 wd:Q858 wd:Q822 wd:Q810 wd:Q851 wd:Q878 wd:Q796 wd:Q1028 wd:Q948 wd:Q262 wd:Q1016 wd:Q842 wd:Q846 wd:Q398 wd:Q817 wd:Q219060 wd:Q1049 wd:Q805 }
      ?f wdt:P31 wd:Q11424; wdt:P495 ?c; wikibase:sitelinks ?sl. ?a schema:about ?f; schema:isPartOf <https://ar.wikipedia.org/>. }`, 900],
  ];
  for (const [name, q, top] of lists) {
    try { let rows = await sparql(q); if (top) rows = rows.sort((a, b) => +b.sl - +a.sl).slice(0, top); rows.forEach(r => { add(qid(r.f), name); if (r.nd) nextDate.set(qid(r.f), r.nd.slice(0, 10)); }); log("list", name, rows.length); }
    catch (e) { console.warn("list failed", name, String(e).slice(0, 200)); }
  }
  const ids = [...pick.keys()];
  log("films to build:", ids.length);

  // ٢. المعلومات الأساسية
  const F = new Map();
  await pool(chunks(ids, 120), 3, async part => {
    const V = part.map(q => "wd:" + q).join(" ");
    const rows = await sparql(`SELECT ?f (MAX(?_imdb) AS ?imdb) (MAX(?_en) AS ?en) (MAX(?_mul) AS ?mul) (MAX(?_ar) AS ?ar) (MAX(?_ard) AS ?ard) (MIN(?_date) AS ?date) (MAX(?_dur) AS ?dur)
      (MAX(?_sl) AS ?sl) (MAX(?_yt) AS ?yt) (MAX(?_box) AS ?box) (MAX(?_bud) AS ?bud) (GROUP_CONCAT(DISTINCT ?_lang; separator=",") AS ?lang) (MAX(?_orig) AS ?orig) (MAX(?_enw) AS ?enw) (MAX(?_arw) AS ?arw)
      WHERE { VALUES ?f { ${V} }
        OPTIONAL { ?f wdt:P345 ?_imdb } OPTIONAL { ?f rdfs:label ?_en FILTER(LANG(?_en)="en") } OPTIONAL { ?f rdfs:label ?_mul FILTER(LANG(?_mul)="mul") } OPTIONAL { ?f rdfs:label ?_ar FILTER(LANG(?_ar)="ar") }
        OPTIONAL { ?f schema:description ?_ard FILTER(LANG(?_ard)="ar") }
        OPTIONAL { ?f wdt:P577 ?_date } OPTIONAL { ?f p:P2047/psv:P2047 [ wikibase:quantityAmount ?_dur ] }
        OPTIONAL { ?f wikibase:sitelinks ?_sl } OPTIONAL { ?f wdt:P1651 ?_yt } OPTIONAL { ?f wdt:P2142 ?_box } OPTIONAL { ?f wdt:P2130 ?_bud }
        OPTIONAL { ?f wdt:P364/wdt:P218 ?_lang } OPTIONAL { ?f wdt:P1476 ?_orig }
        OPTIONAL { ?_enw schema:about ?f; schema:isPartOf <https://en.wikipedia.org/> } OPTIONAL { ?_arw schema:about ?f; schema:isPartOf <https://ar.wikipedia.org/> }
      } GROUP BY ?f`);
    for (const r of rows) {
      const q = qid(r.f);
      F.set(q, {
        q, id: num(q), imdb: r.imdb || null, en: r.en || r.mul || r.orig || null, ar: r.ar ? r.ar.replace(/\s*\((?:فيلم|فلم)[^)]*\)\s*$/, "").trim() : null, ard: r.ard || null,
        rd: r.date ? r.date.slice(0, 10) : null, rt: r.dur ? Math.round(+r.dur) : null, sl: +(r.sl || 0), tr: r.yt || null,
        revenue: r.box ? Math.round(+r.box) : 0, budget: r.bud ? Math.round(+r.bud) : 0, lang: (r.lang || "").split(",").filter(Boolean).sort((a, b) => (b === "en") - (a === "en"))[0] || null, orig: r.orig || null,
        enw: r.enw ? decodeURIComponent(r.enw.replace("https://en.wikipedia.org/wiki/", "")).replace(/_/g, " ") : null,
        arw: r.arw ? decodeURIComponent(r.arw.replace("https://ar.wikipedia.org/wiki/", "")).replace(/_/g, " ") : null,
        g: new Set(), dir: [], prod: [], wri: [], mus: [], dop: [], cast: [], companies: [], countries: [], l: [...(pick.get(q) || [])],
      });
    }
  });
  log("basic info:", F.size);
  if (!F.size) throw new Error("no films built");

  // ٣. الأنواع والطاقم والممثلين والشركات والدول
  await pool(chunks([...F.keys()], 80), 3, async part => {
    const V = part.map(q => "wd:" + q).join(" ");
    const g = await sparql(`SELECT ?f ?g WHERE { VALUES ?f { ${V} } { ?f wdt:P136 ?g } UNION { ?f wdt:P31 ?g } }`);
    for (const r of g) { const id = GENRE[qid(r.g)]; if (id) F.get(qid(r.f))?.g.add(id); }
    const crew = await sparql(`SELECT ?f ?p ?n WHERE { VALUES ?f { ${V} } VALUES ?p { wdt:P57 wdt:P58 wdt:P86 wdt:P344 wdt:P162 } ?f ?p ?x. ?x rdfs:label ?n FILTER(LANG(?n) IN ("en","mul")) }`);
    const key = { P57: "dir", P58: "wri", P86: "mus", P344: "dop", P162: "prod" };
    for (const r of crew) { const f = F.get(qid(r.f)); const k = key[r.p.split("/").pop()]; if (f && k && !f[k].includes(r.n) && f[k].length < 6) f[k].push(r.n); }
    const cast = await sparql(`SELECT ?f ?n (SAMPLE(?chl) AS ?ch) (SAMPLE(?chs0) AS ?chs) WHERE { VALUES ?f { ${V} } ?f p:P161 ?st. ?st ps:P161 ?a. ?a rdfs:label ?n FILTER(LANG(?n) IN ("en","mul"))
      OPTIONAL { ?st pq:P453 ?c. ?c rdfs:label ?chl FILTER(LANG(?chl) IN ("en","mul")) } OPTIONAL { ?st pq:P4633 ?chs0 } } GROUP BY ?f ?n`);
    for (const r of cast) { const f = F.get(qid(r.f)); if (f && f.cast.length < 30) f.cast.push({ n: r.n, ch: r.ch || r.chs || "" }); }
    const misc = await sparql(`SELECT ?f ?k ?v WHERE { VALUES ?f { ${V} } { ?f wdt:P272 ?x. ?x rdfs:label ?v FILTER(LANG(?v) IN ("en","mul")) BIND("co" AS ?k) } UNION { ?f wdt:P495 ?x. ?x wdt:P297 ?v BIND("cn" AS ?k) } }`);
    for (const r of misc) { const f = F.get(qid(r.f)); if (!f) continue; if (r.k === "co" && f.companies.length < 6 && !f.companies.some(c => c.n === r.v)) f.companies.push({ n: r.v }); if (r.k === "cn" && !f.countries.includes(r.v)) f.countries.push(r.v); }
  });
  log("details from Wikidata done");

  // ٤. ويكيبيديا الإنجليزية: ترتيب الممثلين من صندوق المعلومات + القصة. والعربية: الملخص
  // أفلام الأنمي بتنلعب بلعبة خمّن الأنمي، فبنشيلها من الأفلام
  const films = [...F.values()].filter(f => f.en && !(f.g.has(16) && (f.lang === "ja" || f.countries.includes("JP"))));
  let infobox = 0, plots = 0, arOv = 0;
  const T0 = Date.now(), BUDGET = +process.env.WIKI_MINUTES || 22;
  let reused = 0, done = 0;
  await pool(films.filter(f => f.enw), 10, async f => {
    // من المرة الماضية: إذا قرينا صفحته قبل أقل من أسبوعين ما في داعي نقرأها كمان مرة
    try {
      const old = JSON.parse(await readFile(`${OUT_DIR}/d/${f.id}.json`, "utf8"));
      if (old.wk && Date.now() - old.wk < 14 * 864e5 && old.wiki?.en === f.enw) {
        const ord = (old.castOrder || []);
        if (ord.length) { const by = new Map(f.cast.map(c => [c.n.toLowerCase(), c])); const o = ord.map(n => by.get(n.toLowerCase()) || { n, ch: "" }); f.cast = [...o, ...f.cast.filter(c => !o.some(x => x.n.toLowerCase() === c.n.toLowerCase()))]; infobox++; }
        f.plotEn = old.plotEn || ""; f.castOrder = ord; f.wk = old.wk; if (!f.dir.length && old.dir?.length) f.dir = old.dir; reused++; return;
      }
    } catch {}
    if ((Date.now() - T0) / 60000 > BUDGET) return;
    if (++done % 250 === 0) log("wikipedia pages read:", done);
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
      f.castOrder = [...new Set(names)].slice(0, 16);
    }
    f.wk = Date.now();
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
  log(`wikipedia: reused ${reused}, read ${done}, infobox cast ${infobox}, plots ${plots}, arabic summaries ${arOv}`);

  // «بالسينما هلأ» و«قريباً»: نشيل الأفلام القديمة اللي إلها تاريخ إعادة عرض جديد
  const yearAgo = dayShift(-365);
  for (const f of F.values()) if (f.rd && f.rd < yearAgo) f.l = f.l.filter(l => l !== "now" && l !== "up");
  // الرائج: أشهر أفلام آخر سنتين
  const yNow = new Date().getFullYear();
  films.filter(f => f.rd && +f.rd.slice(0, 4) >= yNow - 1 && f.rd <= today).sort((a, b) => b.sl - a.sl).slice(0, 40).forEach(f => f.l.push("trend"));
  // ٥. الحفظ بنفس شكل الموقع
  await mkdir(OUT_DIR + "/d", { recursive: true });
  const cut = s => s && s.length > 230 ? s.slice(0, 228).replace(/\s\S*$/, "") + "…" : s || "";
  const list = films.map(f => ({
    id: f.id, q: f.q, imdb: f.imdb, en: f.en, ar: f.ar, y: f.rd ? +f.rd.slice(0, 4) : null, rd: f.rd, rt: f.rt, g: [...f.g], lang: f.lang,
    pop: f.sl, nd: nextDate.get(f.q) || undefined, p: f.imdb ? "imdb:" + f.imdb : null, ov: cut(f.ovAr || f.ard || ""), tr: f.tr, l: f.l,
  })).sort((a, b) => (b.l.length ? 1 : 0) - (a.l.length ? 1 : 0) || b.pop - a.pop).slice(0, MAX);
  const keep = new Set(list.map(f => f.id));
  let n = 0;
  for (const f of films) {
    if (!keep.has(f.id)) continue;
    const det = {
      id: f.id, q: f.q, imdb: f.imdb, en: f.en, orig: f.orig, ar: f.ar, tag: null, ov: f.ovAr || f.ard || "", plotEn: f.plotEn || f.introEn || "",
      rd: f.rd, rt: f.rt, g: [...f.g], lang: f.lang, budget: f.budget, revenue: f.revenue, companies: f.companies, countries: f.countries, langs: [], col: null, rel: [],
      dir: f.dir, prod: f.prod, wri: f.wri, mus: f.mus, dop: f.dop, cast: f.cast.slice(0, 16).map(c => ({ n: c.n, ch: c.ch, p: null })),
      wiki: { en: f.enw, ar: f.arw }, wk: f.wk || null, castOrder: f.castOrder || [],
    };
    await writeFile(`${OUT_DIR}/d/${f.id}.json`, JSON.stringify(det)); n++;
  }
  // نمسح ملفات الأفلام اللي طلعت من القائمة
  for (const name of await readdir(OUT_DIR + "/d")) if (!keep.has(+name.replace(".json", ""))) await unlink(`${OUT_DIR}/d/${name}`).catch(() => {});
  // تقرير التغطية
  const kept = films.filter(f => keep.has(f.id)); const P = fn => Math.round(100 * kept.filter(fn).length / kept.length) + "%";
  const report = { films: kept.length, arTitle: P(f => f.ar), date: P(f => f.rd), runtime: P(f => f.rt), genres: P(f => f.g.size), director: P(f => f.dir.length), cast5: P(f => f.cast.length >= 5), chars3: P(f => f.cast.filter(c => c.ch).length >= 3), ovAr: P(f => f.ovAr || f.ard), plotEn: P(f => f.plotEn), trailer: P(f => f.tr), boxOffice: P(f => f.revenue), imdb: P(f => f.imdb),
    lists: Object.fromEntries(["now", "up", "trend", "pop", "top", "ar"].map(l => [l, kept.filter(f => f.l.includes(l)).length])) };
  await writeFile(`${OUT_DIR}/films.json`, JSON.stringify({ updated: new Date().toISOString(), source: "Wikidata + Wikipedia", count: list.length, films: list }));
  await writeFile(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 1));
  log("written", list.length, "films,", n, "detail files");
  console.log(JSON.stringify(report, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
