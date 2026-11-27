// بيكمّل data/cinema.json: لكل فيلم ناقصه رقم IMDb بندوّر عليه بـ Wikidata (CC0)،
// وبنحط رقم IMDb (للبوستر من TheTVDB) والاسم العربي. هيك صفحة السينما ما بتحتاج تبحث وقت الزيارة.
// الأفلام اللي لسا ما نزلت Wikidata بيصنّفها "مشروع فيلم" (Q18011172)، فبندوّر عليها كمان.
import { readFile, writeFile } from "node:fs/promises";

const FILE = (process.env.OUT_DIR || "data") + "/cinema.json";
const UA = { "user-agent": "SahraFilm/2.0 (https://sahrafilm.com; saiflex.u@gmail.com)", accept: "application/json" };
const FILM_TYPES = "wd:Q11424 wd:Q29168811 wd:Q20650540 wd:Q24862 wd:Q506240 wd:Q202866 wd:Q18011172";

async function getJSON(url, headers = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(45000) });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error("failed " + url.slice(0, 120));
}
const sparql = q => getJSON("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { accept: "application/sparql-results+json" })
  .then(j => j.results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value]))));
const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "");

async function find(x) {
  const ar = /[؀-ۿ]/;
  const names = [x.en, x.ar].filter(Boolean);
  for (const name of names) {
    const lang = ar.test(name) ? "ar" : "en";
    const s = await getJSON(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=20&language=${lang}&uselang=${lang}&search=` + encodeURIComponent(name));
    const ids = (s.search || []).map(r => r.id);
    if (!ids.length) continue;
    // "hint" اسم ممثل أو مخرج بيفرّق بين أفلام بنفس الاسم (مثلاً King لشاه روخ خان)
    const hint = x.hint ? `?f (wdt:P161|wdt:P57) ?_p. ?_p rdfs:label ${JSON.stringify(x.hint)}@en.` : "";
    const rows = await sparql(`SELECT ?f (MAX(?_en) AS ?en) (MAX(?_mul) AS ?mul) (MAX(?_ar) AS ?ar) (MIN(?_d) AS ?d) (MAX(?_imdb) AS ?imdb) (MAX(?_sl) AS ?sl) WHERE {
      VALUES ?f { ${ids.map(i => "wd:" + i).join(" ")} } VALUES ?c { ${FILM_TYPES} } ?f wdt:P31 ?c. ${hint}
      OPTIONAL { ?f rdfs:label ?_en FILTER(LANG(?_en)="en") } OPTIONAL { ?f rdfs:label ?_mul FILTER(LANG(?_mul)="mul") } OPTIONAL { ?f rdfs:label ?_ar FILTER(LANG(?_ar)="ar") }
      OPTIONAL { ?f wdt:P577 ?_d } OPTIONAL { ?f wdt:P345 ?_imdb } OPTIONAL { ?f wikibase:sitelinks ?_sl } } GROUP BY ?f`);
    const films = rows.filter(r => r.imdb).map(r => ({ q: r.f.split("/").pop(), en: r.en || r.mul, ar: r.ar, y: r.d ? +r.d.slice(0, 4) : null, imdb: r.imdb, sl: +(r.sl || 0) }));
    const same = films.filter(f => norm(f.en) === norm(x.en) || (x.ar && norm(f.ar) === norm(x.ar)));
    const y = x.rd ? +x.rd.slice(0, 4) : null;
    // إعادة العرض تاريخها جديد بس الفيلم قديم، فما منقارن السنة
    const pick = (x.tag || !y ? same : same.filter(f => f.y && Math.abs(f.y - y) <= 1)).sort((a, b) => b.sl - a.sl)[0];
    if (pick) return pick;
    // الاسم بـ Wikidata أحياناً غير (Ebenezer بدل Ebenezer: A Christmas Carol): بناخذ أول نتيجة بحث
    // بشرط تكون فيلم بنفس السنة، وما بنعمل هيك لإعادة العرض
    const rank = new Map(ids.map((id, i) => [id, i]));
    const near = !x.tag && y && films.filter(f => f.y && Math.abs(f.y - y) <= 1).sort((a, b) => rank.get(a.q) - rank.get(b.q))[0];
    if (near) return near;
  }
  return null;
}

const data = JSON.parse(await readFile(FILE, "utf8"));
let added = 0, missing = [];
for (const x of [...(data.now || []), ...(data.up || [])]) {
  if (x.imdb) continue;
  try {
    const f = await find(x);
    if (!f) { missing.push(x.en); continue; }
    x.imdb = f.imdb; x.q = f.q;
    if (!x.ar && f.ar) x.ar = f.ar.replace(/\s*\((?:فيلم|فلم)[^)]*\)\s*$/, "");
    added++;
  } catch (e) { missing.push(x.en + " (" + e.message + ")"); }
}
// نفس شكل الملف: كل فيلم بسطر واحد
const list = a => "[\n" + a.map(x => "  " + JSON.stringify(x).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, "{ ").replace(/\}$/, " }")).join(",\n") + "\n ]";
const out = "{\n" + Object.entries(data).map(([k, v]) => ` ${JSON.stringify(k)}: ` + ((k === "now" || k === "up") && Array.isArray(v) ? list(v) : JSON.stringify(v).replace(/","/g, '", "'))).join(",\n") + "\n}\n";
if (added) await writeFile(FILE, out);
console.log(`cinema ids: added ${added}` + (missing.length ? `, not found: ${missing.join(", ")}` : ""));
