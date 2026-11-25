// الأفلام من Wikidata (CC0) + ويكيبيديا (CC BY-SA) مباشرة، لأي فيلم مش موجود بقائمة الموقع
// نفس شكل ملفات data/d عشان الصفحات والغرف ما تفرق
const UA = { "user-agent": "SahraFilm/2.0 (https://sahrafilm.com; saiflex.u@gmail.com)", accept: "application/json" };
const cache = new Map();
async function getJSON(url, opt = {}, ttl = 86400) {
  const hit = cache.get(url + (opt.body || ""));
  if (hit && Date.now() - hit.t < 3600000) return hit.v;
  const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(15000), cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) throw new Error("wikidata " + r.status);
  const v = await r.json();
  if (cache.size > 1000) cache.clear();
  cache.set(url + (opt.body || ""), { t: Date.now(), v });
  return v;
}
const sparql = q => getJSON("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { accept: "application/sparql-results+json" } })
  .then(j => j.results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value]))));
const qid = u => u.replace(/^.*\/entity\//, "");
const GENRE = {
  Q188473: 28, Q319221: 12, Q202866: 16, Q20650540: 16, Q157443: 35, Q859369: 35, Q959790: 80, Q93204: 99, Q130232: 18, Q1361932: 10751, Q157394: 14,
  Q17013749: 36, Q645928: 36, Q200092: 27, Q1342372: 27, Q842256: 10402, Q2421031: 10402, Q1200678: 9648, Q1054574: 10749, Q248583: 10749, Q471839: 878,
  Q2484376: 53, Q2973181: 53, Q369747: 10752, Q172980: 37, Q20442589: 80, Q1535153: 18, Q52162262: 28, Q3072049: 53, Q24925: 878, Q663106: 35, Q860626: 35,
  Q1146335: 10751, Q622548: 18, Q226540: 28, Q853630: 10749, Q2143665: 10749,
};
const FILM_TYPES = "wd:Q11424 wd:Q29168811 wd:Q20650540 wd:Q24862 wd:Q506240 wd:Q202866";

// بحث بالاسم (إنجليزي أو عربي): أفلام بس
export async function wdSearch(q) {
  const ar = /[؀-ۿ]/.test(q);
  const s = await getJSON(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=20&uselang=${ar ? "ar" : "en"}&language=${ar ? "ar" : "en"}&search=` + encodeURIComponent(q), {}, 3600);
  const ids = (s.search || []).map(x => x.id);
  if (!ids.length) return [];
  const rows = await sparql(`SELECT ?f (MAX(?_en) AS ?en) (MAX(?_ar) AS ?ar) (MIN(?_d) AS ?d) (MAX(?_imdb) AS ?imdb) (MAX(?_sl) AS ?sl) WHERE {
    VALUES ?f { ${ids.map(i => "wd:" + i).join(" ")} } VALUES ?c { ${FILM_TYPES} } ?f wdt:P31 ?c.
    OPTIONAL { ?f rdfs:label ?_en FILTER(LANG(?_en)="en") } OPTIONAL { ?f rdfs:label ?_ar FILTER(LANG(?_ar)="ar") }
    OPTIONAL { ?f wdt:P577 ?_d } OPTIONAL { ?f wdt:P345 ?_imdb } OPTIONAL { ?f wikibase:sitelinks ?_sl } } GROUP BY ?f`);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.map(r => {
    const q = qid(r.f);
    return { id: +q.slice(1), q, imdb: r.imdb || null, en: r.en || r.ar, ar: r.ar || null, y: r.d ? +r.d.slice(0, 4) : null, rd: r.d ? r.d.slice(0, 10) : null, p: r.imdb ? "imdb:" + r.imdb : null, pop: +(r.sl || 0), g: [], l: [], ext: true };
  }).sort((a, b) => order.get(a.q) - order.get(b.q)).slice(0, 10);
}

// رقم IMDb أو اسم وسنة → فيلم (للذكاء الاصطناعي لما يخمّن من القصة)
export async function wdFind(title, year) {
  const list = await wdSearch(title).catch(() => []);
  return list.find(x => year && x.y && Math.abs(x.y - year) <= 1) || list[0] || null;
}

// كل تفاصيل الفيلم: نفس شكل data/d
export async function wdDetail(id) {
  const Q = "wd:Q" + (+String(id).replace(/^Q/, ""));
  const [base, gen, crew, cast, misc] = await Promise.all([
    sparql(`SELECT (MAX(?_imdb) AS ?imdb) (MAX(?_en) AS ?en) (MAX(?_ar) AS ?ar) (MAX(?_ard) AS ?ard) (MIN(?_d) AS ?date) (MAX(?_dur) AS ?dur) (MAX(?_yt) AS ?yt) (MAX(?_box) AS ?box) (MAX(?_bud) AS ?bud)
      (GROUP_CONCAT(DISTINCT ?_lang; separator=",") AS ?lang) (MAX(?_orig) AS ?orig) (MAX(?_enw) AS ?enw) (MAX(?_arw) AS ?arw) (MAX(?_sl) AS ?sl) (MAX(?_col) AS ?col) WHERE {
      OPTIONAL { ${Q} wdt:P345 ?_imdb } OPTIONAL { ${Q} rdfs:label ?_en FILTER(LANG(?_en)="en") } OPTIONAL { ${Q} rdfs:label ?_ar FILTER(LANG(?_ar)="ar") }
      OPTIONAL { ${Q} schema:description ?_ard FILTER(LANG(?_ard)="ar") } OPTIONAL { ${Q} wdt:P577 ?_d } OPTIONAL { ${Q} p:P2047/psv:P2047 [ wikibase:quantityAmount ?_dur ] }
      OPTIONAL { ${Q} wdt:P1651 ?_yt } OPTIONAL { ${Q} wdt:P2142 ?_box } OPTIONAL { ${Q} wdt:P2130 ?_bud } OPTIONAL { ${Q} wdt:P364/wdt:P218 ?_lang } OPTIONAL { ${Q} wdt:P1476 ?_orig }
      OPTIONAL { ${Q} wikibase:sitelinks ?_sl } OPTIONAL { ${Q} wdt:P179 ?c. ?c rdfs:label ?_col FILTER(LANG(?_col)="en") }
      OPTIONAL { ?_enw schema:about ${Q}; schema:isPartOf <https://en.wikipedia.org/> } OPTIONAL { ?_arw schema:about ${Q}; schema:isPartOf <https://ar.wikipedia.org/> } }`),
    sparql(`SELECT ?g WHERE { { ${Q} wdt:P136 ?g } UNION { ${Q} wdt:P31 ?g } }`),
    sparql(`SELECT ?p ?n WHERE { VALUES ?p { wdt:P57 wdt:P58 wdt:P86 wdt:P344 wdt:P162 } ${Q} ?p ?x. ?x rdfs:label ?n FILTER(LANG(?n)="en") }`),
    sparql(`SELECT ?n (MAX(?chl) AS ?ch) (MAX(?chs0) AS ?chs) (MIN(?o) AS ?ord) WHERE { ${Q} p:P161 ?st. ?st ps:P161 ?a. ?a rdfs:label ?n FILTER(LANG(?n)="en")
      OPTIONAL { ?st pq:P453 ?c. ?c rdfs:label ?chl FILTER(LANG(?chl)="en") } OPTIONAL { ?st pq:P4633 ?chs0 } OPTIONAL { ?st pq:P1545 ?o } } GROUP BY ?n`),
    sparql(`SELECT ?k ?v WHERE { { ${Q} wdt:P272 ?x. ?x rdfs:label ?v FILTER(LANG(?v)="en") BIND("co" AS ?k) } UNION { ${Q} wdt:P495 ?x. ?x wdt:P297 ?v BIND("cn" AS ?k) } }`),
  ]);
  const b = base[0] || {};
  if (!b.en && !b.ar) return null;
  const key = { P57: "dir", P58: "wri", P86: "mus", P344: "dop", P162: "prod" };
  const c = { dir: [], wri: [], mus: [], dop: [], prod: [] };
  for (const r of crew) { const k = key[r.p.split("/").pop()]; if (k && !c[k].includes(r.n) && c[k].length < 6) c[k].push(r.n); }
  let actors = cast.map(r => ({ n: r.n, ch: r.ch || r.chs || "", o: r.ord ? +r.ord : 999 })).sort((x, y) => x.o - y.o);
  const enw = b.enw ? decodeURIComponent(b.enw.split("/wiki/")[1]).replace(/_/g, " ") : null;
  const arw = b.arw ? decodeURIComponent(b.arw.split("/wiki/")[1]).replace(/_/g, " ") : null;
  // ويكيبيديا: ترتيب الممثلين من صندوق المعلومات، والقصة، والملخص العربي
  let plotEn = "", ovAr = "";
  await Promise.all([
    enw && getJSON("https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions|extracts&rvprop=content&rvslots=main&rvsection=0&explaintext=1&redirects=1&titles=" + encodeURIComponent(enw)).then(j => {
      const pg = j.query?.pages?.[0] || {};
      const wt = pg.revisions?.[0]?.slots?.main?.content || "";
      const starring = (wt.match(/\|\s*starring\s*=([\s\S]*?)\n\s*\|\s*[a-z_ ]+=/i) || [])[1] || "";
      const names = [...starring.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]|\*\s*([^\n\[{}|]+)/g)].map(m => (m[2] || m[1] || m[3] || "").replace(/\s*\(.*?\)\s*/g, "").trim()).filter(n => n && n.length < 40 && !/plainlist|ubl/i.test(n));
      if (names.length) {
        const by = new Map(actors.map(a => [a.n.toLowerCase(), a]));
        const ord = [...new Set(names)].map(n => by.get(n.toLowerCase()) || { n, ch: "" });
        actors = [...ord, ...actors.filter(a => !ord.some(o => o.n.toLowerCase() === a.n.toLowerCase()))];
      }
      if (!c.dir.length) { const d = (wt.match(/\|\s*director\s*=\s*\[\[([^\]|]+)/i) || [])[1]; if (d) c.dir.push(d); }
      const txt = pg.extract || "";
      const sec = txt.split(/\n(?===+ )/).find(s => /^==+ (Plot|Synopsis|Premise|Story)/i.test(s)) || "";
      plotEn = (sec.replace(/^==+[^\n]*\n/, "").trim() || txt.split(/\n==/)[0]).slice(0, 1500);
    }).catch(() => {}),
    arw && getJSON("https://ar.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=" + encodeURIComponent(arw)).then(j => { ovAr = (j.query?.pages?.[0]?.extract || "").replace(/\s+/g, " ").trim(); }).catch(() => {}),
  ]);
  const langs = (b.lang || "").split(",").filter(Boolean);
  const num = String(id).replace(/^Q/, "");
  return {
    id: +num, q: "Q" + num, imdb: b.imdb || null, en: b.en || b.orig || b.ar, orig: b.orig || null, ar: b.ar || null, tag: null,
    ov: ovAr || b.ard || "", plotEn, rd: b.date ? b.date.slice(0, 10) : null, y: b.date ? +b.date.slice(0, 4) : null, rt: b.dur ? Math.round(+b.dur) : null,
    g: [...new Set(gen.map(r => GENRE[qid(r.g)]).filter(Boolean))], lang: langs.sort((x, y) => (y === "en") - (x === "en"))[0] || null,
    budget: b.bud ? Math.round(+b.bud) : 0, revenue: b.box ? Math.round(+b.box) : 0,
    companies: misc.filter(r => r.k === "co").slice(0, 6).map(r => ({ n: r.v })), countries: [...new Set(misc.filter(r => r.k === "cn").map(r => r.v))],
    langs: [], col: b.col || null, rel: [], ...c,
    cast: actors.slice(0, 16).map(a => ({ n: a.n, ch: a.ch, p: null })),
    p: b.imdb ? "imdb:" + b.imdb : null, tr: b.yt || null, pop: +(b.sl || 0), wiki: { en: enw, ar: arw },
  };
}
