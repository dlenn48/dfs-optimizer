// Minimal standalone proxy for exactly one route: GET /dk/draftgroup/:id
//
// Why this exists: DraftKings' Akamai bot protection blocks requests to
// api.draftkings.com/draftgroups/v1/... when they come from Cloudflare
// Workers' network -- even with a fully realistic browser header set
// (Chrome UA, Accept, Accept-Language, Referer, Origin all attempted and
// still 403'd, 2026-09-17). Cloudflare Workers' outbound fetch() has a
// well-known, distinctive TLS fingerprint that bot-management vendors
// commonly target specifically because Workers are so often used exactly
// like this -- to dodge a site's CORS policy. A plain Node.js process on
// an ordinary VM/container doesn't carry that fingerprint.
//
// Everything else in the app (contests list, nflverse CSVs, odds, the
// Anthropic call) stays on the existing Cloudflare Worker at
// dfs-proxy.dlenn48.workers.dev -- only index.html's "Draft group proxy
// URL" field needs to point here. Leave that field blank and the app
// keeps using the main Worker for this route too, unchanged.
//
// Deploy anywhere that runs Node 18+: Render, Fly.io, Railway, a home
// server, a small VPS. See README.md for a couple of concrete options.

const http = require('http');

const PORT = process.env.PORT || 3000;

// Same realistic browser header set already used successfully elsewhere
// in this project (the Worker's /espn/scoreboard route). Kept here too --
// it may still help at the margins even though the network/runtime
// change is very likely what actually clears Akamai's check.
function dkHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.draftkings.com/lobby',
    'Origin': 'https://www.draftkings.com'
  };
}

function withCors(res, extra) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Same gotcha as the Cloudflare Worker hit on 2026-09-17: a custom
  // response header is invisible to browser JS across origins unless
  // it's explicitly whitelisted here.
  res.setHeader('Access-Control-Expose-Headers', 'X-Upstream-Status, X-Upstream-Note');
  if (extra) Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (e) {
    withCors(res);
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Bad request URL' }));
    return;
  }

  if (req.method === 'OPTIONS') {
    withCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /dk/draftgroup/{id}  ->  player pool / salaries for a slate
  const match = url.pathname.match(/^\/dk\/draftgroup\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const id = decodeURIComponent(match[1]);
    try {
      const upstream = await fetch(
        'https://api.draftkings.com/draftgroups/v1/draftgroups/' + encodeURIComponent(id) + '/draftables',
        { headers: dkHeaders() }
      );
      const text = await upstream.text();
      const extra = {};
      if (!upstream.ok) {
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
        extra['X-Upstream-Status'] = String(upstream.status);
        extra['X-Upstream-Note'] = encodeURIComponent(snippet);
      }
      withCors(res, extra);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(upstream.status);
      res.end(text);
    } catch (err) {
      withCors(res);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(502);
      res.end(JSON.stringify({ error: String((err && err.message) || err) }));
    }
    return;
  }

  // Health check -- also useful as the URL some free hosts ping to keep
  // an instance from fully cold-starting between requests.
  if (req.method === 'GET' && url.pathname === '/') {
    withCors(res);
    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(200);
    res.end('dk-draftgroup-proxy is running');
    return;
  }

  withCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found: ' + url.pathname }));
});

server.listen(PORT, () => {
  console.log('dk-draftgroup-proxy listening on port ' + PORT);
});
