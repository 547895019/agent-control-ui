import { useEffect, useRef, useState } from 'react';
import { client } from '../api/gateway';
import type { GatewayEvent } from '../api/gateway';
import { Trash2, Pause, Play } from 'lucide-react';

const EVENT_COLORS: Record<string, string> = {
  'event': 'text-indigo-400',
  'res': 'text-emerald-400',
  'req': 'text-amber-400',
  'error': 'text-red-400',
};

function getEventColor(type: string) {
  return EVENT_COLORS[type] || 'text-slate-400';
}

function getEventBg(type: string) {
  if (type === 'error') return 'border-l-red-500';
  if (type === 'res') return 'border-l-emerald-600';
  if (type === 'req') return 'border-l-amber-500';
  return 'border-l-indigo-500';
}

interface LogEntry extends GatewayEvent {
  ts: number;
  id: number;
}

let _id = 0;

export function MonitorPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  pausedRef.current = paused;

  useEffect(() => {
    const unsubscribe = client.onEvent((event) => {
      if (pausedRef.current) return;
      setLogs(prev => [...prev, { ...event, ts: Date.now(), id: _id++ }].slice(-200));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (autoScroll && !paused) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, paused]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  };

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-slate-900 shrink-0">
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">Event Log</span>
        <span className="text-slate-600 text-xs">{logs.length} events</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="w-3 h-3 accent-indigo-500"
            />
            Auto-scroll
          </label>
          <button
            onClick={() => setPaused(p => !p)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              paused
                ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {paused ? <><Play className="w-3 h-3" /> Resume</> : <><Pause className="w-3 h-3" /> Pause</>}
          </button>
          <button
            onClick={() => setLogs([])}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Log area */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping mx-auto mb-3" />
              <p className="text-slate-600">Waiting for events…</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-900">
            {logs.map(log => (
              <div
                key={log.id}
                className={`flex gap-3 px-4 py-2 hover:bg-slate-900/50 border-l-2 ${getEventBg(log.type)}`}
              >
                <span className="text-slate-600 shrink-0 w-28">{formatTime(log.ts)}</span>
                <span className={`shrink-0 w-14 ${getEventColor(log.type)}`}>
                  [{log.type}]
                </span>
                <span className="text-slate-300 break-all leading-relaxed">
                  {typeof log.data === 'object'
                    ? JSON.stringify(log.data)
                    : String(log.data ?? '')}
                </span>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {paused && (
        <div className="shrink-0 px-4 py-2 bg-amber-500/10 border-t border-amber-500/20 text-amber-400 text-xs text-center">
          Paused — new events are being dropped
        </div>
      )}
    </div>
  );
}
