import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const PORT = 19876;

function resolvePath(raw) {
  return raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // List directory: GET /?dir=path
  if (req.method === 'GET' && url.searchParams.has('dir')) {
    const dirPath = resolvePath(url.searchParams.get('dir') ?? '');
    try {
      const entries = readdirSync(dirPath);
      const files = entries.filter(e => {
        try { return statSync(join(dirPath, e)).isFile(); } catch { return false; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
    } catch (e) {
      const missing = e.code === 'ENOENT';
      res.writeHead(missing ? 404 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, missing, files: [] }));
    }
    return;
  }

  const filePath = resolvePath(url.searchParams.get('path') ?? '');

  if (req.method === 'GET') {
    try {
      const content = readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content }));
    } catch (e) {
      const missing = e.code === 'ENOENT';
      res.writeHead(missing ? 404 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, missing }));
    }
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf-8');
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
    // Delete directory: DELETE /?dir=path
    if (url.searchParams.has('dir')) {
      const dirPath = resolvePath(url.searchParams.get('dir') ?? '');
      try {
        rmSync(dirPath, { recursive: true, force: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    // Delete file: DELETE /?path=path
    try {
      unlinkSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(405); res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[localfile-server] http://0.0.0.0:${PORT}`);
});
