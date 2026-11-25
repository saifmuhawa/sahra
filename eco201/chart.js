// رسم بياني صغير بالـSVG (بدون مكتبات): خطوط، نقاط، خطوط أفقية/عمودية، ومساحات مظللة
export function plot(svg, o) {
  const W = Math.max(320, svg.clientWidth || 800), H = Math.max(240, svg.clientHeight || 500);
  const fs = o.font || Math.round(Math.min(W, H) / 32 + 4);
  const m = { l: fs * 4.2, r: fs * 1.6, t: fs * 1.2, b: fs * 3.4 };
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const out = [];
  const grid = "rgba(244,234,217,.10)", axis = "rgba(244,234,217,.45)", txt = "#b9a79a";
  const ticks = (a, b, step) => { const t = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) t.push(+v.toFixed(6)); return t; };
  for (const v of ticks(y0, y1, o.ystep)) {
    out.push(`<line x1="${X(x0)}" x2="${X(x1)}" y1="${Y(v)}" y2="${Y(v)}" stroke="${grid}"/>`);
    out.push(`<text x="${X(x0) - fs * 0.5}" y="${Y(v) + fs * 0.35}" fill="${txt}" font-size="${fs}" text-anchor="end">${v}</text>`);
  }
  for (const v of ticks(x0, x1, o.xstep)) {
    out.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${Y(y0)}" y2="${Y(y1)}" stroke="${grid}"/>`);
    out.push(`<text x="${X(v)}" y="${Y(y0) + fs * 1.35}" fill="${txt}" font-size="${fs}" text-anchor="middle">${v}</text>`);
  }
  out.push(`<line x1="${X(x0)}" x2="${X(x1)}" y1="${Y(y0)}" y2="${Y(y0)}" stroke="${axis}" stroke-width="1.5"/>`);
  out.push(`<line x1="${X(x0)}" x2="${X(x0)}" y1="${Y(y0)}" y2="${Y(y1)}" stroke="${axis}" stroke-width="1.5"/>`);
  if (o.xlabel) out.push(`<text x="${(X(x0) + X(x1)) / 2}" y="${H - fs * 0.5}" fill="${txt}" font-size="${fs}" text-anchor="middle">${esc(o.xlabel)}</text>`);
  if (o.ylabel) out.push(`<text transform="translate(${fs * 1.1},${(Y(y0) + Y(y1)) / 2}) rotate(-90)" fill="${txt}" font-size="${fs}" text-anchor="middle">${esc(o.ylabel)}</text>`);

  for (const a of o.areas || []) {
    out.push(`<polygon points="${a.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}" fill="${a.color}"/>`);
  }
  for (const s of o.series || []) {
    let pts = s.pts;
    if (s.step) { // منحنى درج: السعر ثابت لحد ما يزيد العدد
      const st = [];
      pts.forEach(([x, y], i) => { if (i) st.push([pts[i - 1][0], y]); st.push([x, y]); });
      pts = st;
    }
    if (!pts.length) continue;
    const sw = s.width ?? 3;
    if (sw > 0) {
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
    out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}${s.cls ? ` class="${s.cls}"` : ""}/>`);
    }
    if (s.dots) for (const [x, y] of s.pts) out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="${s.r || 5}" fill="${s.color}"/>`);
  }
  for (const h of o.hlines || []) {
    out.push(`<line x1="${X(x0)}" x2="${X(x1)}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-width="2" stroke-dasharray="8 6"/>`);
    if (h.label) out.push(`<text x="${X(x1) - fs * 0.3}" y="${Y(h.y) - fs * 0.45}" fill="${h.color}" font-size="${fs}" font-weight="700" text-anchor="end">${esc(h.label)}</text>`);
  }
  for (const v of o.vlines || []) {
    out.push(`<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${Y(y0)}" y2="${Y(y1)}" stroke="${v.color}" stroke-width="2" stroke-dasharray="6 6"/>`);
  }
  for (const p of o.points || []) {
    out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r || 9}" fill="${p.color}" stroke="#170a0f" stroke-width="3"/>`);
    if (p.label) {
      const right = X(p.x) < W * 0.6;
      out.push(`<text x="${X(p.x) + (right ? 1 : -1) * fs * 0.9}" y="${Y(p.y) + (p.dy ?? -fs * 0.8)}" fill="${p.color}" font-size="${fs * 1.05}" font-weight="700" text-anchor="${right ? "start" : "end"}">${esc(p.label)}</text>`);
    }
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = out.join("");
}

// خطوة رقم حلوة للمحاور
export function niceStep(range, target = 6) {
  const raw = range / target, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

// منحنى طلب الصف من الأسعار: عند كل سعر، كم واحد مستعد يدفعه أو أكثر
export function demandFrom(prices) {
  const sorted = prices.slice().sort((a, b) => b - a);
  const pts = [];
  sorted.forEach((p, i) => {
    if (i + 1 < sorted.length && sorted[i + 1] === p) return;
    pts.push([i + 1, p]);
  });
  return pts; // [[الكمية, السعر], ...] السعر نازل والكمية طالعة
}
export const qAt = (prices, p) => prices.filter(x => x >= p).length;
export function median(prices) {
  if (!prices.length) return null;
  const s = prices.slice().sort((a, b) => a - b), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
// السعر اللي بيعطي أعلى إيراد (السعر × عدد اللي بيشتروا)
export function revenueMax(prices) {
  let best = null;
  for (const p of new Set(prices)) {
    const r = p * qAt(prices, p);
    if (p > 0 && (!best || r > best.r || (r === best.r && p < best.p))) best = { p, q: qAt(prices, p), r };
  }
  return best;
}
// مرونة نقطة المنتصف
export function midpointPED(p1, q1, p2, q2) {
  if (q1 + q2 === 0 || p1 === p2) return null;
  const dq = (q2 - q1) / ((q1 + q2) / 2), dp = (p2 - p1) / ((p1 + p2) / 2);
  return dq / dp;
}
