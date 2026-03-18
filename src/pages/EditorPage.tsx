import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { client } from '../api/gateway';
import { FileTree } from '../components/editor/FileTree';
import { useAppStore } from '../stores/useAppStore';

export function EditorPage() {
  const { agents } = useAppStore();
  const [filePath, setFilePath] = useState('');
  const [content, setContent] = useState('// Select a file from the tree or enter path manually');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  // Get unique workspaces from agents
  const workspaces = React.useMemo(() => {
    const wsSet = new Set<string>();
    Object.values(agents).forEach((agent: any) => {
      if (agent.workspace) wsSet.add(agent.workspace);
    });
    return Array.from(wsSet);
  }, [agents]);

  // Set default workspace
  useEffect(() => {
    if (workspaces.length > 0 && !selectedWorkspace) {
      setSelectedWorkspace(workspaces[0]);
    }
  }, [workspaces, selectedWorkspace]);

  // Warn about unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  const handleFileSelect = useCallback(async (path: string) => {
    if (hasChanges) {
      const confirm = window.confirm('You have unsaved changes. Discard them?');
      if (!confirm) return;
    }
    
    setFilePath(path);
    setLoading(true);
    try {
      const res = await client.invokeTool('read', { file_path: path });
      const newContent = res.content || res;
      setContent(newContent);
      setOriginalContent(newContent);
      setHasChanges(false);
    } catch (err: any) {
      alert('Failed to read: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [hasChanges]);

  const handleContentChange = (value: string | undefined) => {
    setContent(value || '');
    setHasChanges(value !== originalContent);
  };

  const handleRead = async () => {
    if (!filePath) return;
    if (hasChanges) {
      const confirm = window.confirm('You have unsaved changes. Discard them?');
      if (!confirm) return;
    }
    
    setLoading(true);
    try {
      const res = await client.invokeTool('read', { file_path: filePath });
      const newContent = res.content || res;
      setContent(newContent);
      setOriginalContent(newContent);
      setHasChanges(false);
    } catch (err: any) {
      alert('Failed to read: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWrite = async () => {
    if (!filePath) {
      alert('Please enter a file path');
      return;
    }
    if (!window.confirm('Are you sure you want to save this file?')) return;
    
    setLoading(true);
    try {
      await client.invokeTool('write', { file_path: filePath, content });
      setOriginalContent(content);
      setHasChanges(false);
      setSaveMessage('Saved successfully');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex">
      {/* Sidebar with File Tree */}
      <div className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <label className="text-xs font-medium text-gray-500 mb-1 block">Workspace</label>
          <select
            value={selectedWorkspace}
            onChange={(e) => setSelectedWorkspace(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded px-2 py-1"
          >
            {workspaces.map(ws => (
              <option key={ws} value={ws}>{ws.split('/').pop()}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedWorkspace ? (
            <FileTree 
              rootPath={selectedWorkspace}
              onFileSelect={handleFileSelect}
              selectedPath={filePath}
            />
          ) : (
            <div className="p-4 text-sm text-gray-400">
              No workspaces configured
            </div>
          )}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-white">
          <input 
            type="text" 
            value={filePath}
            onChange={e => setFilePath(e.target.value)}
            className="flex-1 border border-gray-300 px-3 py-1.5 rounded text-sm"
            placeholder="File path..."
          />
          <button 
            onClick={handleRead} 
            disabled={loading || !filePath}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm transition-colors disabled:opacity-50"
          >
            Read
          </button>
          <button 
            onClick={handleWrite} 
            disabled={loading || !hasChanges}
            className={`
              px-4 py-1.5 rounded text-sm transition-colors
              ${hasChanges 
                ? 'bg-green-600 hover:bg-green-700 text-white' 
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'}
            `}
          >
            Save
          </button>
        </div>

        {saveMessage && (
          <div className="px-3 py-1 bg-green-50 text-green-700 text-sm">
            {saveMessage}
          </div>
        )}

        {hasChanges && (
          <div className="px-3 py-1 bg-yellow-50 text-yellow-700 text-sm flex items-center justify-between">
            <span>You have unsaved changes</span>
            <button 
              onClick={() => {
                setContent(originalContent);
                setHasChanges(false);
              }}
              className="text-xs text-yellow-600 hover:underline"
            >
              Discard changes
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="markdown"
            value={content}
            onChange={handleContentChange}
            options={{ 
              minimap: { enabled: false },
              wordWrap: 'on'
            }}
          />
        </div>
      </div>
    </div>
  );
}
