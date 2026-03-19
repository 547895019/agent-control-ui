import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { client } from '../api/gateway';
import { useAppStore } from '../stores/useAppStore';
import { BarChart2, RefreshCw, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
}

interface SessionCostSummary extends UsageTotals {
  firstActivity?: number;
  lastActivity?: number;
  activityDates?: string[];
}

interface SessionUsageEntry {
  key: string;
  label?: string;
  agentId?: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  providerOverride?: string;
  usage: SessionCostSummary | null;
  updatedAt?: number;
}

interface DailyEntry {
  date: string;
  tokens: number;
  cost: number;
  messages: number;
  toolCalls: number;
  errors: number;
}

interface ModelUsage {
  provider?: string;
  model?: string;
  count: number;
  totals: UsageTotals;
}

interface AgentUsage {
  agentId: string;
  totals: UsageTotals;
}

interface SessionsUsageResult {
  updatedAt?: number;
  startDate?: string;
  endDate?: string;
  sessions: SessionUsageEntry[];
  totals: UsageTotals;
  aggregates: {
    messages?: any;
    tools?: any;
    byModel: ModelUsage[];
    byProvider: ModelUsage[];
    byAgent: AgentUsage[];
    byChannel?: Array<{ channel: string; totals: UsageTotals }>;
    daily: DailyEntry[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (!n) return '$0.00';
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function getIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function presetRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { startDate: getIsoDate(start), endDate: getIsoDate(end) };
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0 };
}

function sumSessionTotals(sessions: SessionUsageEntry[]): UsageTotals {
  return sessions.reduce((acc, s) => {
    if (!s.usage) return acc;
    return {
      input: acc.input + (s.usage.input || 0),
      output: acc.output + (s.usage.output || 0),
      cacheRead: acc.cacheRead + (s.usage.cacheRead || 0),
      cacheWrite: acc.cacheWrite + (s.usage.cacheWrite || 0),
      totalTokens: acc.totalTokens + (s.usage.totalTokens || 0),
      totalCost: acc.totalCost + (s.usage.totalCost || 0),
      inputCost: acc.inputCost + (s.usage.inputCost || 0),
      outputCost: acc.outputCost + (s.usage.outputCost || 0),
      cacheReadCost: acc.cacheReadCost + (s.usage.cacheReadCost || 0),
      cacheWriteCost: acc.cacheWriteCost + (s.usage.cacheWriteCost || 0),
      missingCostEntries: acc.missingCostEntries + (s.usage.missingCostEntries || 0),
    };
  }, emptyTotals());
}

// Short date label for chart axes: "3/15"
function shortDate(d: string): string {
  const parts = d.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

// ── Components ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
      <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent || 'text-slate-800'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function DailyChart({ data, selectedDays, chartMode, onSelectDay }: {
  data: DailyEntry[];
  selectedDays: string[];
  chartMode: 'tokens' | 'cost';
  onSelectDay: (date: string) => void;
}) {
  if (!data.length) return <p className="text-sm text-slate-400 text-center py-8">无日期数据</p>;

  const maxVal = Math.max(...data.map(d => chartMode === 'tokens' ? d.tokens : d.cost), 1);

  const showLabel = (idx: number) => {
    if (data.length <= 8) return true;
    if (data.length <= 16) return idx % 2 === 0;
    if (data.length <= 31) return idx % 5 === 0 || idx === data.length - 1;
    return idx % 7 === 0;
  };

  return (
    <div>
      <div className="flex items-end gap-0.5 h-28">
        {data.map((d, idx) => {
          const val = chartMode === 'tokens' ? d.tokens : d.cost;
          const pct = val > 0 ? Math.max((val / maxVal) * 100, 3) : 0;
          const selected = selectedDays.includes(d.date);
          const hasErrors = d.errors > 0;
          return (
            <button
              key={d.date}
              onClick={() => onSelectDay(d.date)}
              className={`flex-1 min-w-0 rounded-t-sm transition-colors cursor-pointer ${
                selected
                  ? 'bg-indigo-500 hover:bg-indigo-400'
                  : hasErrors
                  ? 'bg-orange-300 hover:bg-orange-400'
                  : val > 0
                  ? 'bg-slate-300 hover:bg-indigo-300'
                  : 'bg-slate-100 hover:bg-slate-200'
              }`}
              style={{ height: val > 0 ? `${pct}%` : '2px', alignSelf: 'flex-end' }}
              title={`${d.date}\n${chartMode === 'tokens' ? formatTokens(val) + ' tokens' : formatCost(val)}${d.messages ? '\n' + d.messages + ' messages' : ''}${d.errors ? '\n' + d.errors + ' errors' : ''}`}
            />
          );
        })}
      </div>
      <div className="flex mt-1">
        {data.map((d, idx) => (
          <div key={d.date} className="flex-1 min-w-0 text-center">
            {showLabel(idx) && (
              <span className="text-[9px] text-slate-400">{shortDate(d.date)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenBreakdown({ totals, chartMode }: { totals: UsageTotals; chartMode: 'tokens' | 'cost' }) {
  const isToken = chartMode === 'tokens';
  const items = isToken
    ? [
        { label: 'Output', value: totals.output, color: 'bg-indigo-400' },
        { label: 'Input', value: totals.input, color: 'bg-blue-400' },
        { label: 'Cache Read', value: totals.cacheRead, color: 'bg-emerald-400' },
        { label: 'Cache Write', value: totals.cacheWrite, color: 'bg-amber-400' },
      ]
    : [
        { label: 'Output', value: totals.outputCost, color: 'bg-indigo-400' },
        { label: 'Input', value: totals.inputCost, color: 'bg-blue-400' },
        { label: 'Cache Read', value: totals.cacheReadCost, color: 'bg-emerald-400' },
        { label: 'Cache Write', value: totals.cacheWriteCost, color: 'bg-amber-400' },
      ];

  const total = isToken ? totals.totalTokens : totals.totalCost;
  const visibleItems = items.filter(i => i.value > 0);

  if (!total || !visibleItems.length) {
    return <p className="text-sm text-slate-400 text-center py-4">暂无数据</p>;
  }

  return (
    <div className="space-y-2.5">
      {visibleItems.map(item => {
        const pct = total > 0 ? (item.value / total) * 100 : 0;
        return (
          <div key={item.label}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-600">{item.label}</span>
              <span className="text-slate-800 font-medium">
                {isToken ? formatTokens(item.value) : formatCost(item.value)}
                <span className="text-slate-400 ml-1">({pct.toFixed(1)}%)</span>
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownPanel({ aggregates, chartMode }: {
  aggregates: SessionsUsageResult['aggregates'];
  chartMode: 'tokens' | 'cost';
}) {
  const [tab, setTab] = useState<'model' | 'provider' | 'agent'>('model');
  const isToken = chartMode === 'tokens';

  const rows = useMemo(() => {
    if (tab === 'model') {
      return [...(aggregates.byModel || [])]
        .map(m => ({ name: m.model || '(未知)', count: m.count, value: isToken ? m.totals.totalTokens : m.totals.totalCost }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12);
    } else if (tab === 'provider') {
      return [...(aggregates.byProvider || [])]
        .map(p => ({ name: p.provider || '(未知)', count: p.count, value: isToken ? p.totals.totalTokens : p.totals.totalCost }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12);
    } else {
      return [...(aggregates.byAgent || [])]
        .map(a => ({ name: a.agentId || '(未知)', count: 0, value: isToken ? a.totals.totalTokens : a.totals.totalCost }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12);
    }
  }, [tab, aggregates, isToken]);

  const maxVal = Math.max(...rows.map(r => r.value), 1);

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {(['model', 'provider', 'agent'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
              tab === t
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t === 'model' ? '模型' : t === 'provider' ? '供应商' : 'Agent'}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        {rows.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">无数据</p>
        )}
        {rows.map(row => {
          const pct = maxVal > 0 ? (row.value / maxVal) * 100 : 0;
          return (
            <div key={row.name}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-slate-700 font-medium truncate max-w-[55%]" title={row.name}>{row.name}</span>
                <span className="text-slate-600 shrink-0">
                  {isToken ? formatTokens(row.value) : formatCost(row.value)}
                  {row.count > 0 && <span className="text-slate-400 ml-1 font-normal">({row.count}次)</span>}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionsTable({ sessions, chartMode }: {
  sessions: SessionUsageEntry[];
  chartMode: 'tokens' | 'cost';
}) {
  const isToken = chartMode === 'tokens';

  const sorted = useMemo(() =>
    [...sessions]
      .filter(s => s.usage)
      .sort((a, b) => {
        const va = isToken ? (a.usage?.totalTokens ?? 0) : (a.usage?.totalCost ?? 0);
        const vb = isToken ? (b.usage?.totalTokens ?? 0) : (b.usage?.totalCost ?? 0);
        return vb - va;
      })
      .slice(0, 200),
    [sessions, isToken]
  );

  if (!sorted.length) return <p className="text-sm text-slate-400 text-center py-6">无会话数据</p>;

  return (
    <div className="overflow-auto max-h-80">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white z-10">
          <tr className="text-slate-500 border-b border-slate-100">
            <th className="text-left py-1.5 pr-3 font-medium">会话</th>
            <th className="text-left py-1.5 pr-3 font-medium">Agent</th>
            <th className="text-left py-1.5 pr-3 font-medium hidden sm:table-cell">模型</th>
            <th className="text-right py-1.5 font-medium">{isToken ? 'Tokens' : '费用'}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => {
            const val = isToken ? (s.usage?.totalTokens ?? 0) : (s.usage?.totalCost ?? 0);
            const label = s.label || s.key.split(':').slice(-2).join(':');
            return (
              <tr key={s.key} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 max-w-[180px]">
                  <span
                    className="font-mono text-indigo-600 cursor-pointer hover:underline block truncate"
                    onClick={() => navigator.clipboard?.writeText(s.key)}
                    title={`${s.key}\n(点击复制)`}
                  >
                    {label}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-slate-600 max-w-[100px] truncate">{s.agentId || '—'}</td>
                <td className="py-1.5 pr-3 text-slate-500 max-w-[100px] truncate hidden sm:table-cell">{s.model || '—'}</td>
                <td className="py-1.5 text-right font-medium text-slate-800 whitespace-nowrap">
                  {isToken ? formatTokens(val) : formatCost(val)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function UsagePage() {
  const { connectionStatus } = useAppStore();
  const [startDate, setStartDate] = useState(() => getIsoDate(new Date(Date.now() - 6 * 86400000)));
  const [endDate, setEndDate] = useState(() => getIsoDate(new Date()));
  const [chartMode, setChartMode] = useState<'tokens' | 'cost'>('tokens');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SessionsUsageResult | null>(null);

  // Auto-load when connected
  useEffect(() => { if (connectionStatus === 'connected') refresh(); }, [connectionStatus]);

  const applyPreset = useCallback((days: number) => {
    const r = presetRange(days);
    setStartDate(r.startDate);
    setEndDate(r.endDate);
    setSelectedDays([]);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.usageGet({ startDate, endDate });
      setResult(data);
      setSelectedDays([]);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const toggleDay = useCallback((date: string) => {
    setSelectedDays(prev =>
      prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]
    );
  }, []);

  const filteredSessions = useMemo(() => {
    if (!result?.sessions) return [];
    if (!selectedDays.length) return result.sessions;
    return result.sessions.filter(s => {
      if (s.usage?.activityDates?.length) {
        return s.usage.activityDates.some(d => selectedDays.includes(d));
      }
      if (!s.updatedAt) return false;
      return selectedDays.includes(getIsoDate(new Date(s.updatedAt)));
    });
  }, [result, selectedDays]);

  const displayTotals = useMemo(() => {
    if (!result) return null;
    if (!selectedDays.length) return result.totals;
    return sumSessionTotals(filteredSessions);
  }, [result, selectedDays, filteredSessions]);

  return (
    <div className="p-6 space-y-5 bg-slate-50 min-h-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-indigo-500" />
          使用情况
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">查看 Token 消耗、成本和会话详情</p>
      </div>

      {/* Controls bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 shrink-0">
          {[{ label: '今天', days: 1 }, { label: '7天', days: 7 }, { label: '30天', days: 30 }].map(p => (
            <button
              key={p.days}
              onClick={() => applyPreset(p.days)}
              className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors font-medium"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
          />
          <span className="text-slate-400 text-xs">至</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
          />
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
          {(['tokens', 'cost'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setChartMode(mode)}
              className={`px-3 py-1.5 transition-colors ${
                chartMode === mode ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {mode === 'tokens' ? 'Tokens' : '费用'}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors font-medium ml-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400 hover:text-red-600" /></button>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-20 text-slate-400">
          <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">选择日期范围并点击"刷新"加载使用数据</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-20 text-slate-400">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40" />
          <p className="text-sm">加载中，请稍候...</p>
        </div>
      )}

      {/* Data */}
      {result && !loading && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="总 Token 用量"
              value={formatTokens(displayTotals?.totalTokens ?? 0)}
              sub={selectedDays.length > 0
                ? `已筛选 ${selectedDays.length} 天`
                : `${result.sessions.length} 个会话`}
              accent="text-indigo-700"
            />
            <StatCard
              label="估算费用"
              value={formatCost(displayTotals?.totalCost ?? 0)}
              sub={(displayTotals?.missingCostEntries ?? 0) > 0 ? '部分数据缺少价格信息' : undefined}
              accent="text-emerald-700"
            />
            <StatCard
              label="会话数"
              value={String(filteredSessions.length)}
              sub={selectedDays.length > 0 ? `共 ${result.sessions.length} 个（已筛选）` : undefined}
              accent="text-slate-800"
            />
          </div>

          {/* Day filter chips */}
          {selectedDays.length > 0 && (
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-xs text-slate-500">按天筛选：</span>
              {[...selectedDays].sort().map(d => (
                <span key={d} className="flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">
                  {d}
                  <button onClick={() => toggleDay(d)} className="hover:text-indigo-900 leading-none">×</button>
                </span>
              ))}
              <button onClick={() => setSelectedDays([])} className="text-xs text-slate-400 hover:text-slate-600 underline">
                清除全部
              </button>
            </div>
          )}

          {/* Two-column layout */}
          <div className="grid grid-cols-5 gap-5 items-start">
            {/* Left: chart + breakdown */}
            <div className="col-span-2 space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">
                  每日{chartMode === 'tokens' ? ' Token' : '费用'}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">点击柱子筛选</span>
                </h3>
                <DailyChart
                  data={result.aggregates.daily}
                  selectedDays={selectedDays}
                  chartMode={chartMode}
                  onSelectDay={toggleDay}
                />
              </div>

              {displayTotals && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700">
                    {chartMode === 'tokens' ? 'Token 类型分布' : '费用类型分布'}
                  </h3>
                  <TokenBreakdown totals={displayTotals} chartMode={chartMode} />
                </div>
              )}
            </div>

            {/* Right: breakdown + sessions */}
            <div className="col-span-3 space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">用量分布</h3>
                <BreakdownPanel aggregates={result.aggregates} chartMode={chartMode} />
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex justify-between">
                  <span>会话列表 <span className="text-slate-400 font-normal">({filteredSessions.length})</span></span>
                  <span className="text-xs text-slate-400 font-normal">
                    按{chartMode === 'tokens' ? ' Token' : '费用'}降序 · 点击 key 可复制
                  </span>
                </h3>
                <SessionsTable sessions={filteredSessions} chartMode={chartMode} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
