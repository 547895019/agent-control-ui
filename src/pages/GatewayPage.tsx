import { useState, useEffect, useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { client } from '../api/gateway';
import { Save, RefreshCw, AlertCircle, CheckCircle2, FileJson, WrapText, Loader2 } from 'lucide-react';

// Use locally installed monaco-editor — no CDN, CSP-safe
(self as any).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

const FILE_PATH = '~/.openclaw/openclaw.json';

export function GatewayPage() {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const text = await client.readFile(FILE_PATH);
      setContent(text);
      setOriginal(text);
      setSavedAt(null);
    } catch (e: any) {
      setLoadError(e.message || '读取文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed, null, 2));
    } catch {}
  };

  const handleSave = async () => {
    try { JSON.parse(content); } catch (e: any) {
      setSaveError('JSON 格式错误：' + e.message);
      return;
    }
    setSaving(true);
    setSaveError('');
    setSavedAt(null);
    try {
      await client.writeFile(FILE_PATH, content);
      setOriginal(content);
      setSavedAt(Date.now());
    } catch (e: any) {
      setSaveError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const isDirty = content !== original;

  return (
    <div className="p-6 h-full flex flex-col gap-4 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0">
          <FileJson className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-white font-semibold text-base leading-tight">网关配置</h1>
          <p className="text-white/35 text-xs font-mono truncate">{FILE_PATH}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {saveError && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{saveError}
            </span>
          )}
          {savedAt && !isDirty && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />已保存
            </span>
          )}
          <button
            onClick={handleFormat}
            disabled={loading || saving || !!loadError}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/8 border border-white/10 rounded-lg hover:bg-white/12 transition-colors disabled:opacity-40"
          >
            <WrapText className="w-3.5 h-3.5" />格式化
          </button>
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

      {/* Editor */}
      <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-white/10">
        {loading ? (
          <div className="h-full flex items-center justify-center bg-black/30">
            <Loader2 className="w-5 h-5 animate-spin text-white/40" />
          </div>
        ) : (
          <Editor
            height="100%"
            language="json"
            value={content}
            onChange={v => { setContent(v ?? ''); setSavedAt(null); setSaveError(''); }}
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
        )}
      </div>
    </div>
  );
}
