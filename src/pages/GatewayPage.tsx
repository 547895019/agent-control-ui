import { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { client } from '../api/gateway';
import {
  Save, RefreshCw, AlertCircle, CheckCircle2, FileJson, WrapText,
  Loader2, Plus, Trash2, Code2, LayoutList, Eye, EyeOff, ChevronDown,
  Bot, Key, Shield, Network, MessageSquare, Zap, Puzzle, Package,
  Settings, Database, Wrench, Link, Clock, Radio,
} from 'lucide-react';

(self as any).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function typeOf(val: any): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

const SECTION_ICONS: Record<string, any> = {
  env: Key, auth: Shield, agents: Bot, channels: MessageSquare,
  gateway: Network, tools: Wrench, models: Database, skills: Puzzle,
  plugins: Package, bindings: Link, hooks: Zap, session: Clock,
  update: RefreshCw, media: Radio, commands: Settings,
  wizard: Settings, meta: FileJson, messages: MessageSquare,
};

const SECTION_LABELS: Record<string, string> = {
  env: '环境变量', auth: '认证', agents: '代理', channels: '频道',
  gateway: '网关', tools: '工具', models: '模型', skills: '技能',
  plugins: '插件', bindings: '绑定', hooks: '钩子', session: '会话',
  update: '更新', media: '媒体', commands: '命令',
  wizard: '向导', meta: '元信息', messages: '消息',
};

function sectionIcon(key: string) { return SECTION_ICONS[key] ?? Settings; }
function sectionLabel(key: string) { return SECTION_LABELS[key] ?? key; }

const SENSITIVE_KEYS = /key|token|secret|password|api[-_]?key|auth|credential/i;
function isSensitive(key: string) { return SENSITIVE_KEYS.test(key); }

function setIn(obj: any, keys: string[], val: any): any {
  if (keys.length === 0) return val;
  const [head, ...tail] = keys;
  if (Array.isArray(obj)) {
    const arr = [...obj];
    arr[Number(head)] = setIn(arr[Number(head)], tail, val);
    return arr;
  }
  return { ...obj, [head]: setIn(obj[head], tail, val) };
}

function deleteIn(obj: any, keys: string[]): any {
  const [head, ...tail] = keys;
  if (tail.length === 0) {
    if (Array.isArray(obj)) return obj.filter((_, i) => String(i) !== head);
    const copy = { ...obj }; delete copy[head]; return copy;
  }
  if (Array.isArray(obj)) {
    const arr = [...obj];
    arr[Number(head)] = deleteIn(arr[Number(head)], tail);
    return arr;
  }
  return { ...obj, [head]: deleteIn(obj[head], tail) };
}

// ─── Primitive editors ───────────────────────────────────────────────────────

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ${value ? 'bg-indigo-500' : 'bg-white/20'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${value ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

function StringInput({ value, keyName, onChange }: { value: string; keyName: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  const sensitive = isSensitive(keyName);
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <input
        type={sensitive && !show ? 'password' : 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 min-w-0 text-xs font-mono bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-white/80 focus:outline-none focus:border-indigo-400/60 focus:bg-black/40 transition-colors"
      />
      {sensitive && (
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="w-6 h-6 flex items-center justify-center rounded text-white/25 hover:text-white/60 transition-colors shrink-0"
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      className="w-36 text-xs font-mono bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-amber-300 focus:outline-none focus:border-indigo-400/60 transition-colors"
    />
  );
}

// ─── Add-key input ────────────────────────────────────────────────────────────

function AddKeyInput({ onAdd }: { onAdd: (key: string) => void }) {
  const [val, setVal] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && val.trim()) { onAdd(val.trim()); setVal(''); }
          if (e.key === 'Escape') onAdd('');
        }}
        placeholder="新键名 · Enter 确认  Esc 取消"
        className="flex-1 text-xs font-mono bg-black/30 border border-indigo-500/40 rounded-lg px-3 py-1.5 text-white/70 focus:outline-none focus:border-indigo-400 placeholder:text-white/20"
      />
    </div>
  );
}

// ─── Value editor (recursive) ─────────────────────────────────────────────────

interface ValueEditorProps {
  value: any;
  keyName: string;
  depth: number;
  onChange: (v: any) => void;
  onDelete?: () => void;
}

function ValueEditor({ value, keyName, depth, onChange, onDelete }: ValueEditorProps) {
  const type = typeOf(value);

  if (type === 'object') return (
    <ObjectEditor value={value} keyName={keyName} depth={depth} onChange={onChange} onDelete={onDelete} />
  );
  if (type === 'array') return (
    <ArrayEditor value={value} keyName={keyName} depth={depth} onChange={onChange} onDelete={onDelete} />
  );
  // Primitive row
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {type === 'boolean' && (
        <div className="flex items-center gap-2 flex-1">
          <ToggleSwitch value={value} onChange={onChange} />
          <span className={`text-xs font-mono ${value ? 'text-indigo-300' : 'text-white/30'}`}>{String(value)}</span>
        </div>
      )}
      {type === 'string' && (
        <StringInput value={value} keyName={keyName} onChange={onChange} />
      )}
      {type === 'number' && <NumberInput value={value} onChange={onChange} />}
      {type === 'null' && (
        <button
          onClick={() => onChange('')}
          className="text-xs font-mono text-white/25 border border-white/10 rounded px-2 py-0.5 hover:border-indigo-400/40 hover:text-white/50 transition-colors"
        >
          null
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 ml-auto"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Object editor ────────────────────────────────────────────────────────────

function ObjectEditor({ value, keyName, depth, onChange, onDelete }: ValueEditorProps) {
  const [open, setOpen] = useState(depth < 2);
  const [addingKey, setAddingKey] = useState(false);
  const keys = Object.keys(value);

  const handleChange = (k: string, v: any) => onChange({ ...value, [k]: v });
  const handleDelete = (k: string) => {
    const copy = { ...value }; delete copy[k]; onChange(copy);
  };

  const body = (
    <div className="divide-y divide-white/5">
      {keys.map(k => (
        <FormRow key={k} label={k} depth={depth}>
          <ValueEditor
            value={value[k]} keyName={k} depth={depth + 1}
            onChange={v => handleChange(k, v)}
            onDelete={() => handleDelete(k)}
          />
        </FormRow>
      ))}
      {addingKey && (
        <AddKeyInput onAdd={k => {
          setAddingKey(false);
          if (k) onChange({ ...value, [k]: '' });
        }} />
      )}
      <div className="px-3 py-1.5">
        <button
          onClick={() => setAddingKey(true)}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-indigo-300 transition-colors"
        >
          <Plus className="w-3 h-3" />添加键
        </button>
      </div>
    </div>
  );

  // Depth 0 is the root — rendered by VisualRoot as cards
  // Depth 1+ is a nested object → collapsible sub-section
  if (depth >= 1) {
    return (
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors mb-1"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="font-mono">{`{${keys.length} 键}`}</span>
          {onDelete && (
            <span
              onClick={e => { e.stopPropagation(); onDelete?.(); }}
              className="ml-1 w-4 h-4 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </span>
          )}
        </button>
        {open && (
          <div className="border border-white/8 rounded-xl overflow-hidden bg-white/3 ml-1">
            {body}
          </div>
        )}
      </div>
    );
  }

  return body;
}

// ─── Array editor ─────────────────────────────────────────────────────────────

function ArrayEditor({ value, keyName, depth, onChange, onDelete }: ValueEditorProps) {
  const [open, setOpen] = useState(depth < 2);
  const arr = value as any[];

  const handleChange = (i: number, v: any) => {
    const copy = [...arr]; copy[i] = v; onChange(copy);
  };
  const handleDelete = (i: number) => onChange(arr.filter((_, idx) => idx !== i));
  const handleAdd = () => onChange([...arr, typeOf(arr[0]) === 'object' ? {} : '']);

  const body = (
    <div className="divide-y divide-white/5">
      {arr.map((item, i) => (
        <FormRow key={i} label={String(i)} depth={depth} indexLabel>
          <ValueEditor
            value={item} keyName={keyName} depth={depth + 1}
            onChange={v => handleChange(i, v)}
            onDelete={() => handleDelete(i)}
          />
        </FormRow>
      ))}
      <div className="px-3 py-1.5">
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-indigo-300 transition-colors"
        >
          <Plus className="w-3 h-3" />添加项
        </button>
      </div>
    </div>
  );

  if (depth >= 1) {
    return (
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors mb-1"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="font-mono">{`[${arr.length} 项]`}</span>
          {onDelete && (
            <span
              onClick={e => { e.stopPropagation(); onDelete?.(); }}
              className="ml-1 w-4 h-4 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </span>
          )}
        </button>
        {open && (
          <div className="border border-white/8 rounded-xl overflow-hidden bg-white/3 ml-1">
            {body}
          </div>
        )}
      </div>
    );
  }

  return body;
}

// ─── Form row ─────────────────────────────────────────────────────────────────

function FormRow({ label, depth, indexLabel, children }: {
  label: string; depth: number; indexLabel?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 hover:bg-white/3 transition-colors group">
      <span className={`text-xs font-mono shrink-0 mt-1.5 select-none w-36 truncate ${indexLabel ? 'text-purple-300/50' : 'text-white/40'}`}>
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── Section card (top-level key) ─────────────────────────────────────────────

function SectionCard({ sectionKey, value, onChange, onDelete }: {
  sectionKey: string; value: any; onChange: (v: any) => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(true);
  const Icon = sectionIcon(sectionKey);
  const type = typeOf(value);
  const count = type === 'object' ? Object.keys(value).length
    : type === 'array' ? (value as any[]).length : null;

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-white/3 backdrop-blur-sm">
      {/* Card header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/8 transition-colors text-left"
      >
        <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white/90">{sectionLabel(sectionKey)}</span>
          <span className="text-xs text-white/25 font-mono">{sectionKey}</span>
          {count !== null && (
            <span className="text-xs text-white/20 font-mono">
              {type === 'array' ? `[${count}]` : `{${count}}`}
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`} />
      </button>

      {/* Card body */}
      {open && (
        <div className="divide-y divide-white/5">
          {type === 'object' && (
            <ObjectEditor value={value} keyName={sectionKey} depth={1} onChange={onChange} />
          )}
          {type === 'array' && (
            <ArrayEditor value={value} keyName={sectionKey} depth={1} onChange={onChange} />
          )}
          {type !== 'object' && type !== 'array' && (
            <div className="px-4 py-3">
              <ValueEditor value={value} keyName={sectionKey} depth={1} onChange={onChange} onDelete={onDelete} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Visual root ──────────────────────────────────────────────────────────────

function JsonVisualEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [addingKey, setAddingKey] = useState(false);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return (
      <div className="p-4">
        <ValueEditor value={value} keyName="root" depth={0} onChange={onChange} />
      </div>
    );
  }

  const keys = Object.keys(value);
  return (
    <div data-sidebar-scroll className="h-full overflow-y-auto px-4 py-4 space-y-3">
      {keys.map(k => (
        <SectionCard
          key={k}
          sectionKey={k}
          value={value[k]}
          onChange={v => onChange({ ...value, [k]: v })}
          onDelete={() => { const copy = { ...value }; delete copy[k]; onChange(copy); }}
        />
      ))}
      {addingKey ? (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden">
          <AddKeyInput onAdd={k => {
            setAddingKey(false);
            if (k) onChange({ ...value, [k]: '' });
          }} />
        </div>
      ) : (
        <button
          onClick={() => setAddingKey(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-white/10 text-xs text-white/25 hover:text-white/50 hover:border-white/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />添加顶层配置项
        </button>
      )}
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
    try { setContent(JSON.stringify(JSON.parse(content), null, 2)); } catch {}
  };

  const handleSave = async () => {
    let parsed: any;
    try { parsed = JSON.parse(content); } catch (e: any) {
      setSaveError('JSON 格式错误：' + e.message); return;
    }
    if (!configHash) { setSaveError('配置 Hash 未加载，请刷新'); return; }
    setSaving(true); setSaveError(''); setSavedAt(null);
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
        setSwitchError('JSON 格式错误，无法切换到可视化模式'); return;
      }
    }
    setViewMode(mode);
  };

  const parsedValue = (() => { try { return JSON.parse(content); } catch { return {}; } })();

  const handleVisualChange = useCallback((newVal: any) => {
    setContent(JSON.stringify(newVal, null, 2));
    setSavedAt(null); setSaveError('');
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

        {/* Mode toggle */}
        <div className="flex items-center rounded-lg bg-white/8 border border-white/10 p-0.5 shrink-0">
          <button
            onClick={() => switchMode('visual')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${viewMode === 'visual' ? 'bg-indigo-600 text-white shadow' : 'text-white/50 hover:text-white'}`}
          >
            <LayoutList className="w-3.5 h-3.5" />可视化
          </button>
          <button
            onClick={() => switchMode('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${viewMode === 'code' ? 'bg-indigo-600 text-white shadow' : 'text-white/50 hover:text-white'}`}
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
            <button onClick={handleFormat} disabled={loading || saving || !!loadError}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/8 border border-white/10 rounded-lg hover:bg-white/12 transition-colors disabled:opacity-40">
              <WrapText className="w-3.5 h-3.5" />格式化
            </button>
          )}
          <button onClick={load} disabled={loading || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/8 border border-white/10 rounded-lg hover:bg-white/12 transition-colors disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />刷新
          </button>
          <button onClick={handleSave} disabled={saving || loading || !isDirty}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {loadError && !loading && (
        <div className="flex items-center gap-2 p-3 bg-red-500/15 border border-red-400/25 rounded-xl text-sm text-red-300 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />{loadError}
        </div>
      )}
      {isDirty && !loading && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400/80 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />有未保存的修改
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
            height="100%" language="json" value={content} theme="vs-dark"
            onChange={v => { setContent(v ?? ''); setSavedAt(null); setSaveError(''); setSwitchError(''); }}
            options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 2, scrollBeyondLastLine: false, wordWrap: 'on', lineNumbers: 'on', renderLineHighlight: 'line', automaticLayout: true, padding: { top: 12, bottom: 12 } }}
          />
        ) : (
          <JsonVisualEditor value={parsedValue} onChange={handleVisualChange} />
        )}
      </div>
    </div>
  );
}
