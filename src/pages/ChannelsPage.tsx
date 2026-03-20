import React, { useEffect, useState, useCallback } from 'react';
import { client } from '../api/gateway';
import { useAppStore } from '../stores/useAppStore';
import {
  RefreshCw, Loader2, AlertCircle, CheckCircle2, XCircle,
  Link as LinkIcon, Unlink, Settings, ChevronDown, ChevronRight,
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
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
        : 'bg-white/10 text-white/40 border-white/10'
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-red-300 bg-red-500/15 border border-red-500/30 rounded-lg px-3 py-2">
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="break-all">{msg}</span>
    </div>
  );
}

// Collapsible config editor for a channel
function ChannelConfigEditor({ channelId, configValue, configHash, onSaved, isOpen, onToggle }: {
  channelId: string;
  configValue: Record<string, any> | null;
  configHash: string | null;
  onSaved: () => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Sync textarea when config changes externally or panel opens
  useEffect(() => {
    if (isOpen) {
      setText(JSON.stringify(configValue ?? {}, null, 2));
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, configValue]);

  const handleSave = async () => {
    setError(null);
    setSuccess(false);
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('JSON 格式错误，请检查后重试');
      return;
    }
    if (!configHash) {
      setError('未获得配置 Hash，请刷新后重试');
      return;
    }
    setSaving(true);
    try {
      await client.configPatchRaw({ channels: { [channelId]: parsed } }, configHash);
      setSuccess(true);
      onSaved();
      setTimeout(() => setSuccess(false), 2000);
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-white/8 pt-3 mt-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors w-full text-left"
      >
        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Settings className="w-3.5 h-3.5" />
        配置
      </button>

      {isOpen && (
        <div className="mt-2 space-y-2">
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setError(null); setSuccess(false); }}
            rows={8}
            spellCheck={false}
            className="w-full text-xs font-mono bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-400 resize-y"
          />
          {error && <ErrorBox msg={error} />}
          {success && (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> 已保存
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !configHash}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              保存
            </button>
            <button
              onClick={() => { setText(JSON.stringify(configValue ?? {}, null, 2)); setError(null); }}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white/70 border border-white/10 rounded-lg transition-colors disabled:opacity-50"
            >
              重置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// WhatsApp Card with QR login flow
function WhatsAppCard({ channelId, status, accounts, label, onRefresh, configValue, configHash, onConfigSaved, configOpen, onConfigToggle }: {
  channelId: string;
  status: any;
  accounts: ChannelAccountSnapshot[];
  label: string;
  onRefresh: () => void;
  configValue: Record<string, any> | null;
  configHash: string | null;
  onConfigSaved: () => void;
  configOpen: boolean;
  onConfigToggle: () => void;
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
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">📱</span>
          <h3 className="font-semibold text-white text-sm">{label}</h3>
        </div>
        <button
          onClick={onRefresh}
          title="刷新"
          className="text-white/40 hover:text-white/70 p-1 rounded transition-colors"
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
        <p className="text-xs text-white/50">最后连接: {formatRelTime(s.lastConnectedAt)}</p>
      ) : null}
      {s.lastMessageAt ? (
        <p className="text-xs text-white/50">最后消息: {formatRelTime(s.lastMessageAt)}</p>
      ) : null}

      {qrData && (
        <div className="flex flex-col items-center gap-2 py-3 bg-white/5 border border-white/10 rounded-lg">
          <img src={qrData} alt="WhatsApp QR Code" className="w-44 h-44 rounded" />
          <p className="text-xs text-white/50">使用 WhatsApp 扫描二维码登录</p>
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
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white/80 border border-white/10 rounded-lg transition-colors disabled:opacity-50"
          >
            {logoutLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Unlink className="w-3.5 h-3.5" />}
            登出
          </button>
        )}
      </div>

      <ChannelConfigEditor
        channelId={channelId}
        configValue={configValue}
        configHash={configHash}
        onSaved={onConfigSaved}
        isOpen={configOpen}
        onToggle={onConfigToggle}
      />
    </div>
  );
}

// Generic channel card (Telegram, Discord, Slack, etc.)
function GenericChannelCard({ channelId, status, accounts, label, icon, onRefresh, onLogout, configValue, configHash, onConfigSaved, configOpen, onConfigToggle }: {
  channelId: string;
  status: any;
  accounts: ChannelAccountSnapshot[];
  label: string;
  icon: string;
  onRefresh: () => void;
  onLogout: (accountId?: string) => Promise<void>;
  configValue: Record<string, any> | null;
  configHash: string | null;
  onConfigSaved: () => void;
  configOpen: boolean;
  onConfigToggle: () => void;
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
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-semibold text-white text-sm">{label}</h3>
            {multiAccount && (
              <p className="text-xs text-white/50">{accounts.length} 个账号</p>
            )}
          </div>
        </div>
        <button
          onClick={onRefresh}
          title="刷新"
          className="text-white/40 hover:text-white/70 p-1 rounded transition-colors"
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
            <p className="text-xs text-white/70">
              {acc0.name}
              {acc0.probe?.bot?.username && (
                <span className="text-white/50"> (@{acc0.probe.bot.username})</span>
              )}
            </p>
          )}

          {acc0?.lastInboundAt && (
            <p className="text-xs text-white/50">最后收信: {formatRelTime(acc0.lastInboundAt)}</p>
          )}

          {lastError && <ErrorBox msg={lastError} />}

          {(s.linked || s.connected || acc0?.linked || acc0?.connected) && (
            <button
              onClick={() => handleLogout(acc0?.accountId)}
              disabled={logoutId !== null}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white/80 border border-white/10 rounded-lg transition-colors disabled:opacity-50"
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
            <div key={acc.accountId} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-white/80">
                  {acc.name || acc.accountId}
                  {acc.probe?.bot?.username && (
                    <span className="font-normal text-white/50"> (@{acc.probe.bot.username})</span>
                  )}
                </div>
                {(acc.linked || acc.connected || acc.running) && (
                  <button
                    onClick={() => handleLogout(acc.accountId)}
                    disabled={logoutId === acc.accountId}
                    className="text-xs text-white/40 hover:text-red-300 transition-colors disabled:opacity-50"
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
              {acc.lastError && <p className="text-xs text-red-300 break-all">{acc.lastError}</p>}
              {acc.lastInboundAt && (
                <p className="text-xs text-white/50">最后收信: {formatRelTime(acc.lastInboundAt)}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <ChannelConfigEditor
        channelId={channelId}
        configValue={configValue}
        configHash={configHash}
        onSaved={onConfigSaved}
        isOpen={configOpen}
        onToggle={onConfigToggle}
      />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function ChannelsPage() {
  const { connectionStatus } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [snap, setSnap] = useState<ChannelsStatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Config state
  const [configObj, setConfigObj] = useState<Record<string, any> | null>(null);
  const [configHash, setConfigHash] = useState<string | null>(null);
  const [openConfigId, setOpenConfigId] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res: any = await client.configGet();
      setConfigObj(res?.config ?? null);
      setConfigHash(res?.hash ?? null);
    } catch {
      // non-fatal: config editor will show disabled state
    }
  }, []);

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

  useEffect(() => {
    if (connectionStatus === 'connected') {
      load();
      loadConfig();
    }
  }, [connectionStatus]);

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
      <div className="h-full flex items-center justify-center gap-2 text-white/50">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">加载中…</span>
      </div>
    );
  }

  if (error && !snap) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-white/50">
        <AlertCircle className="w-7 h-7 text-red-500" />
        <p className="text-sm">{error}</p>
        <button
          onClick={() => load()}
          className="text-sm text-indigo-300 hover:text-indigo-500"
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
          <h1 className="text-xl font-bold text-white">频道</h1>
          <p className="text-sm text-white/50 mt-0.5">管理消息频道连接状态</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={probing || loading}
          className="flex items-center gap-2 text-sm px-4 py-2 bg-white/8 backdrop-blur-xl border border-white/10 text-white/80 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
        >
          {probing
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          探测刷新
        </button>
      </div>

      {error && <ErrorBox msg={error} />}

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm">
          暂无频道数据
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {sorted.map(channelId => {
            const status = channels[channelId];
            const accounts = channelAccounts[channelId] ?? [];
            const label = channelLabels[channelId]
              || CHANNEL_LABELS_DEFAULT[channelId]
              || channelId;
            const icon = CHANNEL_ICONS[channelId] || '🔌';
            const chCfg = (configObj?.channels as Record<string, any> | undefined)?.[channelId]
              ?? (configObj?.[channelId] as Record<string, any> | undefined)
              ?? null;

            const configOpen = openConfigId === channelId;
            const onConfigToggle = () => setOpenConfigId(id => id === channelId ? null : channelId);

            if (channelId === 'whatsapp') {
              return (
                <WhatsAppCard
                  key={channelId}
                  channelId={channelId}
                  status={status}
                  accounts={accounts}
                  label={label}
                  onRefresh={() => load()}
                  configValue={chCfg}
                  configHash={configHash}
                  onConfigSaved={loadConfig}
                  configOpen={configOpen}
                  onConfigToggle={onConfigToggle}
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
                configValue={chCfg}
                configHash={configHash}
                onConfigSaved={loadConfig}
                configOpen={configOpen}
                onConfigToggle={onConfigToggle}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
