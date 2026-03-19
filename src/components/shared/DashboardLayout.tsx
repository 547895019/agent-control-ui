import React, { useState, useRef, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import {
  Bot, ScrollText, LogOut, Building2, Clock,
  WifiOff, RefreshCw, AlertCircle, Loader2
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
        className="w-full bg-slate-800 border border-slate-600 text-white text-sm font-semibold px-2 py-1 rounded focus:outline-none focus:border-indigo-500"
        placeholder="名称"
      />
      <input
        value={s}
        onChange={e => setS(e.target.value)}
        className="w-full bg-slate-800 border border-slate-600 text-slate-400 text-xs px-2 py-1 rounded focus:outline-none focus:border-indigo-500"
        placeholder="副标题"
      />
      <div className="flex gap-1 pt-0.5">
        <button type="submit" className="flex-1 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors">保存</button>
        <button type="button" onClick={onCancel} className="flex-1 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">取消</button>
      </div>
    </form>
  );
}

const NAV_ITEMS = [
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/org', label: '组织', icon: Building2 },
  { path: '/cron', label: '定时', icon: Clock },
  { path: '/monitor', label: '日志', icon: ScrollText },
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
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
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
    <div className="h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 flex flex-col shrink-0">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-slate-800">
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
              className="w-full flex items-center gap-2.5 text-left group rounded-lg px-1 py-0.5 hover:bg-slate-800 transition-colors"
              title="点击编辑名称"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-base shrink-0">
                🦞
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm leading-tight truncate">{title}</p>
                {subtitle && <p className="text-slate-500 text-xs truncate">{subtitle}</p>}
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
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}
                `}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-4 space-y-1 border-t border-slate-800 pt-3">
          <div className="px-3 py-1.5">
            <StatusDot status={connectionStatus} />
          </div>
          <button
            onClick={disconnect}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>
          <p className="px-3 pt-1 text-[10px] text-slate-600 font-mono">v{__BUILD_DATE__}</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
