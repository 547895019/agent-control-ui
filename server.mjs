#!/usr/bin/env node
/**
 * OpenClaw UI — production static server + self-update endpoint
 * Replaces `npx serve` so the process can rebuild and restart itself.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT   = Number(process.env.PORT) || 8080;
const DIST   = join(__dirname, 'dist');

// Generate a fresh token on each startup — frontend fetches it via /self/config
const UPDATE_TOKEN = randomBytes(24).toString('hex');

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
    const ext  = extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    // HTML entry point must never be cached — it embeds hashed asset filenames.
    // Hashed assets (*.js, *.css with content hash in name) are safe to cache forever.
    const cacheControl = ext === '.html'
      ? 'no-store'
      : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': cacheControl });
    createReadStream(filePath).pipe(res);
  } catch {
    // SPA fallback — always serve fresh index.html
    const idx = join(DIST, 'index.html');
    const stat = statSync(idx);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
    createReadStream(idx).pipe(res);
  }
}


// Start localfile-server as a child process (production companion)
const localFileSrv = spawn(process.execPath, [join(__dirname, 'localfile-server.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, LOCALFILE_PORT: '19876' },
});
localFileSrv.on('error', (e) => console.error('[localfile-server] failed to start:', e.message));
process.on('exit', () => { try { localFileSrv.kill(); } catch {} });

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
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ version: pkg.version, uptime: process.uptime() }));
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

    const write = (s) => res.write(s);
    const env   = { ...process.env, FORCE_COLOR: '0' };
    const pkg   = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

    const repo    = (pkg.repository?.url || '').replace(/^(git\+)?https:\/\/github\.com\//, '').replace(/\.git$/, '');
    const tgzUrl  = repo
      ? `https://github.com/${repo}/releases/latest/download/${pkg.name}.tgz`
      : null;

    (async () => {
      // Check latest version before installing
      if (repo) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${repo}/main/package.json`;
          const latest = await fetch(rawUrl).then(r => r.json());
          if (latest.version === pkg.version) {
            write(`✓ 已是最新版本 (${pkg.version})，无需更新。\n`);
            res.end();
            return;
          }
          write(`当前版本：${pkg.version} → 最新版本：${latest.version}\n`);
        } catch {
          write('（无法检查最新版本，继续安装…）\n');
        }
      }

      // Install from GitHub release tarball (fixed URL, always latest)
      const installTarget = tgzUrl || pkg.name;
      write(`$ npm install -g ${installTarget}\n`);
      const p = spawn('npm', ['install', '-g', installTarget, '--no-fund', '--no-audit'], { env });
      p.stdout.on('data', d => write(d));
      p.stderr.on('data', d => write(d));
      p.on('close', code => {
        if (code !== 0) { write(`\n✗ 失败 (exit ${code})\n`); res.end(); return; }
        write('\n✓ 安装完成，服务即将重启…\n');
        res.end();
        const restarter = spawn('bash', ['-c',
          `sleep 1 && systemctl restart openclaw-ui 2>/dev/null || bash "${join(__dirname, 'start.sh')}" 2>/dev/null`
        ], { detached: true, stdio: 'ignore' });
        restarter.unref();
        setTimeout(() => process.exit(0), 800);
      });
    })();

    return;
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`[openclaw-ui] http://localhost:${PORT}`);
  console.log(`[openclaw-ui] started (update token: ${UPDATE_TOKEN.slice(0, 4)}****)`);
});
