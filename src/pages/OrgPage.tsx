import React, { useState, useEffect, useRef } from 'react';
import { client } from '../api/gateway';
import { useAppStore } from '../stores/useAppStore';
import { AgentFilesEditor } from '../components/agents/AgentFilesEditor';
import { AgentSessionsViewer } from '../components/agents/AgentSessionsViewer';
import { AgentChat } from '../components/agents/AgentChat';
import { KnowledgeEditor } from '../components/knowledge/KnowledgeEditor';
import { fillTemplate } from '../utils/template';
import orgSetupPromptTemplate from '../templates/org-setup-prompt.md?raw';
import {
  Building2, Plus, Pencil, Trash2, Users,
  FolderOpen, History, MessageSquare, X, Check, Download, Upload,
  Cloud, CloudOff, BookOpen, ChevronDown, Loader2, AlertCircle, Settings,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgEntry {
  id: string;
  name: string;
  dir: string;       // directory where organization.json lives
  color?: string;
  description?: string;
}

interface OrgsIndex {
  orgs: OrgEntry[];
  activeOrgId: string | null;
}

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
  company: { id?: string; name: string; description?: string; leadAgentId?: string };
  teams: OrgTeam[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively remove keys whose value is the redacted sentinel. */
function stripRedacted(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripRedacted);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== '__OPENCLAW_REDACTED__') result[k] = stripRedacted(v);
    }
    return result;
  }
  return obj;
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const ORGS_INDEX_KEY = 'openclaw_orgs_index';
const orgCacheKey = (id: string) => `openclaw_org_${id}`;
const LEGACY_KEY = 'openclaw_organization';

const orgFilePath = (dir: string) => `${dir}/organization.json`;
const orgKnowledgeDir = (dir: string) => `${dir}/knowledge`;
const teamKnowledgeDir = (dir: string, teamId: string) => `${dir}/${teamId}/knowledge`;

const DEFAULT_DIR = '~/.openclaw/workspaces';

function loadOrgsIndex(): OrgsIndex {
  const stored = localStorage.getItem(ORGS_INDEX_KEY);
  if (stored) {
    try { return JSON.parse(stored) as OrgsIndex; } catch { /* ignore */ }
  }
  // Migrate from legacy single-org storage
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const entry: OrgEntry = { id: 'default', name: '默认组织', dir: DEFAULT_DIR, color: ORG_COLORS[0] };
    const index: OrgsIndex = { orgs: [entry], activeOrgId: 'default' };
    localStorage.setItem(ORGS_INDEX_KEY, JSON.stringify(index));
    localStorage.setItem(orgCacheKey('default'), legacy);
    return index;
  }
  return { orgs: [], activeOrgId: null };
}

function saveOrgsIndex(index: OrgsIndex) {
  localStorage.setItem(ORGS_INDEX_KEY, JSON.stringify(index));
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TEAM_COLORS = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4',
  '#10b981', '#f59e0b', '#ef4444', '#ec4899',
];

const ORG_COLORS = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899',
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

// ── AddOrgModal ────────────────────────────────────────────────────────────────

interface AddOrgModalProps {
  initial?: OrgEntry;
  onSave: (entry: OrgEntry) => void;
  onClose: () => void;
}

function toOrgId(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function AddOrgModal({ initial, onSave, onClose }: AddOrgModalProps) {
  const isEditing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [orgId, setOrgId] = useState(initial?.id ?? '');
  const [idTouched, setIdTouched] = useState(isEditing); // editing = id is fixed
  const [description, setDescription] = useState(initial?.description ?? '');
  const [dir, setDir] = useState(initial?.dir ?? DEFAULT_DIR);
  const [color, setColor] = useState(initial?.color ?? ORG_COLORS[0]);
  const [autoFilled, setAutoFilled] = useState(false);

  // Auto-fill from organization.json when dir is entered (add mode only)
  useEffect(() => {
    if (isEditing) return;
    const trimmed = dir.trim().replace(/\/$/, '');
    if (!trimmed) return;
    const timer = setTimeout(async () => {
      try {
        const content = await client.readFile(`${trimmed}/organization.json`);
        const data = JSON.parse(content);
        const companyId: string = data?.company?.id ?? '';
        const companyName: string = data?.company?.name ?? '';
        const companyDesc: string = data?.company?.description ?? '';
        if (companyName) setName(companyName);
        if (!idTouched) setOrgId(companyId || toOrgId(companyName));
        if (companyDesc) setDescription(companyDesc);
        if (companyName || companyDesc || companyId) setAutoFilled(true);
      } catch {
        setAutoFilled(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [dir, isEditing]);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!idTouched) setOrgId(toOrgId(v));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = orgId.trim() || toOrgId(name) || `org-${Date.now()}`;
    if (!name.trim() || !id || !dir.trim()) return;
    onSave({ id, name: name.trim(), dir: dir.trim().replace(/\/$/, ''), color, description: description.trim() || undefined });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h3 className="font-semibold text-white text-sm">{isEditing ? '编辑组织' : '添加组织'}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">组织名称 *</label>
              <input
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. 我的公司"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">
                组织 ID *
                {isEditing && <span className="ml-1 text-white/40 font-normal">（不可修改）</span>}
              </label>
              <input
                value={orgId}
                onChange={e => { setIdTouched(true); setOrgId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono disabled:bg-white/5 disabled:text-white/40"
                placeholder="my-company"
                required
                disabled={isEditing}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">组织描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              rows={2}
              placeholder="组织的业务范围、职责说明等（新建目录时将用于自动生成配置）"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">
              组织目录 <span className="text-red-500">*</span>
              <span className="ml-1 text-white/40 font-normal">（organization.json 所在目录）</span>
            </label>
            <input
              value={dir}
              onChange={e => { setDir(e.target.value); setAutoFilled(false); }}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              placeholder="~/.openclaw/workspaces"
              required
            />
            {autoFilled && (
              <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1">
                <span>✓</span> 已从 organization.json 自动填入组织信息
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">颜色标识</label>
            <div className="flex gap-2 flex-wrap">
              {ORG_COLORS.map(c => (
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
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
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

// ── DeleteOrgModal ────────────────────────────────────────────────────────────

interface DeleteOrgModalProps {
  org: OrgEntry;
  orgAgentIds: string[];
  onConfirm: (deleteFiles: boolean, removeAgents: boolean) => void;
  onClose: () => void;
}

function DeleteOrgModal({ org, orgAgentIds, onConfirm, onClose }: DeleteOrgModalProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [removeAgents, setRemoveAgents] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const canDelete = !deleteFiles || confirmInput === org.id;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-md">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="font-semibold text-white text-sm">删除组织</h3>
          <button onClick={onClose} className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-white/70">
            确认删除组织 <strong className="text-white">{org.name}</strong>
            （<code className="font-mono text-xs bg-white/10 px-1 py-0.5 rounded">{org.id}</code>）？
          </p>

          {/* Options */}
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-white/10 hover:bg-white/5">
              <input
                type="radio"
                checked={!deleteFiles}
                onChange={() => { setDeleteFiles(false); setConfirmInput(''); }}
                className="mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium text-white/80">仅移除组织配置</p>
                <p className="text-xs text-white/40 mt-0.5">
                  从 UI 中移除此组织，目录 <code className="font-mono bg-white/10 px-1 rounded">{org.dir}</code> 不受影响
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-red-500/30 hover:bg-red-500/20">
              <input
                type="radio"
                checked={deleteFiles}
                onChange={() => setDeleteFiles(true)}
                className="mt-0.5 shrink-0 accent-red-500"
              />
              <div>
                <p className="text-sm font-medium text-red-300">彻底删除目录文件</p>
                <p className="text-xs text-red-400 mt-0.5">
                  同时删除 <code className="font-mono bg-red-500/15 px-1 rounded">{org.dir}</code> 下的所有文件和子目录
                </p>
              </div>
            </label>
          </div>

          {/* Remove agents checkbox */}
          {orgAgentIds.length > 0 && (
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-amber-500/30 hover:bg-amber-500/20">
              <input
                type="checkbox"
                checked={removeAgents}
                onChange={e => setRemoveAgents(e.target.checked)}
                className="mt-0.5 shrink-0 accent-amber-500"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-300">
                  同时从主配置移除 {orgAgentIds.length} 个 Agent
                </p>
                <p className="text-xs text-amber-500 mt-0.5">
                  将从{' '}
                  <code className="font-mono bg-amber-500/15 px-1 rounded">~/.openclaw/openclaw.json</code>{' '}
                  中删除以下 Agent：
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {orgAgentIds.map(id => (
                    <code key={id} className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                      {id}
                    </code>
                  ))}
                </div>
              </div>
            </label>
          )}

          {/* Destructive warning + confirm input */}
          {deleteFiles && (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300 leading-relaxed">
                  <strong>此操作不可恢复！</strong> 将永久删除{' '}
                  <code className="bg-red-500/20 px-1 rounded font-mono">{org.dir}</code>{' '}
                  目录下的所有文件和子目录，包括 organization.json、全部 agent workspace 文件及知识库内容。
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">
                  请输入组织 ID{' '}
                  <code className="font-mono bg-white/10 px-1 py-0.5 rounded text-red-300">{org.id}</code>{' '}
                  以确认
                </label>
                <input
                  value={confirmInput}
                  onChange={e => setConfirmInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 font-mono"
                  placeholder={org.id}
                  autoFocus
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteFiles, removeAgents)}
            disabled={!canDelete}
            className={`flex-1 py-2 text-sm text-white rounded-lg transition-colors disabled:opacity-40 ${
              deleteFiles ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-600 hover:bg-white/50'
            }`}
          >
            {deleteFiles ? '彻底删除' : '移除配置'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── OrgSetupModal ──────────────────────────────────────────────────────────────

function buildOrgSetupPrompt(entry: OrgEntry): string {
  return fillTemplate(orgSetupPromptTemplate, {
    orgName: entry.name,
    orgDescription: entry.description ?? '',
    orgDescriptionLine: entry.description ? `\n- **描述**：${entry.description}` : '',
    orgDir: entry.dir,
    orgId: entry.id,
  });
}

interface OrgSetupModalProps {
  entry: OrgEntry;
  agents: Record<string, any>;
  onStart: (agentId: string, agentConfig: any, prompt: string) => void;
  onSkip: () => void;
}

function OrgSetupModal({ entry, agents, onStart, onSkip }: OrgSetupModalProps) {
  const agentList = Object.entries(agents);
  const defaultAgentId = agentList.find(([id]) => id === 'main')?.[0]
    ?? agentList.find(([id]) => id.includes('main') || id.includes('arch'))?.[0]
    ?? agentList[0]?.[0]
    ?? '';
  const [selectedId, setSelectedId] = useState(defaultAgentId);
  const [prompt, setPrompt] = useState(() => buildOrgSetupPrompt(entry));

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div>
            <h3 className="font-semibold text-white text-sm">自动生成组织目录</h3>
            <p className="text-xs text-white/40 mt-0.5">目录 <span className="font-mono">{entry.dir}</span> 不存在，可由 Agent 自动创建</p>
          </div>
          <button onClick={onSkip} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {/* Agent selector */}
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">选择执行的 Agent</label>
            {agentList.length === 0 ? (
              <p className="text-xs text-amber-300 bg-amber-500/15 px-3 py-2 rounded-lg">
                暂无配置的 Agent，请先在 Agents 页面创建 Agent，或点击「跳过」手动配置。
              </p>
            ) : (
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white/10 text-white placeholder:text-white/30"
              >
                {agentList.map(([id, cfg]) => (
                  <option key={id} value={id}>{cfg.name || id} ({id})</option>
                ))}
              </select>
            )}
          </div>

          {/* Editable prompt */}
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">
              提示词
              <span className="ml-1 text-white/40 font-normal">（可修改）</span>
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="w-full px-3 py-2.5 text-xs text-white/80 bg-white/5 border border-white/10 rounded-lg leading-relaxed font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows={10}
            />
          </div>
        </div>

        <div className="flex gap-2 p-5 pt-3 border-t border-white/8 shrink-0">
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            跳过（手动配置）
          </button>
          <button
            type="button"
            disabled={!selectedId}
            onClick={() => onStart(selectedId, agents[selectedId], prompt)}
            className="flex-1 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
          >
            开始生成
          </button>
        </div>
      </div>
    </div>
  );
}

// ── OrgGeneratingModal ────────────────────────────────────────────────────────

interface OrgGeneratingModalProps {
  agentId: string;
  agentName: string;
  sessionKey: string;
  prompt: string;
  onClose: () => void;
  onGenerated: () => void;
}

function OrgGeneratingModal({ agentId: _agentId, agentName, sessionKey, prompt, onClose, onGenerated }: OrgGeneratingModalProps) {
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<'sending' | 'running' | 'done' | 'error'>('sending');
  const [errorMsg, setErrorMsg] = useState('');
  const outputRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe to streaming events
    const unsub = client.onEvent((event: any) => {
      if (event.event !== 'chat') return;
      const payload = event.payload ?? event.data ?? event;
      if (payload.sessionKey !== sessionKey) return;

      const { state, message } = payload;
      if (state === 'delta') {
        const raw = message?.content ?? message?.text ?? '';
        const next = typeof raw === 'string' ? raw
          : Array.isArray(raw) ? raw.map((c: any) => c.text ?? '').join('') : '';
        if (next.length >= outputRef.current.length) {
          outputRef.current = next;
          setOutput(next);
        }
        setStatus('running');
      } else if (state === 'final') {
        const content = outputRef.current || (typeof message?.content === 'string' ? message.content : '');
        outputRef.current = content;
        setOutput(content);
        setStatus('done');
        onGenerated();
      } else if (state === 'error' || state === 'aborted') {
        setStatus('error');
        setErrorMsg(state === 'error' ? '生成过程中出现错误' : '生成已中止');
      }
    });

    // Send the prompt
    client.chatSend(sessionKey, prompt)
      .then(() => setStatus('running'))
      .catch(err => {
        setStatus('error');
        setErrorMsg(err.message || 'Failed to send');
      });

    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  const statusLabel = {
    sending: `正在连接 ${agentName}…`,
    running: `${agentName} 正在生成组织配置…`,
    done: '生成完成',
    error: '生成失败',
  }[status];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-2xl flex flex-col" style={{ maxHeight: '80vh' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8 shrink-0">
          {status === 'done'
            ? <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            : status === 'error'
              ? <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              : <Loader2 className="w-4 h-4 animate-spin text-indigo-500 shrink-0" />
          }
          <h3 className={`font-semibold text-sm ${status === 'done' ? 'text-emerald-700' : status === 'error' ? 'text-red-300' : 'text-white'}`}>
            {statusLabel}
          </h3>
          {status !== 'sending' && status !== 'running' && (
            <button onClick={onClose} className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10 shrink-0">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-950 font-mono text-xs text-white/20 leading-relaxed whitespace-pre-wrap min-h-0">
          {output
            ? output
            : <span className="text-white/50">等待 Agent 响应…</span>
          }
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        {status === 'done' && (
          <div className="shrink-0 border-t border-emerald-100 bg-emerald-50 px-5 py-3 flex items-center justify-between">
            <span className="text-sm text-emerald-700 flex items-center gap-2">
              <Check className="w-4 h-4" />
              组织配置已生成，组织视图将自动刷新
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
            >
              完成
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="shrink-0 border-t border-red-500/20 bg-red-500/15 px-5 py-3 flex items-center justify-between">
            <span className="text-sm text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {errorMsg}
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-white/70 bg-white/10 hover:bg-white/15 rounded-lg transition-colors"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CompanyModal ───────────────────────────────────────────────────────────────

interface CompanyModalProps {
  initial: { name: string; description?: string; leadAgentId?: string };
  agents: Record<string, any>;
  onSave: (name: string, description: string, leadAgentId: string) => void;
  onClose: () => void;
}

function CompanyModal({ initial, agents, onSave, onClose }: CompanyModalProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [leadAgentId, setLeadAgentId] = useState(initial.leadAgentId ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), description.trim(), leadAgentId.trim());
  };

  const agentEntries = Object.entries(agents);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h3 className="font-semibold text-white text-sm">编辑公司信息</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">公司名称 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. 我的公司"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">组织描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              rows={3}
              placeholder="组织简介或职责描述..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">
              主负责人 Agent
              <span className="ml-1 text-white/40 font-normal">（可选，工作区为组织根目录）</span>
            </label>
            {agentEntries.length > 0 ? (
              <select
                value={leadAgentId}
                onChange={e => setLeadAgentId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white/10 text-white placeholder:text-white/30"
              >
                <option value="">-- 不设置 --</option>
                {agentEntries.map(([id, cfg]) => (
                  <option key={id} value={id}>{cfg.name ? `${cfg.name} (${id})` : id}</option>
                ))}
              </select>
            ) : (
              <input
                value={leadAgentId}
                onChange={e => setLeadAgentId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                placeholder="agent-id（网关中的 Agent ID）"
              />
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
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

// ── MergeConfigModal ──────────────────────────────────────────────────────────

interface MergeConfigModalProps {
  agents: any[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function MergeConfigModal({ agents, onConfirm, onClose }: MergeConfigModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    setError('');
    try {
      await onConfirm();
      setDone(true);
    } catch (e: any) {
      setError(e.message || '合并失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-lg">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
          {done
            ? <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            : <Download className="w-4 h-4 text-indigo-500 shrink-0" />
          }
          <h3 className="font-semibold text-white text-sm">
            {done ? '合并完成' : '合并 Agent 配置到主配置'}
          </h3>
          {!loading && (
            <button onClick={onClose} className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {done ? (
            <div className="flex items-center gap-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
              <p className="text-sm text-emerald-700">
                已成功合并 <strong>{agents.length}</strong> 个 Agent 到主配置
                <code className="ml-1 text-xs bg-emerald-100 px-1 py-0.5 rounded font-mono">~/.openclaw/openclaw.json</code>
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-white/70">
                检测到生成了 <strong className="text-white">{agents.length}</strong> 个 Agent，
                是否合并到主配置{' '}
                <code className="text-xs bg-white/10 px-1 py-0.5 rounded font-mono">~/.openclaw/openclaw.json</code>？
              </p>

              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {agents.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2.5 px-3 py-2 bg-white/5 rounded-lg border border-white/8">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 ${getAvatarColor(a.id)}`}>
                      {getInitials(a.id, a.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white/80 truncate">{a.name || a.id}</p>
                      <p className="text-xs text-white/40 font-mono truncate">{a.id}</p>
                    </div>
                    {a.model && (
                      <span className="text-[10px] font-mono text-white/40 bg-white/10 px-1.5 py-0.5 rounded shrink-0">
                        {typeof a.model === 'string' ? a.model.split('/').pop() : a.model.primary?.split('/').pop()}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          {done ? (
            <button
              onClick={onClose}
              className="flex-1 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
            >
              完成
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={loading}
                className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
              >
                跳过
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {loading ? '合并中…' : '合并到主配置'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TeamModal ──────────────────────────────────────────────────────────────────

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
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h3 className="font-semibold text-white text-sm">{initial ? '编辑团队' : '添加团队'}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">团队名称 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. 软件研发团队"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              rows={2}
              placeholder="团队职责描述..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">颜色</label>
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
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
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

// ── QuickConfigAgentModal ──────────────────────────────────────────────────────

interface QuickConfigAgentModalProps {
  agentId: string;
  defaultName: string;
  defaultWorkspace: string;
  onClose: () => void;
  onDone: () => void;
}

function QuickConfigAgentModal({ agentId, defaultName, defaultWorkspace, onClose, onDone }: QuickConfigAgentModalProps) {
  const [name, setName] = useState(defaultName);
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !workspace.trim() || !model.trim()) return;
    setLoading(true);
    setError('');
    try {
      const cfg = await client.configGet();
      const hash: string = cfg?.hash;
      if (!hash) throw new Error('无法获取配置 hash');
      const agent = {
        id: agentId,
        name: name.trim(),
        workspace: workspace.trim().replace(/\/$/, ''),
        model: model.trim(),
        subagents: { allowAgents: ['*'] },
        tools: { profile: 'full' },
      };
      await client.configPatchRaw({ agents: { list: [agent] } }, hash);
      setDone(true);
      onDone();
    } catch (e: any) {
      setError(e.message || '配置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-md">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
          <Settings className="w-4 h-4 text-indigo-500 shrink-0" />
          <h3 className="font-semibold text-white text-sm">配置 Agent</h3>
          <button onClick={onClose} className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        {done ? (
          <div className="p-5">
            <div className="flex items-center gap-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
              <p className="text-sm text-emerald-700">已成功添加到网关配置</p>
            </div>
            <button onClick={onClose} className="w-full py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              关闭
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">Agent ID</label>
              <input
                value={agentId}
                readOnly
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg bg-white/5 text-white/40 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">显示名称 *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">Workspace 目录 *</label>
              <input
                value={workspace}
                onChange={e => setWorkspace(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">模型 *</label>
              <input
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                required
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
                取消
              </button>
              <button type="submit" disabled={loading} className="flex-1 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                添加到网关配置
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── MemberModal ────────────────────────────────────────────────────────────────

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
      <div className="glass-heavy rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10 w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h3 className="font-semibold text-white text-sm">{initial ? '编辑成员' : '添加成员'}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">Agent *</label>
            <select
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white/10 text-white placeholder:text-white/30"
              required
            >
              <option value="">-- 选择 Agent --</option>
              {agentOptions.map(([id, cfg]) => (
                <option key={id} value={id}>{cfg.name ? `${cfg.name} (${id})` : id}</option>
              ))}
            </select>
            {agentOptions.length === 0 && !initial && (
              <p className="text-xs text-white/40 mt-1">所有已配置的 Agent 都已添加到该团队</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">显示名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="留空则使用 Agent 默认名称"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">职位 / 角色</label>
            <input
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Frontend Developer"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-white/70 bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
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

// ── OrgPage ────────────────────────────────────────────────────────────────────

export function OrgPage() {
  const { agents, fetchAgents } = useAppStore();
  const importRef = useRef<HTMLInputElement>(null);
  const orgDropdownRef = useRef<HTMLDivElement>(null);

  // Multi-org index
  const [orgsIndex, setOrgsIndex] = useState<OrgsIndex>(() => loadOrgsIndex());
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [addOrgModal, setAddOrgModal] = useState<{ mode: 'add' } | { mode: 'edit'; org: OrgEntry } | null>(null);
  const [deleteOrgModal, setDeleteOrgModal] = useState<OrgEntry | null>(null);
  const [setupState, setSetupState] = useState<{ entry: OrgEntry } | null>(null);
  const [generatingState, setGeneratingState] = useState<{ agentId: string; config: any; sessionKey: string; prompt: string } | null>(null);
  const [mergeState, setMergeState] = useState<{ agents: any[] } | null>(null);

  const activeOrg = orgsIndex.orgs.find(o => o.id === orgsIndex.activeOrgId) ?? null;

  // Per-org data
  const [org, setOrg] = useState<OrgConfig | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [fileSyncState, setFileSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [teamModal, setTeamModal] = useState<{ mode: 'add' } | { mode: 'edit'; team: OrgTeam } | null>(null);
  const [memberModal, setMemberModal] = useState<{ teamId: string; member?: OrgMember } | null>(null);
  const [quickConfigAgent, setQuickConfigAgent] = useState<{ agentId: string; name: string; workspace: string } | null>(null);

  const [filesAgent, setFilesAgent] = useState<{ id: string; config: any } | null>(null);
  const [sessionsAgent, setSessionsAgent] = useState<{ id: string; config: any } | null>(null);
  const [chatAgent, setChatAgent] = useState<{ id: string; config: any } | null>(null);
  const [knowledgeModal, setKnowledgeModal] = useState<{ title: string; dirPath: string } | null>(null);

  // Close org dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load org config whenever active org changes
  useEffect(() => {
    if (!activeOrg) {
      setOrg(null);
      setSelectedTeamId(null);
      return;
    }

    setOrg(null);
    setSelectedTeamId(null);

    (async () => {
      // Try server file first
      try {
        const content = await client.readFile(orgFilePath(activeOrg.dir));
        if (content?.trim()) {
          const parsed = JSON.parse(content) as OrgConfig;
          const cfg: OrgConfig = {
            company: parsed.company ?? { name: activeOrg.name },
            teams: parsed.teams ?? [],
          };
          setOrg(cfg);
          localStorage.setItem(orgCacheKey(activeOrg.id), JSON.stringify(cfg));
          if (cfg.teams.length > 0) setSelectedTeamId(cfg.teams[0].id);
          return;
        }
      } catch { /* file missing or server unavailable */ }

      // Fall back to local cache
      const cached = localStorage.getItem(orgCacheKey(activeOrg.id));
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as OrgConfig;
          const cfg: OrgConfig = {
            company: parsed.company ?? { name: activeOrg.name },
            teams: parsed.teams ?? [],
          };
          setOrg(cfg);
          if (cfg.teams.length > 0) setSelectedTeamId(cfg.teams[0].id);
          return;
        } catch { /* ignore */ }
      }

      // Default empty org
      setOrg({ company: { name: activeOrg.name }, teams: [] });
    })();
  }, [activeOrg?.id]);

  const saveOrg = async (newOrg: OrgConfig) => {
    if (!activeOrg) return;
    const withId: OrgConfig = { ...newOrg, company: { ...newOrg.company, id: activeOrg.id } };
    localStorage.setItem(orgCacheKey(activeOrg.id), JSON.stringify(withId));
    setOrg(withId);

    setFileSyncState('saving');
    try {
      await client.writeFile(orgFilePath(activeOrg.dir), JSON.stringify(withId, null, 2));
      setFileSyncState('saved');
      setTimeout(() => setFileSyncState('idle'), 2000);
    } catch {
      setFileSyncState('error');
      setTimeout(() => setFileSyncState('idle'), 3000);
    }
  };

  // Org CRUD
  const handleSaveOrg = async (entry: OrgEntry) => {
    const isNew = !orgsIndex.orgs.some(o => o.id === entry.id);

    setOrgsIndex(prev => {
      const orgs = isNew
        ? [...prev.orgs, entry]
        : prev.orgs.map(o => o.id === entry.id ? entry : o);
      const updated: OrgsIndex = { orgs, activeOrgId: prev.activeOrgId ?? entry.id };
      saveOrgsIndex(updated);
      return updated;
    });
    setAddOrgModal(null);

    // For new orgs, check if organization.json already exists
    if (isNew) {
      try {
        const content = await client.readFile(orgFilePath(entry.dir));
        // File exists — patch company.id if missing, then switch
        try {
          const parsed = JSON.parse(content) as OrgConfig;
          if (parsed?.company?.id !== entry.id) {
            const patched: OrgConfig = { ...parsed, company: { ...parsed.company, id: entry.id } };
            await client.writeFile(orgFilePath(entry.dir), JSON.stringify(patched, null, 2));
          }
        } catch { /* ignore parse/write errors */ }
        setOrgsIndex(prev => { const u = { ...prev, activeOrgId: entry.id }; saveOrgsIndex(u); return u; });
      } catch {
        // File doesn't exist — show setup modal
        setOrgsIndex(prev => { const u = { ...prev, activeOrgId: entry.id }; saveOrgsIndex(u); return u; });
        setSetupState({ entry });
      }
    }
  };

  const switchOrg = (id: string) => {
    setOrgsIndex(prev => {
      const updated = { ...prev, activeOrgId: id };
      saveOrgsIndex(updated);
      return updated;
    });
    setOrgDropdownOpen(false);
  };

  const handleDeleteOrg = async (deleteFiles: boolean, removeAgents: boolean) => {
    if (!deleteOrgModal) return;
    const target = deleteOrgModal;
    setDeleteOrgModal(null);

    if (deleteFiles) {
      try {
        await client.deleteDir(target.dir);
      } catch (err: any) {
        alert(`目录删除失败：${err.message}\n\n组织配置仍会从 UI 中移除。`);
      }
    }

    if (removeAgents) {
      try {
        const prefix = `${target.id}-`;
        const cfg = await client.configGet();
        const baseHash: string = cfg?.hash;
        if (!baseHash) throw new Error('无法获取配置 hash');
        const currentList: any[] = cfg?.config?.agents?.list ?? [];
        const filteredList = currentList.filter((a: any) => !String(a.id ?? '').startsWith(prefix));
        // Two-step delete: null clears the key so step 2 is a direct assignment, not a merge
        await client.configPatchRaw({ agents: { list: null } }, baseHash);
        const cfg2 = await client.configGet();
        const baseHash2: string = cfg2?.hash;
        if (!baseHash2) throw new Error('无法获取配置 hash');
        await client.configPatchRaw({ agents: { list: filteredList } }, baseHash2);
        fetchAgents();
      } catch (err: any) {
        alert(`Agent 配置移除失败：${err.message}`);
      }
    }

    setOrgsIndex(prev => {
      const orgs = prev.orgs.filter(o => o.id !== target.id);
      const activeOrgId = prev.activeOrgId === target.id ? (orgs[0]?.id ?? null) : prev.activeOrgId;
      const updated: OrgsIndex = { orgs, activeOrgId };
      saveOrgsIndex(updated);
      return updated;
    });
    localStorage.removeItem(orgCacheKey(target.id));
  };

  // Export / Import
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
          company: parsed.company ?? { name: activeOrg?.name ?? '我的公司' },
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

  // Company info
  const handleSaveCompany = (name: string, description: string, leadAgentId: string) => {
    if (!org) return;
    saveOrg({
      ...org,
      company: {
        name,
        ...(description ? { description } : {}),
        ...(leadAgentId ? { leadAgentId } : {}),
      },
    });
    setCompanyModalOpen(false);
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
  const totalMembers = (org?.teams ?? []).reduce((s, t) => s + t.members.length, 0);

  // ── No orgs yet ──────────────────────────────────────────────────────────────
  if (orgsIndex.orgs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 flex items-center justify-center mb-4">
          <Building2 className="w-8 h-8 text-indigo-400" />
        </div>
        <p className="text-white/80 font-medium mb-1">尚未添加任何组织</p>
        <p className="text-white/40 text-sm mb-5">添加第一个组织，并指定 organization.json 所在目录</p>
        <button
          onClick={() => setAddOrgModal({ mode: 'add' })}
          className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加组织
        </button>
        {addOrgModal && (
          <AddOrgModal
            initial={addOrgModal.mode === 'edit' ? addOrgModal.org : undefined}
            onSave={handleSaveOrg}
            onClose={() => setAddOrgModal(null)}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full">

        {/* Header */}
        <div className="border-b border-white/10 bg-white/10 backdrop-blur-xl px-6 py-3.5 shrink-0 relative z-10">
          <div className="flex items-center gap-3">

            {/* Org switcher */}
            <div className="relative" ref={orgDropdownRef}>
              <button
                onClick={() => setOrgDropdownOpen(v => !v)}
                className="flex items-center gap-2 pl-3 pr-2.5 py-1.5 rounded-lg border border-white/10 hover:border-indigo-500/40 hover:bg-indigo-50/50 transition-colors text-sm"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: activeOrg?.color ?? '#6366f1' }}
                />
                <span className="font-medium text-white/80 max-w-[140px] truncate">
                  {activeOrg?.name ?? '未选择'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-white/40 transition-transform ${orgDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {orgDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-80 glass rounded-2xl shadow-lg z-40 overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/8 bg-white/5">
                    <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">组织列表</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto py-1">
                    {orgsIndex.orgs.map(o => (
                      <div key={o.id} className={`flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors cursor-pointer ${o.id === orgsIndex.activeOrgId ? 'bg-indigo-50/70' : ''}`}
                        onClick={() => switchOrg(o.id)}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: o.color ?? '#6366f1' }} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${o.id === orgsIndex.activeOrgId ? 'text-indigo-300' : 'text-white/80'}`}>{o.name}</p>
                          <p className="text-xs text-white/40 font-mono truncate">{o.dir}</p>
                        </div>
                        {o.id === orgsIndex.activeOrgId && <Check className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                        <button
                          onClick={e => { e.stopPropagation(); setAddOrgModal({ mode: 'edit', org: o }); setOrgDropdownOpen(false); }}
                          className="w-6 h-6 flex items-center justify-center rounded text-white/30 hover:text-white/70 hover:bg-white/10 shrink-0"
                          title="编辑"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        {orgsIndex.orgs.length > 1 && (
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteOrgModal(o); setOrgDropdownOpen(false); }}
                            className="w-6 h-6 flex items-center justify-center rounded text-white/30 hover:text-red-500 hover:bg-red-500/20 shrink-0"
                            title="删除"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-white/8 p-2">
                    <button
                      onClick={() => { setAddOrgModal({ mode: 'add' }); setOrgDropdownOpen(false); }}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-white/40 hover:text-indigo-300 hover:bg-indigo-500/15 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      添加组织
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Company name + description */}
            {org && (
              <div className="flex items-start gap-1.5 min-w-0">
                <div className="min-w-0">
                  <h1 className="text-base font-semibold text-white leading-tight truncate">{org.company.name}</h1>
                  {org.company.description && (
                    <p className="text-xs text-white/40 truncate mt-0.5">{org.company.description}</p>
                  )}
                </div>
                <button
                  onClick={() => setCompanyModalOpen(true)}
                  className="text-white/30 hover:text-white/50 transition-colors shrink-0 mt-0.5"
                  title="编辑公司信息"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}

            {org && (
              <p className="text-white/40 text-xs shrink-0">
                {org.teams.length} 个团队 · {totalMembers} 名成员
              </p>
            )}

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {/* File sync indicator */}
              {fileSyncState === 'saving' && (
                <span className="text-xs text-white/40 flex items-center gap-1">
                  <Cloud className="w-3.5 h-3.5 animate-pulse" /> 同步中…
                </span>
              )}
              {fileSyncState === 'saved' && (
                <span className="text-xs text-emerald-500 flex items-center gap-1">
                  <Cloud className="w-3.5 h-3.5" /> 已保存
                </span>
              )}
              {fileSyncState === 'error' && (
                <span className="text-xs text-amber-500 flex items-center gap-1" title="写入文件失败，数据已保存到 localStorage">
                  <CloudOff className="w-3.5 h-3.5" /> 仅本地
                </span>
              )}

              {activeOrg && org && (
                <>
                  <button
                    onClick={() => setKnowledgeModal({ title: '组织知识库', dirPath: orgKnowledgeDir(activeOrg.dir) })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
                  >
                    <BookOpen className="w-3 h-3" />
                    知识库
                  </button>
                  <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                  <button
                    onClick={() => importRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
                  >
                    <Upload className="w-3 h-3" />
                    导入
                  </button>
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    导出
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        {!activeOrg || !org ? (
          <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
            加载中…
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">

            {/* Teams sidebar */}
            <div className="w-52 shrink-0 border-r border-white/8 flex flex-col">
              {/* Lead agent section */}
              <div className="px-3 py-2.5 border-b border-white/8">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">主负责人</span>
                  <button
                    onClick={() => setCompanyModalOpen(true)}
                    className="text-white/30 hover:text-white/50 transition-colors"
                    title="设置主负责人"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
                {(() => {
                  const leadId = org.company.leadAgentId;
                  if (!leadId) {
                    return (
                      <button
                        onClick={() => setCompanyModalOpen(true)}
                        className="w-full text-left text-xs text-white/40 hover:text-indigo-300 transition-colors py-0.5"
                      >
                        + 设置主负责人
                      </button>
                    );
                  }
                  const leadCfg = agents[leadId];
                  return (
                    <div className="group">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full ${getAvatarColor(leadId)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {getInitials(leadId, leadCfg?.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-white/80 truncate">{leadCfg?.name || leadId}</p>
                          <p className="text-[10px] text-white/40 font-mono truncate">{leadId}</p>
                        </div>
                      </div>
                      <div className="flex gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {leadCfg ? (
                          <>
                            <button
                              onClick={() => setChatAgent({ id: leadId, config: leadCfg })}
                              className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-indigo-300 hover:bg-indigo-500/15 transition-colors"
                              title="发送消息"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setFilesAgent({ id: leadId, config: leadCfg })}
                              className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-indigo-500 hover:bg-indigo-500/15 transition-colors"
                              title="文件编辑"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setSessionsAgent({ id: leadId, config: leadCfg })}
                              className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-indigo-500 hover:bg-indigo-500/15 transition-colors"
                              title="历史对话"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setQuickConfigAgent({ agentId: leadId, name: leadId, workspace: activeOrg!.dir })}
                            className="w-6 h-6 flex items-center justify-center rounded text-amber-500 hover:text-amber-300 hover:bg-amber-500/20 transition-colors"
                            title="配置到网关"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => saveOrg({ ...org, company: { ...org.company, leadAgentId: undefined } })}
                          className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-red-500 hover:bg-red-500/20 transition-colors"
                          title="移除主负责人"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })()}
                {org.company.leadAgentId && !agents[org.company.leadAgentId] && (
                  <span className="text-[10px] text-amber-500 bg-amber-500/15 px-1.5 py-0.5 rounded mt-1 inline-block">
                    未在网关配置
                  </span>
                )}
              </div>

              <div className="px-3 py-2.5 border-b border-slate-50">
                <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">团队列表</span>
              </div>

              <div className="flex-1 overflow-y-auto py-1.5 px-2 space-y-0.5">
                {org.teams.length === 0 ? (
                  <p className="text-xs text-white/40 text-center py-6 px-3">暂无团队，点击下方添加</p>
                ) : (
                  org.teams.map(team => (
                    <div key={team.id} className="group relative">
                      <button
                        onClick={() => setSelectedTeamId(team.id)}
                        className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
                          selectedTeam?.id === team.id
                            ? 'bg-indigo-500/15 text-indigo-300'
                            : 'text-white/70 hover:bg-white/5'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: team.color ?? '#6366f1' }}
                        />
                        <span className="flex-1 text-sm font-medium truncate">{team.name}</span>
                        <span className="text-[10px] text-white/40 shrink-0 pr-5">{team.members.length}</span>
                      </button>

                      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); setTeamModal({ mode: 'edit', team }); }}
                          className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-white/70 bg-white/80"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteTeam(team.id); }}
                          className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-red-500 bg-white/80"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-white/8 p-2">
                <button
                  onClick={() => setTeamModal({ mode: 'add' })}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-white/40 hover:text-indigo-300 hover:bg-indigo-500/15 transition-colors"
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
                  <Building2 className="w-12 h-12 text-white/20 mb-3" />
                  <p className="text-sm text-white/40 mb-1">尚未创建任何团队</p>
                  <p className="text-xs text-white/30">点击左侧「添加团队」开始搭建组织架构</p>
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
                      <h2 className="text-base font-semibold text-white">{selectedTeam.name}</h2>
                      {selectedTeam.description && (
                        <p className="text-xs text-white/40 mt-0.5">{selectedTeam.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setKnowledgeModal({
                        title: `${selectedTeam.name} · 知识库`,
                        dirPath: teamKnowledgeDir(activeOrg.dir, selectedTeam.id),
                      })}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors shrink-0"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      知识库
                    </button>
                    <button
                      onClick={() => setMemberModal({ teamId: selectedTeam.id })}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/20 rounded-lg transition-colors shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加成员
                    </button>
                  </div>

                  {/* Members grid */}
                  {selectedTeam.members.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Users className="w-10 h-10 text-white/20 mb-3" />
                      <p className="text-sm text-white/40">该团队暂无成员</p>
                      <button
                        onClick={() => setMemberModal({ teamId: selectedTeam.id })}
                        className="mt-3 text-sm text-indigo-300 hover:text-indigo-500 font-medium"
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
                        const openQuickConfig = () => {
                          const prefix = `${activeOrg!.id}-${selectedTeam.id}-`;
                          const roleName = member.agentId.startsWith(prefix)
                            ? member.agentId.slice(prefix.length)
                            : member.agentId;
                          setQuickConfigAgent({
                            agentId: member.agentId,
                            name: member.name || member.agentId,
                            workspace: `${activeOrg!.dir}/${selectedTeam.id}/${roleName}`,
                          });
                        };
                        return (
                          <div
                            key={member.agentId}
                            className="glass rounded-2xl p-4 flex flex-col items-center gap-2.5 hover:border-indigo-500/30 hover:shadow-sm transition-all group"
                          >
                            <div className={`w-12 h-12 rounded-full ${getAvatarColor(member.agentId)} flex items-center justify-center text-white font-semibold text-sm shrink-0`}>
                              {getInitials(member.agentId, displayName)}
                            </div>

                            <div className="text-center min-w-0 w-full">
                              <p className="text-sm font-medium text-white truncate">{displayName}</p>
                              <p className="text-xs text-white/40 truncate">{displayRole}</p>
                              {!agentCfg && (
                                <span className="text-[10px] text-amber-500 bg-amber-500/15 px-1.5 py-0.5 rounded mt-1 inline-block">
                                  未在网关配置
                                </span>
                              )}
                            </div>

                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {agentCfg && (
                                <>
                                  <button
                                    onClick={() => setChatAgent({ id: member.agentId, config: agentCfg })}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-300 hover:bg-indigo-500/15 transition-colors"
                                    title="发送消息"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setFilesAgent({ id: member.agentId, config: agentCfg })}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-500 hover:bg-indigo-500/15 transition-colors"
                                    title="文件编辑"
                                  >
                                    <FolderOpen className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setSessionsAgent({ id: member.agentId, config: agentCfg })}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-500 hover:bg-indigo-500/15 transition-colors"
                                    title="历史对话"
                                  >
                                    <History className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              {!agentCfg && (
                                <button
                                  onClick={openQuickConfig}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-amber-500 hover:text-amber-300 hover:bg-amber-500/20 transition-colors"
                                  title="配置到网关"
                                >
                                  <Settings className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => setMemberModal({ teamId: selectedTeam.id, member })}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
                                title="编辑"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteMember(selectedTeam.id, member.agentId)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-red-500 hover:bg-red-500/20 transition-colors"
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
        )}
      </div>

      {/* Modals */}
      {deleteOrgModal && (
        <DeleteOrgModal
          org={deleteOrgModal}
          orgAgentIds={Object.keys(agents).filter(id => id.startsWith(`${deleteOrgModal.id}-`))}
          onConfirm={handleDeleteOrg}
          onClose={() => setDeleteOrgModal(null)}
        />
      )}

      {addOrgModal && (
        <AddOrgModal
          initial={addOrgModal.mode === 'edit' ? addOrgModal.org : undefined}
          onSave={handleSaveOrg}
          onClose={() => setAddOrgModal(null)}
        />
      )}

      {setupState && (
        <OrgSetupModal
          entry={setupState.entry}
          agents={agents}
          onStart={(agentId, config, prompt) => {
            setSetupState(null);
            const sessionKey = `agent:${agentId}:web_org_setup_${Date.now()}`;
            setGeneratingState({ agentId, config, sessionKey, prompt });
          }}
          onSkip={() => setSetupState(null)}
        />
      )}

      {generatingState && (
        <OrgGeneratingModal
          agentId={generatingState.agentId}
          agentName={generatingState.config?.name || generatingState.agentId}
          sessionKey={generatingState.sessionKey}
          prompt={generatingState.prompt}
          onGenerated={() => {
            if (activeOrg) {
              // Refresh organization.json → update UI
              client.readFile(orgFilePath(activeOrg.dir))
                .then(content => {
                  if (!content?.trim()) return;
                  const parsed = JSON.parse(content) as OrgConfig;
                  const cfg: OrgConfig = {
                    company: parsed.company ?? { name: activeOrg.name },
                    teams: parsed.teams ?? [],
                  };
                  setOrg(cfg);
                  localStorage.setItem(orgCacheKey(activeOrg.id), JSON.stringify(cfg));
                  if (cfg.teams.length > 0) setSelectedTeamId(cfg.teams[0].id);
                })
                .catch(() => {});
              // Read generated openclaw.json → prompt user to merge
              client.readFile(`${activeOrg.dir}/openclaw.json`)
                .then(content => {
                  if (!content?.trim()) return;
                  const parsed = JSON.parse(content);
                  const agentList: any[] = parsed?.agents?.list ?? [];
                  if (agentList.length > 0) setMergeState({ agents: agentList });
                })
                .catch(() => {});
            }
          }}
          onClose={() => setGeneratingState(null)}
        />
      )}

      {!generatingState && mergeState && (
        <MergeConfigModal
          agents={mergeState.agents}
          onConfirm={async () => {
            const currentCfg = await client.configGet();
            const baseHash = currentCfg?.hash;
            if (!baseHash) throw new Error('无法获取主配置 hash');
            await client.configPatchRaw({ agents: { list: mergeState.agents } }, baseHash);
            fetchAgents();
          }}
          onClose={() => setMergeState(null)}
        />
      )}

      {companyModalOpen && org && (
        <CompanyModal
          initial={org.company}
          agents={agents}
          onSave={handleSaveCompany}
          onClose={() => setCompanyModalOpen(false)}
        />
      )}

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
          existingIds={org?.teams.find(t => t.id === memberModal.teamId)?.members.map(m => m.agentId) ?? []}
          agents={agents}
          onSave={member => handleSaveMember(memberModal.teamId, member)}
          onClose={() => setMemberModal(null)}
        />
      )}

      {quickConfigAgent && (
        <QuickConfigAgentModal
          agentId={quickConfigAgent.agentId}
          defaultName={quickConfigAgent.name}
          defaultWorkspace={quickConfigAgent.workspace}
          onClose={() => setQuickConfigAgent(null)}
          onDone={() => { fetchAgents(); setQuickConfigAgent(null); }}
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
