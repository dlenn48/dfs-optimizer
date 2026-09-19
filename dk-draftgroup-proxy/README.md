# dk-draftgroup-proxy

A tiny, single-route Node.js service that does exactly one thing: fetch
`https://api.draftkings.com/draftgroups/v1/draftgroups/{id}/draftables`
(the player pool / salaries for a slate) and return it with CORS headers
so your browser can call it directly.

## Why this exists

DraftKings' bot protection (Akamai) blocks this specific endpoint when the
request comes from Cloudflare Workers' network — confirmed 2026-09-17: a
real Worker request got an Akamai "Access Denied" page even with a fully
realistic browser header set (Chrome UA, Accept, Accept-Language, Referer,
Origin). Cloudflare Workers' outbound `fetch()` has a distinctive TLS
fingerprint that bot-management vendors commonly target, precisely
because Workers are so often used exactly like this — to route around a
site's CORS policy. The same request from a plain Node.js process on an
ordinary VM/container doesn't carry that fingerprint.

Everything else in the `dfs-optimizer` app (the contests list, nflverse
CSVs, odds, the Anthropic call) keeps using your existing Cloudflare
Worker at `dfs-proxy.dlenn48.workers.dev` — this service only replaces
the one blocked route.

## Deploy it (Render, free, no credit card)

1. Push this folder (`server.js`, `package.json`) to a new GitHub repo
   (or a folder in an existing one).
2. On [render.com](https://render.com), New → Web Service → connect that
   repo.
3. Build command: leave blank (nothing to build). Start command: `npm start`.
4. Instance type: **Free**. Runtime: Node.
5. Deploy. Render gives you a URL like `https://dk-draftgroup-proxy.onrender.com`.

Heads up on Render's free tier specifically: it spins down after 15
minutes with no traffic, and the next request wakes it up in about a
minute. For occasional slate-building that's a one-time ~1 minute wait
the first time you generate lineups in a session, not a big deal — but
if that annoys you, Fly.io's free allowance or a small always-on
VPS/home server won't have that cold start (see below).

### Alternatives
- **Fly.io** — `fly launch` in this folder, deploy as a Node app. Free
  allowance covers a small always-on machine (no sleep), but account
  verification currently requires a card on file even though usage stays
  free at this scale.
- **Railway** — similar to Render, also currently asks for a card to
  unlock the free usage credit.
- **A home server / Raspberry Pi / spare machine** — `node server.js`
  behind whatever you already use for port-forwarding or a tunnel
  (e.g. Cloudflare Tunnel *client* mode — note this is different from
  Cloudflare Workers and doesn't carry the same fingerprint since the
  actual `fetch()` still happens from your machine's own network path).
  No cold start, no third-party account at all.

## Wire it into the app

In `index.html`, there's a new field under the main "Proxy URL" one:
**"Draft group proxy URL (optional override, just for the player
pool)"**. Paste this service's URL there (e.g.
`https://dk-draftgroup-proxy.onrender.com`). Everything else keeps using
the Cloudflare Worker in the "Proxy URL" field above it; only the
player-pool fetch switches to this service. Leave it blank and the app
behaves exactly as before (same Worker for everything).

## Local testing

```
npm start
# then in another terminal:
curl http://localhost:3000/dk/draftgroup/153459
```

A 200 with a large `draftables` JSON array means it's working. If you
still get a 403 with an Akamai "Access Denied" body even from wherever
you deploy this, that means Akamai's block is broader than just
Cloudflare Workers (e.g. blocking a wider range of datacenter IPs) —
in that case the `X-Upstream-Note` response header will show the exact
block page, worth sending back for another look.
