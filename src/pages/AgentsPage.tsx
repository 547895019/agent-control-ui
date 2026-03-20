import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { client } from '../api/gateway';
import { AgentForm } from '../components/agents/AgentForm';
import { AgentFilesEditor } from '../components/agents/AgentFilesEditor';
import { AgentSessionsViewer } from '../components/agents/AgentSessionsViewer';
import { AgentChat } from '../components/agents/AgentChat';
import { AgentSkillsPanel } from '../components/agents/AgentSkillsPanel';
import { Plus, Pencil, Trash2, Bot, RefreshCw, FolderOpen, History, MessageSquare, Puzzle } from 'lucide-react';

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

function formatTokens(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ModelBadge({ model }: { model?: string | { primary: string; fallbacks?: string[] } }) {
  if (!model) return <span className="text-white/30 text-xs">默认</span>;
  if (typeof model === 'string') {
    const short = model.split('/').pop() || model;
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/10 text-white/70 text-xs font-mono border border-white/10">
        {short}
      </span>
    );
  }
  const short = (model.primary || '').split('/').pop() || model.primary;
  const fbCount = model.fallbacks?.length ?? 0;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-white/70 text-xs font-mono border border-white/10">
      {short}
      {fbCount > 0 && (
        <span className="text-white/30">+{fbCount}</span>
      )}
    </span>
  );
}

export function AgentsPage() {
  const { agents, deleteAgent, fetchAgents, connectionStatus } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{ id: string; config: any } | undefined>();
  const [filesAgent, setFilesAgent] = useState<{ id: string; config: any } | null>(null);
  const [sessionsAgent, setSessionsAgent] = useState<{ id: string; config: any } | null>(null);
  const [chatAgent, setChatAgent] = useState<{ id: string; config: any } | null>(null);
  const [skillsAgent, setSkillsAgent] = useState<{ id: string; config: any } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [agentUsage, setAgentUsage] = useState<Map<string, { totalTokens: number; totalCost: number }>>(new Map());

  // Fetch 7-day usage once connected
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    client.usageGet({ startDate: getIsoDate(start), endDate: getIsoDate(end) })
      .then(res => {
        const map = new Map<string, { totalTokens: number; totalCost: number }>();
        for (const entry of (res?.aggregates?.byAgent ?? [])) {
          if (entry.agentId) {
            map.set(entry.agentId, {
              totalTokens: entry.totals?.totalTokens ?? 0,
              totalCost: entry.totals?.totalCost ?? 0,
            });
          }
        }
        setAgentUsage(map);
      })
      .catch(() => {});
  }, [connectionStatus]);

  const agentList = Object.entries(agents);
  const maxTokens = Math.max(...[...agentUsage.values()].map(u => u.totalTokens), 1);

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
          <h2 className="text-xl font-semibold text-white">代理</h2>
          <p className="text-white/50 text-sm mt-0.5">
            共 {agentList.length} 个代理
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/70 bg-white/10 border border-white/15 rounded-lg hover:bg-white/15 transition-colors disabled:opacity-50 backdrop-blur-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            onClick={() => { setEditingAgent(undefined); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-indigo-600/80 hover:bg-indigo-500/80 rounded-lg transition-colors shadow-lg shadow-indigo-900/40 backdrop-blur-sm border border-indigo-400/20"
          >
            <Plus className="w-3.5 h-3.5" />
            新建代理
          </button>
        </div>
      </div>

      {/* Grid */}
      {agentList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/15 flex items-center justify-center mb-4">
            <Bot className="w-8 h-8 text-white/40" />
          </div>
          <p className="text-white/70 font-medium mb-1">暂无代理</p>
          <p className="text-white/40 text-sm mb-4">创建第一个代理开始使用</p>
          <button
            onClick={() => { setEditingAgent(undefined); setShowForm(true); }}
            className="text-sm text-indigo-400 hover:text-indigo-300 font-medium"
          >
            + 创建代理
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agentList.map(([id, config]: [string, any]) => (
            <div
              key={id}
              className="bg-white/8 backdrop-blur-xl border border-white/10 rounded-xl p-4 hover:border-white/20 hover:bg-white/12 transition-all group cursor-pointer shadow-xl shadow-black/20"
              onClick={() => setFilesAgent({ id, config })}
            >
              {/* Card header */}
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl ${getAvatarColor(id)} flex items-center justify-center text-white font-semibold text-sm shrink-0 shadow-lg`}>
                  {getInitials(id, config.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white text-sm truncate">
                      {config.name || id}
                    </h3>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.enabled !== false ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  </div>
                  <p className="text-white/40 text-xs font-mono mt-0.5 truncate">{id}</p>
                </div>
                <FolderOpen className="w-4 h-4 text-white/20 group-hover:text-indigo-400 transition-colors shrink-0 mt-0.5" />
              </div>

              {/* Info */}
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/40">模型</span>
                  <ModelBadge model={config.model} />
                </div>
                {config.workspace && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-white/40 shrink-0">工作区</span>
                    <span className="text-xs text-white/50 truncate font-mono" title={config.workspace}>
                      …/{config.workspace.split('/').pop()}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-white/40 shrink-0">工具权限</span>
                  <span className="text-xs text-white/50 font-mono">
                    {config.tools?.profile ?? '默认'}
                  </span>
                </div>
                {(() => {
                  const usage = agentUsage.get(id);
                  if (!usage || usage.totalTokens === 0) return null;
                  const pct = Math.round((usage.totalTokens / maxTokens) * 100);
                  return (
                    <div className="pt-0.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs text-white/40 shrink-0">近7天用量</span>
                        <span className="text-xs text-white/70 font-medium tabular-nums">
                          {formatTokens(usage.totalTokens)}
                          {usage.totalCost > 0 && (
                            <span className="text-white/30 font-normal ml-1">
                              ${usage.totalCost < 0.01 ? usage.totalCost.toFixed(4) : usage.totalCost.toFixed(2)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 pt-3 border-t border-white/10" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setChatAgent({ id, config })}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 rounded-lg transition-colors border border-indigo-400/15"
                >
                  <MessageSquare className="w-3 h-3" />
                  聊天
                </button>
                <button
                  onClick={() => setSkillsAgent({ id, config })}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-white/60 bg-white/8 hover:bg-white/15 rounded-lg transition-colors border border-white/8"
                >
                  <Puzzle className="w-3 h-3" />
                  技能
                </button>
                <button
                  onClick={() => setSessionsAgent({ id, config })}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-white/60 bg-white/8 hover:bg-white/15 rounded-lg transition-colors border border-white/8"
                >
                  <History className="w-3 h-3" />
                  历史
                </button>
                <button
                  onClick={() => { setEditingAgent({ id, config }); setShowForm(true); }}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-white/60 bg-white/8 hover:bg-white/15 rounded-lg transition-colors border border-white/8"
                >
                  <Pencil className="w-3 h-3" />
                  配置
                </button>
                <button
                  onClick={() => handleDelete(id)}
                  disabled={deleting === id}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50 border border-red-400/10"
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

      {skillsAgent && (
        <AgentSkillsPanel
          agentId={skillsAgent.id}
          agentName={skillsAgent.config.name || skillsAgent.id}
          onClose={() => setSkillsAgent(null)}
        />
      )}
    </div>
  );
}
