// تصويت مباشر لعرض ECO 201: كل جلسة (session) = Durable Object واحد.
// الطلاب بيبعتوا أقصى سعر بيدفعوه، وشاشة العرض بتستقبل التحديثات فورًا عبر WebSocket.
import { DurableObject } from "cloudflare:workers";

const MAX_VOTERS = 1000;
const MIN_PRICE = 0, MAX_PRICE = 500;

const reply = (obj, code = 200) => new Response(JSON.stringify(obj), {
  status: code, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export class Poll extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.votes = {}; // voter -> price
    this.v = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.votes = (await ctx.storage.get("votes")) || {};
      this.v = (await ctx.storage.get("v")) || 0;
    });
  }

  view() {
    const prices = Object.values(this.votes).sort((a, b) => a - b);
    return { v: this.v, n: prices.length, prices };
  }

  broadcast() {
    const msg = JSON.stringify(this.view());
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch {} }
  }

  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname;

    if (p === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return reply({ error: "ws" }, 426);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify(this.view()));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (p === "/state") return reply(this.view());

    if (p === "/vote" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch {}
      const voter = String(b.voter || "");
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(voter)) return reply({ error: "voter" }, 400);
      const price = Math.round(Number(b.price));
      if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) return reply({ error: "price" }, 400);
      const isNew = !(voter in this.votes);
      if (isNew && Object.keys(this.votes).length >= MAX_VOTERS) return reply({ error: "full" }, 400);
      this.votes[voter] = price;
      this.v++;
      await this.ctx.storage.put({ votes: this.votes, v: this.v });
      this.broadcast();
      return reply({ ok: true, price, n: Object.keys(this.votes).length });
    }

    return reply({ error: "not found" }, 404);
  }

  async webSocketMessage(ws, msg) {
    if (msg === "ping") { try { ws.send("pong"); } catch {} }
  }
  async webSocketClose(ws) { try { ws.close(); } catch {} }
}
