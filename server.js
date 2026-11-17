// Tiny zero-dependency server: serves /public and proxies LLM calls to DeepSeek
// so the API key never reaches the browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// minimal .env loader
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env, rely on real env */ }

const PORT = Number(process.env.PORT || 5177);
const KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const PUBLIC = path.join(__dirname, 'public');
const FISH = process.env.FISH_AUDIO_API_KEY || '';
const FISH_MODEL = process.env.FISH_AUDIO_MODEL || 's1';

// voice key -> Fish Audio library voice id (reference_id). Library voices only — no cloned real people.
let VOICES = {};
try { VOICES = JSON.parse(fs.readFileSync(path.join(__dirname, 'voices.json'), 'utf8')); } catch { /* optional */ }

const ttsCache = new Map(); // text+voice -> Buffer, so a repeated line is never paid for twice
async function tts(req, res) {
  if (!FISH) return send(res, 503, { error: 'tts not configured' });
  const { text, voice = 'neutral' } = await readJson(req);
  const clean = String(text || '').replace(/[*_~`]/g, '').slice(0, 600).trim();
  if (!clean) return send(res, 400, { error: 'text required' });
  const ref = VOICES[voice] || VOICES.neutral;
  const ck = `${ref}|${clean}`;
  if (ttsCache.has(ck)) return send(res, 200, ttsCache.get(ck), 'audio/mpeg');
  if (!allow('tts', req)) return send(res, 429, { error: 'voice limit reached' });
  const body = { text: clean, format: 'mp3', mp3_bitrate: 64, latency: 'balanced' };
  if (ref) body.reference_id = ref;
  const r = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FISH}`, 'Content-Type': 'application/json', model: FISH_MODEL },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    console.warn('fish tts', r.status, err.slice(0, 200));
    return send(res, 502, { error: `tts upstream ${r.status}` });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (ttsCache.size > 300) ttsCache.clear();
  ttsCache.set(ck, buf);
  send(res, 200, buf, 'audio/mpeg');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8',
};

// Per-visitor rate limits, so a public link can't drain the DeepSeek / Fish Audio credits.
// One full round uses roughly 30–60 LLM calls and 20–40 voice lines.
const LIMITS = { llm: Number(process.env.LLM_PER_HOUR || 150), tts: Number(process.env.TTS_PER_HOUR || 120) };
const DAILY_CAP = Number(process.env.DAILY_CAP || 6000); // all visitors, all endpoints
const hits = new Map(); // `${kind}:${ip}` -> [timestamps]
let day = { date: new Date().toISOString().slice(0, 10), count: 0 };
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
}
function allow(kind, req) {
  const today = new Date().toISOString().slice(0, 10);
  if (day.date !== today) day = { date: today, count: 0 };
  if (day.count >= DAILY_CAP) return false;
  const key = `${kind}:${clientIp(req)}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 3600_000);
  if (list.length >= LIMITS[kind]) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  day.count++;
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k); }, 600_000).unref();

function send(res, code, body, type = 'application/json', cache = 'no-store') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 120_000) throw new Error('too big'); }
  return JSON.parse(raw || '{}');
}

async function llm(req, res) {
  if (!KEY) return send(res, 500, { error: 'DEEPSEEK_API_KEY missing' });
  if (!allow('llm', req)) return send(res, 429, { error: 'Slow down, detective — try again in a bit.' });
  const { messages, json = false, temperature = 0.9, max_tokens = 800 } = await readJson(req);
  if (!Array.isArray(messages) || messages.length > 40) return send(res, 400, { error: 'messages required' });
  const body = { model: MODEL, messages, temperature: Math.min(Math.max(Number(temperature) || 0.9, 0), 1.5), max_tokens: Math.min(Number(max_tokens) || 800, 6500) };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, 502, { error: data?.error?.message || `upstream ${r.status}` });
  send(res, 200, { content: data.choices?.[0]?.message?.content ?? '' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/llm') return await llm(req, res);
    if (req.method === 'POST' && url.pathname === '/api/tts') return await tts(req, res);
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, key: !!KEY, model: MODEL, tts: !!FISH, voices: Object.keys(VOICES).length });
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      const cache = p.startsWith('/audio/') ? 'public, max-age=604800' : 'no-cache';
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && p.startsWith('/audio/')) {
        const start = m[1] ? Number(m[1]) : Math.max(0, buf.length - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
        if (start >= buf.length || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 });
        return res.end(buf.subarray(start, end + 1));
      }
      send(res, 200, buf, type, cache);
    });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`TUESDAY NEVER HAPPENED → http://localhost:${PORT}`));
