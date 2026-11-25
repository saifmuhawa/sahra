// غرفة لعب وحدة = Durable Object واحد على Cloudflare.
// الحكم والمتسابقين متصلين بـ WebSocket، والمؤقت بيمشي هون بالسيرفر عشان يكون نفس الوقت على كل الجوالات.
import { DurableObject } from "cloudflare:workers";
import {
  init, tmdb, shape, animeShape, alDetail, tmDetail, askAI, GENRE_AR, rid, clean, titleWords, leaks, fillLevels,
  dataHintsMovie, dataHintsAnime, dataHintsSeries, HINTS_PROMPT, parseHints, wikiFacts, hasKey,
} from "./api.js";

const DEFAULT_TEAMS = ["الفريق الأحمر", "الفريق الذهبي"];
const IDLE_MS = 6 * 3600e3;      // الغرفة بتنمسح بعد 6 ساعات بدون نشاط
const HINT_GAP_MS = 1500;        // عشان ضغطتين ورا بعض ما يطلّعوا تلميحين
const MAX_PLAYERS = 20;

const reply = (obj, code = 200) => new Response(JSON.stringify(obj), { status: code, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    init(env);
    this.r = null;
    this.seen = new Map(); // آخر مرة شفنا فيها كل متسابق (للي ما عنده WebSocket)
    ctx.blockConcurrencyWhile(async () => { this.r = (await ctx.storage.get("r")) || null; });
  }

  // ===== حفظ وبث =====
  async save() {
    const r = this.r;
    r.v++; r.touched = Date.now();
    await this.ctx.storage.put("r", r);
    await this.schedule();
    this.broadcast();
  }
  async schedule() {
    const r = this.r; if (!r) return;
    const times = [r.touched + IDLE_MS];
    if (r.stage === "play" && r.turnEnds && !r.paused) times.push(r.turnEnds);
    await this.ctx.storage.setAlarm(Math.min(...times));
  }
  online() {
    const on = new Set();
    for (const ws of this.ctx.getWebSockets()) for (const t of this.ctx.getTags(ws)) if (t.startsWith("p:")) on.add(t.slice(2));
    const now = Date.now();
    for (const [id, t] of this.seen) if (now - t < 20000) on.add(id);
    return on;
  }
  broadcast() {
    const on = this.online();
    for (const ws of this.ctx.getWebSockets()) {
      const tag = this.ctx.getTags(ws)[0] || "";
      const who = tag === "j" ? "judge" : tag.startsWith("p:") ? tag.slice(2) : null;
      try { ws.send(JSON.stringify(this.view(who, on))); } catch {}
    }
  }

  // ===== شو بيشوف كل واحد =====
  view(who, on = this.online()) {
    const r = this.r;
    const film = r.film ? { t: r.film.t, id: r.film.id, en: r.film.en, ar: r.film.ar, orig: r.film.orig, y: r.film.y, p: r.film.p } : null;
    const out = {
      code: r.code, kind: r.kind, v: r.v, now: Date.now(), stage: r.stage,
      players: r.players.map(p => ({ id: p.id, name: p.name, team: p.team, on: on.has(p.id) })),
      teams: r.teams, score: r.score, hintsTotal: r.hintsTotal, turnSec: r.turnSec,
      turn: r.turn, turnEnds: r.turnEnds, paused: r.paused, left: r.left, lastPass: r.lastPass,
      round: r.round, winner: r.winner, final: r.final, rounds: r.rounds,
      roundHints: [r.got[0].length, r.got[1].length], hintsLeft: [0, 1].map(t => r.hints.length - r.got[t].length),
      hasFilm: !!r.film, film: r.stage === "reveal" || r.stage === "final" ? film : null,
    };
    if (who === "judge") {
      Object.assign(out, { film, hintsSrc: r.hintsSrc, hintsErr: r.hintsErr || null,
        hints: r.hints.map((h, i) => ({ ...h, i, got: [0, 1].filter(t => r.got[t].includes(i)) })) });
    } else {
      const me = r.players.find(p => p.id === who);
      out.me = me ? { id: me.id, name: me.name, team: me.team } : null;
      // التلميحات: كل فريق بيشوف تلميحاته بس
      out.myHints = me ? r.got[me.team].map(i => ({ i, lvl: r.hints[i]?.lvl, text: r.hints[i]?.text })) : [];
    }
    return out;
  }

  // ===== الطلبات =====
  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname;
    let b = {};
    if (req.method === "POST") { try { b = await req.json(); } catch {} }

    if (p === "/create") {
      if (this.r && Date.now() - this.r.touched < IDLE_MS) return reply({ error: "taken" }, 409);
      this.r = {
        code: clean(b.code, 8), key: rid(), kind: ["anime", "series"].includes(b.kind) ? b.kind : "film", v: 0, touched: Date.now(),
        stage: "lobby", players: [], teams: DEFAULT_TEAMS.slice(), turnSec: 30,
        score: [0, 0], hintsTotal: [0, 0], rounds: [], round: 0,
        film: null, hints: [], hintsSrc: null, hintsErr: null, filmToken: null, got: [[], []], lastHintAt: [0, 0],
        turn: 0, turnEnds: null, paused: false, left: 0, lastPass: null, winner: null, final: null,
      };
      await this.save();
      return reply({ code: this.r.code, key: this.r.key });
    }
    const r = this.r;
    if (!r) return reply({ error: "room" }, 404);
    const isJudge = (b.key || u.searchParams.get("key")) === r.key;
    const pid = b.pid || u.searchParams.get("pid");

    if (p === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return reply({ error: "ws" }, 426);
      const me = r.players.find(x => x.id === pid);
      if (!isJudge && !me) return reply({ error: "who" }, 403);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [isJudge ? "j" : "p:" + me.id]);
      pair[1].send(JSON.stringify(this.view(isJudge ? "judge" : me.id)));
      if (!isJudge) this.broadcast(); // عشان الكل يشوف إنه صار أونلاين
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (p === "/state") {
      if (isJudge) return reply(this.view("judge"));
      const me = r.players.find(x => x.id === pid);
      if (me) this.seen.set(me.id, Date.now());
      return reply(this.view(me ? me.id : null));
    }
    if (p === "/join") {
      const name = clean(b.name, 20);
      if (!name) return reply({ error: "name" }, 400);
      const old = b.pid && r.players.find(x => x.id === b.pid);
      if (old) { old.name = name; await this.save(); return reply({ pid: old.id }); }
      if (r.players.length >= MAX_PLAYERS) return reply({ error: "full" }, 400);
      const cnt = [0, 1].map(t => r.players.filter(x => x.team === t).length);
      const pl = { id: rid(), name, team: cnt[0] <= cnt[1] ? 0 : 1 };
      r.players.push(pl);
      await this.save();
      return reply({ pid: pl.id });
    }
    if (p === "/leave") {
      r.players = r.players.filter(x => x.id !== pid);
      this.closeFor(pid);
      await this.save();
      return reply({ ok: true });
    }
    if (p === "/hint") return this.hint(pid);
    if (p === "/act") {
      if (!isJudge) return reply({ error: "judge only" }, 403);
      return this.act(b);
    }
    return reply({ error: "route" }, 404);
  }

  closeFor(pid) {
    for (const ws of this.ctx.getWebSockets("p:" + pid)) { try { ws.close(4001, "left"); } catch {} }
  }

  // فريق بيطلب تلميح: بيوصله التلميح الجاي (من الصعب للسهل) وبيوصل لفريقه بس
  async hint(pid) {
    const r = this.r;
    const me = r.players.find(x => x.id === pid);
    if (!me) return reply({ error: "who" }, 403);
    if (r.stage !== "play" || !r.hints.length) return reply({ error: "stage" }, 400);
    const t = me.team, now = Date.now();
    if (now - r.lastHintAt[t] < HINT_GAP_MS) return reply({ error: "slow", myHints: this.view(me.id).myHints }, 429);
    const next = r.hints.findIndex((h, i) => !r.got[t].includes(i));
    if (next < 0) return reply({ error: "none" }, 400);
    r.got[t].push(next); r.hintsTotal[t]++; r.lastHintAt[t] = now;
    await this.save();
    return reply({ ok: true, hint: { i: next, ...r.hints[next] } });
  }

  startTurn(team) {
    const r = this.r;
    r.turn = team; r.paused = false; r.left = 0;
    r.turnEnds = Date.now() + r.turnSec * 1000;
  }
  stopTimer() { const r = this.r; r.turnEnds = null; r.paused = false; r.left = 0; }

  async act(b) {
    const r = this.r;
    const pl = r.players.find(x => x.id === b.pid);
    switch (b.type) {
      case "move": if (pl) pl.team = pl.team ? 0 : 1; break;
      case "kick": r.players = r.players.filter(x => x.id !== b.pid); this.closeFor(b.pid); break;
      case "shuffle": {
        const ps = r.players.slice().sort(() => Math.random() - 0.5);
        ps.forEach((x, i) => { x.team = i % 2; });
        break;
      }
      case "teams": r.teams = [clean(b.a, 24) || r.teams[0], clean(b.b, 24) || r.teams[1]]; break;
      case "turnsec": { const s = Math.round(+b.sec); if (s >= 15 && s <= 120) r.turnSec = s; break; }
      case "start": {
        const cnt = [0, 1].map(t => r.players.filter(x => x.team === t).length);
        if (!cnt[0] || cnt[0] !== cnt[1]) return reply({ error: "teams", cnt }, 400);
        r.stage = "pick"; break;
      }
      case "lobby": this.stopTimer(); r.stage = "lobby"; break;
      case "film": {
        if (!hasKey()) return reply({ error: "TMDB_API_KEY is missing" }, 500);
        try { await this.setFilm(b.t, +b.id || 0); } catch (e) { return reply({ error: String(e.message || e) }, 502); }
        return reply(this.view("judge"));
      }
      // الحكم جاوب على سؤال الفريق → الدور للفريق الثاني
      case "pass": if (r.stage === "play") { r.lastPass = { team: r.turn, why: "judge", at: Date.now() }; this.startTurn(1 - r.turn); } break;
      case "pause": if (r.stage === "play" && r.turnEnds && !r.paused) { r.left = Math.max(0, r.turnEnds - Date.now()); r.turnEnds = null; r.paused = true; } break;
      case "resume": if (r.stage === "play" && r.paused) { r.turnEnds = Date.now() + (r.left || r.turnSec * 1000); r.paused = false; r.left = 0; } break;
      case "reveal": {
        if (!r.film) break;
        const w = [0, 1].includes(b.winner) ? b.winner : -1;
        if (w >= 0) r.score[w]++;
        r.winner = w; r.stage = "reveal"; this.stopTimer();
        r.rounds.push({ en: r.film.en, ar: r.film.ar, y: r.film.y, p: r.film.p, winner: w, hints: [r.got[0].length, r.got[1].length] });
        if (r.rounds.length > 30) r.rounds = r.rounds.slice(-30);
        break;
      }
      case "next": this.clearFilm(); r.stage = "pick"; break;
      case "end": {
        this.clearFilm();
        const [a, c] = r.score, [ha, hc] = r.hintsTotal;
        let winner = -1, reason = "draw";
        if (a !== c) { winner = a > c ? 0 : 1; reason = "score"; }
        else if (ha !== hc) { winner = ha < hc ? 0 : 1; reason = "hints"; }
        r.final = { winner, reason }; r.stage = "final";
        break;
      }
      case "newgame": this.clearFilm(); Object.assign(r, { score: [0, 0], hintsTotal: [0, 0], rounds: [], round: 0, final: null, stage: "pick" }); break;
      default: return reply({ error: "type" }, 400);
    }
    await this.save();
    return reply(this.view("judge"));
  }

  clearFilm() {
    const r = this.r;
    Object.assign(r, { film: null, hints: [], hintsSrc: null, hintsErr: null, filmToken: null, got: [[], []], winner: null, lastPass: null });
    this.stopTimer();
  }

  // ===== اختيار الفيلم وتجهيز التلميحات =====
  async setFilm(t, id) {
    const r = this.r;
    const token = rid();
    r.filmToken = token;
    let film, hints, info;
    if (r.kind === "series") {
      const a = await tmDetail(id);
      if (!a) throw new Error("not found");
      film = { t: "tv", id: a.id, en: a.en, ar: a.ar, orig: a.orig, y: a.y, p: a.p, imdb: a.imdb };
      hints = dataHintsSeries(a);
      info = { type: "TV series", year: a.y, status: a.status, genres: (a.g || []).map(x => GENRE_AR[x]).filter(Boolean), network: (a.networks || []).map(x => x.n), seasons: a.seasons, episodes: a.episodes, creators: a.creators, cast: (a.cast || []).slice(0, 8).map(c => c.n + " as " + c.ch), plot: a.ov };
    } else if (r.kind === "anime") {
      const tt = t === "movie" ? "movie" : "tv";
      const a = await alDetail(id);
      if (!a) throw new Error("not found");
      film = { t: a.t, id: a.id, en: a.en, ar: a.ar, orig: a.orig, y: a.y, p: a.p };
      hints = dataHintsAnime(a);
      info = { type: a.t === "tv" ? "anime series" : "anime film", year: a.y, genres: (a.g || []).map(x => GENRE_AR[x]).filter(Boolean), studios: (a.studios || []).map(x => x.n), episodes: a.episodes, seasons: a.seasons, characters: (a.cast || []).slice(0, 8).map(c => c.ch), voices: (a.cast || []).slice(0, 4).map(c => c.n), writers: a.wri, plot: a.ov };
    } else {
      const d = await tmdb("/movie/" + id, { language: "en-US", append_to_response: "videos,external_ids,translations,credits,release_dates" });
      if (!d) throw new Error("not found");
      const { film: f, det } = shape(d);
      film = { t: "movie", id: f.id, en: f.en, ar: f.ar, orig: det.orig, y: f.y, p: f.p };
      hints = dataHintsMovie(f, det);
      info = { year: f.y, genres: (det.g || []).map(x => GENRE_AR[x]).filter(Boolean), director: det.dir, cast: (det.cast || []).slice(0, 8).map(c => c.n + " as " + c.ch), writers: det.wri, countries: det.countries, boxOffice: det.revenue, plot: det.ov, tagline: det.tag };
    }
    if (r.filmToken !== token) return;
    Object.assign(r, { film, hints, hintsSrc: "data", hintsErr: null, got: [[], []], lastHintAt: [0, 0], winner: null, lastPass: null, stage: "play" });
    this.startTurn(r.round % 2); // الفريق اللي بيبلّش بيتبدّل كل جولة
    r.round++;
    await this.save();
    const job = this.aiHints(token, info, [film.en, film.ar, film.orig], film);
    try { this.ctx.waitUntil(job); } catch { job.catch(() => {}); }
  }

  async aiHints(token, info, names, film) {
    const r = this.r;
    try {
      const wiki = await wikiFacts(film.en, film.y, r.kind);
      if (wiki) info.wikipedia = wiki;
      const errs = [];
      const ai = await askAI(info, errs, x => HINTS_PROMPT(r.kind === "anime" ? "anime" : r.kind === "series" ? "TV series" : "movie", x), t => !!parseHints(t), 40000);
      if (!ai) { if (errs.length && this.r?.filmToken === token) { this.r.hintsErr = errs.join(" | ").slice(0, 400); } return; }
      const h = parseHints(ai.text); const ws = titleWords(...names);
      const pick = arr => arr.map(x => clean(x, 200)).filter(x => x && !leaks(x, ws));
      const cur = this.r;
      // ما نبدّل إذا الحكم غيّر الفيلم أو إذا فريق أخذ تلميح من قبل
      if (!cur || cur.filmToken !== token || cur.got[0].length || cur.got[1].length) return;
      const mixed = { hard: pick(h.hard), mid: pick(h.mid), easy: pick(h.easy) };
      for (const k of ["hard", "mid", "easy"]) for (const d of cur.hints.filter(x => x.lvl === k)) if (mixed[k].length < 5) mixed[k].push(d.text);
      cur.hints = fillLevels(mixed); cur.hintsSrc = wiki ? "ai+wiki" : "ai";
      await this.save();
    } catch (e) { console.warn("hints", String(e)); }
  }

  // ===== المؤقت =====
  async alarm() {
    const r = this.r; if (!r) return;
    const now = Date.now();
    if (now - r.touched >= IDLE_MS) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(4000, "closed"); } catch {} }
      this.r = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    if (r.stage === "play" && r.turnEnds && !r.paused && now >= r.turnEnds - 100) {
      // خلص الوقت: راحت على الفريق والدور للفريق الثاني
      r.lastPass = { team: r.turn, why: "timeout", at: now };
      this.startTurn(1 - r.turn);
      await this.save();
      return;
    }
    await this.schedule();
  }

  async webSocketMessage(ws, msg) {
    if (msg === "ping") { try { ws.send("pong"); } catch {} }
  }
  async webSocketClose(ws) {
    try { ws.close(); } catch {}
    if (this.r) this.broadcastSoon();
  }
  broadcastSoon() { setTimeout(() => { if (this.r) this.broadcast(); }, 50); }
}
