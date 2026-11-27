// شباك التذاكر من ويكيبيديا (CC BY-SA 4.0):
//   - أعلى إيرادات السنة حول العالم ("<السنة> in film" → Highest-grossing films)
//   - الأول بكل ويكند بأمريكا ("List of <السنة> box office number-one films in the United States")
// بيكتب data/boxoffice.json ، وبيربط كل فيلم برقمه بـ Wikidata عشان البوستر (IMDb → TheTVDB)
import { writeFile, readFile } from "node:fs/promises";

const OUT = (process.env.OUT_DIR || "data") + "/boxoffice.json";
const UA = { "user-agent": "SahraFilm/2.0 (https://sahrafilm.com; saiflex.u@gmail.com)", accept: "application/json" };
const year = new Date().getUTCFullYear();

async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error("failed " + url);
}

const decode = s => s.replace(/&amp;/g, "&").replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;|&#160;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = h => decode(h.replace(/<sup[\s\S]*?<\/sup>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").replace(/†|‡|\*/g, "").trim();
const link = h => { const m = h.match(/<a [^>]*href="\/wiki\/([^"#]+)"/); return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null; };

// جداول HTML مع rowspan
function tables(html) {
  return [...html.matchAll(/<table[^>]*wikitable[\s\S]*?<\/table>/g)].map(t => {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map(r => r[0]);
    const grid = [], carry = [];
    for (const r of rows) {
      const cells = [...r.matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/t[hd]>/g)];
      const out = []; let c = 0;
      const fill = () => { while (carry[c] && carry[c].n > 0) { out[c] = carry[c].cell; carry[c].n--; c++; } };
      fill();
      for (const [, tag, attrs, body] of cells) {
        fill();
        const cell = { th: tag === "th", text: text(body), link: link(body) };
        const rs = +((attrs.match(/rowspan="?(\d+)/) || [])[1] || 1);
        const cs = +((attrs.match(/colspan="?(\d+)/) || [])[1] || 1);
        for (let k = 0; k < cs; k++) { out[c] = cell; if (rs > 1) carry[c] = { n: rs - 1, cell }; c++; }
      }
      fill();
      grid.push(out);
    }
    return grid;
  });
}
const page = async title => {
  const j = await getJSON("https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=parse&prop=text&redirects=1&page=" + encodeURIComponent(title));
  return j?.parse?.text || "";
};
const money = s => { const m = (s || "").replace(/,/g, "").match(/\$?\s*([\d.]+)\s*(billion|million)?/i); if (!m) return 0; const n = +m[1]; return Math.round(n * (/billion/i.test(m[2] || "") ? 1e9 : /million/i.test(m[2] || "") ? 1e6 : 1)); };

async function topGrossing() {
  const html = await page(`${year} in film`);
  for (const g of tables(html)) {
    const head = (g[0] || []).map(c => c?.text.toLowerCase() || "");
    const gi = head.findIndex(h => h.includes("gross")), ti = head.findIndex(h => h.includes("title") || h.includes("film"));
    if (gi < 0 || ti < 0) continue;
    return g.slice(1).filter(r => r[ti] && r[gi]).map((r, i) => ({ rank: i + 1, en: r[ti].text, wiki: r[ti].link, gross: money(r[gi].text) })).filter(x => x.gross).slice(0, 10);
  }
  return [];
}

async function weekendNumberOne() {
  const html = await page(`List of ${year} box office number-one films in the United States`);
  for (const g of tables(html)) {
    const head = (g[0] || []).map(c => c?.text.toLowerCase() || "");
    const di = head.findIndex(h => h.includes("date") || h.includes("weekend")), fi = head.findIndex(h => h.includes("film")), gi = head.findIndex(h => h.includes("gross"));
    if (di < 0 || fi < 0) continue;
    const rows = g.slice(1).filter(r => r[fi] && r[di] && r[fi].text && !/^\s*$/.test(r[fi].text))
      .map(r => ({ date: r[di].text, en: r[fi].text, wiki: r[fi].link, gross: gi >= 0 ? money(r[gi]?.text) : 0 }));
    return rows.filter(r => r.gross).slice(-8).reverse(); // آخر 8 ويكندات
  }
  return [];
}

// ربط بـ Wikidata عن طريق مقالة ويكيبيديا الإنجليزية
async function linkWikidata(list) {
  const titles = [...new Set(list.map(x => x.wiki).filter(Boolean))];
  if (!titles.length) return;
  const j = await getJSON("https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=" + encodeURIComponent(titles.join("|")));
  const norm = new Map([...(j.query?.normalized || []), ...(j.query?.redirects || [])].map(x => [x.from, x.to]));
  const q = new Map((j.query?.pages || []).map(p => [p.title, p.pageprops?.wikibase_item]));
  const qids = [...new Set([...q.values()].filter(Boolean))];
  const meta = new Map();
  if (qids.length) {
    const sq = `SELECT ?f (MAX(?_imdb) AS ?imdb) (MAX(?_ar) AS ?ar) WHERE { VALUES ?f { ${qids.map(x => "wd:" + x).join(" ")} } OPTIONAL { ?f wdt:P345 ?_imdb } OPTIONAL { ?f rdfs:label ?_ar FILTER(LANG(?_ar)="ar") } } GROUP BY ?f`;
    const r = await getJSON("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sq));
    for (const b of r?.results?.bindings || []) meta.set(b.f.value.split("/").pop(), { imdb: b.imdb?.value || null, ar: b.ar?.value?.replace(/\s*\((?:فيلم|فلم)[^)]*\)\s*$/, "") || null });
  }
  for (const x of list) {
    const t = x.wiki && (norm.get(norm.get(x.wiki) || x.wiki) || norm.get(x.wiki) || x.wiki);
    const id = q.get(t) || q.get(x.wiki);
    const m = meta.get(id) || {};
    Object.assign(x, { q: id || null, id: id ? +id.slice(1) : null, imdb: m.imdb || null, ar: m.ar || null });
    delete x.wiki;
  }
}

const top = await topGrossing().catch(e => (console.warn("top", e.message), []));
const weekend = await weekendNumberOne().catch(e => (console.warn("weekend", e.message), []));
await linkWikidata([...top, ...weekend]).catch(e => console.warn("link", e.message));
console.log(`top ${top.length}, weekend ${weekend.length}`);
if (!top.length && !weekend.length) { console.log("nothing new, keeping old file"); process.exit(0); }
let old = {}; try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), year, source: "Wikipedia (CC BY-SA 4.0)", top: top.length ? top : old.top || [], weekend: weekend.length ? weekend : old.weekend || [] }, null, 1));
console.log(JSON.stringify({ top: top.slice(0, 3), weekend: weekend.slice(0, 3) }, null, 1));
