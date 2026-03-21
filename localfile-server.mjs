import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

const PORT = Number(process.env.LOCALFILE_PORT) || 19876;
const HOME = homedir();

// Random token generated at startup
const TOKEN = randomBytes(16).toString('hex');
console.log(`[localfile-server] started (token: ${TOKEN.slice(0, 4)}****)`);

/** Resolve path, then assert it stays inside HOME. Throws on escape attempt. */
function resolvePath(raw) {
  const p = resolve(raw.startsWith('~') ? join(HOME, raw.slice(1)) : raw);
  if (p !== HOME && !p.startsWith(HOME + '/')) {
    const err = new Error('Access denied: path outside home directory');
    err.code = 'EACCES';
    throw err;
  }
  return p;
}

function pathError(res, e) {
  const status = e.code === 'ENOENT' ? 404 : e.code === 'EACCES' ? 403 : 500;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: e.message, missing: e.code === 'ENOENT' }));
}

const MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};

// Localhost origins that the frontend may run on
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // ── CORS: only allow localhost origins (blocks malicious cross-origin JS) ──
  const origin = req.headers['origin'] ?? '';
  const isLocalhostOrigin = LOCALHOST_ORIGIN_RE.test(origin);

  if (url.pathname !== '/raw') {
    if (isLocalhostOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Local-Token');
  }

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── CSRF guard: block cross-site browser-initiated requests ───────────────
  // Sec-Fetch-Site is set by all modern browsers; non-browser clients (curl,
  // Node fetch from localhost) leave it absent, which is fine.
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cross-site requests not allowed' }));
    return;
  }

  // ── Bootstrap: expose token (no auth needed — only reachable from 127.0.0.1) ──
  if (req.method === 'GET' && url.pathname === '/token') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: TOKEN }));
    return;
  }

  // ── /raw: serve binary files for <img> tags ────────────────────────────────
  // No CORS headers here — blocks cross-origin JS reads while <img> still works.
  // Token checked via query param so URLs embedded in HTML/CSS still work.
  if (req.method === 'GET' && url.pathname === '/raw') {
    const reqToken = url.searchParams.get('token') ?? '';
    if (reqToken !== TOKEN) { res.writeHead(401); res.end(); return; }
    try {
      const rawPath = resolvePath(url.searchParams.get('path') ?? '');
      const ext = rawPath.slice(rawPath.lastIndexOf('.')).toLowerCase();
      const mime = MIME_MAP[ext] ?? 'application/octet-stream';
      const buf = readFileSync(rawPath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(buf);
    } catch (e) { pathError(res, e); }
    return;
  }

  // ── All remaining endpoints require X-Local-Token header ──────────────────
  const reqToken = req.headers['x-local-token'] ?? '';
  if (reqToken !== TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // List directory: GET /?dir=path
  if (req.method === 'GET' && url.searchParams.has('dir')) {
    try {
      const dirPath = resolvePath(url.searchParams.get('dir') ?? '');
      const entries = readdirSync(dirPath);
      const files = entries.filter(e => {
        try { return statSync(join(dirPath, e)).isFile(); } catch { return false; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
    } catch (e) {
      const missing = e.code === 'ENOENT';
      res.writeHead(missing ? 404 : e.code === 'EACCES' ? 403 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, missing, files: [] }));
    }
    return;
  }

  let filePath;
  try {
    filePath = resolvePath(url.searchParams.get('path') ?? '');
  } catch (e) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
    return;
  }

  if (req.method === 'GET') {
    try {
      const content = readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content }));
    } catch (e) { pathError(res, e); }
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        mkdirSync(dirname(filePath), { recursive: true });
        if (typeof content === 'string' && content.startsWith('data:')) {
          const b64 = content.replace(/^data:[^;]+;base64,/, '');
          writeFileSync(filePath, Buffer.from(b64, 'base64'));
        } else {
          writeFileSync(filePath, content, 'utf-8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    if (url.searchParams.has('dir')) {
      try {
        const dirPath = resolvePath(url.searchParams.get('dir') ?? '');
        rmSync(dirPath, { recursive: true, force: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { pathError(res, e); }
      return;
    }
    try {
      unlinkSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { pathError(res, e); }
    return;
  }

  res.writeHead(405); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[localfile-server] http://127.0.0.1:${PORT}`);
});
