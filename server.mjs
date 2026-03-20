#!/usr/bin/env node
/**
 * OpenClaw UI — production static server + self-update endpoint
 * Replaces `npx serve` so the process can rebuild and restart itself.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT   = Number(process.env.PORT) || 8080;
const DIST   = join(__dirname, 'dist');
const TF     = join(__dirname, '.update-token');

// Generate or load update token
const UPDATE_TOKEN = existsSync(TF)
  ? readFileSync(TF, 'utf8').trim()
  : (() => { const t = randomBytes(24).toString('hex'); writeFileSync(TF, t); return t; })();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const filePath = join(DIST, urlPath === '/' ? 'index.html' : urlPath);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw 0;
    const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
    createReadStream(filePath).pipe(res);
  } catch {
    // SPA fallback
    const idx = join(DIST, 'index.html');
    const stat = statSync(idx);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': stat.size });
    createReadStream(idx).pipe(res);
  }
}

createServer((req, res) => {
  const url    = req.url.split('?')[0];
  const method = req.method;

  // ── GET /self/config  (localhost only → return token) ────────────────────
  if (url === '/self/config' && method === 'GET') {
    const ip = req.socket.remoteAddress;
    const ok = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
    if (!ok) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ updateToken: UPDATE_TOKEN }));
  }

  // ── GET /self/version ─────────────────────────────────────────────────────
  if (url === '/self/version' && method === 'GET') {
    let commit = 'unknown';
    try { commit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ commit, uptime: process.uptime() }));
  }

  // ── POST /self/update  (stream output → exit 0 → systemd restarts) ───────
  if (url === '/self/update' && method === 'POST') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    if (token !== UPDATE_TOKEN) { res.writeHead(401); return res.end('Unauthorized'); }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });

    const steps = [
      ['git', ['pull', '--ff-only']],
      ['npm', ['ci', '--prefer-offline', '--no-fund', '--no-audit']],
      ['npm', ['run', 'build']],
    ];

    const run = (i) => {
      if (i >= steps.length) {
        res.write('\n✓ 构建完成，服务即将重启…\n');
        res.end();
        setTimeout(() => process.exit(0), 800);  // systemd/start.sh will restart
        return;
      }
      const [cmd, args] = steps[i];
      res.write(`\n$ ${cmd} ${args.join(' ')}\n`);
      const p = spawn(cmd, args, {
        cwd: __dirname,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      p.stdout.on('data', d => res.write(d));
      p.stderr.on('data', d => res.write(d));
      p.on('close', code => {
        if (code !== 0 && i === 1) {
          // npm ci failed → fallback to npm install
          res.write('fallback: npm install\n');
          const p2 = spawn('npm', ['install', '--no-fund', '--no-audit'], {
            cwd: __dirname,
            env: { ...process.env, FORCE_COLOR: '0' },
          });
          p2.stdout.on('data', d => res.write(d));
          p2.stderr.on('data', d => res.write(d));
          p2.on('close', () => run(i + 1));
        } else if (code !== 0) {
          res.write(`\n✗ 失败 (exit ${code})\n`);
          res.end();
        } else {
          run(i + 1);
        }
      });
    };
    run(0);
    return;
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`[openclaw-ui] http://localhost:${PORT}`);
  console.log(`[openclaw-ui] update token: ${UPDATE_TOKEN}`);
});
