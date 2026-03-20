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
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
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
  console.log(`[openclaw-ui] update token: ${UPDATE_TOKEN}`);
});
