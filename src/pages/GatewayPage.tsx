import { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { client } from '../api/gateway';
import {
  Save, RefreshCw, AlertCircle, CheckCircle2, FileJson, WrapText,
  Loader2, ChevronRight, ChevronDown, Plus, Trash2, Code2, LayoutList,
} from 'lucide-react';

// Use locally installed monaco-editor — no CDN, CSP-safe
(self as any).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

// ─── JSON Visual Editor ───────────────────────────────────────────────────────

type JsonPath = (string | number)[];

function pathKey(path: JsonPath) { return path.join('\x00'); }

function setAtPath(obj: any, path: JsonPath, value: any): any {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(obj)) {
    const arr = [...obj];
    arr[key as number] = setAtPath(arr[key as number], rest, value);
    return arr;
  }
  return { ...obj, [key as string]: setAtPath(obj[key as string], rest, value) };
}

function deleteAtPath(obj: any, path: JsonPath): any {
  const key = path[0];
  if (path.length === 1) {
    if (Array.isArray(obj)) return obj.filter((_, i) => i !== key);
    const copy = { ...obj };
    delete copy[key as string];
    return copy;
  }
  if (Array.isArray(obj)) {
    const arr = [...obj];
    arr[key as number] = deleteAtPath(arr[key as number], path.slice(1));
    return arr;
  }
  return { ...obj, [key as string]: deleteAtPath(obj[key as string], path.slice(1)) };
}

function typeLabel(val: any) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

// Primitive leaf editor
function PrimitiveEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const type = typeLabel(value);
  if (type === 'boolean') {
    return (
      <button
        onClick={() => onChange(!value)}
        className={`px-2 py-0.5 rounded text-xs font-mono font-semibold transition-colors ${
          value ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30' : 'bg-white/8 text-white/40 hover:bg-white/12'
        }`}
      >
        {String(value)}
      </button>
    );
  }
  if (type === 'null') {
    return <span className="text-xs font-mono text-white/30 px-1 select-none">null</span>;
  }
  if (type === 'number') {
    return (
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="text-xs font-mono bg-white/8 border border-white/15 rounded px-2 py-0.5 text-amber-300 focus:outline-none focus:border-indigo-400 w-36 min-w-0"
      />
    );
  }
  // string
  return (
    <input
      type="text"
      value={value as string}
      onChange={e => onChange(e.target.value)}
      className="text-xs font-mono bg-white/8 border border-white/15 rounded px-2 py-0.5 text-emerald-300 focus:outline-none focus:border-indigo-400 min-w-0 w-64 max-w-full"
    />
  );
}

// Add-key dialog for objects
function AddKeyRow({ onAdd }: { onAdd: (key: string) => void }) {
  const [key, setKey] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex items-center gap-1.5 ml-4 mt-1">
      <input
        ref={ref}
        value={key}
        onChange={e => setKey(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && key.trim()) { onAdd(key.trim()); setKey(''); }
          if (e.key === 'Escape') onAdd('');
        }}
        placeholder="新键名 Enter 确认 Esc 取消"
        className="text-xs font-mono bg-white/8 border border-indigo-400/40 rounded px-2 py-0.5 text-white/70 focus:outline-none focus:border-indigo-400 w-52 placeholder:text-white/25"
      />
    </div>
  );
}

// Recursive tree node
function JsonNode({
  keyLabel, value, path, depth, collapsed, onToggle, onChange, onDelete,
}: {
  keyLabel: string | number | null;
  value: any;
  path: JsonPath;
  depth: number;
  collapsed: Set<string>;
  onToggle: (p: JsonPath) => void;
  onChange: (p: JsonPath, v: any) => void;
  onDelete: (p: JsonPath) => void;
}) {
  const [addingKey, setAddingKey] = useState(false);
  const type = typeLabel(value);
  const isContainer = type === 'object' || type === 'array';
  const pk = pathKey(path);
  const isCollapsed = collapsed.has(pk);

  const indent = `${depth * 16}px`;
  const typeColorMap: Record<string, string> = {
    string: 'text-emerald-400', number: 'text-amber-400',
    boolean: 'text-cyan-400', null: 'text-white/30',
    object: 'text-indigo-300', array: 'text-purple-300',
  };
  const typeColor = typeColorMap[type] ?? 'text-white/60';

  const childCount = isContainer
    ? (type === 'array' ? (value as any[]).length : Object.keys(value).length)
    : 0;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5 group hover:bg-white/4 rounded pr-2"
        style={{ paddingLeft: indent }}
      >
        {/* Collapse toggle */}
        {isContainer ? (
          <button
            onClick={() => onToggle(path)}
            className="w-4 h-4 flex items-center justify-center text-white/30 hover:text-white/70 shrink-0"
          >
            {isCollapsed
              ? <ChevronRight className="w-3 h-3" />
              : <ChevronDown className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Key */}
        {keyLabel !== null && (
          <span className="text-xs font-mono text-white/50 shrink-0 select-none">
            {typeof keyLabel === 'number'
              ? <span className="text-purple-300/60">{keyLabel}</span>
              : keyLabel}
            <span className="text-white/20 ml-0.5">:</span>
          </span>
        )}

        {/* Value */}
        {isContainer ? (
          <span className={`text-xs font-mono ${typeColor} select-none`}>
            {type === 'array' ? '[' : '{'}
            {isCollapsed && (
              <span className="text-white/25 ml-1">
                {childCount} {type === 'array' ? '项' : '键'}
              </span>
            )}
            {isCollapsed && <span className="ml-0.5">{type === 'array' ? ']' : '}'}</span>}
          </span>
        ) : (
          <PrimitiveEditor value={value} onChange={v => onChange(path, v)} />
        )}

        {/* Actions */}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {isContainer && !isCollapsed && (
            <button
              onClick={() => setAddingKey(true)}
              title={type === 'array' ? '添加元素' : '添加键'}
              className="w-5 h-5 flex items-center justify-center rounded text-white/30 hover:text-indigo-300 hover:bg-indigo-500/15 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
          {path.length > 0 && (
            <button
              onClick={() => onDelete(path)}
              title="删除"
              className="w-5 h-5 flex items-center justify-center rounded text-white/30 hover:text-red-400 hover:bg-red-500/15 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Add-key input */}
      {isContainer && addingKey && (
        <AddKeyRow onAdd={key => {
          setAddingKey(false);
          if (!key) return;
          if (type === 'array') onChange(path, [...(value as any[]), '']);
          else onChange(path, { ...value, [key]: '' });
        }} />
      )}

      {/* Children */}
      {isContainer && !isCollapsed && (
        <>
          {type === 'array'
            ? (value as any[]).map((item, i) => (
                <JsonNode
                  key={i} keyLabel={i} value={item}
                  path={[...path, i]} depth={depth + 1}
                  collapsed={collapsed} onToggle={onToggle}
                  onChange={onChange} onDelete={onDelete}
                />
              ))
            : Object.entries(value).map(([k, v]) => (
                <JsonNode
                  key={k} keyLabel={k} value={v}
                  path={[...path, k]} depth={depth + 1}
                  collapsed={collapsed} onToggle={onToggle}
                  onChange={onChange} onDelete={onDelete}
                />
              ))
          }
          {/* Closing bracket */}
          <div className="flex items-center py-0.5 select-none" style={{ paddingLeft: indent }}>
            <span className="w-4 shrink-0" />
            <span className="text-xs font-mono text-indigo-300/50">
              {type === 'array' ? ']' : '}'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function JsonVisualEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const onToggle = useCallback((path: JsonPath) => {
    const k = pathKey(path);
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }, []);

  const onNodeChange = useCallback((path: JsonPath, v: any) => {
    onChange(setAtPath(value, path, v));
  }, [value, onChange]);

  const onNodeDelete = useCallback((path: JsonPath) => {
    onChange(deleteAtPath(value, path));
  }, [value, onChange]);

  return (
    <div data-sidebar-scroll className="h-full overflow-y-auto px-3 py-3 text-sm">
      <JsonNode
        keyLabel={null} value={value} path={[]} depth={0}
        collapsed={collapsed} onToggle={onToggle}
        onChange={onNodeChange} onDelete={onNodeDelete}
      />
    </div>
  );
}

// ─── GatewayPage ─────────────────────────────────────────────────────────────

type ViewMode = 'code' | 'visual';

export function GatewayPage() {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [configHash, setConfigHash] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('visual');
  const [switchError, setSwitchError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await client.configGet();
      const text = JSON.stringify(res?.config ?? {}, null, 2);
      setContent(text);
      setOriginal(text);
      setConfigHash(res?.hash ?? '');
      setSavedAt(null);
    } catch (e: any) {
      setLoadError(e.message || '读取配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFormat = () => {
    try {
      setContent(JSON.stringify(JSON.parse(content), null, 2));
    } catch {}
  };

  const handleSave = async () => {
    let parsed: any;
    try { parsed = JSON.parse(content); } catch (e: any) {
      setSaveError('JSON 格式错误：' + e.message);
      return;
    }
    if (!configHash) { setSaveError('配置 Hash 未加载，请刷新'); return; }
    setSaving(true);
    setSaveError('');
    setSavedAt(null);
    try {
      await client.configApply(parsed, configHash);
      const res = await client.configGet();
      setConfigHash(res?.hash ?? configHash);
      setOriginal(content);
      setSavedAt(Date.now());
    } catch (e: any) {
      setSaveError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const switchMode = (mode: ViewMode) => {
    setSwitchError('');
    if (mode === 'visual') {
      try { JSON.parse(content); } catch (e: any) {
        setSwitchError('JSON 格式错误，无法切换到可视化模式');
        return;
      }
    }
    setViewMode(mode);
  };

  // Visual editor operates on parsed object; sync back to content string
  const parsedValue = (() => { try { return JSON.parse(content); } catch { return {}; } })();
  const handleVisualChange = useCallback((newVal: any) => {
    setContent(JSON.stringify(newVal, null, 2));
    setSavedAt(null);
    setSaveError('');
  }, []);

  const isDirty = content !== original;

  return (
    <div className="p-6 h-full flex flex-col gap-3 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0">
          <FileJson className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-white font-semibold text-base leading-tight">网关配置</h1>
          <p className="text-white/35 text-xs font-mono truncate">~/.openclaw/openclaw.json</p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center rounded-lg bg-white/8 border border-white/10 p-0.5 shrink-0">
          <button
            onClick={() => switchMode('visual')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${
              viewMode === 'visual' ? 'bg-indigo-600 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />可视化
          </button>
          <button
            onClick={() => switchMode('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${
              viewMode === 'code' ? 'bg-indigo-600 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />代码
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {(saveError || switchError) && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{saveError || switchError}
            </span>
          )}
          {savedAt && !isDirty && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />已保存
            </span>
          )}
          {viewMode === 'code' && (
            <button
              onClick={handleFormat}
              disabled={loading || saving || !!loadError}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/8 border border-white/10 rounded-lg hover:bg-white/12 transition-colors disabled:opacity-40"
            >
              <WrapText className="w-3.5 h-3.5" />格式化
            </button>
          )}
          <button
            onClick={load}
            disabled={loading || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/8 border border-white/10 rounded-lg hover:bg-white/12 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />刷新
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !isDirty}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {/* Load error */}
      {loadError && !loading && (
        <div className="flex items-center gap-2 p-3 bg-red-500/15 border border-red-400/25 rounded-xl text-sm text-red-300 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />{loadError}
        </div>
      )}

      {/* Dirty indicator */}
      {isDirty && !loading && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400/80 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          有未保存的修改
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-white/10 bg-black/20">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-white/40" />
          </div>
        ) : viewMode === 'code' ? (
          <Editor
            height="100%"
            language="json"
            value={content}
            onChange={v => { setContent(v ?? ''); setSavedAt(null); setSaveError(''); setSwitchError(''); }}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              tabSize: 2,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              automaticLayout: true,
              padding: { top: 12, bottom: 12 },
            }}
          />
        ) : (
          <JsonVisualEditor value={parsedValue} onChange={handleVisualChange} />
        )}
      </div>
    </div>
  );
}
