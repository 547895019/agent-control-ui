import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '../api/gateway';
import { useAppStore } from '../stores/useAppStore';
import { Puzzle, RefreshCw, X, ChevronDown, ChevronRight, Eye, EyeOff, Search, Download, CheckCircle2, Loader2 } from 'lucide-react';

const CLAWHUB_BASE = 'https://clawhub.ai';

interface ClawHubSkill {
  name: string;
  displayName?: string;
  summary?: string;
  latestVersion?: string;
  channel?: string;
  capabilityTags?: string[];
}

async function searchClawHubSkills(q: string): Promise<ClawHubSkill[]> {
  const params = new URLSearchParams({ q, family: 'skill', limit: '20' });
  const res = await fetch(`${CLAWHUB_BASE}/api/v1/packages/search?${params}`);
  if (!res.ok) throw new Error(`搜索失败 (${res.status})`);
  const data = await res.json();
  return (data.results ?? []).map((r: any) => r.package as ClawHubSkill);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Requirements {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
}

interface SkillInstallOption {
  id: string;
  kind: string;
  label: string;
  bins: string[];
}

interface SkillStatusEntry {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: Requirements;
  missing: Requirements;
  configChecks: any[];
  install: SkillInstallOption[];
}

interface SkillStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
}

interface SkillMessage {
  kind: 'success' | 'error';
  text: string;
}

// ── Grouping ──────────────────────────────────────────────────────────────────

interface SkillGroup {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
  openByDefault: boolean;
}

const SOURCE_GROUPS = [
  { id: 'workspace', label: 'Workspace Skills', sources: ['openclaw-workspace'], openByDefault: false },
  { id: 'built-in',  label: 'Built-in Skills',  sources: ['openclaw-bundled'],   openByDefault: false },
  { id: 'installed', label: 'Installed Skills',  sources: ['openclaw-managed'],   openByDefault: true  },
  { id: 'extra',     label: 'Extra Skills',       sources: ['openclaw-extra'],     openByDefault: true  },
];

function groupSkills(skills: SkillStatusEntry[]): SkillGroup[] {
  const map = new Map<string, SkillGroup>();
  for (const def of SOURCE_GROUPS) {
    map.set(def.id, { ...def, skills: [] });
  }
  const other: SkillGroup = { id: 'other', label: 'Other Skills', skills: [], openByDefault: true };

  for (const skill of skills) {
    const match = skill.bundled
      ? SOURCE_GROUPS.find(g => g.id === 'built-in')
      : SOURCE_GROUPS.find(g => g.sources.includes(skill.source));
    if (match) {
      map.get(match.id)!.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }

  const result = SOURCE_GROUPS
    .map(def => map.get(def.id)!)
    .filter(g => g.skills.length > 0);
  if (other.skills.length > 0) result.push(other);
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeMissing(skill: SkillStatusEntry): string[] {
  return [
    ...skill.missing.bins.map(b => `bin:${b}`),
    ...skill.missing.env.map(e => `env:${e}`),
    ...skill.missing.config.map(c => `config:${c}`),
    ...skill.missing.os.map(o => `os:${o}`),
  ];
}

function computeReasons(skill: SkillStatusEntry): string[] {
  const r: string[] = [];
  if (skill.disabled) r.push('disabled');
  if (skill.blockedByAllowlist) r.push('blocked by allowlist');
  return r;
}

function clampText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    'openclaw-bundled': 'bundled',
    'openclaw-workspace': 'workspace',
    'openclaw-managed': 'installed',
    'openclaw-extra': 'extra',
  };
  return map[source] ?? source;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusChips({ skill }: { skill: SkillStatusEntry }) {
  const showBundledBadge = skill.bundled && skill.source !== 'openclaw-bundled';
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-white/70 font-medium">
        {sourceLabel(skill.source)}
      </span>
      {showBundledBadge && (
        <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-white/70 font-medium">
          bundled
        </span>
      )}
      <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
        skill.eligible
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-amber-500/20 text-amber-300'
      }`}>
        {skill.eligible ? 'eligible' : 'blocked'}
      </span>
      {skill.disabled && (
        <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 font-medium">
          disabled
        </span>
      )}
    </div>
  );
}

function SkillCard({
  skill,
  busy,
  message,
  apiKeyEdit,
  onToggle,
  onInstall,
  onEditKey,
  onSaveKey,
}: {
  skill: SkillStatusEntry;
  busy: boolean;
  message: SkillMessage | null;
  apiKeyEdit: string;
  onToggle: () => void;
  onInstall: (installId: string) => void;
  onEditKey: (val: string) => void;
  onSaveKey: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const missing = computeMissing(skill);
  const reasons = computeReasons(skill);
  const canInstall = skill.install.length > 0 && skill.missing.bins.length > 0;
  const firstInstall = skill.install[0];

  return (
    <div className="bg-white/8 backdrop-blur-xl border border-white/10 rounded-lg p-4 flex gap-4">
      {/* Left: info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-white text-sm">
          {skill.emoji ? `${skill.emoji} ` : ''}{skill.name}
          {skill.homepage && (
            <a
              href={skill.homepage}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-indigo-500 hover:text-indigo-300 text-xs"
            >
              ↗
            </a>
          )}
        </div>
        <p className="text-xs text-white/50 mt-0.5 leading-relaxed">
          {clampText(skill.description, 140)}
        </p>
        <StatusChips skill={skill} />
        {missing.length > 0 && (
          <p className="text-xs text-white/40 mt-1.5">
            <span className="text-white/50 font-medium">Missing:</span>{' '}
            {missing.join(', ')}
          </p>
        )}
        {reasons.length > 0 && (
          <p className="text-xs text-white/40 mt-0.5">
            <span className="text-white/50 font-medium">Reason:</span>{' '}
            {reasons.join(', ')}
          </p>
        )}
      </div>

      {/* Right: actions */}
      <div className="shrink-0 flex flex-col items-end gap-2 min-w-[120px]">
        {/* Enable/Disable */}
        <button
          onClick={onToggle}
          disabled={busy}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors disabled:opacity-50 ${
            skill.disabled
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
              : 'bg-white/10 hover:bg-white/15 text-white/80'
          }`}
        >
          {busy ? <RefreshCw className="w-3 h-3 animate-spin inline" /> : (skill.disabled ? 'Enable' : 'Disable')}
        </button>

        {/* Install */}
        {canInstall && firstInstall && (
          <button
            onClick={() => onInstall(firstInstall.id)}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-lg font-medium bg-amber-500/15 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? 'Installing…' : firstInstall.label}
          </button>
        )}

        {/* Multiple install options */}
        {skill.install.length > 1 && skill.missing.bins.length > 0 && (
          <div className="flex flex-col gap-1 w-full">
            {skill.install.slice(1).map(opt => (
              <button
                key={opt.id}
                onClick={() => onInstall(opt.id)}
                disabled={busy}
                className="px-2 py-1 text-[10px] rounded font-medium bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 transition-colors disabled:opacity-50 whitespace-nowrap text-right"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Message */}
        {message && (
          <p className={`text-[10px] text-right max-w-[160px] ${
            message.kind === 'error' ? 'text-red-500' : 'text-emerald-600'
          }`}>
            {message.text}
          </p>
        )}

        {/* API key input */}
        {skill.primaryEnv && (
          <div className="w-full space-y-1.5 mt-1">
            <p className="text-[10px] text-white/40 text-right">{skill.primaryEnv}</p>
            <div className="flex items-center gap-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyEdit}
                onChange={e => onEditKey(e.target.value)}
                placeholder="API key"
                className="flex-1 min-w-0 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-400 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="p-1 text-white/40 hover:text-white/70"
              >
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <button
              onClick={onSaveKey}
              disabled={busy || !apiKeyEdit.trim()}
              className="w-full px-2 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50 transition-colors"
            >
              Save key
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillGroupSection({
  group,
  busy,
  messages,
  apiKeyEdits,
  onToggle,
  onInstall,
  onEditKey,
  onSaveKey,
}: {
  group: SkillGroup;
  busy: string | null;
  messages: Record<string, SkillMessage>;
  apiKeyEdits: Record<string, string>;
  onToggle: (skillKey: string, disabled: boolean) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onEditKey: (skillKey: string, val: string) => void;
  onSaveKey: (skillKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(group.openByDefault);
  const eligibleCount = group.skills.filter(s => s.eligible).length;

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Group header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-white/40" />
          ) : (
            <ChevronRight className="w-4 h-4 text-white/40" />
          )}
          <span className="font-semibold text-sm text-white/80">{group.label}</span>
          <span className="text-xs text-white/40 font-normal">
            {group.skills.length} 个
            {eligibleCount < group.skills.length && (
              <span className="text-amber-500 ml-1">({group.skills.length - eligibleCount} blocked)</span>
            )}
          </span>
        </div>
        <span className="text-xs text-white/40">{expanded ? '收起' : '展开'}</span>
      </button>

      {/* Skill cards */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2.5 border-t border-white/8">
          <div className="pt-3 space-y-2.5">
            {group.skills.map(skill => (
              <SkillCard
                key={skill.skillKey}
                skill={skill}
                busy={busy === skill.skillKey}
                message={messages[skill.skillKey] ?? null}
                apiKeyEdit={apiKeyEdits[skill.skillKey] ?? ''}
                onToggle={() => onToggle(skill.skillKey, skill.disabled)}
                onInstall={installId => onInstall(skill.skillKey, skill.name, installId)}
                onEditKey={val => onEditKey(skill.skillKey, val)}
                onSaveKey={() => onSaveKey(skill.skillKey)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function SkillsPage() {
  const { connectionStatus, agents } = useAppStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'installed' | 'market'>('installed');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, SkillMessage>>({});
  const [apiKeyEdits, setApiKeyEdits] = useState<Record<string, string>>({});

  // ClawHub market state
  const [marketQuery, setMarketQuery] = useState('');
  const [marketResults, setMarketResults] = useState<ClawHubSkill[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [installSent, setInstallSent] = useState<Record<string, boolean>>({});
  const [installSending, setInstallSending] = useState<string | null>(null);
  const marketDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMessage = useCallback((skillKey: string, msg?: SkillMessage) => {
    setMessages(prev => {
      const next = { ...prev };
      if (msg) next[skillKey] = msg;
      else delete next[skillKey];
      return next;
    });
  }, []);

  const loadSkills = useCallback(async (clearMessages = false) => {
    setLoading(true);
    setError(null);
    if (clearMessages) setMessages({});
    try {
      const res = await client.skillsStatus();
      if (res) setReport(res);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggle = useCallback(async (skillKey: string, currentlyDisabled: boolean) => {
    setBusyKey(skillKey);
    setError(null);
    try {
      // disabled=true means currently disabled → we want to enable → enabled=true
      await client.skillsUpdate(skillKey, { enabled: currentlyDisabled });
      await loadSkills();
      setMessage(skillKey, {
        kind: 'success',
        text: currentlyDisabled ? 'Skill enabled' : 'Skill disabled',
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      setMessage(skillKey, { kind: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  }, [loadSkills, setMessage]);

  const handleInstall = useCallback(async (skillKey: string, name: string, installId: string) => {
    setBusyKey(skillKey);
    setError(null);
    try {
      const res = await client.skillsInstall(name, installId);
      await loadSkills();
      setMessage(skillKey, { kind: 'success', text: res?.message ?? 'Installed successfully' });
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      setMessage(skillKey, { kind: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  }, [loadSkills, setMessage]);

  const handleSaveKey = useCallback(async (skillKey: string) => {
    setBusyKey(skillKey);
    setError(null);
    try {
      const apiKey = apiKeyEdits[skillKey] ?? '';
      await client.skillsUpdate(skillKey, { apiKey });
      await loadSkills();
      setMessage(skillKey, { kind: 'success', text: 'API key saved' });
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      setMessage(skillKey, { kind: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  }, [apiKeyEdits, loadSkills, setMessage]);

  const handleEditKey = useCallback((skillKey: string, val: string) => {
    setApiKeyEdits(prev => ({ ...prev, [skillKey]: val }));
  }, []);

  // ClawHub market handlers
  const runMarketSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setMarketResults([]); setMarketError(''); return; }
    setMarketLoading(true);
    setMarketError('');
    try {
      const results = await searchClawHubSkills(q.trim());
      setMarketResults(results);
    } catch (e: any) {
      setMarketError(e?.message || String(e));
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const handleMarketQueryChange = useCallback((q: string) => {
    setMarketQuery(q);
    if (marketDebounce.current) clearTimeout(marketDebounce.current);
    marketDebounce.current = setTimeout(() => runMarketSearch(q), 500);
  }, [runMarketSearch]);

  const sendInstallToAgent = useCallback(async (slug: string) => {
    const agentEntries = Object.entries(agents);
    const mainAgent = agents['main'] ?? agentEntries[0]?.[1];
    if (!mainAgent) { alert('未找到可用的 Agent，请先连接 Gateway'); return; }
    const agentId = mainAgent.id ?? agentEntries[0]?.[0];
    const sessionKey = `agent:${agentId}:main`;
    setInstallSending(slug);
    try {
      await client.chatSend(sessionKey, `请帮我安装 ClawHub 技能包，运行命令：clawhub install ${slug}`);
      setInstallSent(prev => ({ ...prev, [slug]: true }));
      navigate('/agents');
    } catch (e: any) {
      alert(`发送失败：${e?.message || String(e)}`);
    } finally {
      setInstallSending(null);
    }
  }, [agents, navigate]);

  // Auto-load when connected
  useEffect(() => { if (connectionStatus === 'connected') loadSkills(true); }, [connectionStatus]);

  const filtered = useMemo(() => {
    const skills = report?.skills ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(s =>
      [s.name, s.description, s.source].join(' ').toLowerCase().includes(q)
    );
  }, [report, filter]);

  const groups = useMemo(() => groupSkills(filtered), [filtered]);

  const totalEligible = useMemo(() => (report?.skills ?? []).filter(s => s.eligible).length, [report]);

  return (
    <div className="p-6 space-y-5 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-indigo-500" />
            技能管理
          </h1>
          <p className="text-sm text-white/50 mt-0.5">管理和配置可用技能</p>
        </div>
        <button
          onClick={() => loadSkills(true)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors font-medium"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => setTab('installed')}
          className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'installed'
              ? 'text-white border-indigo-500'
              : 'text-white/50 border-transparent hover:text-white/70'
          }`}
        >
          已安装
        </button>
        <button
          onClick={() => setTab('market')}
          className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'market'
              ? 'text-white border-indigo-500'
              : 'text-white/50 border-transparent hover:text-white/70'
          }`}
        >
          ClawHub 市场
        </button>
      </div>

      {tab === 'installed' && (<>
        {/* Search bar + stats */}
        <div className="bg-white/8 backdrop-blur-xl rounded-xl border border-white/10 p-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="搜索技能..."
            className="flex-1 min-w-[180px] border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white/10 text-white placeholder:text-white/30"
          />
          {report && (
            <span className="text-xs text-white/50 whitespace-nowrap">
              {filtered.length} / {report.skills.length} 个
              {totalEligible < report.skills.length && (
                <span className="text-amber-500 ml-1">({totalEligible} eligible)</span>
              )}
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/15 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <X className="w-4 h-4 text-red-400 hover:text-red-300" />
            </button>
          </div>
        )}

        {/* Empty / loading states */}
        {!report && !loading && (
          <div className="text-center py-20 text-white/40">
            <Puzzle className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm mb-3">点击"刷新"加载技能列表</p>
            <button
              onClick={() => loadSkills(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
            >
              加载技能
            </button>
          </div>
        )}

        {loading && (
          <div className="text-center py-20 text-white/40">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40" />
            <p className="text-sm">加载中...</p>
          </div>
        )}

        {/* Skill groups */}
        {!loading && groups.length > 0 && (
          <div className="space-y-4">
            {groups.map(group => (
              <SkillGroupSection
                key={group.id}
                group={group}
                busy={busyKey}
                messages={messages}
                apiKeyEdits={apiKeyEdits}
                onToggle={handleToggle}
                onInstall={handleInstall}
                onEditKey={handleEditKey}
                onSaveKey={handleSaveKey}
              />
            ))}
          </div>
        )}

        {!loading && report && filtered.length === 0 && (
          <div className="text-center py-12 text-white/40">
            <p className="text-sm">未找到匹配的技能</p>
          </div>
        )}
      </>)}

      {tab === 'market' && (
        <div className="space-y-4">
          {/* Search input */}
          <div className="bg-white/8 backdrop-blur-xl rounded-xl border border-white/10 p-4 flex items-center gap-2">
            <Search className="w-4 h-4 text-white/40 shrink-0" />
            <input
              type="text"
              value={marketQuery}
              onChange={e => handleMarketQueryChange(e.target.value)}
              placeholder="搜索 ClawHub 技能市场..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
            />
            {marketLoading && <Loader2 className="w-4 h-4 animate-spin text-white/40 shrink-0" />}
          </div>

          {/* Market error */}
          {marketError && (
            <div className="bg-red-500/15 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3">
              {marketError}
            </div>
          )}

          {/* Results */}
          {marketResults.length > 0 && (
            <div className="space-y-2.5">
              {marketResults.map(pkg => {
                const sent = installSent[pkg.name];
                const sending = installSending === pkg.name;
                return (
                  <div key={pkg.name} className="bg-white/8 backdrop-blur-xl border border-white/10 rounded-lg p-4 flex gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white text-sm">{pkg.displayName ?? pkg.name}</div>
                      <p className="text-xs text-white/40 mt-0.5">
                        {pkg.name}{pkg.latestVersion ? ` · v${pkg.latestVersion}` : ''}
                      </p>
                      {pkg.summary && (
                        <p className="text-xs text-white/50 mt-1 leading-relaxed">{clampText(pkg.summary, 140)}</p>
                      )}
                      {pkg.capabilityTags && pkg.capabilityTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {pkg.capabilityTags.slice(0, 5).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-500/20 text-indigo-300 font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end justify-center">
                      <button
                        onClick={() => sendInstallToAgent(pkg.name)}
                        disabled={sending || sent}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors disabled:opacity-60 ${
                          sent
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        {sending
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : sent
                          ? <CheckCircle2 className="w-3 h-3" />
                          : <Download className="w-3 h-3" />
                        }
                        {sending ? '发送中...' : sent ? '已发送' : '安装'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* No results */}
          {!marketLoading && !marketError && marketQuery && marketResults.length === 0 && (
            <div className="text-center py-12 text-white/40">
              <p className="text-sm">未找到匹配的技能</p>
            </div>
          )}

          {/* Empty prompt */}
          {!marketQuery && (
            <div className="text-center py-16 text-white/40">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">输入关键词搜索 ClawHub 技能市场</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
