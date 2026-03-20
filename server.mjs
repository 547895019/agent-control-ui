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

// Read GitHub repo from package.json repository field or .git/config
function getRepoSlug() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
    if (pkg.repository?.url) {
      const m = pkg.repository.url.match(/github\.com[/:]([\w-]+\/[\w.-]+?)(?:\.git)?$/);
      if (m) return m[1];
    }
  } catch {}
  try {
    const cfg = readFileSync(join(__dirname, '.git', 'config'), 'utf8');
    const m = cfg.match(/url\s*=\s*https:\/\/github\.com\/([\w-]+\/[\w.-]+?)(?:\.git)?\s*$/m);
    if (m) return m[1];
  } catch {}
  return null;
}

const REPO_SLUG = getRepoSlug();

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

// Download latest source from GitHub tarball and extract (no git needed)
function downloadLatest(write, onDone) {
  if (!REPO_SLUG) {
    write('✗ 无法获取仓库地址，请检查 package.json 或 .git/config\n');
    return onDone(1);
  }
  const url = `https://github.com/${REPO_SLUG}/archive/refs/heads/main.tar.gz`;
  write(`$ 下载最新代码: ${url}\n`);

  // Preserve files that must not be overwritten
  const exclude = [
    '--exclude=*/.git',
    '--exclude=*/node_modules',
    '--exclude=*/dist',
    '--exclude=*/.update-token',
    '--exclude=*/openclaw-ui.pid',
    '--exclude=*/openclaw-ui.log',
    '--exclude=*/start.sh',
    '--exclude=*/stop.sh',
  ];

  const tar = spawn('tar', ['-xz', '--strip-components=1', ...exclude, '-C', __dirname]);
  const curl = spawn('curl', ['-fsSL', '--', url]);

  curl.stdout.pipe(tar.stdin);
  curl.stderr.on('data', d => write(String(d)));
  tar.stderr.on('data', d => write(String(d)));

  let done = false;
  const finish = (code) => { if (!done) { done = true; onDone(code); } };

  curl.on('close', code => { if (code !== 0) { write(`curl exit ${code}\n`); finish(code); } });
  tar.on('close', finish);
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

    const write = (s) => res.write(s);
    const env   = { ...process.env, FORCE_COLOR: '0' };

    // Step runner for npm steps
    const npmSteps = [
      ['npm', ['ci', '--prefer-offline', '--no-fund', '--no-audit']],
      ['npm', ['run', 'build']],
    ];

    const runNpm = (i) => {
      if (i >= npmSteps.length) {
        write('\n✓ 构建完成，服务即将重启…\n');
        res.end();
        setTimeout(() => process.exit(0), 800);
        return;
      }
      const [cmd, args] = npmSteps[i];
      write(`\n$ ${cmd} ${args.join(' ')}\n`);
      const p = spawn(cmd, args, { cwd: __dirname, env });
      p.stdout.on('data', d => write(d));
      p.stderr.on('data', d => write(d));
      p.on('close', code => {
        if (code !== 0 && i === 0) {
          write('fallback: npm install\n');
          const p2 = spawn('npm', ['install', '--no-fund', '--no-audit'], { cwd: __dirname, env });
          p2.stdout.on('data', d => write(d));
          p2.stderr.on('data', d => write(d));
          p2.on('close', () => runNpm(i + 1));
        } else if (code !== 0) {
          write(`\n✗ 失败 (exit ${code})\n`);
          res.end();
        } else {
          runNpm(i + 1);
        }
      });
    };

    // 1. Download → 2. npm ci → 3. npm run build
    downloadLatest(write, (code) => {
      if (code !== 0) { write(`\n✗ 下载失败 (exit ${code})\n`); res.end(); return; }
      write('✓ 下载完成\n');
      runNpm(0);
    });

    return;
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`[openclaw-ui] http://localhost:${PORT}`);
  console.log(`[openclaw-ui] update token: ${UPDATE_TOKEN}`);
});
