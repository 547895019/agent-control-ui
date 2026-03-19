import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { AgentForm } from '../components/agents/AgentForm';
import { AgentFilesEditor } from '../components/agents/AgentFilesEditor';
import { AgentSessionsViewer } from '../components/agents/AgentSessionsViewer';
import { AgentChat } from '../components/agents/AgentChat';
import { Plus, Pencil, Trash2, Bot, RefreshCw, FolderOpen, History, MessageSquare } from 'lucide-react';

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-indigo-500', 'bg-blue-500', 'bg-cyan-500',
  'bg-teal-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-pink-500', 'bg-fuchsia-500',
];

function getAvatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(id: string, name?: string) {
  const src = name || id;
  const parts = src.split(/[\s_-]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function ModelBadge({ model }: { model?: string | { primary: string; fallbacks?: string[] } }) {
  if (!model) return <span className="text-slate-400 text-xs">默认</span>;
  if (typeof model === 'string') {
    const short = model.split('/').pop() || model;
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-mono border border-slate-200">
        {short}
      </span>
    );
  }
  const short = (model.primary || '').split('/').pop() || model.primary;
  const fbCount = model.fallbacks?.length ?? 0;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-mono border border-slate-200">
      {short}
      {fbCount > 0 && (
        <span className="text-slate-400">+{fbCount}</span>
      )}
    </span>
  );
}

export function AgentsPage() {
  const { agents, deleteAgent, fetchAgents } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{ id: string; config: any } | undefined>();
  const [filesAgent, setFilesAgent] = useState<{ id: string; config: any } | null>(null);
  const [sessionsAgent, setSessionsAgent] = useState<{ id: string; config: any } | null>(null);
  const [chatAgent, setChatAgent] = useState<{ id: string; config: any } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const agentList = Object.entries(agents);

  const handleDelete = async (id: string) => {
    if (!window.confirm(`确认删除代理 "${id}"？此操作仅删除配置文件。`)) return;
    setDeleting(id);
    try {
      await deleteAgent(id);
    } finally {
      setDeleting(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAgents();
    setRefreshing(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">代理</h2>
          <p className="text-slate-500 text-sm mt-0.5">
            共 {agentList.length} 个代理
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            onClick={() => { setEditingAgent(undefined); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            新建代理
          </button>
        </div>
      </div>

      {/* Grid */}
      {agentList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <Bot className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">暂无代理</p>
          <p className="text-slate-400 text-sm mb-4">创建第一个代理开始使用</p>
          <button
            onClick={() => { setEditingAgent(undefined); setShowForm(true); }}
            className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
          >
            + 创建代理
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agentList.map(([id, config]: [string, any]) => (
            <div
              key={id}
              className="bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all group cursor-pointer"
              onClick={() => setFilesAgent({ id, config })}
            >
              {/* Card header */}
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl ${getAvatarColor(id)} flex items-center justify-center text-white font-semibold text-sm shrink-0`}>
                  {getInitials(id, config.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800 text-sm truncate">
                      {config.name || id}
                    </h3>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.enabled !== false ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                  </div>
                  <p className="text-slate-400 text-xs font-mono mt-0.5 truncate">{id}</p>
                </div>
                <FolderOpen className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors shrink-0 mt-0.5" />
              </div>

              {/* Info */}
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">模型</span>
                  <ModelBadge model={config.model} />
                </div>
                {config.workspace && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400 shrink-0">工作区</span>
                    <span className="text-xs text-slate-500 truncate font-mono" title={config.workspace}>
                      …/{config.workspace.split('/').pop()}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 pt-3 border-t border-slate-100" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setChatAgent({ id, config })}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  <MessageSquare className="w-3 h-3" />
                  聊天
                </button>
                <button
                  onClick={() => setSessionsAgent({ id, config })}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <History className="w-3 h-3" />
                  历史
                </button>
                <button
                  onClick={() => { setEditingAgent({ id, config }); setShowForm(true); }}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  配置
                </button>
                <button
                  onClick={() => handleDelete(id)}
                  disabled={deleting === id}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  {deleting === id ? '…' : '删除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <AgentForm
          agent={editingAgent}
          onSuccess={() => { setShowForm(false); setEditingAgent(undefined); fetchAgents(); }}
          onCancel={() => { setShowForm(false); setEditingAgent(undefined); }}
        />
      )}

      {filesAgent && (
        <AgentFilesEditor
          agentId={filesAgent.id}
          agentName={filesAgent.config.name || filesAgent.id}
          workspace={filesAgent.config.workspace || ''}
          onClose={() => setFilesAgent(null)}
        />
      )}

      {sessionsAgent && (
        <AgentSessionsViewer
          agentId={sessionsAgent.id}
          agentName={sessionsAgent.config.name || sessionsAgent.id}
          workspace={sessionsAgent.config.workspace || ''}
          onClose={() => setSessionsAgent(null)}
        />
      )}

      {chatAgent && (
        <AgentChat
          agentId={chatAgent.id}
          agentName={chatAgent.config.name || chatAgent.id}
          workspace={chatAgent.config.workspace || ''}
          onClose={() => setChatAgent(null)}
        />
      )}
    </div>
  );
}
