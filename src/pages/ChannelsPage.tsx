import React, { useEffect, useState, useCallback } from 'react';
import { client } from '../api/gateway';
import {
  RefreshCw, Loader2, AlertCircle, CheckCircle2, XCircle,
  Link as LinkIcon, Unlink,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChannelAccountSnapshot {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  lastConnectedAt?: number;
  lastError?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  probe?: any;
  // WhatsApp
  authAgeMs?: number;
  lastMessageAt?: number;
  // Telegram
  mode?: string;
  lastStartAt?: number;
  lastProbeAt?: number;
}

interface ChannelsStatusSnapshot {
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  channelMeta?: Record<string, { order?: number; label?: string; [key: string]: any }>;
  channels?: Record<string, any>;
  channelAccounts?: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId?: Record<string, string>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FALLBACK_ORDER = [
  'whatsapp', 'telegram', 'discord', 'slack', 'signal',
  'googlechat', 'imessage', 'nostr', 'email', 'sms',
];

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '📱', telegram: '✈️', discord: '🎮', slack: '💼', signal: '🔒',
  googlechat: '💬', imessage: '🍎', nostr: '⚡', email: '📧', sms: '📲',
};

const CHANNEL_LABELS_DEFAULT: Record<string, string> = {
  whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord',
  slack: 'Slack', signal: 'Signal', googlechat: 'Google Chat',
  imessage: 'iMessage', nostr: 'Nostr', email: 'Email', sms: 'SMS',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function channelEnabled(status: any, accounts: ChannelAccountSnapshot[]): boolean {
  if (status?.configured || status?.running || status?.connected || status?.linked) return true;
  if (accounts?.some(a => a.configured || a.running || a.connected || a.linked)) return true;
  return false;
}

function formatRelTime(ms?: number): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function resolveChannelOrder(snap: ChannelsStatusSnapshot): string[] {
  const channelIds = new Set([
    ...(snap.channelOrder ?? []),
    ...Object.keys(snap.channels ?? {}),
    ...Object.keys(snap.channelAccounts ?? {}),
  ]);

  // Sort by channelMeta.order if available
  if (snap.channelMeta) {
    const metaEntries = Object.entries(snap.channelMeta);
    const hasOrder = metaEntries.some(([, m]) => m?.order !== undefined);
    if (hasOrder) {
      const sorted = metaEntries
        .sort(([, a], [, b]) => (a?.order ?? 99) - (b?.order ?? 99))
        .map(([id]) => id);
      return [...new Set([...sorted, ...FALLBACK_ORDER, ...channelIds])];
    }
  }

  if (snap.channelOrder?.length) {
    return [...new Set([...snap.channelOrder, ...FALLBACK_ORDER, ...channelIds])];
  }

  return [...new Set([...FALLBACK_ORDER, ...channelIds])];
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean | undefined | null; label: string }) {
  if (ok === undefined || ok === null) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border ${
      ok
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-slate-100 text-slate-400 border-slate-200'
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="break-all">{msg}</span>
    </div>
  );
}

// WhatsApp Card with QR login flow
function WhatsAppCard({ channelId, status, accounts, label, onRefresh }: {
  channelId: string;
  status: any;
  accounts: ChannelAccountSnapshot[];
  label: string;
  onRefresh: () => void;
}) {
  const [qrLoading, setQrLoading] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [waitLoading, setWaitLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const s = status || accounts[0] || {};

  const handleShowQR = async (force = false) => {
    setQrLoading(true);
    setActionError(null);
    try {
      const res: any = await client.webLoginStart({ force, timeoutMs: 30000 });
      const qr = res?.qr || res?.qrCode || res?.qrDataUrl || null;
      if (qr) {
        setQrData(qr);
      } else {
        setActionError('未获得二维码数据，请重试');
      }
    } catch (e: any) {
      setActionError(e.message || '获取二维码失败');
    } finally {
      setQrLoading(false);
    }
  };

  const handleWaitScan = async () => {
    setWaitLoading(true);
    setActionError(null);
    try {
      await client.webLoginWait({ timeoutMs: 60000 });
      setQrData(null);
      onRefresh();
    } catch (e: any) {
      setActionError(e.message || '等待扫码超时');
    } finally {
      setWaitLoading(false);
    }
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    setActionError(null);
    try {
      await client.channelsLogout({ channel: channelId });
      setQrData(null);
      onRefresh();
    } catch (e: any) {
      setActionError(e.message || '登出失败');
    } finally {
      setLogoutLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">📱</span>
          <h3 className="font-semibold text-slate-800 text-sm">{label}</h3>
        </div>
        <button
          onClick={onRefresh}
          title="刷新"
          className="text-slate-400 hover:text-slate-600 p-1 rounded transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatusBadge ok={s.configured} label="已配置" />
        <StatusBadge ok={s.linked} label="已绑定" />
        <StatusBadge ok={s.running} label="运行中" />
        <StatusBadge ok={s.connected} label="已连接" />
      </div>

      {s.lastConnectedAt ? (
        <p className="text-xs text-slate-500">最后连接: {formatRelTime(s.lastConnectedAt)}</p>
      ) : null}
      {s.lastMessageAt ? (
        <p className="text-xs text-slate-500">最后消息: {formatRelTime(s.lastMessageAt)}</p>
      ) : null}

      {qrData && (
        <div className="flex flex-col items-center gap-2 py-3 bg-slate-50 border border-slate-200 rounded-lg">
          <img src={qrData} alt="WhatsApp QR Code" className="w-44 h-44 rounded" />
          <p className="text-xs text-slate-500">使用 WhatsApp 扫描二维码登录</p>
        </div>
      )}

      {(actionError || s.lastError) && <ErrorBox msg={actionError || s.lastError} />}

      <div className="flex flex-wrap gap-2 pt-1">
        {!s.linked && !s.connected && (
          <button
            onClick={() => handleShowQR(false)}
            disabled={qrLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {qrLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <LinkIcon className="w-3.5 h-3.5" />}
            显示二维码
          </button>
        )}

        {s.linked && !s.connected && !qrData && (
          <button
            onClick={() => handleShowQR(true)}
            disabled={qrLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {qrLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            重新绑定
          </button>
        )}

        {qrData && (
          <button
            onClick={handleWaitScan}
            disabled={waitLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {waitLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5" />}
            已扫码，等待连接
          </button>
        )}

        {(s.linked || s.connected) && (
          <button
            onClick={handleLogout}
            disabled={logoutLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {logoutLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Unlink className="w-3.5 h-3.5" />}
            登出
          </button>
        )}
      </div>
    </div>
  );
}

// Generic channel card (Telegram, Discord, Slack, etc.)
function GenericChannelCard({ channelId, status, accounts, label, icon, onRefresh, onLogout }: {
  channelId: string;
  status: any;
  accounts: ChannelAccountSnapshot[];
  label: string;
  icon: string;
  onRefresh: () => void;
  onLogout: (accountId?: string) => Promise<void>;
}) {
  const [logoutId, setLogoutId] = useState<string | null>(null);
  const s = status || {};
  const multiAccount = accounts.length > 1;

  const handleLogout = async (accountId?: string) => {
    const key = accountId ?? '__default__';
    setLogoutId(key);
    try { await onLogout(accountId); } finally { setLogoutId(null); }
  };

  // Derive status from accounts[0] if top-level status is sparse
  const acc0 = accounts[0];
  const running = s.running ?? acc0?.running;
  const connected = s.connected ?? acc0?.connected;
  const configured = s.configured ?? acc0?.configured;
  const lastError = s.lastError || acc0?.lastError;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">{label}</h3>
            {multiAccount && (
              <p className="text-xs text-slate-500">{accounts.length} 个账号</p>
            )}
          </div>
        </div>
        <button
          onClick={onRefresh}
          title="刷新"
          className="text-slate-400 hover:text-slate-600 p-1 rounded transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!multiAccount && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {configured !== undefined && <StatusBadge ok={configured} label="已配置" />}
            {running !== undefined && <StatusBadge ok={running} label="运行中" />}
            {connected !== undefined && <StatusBadge ok={connected} label="已连接" />}
          </div>

          {acc0?.name && (
            <p className="text-xs text-slate-600">
              {acc0.name}
              {acc0.probe?.bot?.username && (
                <span className="text-slate-500"> (@{acc0.probe.bot.username})</span>
              )}
            </p>
          )}

          {acc0?.lastInboundAt && (
            <p className="text-xs text-slate-500">最后收信: {formatRelTime(acc0.lastInboundAt)}</p>
          )}

          {lastError && <ErrorBox msg={lastError} />}

          {(s.linked || s.connected || acc0?.linked || acc0?.connected) && (
            <button
              onClick={() => handleLogout(acc0?.accountId)}
              disabled={logoutId !== null}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg transition-colors disabled:opacity-50"
            >
              {logoutId !== null
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Unlink className="w-3.5 h-3.5" />}
              登出
            </button>
          )}
        </>
      )}

      {multiAccount && (
        <div className="space-y-2">
          {accounts.map(acc => (
            <div key={acc.accountId} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-700">
                  {acc.name || acc.accountId}
                  {acc.probe?.bot?.username && (
                    <span className="font-normal text-slate-500"> (@{acc.probe.bot.username})</span>
                  )}
                </div>
                {(acc.linked || acc.connected || acc.running) && (
                  <button
                    onClick={() => handleLogout(acc.accountId)}
                    disabled={logoutId === acc.accountId}
                    className="text-xs text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    {logoutId === acc.accountId
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : '登出'}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {acc.configured !== undefined && <StatusBadge ok={acc.configured} label="已配置" />}
                {acc.running !== undefined && <StatusBadge ok={acc.running} label="运行中" />}
                {acc.connected !== undefined && <StatusBadge ok={acc.connected} label="已连接" />}
              </div>
              {acc.lastError && <p className="text-xs text-red-600 break-all">{acc.lastError}</p>}
              {acc.lastInboundAt && (
                <p className="text-xs text-slate-500">最后收信: {formatRelTime(acc.lastInboundAt)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function ChannelsPage() {
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [snap, setSnap] = useState<ChannelsStatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (probe = false) => {
    if (probe) setProbing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await client.channelsStatus({ probe, timeoutMs: probe ? 25000 : 10000 });
      setSnap(res);
    } catch (e: any) {
      setError(e.message || '加载频道状态失败');
    } finally {
      setLoading(false);
      setProbing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleLogout = async (channelId: string, accountId?: string) => {
    try {
      await client.channelsLogout({ channel: channelId, accountId });
      load();
    } catch {
      // card will show its own error on next refresh
    }
  };

  if (loading && !snap) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">加载中…</span>
      </div>
    );
  }

  if (error && !snap) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
        <AlertCircle className="w-7 h-7 text-red-500" />
        <p className="text-sm">{error}</p>
        <button
          onClick={() => load()}
          className="text-sm text-indigo-600 hover:text-indigo-500"
        >
          重试
        </button>
      </div>
    );
  }

  const channels = snap?.channels ?? {};
  const channelAccounts = snap?.channelAccounts ?? {};
  const channelLabels = snap?.channelLabels ?? {};

  const orderedAll = resolveChannelOrder(snap ?? {});
  const knownChannels = orderedAll.filter(id =>
    channels[id] !== undefined || (channelAccounts[id]?.length ?? 0) > 0
  );

  // Enabled channels first
  const sorted = [
    ...knownChannels.filter(id => channelEnabled(channels[id], channelAccounts[id] ?? [])),
    ...knownChannels.filter(id => !channelEnabled(channels[id], channelAccounts[id] ?? [])),
  ];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">频道</h1>
          <p className="text-sm text-slate-500 mt-0.5">管理消息频道连接状态</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={probing || loading}
          className="flex items-center gap-2 text-sm px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
        >
          {probing
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          探测刷新
        </button>
      </div>

      {error && <ErrorBox msg={error} />}

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          暂无频道数据
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sorted.map(channelId => {
            const status = channels[channelId];
            const accounts = channelAccounts[channelId] ?? [];
            const label = channelLabels[channelId]
              || CHANNEL_LABELS_DEFAULT[channelId]
              || channelId;
            const icon = CHANNEL_ICONS[channelId] || '🔌';

            if (channelId === 'whatsapp') {
              return (
                <WhatsAppCard
                  key={channelId}
                  channelId={channelId}
                  status={status}
                  accounts={accounts}
                  label={label}
                  onRefresh={() => load()}
                />
              );
            }

            return (
              <GenericChannelCard
                key={channelId}
                channelId={channelId}
                status={status}
                accounts={accounts}
                label={label}
                icon={icon}
                onRefresh={() => load()}
                onLogout={(accountId) => handleLogout(channelId, accountId)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
