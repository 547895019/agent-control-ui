import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import {
  Bot, ScrollText, LogOut, Building2, Clock, BarChart2, Puzzle, MessageSquare,
  WifiOff, RefreshCw, AlertCircle, Loader2, Zap, Users, ArrowUpCircle, X, RotateCcw,
  ChevronLeft, ChevronRight, Maximize2, Minimize2,
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

function StatusDotCompact({ status }: { status: string }) {
  const cls = status === 'connected' ? 'bg-emerald-400' : status === 'connecting' || status === 'reconnecting' ? 'bg-amber-400' : status === 'failed' ? 'bg-red-400' : 'bg-white/20';
  const title = status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting' : status === 'reconnecting' ? 'Reconnecting' : status === 'failed' ? 'Failed' : 'Disconnected';
  return <span className={`w-2 h-2 rounded-full ${cls} ${status === 'connected' ? 'animate-pulse' : ''}`} title={title} />;
}

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
  const [serverVersion, setServerVersion] = useState('');
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
      .then(d => d && setServerVersion(d.version))
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
            {serverVersion && (
              <p className="text-white/35 text-xs font-mono mt-0.5">当前版本：v{serverVersion}</p>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('openclaw:sidebar:collapsed') === '1'
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [serverVersion, setServerVersion] = useState(APP_VERSION);

  useEffect(() => {
    fetch('/self/version')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.version) setServerVersion(d.version); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(v => {
      const next = !v;
      localStorage.setItem('openclaw:sidebar:collapsed', next ? '1' : '0');
      return next;
    });
  };

  return (
    <div className="h-screen flex relative overflow-hidden" style={{ background: 'linear-gradient(140deg, #1c1040 0%, #111830 25%, #1a0d36 52%, #0f1828 76%, #160e3c 100%)' }}>
      {/* Layered colorful blobs — different opacities for depth & refraction */}
      <div className="pointer-events-none">
        {/* Layer 1 — large base orbs */}
        <div className="orb w-[900px] h-[900px] -top-96 -left-64"   style={{ background: 'rgba(150,  80, 230, 0.42)' }} />
        <div className="orb w-[780px] h-[780px] top-1/2  -right-52" style={{ background: 'rgba( 30, 140, 255, 0.30)' }} />
        {/* Layer 2 — mid-size blobs, different hues, shifted positions */}
        <div className="orb w-[580px] h-[580px] -bottom-52 left-1/4"  style={{ background: 'rgba( 60, 200, 160, 0.26)' }} />
        <div className="orb w-[480px] h-[480px] top-1/3   left-[55%]" style={{ background: 'rgba(230,  70, 160, 0.22)' }} />
        {/* Layer 3 — small accent orbs, high-chroma */}
        <div className="orb w-[300px] h-[300px] top-[8%]   right-[28%]" style={{ background: 'rgba(  0, 220, 200, 0.18)' }} />
        <div className="orb w-[260px] h-[260px] bottom-[20%] right-[8%]" style={{ background: 'rgba(255, 160,  50, 0.14)' }} />
        <div className="orb w-[220px] h-[220px] top-[60%]  left-[10%]"  style={{ background: 'rgba(180,  60, 255, 0.18)' }} />
        {/* Layer 4 — tiny sparkle highlights */}
        <div className="orb w-[140px] h-[140px] top-[15%]  left-[38%]" style={{ background: 'rgba(255, 240, 120, 0.12)' }} />
        <div className="orb w-[120px] h-[120px] bottom-[35%] left-[62%]" style={{ background: 'rgba(120, 255, 200, 0.10)' }} />
      </div>

      {/* Sidebar */}
      <aside
        className={`relative z-10 shrink-0 backdrop-blur-2xl border-r border-white/15 flex flex-col transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-56'}`}
        style={{
          background: 'linear-gradient(180deg, rgba(18,9,52,0.82) 0%, rgba(13,6,38,0.78) 100%)',
          boxShadow: '4px 0 32px rgba(60,20,140,0.22), inset -1px 0 0 rgba(255,255,255,0.08)',
        }}
      >
        {/* Brand */}
        <div className={`border-b border-white/10 flex items-center ${sidebarCollapsed ? 'justify-center py-4 px-0' : 'px-4 py-4'}`}>
          {!sidebarCollapsed && editingBrand ? (
            <div className="px-1 w-full">
              <BrandEditor
                title={title} subtitle={subtitle}
                onSave={(t, s) => { setTitle(t); setSubtitle(s); setEditingBrand(false); }}
                onCancel={() => setEditingBrand(false)}
              />
            </div>
          ) : (
            <button
              onClick={sidebarCollapsed ? undefined : () => setEditingBrand(true)}
              className={`flex items-center text-left rounded-lg transition-colors ${sidebarCollapsed ? 'cursor-default' : 'gap-2.5 w-full px-1 py-0.5 hover:bg-white/10'}`}
              title={sidebarCollapsed ? title : '点击编辑名称'}
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-600/80 backdrop-blur-sm flex items-center justify-center text-base shrink-0 shadow-lg shadow-indigo-900/50">
                🦞
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <p className="gradient-text font-semibold text-sm leading-tight truncate">{title}</p>
                  {subtitle && <p className="text-white/35 text-xs truncate tracking-wide">{subtitle}</p>}
                </div>
              )}
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className={`flex-1 ${sidebarCollapsed ? 'px-2' : 'px-3'} py-4 space-y-0.5`}>
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = location.pathname.startsWith(path);
            return (
              <Link
                key={path}
                to={path}
                title={sidebarCollapsed ? label : undefined}
                className={`flex items-center py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3'
                } ${active
                  ? 'btn-primary text-white shadow-lg shadow-white/20'
                  : 'text-white/70 hover:text-white hover:bg-white/15 hover:shadow-[0_0_12px_rgba(255,255,255,0.12)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`${sidebarCollapsed ? 'px-2' : 'px-3'} pb-3 space-y-1 border-t border-white/10 pt-3`}>
          {sidebarCollapsed ? (
            /* Icon-only footer */
            <div className="flex flex-col items-center gap-1">
              <StatusDotCompact status={connectionStatus} />
              <button onClick={disconnect} title="Disconnect" className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/15 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
              <button onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏显示'} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-300 hover:bg-indigo-500/20 transition-colors">
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setShowUpdate(true)} title="更新版本" className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-300 hover:bg-indigo-500/20 transition-colors">
                <ArrowUpCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            /* Full footer */
            <>
              <div className="px-3 py-1.5">
                <StatusDot status={connectionStatus} />
              </div>
              <button onClick={disconnect} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/15 transition-colors">
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
              <div className="px-3 pt-1 flex items-center justify-between">
                <span className="text-[10px] text-white/20 font-mono">v{serverVersion}</span>
                <div className="flex items-center gap-1">
                  <button onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏显示'} className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-indigo-300 hover:bg-indigo-500/20 transition-colors">
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => setShowUpdate(true)} title="更新版本" className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-indigo-300 hover:bg-indigo-500/20 transition-colors">
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
          {/* Collapse toggle */}
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            className={`w-full flex items-center py-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/8 transition-colors text-xs ${sidebarCollapsed ? 'justify-center' : 'gap-2 px-3'}`}
          >
            {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <><ChevronLeft className="w-3.5 h-3.5" /><span>折叠</span></>}
          </button>
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
