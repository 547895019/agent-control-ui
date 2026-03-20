import React, { useState, useRef, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import {
  Bot, ScrollText, LogOut, Building2, Clock, BarChart2, Puzzle, MessageSquare,
  WifiOff, RefreshCw, AlertCircle, Loader2, Zap,
} from 'lucide-react';

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

export function DashboardLayout() {
  const location = useLocation();
  const { connectionStatus, disconnect } = useAppStore();
  const { title, subtitle, setTitle, setSubtitle } = useBrand();
  const [editingBrand, setEditingBrand] = useState(false);

  return (
    <div className="h-screen flex relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 30%, #c026d3 60%, #db2777 85%, #f97316 100%)' }}>
      {/* Background grid */}
      <div className="absolute inset-0 bg-grid pointer-events-none" />

      {/* Decorative colour orbs — vibrant & bright */}
      <div className="pointer-events-none">
        <div className="orb w-[700px] h-[700px] -top-64 -left-48" style={{ background: 'rgba(139,92,246,0.55)' }} />
        <div className="orb w-[600px] h-[600px] top-1/2 -right-40" style={{ background: 'rgba(236,72,153,0.45)' }} />
        <div className="orb w-[500px] h-[500px] -bottom-48 left-1/4" style={{ background: 'rgba(6,182,212,0.35)' }} />
        <div className="orb w-[400px] h-[400px] top-1/4 left-1/2" style={{ background: 'rgba(251,191,36,0.22)' }} />
        <div className="orb w-[350px] h-[350px] top-0 right-1/3" style={{ background: 'rgba(52,211,153,0.20)' }} />
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
          <p className="px-3 pt-1 text-[10px] text-white/20 font-mono">v{__BUILD_DATE__}</p>
        </div>
      </aside>

      {/* Main */}
      <main className="relative z-10 flex-1 overflow-hidden flex flex-col min-w-0">
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
