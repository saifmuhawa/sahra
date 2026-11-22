/* أدوات مشتركة بين كل الصفحات */
const REPO_RAW = "https://raw.githubusercontent.com/saifmuhawa/sahra/main/data/films.json";
const IMG = "https://image.tmdb.org/t/p/";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function el(tag, attrs = {}, html = "") { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); e.innerHTML = html; return e; }
function norm(s) {
  return (s || "").toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "")
    .replace(/^the/, "");
}
const keyOf = f => (f.en || "").toLowerCase() + "|" + f.y;
const GENRE_AR = {28:"أكشن",12:"مغامرة",16:"رسوم",35:"كوميدي",80:"جريمة",99:"وثائقي",18:"دراما",10751:"عائلي",14:"فانتازيا",36:"تاريخي",27:"رعب",10402:"موسيقي",9648:"غموض",10749:"رومانسي",878:"خيال علمي",53:"إثارة",10752:"حرب",37:"ويسترن",10770:"تلفزيوني"};
const TYPE_AR = {foreign:"أجنبي",arab:"عربي",anime:"أنمي"};
const typeOf = f => f.lang === "ar" ? "arab" : (f.lang === "ja" && (f.g || []).includes(16)) ? "anime" : "foreign";
const note = f => NOTES[keyOf(f)] || null;
const titleAr = f => note(f)?.ar || f.ar || f.en;
const posterUrl = (f, size = "w342") => f.p ? IMG + size + f.p : null;
const imdbUrl = f => f.imdb ? "https://www.imdb.com/title/" + f.imdb + "/" : "https://www.imdb.com/find/?q=" + encodeURIComponent(f.en);
const watchUrl = f => f.id ? "https://www.themoviedb.org/movie/" + f.id + "/watch?locale=AE" : "https://www.justwatch.com/ae/search?q=" + encodeURIComponent(f.en);
const ytWatch = id => "https://www.youtube.com/watch?v=" + id;
const ytSearch = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
function timeLabel(m) { if (!m) return "المدة غير معروفة"; const h = Math.floor(m / 60), r = m % 60; return (h ? h + " س " : "") + (r ? r + " د" : ""); }
function ago(iso) {
  const d = (Date.now() - new Date(iso)) / 60000;
  if (d < 2) return "هلأ"; if (d < 60) return "قبل " + Math.round(d) + " دقيقة";
  if (d < 1440) return "قبل " + Math.round(d / 60) + " ساعة"; return "قبل " + Math.round(d / 1440) + " يوم";
}
function posterBox(f, size) {
  const u = posterUrl(f, size);
  return u ? `<img src="${u}" alt="بوستر ${esc(titleAr(f))}" loading="lazy">` : `<div class="noposter">${esc(titleAr(f))}</div>`;
}
function badges(f) {
  const out = [];
  if (f.ir) out.push(`<a class="imdb" href="${imdbUrl(f)}" target="_blank" rel="noopener" title="${(f.iv || 0).toLocaleString("en")} تقييم">IMDb ${f.ir.toFixed(1)}</a>`);
  else if (f.imdb) out.push(`<a class="imdb" href="${imdbUrl(f)}" target="_blank" rel="noopener">IMDb</a>`);
  return out.join("");
}

// تحميل الأفلام: النسخة الأحدث من GitHub (بتتحدّث كل ساعة)، وإذا ما زبط النسخة اللي مع الموقع
let FILMS = [], UPDATED = null;
async function loadFilms() {
  const hour = Math.floor(Date.now() / 3600000);
  for (const url of [REPO_RAW + "?h=" + hour, "data/films.json"]) {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) continue;
      const j = await r.json();
      if (!j.films?.length) continue;
      FILMS = j.films; UPDATED = j.updated;
      break;
    } catch (e) {}
  }
  const u = document.getElementById("updated");
  if (u && UPDATED) u.textContent = `آخر تحديث ${ago(UPDATED)}`;
  return FILMS;
}
// إيجاد فيلم من مفتاحنا (اسم إنجليزي|سنة)، مع احتياط بالاسم العربي
function findByKey(key) {
  const [en, y] = key.split("|");
  let f = FILMS.find(x => keyOf(x) === key);
  if (f) return f;
  const n = NOTES[key];
  const cands = [norm(en), n && norm(n.ar), ...((n?.alias) || []).map(norm)].filter(Boolean);
  return FILMS.find(x => Math.abs((x.y || 0) - +y) <= 1 && cands.some(c => c === norm(x.en) || c === norm(x.ar))) || null;
}
// بحث عام بالاسم (عربي أو إنجليزي)
function searchFilms(q, limit = 8) {
  const n = norm(q); if (!n) return [];
  const scored = [];
  for (const f of FILMS) {
    const names = [f.en, f.ar, note(f)?.ar, ...((note(f)?.alias) || [])].filter(Boolean).map(norm);
    let s = 0;
    for (const x of names) { if (x === n) s = Math.max(s, 100); else if (x.startsWith(n)) s = Math.max(s, 60); else if (x.includes(n)) s = Math.max(s, 40); }
    if (s) scored.push([s + Math.log10(1 + (f.pop || 0)) * 5, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]);
}

// شريط التنقّل
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  document.querySelectorAll(".nav-links a").forEach(a => { if (a.dataset.page === page) a.setAttribute("aria-current", "page"); });
});

// عدّاد الزيارات (GoatCounter): الإحصائيات على https://sahrafilm.goatcounter.com
(() => { const s = document.createElement("script"); s.async = true; s.src = "https://gc.zgo.at/count.js"; s.dataset.goatcounter = "https://sahrafilm.goatcounter.com/count"; document.head.appendChild(s); })();
