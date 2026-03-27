import { useState, useEffect, useMemo, useCallback } from 'react';
import { client } from '../../api/gateway';
import { X, Loader2, AlertCircle, Search, Puzzle } from 'lucide-react';

interface SkillEntry {
  name: string;
  description?: string;
  source?: string;
  emoji?: string;
}

interface AgentSkillsPanelProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

export function AgentSkillsPanel({ agentId, agentName, onClose }: AgentSkillsPanelProps) {
  // ── Installed skills state ────────────────────────────────────────────────
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState('');

  const [allowSet, setAllowSet] = useState<Set<string> | undefined>(undefined);
  const [originalAllowSet, setOriginalAllowSet] = useState<Set<string> | undefined>(undefined);
  const [configHash, setConfigHash] = useState('');
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  // ── Load skills and config ────────────────────────────────────────────────
  const reloadSkills = useCallback(() => {
    setSkillsLoading(true);
    setSkillsError('');
    client.skillsStatus({ agentId })
      .then(res => setSkills(res?.skills ?? []))
      .catch(err => setSkillsError(err.message || '加载技能失败'))
      .finally(() => setSkillsLoading(false));
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    reloadSkills();

    setConfigLoading(true);
    client.configGet()
      .then(res => {
        if (cancelled) return;
        setConfigHash(res?.hash ?? '');
        const list: any[] = res?.config?.agents?.list ?? [];
        const entry = list.find((e: any) => e?.id === agentId);
        const rawSkills = entry?.skills;
        if (Array.isArray(rawSkills)) {
          const s = new Set(rawSkills.map((s: string) => s.trim()).filter(Boolean));
          setAllowSet(s);
          setOriginalAllowSet(new Set(s));
        } else {
          setAllowSet(undefined);
          setOriginalAllowSet(undefined);
        }
      })
      .catch(() => { if (!cancelled) setConfigHash(''); })
      .finally(() => { if (!cancelled) setConfigLoading(false); });

    return () => { cancelled = true; };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Allowlist helpers ─────────────────────────────────────────────────────
  const usingAllowlist = allowSet !== undefined;
  const isEnabled = (name: string) => usingAllowlist ? allowSet!.has(name) : true;

  const toggle = (name: string, enabled: boolean) => {
    setSavedAt(null); setSaveError('');
    setAllowSet(prev => {
      const base = prev !== undefined ? new Set(prev) : new Set(skills.map(s => s.name));
      enabled ? base.add(name) : base.delete(name);
      return base;
    });
  };

  const enableAll = () => { setSavedAt(null); setSaveError(''); setAllowSet(undefined); };
  const disableAll = () => { setSavedAt(null); setSaveError(''); setAllowSet(new Set()); };

  const isDirty = useMemo(() => {
    if (allowSet === undefined && originalAllowSet === undefined) return false;
    if (allowSet === undefined || originalAllowSet === undefined) return true;
    if (allowSet.size !== originalAllowSet.size) return true;
    for (const name of allowSet) { if (!originalAllowSet.has(name)) return true; }
    return false;
  }, [allowSet, originalAllowSet]);

  const handleSave = async () => {
    if (!configHash) { setSaveError('配置 Hash 未加载，请刷新'); return; }
    setSaving(true); setSaveError('');
    try {
      const skillsValue = allowSet === undefined ? null : [...allowSet];
      await client.configPatchRaw({ agents: { list: [{ id: agentId, skills: skillsValue }] } }, configHash);
      const res = await client.configGet();
      setConfigHash(res?.hash ?? configHash);
      setOriginalAllowSet(allowSet === undefined ? undefined : new Set(allowSet));
      setSavedAt(Date.now());
    } catch (err: any) {
      setSaveError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(s =>
      [s.name, s.description ?? '', s.source ?? ''].join(' ').toLowerCase().includes(q)
    );
  }, [skills, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, SkillEntry[]>();
    for (const skill of filtered) {
      const src = skill.source ?? 'other';
      if (!map.has(src)) map.set(src, []);
      map.get(src)!.push(skill);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const enabledCount = usingAllowlist
    ? skills.filter(s => allowSet!.has(s.name)).length
    : skills.length;

  const sourceLabel: Record<string, string> = {
    workspace: '工作区', 'built-in': '内置', installed: '已安装', extra: '扩展',
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/8 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <Puzzle className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-white text-sm">{agentName}</span>
            <span className="text-white/40 text-xs ml-2">技能配置</span>
            {!skillsLoading && !skillsError && (
              <span className="text-white/40 text-xs ml-2">{enabledCount}/{skills.length} 已启用</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-white/8 bg-white/5 shrink-0 flex-wrap">
          <div className="relative flex-1 min-w-32">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-white/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-white/50 bg-white/15 text-white placeholder:text-white/40 backdrop-blur-sm"
              placeholder="搜索技能…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
          <button onClick={enableAll} disabled={configLoading || !usingAllowlist}
            className="px-3 py-1.5 text-xs text-white/70 bg-white/8 backdrop-blur-xl border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-40">
            启用全部
          </button>
          <button onClick={disableAll} disabled={configLoading}
            className="px-3 py-1.5 text-xs text-white/70 bg-white/8 backdrop-blur-xl border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-40">
            禁用全部
          </button>
          <div className="flex items-center gap-2 ml-auto">
            {saveError && (
              <span className="flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="w-3 h-3" />{saveError}
              </span>
            )}
            {savedAt && !isDirty && <span className="text-xs text-emerald-600">已保存</span>}
            <button onClick={handleSave} disabled={saving || configLoading || !isDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50">
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        {/* Status banner */}
        {!configLoading && (
          <div className={`px-5 py-2 text-xs shrink-0 border-b border-white/10 ${usingAllowlist ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
            {usingAllowlist
              ? '该代理使用自定义技能白名单，仅白名单内的技能可用。'
              : '全部技能已启用。禁用任意技能将创建自定义白名单。'}
          </div>
        )}

        {/* Skills list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {skillsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-white/40" />
            </div>
          ) : skillsError ? (
            <div className="flex items-center gap-2 p-3 bg-red-500/15 border border-red-400/25 rounded-lg text-sm text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />{skillsError}
            </div>
          ) : skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <Puzzle className="w-10 h-10 text-slate-200" />
              <p className="text-sm text-white/40">该代理暂无可用技能</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-white/40 text-center py-8">无匹配技能</p>
          ) : (
            <div className="space-y-4">
              {grouped.map(([src, srcSkills]) => (
                <div key={src}>
                  <div className="text-[11px] font-medium text-white/40 uppercase tracking-wide mb-1.5">
                    {sourceLabel[src] ?? src} <span className="font-normal normal-case">({srcSkills.length})</span>
                  </div>
                  <div className="space-y-1">
                    {srcSkills.map(skill => {
                      const enabled = isEnabled(skill.name);
                      return (
                        <label key={skill.name}
                          className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-white/8 hover:bg-white/5 cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={configLoading || saving}
                            onChange={e => toggle(skill.name, e.target.checked)}
                            className="mt-0.5 w-3.5 h-3.5 accent-indigo-600 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-white/80 font-mono truncate">
                              {skill.emoji ? `${skill.emoji} ` : ''}{skill.name}
                            </div>
                            {skill.description && (
                              <div className="text-[11px] text-white/40 mt-0.5 line-clamp-2">{skill.description}</div>
                            )}
                          </div>
                          <span className={`text-[10px] shrink-0 mt-0.5 ${enabled ? 'text-emerald-500' : 'text-white/30'}`}>
                            {enabled ? '启用' : '禁用'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-white/8 bg-white/5 shrink-0">
          <p className="text-xs text-white/40">技能开关直接写入代理配置。修改后点击保存生效。</p>
        </div>
      </div>
    </div>
  );
}
