#!/usr/bin/env node
/**
 * openclaw-ui CLI
 * Usage:
 *   openclaw-ui               # start server
 *   openclaw-ui install       # register systemd service + start
 *   openclaw-ui update        # npm install -g latest + restart service
 *   openclaw-ui uninstall     # remove systemd service
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

const ROOT    = fileURLToPath(new URL('..', import.meta.url));
const SERVICE = 'openclaw-ui';
const PORT    = process.env.PORT || 8080;
const cmd     = process.argv[2];

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', N = '\x1b[0m';
const log  = (m) => console.log(`${G}[openclaw-ui]${N} ${m}`);
const warn = (m) => console.log(`${Y}[warn]${N} ${m}`);
const err  = (m) => { console.error(`${R}[error]${N} ${m}`); process.exit(1); };

switch (cmd) {
  // ── start (default) ─────────────────────────────────────────────────────────
  case 'start':
  case undefined: {
    // Dynamic import so server.mjs runs in the same process
    import(join(ROOT, 'server.mjs')).catch(e => { console.error(e); process.exit(1); });
    break;
  }

  // ── install ─────────────────────────────────────────────────────────────────
  case 'install': {
    const { existsSync } = await import('node:fs');
    if (!existsSync('/etc/systemd/system')) {
      err('systemd not found. Run manually: openclaw-ui start');
    }

    const nodeBin = process.execPath;
    const cliBin  = fileURLToPath(import.meta.url);

    const unit = `[Unit]
Description=OpenClaw Agent Control UI
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${cliBin} start
Restart=always
RestartSec=3
Environment=PORT=${PORT}

[Install]
WantedBy=multi-user.target
`;
    const tmpFile = `/tmp/${SERVICE}.service`;
    writeFileSync(tmpFile, unit);

    spawnSync('sudo', ['cp', tmpFile, `/etc/systemd/system/${SERVICE}.service`], { stdio: 'inherit' });
    try { unlinkSync(tmpFile); } catch {}
    spawnSync('sudo', ['systemctl', 'daemon-reload'],       { stdio: 'inherit' });
    spawnSync('sudo', ['systemctl', 'enable',  SERVICE],    { stdio: 'inherit' });
    spawnSync('sudo', ['systemctl', 'restart', SERVICE],    { stdio: 'inherit' });

    log(`Service installed and started!`);
    log(`  URL    : http://localhost:${PORT}`);
    log(`  Status : sudo systemctl status ${SERVICE}`);
    log(`  Logs   : sudo journalctl -u ${SERVICE} -f`);
    break;
  }

  // ── update ──────────────────────────────────────────────────────────────────
  case 'update': {
    const pkg = JSON.parse((await import('node:fs')).readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const repo   = (pkg.repository?.url || '').replace(/^(git\+)?https:\/\/github\.com\//, '').replace(/\.git$/, '');
    const tgzUrl = repo ? `https://github.com/${repo}/releases/latest/download/${pkg.name}.tgz` : null;

    if (repo) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${repo}/main/package.json`;
        const latest = await fetch(rawUrl).then(r => r.json());
        if (latest.version === pkg.version) {
          log(`Already at latest version (${pkg.version}), no update needed.`);
          break;
        }
        log(`Updating ${pkg.version} → ${latest.version}...`);
      } catch {
        log('Cannot check latest version, proceeding...');
      }
    }

    const installTarget = tgzUrl || pkg.name;
    const r = spawnSync('npm', ['install', '-g', installTarget, '--no-fund', '--no-audit'], { stdio: 'inherit' });
    if (r.status !== 0) err('npm install failed');

    const hasSystemd = spawnSync('systemctl', ['is-active', '--quiet', SERVICE]).status === 0;
    if (hasSystemd) {
      spawnSync('sudo', ['systemctl', 'restart', SERVICE], { stdio: 'inherit' });
      log('Service restarted with new version.');
    } else {
      warn('Service not found via systemd. Restart manually.');
    }
    break;
  }

  // ── uninstall ────────────────────────────────────────────────────────────────
  case 'uninstall': {
    spawnSync('sudo', ['systemctl', 'stop',    SERVICE], { stdio: 'inherit' });
    spawnSync('sudo', ['systemctl', 'disable', SERVICE], { stdio: 'inherit' });
    spawnSync('sudo', ['rm', '-f', `/etc/systemd/system/${SERVICE}.service`], { stdio: 'inherit' });
    spawnSync('sudo', ['systemctl', 'daemon-reload'], { stdio: 'inherit' });
    log('Service removed.');
    break;
  }

  default:
    console.log(`
OpenClaw Agent Control UI

Usage:
  openclaw-ui [command]

Commands:
  start      Start the server (default, PORT env to customize)
  install    Register systemd service and start
  update     Update to latest version via npm
  uninstall  Remove systemd service

Environment:
  PORT       Server port (default: 8080)

Examples:
  sudo npm install -g agent-control-ui
  openclaw-ui install
  openclaw-ui update
`);
}
