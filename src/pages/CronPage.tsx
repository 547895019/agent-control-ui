import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ModelSelect } from '../components/shared/ModelSelect';
import { client } from '../api/gateway';
import {
  Plus, Play, Trash2, Edit2, RefreshCw, Clock,
  CheckCircle2, XCircle, SkipForward, ToggleLeft, ToggleRight,
  History, X, ExternalLink, ChevronDown,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScheduleKind = 'at' | 'every' | 'cron';
type PayloadKind = 'systemEvent' | 'agentTurn';
type SessionTarget = 'main' | 'isolated' | 'current';
type WakeMode = 'next-heartbeat' | 'now';
type DeliveryMode = 'none' | 'announce' | 'webhook';
type FailureAlertMode = 'inherit' | 'disabled' | 'custom';
type RunStatus = 'ok' | 'error' | 'skipped';
type DeliveryStatus = 'delivered' | 'not-delivered' | 'not-requested' | 'unknown';

type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };

type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string; model?: string; thinking?: string; timeoutSeconds?: number; lightContext?: boolean };

type CronDelivery = {
  mode: DeliveryMode;
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
};

type CronFailureAlert = {
  after?: number;
  channel?: string;
  to?: string;
  cooldownMs?: number;
  mode?: 'announce' | 'webhook';
  accountId?: string;
};

type CronJob = {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  sessionKey?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  sessionTarget?: string;
  wakeMode?: string;
  payload: CronPayload;
  delivery?: CronDelivery;
  failureAlert?: CronFailureAlert | false;
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: RunStatus;
    lastStatus?: RunStatus;
    lastDurationMs?: number;
    lastError?: string;
    consecutiveErrors?: number;
  };
};

type CronRunEntry = {
  ts: number;
  jobId: string;
  jobName?: string;
  status?: RunStatus | string;
  durationMs?: number;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: DeliveryStatus | string;
  deliveryError?: string;
  sessionKey?: string;
  model?: string;
  provider?: string;
  runAtMs?: number;
  nextRunAtMs?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
};

type FormState = {
  name: string;
  description: string;
  agentId: string;
  sessionKey: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  scheduleKind: ScheduleKind;
  scheduleAt: string;
  everyAmount: string;
  everyUnit: 'minutes' | 'hours' | 'days';
  cronExpr: string;
  cronTz: string;
  scheduleExact: boolean;
  staggerAmount: string;
  staggerUnit: 'seconds' | 'minutes';
  sessionTarget: SessionTarget;
  wakeMode: WakeMode;
  payloadKind: PayloadKind;
  payloadText: string;
  payloadModel: string;
  payloadThinking: string;
  payloadLightContext: boolean;
  timeoutSeconds: string;
  deliveryMode: DeliveryMode;
  deliveryChannel: string;
  deliveryTo: string;
  deliveryAccountId: string;
  deliveryBestEffort: boolean;
  failureAlertMode: FailureAlertMode;
  failureAlertAfter: string;
  failureAlertCooldownSeconds: string;
  failureAlertChannel: string;
  failureAlertTo: string;
  failureAlertDeliveryMode: 'announce' | 'webhook';
  failureAlertAccountId: string;
};

const DEFAULT_FORM: FormState = {
  name: '',
  description: '',
  agentId: '',
  sessionKey: '',
  enabled: true,
  deleteAfterRun: true,
  scheduleKind: 'every',
  scheduleAt: '',
  everyAmount: '30',
  everyUnit: 'minutes',
  cronExpr: '0 7 * * *',
  cronTz: '',
  scheduleExact: false,
  staggerAmount: '',
  staggerUnit: 'seconds',
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payloadKind: 'agentTurn',
  payloadText: '',
  payloadModel: '',
  payloadThinking: '',
  payloadLightContext: false,
  timeoutSeconds: '',
  deliveryMode: 'announce',
  deliveryChannel: 'last',
  deliveryTo: '',
  deliveryAccountId: '',
  deliveryBestEffort: false,
  failureAlertMode: 'inherit',
  failureAlertAfter: '2',
  failureAlertCooldownSeconds: '3600',
  failureAlertChannel: 'last',
  failureAlertTo: '',
  failureAlertDeliveryMode: 'announce',
  failureAlertAccountId: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'at') {
    const d = new Date(schedule.at);
    return isNaN(d.getTime()) ? schedule.at : d.toLocaleString();
  }
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs;
    if (ms % 86400000 === 0) return `每 ${ms / 86400000} 天`;
    if (ms % 3600000 === 0) return `每 ${ms / 3600000} 小时`;
    if (ms % 60000 === 0) return `每 ${ms / 60000} 分钟`;
    return `每 ${ms}ms`;
  }
  return schedule.expr + (schedule.tz ? ` (${schedule.tz})` : '');
}

function formatMsRelTime(ms?: number): string {
  if (typeof ms !== 'number' || !isFinite(ms)) return '-';
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? '后' : '前';
  if (abs < 60000) return `${Math.round(abs / 1000)}秒${sign}`;
  if (abs < 3600000) return `${Math.round(abs / 60000)}分${sign}`;
  if (abs < 86400000) return `${Math.round(abs / 3600000)}小时${sign}`;
  return new Date(ms).toLocaleString();
}

function formatMsTime(ms?: number): string {
  if (typeof ms !== 'number' || !isFinite(ms)) return '-';
  return new Date(ms).toLocaleString();
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number') return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function jobToForm(job: CronJob): FormState {
  const s = job.schedule;
  let scheduleKind: ScheduleKind = s.kind;
  let scheduleAt = '', everyAmount = '30', cronExpr = '0 7 * * *', cronTz = '';
  let everyUnit: 'minutes' | 'hours' | 'days' = 'minutes';
  let scheduleExact = false, staggerAmount = '';
  let staggerUnit: 'seconds' | 'minutes' = 'seconds';

  if (s.kind === 'at') {
    const d = new Date(s.at);
    if (!isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0');
      scheduleAt = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  } else if (s.kind === 'every') {
    const ms = s.everyMs;
    if (ms % 86400000 === 0) { everyAmount = String(ms / 86400000); everyUnit = 'days'; }
    else if (ms % 3600000 === 0) { everyAmount = String(ms / 3600000); everyUnit = 'hours'; }
    else { everyAmount = String(Math.round(ms / 60000)); }
  } else {
    cronExpr = s.expr; cronTz = s.tz ?? '';
    if (s.staggerMs === 0) { scheduleExact = true; }
    else if (s.staggerMs != null && s.staggerMs > 0) {
      if (s.staggerMs % 60000 === 0) { staggerAmount = String(s.staggerMs / 60000); staggerUnit = 'minutes'; }
      else { staggerAmount = String(Math.ceil(s.staggerMs / 1000)); }
    }
  }

  const p = job.payload;
  const d = job.delivery;
  const fa = job.failureAlert;

  return {
    name: job.name, description: job.description ?? '',
    agentId: job.agentId ?? '', sessionKey: job.sessionKey ?? '',
    enabled: job.enabled, deleteAfterRun: job.deleteAfterRun ?? false,
    scheduleKind, scheduleAt, everyAmount, everyUnit, cronExpr, cronTz,
    scheduleExact, staggerAmount, staggerUnit,
    sessionTarget: (job.sessionTarget as SessionTarget) ?? 'isolated',
    wakeMode: (job.wakeMode as WakeMode) ?? 'now',
    payloadKind: p.kind,
    payloadText: p.kind === 'systemEvent' ? p.text : p.message,
    payloadModel: p.kind === 'agentTurn' ? (p.model ?? '') : '',
    payloadThinking: p.kind === 'agentTurn' ? (p.thinking ?? '') : '',
    payloadLightContext: p.kind === 'agentTurn' ? (p.lightContext ?? false) : false,
    timeoutSeconds: p.kind === 'agentTurn' && typeof p.timeoutSeconds === 'number' ? String(p.timeoutSeconds) : '',
    deliveryMode: d?.mode ?? 'none',
    deliveryChannel: d?.channel ?? 'last', deliveryTo: d?.to ?? '',
    deliveryAccountId: d?.accountId ?? '', deliveryBestEffort: d?.bestEffort ?? false,
    failureAlertMode: fa === false ? 'disabled' : (fa && typeof fa === 'object' ? 'custom' : 'inherit'),
    failureAlertAfter: fa && typeof fa === 'object' && typeof fa.after === 'number' ? String(fa.after) : '2',
    failureAlertCooldownSeconds: fa && typeof fa === 'object' && typeof fa.cooldownMs === 'number' ? String(Math.floor(fa.cooldownMs / 1000)) : '3600',
    failureAlertChannel: fa && typeof fa === 'object' ? (fa.channel ?? 'last') : 'last',
    failureAlertTo: fa && typeof fa === 'object' ? (fa.to ?? '') : '',
    failureAlertDeliveryMode: fa && typeof fa === 'object' ? (fa.mode ?? 'announce') : 'announce',
    failureAlertAccountId: fa && typeof fa === 'object' ? (fa.accountId ?? '') : '',
  };
}

// ── Run entry helpers ─────────────────────────────────────────────────────────

function runStatusLabel(status?: string): string {
  if (status === 'ok') return '成功';
  if (status === 'error') return '失败';
  if (status === 'skipped') return '跳过';
  return status ?? '-';
}

function runStatusColor(status?: string): string {
  if (status === 'ok') return 'text-emerald-600';
  if (status === 'error') return 'text-red-600';
  if (status === 'skipped') return 'text-slate-400';
  return 'text-slate-400';
}

function deliveryStatusLabel(s?: string): string {
  if (s === 'delivered') return '已投递';
  if (s === 'not-delivered') return '未投递';
  if (s === 'not-requested') return '无需投递';
  if (s === 'unknown') return '未知';
  return s ?? '-';
}

function deliveryStatusColor(s?: string): string {
  if (s === 'delivered') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (s === 'not-delivered') return 'bg-red-50 text-red-600 border-red-200';
  return 'bg-slate-100 text-slate-500 border-slate-200';
}

function usageSummary(usage?: CronRunEntry['usage']): string | null {
  if (!usage) return null;
  if (typeof usage.total_tokens === 'number') return `${usage.total_tokens} tokens`;
  if (typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number')
    return `${usage.input_tokens} in / ${usage.output_tokens} out`;
  return null;
}

// ── RunStatusBadge ────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-slate-400 text-xs">-</span>;
  if (status === 'ok') return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs"><CheckCircle2 className="w-3 h-3" />成功</span>;
  if (status === 'error') return <span className="inline-flex items-center gap-1 text-red-600 text-xs"><XCircle className="w-3 h-3" />失败</span>;
  if (status === 'skipped') return <span className="inline-flex items-center gap-1 text-slate-400 text-xs"><SkipForward className="w-3 h-3" />跳过</span>;
  if (status === 'running') return <span className="inline-flex items-center gap-1 text-amber-500 text-xs"><RefreshCw className="w-3 h-3 animate-spin" />运行中</span>;
  return <span className="text-slate-400 text-xs">{status}</span>;
}

// ── RunEntryCard ──────────────────────────────────────────────────────────────

function RunEntryCard({ entry }: { entry: CronRunEntry }) {
  const usage = usageSummary(entry.usage);
  const timeMs = entry.runAtMs ?? entry.ts;

  return (
    <div className="border-b border-slate-100 px-4 py-3 hover:bg-slate-50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        {/* Left */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-slate-700 text-xs font-medium truncate max-w-[200px]">
              {entry.jobName ?? entry.jobId}
            </span>
            <span className={`text-xs ${runStatusColor(entry.status)}`}>
              · {runStatusLabel(entry.status)}
            </span>
          </div>

          {(entry.summary || entry.error) && (
            <p className="text-slate-500 text-xs mt-1 line-clamp-2 leading-relaxed">
              {entry.summary ?? entry.error}
            </p>
          )}

          <div className="flex flex-wrap gap-1 mt-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${deliveryStatusColor(entry.deliveryStatus)}`}>
              {deliveryStatusLabel(entry.deliveryStatus)}
            </span>
            {entry.model && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                {entry.model}
              </span>
            )}
            {entry.provider && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                {entry.provider}
              </span>
            )}
            {usage && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                {usage}
              </span>
            )}
          </div>

          {entry.deliveryError && (
            <p className="text-red-500 text-[10px] mt-1">{entry.deliveryError}</p>
          )}
        </div>

        {/* Right: meta */}
        <div className="text-right text-[10px] text-slate-400 shrink-0 space-y-0.5 min-w-[90px]">
          <div title={formatMsTime(timeMs)}>{formatMsRelTime(timeMs)}</div>
          {typeof entry.runAtMs === 'number' && entry.runAtMs !== entry.ts && (
            <div className="text-slate-300" title={formatMsTime(entry.runAtMs)}>
              计划 {formatMsRelTime(entry.runAtMs)}
            </div>
          )}
          <div className="font-mono">{formatDuration(entry.durationMs)}</div>
          {typeof entry.nextRunAtMs === 'number' && (
            <div title={formatMsTime(entry.nextRunAtMs)}>
              {entry.nextRunAtMs > Date.now() ? '下次' : '到期'} {formatMsRelTime(entry.nextRunAtMs)}
            </div>
          )}
          {entry.sessionKey && (
            <button
              className="text-indigo-500 hover:text-indigo-600 flex items-center gap-0.5 ml-auto"
              onClick={() => navigator.clipboard?.writeText(entry.sessionKey!)}
              title={`Session: ${entry.sessionKey}`}
            >
              <ExternalLink className="w-2.5 h-2.5" />
              会话
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RunsPanel ─────────────────────────────────────────────────────────────────

const RUN_STATUS_OPTIONS: { value: RunStatus; label: string }[] = [
  { value: 'ok', label: '成功' },
  { value: 'error', label: '失败' },
  { value: 'skipped', label: '跳过' },
];

const DELIVERY_STATUS_OPTIONS: { value: DeliveryStatus; label: string }[] = [
  { value: 'delivered', label: '已投递' },
  { value: 'not-delivered', label: '未投递' },
  { value: 'not-requested', label: '无需投递' },
];

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
        active
          ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
          : 'bg-white text-slate-500 border-slate-200 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function RunsPanel({ selectedJob, onClose }: { selectedJob: CronJob | null; onClose: () => void }) {
  const [scope, setScope] = useState<'all' | 'job'>(selectedJob ? 'job' : 'all');
  const [statusFilters, setStatusFilters] = useState<RunStatus[]>([]);
  const [deliveryFilters, setDeliveryFilters] = useState<DeliveryStatus[]>([]);
  const [query, setQuery] = useState('');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const [runs, setRuns] = useState<CronRunEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const LIMIT = 50;

  useEffect(() => {
    if (selectedJob) setScope('job');
  }, [selectedJob?.id]);

  const fetchRuns = useCallback(async (append = false) => {
    const activeJobId = scope === 'job' ? selectedJob?.id : undefined;
    if (scope === 'job' && !activeJobId) {
      setRuns([]); setTotal(0); setHasMore(false); setOffset(0);
      return;
    }

    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const currentOffset = append ? offset : 0;
      const res = await client.cronRuns({
        scope,
        id: activeJobId,
        limit: LIMIT,
        offset: currentOffset,
        sortDir,
        query: query.trim() || undefined,
        statuses: statusFilters.length > 0 ? statusFilters : undefined,
        deliveryStatuses: deliveryFilters.length > 0 ? deliveryFilters : undefined,
      });
      const entries: CronRunEntry[] = Array.isArray(res?.entries) ? res.entries : [];
      const newRuns = append ? [...runs, ...entries] : entries;
      setRuns(newRuns);
      setTotal(res?.total ?? newRuns.length);
      setHasMore(res?.hasMore ?? false);
      setOffset((res?.nextOffset ?? (currentOffset + entries.length)));
    } catch (e: any) {
      setError(e.message ?? '加载失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [scope, selectedJob?.id, statusFilters, deliveryFilters, query, sortDir, runs, offset]);

  const prevKey = useRef('');
  useEffect(() => {
    const key = `${scope}|${selectedJob?.id}|${statusFilters.join(',')}|${deliveryFilters.join(',')}|${query}|${sortDir}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      setRuns([]);
      setOffset(0);
      setHasMore(false);
    }
  }, [scope, selectedJob?.id, statusFilters, deliveryFilters, query, sortDir]);

  useEffect(() => {
    if (runs.length === 0) {
      fetchRuns(false);
    }
  }, [runs.length]);

  const toggleStatus = (v: RunStatus) => {
    setStatusFilters(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };
  const toggleDelivery = (v: DeliveryStatus) => {
    setDeliveryFilters(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  const shownOf = runs.length === total || total === 0
    ? `${runs.length} 条`
    : `${runs.length} / ${total} 条`;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white border-l border-slate-200">
      {/* Header */}
      <div className="shrink-0 px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-slate-600 text-xs font-medium">运行历史</span>
        <span className="text-slate-400 text-xs">{shownOf}</span>
        <div className="flex-1" />
        <button
          onClick={() => fetchRuns(false)}
          disabled={loading}
          className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 ml-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="shrink-0 border-b border-slate-200 px-4 py-2 space-y-2 bg-slate-50/50">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={scope}
            onChange={e => setScope(e.target.value as 'all' | 'job')}
            className="bg-white border border-slate-200 text-slate-700 text-xs px-2 py-1 rounded focus:outline-none focus:border-indigo-400"
          >
            <option value="all">全部任务</option>
            <option value="job" disabled={!selectedJob}>
              {selectedJob ? selectedJob.name : '选中任务'}
            </option>
          </select>

          <div className="relative flex-1 min-w-[120px]">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索运行记录..."
              className="w-full bg-white border border-slate-200 text-slate-700 text-xs px-2.5 py-1 rounded focus:outline-none focus:border-indigo-400 placeholder-slate-400"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <select
            value={sortDir}
            onChange={e => setSortDir(e.target.value as 'desc' | 'asc')}
            className="bg-white border border-slate-200 text-slate-700 text-xs px-2 py-1 rounded focus:outline-none focus:border-indigo-400"
          >
            <option value="desc">最新优先</option>
            <option value="asc">最早优先</option>
          </select>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-slate-400 text-[10px] mr-0.5">状态:</span>
          {RUN_STATUS_OPTIONS.map(o => (
            <FilterChip key={o.value} label={o.label} active={statusFilters.includes(o.value)} onClick={() => toggleStatus(o.value)} />
          ))}
          <span className="text-slate-300 mx-1">|</span>
          <span className="text-slate-400 text-[10px] mr-0.5">投递:</span>
          {DELIVERY_STATUS_OPTIONS.map(o => (
            <FilterChip key={o.value} label={o.label} active={deliveryFilters.includes(o.value)} onClick={() => toggleDelivery(o.value)} />
          ))}
          {(statusFilters.length > 0 || deliveryFilters.length > 0) && (
            <button
              onClick={() => { setStatusFilters([]); setDeliveryFilters([]); }}
              className="text-[10px] text-slate-400 hover:text-slate-600 underline ml-1"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 px-4 py-1.5 bg-red-50 border-b border-red-200 text-red-600 text-xs flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="underline">关闭</button>
        </div>
      )}

      {/* Run list */}
      <div className="flex-1 overflow-auto">
        {scope === 'job' && !selectedJob ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs">
            请先在列表中选择一个任务
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs">
            暂无运行记录
          </div>
        ) : (
          <>
            {runs.map((run, i) => <RunEntryCard key={`${run.ts}_${i}`} entry={run} />)}
            {hasMore && (
              <div className="px-4 py-3 flex justify-center">
                <button
                  onClick={() => fetchRuns(true)}
                  disabled={loadingMore}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded transition-colors disabled:opacity-50"
                >
                  {loadingMore ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3" />}
                  加载更多
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── CronJobModal ──────────────────────────────────────────────────────────────

type FormTab = 'basic' | 'schedule' | 'payload' | 'delivery' | 'alert';

const FORM_TABS: { key: FormTab; label: string }[] = [
  { key: 'basic', label: '基本' },
  { key: 'schedule', label: '调度' },
  { key: 'payload', label: '消息' },
  { key: 'delivery', label: '投递' },
  { key: 'alert', label: '告警' },
];

function CronJobModal({ initial, agents, onSave, onClose }: {
  initial?: CronJob;
  agents: Record<string, any>;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initial ? jobToForm(initial) : { ...DEFAULT_FORM });
  const [tab, setTab] = useState<FormTab>('basic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('请输入任务名称'); setTab('basic'); return; }
    if (!form.payloadText.trim()) { setError('请输入消息内容'); setTab('payload'); return; }
    if (form.scheduleKind === 'every' && (!form.everyAmount || Number(form.everyAmount) <= 0)) {
      setError('请输入有效的间隔时间'); setTab('schedule'); return;
    }
    if (form.scheduleKind === 'cron' && !form.cronExpr.trim()) {
      setError('请输入 Cron 表达式'); setTab('schedule'); return;
    }
    if (form.deliveryMode === 'webhook' && !form.deliveryTo.trim()) {
      setError('请输入 Webhook URL'); setTab('delivery'); return;
    }

    let schedule: CronSchedule;
    if (form.scheduleKind === 'at') {
      const ms = Date.parse(form.scheduleAt);
      if (!isFinite(ms)) { setError('请输入有效的执行时间'); setTab('schedule'); return; }
      schedule = { kind: 'at', at: new Date(ms).toISOString() };
    } else if (form.scheduleKind === 'every') {
      const mult = form.everyUnit === 'days' ? 86400000 : form.everyUnit === 'hours' ? 3600000 : 60000;
      schedule = { kind: 'every', everyMs: Number(form.everyAmount) * mult };
    } else {
      const base: { kind: 'cron'; expr: string; tz?: string; staggerMs?: number } = {
        kind: 'cron', expr: form.cronExpr.trim(), tz: form.cronTz.trim() || undefined,
      };
      if (form.scheduleExact) base.staggerMs = 0;
      else if (form.staggerAmount.trim()) {
        const v = Number(form.staggerAmount);
        base.staggerMs = form.staggerUnit === 'minutes' ? v * 60000 : v * 1000;
      }
      schedule = base;
    }

    let payload: CronPayload;
    if (form.payloadKind === 'systemEvent') {
      payload = { kind: 'systemEvent', text: form.payloadText.trim() };
    } else {
      const p: { kind: 'agentTurn'; message: string; model?: string; thinking?: string; timeoutSeconds?: number; lightContext?: boolean } = {
        kind: 'agentTurn', message: form.payloadText.trim(),
      };
      if (form.payloadModel.trim()) p.model = form.payloadModel.trim();
      if (form.payloadThinking.trim()) p.thinking = form.payloadThinking.trim();
      if (form.timeoutSeconds.trim() && Number(form.timeoutSeconds) > 0) p.timeoutSeconds = Number(form.timeoutSeconds);
      if (form.payloadLightContext) p.lightContext = true;
      payload = p;
    }

    let delivery: CronDelivery;
    if (form.deliveryMode === 'none') delivery = { mode: 'none' };
    else if (form.deliveryMode === 'announce') {
      delivery = { mode: 'announce', channel: form.deliveryChannel.trim() || 'last', accountId: form.deliveryAccountId.trim() || undefined, bestEffort: form.deliveryBestEffort };
    } else {
      delivery = { mode: 'webhook', to: form.deliveryTo.trim() || undefined, bestEffort: form.deliveryBestEffort };
    }

    let failureAlert: CronFailureAlert | false | undefined;
    if (form.failureAlertMode === 'disabled') failureAlert = false;
    else if (form.failureAlertMode === 'custom') {
      failureAlert = {
        after: Number(form.failureAlertAfter) > 0 ? Math.floor(Number(form.failureAlertAfter)) : undefined,
        channel: form.failureAlertChannel.trim() || 'last',
        to: form.failureAlertTo.trim() || undefined,
        cooldownMs: Number(form.failureAlertCooldownSeconds) >= 0 ? Math.floor(Number(form.failureAlertCooldownSeconds) * 1000) : undefined,
        mode: form.failureAlertDeliveryMode,
        accountId: form.failureAlertAccountId.trim() || undefined,
      };
    }

    const job = {
      name: form.name.trim(), description: form.description.trim() || undefined,
      agentId: form.agentId.trim() || undefined, sessionKey: form.sessionKey.trim() || undefined,
      enabled: form.enabled, deleteAfterRun: form.deleteAfterRun,
      schedule, sessionTarget: form.sessionTarget, wakeMode: form.wakeMode,
      payload, delivery,
      ...(failureAlert !== undefined ? { failureAlert } : {}),
    };

    setSaving(true); setError(null);
    try { await onSave(job); onClose(); }
    catch (e: any) { setError(e.message ?? '保存失败'); }
    finally { setSaving(false); }
  };

  const inp = 'w-full bg-white border border-slate-200 text-slate-800 text-sm px-3 py-1.5 rounded focus:outline-none focus:border-indigo-400';
  const lbl = 'block text-xs text-slate-600 mb-1';
  const tabBtn = (a: boolean) => `px-3 py-1 text-xs rounded transition-colors ${a ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`;
  const segBtn = (a: boolean) => `px-2.5 py-0.5 text-xs rounded transition-colors border ${a ? 'bg-slate-100 border-slate-300 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-700'}`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[92vh] flex flex-col border border-slate-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h2 className="text-slate-800 font-semibold text-sm">{initial ? '编辑定时任务' : '新建定时任务'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-1 px-5 pt-3 pb-1 shrink-0 border-b border-slate-100">
          {FORM_TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={tabBtn(tab === t.key)}>{t.label}</button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">

            {tab === 'basic' && (<>
              <div><label className={lbl}>名称 *</label><input className={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="任务名称" /></div>
              <div><label className={lbl}>描述</label><input className={inp} value={form.description} onChange={e => set('description', e.target.value)} placeholder="可选描述" /></div>
              <div>
                <label className={lbl}>Agent（可选）</label>
                <select className={inp} value={form.agentId} onChange={e => set('agentId', e.target.value)}>
                  <option value="">— 不指定 —</option>
                  {Object.entries(agents).map(([id, cfg]: [string, any]) => (
                    <option key={id} value={id}>{cfg.name ? `${cfg.name} (${id})` : id}</option>
                  ))}
                </select>
              </div>
              <div><label className={lbl}>会话 Key（可选）</label><input className={inp} value={form.sessionKey} onChange={e => set('sessionKey', e.target.value)} placeholder="留空使用默认会话" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>会话目标</label>
                  <select className={inp} value={form.sessionTarget} onChange={e => set('sessionTarget', e.target.value as SessionTarget)}>
                    <option value="isolated">isolated（隔离新会话）</option>
                    <option value="main">main（主会话）</option>
                    <option value="current">current（当前会话）</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>唤醒模式</label>
                  <select className={inp} value={form.wakeMode} onChange={e => set('wakeMode', e.target.value as WakeMode)}>
                    <option value="now">now（立即）</option>
                    <option value="next-heartbeat">next-heartbeat（下次心跳）</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-5 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} className="accent-indigo-500" />启用
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={form.deleteAfterRun} onChange={e => set('deleteAfterRun', e.target.checked)} className="accent-indigo-500" />运行后删除
                </label>
              </div>
            </>)}

            {tab === 'schedule' && (<>
              <div>
                <label className={lbl}>调度方式</label>
                <div className="flex gap-1">
                  {(['every', 'cron', 'at'] as ScheduleKind[]).map(k => (
                    <button key={k} type="button" className={tabBtn(form.scheduleKind === k)} onClick={() => set('scheduleKind', k)}>
                      {k === 'every' ? '间隔' : k === 'cron' ? 'Cron 表达式' : '指定时间'}
                    </button>
                  ))}
                </div>
              </div>
              {form.scheduleKind === 'every' && (
                <div>
                  <label className={lbl}>间隔时间</label>
                  <div className="flex gap-2">
                    <input className="bg-white border border-slate-200 text-slate-800 text-sm px-3 py-1.5 rounded focus:outline-none focus:border-indigo-400 w-24" type="number" min="1" value={form.everyAmount} onChange={e => set('everyAmount', e.target.value)} />
                    <select className={`${inp} flex-1`} value={form.everyUnit} onChange={e => set('everyUnit', e.target.value as FormState['everyUnit'])}>
                      <option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option>
                    </select>
                  </div>
                </div>
              )}
              {form.scheduleKind === 'cron' && (<>
                <div><label className={lbl}>Cron 表达式</label><input className={inp} value={form.cronExpr} onChange={e => set('cronExpr', e.target.value)} placeholder="0 7 * * *  (分 时 日 月 周)" /></div>
                <div><label className={lbl}>时区（可选）</label><input className={inp} value={form.cronTz} onChange={e => set('cronTz', e.target.value)} placeholder="如 Asia/Shanghai" /></div>
                <div>
                  <label className={lbl}>执行时机</label>
                  <div className="flex gap-1.5">
                    <button type="button" className={segBtn(!form.scheduleExact)} onClick={() => set('scheduleExact', false)}>随机抖动</button>
                    <button type="button" className={segBtn(form.scheduleExact)} onClick={() => set('scheduleExact', true)}>精确执行</button>
                  </div>
                </div>
                {!form.scheduleExact && (
                  <div>
                    <label className={lbl}>最大抖动（可选）</label>
                    <div className="flex gap-2">
                      <input className="bg-white border border-slate-200 text-slate-800 text-sm px-3 py-1.5 rounded focus:outline-none focus:border-indigo-400 w-24" type="number" min="0" value={form.staggerAmount} onChange={e => set('staggerAmount', e.target.value)} placeholder="0" />
                      <select className={`${inp} flex-1`} value={form.staggerUnit} onChange={e => set('staggerUnit', e.target.value as FormState['staggerUnit'])}>
                        <option value="seconds">秒</option><option value="minutes">分钟</option>
                      </select>
                    </div>
                    <p className="text-slate-400 text-xs mt-1">留空则由系统决定抖动范围</p>
                  </div>
                )}
              </>)}
              {form.scheduleKind === 'at' && (
                <div><label className={lbl}>执行时间</label><input className={inp} type="datetime-local" value={form.scheduleAt} onChange={e => set('scheduleAt', e.target.value)} /></div>
              )}
            </>)}

            {tab === 'payload' && (<>
              <div>
                <label className={lbl}>消息类型</label>
                <div className="flex gap-1">
                  {([['agentTurn', 'Agent 消息'], ['systemEvent', '系统事件']] as [PayloadKind, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={tabBtn(form.payloadKind === k)} onClick={() => set('payloadKind', k)}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>{form.payloadKind === 'systemEvent' ? '系统事件内容 *' : 'Agent 消息 *'}</label>
                <textarea className={`${inp} resize-none`} rows={4} value={form.payloadText} onChange={e => set('payloadText', e.target.value)} placeholder={form.payloadKind === 'systemEvent' ? '发送给 Agent 的系统事件文本' : '发送给 Agent 的消息内容'} />
              </div>
              {form.payloadKind === 'agentTurn' && (<>
                <div><label className={lbl}>模型（可选）</label><ModelSelect value={form.payloadModel} onChange={v => set('payloadModel', v)} placeholder="如 claude-sonnet-4-6" /></div>
                <div><label className={lbl}>Thinking 提示（可选）</label><input className={inp} value={form.payloadThinking} onChange={e => set('payloadThinking', e.target.value)} placeholder="thinking 模式提示" /></div>
                <div><label className={lbl}>超时时间（秒，可选）</label><input className={inp} type="number" min="0" value={form.timeoutSeconds} onChange={e => set('timeoutSeconds', e.target.value)} placeholder="留空不限制" /></div>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={form.payloadLightContext} onChange={e => set('payloadLightContext', e.target.checked)} className="accent-indigo-500" />
                  轻量上下文（lightContext）
                </label>
              </>)}
            </>)}

            {tab === 'delivery' && (<>
              <div>
                <label className={lbl}>投递模式</label>
                <div className="flex gap-1">
                  {([['none', '不投递'], ['announce', 'Announce'], ['webhook', 'Webhook']] as [DeliveryMode, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={tabBtn(form.deliveryMode === k)} onClick={() => set('deliveryMode', k)}>{l}</button>
                  ))}
                </div>
              </div>
              {form.deliveryMode === 'announce' && (<>
                <div><label className={lbl}>频道</label><input className={inp} value={form.deliveryChannel} onChange={e => set('deliveryChannel', e.target.value)} placeholder="last（上次使用的频道）" /></div>
                <div><label className={lbl}>Account ID（可选）</label><input className={inp} value={form.deliveryAccountId} onChange={e => set('deliveryAccountId', e.target.value)} placeholder="可选" /></div>
              </>)}
              {form.deliveryMode === 'webhook' && (
                <div><label className={lbl}>Webhook URL *</label><input className={inp} value={form.deliveryTo} onChange={e => set('deliveryTo', e.target.value)} placeholder="https://..." /></div>
              )}
              {form.deliveryMode !== 'none' && (
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={form.deliveryBestEffort} onChange={e => set('deliveryBestEffort', e.target.checked)} className="accent-indigo-500" />
                  尽力投递（失败不报错）
                </label>
              )}
            </>)}

            {tab === 'alert' && (<>
              <div>
                <label className={lbl}>失败告警模式</label>
                <div className="flex gap-1">
                  {([['inherit', '继承默认'], ['disabled', '禁用'], ['custom', '自定义']] as [FailureAlertMode, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={tabBtn(form.failureAlertMode === k)} onClick={() => set('failureAlertMode', k)}>{l}</button>
                  ))}
                </div>
              </div>
              {form.failureAlertMode === 'custom' && (<>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={lbl}>连续失败次数触发</label><input className={inp} type="number" min="1" value={form.failureAlertAfter} onChange={e => set('failureAlertAfter', e.target.value)} placeholder="2" /></div>
                  <div><label className={lbl}>告警冷却（秒）</label><input className={inp} type="number" min="0" value={form.failureAlertCooldownSeconds} onChange={e => set('failureAlertCooldownSeconds', e.target.value)} placeholder="3600" /></div>
                </div>
                <div>
                  <label className={lbl}>告警投递方式</label>
                  <div className="flex gap-1">
                    {([['announce', 'Announce'], ['webhook', 'Webhook']] as ['announce' | 'webhook', string][]).map(([k, l]) => (
                      <button key={k} type="button" className={tabBtn(form.failureAlertDeliveryMode === k)} onClick={() => set('failureAlertDeliveryMode', k)}>{l}</button>
                    ))}
                  </div>
                </div>
                {form.failureAlertDeliveryMode === 'announce' && (
                  <div><label className={lbl}>告警频道</label><input className={inp} value={form.failureAlertChannel} onChange={e => set('failureAlertChannel', e.target.value)} placeholder="last" /></div>
                )}
                {form.failureAlertDeliveryMode === 'webhook' && (
                  <div><label className={lbl}>Webhook URL</label><input className={inp} value={form.failureAlertTo} onChange={e => set('failureAlertTo', e.target.value)} placeholder="https://..." /></div>
                )}
                <div><label className={lbl}>Account ID（可选）</label><input className={inp} value={form.failureAlertAccountId} onChange={e => set('failureAlertAccountId', e.target.value)} placeholder="可选" /></div>
              </>)}
              {form.failureAlertMode === 'inherit' && <p className="text-slate-400 text-xs">使用系统/全局默认的失败告警配置。</p>}
              {form.failureAlertMode === 'disabled' && <p className="text-slate-400 text-xs">此任务失败时不发送告警通知。</p>}
            </>)}

            {error && <p className="text-red-600 text-xs pt-1">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded transition-colors">取消</button>
            <button type="submit" disabled={saving} className="px-4 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded transition-colors disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── CronPage ──────────────────────────────────────────────────────────────────

type ModalState = null | { mode: 'add' } | { mode: 'edit'; job: CronJob };
type PanelMode = 'none' | 'runs';

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('none');
  const [modal, setModal] = useState<ModalState>(null);
  const [agents, setAgents] = useState<Record<string, any>>({});
  const [confirmDelete, setConfirmDelete] = useState<CronJob | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  const loadJobs = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await client.cronList();
      setJobs(Array.isArray(res?.jobs) ? res.jobs : []);
    } catch (e: any) {
      setError(e.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    client.configGet().then(res => {
      const list = res?.config?.agents?.list;
      if (list && typeof list === 'object') setAgents(list);
    }).catch(() => {});
  }, [loadJobs]);

  const handleToggle = async (job: CronJob) => {
    setBusy(prev => ({ ...prev, [job.id]: true }));
    try { await client.cronUpdate(job.id, { enabled: !job.enabled }); await loadJobs(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(prev => ({ ...prev, [job.id]: false })); }
  };

  const handleRun = async (job: CronJob) => {
    const key = `run_${job.id}`;
    setBusy(prev => ({ ...prev, [key]: true }));
    try { await client.cronRun(job.id, 'force'); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(prev => ({ ...prev, [key]: false })); }
  };

  const handleDelete = async (job: CronJob) => {
    try {
      await client.cronRemove(job.id);
      if (selectedJob?.id === job.id) { setSelectedJob(null); setPanelMode('none'); }
      await loadJobs();
    } catch (e: any) { setError(e.message); }
    setConfirmDelete(null);
  };

  const handleSave = async (jobData: any) => {
    if (modal && modal.mode === 'edit') await client.cronUpdate(modal.job.id, jobData);
    else await client.cronAdd(jobData);
    await loadJobs();
  };

  const selectJob = (job: CronJob) => {
    if (selectedJob?.id === job.id) {
      setSelectedJob(null); setPanelMode('none');
    } else {
      setSelectedJob(job); setPanelMode('runs');
    }
  };

  const filteredJobs = jobs.filter(j =>
    !query || j.name.toLowerCase().includes(query.toLowerCase()) || (j.description ?? '').toLowerCase().includes(query.toLowerCase())
  );

  const showPanel = panelMode === 'runs';

  return (
    <div className="h-full flex flex-col bg-slate-50 text-slate-700">

      {/* Toolbar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-200 bg-white flex items-center gap-3">
        <span className="text-slate-500 text-xs font-semibold uppercase tracking-wide">定时任务</span>
        <span className="text-slate-400 text-xs">{jobs.length} 个任务</span>
        <div className="flex-1" />
        <div className="relative">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索..."
            className="bg-slate-50 border border-slate-200 text-slate-700 text-xs px-2.5 py-1.5 rounded-lg w-36 focus:outline-none focus:border-indigo-400 placeholder-slate-400" />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => { setSelectedJob(null); setPanelMode(p => p === 'runs' ? 'none' : 'runs'); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
            panelMode === 'runs'
              ? 'text-indigo-600 bg-indigo-50 border-indigo-300'
              : 'text-slate-500 bg-white hover:bg-slate-50 border-slate-200'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          运行历史
        </button>
        <button onClick={loadJobs} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />刷新
        </button>
        <button onClick={() => setModal({ mode: 'add' })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
          <Plus className="w-3 h-3" />新建任务
        </button>
      </div>

      {error && (
        <div className="shrink-0 px-4 py-1.5 bg-red-50 border-b border-red-200 text-red-600 text-xs flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="underline">关闭</button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">

        {/* Jobs list */}
        <div className={`flex flex-col overflow-hidden ${showPanel ? 'w-[44%] border-r border-slate-200' : 'flex-1'}`}>
          <div className="flex-1 overflow-auto">
            {filteredJobs.length === 0 && !loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">暂无定时任务</p>
                  <button onClick={() => setModal({ mode: 'add' })} className="mt-3 text-xs text-indigo-500 hover:text-indigo-700">+ 新建任务</button>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 sticky top-0 bg-white">
                    <th className="text-left pl-4 pr-2 py-2 font-medium w-4"></th>
                    <th className="text-left px-2 py-2 font-medium">名称</th>
                    {!showPanel && <th className="text-left px-2 py-2 font-medium">调度</th>}
                    <th className="text-left px-2 py-2 font-medium">上次运行</th>
                    {!showPanel && <th className="text-left px-2 py-2 font-medium">下次运行</th>}
                    <th className="text-left px-2 py-2 font-medium">状态</th>
                    <th className="text-right px-4 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map(job => (
                    <tr key={job.id} onClick={() => selectJob(job)}
                      className={`border-b border-slate-100 cursor-pointer transition-colors ${
                        selectedJob?.id === job.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
                      } ${!job.enabled ? 'opacity-50' : ''}`}>
                      <td className="pl-4 pr-2 py-2.5">
                        <span className={`w-1.5 h-1.5 rounded-full inline-block ${job.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      </td>
                      <td className="px-2 py-2.5">
                        <p className="text-slate-800 font-medium truncate max-w-[140px]">{job.name}</p>
                        {job.agentId && <p className="text-slate-400 text-[10px] truncate max-w-[140px]">{job.agentId}</p>}
                      </td>
                      {!showPanel && <td className="px-2 py-2.5 text-slate-500 font-mono whitespace-nowrap">{formatSchedule(job.schedule)}</td>}
                      <td className="px-2 py-2.5 text-slate-400 whitespace-nowrap">{formatMsRelTime(job.state?.lastRunAtMs)}</td>
                      {!showPanel && <td className="px-2 py-2.5 text-slate-400 whitespace-nowrap">{job.schedule.kind === 'at' ? '-' : formatMsRelTime(job.state?.nextRunAtMs)}</td>}
                      <td className="px-2 py-2.5"><RunStatusBadge status={job.state?.lastStatus ?? job.state?.lastRunStatus} /></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5" onClick={e => e.stopPropagation()}>
                          <button title={job.enabled ? '禁用' : '启用'} onClick={() => handleToggle(job)} disabled={busy[job.id]}
                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors">
                            {job.enabled ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                          <button title="立即运行" onClick={() => handleRun(job)} disabled={busy[`run_${job.id}`]}
                            className="p-1.5 rounded text-slate-400 hover:text-amber-500 hover:bg-slate-100 disabled:opacity-50 transition-colors">
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button title="编辑" onClick={() => setModal({ mode: 'edit', job })}
                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button title="删除" onClick={() => setConfirmDelete(job)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-slate-100 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Runs panel */}
        {showPanel && (
          <div className="flex-1 overflow-hidden">
            <RunsPanel
              selectedJob={selectedJob}
              onClose={() => { setPanelMode('none'); setSelectedJob(null); }}
            />
          </div>
        )}
      </div>

      {modal && (
        <CronJobModal initial={modal.mode === 'edit' ? modal.job : undefined} agents={agents} onSave={handleSave} onClose={() => setModal(null)} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 border border-slate-200">
            <h3 className="text-slate-800 font-semibold mb-2">删除定时任务</h3>
            <p className="text-slate-500 text-sm mb-4">确认删除 <strong className="text-slate-800">"{confirmDelete.name}"</strong>？此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-1.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors">取消</button>
              <button onClick={() => handleDelete(confirmDelete)} className="px-4 py-1.5 text-sm text-white bg-red-600 hover:bg-red-500 rounded transition-colors">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
