import { useState, useEffect, useRef, useCallback } from 'react';
import { client } from '../../api/gateway';
import { ChevronDown, Search, Zap } from 'lucide-react';

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

// Module-level cache so all instances share one fetch
let cachedModels: ModelEntry[] | null = null;
let cachePromise: Promise<ModelEntry[]> | null = null;

async function fetchModels(): Promise<ModelEntry[]> {
  if (cachedModels) return cachedModels;
  if (cachePromise) return cachePromise;
  cachePromise = client.modelsList()
    .then(res => {
      cachedModels = res?.models ?? [];
      return cachedModels!;
    })
    .catch(() => {
      cachePromise = null;
      return [] as ModelEntry[];
    });
  return cachePromise;
}

function formatCtx(n?: number) {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface ModelSelectProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ModelSelect({ value, onChange, placeholder = 'provider/model', disabled, className }: ModelSelectProps) {
  const [models, setModels] = useState<ModelEntry[]>(cachedModels ?? []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cachedModels) {
      fetchModels().then(m => setModels(m));
    }
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [disabled]);

  const handleSelect = (model: ModelEntry) => {
    onChange(`${model.provider}/${model.id}`);
    setOpen(false);
    setQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  // Filter & group
  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter(m =>
        `${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(q)
      )
    : models;

  const grouped = filtered.reduce<Record<string, ModelEntry[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});
  const providers = Object.keys(grouped).sort();

  const displayValue = value || '';

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {/* Trigger */}
      <div
        onClick={handleOpen}
        className={`flex items-center gap-1.5 w-full px-3 py-2 text-sm rounded-xl cursor-pointer transition-all duration-200 ${
          disabled
            ? 'bg-white/5 border border-white/8 text-white/30 cursor-not-allowed'
            : open
            ? 'glass-input shadow-[0_0_0_3px_rgba(99,102,241,0.18),0_0_20px_rgba(99,102,241,0.10)]'
            : 'glass-input hover:border-white/25'
        }`}
      >
        <span className={`flex-1 truncate font-mono text-sm ${displayValue ? 'text-white' : 'text-white/30'}`}>
          {displayValue || placeholder}
        </span>
        {displayValue && !disabled && (
          <button
            onClick={handleClear}
            className="text-white/30 hover:text-white/60 text-xs shrink-0 px-0.5"
            tabIndex={-1}
          >
            ×
          </button>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-white/30 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 glass-heavy rounded-2xl shadow-2xl shadow-black/60 overflow-hidden ring-1 ring-white/8">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <Search className="w-3.5 h-3.5 text-white/30 shrink-0" />
            <input
              ref={inputRef}
              className="flex-1 text-sm outline-none text-white placeholder:text-white/30 bg-transparent"
              placeholder="搜索模型…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          {/* Allow free-text entry if query doesn't match any model */}
          {query && !filtered.find(m => `${m.provider}/${m.id}` === query) && (
            <button
              onMouseDown={() => { onChange(query); setOpen(false); setQuery(''); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-white/8 border-b border-white/10"
            >
              <span className="text-xs text-white/30 shrink-0">使用</span>
              <span className="font-mono text-white/70 truncate">{query}</span>
            </button>
          )}

          {/* Model list */}
          <div className="max-h-64 overflow-y-auto">
            {providers.length === 0 ? (
              <p className="px-3 py-4 text-sm text-white/30 text-center">
                {models.length === 0 ? '正在加载模型列表…' : '无匹配模型'}
              </p>
            ) : (
              providers.map(provider => (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-wide bg-white/5 sticky top-0">
                    {provider}
                  </div>
                  {grouped[provider].map(model => {
                    const ref = `${model.provider}/${model.id}`;
                    const isSelected = value === ref;
                    return (
                      <button
                        key={ref}
                        onMouseDown={() => handleSelect(model)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-500/15 transition-colors ${
                          isSelected ? 'bg-indigo-500/20' : ''
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-mono truncate ${isSelected ? 'text-indigo-300' : 'text-white/70'}`}>
                            {model.id}
                          </div>
                          {model.name !== model.id && (
                            <div className="text-[10px] text-white/30 truncate">{model.name}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {model.reasoning && (
                            <span title="支持思考" className="text-purple-400">
                              <Zap className="w-3 h-3" />
                            </span>
                          )}
                          {model.contextWindow && (
                            <span className="text-[10px] text-white/30 font-mono">
                              {formatCtx(model.contextWindow)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
