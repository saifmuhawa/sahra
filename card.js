/* كرت نتيجة السهرة للستوري (1080×1920) — بيترسم على الجوال نفسه بدون سيرفر */
async function makeStoryCard(d) {
  const W = 1080, H = 1920;
  const C = {velvet: "#170a0f", velvet2: "#22111a", velvet3: "#2e1823", seat: "#c8323c", seatTxt: "#ff8a92", ticket: "#e2b457", cream: "#f4ead9", muted: "#b9a79a"};
  const DISP = "Lalezar", BODY = "IBM Plex Sans Arabic";
  try { await Promise.all([document.fonts.load(`100px ${DISP}`), document.fonts.load(`700 40px "${BODY}"`), document.fonts.load(`400 40px "${BODY}"`)]); } catch (e) {}
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  x.direction = "rtl"; x.textAlign = "center"; x.textBaseline = "alphabetic";
  const font = (size, fam = DISP, w = "") => { x.font = `${w ? w + " " : ""}${size}px "${fam}", "${BODY}", sans-serif`; };
  const text = (t, cx, y, size, color, fam, w, maxW) => {
    font(size, fam, w);
    let s = String(t);
    if (maxW) { while (x.measureText(s).width > maxW && s.length > 2) s = s.slice(0, -2) + "…"; }
    x.fillStyle = color; x.fillText(s, cx, y);
  };
  const rr = (x0, y0, w, h, r) => { x.beginPath(); x.moveTo(x0 + r, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, r); x.arcTo(x0 + w, y0 + h, x0, y0 + h, r); x.arcTo(x0, y0 + h, x0, y0, r); x.arcTo(x0, y0, x0 + w, y0, r); x.closePath(); };

  // الخلفية: مخمل غامق وضوء بروجكتر من فوق
  const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, C.velvet2); bg.addColorStop(1, C.velvet);
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const beam = x.createRadialGradient(W / 2, -200, 50, W / 2, -200, 1300);
  beam.addColorStop(0, "rgba(244,234,217,.22)"); beam.addColorStop(1, "rgba(244,234,217,0)");
  x.fillStyle = beam; x.fillRect(0, 0, W, H);
  // ثقوب شريط السينما على الجنبين
  x.fillStyle = "rgba(244,234,217,.07)";
  for (let y = 40; y < H; y += 90) { rr(22, y, 34, 52, 8); x.fill(); rr(W - 56, y, 34, 52, 8); x.fill(); }

  // الراس
  text("سهرة فيلم", W / 2, 190, 120, C.ticket);
  text(d.game, W / 2, 285, 64, C.cream);
  text("نتيجة السهرة", W / 2, 400, 44, C.muted, BODY, "700");

  // الفريقين: الأول يمين والثاني يسار
  // نوسّط المحتوى بين الراس والذيل حسب عدد الجولات
  const shown = Math.min(6, (d.rounds || []).length);
  const boxW = 440, boxH = 520, gap = 40;
  const midH = boxH + 130 + (d.sub ? 70 : 0) + (shown ? 150 + 78 * shown + ((d.rounds || []).length > shown ? 60 : 0) : 0);
  const top = 450 + Math.max(0, Math.round((H - 330 - 450 - midH) / 2));
  const xs = [W / 2 + gap / 2, W / 2 - gap / 2 - boxW];
  for (const t of [0, 1]) {
    const bx = xs[t], won = d.winner === t, col = t ? C.ticket : C.seat, nameCol = t ? C.ticket : C.seatTxt;
    rr(bx, top, boxW, boxH, 44);
    x.fillStyle = won ? (t ? "rgba(226,180,87,.16)" : "rgba(200,50,60,.18)") : "rgba(46,24,35,.85)"; x.fill();
    x.lineWidth = won ? 10 : 4; x.strokeStyle = won ? col : "rgba(244,234,217,.15)"; x.stroke();
    const cx = bx + boxW / 2;
    if (won) text("🏆", cx, top + 105, 80, C.cream, BODY);
    text(d.teams[t], cx, top + (won ? 190 : 140), 52, nameCol, DISP, "", boxW - 50);
    text(String(d.score[t] ?? 0), cx, top + (won ? 400 : 370), 230, C.cream);
    text("💡 " + (d.hints[t] ?? 0) + " تلميح", cx, top + boxH - 40, 36, C.muted, BODY, "700");
  }

  // الخلاصة
  let y = top + boxH + 130;
  text(d.head.replace(/^🏆\s*/, ""), W / 2, y, 76, d.winner === 1 ? C.ticket : d.winner === 0 ? C.seatTxt : C.cream, DISP, "", W - 140);
  if (d.sub) { y += 70; text(d.sub, W / 2, y, 38, C.muted, BODY, "700", W - 160); }

  // اللي لعبناه
  const rounds = (d.rounds || []).slice(-6);
  if (rounds.length) {
    y += 120;
    text(rounds.length === 1 ? d.thing + " اللي لعبناه" : "اللي لعبناه", W / 2, y, 40, C.muted, BODY, "700");
    y += 30;
    for (const r of rounds) {
      y += 78;
      rr(140, y - 56, W - 280, 70, 22); x.fillStyle = "rgba(46,24,35,.9)"; x.fill();
      const dot = r.winner === 0 ? C.seat : r.winner === 1 ? C.ticket : C.muted;
      x.beginPath(); x.arc(W - 180, y - 21, 13, 0, Math.PI * 2); x.fillStyle = dot; x.fill();
      x.textAlign = "right"; text(r.ar || r.en, W - 215, y - 8, 38, C.cream, BODY, "700", W - 520);
      x.textAlign = "left"; text(r.winner >= 0 ? d.teams[r.winner] : "ما حدا عرفه", 175, y - 8, 30, C.muted, BODY, "400", 240);
      x.textAlign = "center";
    }
    if ((d.rounds || []).length > rounds.length) { y += 60; text("+ " + (d.rounds.length - rounds.length) + " كمان", W / 2, y, 30, C.muted, BODY); }
  }

  // الذيل
  x.strokeStyle = "rgba(244,234,217,.15)"; x.lineWidth = 3; x.beginPath(); x.moveTo(160, H - 250); x.lineTo(W - 160, H - 250); x.stroke();
  text("العبوها إنتو كمان 🎬", W / 2, H - 170, 50, C.cream);
  x.direction = "ltr";
  text(d.host || "sahra", W / 2, H - 105, 40, C.ticket, BODY, "700");
  text("@saiflex.u", W / 2, H - 55, 34, C.muted, BODY, "400");
  return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/png"));
}
