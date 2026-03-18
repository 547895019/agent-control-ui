import React, { useState, useEffect, useRef } from 'react';
import { client } from '../api/gateway';
import { useAppStore } from '../stores/useAppStore';
import { AgentFilesEditor } from '../components/agents/AgentFilesEditor';
import { AgentSessionsViewer } from '../components/agents/AgentSessionsViewer';
import { KnowledgeEditor } from '../components/knowledge/KnowledgeEditor';
import {
  Building2, Plus, Pencil, Trash2, Users,
  FolderOpen, History, X, Check, Download, Upload, Cloud, CloudOff, BookOpen,
} from 'lucide-react';

const ORG_KNOWLEDGE_DIR = '~/.openclaw/workspaces/knowledge';
const TEAM_KNOWLEDGE_DIR = (teamId: string) => `~/.openclaw/workspaces/${teamId}/knowledge`;

const ORG_STORAGE_KEY = 'openclaw_organization';
const ORG_FILE_PATH = '~/.openclaw/workspaces/organization.json';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgMember {
  agentId: string;
  name?: string;
  role?: string;
}

interface OrgTeam {
  id: string;
  name: string;
  description?: string;
  color?: string;
  members: OrgMember[];
}

interface OrgConfig {
  company: { name: string; description?: string };
  teams: OrgTeam[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TEAM_COLORS = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4',
  '#10b981', '#f59e0b', '#ef4444', '#ec4899',
];

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

// ── TeamModal ─────────────────────────────────────────────────────────────────

interface TeamModalProps {
  initial?: OrgTeam;
  onSave: (data: Omit<OrgTeam, 'members'>) => void;
  onClose: () => void;
}

function TeamModal({ initial, onSave, onClose }: TeamModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? TEAM_COLORS[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = initial?.id ?? name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    onSave({ id, name: name.trim(), description: description.trim() || undefined, color });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm">{initial ? '编辑团队' : '添加团队'}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">团队名称 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. 软件研发团队"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              rows={2}
              placeholder="团队职责描述..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">颜色</label>
            <div className="flex gap-2 flex-wrap">
              {TEAM_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-105'}`}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors">
              取消
            </button>
            <button type="submit" className="flex-1 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── MemberModal ───────────────────────────────────────────────────────────────

interface MemberModalProps {
  initial?: OrgMember;
  existingIds: string[];
  agents: Record<string, any>;
  onSave: (member: OrgMember) => void;
  onClose: () => void;
}

function MemberModal({ initial, existingIds, agents, onSave, onClose }: MemberModalProps) {
  const [agentId, setAgentId] = useState(initial?.agentId ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');

  // When adding, exclude already-added agents; when editing, include current agent
  const agentOptions = Object.entries(agents).filter(
    ([id]) => id === initial?.agentId || !existingIds.includes(id)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId) return;
    onSave({ agentId, name: name.trim() || undefined, role: role.trim() || undefined });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm">{initial ? '编辑成员' : '添加成员'}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Agent *</label>
            <select
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              required
              disabled={!!initial}
            >
              <option value="">-- 选择 Agent --</option>
              {agentOptions.map(([id, cfg]) => (
                <option key={id} value={id}>{cfg.name || id}</option>
              ))}
            </select>
            {agentOptions.length === 0 && !initial && (
              <p className="text-xs text-slate-400 mt-1">所有已配置的 Agent 都已添加到该团队</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">显示名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="留空则使用 Agent 默认名称"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">职位 / 角色</label>
            <input
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Frontend Developer"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors">
              取消
            </button>
            <button type="submit" className="flex-1 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── OrgPage ───────────────────────────────────────────────────────────────────

export function OrgPage() {
  const { agents } = useAppStore();
  const importRef = useRef<HTMLInputElement>(null);

  const [org, setOrg] = useState<OrgConfig | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [fileSyncState, setFileSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Edit states
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyNameInput, setCompanyNameInput] = useState('');
  const [teamModal, setTeamModal] = useState<{ mode: 'add' } | { mode: 'edit'; team: OrgTeam } | null>(null);
  const [memberModal, setMemberModal] = useState<{ teamId: string; member?: OrgMember } | null>(null);

  // Sub-modals
  const [filesAgent, setFilesAgent] = useState<{ id: string; config: any } | null>(null);
  const [sessionsAgent, setSessionsAgent] = useState<{ id: string; config: any } | null>(null);
  const [knowledgeModal, setKnowledgeModal] = useState<{ title: string; dirPath: string } | null>(null);

  // Load: try server file first, fall back to localStorage
  useEffect(() => {
    (async () => {
      try {
        const content = await client.readFile(ORG_FILE_PATH);
        if (content?.trim()) {
          const parsed = JSON.parse(content) as OrgConfig;
          const cfg: OrgConfig = {
            company: parsed.company ?? { name: '我的公司' },
            teams: parsed.teams ?? [],
          };
          setOrg(cfg);
          localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(cfg));
          if (cfg.teams.length > 0) setSelectedTeamId(cfg.teams[0].id);
          return;
        }
      } catch {
        // invokeTool not supported or file missing — fall through to localStorage
      }
      const stored = localStorage.getItem(ORG_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as OrgConfig;
          const cfg: OrgConfig = {
            company: parsed.company ?? { name: '我的公司' },
            teams: parsed.teams ?? [],
          };
          setOrg(cfg);
          if (cfg.teams.length > 0) setSelectedTeamId(cfg.teams[0].id);
          return;
        } catch { /* ignore */ }
      }
      setOrg({ company: { name: '我的公司' }, teams: [] });
    })();
  }, []);

  const saveOrg = async (newOrg: OrgConfig) => {
    // Always persist to localStorage immediately
    localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(newOrg));
    setOrg(newOrg);

    // Try to write to server file
    setFileSyncState('saving');
    try {
      await client.writeFile(ORG_FILE_PATH, JSON.stringify(newOrg, null, 2));
      setFileSyncState('saved');
      setTimeout(() => setFileSyncState('idle'), 2000);
    } catch {
      setFileSyncState('error');
      setTimeout(() => setFileSyncState('idle'), 3000);
    }
  };

  const handleExport = () => {
    if (!org) return;
    const blob = new Blob([JSON.stringify(org, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'organization.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as OrgConfig;
        const cfg: OrgConfig = {
          company: parsed.company ?? { name: '我的公司' },
          teams: parsed.teams ?? [],
        };
        saveOrg(cfg);
        if (cfg.teams.length > 0) setSelectedTeamId(cfg.teams[0].id);
      } catch {
        alert('JSON 格式错误，导入失败');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Company name
  const startEditCompany = () => {
    setCompanyNameInput(org?.company.name ?? '');
    setEditingCompany(true);
  };
  const confirmEditCompany = () => {
    if (!org || !companyNameInput.trim()) return;
    saveOrg({ ...org, company: { ...org.company, name: companyNameInput.trim() } });
    setEditingCompany(false);
  };

  // Team CRUD
  const handleSaveTeam = (data: Omit<OrgTeam, 'members'>) => {
    if (!org) return;
    let teams: OrgTeam[];
    if (teamModal?.mode === 'edit') {
      teams = org.teams.map(t => t.id === data.id ? { ...t, ...data } : t);
    } else {
      teams = [...org.teams, { ...data, members: [] }];
    }
    saveOrg({ ...org, teams });
    setTeamModal(null);
    setSelectedTeamId(data.id);
  };

  const handleDeleteTeam = (teamId: string) => {
    if (!org) return;
    if (!window.confirm('确认删除该团队及其所有成员关系？')) return;
    const teams = org.teams.filter(t => t.id !== teamId);
    saveOrg({ ...org, teams });
    setSelectedTeamId(teams[0]?.id ?? null);
  };

  // Member CRUD
  const handleSaveMember = (teamId: string, member: OrgMember) => {
    if (!org) return;
    const teams = org.teams.map(t => {
      if (t.id !== teamId) return t;
      const exists = t.members.some(m => m.agentId === member.agentId);
      return {
        ...t,
        members: exists
          ? t.members.map(m => m.agentId === member.agentId ? member : m)
          : [...t.members, member],
      };
    });
    saveOrg({ ...org, teams });
    setMemberModal(null);
  };

  const handleDeleteMember = (teamId: string, agentId: string) => {
    if (!org) return;
    const teams = org.teams.map(t =>
      t.id === teamId ? { ...t, members: t.members.filter(m => m.agentId !== agentId) } : t
    );
    saveOrg({ ...org, teams });
  };

  const selectedTeam = org?.teams.find(t => t.id === selectedTeamId) ?? org?.teams[0] ?? null;

  if (!org) return null;

  const totalMembers = (org.teams ?? []).reduce((s, t) => s + t.members.length, 0);

  return (
    <>
      <div className="flex flex-col h-full">

        {/* Header */}
        <div className="border-b border-slate-200 bg-white px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-indigo-600" />
            </div>

            <div className="flex-1 min-w-0">
              {editingCompany ? (
                <div className="flex items-center gap-2">
                  <input
                    value={companyNameInput}
                    onChange={e => setCompanyNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') confirmEditCompany(); if (e.key === 'Escape') setEditingCompany(false); }}
                    className="text-lg font-semibold text-slate-800 border-b-2 border-indigo-500 focus:outline-none bg-transparent min-w-0"
                    autoFocus
                  />
                  <button onClick={confirmEditCompany} className="text-emerald-500 hover:text-emerald-600 shrink-0">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingCompany(false)} className="text-slate-400 hover:text-slate-600 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold text-slate-800">{org.company.name}</h1>
                  <button onClick={startEditCompany} className="text-slate-300 hover:text-slate-500 transition-colors shrink-0">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="text-slate-400 text-xs mt-0.5">
                {org.teams.length} 个团队 · {totalMembers} 名成员
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* File sync indicator */}
              {fileSyncState === 'saving' && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Cloud className="w-3.5 h-3.5 animate-pulse" /> 同步中…
                </span>
              )}
              {fileSyncState === 'saved' && (
                <span className="text-xs text-emerald-500 flex items-center gap-1">
                  <Cloud className="w-3.5 h-3.5" /> 已保存到文件
                </span>
              )}
              {fileSyncState === 'error' && (
                <span className="text-xs text-amber-500 flex items-center gap-1" title={`写入 ${ORG_FILE_PATH} 失败，数据已保存到 localStorage`}>
                  <CloudOff className="w-3.5 h-3.5" /> 仅本地保存
                </span>
              )}

              <button
                onClick={() => setKnowledgeModal({ title: '组织知识库', dirPath: ORG_KNOWLEDGE_DIR })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                title="编辑组织知识库"
              >
                <BookOpen className="w-3 h-3" />
                知识库
              </button>

              <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              <button
                onClick={() => importRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                title="从 organization.json 导入"
              >
                <Upload className="w-3 h-3" />
                导入
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                title="导出为 organization.json"
              >
                <Download className="w-3 h-3" />
                导出
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Teams sidebar */}
          <div className="w-52 shrink-0 border-r border-slate-100 flex flex-col">
            <div className="px-3 py-2.5 border-b border-slate-50">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">团队列表</span>
            </div>

            <div className="flex-1 overflow-y-auto py-1.5 px-2 space-y-0.5">
              {org.teams.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6 px-3">暂无团队，点击下方添加</p>
              ) : (
                org.teams.map(team => (
                  <div key={team.id} className="group relative">
                    <button
                      onClick={() => setSelectedTeamId(team.id)}
                      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
                        selectedTeam?.id === team.id
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: team.color ?? '#6366f1' }}
                      />
                      <span className="flex-1 text-sm font-medium truncate">{team.name}</span>
                      <span className="text-[10px] text-slate-400 shrink-0 pr-5">{team.members.length}</span>
                    </button>

                    {/* Hover actions */}
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setTeamModal({ mode: 'edit', team }); }}
                        className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 bg-white/80"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteTeam(team.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-red-500 bg-white/80"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-100 p-2">
              <button
                onClick={() => setTeamModal({ mode: 'add' })}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加团队
              </button>
            </div>
          </div>

          {/* Members area */}
          <div className="flex-1 overflow-y-auto">
            {!selectedTeam ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Building2 className="w-12 h-12 text-slate-200 mb-3" />
                <p className="text-sm text-slate-400 mb-1">尚未创建任何团队</p>
                <p className="text-xs text-slate-300">点击左侧「添加团队」开始搭建组织架构</p>
              </div>
            ) : (
              <div className="p-6">
                {/* Team header */}
                <div className="flex items-center gap-3 mb-6">
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: selectedTeam.color ?? '#6366f1' }}
                  />
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold text-slate-800">{selectedTeam.name}</h2>
                    {selectedTeam.description && (
                      <p className="text-xs text-slate-400 mt-0.5">{selectedTeam.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setKnowledgeModal({ title: `${selectedTeam.name} · 知识库`, dirPath: TEAM_KNOWLEDGE_DIR(selectedTeam.id) })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors shrink-0"
                    title="编辑团队知识库"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    知识库
                  </button>
                  <button
                    onClick={() => setMemberModal({ teamId: selectedTeam.id })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加成员
                  </button>
                </div>

                {/* Members grid */}
                {selectedTeam.members.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Users className="w-10 h-10 text-slate-200 mb-3" />
                    <p className="text-sm text-slate-400">该团队暂无成员</p>
                    <button
                      onClick={() => setMemberModal({ teamId: selectedTeam.id })}
                      className="mt-3 text-sm text-indigo-600 hover:text-indigo-500 font-medium"
                    >
                      + 添加第一个成员
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                    {selectedTeam.members.map(member => {
                      const agentCfg = agents[member.agentId];
                      const displayName = member.name || agentCfg?.name || member.agentId;
                      const displayRole = member.role || member.agentId;
                      return (
                        <div
                          key={member.agentId}
                          className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col items-center gap-2.5 hover:border-indigo-200 hover:shadow-sm transition-all group"
                        >
                          <div className={`w-12 h-12 rounded-full ${getAvatarColor(member.agentId)} flex items-center justify-center text-white font-semibold text-sm shrink-0`}>
                            {getInitials(member.agentId, displayName)}
                          </div>

                          <div className="text-center min-w-0 w-full">
                            <p className="text-sm font-medium text-slate-800 truncate">{displayName}</p>
                            <p className="text-xs text-slate-400 truncate">{displayRole}</p>
                            {!agentCfg && (
                              <span className="text-[10px] text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded mt-1 inline-block">
                                未在网关配置
                              </span>
                            )}
                          </div>

                          {/* Actions (visible on hover) */}
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {agentCfg && (
                              <>
                                <button
                                  onClick={() => setFilesAgent({ id: member.agentId, config: agentCfg })}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                                  title="文件编辑"
                                >
                                  <FolderOpen className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setSessionsAgent({ id: member.agentId, config: agentCfg })}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                                  title="历史对话"
                                >
                                  <History className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setMemberModal({ teamId: selectedTeam.id, member })}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                              title="编辑"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteMember(selectedTeam.id, member.agentId)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="移除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {teamModal && (
        <TeamModal
          initial={teamModal.mode === 'edit' ? teamModal.team : undefined}
          onSave={handleSaveTeam}
          onClose={() => setTeamModal(null)}
        />
      )}

      {memberModal && (
        <MemberModal
          initial={memberModal.member}
          existingIds={org.teams.find(t => t.id === memberModal.teamId)?.members.map(m => m.agentId) ?? []}
          agents={agents}
          onSave={member => handleSaveMember(memberModal.teamId, member)}
          onClose={() => setMemberModal(null)}
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

      {knowledgeModal && (
        <KnowledgeEditor
          title={knowledgeModal.title}
          dirPath={knowledgeModal.dirPath}
          onClose={() => setKnowledgeModal(null)}
        />
      )}
    </>
  );
}
