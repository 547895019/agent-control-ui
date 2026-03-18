import { useState, useEffect, useRef } from 'react';
import { client } from '../../api/gateway';
import {
  X, Save, Loader2, AlertCircle, BookOpen,
  Plus, Trash2, CheckCircle2, FileText,
} from 'lucide-react';

interface KnowledgeEditorProps {
  title: string;
  dirPath: string;
  onClose: () => void;
}

export function KnowledgeEditor({ title, dirPath, onClose }: KnowledgeEditorProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [loadingDir, setLoadingDir] = useState(true);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const contentRef = useRef(content);
  contentRef.current = content;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;

  const fullPath = (name: string) => `${dirPath}/${name}`;

  // Load directory listing
  useEffect(() => {
    (async () => {
      setLoadingDir(true);
      try {
        const list = (await client.listDir(dirPath)).sort();
        setFiles(list);
        if (list.length > 0) setActiveFile(list[0]);
      } catch {
        setFiles([]);
      }
      setLoadingDir(false);
    })();
  }, [dirPath]);

  // Load file content when active file changes
  useEffect(() => {
    if (!activeFile) return;
    let cancelled = false;
    (async () => {
      setLoadingFile(true);
      setError('');
      setSavedAt(null);
      try {
        const text = await client.readFile(fullPath(activeFile));
        if (!cancelled) { setContent(text); setOriginal(text); }
      } catch (e: any) {
        if (!cancelled) { setContent(''); setOriginal(''); setError(e.message || 'Failed to load'); }
      }
      if (!cancelled) setLoadingFile(false);
    })();
    return () => { cancelled = true; };
  }, [activeFile, dirPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const file = activeFileRef.current;
        if (!file) return;
        setSaving(true);
        setError('');
        client.writeFile(fullPath(file), contentRef.current)
          .then(() => { setOriginal(contentRef.current); setSavedAt(Date.now()); })
          .catch((err: any) => setError(err.message || 'Failed to save'))
          .finally(() => setSaving(false));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!activeFile || saving) return;
    setSaving(true);
    setError('');
    try {
      await client.writeFile(fullPath(activeFile), content);
      setOriginal(content);
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    }
    setSaving(false);
  };

  const handleCreateFile = async () => {
    const raw = newFileName.trim();
    if (!raw) return;
    const name = raw.includes('.') ? raw : `${raw}.md`;
    try {
      await client.writeFile(fullPath(name), '');
      const updated = [...files, name].sort();
      setFiles(updated);
      setActiveFile(name);
      setShowNewFile(false);
      setNewFileName('');
    } catch (e: any) {
      setError(e.message || 'Failed to create');
    }
  };

  const handleDelete = async () => {
    if (!activeFile || !window.confirm(`确认删除 ${activeFile}？`)) return;
    setDeleting(true);
    try {
      await client.deleteFile(fullPath(activeFile));
      const updated = files.filter(f => f !== activeFile);
      setFiles(updated);
      setActiveFile(updated[0] ?? null);
      setContent(''); setOriginal('');
    } catch (e: any) {
      setError(e.message || 'Failed to delete');
    }
    setDeleting(false);
  };

  const isDirty = content !== original && !loadingFile;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 shrink-0">
          <BookOpen className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="font-semibold text-slate-800 text-sm">{title}</span>
          <span className="text-slate-400 text-xs font-mono hidden sm:block truncate">{dirPath}</span>
          <div className="ml-auto shrink-0">
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Sidebar */}
          <div className="w-48 shrink-0 border-r border-slate-100 flex flex-col">
            <div className="flex-1 overflow-y-auto py-1">
              {loadingDir ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                </div>
              ) : files.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8 px-3">暂无文件，点击下方新建</p>
              ) : (
                files.map(name => (
                  <button
                    key={name}
                    onClick={() => { if (name !== activeFile) { setActiveFile(name); setSavedAt(null); } }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      name === activeFile
                        ? 'bg-indigo-50 text-indigo-700 font-medium'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 truncate font-mono text-xs">{name}</span>
                    {name === activeFile && isDirty && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    )}
                    {name === activeFile && savedAt && !isDirty && (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>

            {/* New file */}
            <div className="border-t border-slate-100 p-2">
              {showNewFile ? (
                <div className="space-y-1.5">
                  <input
                    value={newFileName}
                    onChange={e => setNewFileName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateFile();
                      if (e.key === 'Escape') { setShowNewFile(false); setNewFileName(''); }
                    }}
                    className="w-full px-2 py-1.5 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    placeholder="filename.md"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={handleCreateFile}
                      className="flex-1 py-1 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded transition-colors"
                    >
                      创建
                    </button>
                    <button
                      onClick={() => { setShowNewFile(false); setNewFileName(''); }}
                      className="flex-1 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewFile(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建文件
                </button>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col min-w-0">
            {!activeFile ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                <BookOpen className="w-10 h-10 text-slate-200" />
                <p className="text-sm">选择或新建文件开始编辑</p>
              </div>
            ) : (
              <>
                {/* File bar */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50 shrink-0">
                  <span className="text-xs font-mono text-slate-500">{activeFile}</span>
                  {isDirty && <span className="text-xs text-amber-500">● 未保存</span>}
                  <div className="ml-auto flex items-center gap-2">
                    {error && (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <AlertCircle className="w-3 h-3" />{error}
                      </span>
                    )}
                    <button
                      onClick={handleDelete}
                      disabled={deleting || loadingFile}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {deleting
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Trash2 className="w-3 h-3" />}
                      删除
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || loadingFile || !isDirty}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {saving
                        ? <><Loader2 className="w-3 h-3 animate-spin" />保存中…</>
                        : <><Save className="w-3 h-3" />保存</>}
                    </button>
                  </div>
                </div>

                {loadingFile ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                ) : (
                  <textarea
                    className="flex-1 w-full px-4 py-3 font-mono text-sm text-slate-800 bg-white resize-none focus:outline-none leading-relaxed"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    spellCheck={false}
                    placeholder={`# ${activeFile.replace(/\.md$/i, '')}\n\n开始编辑…`}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50 shrink-0">
          <p className="text-xs text-slate-400">修改直接写入知识库目录。点击保存或按 Ctrl+S。</p>
        </div>
      </div>
    </div>
  );
}
