import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import {
  Bot, FileCode2, Activity, LogOut, Building2,
  WifiOff, RefreshCw, AlertCircle, Loader2
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/org', label: '组织', icon: Building2 },
  { path: '/editor', label: 'Editor', icon: FileCode2 },
  { path: '/monitor', label: 'Monitor', icon: Activity },
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
  const currentPage = location.pathname.split('/')[1] || 'dashboard';

  return (
    <div className="h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 flex flex-col shrink-0">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-base">
              🦞
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">OpenClaw</p>
              <p className="text-slate-500 text-xs">Control Panel</p>
            </div>
          </div>
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
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-12 border-b border-slate-200 bg-white flex items-center px-6 shrink-0 gap-2">
          <span className="text-slate-400 text-sm">/</span>
          <span className="text-slate-700 text-sm font-medium capitalize">{currentPage}</span>
          {connectionStatus !== 'connected' && (
            <div className="ml-auto">
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                Gateway offline
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
