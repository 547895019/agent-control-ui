import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '../../api/gateway';
import { X, Save, Loader2, AlertCircle, FileText, CheckCircle2, HelpCircle, ChevronDown } from 'lucide-react';
import { AgentFilesGuide } from './AgentFilesGuide';
import { FILE_GUIDES } from './agentFileGuides';

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

function datePrefix(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function memoryFileLabel(filename: string, daysAgo: number): string {
  const prefix = daysAgo === 0 ? '今日' : '昨日';
  const suffix = filename.slice(11, -3); // strip "YYYY-MM-DD-" and ".md"
  return suffix ? `${prefix}·${suffix}` : `${prefix}记忆`;
}

const isDailyLog = (name: string) => name.startsWith('memory/');

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
  const [files, setFiles] = useState<Record<string, FileState>>(() => {
    const today0 = datePrefix(0);
    const yesterday0 = datePrefix(1);
    return Object.fromEntries([
      ...CORE_FILES,
      `memory/${today0}.md`,
      `memory/${yesterday0}.md`,
    ].map(f => [f, emptyFile()]));
  });
  // Static baseline: always show today + yesterday keys so the section renders immediately
  const today = datePrefix(0);
  const yesterday = datePrefix(1);
  const baseline: Array<{ key: string; label: string }> = [
    { key: `memory/${today}.md`, label: '今日记忆' },
    { key: `memory/${yesterday}.md`, label: '昨日记忆' },
  ];
  const [memoryFiles, setMemoryFiles] = useState<Array<{ key: string; label: string }>>(baseline);
  const [memoryExpanded, setMemoryExpanded] = useState(true);
  const [todayExpanded, setTodayExpanded] = useState(true);
  const [yesterdayExpanded, setYesterdayExpanded] = useState(true);
  // Resolved workspace path (may differ from prop when agent uses default workspace)
  const resolvedWorkspaceRef = useRef(workspace);

  const setFile = (name: string, patch: Partial<FileState>) => {
    setFiles(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  };

  // Resolve workspace and list memory/ files via local file server
  useEffect(() => {
    const buildEntries = (filenames: string[]) => {
      const names = filenames.map(f => f.split('/').pop()!).filter(Boolean);
      const entries: Array<{ key: string; label: string }> = [];
      for (const daysAgo of [0, 1]) {
        const prefix = daysAgo === 0 ? today : yesterday;
        const matched = names
          .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
          .sort();
        if (matched.length > 0) {
          matched.forEach(f => entries.push({ key: `memory/${f}`, label: memoryFileLabel(f, daysAgo) }));
        } else {
          entries.push(baseline[daysAgo]);
        }
      }
      return entries;
    };

    const applyEntries = (entries: Array<{ key: string; label: string }>) => {
      setMemoryFiles(entries);
      setFiles(prev => {
        const next = { ...prev };
        for (const { key } of entries) {
          if (!next[key]) next[key] = emptyFile();
        }
        return next;
      });
    };

    (async () => {
      // Resolve workspace: use prop if available, otherwise fetch from configGet
      let ws = workspace;
      if (!ws) {
        try {
          const cfg = await client.configGet();
          const list: any[] = cfg?.resolved?.agents?.list ?? [];
          const agent = list.find((a: any) => a.id === agentId);
          // agent.workspace may be null when using defaults — fall back to agents.defaults.workspace
          ws = agent?.workspace || cfg?.config?.agents?.defaults?.workspace || '';

          // Expand ~ using home dir derived from other agents' absolute workspace paths
          if (ws.startsWith('~')) {
            const homeDir = list
              .map((a: any) => a.workspace as string)
              .filter((w: string) => w && w.startsWith('/') && w.includes('/.openclaw/'))
              .map((w: string) => w.split('/.openclaw/')[0])
              .find(Boolean);
            if (homeDir) ws = homeDir + ws.slice(1);
          }
        } catch {}
      }
      if (!ws) return;
      resolvedWorkspaceRef.current = ws;

      // List memory/ via local file server (requires absolute path)
      try {
        const filenames = await client.listDir(`${ws}/memory`);
        applyEntries(buildEntries(filenames));
      } catch {}
    })();
  }, [agentId, workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFile = useCallback(async (name: string) => {
    if (files[name]?.loaded || files[name]?.loading) return;
    setFile(name, { loading: true, error: '' });
    try {
      if (isDailyLog(name)) {
        // Gateway doesn't support subdirectory paths — use local file server
        let ws = resolvedWorkspaceRef.current;
        if (!ws) {
          // Resolve workspace on demand if listing effect hasn't completed yet
          try {
            const cfg = await client.configGet();
            const list: any[] = cfg?.resolved?.agents?.list ?? [];
            const agent = list.find((a: any) => a.id === agentId);
            ws = agent?.workspace || cfg?.config?.agents?.defaults?.workspace || '';
            if (ws.startsWith('~')) {
              const homeDir = list
                .map((a: any) => a.workspace as string)
                .filter((w: string) => w && w.startsWith('/') && w.includes('/.openclaw/'))
                .map((w: string) => w.split('/.openclaw/')[0])
                .find(Boolean);
              if (homeDir) ws = homeDir + ws.slice(1);
            }
            if (ws) resolvedWorkspaceRef.current = ws;
          } catch {}
        }
        if (!ws) {
          setFile(name, { loading: false, error: '工作区路径未知' });
          return;
        }
        try {
          const content = await client.readFile(`${ws}/${name}`);
          setFile(name, { content, original: content, loaded: true, missing: false, loading: false });
        } catch {
          // File doesn't exist yet — mark as missing/new
          setFile(name, { content: '', original: '', loaded: true, missing: true, loading: false });
        }
      } else {
        const res = await client.agentFilesGet(agentId, name);
        const content = res?.file?.content ?? '';
        const missing = res?.file?.missing ?? false;
        setFile(name, { content, original: content, loaded: true, missing, loading: false });
      }
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
      if (isDailyLog(activeFile)) {
        // Gateway doesn't support subdirectory paths — use local file server
        const ws = resolvedWorkspaceRef.current;
        if (!ws) throw new Error('工作区路径未知');
        await client.writeFile(`${ws}/${activeFile}`, f.content);
      } else {
        await client.agentFilesSet(agentId, activeFile, f.content);
      }
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
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                      : 'text-white/60 hover:bg-white/8'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs truncate font-medium ${isActive ? 'text-indigo-200' : 'text-white/70'}`}>
                      {FILE_GUIDES[name]?.title ?? name}
                    </div>
                    <div className="text-[10px] font-mono text-white/30 truncate">{name}</div>
                  </div>
                  {f.loading && <Loader2 className="w-3 h-3 animate-spin text-white/40 shrink-0" />}
                  {!f.loading && dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  {!f.loading && f.savedAt && !dirty && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                  {!f.loading && f.missing && !dirty && (
                    <span className="text-[10px] text-white/40 shrink-0">新建</span>
                  )}
                </button>
              );
            })}

            {/* Daily memory section */}
            <button
              onClick={() => setMemoryExpanded(v => !v)}
              className="w-full flex items-center gap-1 px-4 pt-3 pb-1 text-left border-t border-white/8 mt-1 group"
            >
              <span className="text-[10px] font-semibold text-white/25 uppercase tracking-wider flex-1">每日记忆</span>
              <ChevronDown className={`w-3 h-3 text-white/25 group-hover:text-white/50 transition-transform ${memoryExpanded ? '' : '-rotate-90'}`} />
            </button>
            {memoryExpanded && (() => {
              const todayFiles = memoryFiles.filter(({ key }) => key.startsWith(`memory/${today}`));
              const yesterdayFiles = memoryFiles.filter(({ key }) => key.startsWith(`memory/${yesterday}`));
              const renderEntry = ({ key, label }: { key: string; label: string }) => {
                const f = files[key] ?? emptyFile();
                const dirty = f.loaded && f.content !== f.original;
                const isActive = key === activeFile;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveFile(key)}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                      isActive
                        ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                        : 'text-white/60 hover:bg-white/8'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs truncate font-medium ${isActive ? 'text-indigo-200' : 'text-white/70'}`}>
                        {label}
                      </div>
                      <div className="text-[10px] font-mono text-white/30 truncate">{key}</div>
                    </div>
                    {f.loading && <Loader2 className="w-3 h-3 animate-spin text-white/40 shrink-0" />}
                    {!f.loading && dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                    {!f.loading && f.savedAt && !dirty && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                    {!f.loading && f.missing && !dirty && (
                      <span className="text-[10px] text-white/40 shrink-0">新建</span>
                    )}
                  </button>
                );
              };
              return (
                <>
                  {/* Today group */}
                  <button
                    onClick={() => setTodayExpanded(v => !v)}
                    className="w-full flex items-center gap-1 px-4 py-1 text-left group"
                  >
                    <span className="text-[10px] text-white/30 group-hover:text-white/50 flex-1">今日记忆</span>
                    <ChevronDown className={`w-3 h-3 text-white/20 group-hover:text-white/40 transition-transform ${todayExpanded ? '' : '-rotate-90'}`} />
                  </button>
                  {todayExpanded && todayFiles.map(renderEntry)}
                  {/* Yesterday group */}
                  <button
                    onClick={() => setYesterdayExpanded(v => !v)}
                    className="w-full flex items-center gap-1 px-4 py-1 text-left group"
                  >
                    <span className="text-[10px] text-white/30 group-hover:text-white/50 flex-1">昨日记忆</span>
                    <ChevronDown className={`w-3 h-3 text-white/20 group-hover:text-white/40 transition-transform ${yesterdayExpanded ? '' : '-rotate-90'}`} />
                  </button>
                  {yesterdayExpanded && yesterdayFiles.map(renderEntry)}
                </>
              );
            })()}
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
