// قسم السينما: شو موجود بسينمات الإمارات، جاي قريباً، وشباك التذاكر
// المعلومات: data/cinema.json (بيتحدّث يومياً) و data/boxoffice.json (ويكيبيديا)
// البوسترات من TheTVDB عن طريق رقم IMDb (بنجيبه من بحث Wikidata بالموقع)
const DATA_RAW = "https://raw.githubusercontent.com/saifmuhawa/sahra/main/data/";
const VOX = "https://uae.voxcinemas.com/";

async function getData(name) {
  const h = Math.floor(Date.now() / 3600000);
  for (const u of [DATA_RAW + name + "?h=" + h, "data/" + name]) {
    try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) return await r.json(); } catch {}
  }
  return null;
}

// نلاقي الفيلم بـ Wikidata عشان الاسم العربي والبوستر
const found = new Map();
async function resolve(x) {
  if (x.imdb) return x;
  const key = x.en + "|" + (x.rd || "");
  if (found.has(key)) return found.get(key);
  const p = (async () => {
    try {
      const r = await fetch("/api/search?q=" + encodeURIComponent(x.en));
      const list = (await r.json()).results || [];
      const y = x.rd ? +x.rd.slice(0, 4) : new Date().getFullYear();
      const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const f = list.find(f => norm(f.en) === norm(x.en) && f.y && Math.abs(f.y - y) <= 1)
        || list.find(f => f.y && Math.abs(f.y - y) <= 1 && norm(f.en).includes(norm(x.en)));
      return f ? { ...x, ar: x.ar || f.ar, imdb: f.imdb, id: f.id } : x;
    } catch { return x; }
  })();
  found.set(key, p);
  return p;
}

const fmtDate = d => {
  if (!d) return "";
  const t = new Date(d + "T12:00:00");
  return isNaN(t) ? d : t.toLocaleDateString("ar-AE-u-nu-latn", { day: "numeric", month: "long" });
};
const money = n => n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + " مليار" : n >= 1e6 ? "$" + Math.round(n / 1e6) + " مليون" : n ? "$" + n.toLocaleString("en") : "";

function card(x, sub, href) {
  const f = { en: x.en, ar: x.ar, p: x.imdb ? "imdb:" + x.imdb : null };
  return `<a class="pcard" href="${esc(href)}" target="_blank" rel="noopener">${posterBox(f, "w185")}<span>${esc(x.ar || x.en)}</span>${x.ar ? `<small dir="ltr">${esc(x.en)}</small>` : ""}<small>${esc(sub)}</small></a>`;
}
const imdbHref = x => x.imdb ? "https://www.imdb.com/title/" + x.imdb + "/" : "https://www.imdb.com/find/?q=" + encodeURIComponent(x.en);

async function fill(id, items, sub, href, limit = 20) {
  const box = document.getElementById(id);
  if (!box) return;
  if (!items?.length) { box.closest("section").hidden = true; return; }
  items = items.slice(0, limit);
  box.innerHTML = items.map(x => card(x, sub(x), href(x))).join("");
  const done = await Promise.all(items.map(resolve));
  box.innerHTML = done.map(x => card(x, sub(x), href(x))).join("");
}

async function loadCinema(limit) {
  const [c, b] = await Promise.all([getData("cinema.json"), getData("boxoffice.json")]);
  const today = new Date().toISOString().slice(0, 10);
  // اللي تاريخه إجا بينتقل لحاله من "جاي قريباً" لـ "موجود بالسينما"
  const now = [...(c?.now || []), ...(c?.up || []).filter(x => x.rd && x.rd <= today)];
  const up = (c?.up || []).filter(x => !x.rd || x.rd > today).sort((a, b) => (a.rd || "9").localeCompare(b.rd || "9"));
  await Promise.all([
    fill("strip-now", now, x => x.tag || (x.rd ? "من " + fmtDate(x.rd) : "بالسينما هلأ"), () => VOX, limit),
    fill("strip-up", up, x => x.rd ? fmtDate(x.rd) : "قريباً", () => VOX, limit),
    fill("strip-top", b?.top, x => "#" + x.rank + " · " + money(x.gross), imdbHref, limit),
    fill("strip-weekend", b?.weekend, x => x.date + (x.gross ? " · " + money(x.gross) : ""), imdbHref, limit),
  ]);
  const u = document.getElementById("cinema-updated");
  if (u && c?.updated) u.textContent = "آخر تحديث لقائمة السينما: " + fmtDate(c.updated);
  const y = document.getElementById("top-year");
  if (y && b?.year) y.textContent = b.year;
}
