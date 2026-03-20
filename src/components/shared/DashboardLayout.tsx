import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import {
  Bot, ScrollText, LogOut, Building2, Clock, BarChart2, Puzzle, MessageSquare,
  WifiOff, RefreshCw, AlertCircle, Loader2, Zap, Users, ArrowUpCircle, X, RotateCcw,
} from 'lucide-react';

// Safe accessor — older builds may not have __APP_VERSION__ substituted by Vite
const APP_VERSION: string = (() => {
  try { return __APP_VERSION__; } catch { return __BUILD_DATE__; }
})();

const BRAND_KEY = 'openclaw:brand';
const DEFAULT_TITLE = 'OpenClaw';
const DEFAULT_SUBTITLE = 'Control Panel';

function useBrand() {
  const [title, setTitleRaw] = useState(() => localStorage.getItem(BRAND_KEY + ':title') ?? DEFAULT_TITLE);
  const [subtitle, setSubtitleRaw] = useState(() => localStorage.getItem(BRAND_KEY + ':subtitle') ?? DEFAULT_SUBTITLE);
  const setTitle = (v: string) => { setTitleRaw(v); localStorage.setItem(BRAND_KEY + ':title', v); };
  const setSubtitle = (v: string) => { setSubtitleRaw(v); localStorage.setItem(BRAND_KEY + ':subtitle', v); };
  return { title, subtitle, setTitle, setSubtitle };
}

function BrandEditor({ title, subtitle, onSave, onCancel }: {
  title: string; subtitle: string;
  onSave: (t: string, s: string) => void;
  onCancel: () => void;
}) {
  const [t, setT] = useState(title);
  const [s, setS] = useState(subtitle);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSave(t.trim() || DEFAULT_TITLE, s.trim()); }}
      className="space-y-1.5"
    >
      <input
        ref={ref}
        value={t}
        onChange={e => setT(e.target.value)}
        className="w-full bg-white/10 border border-white/20 text-white text-sm font-semibold px-2 py-1 rounded focus:outline-none focus:border-indigo-400 backdrop-blur-sm placeholder:text-white/30"
        placeholder="名称"
      />
      <input
        value={s}
        onChange={e => setS(e.target.value)}
        className="w-full bg-white/10 border border-white/20 text-white/70 text-xs px-2 py-1 rounded focus:outline-none focus:border-indigo-400 backdrop-blur-sm placeholder:text-white/30"
        placeholder="副标题"
      />
      <div className="flex gap-1 pt-0.5">
        <button type="submit" className="flex-1 py-1 text-xs bg-indigo-600/80 hover:bg-indigo-500/80 text-white rounded transition-colors backdrop-blur-sm">保存</button>
        <button type="button" onClick={onCancel} className="flex-1 py-1 text-xs bg-white/10 hover:bg-white/15 text-white/70 rounded transition-colors">取消</button>
      </div>
    </form>
  );
}

const NAV_ITEMS = [
  { path: '/agents', label: '代理', icon: Bot },
  { path: '/org', label: '组织', icon: Building2 },
  { path: '/cron', label: '定时', icon: Clock },
  { path: '/monitor', label: '日志', icon: ScrollText },
  { path: '/usage', label: '用量', icon: BarChart2 },
  { path: '/skills', label: '技能', icon: Puzzle },
  { path: '/channels',    label: '频道', icon: MessageSquare },
  { path: '/meeting',     label: '会议', icon: Users },
  { path: '/automation',  label: '自动化', icon: Zap },
];

function StatusDot({ status }: { status: string }) {
  if (status === 'connected') return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      Connected
    </span>
  );
  if (status === 'connecting') return (
    <span className="flex items-center gap-1.5 text-xs text-amber-400">
      <Loader2 className="w-3 h-3 animate-spin" />
      Connecting
    </span>
  );
  if (status === 'reconnecting') return (
    <span className="flex items-center gap-1.5 text-xs text-orange-400">
      <RefreshCw className="w-3 h-3 animate-spin" />
      Reconnecting
    </span>
  );
  if (status === 'failed') return (
    <span className="flex items-center gap-1.5 text-xs text-red-400">
      <AlertCircle className="w-3 h-3" />
      Failed
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs text-white/30">
      <WifiOff className="w-3 h-3" />
      Disconnected
    </span>
  );
}

// ── UpdateModal ───────────────────────────────────────────────────────────────

type UpdateStatus = 'idle' | 'updating' | 'restarting' | 'done' | 'error' | 'unsupported';

function UpdateModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus]   = useState<UpdateStatus>('idle');
  const [output, setOutput]   = useState('');
  const [token, setToken]     = useState<string | null>(null);
  const [commit, setCommit]   = useState('');
  const outputRef             = useRef<HTMLPreElement>(null);

  // Fetch update token + current version on mount
  useEffect(() => {
    fetch('/self/config')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setToken(d.updateToken))
      .catch(e => {
        if (e === 403) setStatus('unsupported'); // remote access
        else           setStatus('unsupported'); // static hosting / no server.mjs
      });

    fetch('/self/version')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setCommit(d.commit))
      .catch(() => {});
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  const startUpdate = useCallback(async () => {
    if (!token) return;
    setStatus('updating');
    setOutput('');

    try {
      const res = await fetch('/self/update', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) { setStatus('error'); setOutput(`HTTP ${res.status}`); return; }

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let buf      = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        setOutput(buf);
      }

      // Already latest — no restart needed
      if (buf.includes('已是最新版本')) {
        setStatus('done');
        return;
      }

      // Stream closed — server exited to restart
      setStatus('restarting');
      setOutput(prev => prev + '\n正在等待服务重启…\n');

      // Poll until server is back
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch('/self/version');
          if (r.ok) {
            clearInterval(poll);
            setStatus('done');
            setOutput(prev => prev + '✓ 服务已重启，请刷新页面。\n');
          }
        } catch {}
        if (attempts >= 30) {
          clearInterval(poll);
          setStatus('error');
          setOutput(prev => prev + '✗ 等待超时，请手动刷新。\n');
        }
      }, 2000);

    } catch (err: any) {
      setStatus('error');
      setOutput(String(err));
    }
  }, [token]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg glass-heavy rounded-2xl border border-white/15 shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <ArrowUpCircle className="w-5 h-5 text-indigo-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">更新版本</p>
            {commit && (
              <p className="text-white/35 text-xs font-mono mt-0.5">当前：v{APP_VERSION} · {commit}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {status === 'unsupported' && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-400/20 px-4 py-3 text-sm text-amber-300">
              此功能需要通过 <code className="font-mono text-amber-200">server.mjs</code> 启动服务，
              静态托管或远程访问模式不支持在线更新。<br />
              请在服务器上运行 <code className="font-mono text-amber-200">./update.sh</code>。
            </div>
          )}

          {status === 'idle' && token && (
            <p className="text-sm text-white/60">
              将拉取最新代码并重新构建，完成后服务自动重启。
            </p>
          )}

          {status === 'idle' && !token && status !== 'unsupported' as UpdateStatus && (
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> 正在连接…
            </div>
          )}

          {(output || status === 'updating' || status === 'restarting') && (
            <pre
              ref={outputRef}
              className="h-56 overflow-y-auto rounded-xl bg-black/40 border border-white/8 p-3 text-[11px] text-white/70 font-mono whitespace-pre-wrap leading-relaxed"
            >
              {output || ' '}
              {(status === 'updating' || status === 'restarting') && (
                <span className="inline-block w-1.5 h-3 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
              )}
            </pre>
          )}

          {status === 'restarting' && (
            <div className="flex items-center gap-2 text-indigo-300 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> 等待服务重启…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex items-center gap-2 justify-end">
          {status === 'done' && (
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white btn-primary shadow-lg"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              刷新页面
            </button>
          )}
          {status === 'idle' && token && (
            <button
              onClick={startUpdate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white btn-primary shadow-lg"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              开始更新
            </button>
          )}
          {(status === 'done' || status === 'error' || status === 'unsupported') && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-white/60 hover:text-white btn-secondary transition-colors"
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DashboardLayout ───────────────────────────────────────────────────────────

export function DashboardLayout() {
  const location = useLocation();
  const { connectionStatus, disconnect } = useAppStore();
  const { title, subtitle, setTitle, setSubtitle } = useBrand();
  const [editingBrand, setEditingBrand] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);

  return (
    <div className="h-screen flex relative overflow-hidden" style={{ background: 'radial-gradient(ellipse at 20% 50%, #351c7a 0%, #17103c 55%, #112438 100%)' }}>
      {/* Neon glow orbs */}
      <div className="pointer-events-none">
        <div className="orb w-[750px] h-[750px] -top-72 -left-52" style={{ background: 'rgba(168,85,247,0.50)' }} />
        <div className="orb w-[620px] h-[620px] top-1/2 -right-44" style={{ background: 'rgba(0,200,255,0.28)' }} />
        <div className="orb w-[520px] h-[520px] -bottom-56 left-1/4" style={{ background: 'rgba(59,130,246,0.32)' }} />
        <div className="orb w-[380px] h-[380px] top-1/4 left-1/2" style={{ background: 'rgba(139,92,246,0.28)' }} />
        <div className="orb w-[300px] h-[300px] top-0 right-1/3" style={{ background: 'rgba(0,255,170,0.12)' }} />
      </div>

      {/* Sidebar */}
      <aside className="relative z-10 w-56 backdrop-blur-2xl border-r border-white/20 flex flex-col shrink-0" style={{ background: 'rgba(255,255,255,0.10)' }}>
        {/* Brand */}
        <div className="px-4 py-4 border-b border-white/10">
          {editingBrand ? (
            <div className="px-1">
              <BrandEditor
                title={title}
                subtitle={subtitle}
                onSave={(t, s) => { setTitle(t); setSubtitle(s); setEditingBrand(false); }}
                onCancel={() => setEditingBrand(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setEditingBrand(true)}
              className="w-full flex items-center gap-2.5 text-left group rounded-lg px-1 py-0.5 hover:bg-white/10 transition-colors"
              title="点击编辑名称"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-600/80 backdrop-blur-sm flex items-center justify-center text-base shrink-0 shadow-lg shadow-indigo-900/50">
                🦞
              </div>
              <div className="min-w-0">
                <p className="gradient-text font-semibold text-sm leading-tight truncate">{title}</p>
                {subtitle && <p className="text-white/35 text-xs truncate tracking-wide">{subtitle}</p>}
              </div>
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = location.pathname.startsWith(path);
            return (
              <Link
                key={path}
                to={path}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                  ${active
                    ? 'btn-primary text-white shadow-lg shadow-white/20'
                    : 'text-white/70 hover:text-white hover:bg-white/15 hover:shadow-[0_0_12px_rgba(255,255,255,0.12)]'}
                `}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-4 space-y-1 border-t border-white/10 pt-3">
          <div className="px-3 py-1.5">
            <StatusDot status={connectionStatus} />
          </div>
          <button
            onClick={disconnect}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/15 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>
          <div className="px-3 pt-1 flex items-center justify-between">
            <span className="text-[10px] text-white/20 font-mono">v{APP_VERSION}</span>
            <button
              onClick={() => setShowUpdate(true)}
              title="更新版本"
              className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-indigo-300 hover:bg-indigo-500/20 transition-colors"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="relative z-10 flex-1 overflow-hidden flex flex-col min-w-0">
        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
      </main>

      {showUpdate && <UpdateModal onClose={() => setShowUpdate(false)} />}
    </div>
  );
}
