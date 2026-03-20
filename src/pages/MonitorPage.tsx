import React, { useState, useEffect, useRef, useCallback } from 'react';
import { client } from '../api/gateway';
import { RefreshCw, Download, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

type LogEntry = {
  raw: string;
  time?: string | null;
  level?: LogLevel | null;
  subsystem?: string | null;
  message?: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LEVELS_SET = new Set<string>(LEVELS);
const LOG_BUFFER = 2000;

const LEVEL_STYLES: Record<LogLevel, { chip: string; row: string; label: string }> = {
  trace: { chip: 'text-white/50 bg-slate-800 border-white/15',      row: '',                        label: 'text-white/50' },
  debug: { chip: 'text-white/40 bg-slate-800 border-slate-600',      row: '',                        label: 'text-white/40' },
  info:  { chip: 'text-sky-400   bg-sky-950/50  border-sky-800',      row: 'bg-sky-950/20',           label: 'text-sky-400'   },
  warn:  { chip: 'text-amber-400 bg-amber-950/50 border-amber-700',   row: 'bg-amber-950/20',         label: 'text-amber-400' },
  error: { chip: 'text-red-400   bg-red-950/50  border-red-700',      row: 'bg-red-950/20',           label: 'text-red-400'   },
  fatal: { chip: 'text-red-300   bg-red-900/60  border-red-600',      row: 'bg-red-950/40',           label: 'text-red-300'   },
};

// ── Parsers ───────────────────────────────────────────────────────────────────

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\]8;;.*?\x1b\\/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '');
}

function normalizeLevel(value: unknown): LogLevel | null {
  if (typeof value !== 'string') return null;
  const l = value.toLowerCase();
  return LEVELS_SET.has(l) ? (l as LogLevel) : null;
}

function parseMaybeJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const p = JSON.parse(t);
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
  } catch { return null; }
}

function parseLogLine(raw: string): LogEntry {
  const clean = stripAnsi(raw);
  if (!clean.trim()) return { raw: clean, message: clean };
  try {
    const obj = JSON.parse(clean) as Record<string, unknown>;
    const meta = obj._meta && typeof obj._meta === 'object'
      ? (obj._meta as Record<string, unknown>) : null;
    const time = typeof obj.time === 'string' ? obj.time
      : typeof meta?.date === 'string' ? (meta.date as string) : null;
    const level = normalizeLevel(meta?.logLevelName ?? meta?.level);
    const contextCandidate = typeof obj['0'] === 'string' ? obj['0']
      : typeof meta?.name === 'string' ? (meta.name as string) : null;
    const contextObj = parseMaybeJson(contextCandidate);
    let subsystem: string | null = null;
    if (contextObj) {
      subsystem = typeof contextObj.subsystem === 'string' ? contextObj.subsystem
        : typeof contextObj.module === 'string' ? contextObj.module : null;
    }
    if (!subsystem && contextCandidate && contextCandidate.length < 120) subsystem = contextCandidate;
    let message: string | null = null;
    if (typeof obj['1'] === 'string') message = obj['1'];
    else if (typeof obj['2'] === 'string') message = obj['2'];
    else if (!contextObj && typeof obj['0'] === 'string') message = obj['0'];
    else if (typeof obj.message === 'string') message = obj.message;
    return { raw: clean, time, level, subsystem, message: message ?? clean };
  } catch {
    return { raw: clean, message: clean };
  }
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleTimeString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MonitorPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>(
    Object.fromEntries(LEVELS.map(l => [l, true])) as Record<LogLevel, boolean>
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<number | null>(null);
  cursorRef.current = cursor;

  const load = useCallback(async (reset?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.logsTail({
        cursor: reset ? undefined : (cursorRef.current ?? undefined),
        limit: 500,
        maxBytes: 512 * 1024,
      });
      const lines = Array.isArray(res.lines)
        ? res.lines.filter((l): l is string => typeof l === 'string')
        : [];
      const parsed = lines.map(parseLogLine);
      const shouldReset = reset || res.reset || cursorRef.current == null;
      setEntries(prev => shouldReset ? parsed : [...prev, ...parsed].slice(-LOG_BUFFER));
      if (typeof res.cursor === 'number') setCursor(res.cursor);
      if (typeof res.file === 'string') setFile(res.file);
      setTruncated(Boolean(res.truncated));
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling every 3s
  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  // Auto-follow scroll — use scrollTop instead of scrollIntoView to avoid
  // polluting the outer scroll container when navigating away from this page.
  useEffect(() => {
    if (autoFollow && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [entries, autoFollow]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoFollow(scrollHeight - scrollTop - clientHeight < 60);
  };

  const needle = filterText.trim().toLowerCase();
  const filtered = entries.filter(e => {
    if (e.level && !levelFilters[e.level]) return false;
    if (!needle) return true;
    return [e.message, e.subsystem, e.raw].filter(Boolean).join(' ').toLowerCase().includes(needle);
  });

  const handleExport = () => {
    const text = filtered.map(e => e.raw).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'gateway.log'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-white/30">

      {/* Toolbar */}
      <div className="shrink-0 px-4 py-2 border-b border-white/10 bg-slate-900 flex items-center gap-3 flex-wrap">
        <span className="text-white/40 text-xs font-medium uppercase tracking-wide">网关日志</span>
        <span className="text-white/70 text-xs">
          {filtered.length === entries.length ? `${entries.length} 条` : `${filtered.length} / ${entries.length} 条`}
        </span>

        {/* Level filter chips */}
        <div className="flex gap-1 flex-wrap">
          {LEVELS.map(level => {
            const active = levelFilters[level];
            const s = LEVEL_STYLES[level];
            return (
              <label
                key={level}
                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors select-none ${
                  active ? s.chip : 'text-white/80 bg-slate-900 border-white/10'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={active}
                  onChange={e => setLevelFilters(prev => ({ ...prev, [level]: e.target.checked }))}
                />
                {level}
              </label>
            );
          })}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <input
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              placeholder="搜索..."
              className="bg-slate-800 border border-white/15 text-white/30 text-xs px-2.5 py-1 rounded w-36 focus:outline-none focus:border-indigo-500 placeholder:text-white/30"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/30"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-white/40 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoFollow}
              onChange={e => setAutoFollow(e.target.checked)}
              className="w-3 h-3 accent-indigo-500"
            />
            跟随
          </label>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-white/40 bg-slate-800 hover:bg-white/10 border border-white/15 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-white/40 bg-slate-800 hover:bg-white/10 border border-white/15 transition-colors disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            导出
          </button>
        </div>
      </div>

      {/* Status bar */}
      {(file || truncated || error) && (
        <div className="shrink-0 px-4 py-1 bg-slate-900/80 border-b border-white/10 flex items-center gap-4 text-[10px]">
          {file && <span className="text-white/70 font-mono truncate">{file}</span>}
          {truncated && <span className="text-amber-500">日志已截断，仅显示最新部分</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}

      {/* Log area */}
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-xs" onScroll={handleScroll}>
        {entries.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping mx-auto mb-3" />
              <p className="text-white/70">等待日志…</p>
            </div>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {filtered.map((entry, i) => {
                const s = entry.level ? LEVEL_STYLES[entry.level] : null;
                return (
                  <tr
                    key={i}
                    className={`border-b border-slate-900/60 hover:bg-white/10/30 ${s?.row ?? ''}`}
                  >
                    <td className="pl-4 pr-2 py-0.5 text-white/70 whitespace-nowrap align-top w-24">
                      {formatTime(entry.time)}
                    </td>
                    <td className={`px-2 py-0.5 whitespace-nowrap align-top w-12 ${s?.label ?? 'text-white/70'}`}>
                      {entry.level ?? ''}
                    </td>
                    <td className="px-2 py-0.5 text-white/50 whitespace-nowrap align-top w-40 max-w-[10rem] truncate">
                      {entry.subsystem ?? ''}
                    </td>
                    <td className="px-2 py-0.5 pr-4 text-white/30 break-all leading-relaxed align-top">
                      {entry.message ?? entry.raw}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
