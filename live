/**
 * Live Visitor Tracker — zero dependencies, pure Node.js
 * -------------------------------------------------------
 * Endpoints:
 *   POST /track        -> receives a ping from your Wix site
 *   GET  /live-stats    -> time-bucketed visitor counts for the chart
 *   GET  /active-now    -> current number of active sessions
 *   GET  /              -> serves the dashboard (dashboard.html)
 *
 * Data is kept in memory and also appended to events.jsonl on disk,
 * so a restart doesn't lose history (events.jsonl is replayed on boot).
 *
 * Run:  node server.js
 * Env:  PORT=4000  (optional, defaults to 4000)
 *       ALLOWED_ORIGIN=https://your-affiliate-dashboard.com  (optional CORS lock-down)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // lock this down in production
const EVENTS_FILE = path.join(__dirname, 'events.jsonl');
const ACTIVE_WINDOW_MS = 60 * 1000; // a session counts as "active" if pinged in last 60s
const MAX_EVENTS_IN_MEMORY = 50000; // rolling cap so memory doesn't grow forever

/** @type {{ts:number, sessionId:string, page:string, ref:string, event:string}[]} */
let events = [];

// ---- Load existing history on boot (optional persistence) ----
function loadEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return;
  const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // keep last 24h in memory
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.ts >= cutoff) events.push(e);
    } catch (_) { /* skip corrupt line */ }
  }
  console.log(`Loaded ${events.length} events from disk`);
}
loadEvents();

function appendToDisk(e) {
  fs.appendFile(EVENTS_FILE, JSON.stringify(e) + '\n', () => {});
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // 1MB safety cap
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ---- POST /track : receive a ping from the Wix site ----
  if (req.method === 'POST' && parsed.pathname === '/track') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const e = {
        ts: Date.now(),
        sessionId: String(payload.sessionId || 'unknown').slice(0, 64),
        page: String(payload.page || '/').slice(0, 256),
        ref: String(payload.ref || '').slice(0, 256),
        event: String(payload.event || 'pageview').slice(0, 32),
      };
      events.push(e);
      appendToDisk(e);
      if (events.length > MAX_EVENTS_IN_MEMORY) {
        events = events.slice(events.length - MAX_EVENTS_IN_MEMORY);
      }
      return sendJSON(res, 200, { ok: true });
    } catch (err) {
      return sendJSON(res, 400, { ok: false, error: 'bad request' });
    }
  }

  // ---- GET /active-now : sessions pinged in the last 60s ----
  if (req.method === 'GET' && parsed.pathname === '/active-now') {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    const activeSessions = new Set(
      events.filter(e => e.ts >= cutoff).map(e => e.sessionId)
    );
    return sendJSON(res, 200, { activeNow: activeSessions.size, at: Date.now() });
  }

  // ---- GET /live-stats?windowSeconds=600&bucketSeconds=10 ----
  if (req.method === 'GET' && parsed.pathname === '/live-stats') {
    const windowSeconds = Math.min(parseInt(parsed.query.windowSeconds) || 600, 86400);
    const bucketSeconds = Math.max(parseInt(parsed.query.bucketSeconds) || 10, 5);
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    const bucketMs = bucketSeconds * 1000;
    const numBuckets = Math.ceil((now - cutoff) / bucketMs);

    // bucket index -> Set of unique sessionIds seen in that bucket
    const buckets = Array.from({ length: numBuckets }, () => new Set());
    let pageviews = Array.from({ length: numBuckets }, () => 0);

    for (const e of events) {
      if (e.ts < cutoff) continue;
      const idx = Math.min(Math.floor((e.ts - cutoff) / bucketMs), numBuckets - 1);
      if (idx < 0) continue;
      buckets[idx].add(e.sessionId);
      pageviews[idx] += 1;
    }

    const series = buckets.map((set, i) => ({
      t: new Date(cutoff + i * bucketMs).toISOString(),
      visitors: set.size,
      pageviews: pageviews[i],
    }));

    return sendJSON(res, 200, { windowSeconds, bucketSeconds, series });
  }

  // ---- Serve the dashboard ----
  if (req.method === 'GET' && (parsed.pathname === '/' || parsed.pathname === '/dashboard.html')) {
    const file = path.join(__dirname, 'dashboard.html');
    fs.readFile(file, (err, content) => {
      if (err) { res.writeHead(500); return res.end('dashboard.html missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Live tracker running on http://localhost:${PORT}`);
});
