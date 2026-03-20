import { useState, useEffect, useCallback } from 'react';
import { client } from '../../api/gateway';
import { X, Save, Loader2, AlertCircle, FileText, CheckCircle2, HelpCircle } from 'lucide-react';
import { AgentFilesGuide } from './AgentFilesGuide';

const CORE_FILES = [
  'IDENTITY.md',
  'AGENTS.md',
  'SOUL.md',
  'MEMORY.md',
  'USER.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'TOOLS.md',
];

interface FileState {
  content: string;
  original: string;
  loaded: boolean;
  missing: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  savedAt: number | null;
}

function emptyFile(): FileState {
  return { content: '', original: '', loaded: false, missing: false, loading: false, saving: false, error: '', savedAt: null };
}

interface AgentFilesEditorProps {
  agentId: string;
  agentName: string;
  workspace: string;
  onClose: () => void;
}

export function AgentFilesEditor({ agentId, agentName, workspace, onClose }: AgentFilesEditorProps) {
  const [activeFile, setActiveFile] = useState(CORE_FILES[0]);
  const [showGuide, setShowGuide] = useState(false);
  const [files, setFiles] = useState<Record<string, FileState>>(() =>
    Object.fromEntries(CORE_FILES.map(f => [f, emptyFile()]))
  );

  const setFile = (name: string, patch: Partial<FileState>) => {
    setFiles(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  };

  const loadFile = useCallback(async (name: string) => {
    if (files[name].loaded || files[name].loading) return;
    setFile(name, { loading: true, error: '' });
    try {
      const res = await client.agentFilesGet(agentId, name);
      const content = res?.file?.content ?? '';
      const missing = res?.file?.missing ?? false;
      setFile(name, { content, original: content, loaded: true, missing, loading: false });
    } catch (err: any) {
      setFile(name, { loading: false, error: err.message || '加载失败' });
    }
  }, [agentId, files]);

  useEffect(() => {
    loadFile(activeFile);
  }, [activeFile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeFile, files]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const f = files[activeFile];
    if (f.saving) return;
    setFile(activeFile, { saving: true, error: '' });
    try {
      await client.agentFilesSet(agentId, activeFile, f.content);
      setFile(activeFile, { saving: false, original: f.content, missing: false, savedAt: Date.now() });
    } catch (err: any) {
      setFile(activeFile, { saving: false, error: err.message || '保存失败' });
    }
  };

  const current = files[activeFile];
  const isDirty = current.content !== current.original && current.loaded;

  return (
    <>
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-semibold text-white text-sm truncate">{agentName}</span>
            <span className="text-white/40 text-xs font-mono truncate hidden sm:block">
              {workspace.length > 50 ? '…' + workspace.slice(-47) : workspace}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowGuide(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-white/50 hover:text-indigo-300 hover:bg-indigo-500/15 transition-colors"
              title="查看核心文件操作指南"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">指南</span>
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* File list sidebar */}
          <div className="w-44 shrink-0 border-r border-white/10 overflow-y-auto py-2">
            {CORE_FILES.map(name => {
              const f = files[name];
              const dirty = f.loaded && f.content !== f.original;
              const isActive = name === activeFile;
              return (
                <button
                  key={name}
                  onClick={() => setActiveFile(name)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                      : 'text-white/60 hover:bg-white/8'
                  }`}
                >
                  <span className="flex-1 truncate font-mono text-xs">{name}</span>
                  {f.loading && <Loader2 className="w-3 h-3 animate-spin text-white/40 shrink-0" />}
                  {!f.loading && dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  {!f.loading && f.savedAt && !dirty && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                  {!f.loading && f.missing && !dirty && (
                    <span className="text-[10px] text-white/40 shrink-0">新建</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Editor area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* File name bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-white/5 shrink-0">
              <span className="text-xs font-mono text-white/50">{activeFile}</span>
              {current.missing && !isDirty && (
                <span className="text-xs text-white/40 italic">— 文件尚未创建</span>
              )}
              {isDirty && <span className="text-xs text-amber-500">● 未保存</span>}
              <div className="ml-auto flex items-center gap-2">
                {current.error && (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <AlertCircle className="w-3 h-3" />
                    {current.error}
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={current.saving || current.loading || !current.loaded}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
                >
                  {current.saving
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> 保存中…</>
                    : <><Save className="w-3 h-3" /> 保存</>
                  }
                </button>
              </div>
            </div>

            {/* Textarea */}
            {current.loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-white/40" />
              </div>
            ) : (
              <textarea
                className="flex-1 w-full px-4 py-3 font-mono text-sm text-emerald-300 bg-black/40 resize-none focus:outline-none leading-relaxed"
                value={current.content}
                onChange={e => setFile(activeFile, { content: e.target.value })}
                spellCheck={false}
                placeholder={`# ${activeFile.replace('.md', '')}\n\n（文件为空或尚未创建 — 输入内容即可创建）`}
              />
            )}
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 border-t border-white/10 bg-white/5 shrink-0">
          <p className="text-xs text-white/40">修改直接写入 Agent 工作区。编辑后点击 Save 或按 Ctrl+S 保存。</p>
        </div>
      </div>
    </div>

    {showGuide && (
      <AgentFilesGuide
        initialFile={activeFile}
        onClose={() => setShowGuide(false)}
      />
    )}
    </>
  );
}
