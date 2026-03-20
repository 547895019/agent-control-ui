import { useState } from 'react';
import { client } from '../../api/gateway';
import { X, AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { ModelSelect } from '../shared/ModelSelect';

interface AgentFormProps {
  agent?: { id: string; config: any };
  onSuccess: () => void;
  onCancel: () => void;
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition bg-white disabled:bg-slate-50 disabled:text-slate-500";

function parseModelCfg(m: any): { primary: string; fallbacks: string[] } {
  if (!m) return { primary: 'kimi-coding/k2p5', fallbacks: [] };
  if (typeof m === 'string') return { primary: m, fallbacks: [] };
  return { primary: m.primary || '', fallbacks: Array.isArray(m.fallbacks) ? [...m.fallbacks] : [] };
}

const TOOL_PROFILES = [
  { id: 'minimal',   label: '最小',   hint: '仅基础读写' },
  { id: 'coding',    label: '编程',   hint: '文件 + 执行' },
  { id: 'messaging', label: '消息',   hint: '消息收发' },
  { id: 'full',      label: '完整',   hint: '所有工具' },
] as const;

type ToolProfile = typeof TOOL_PROFILES[number]['id'];

export function AgentForm({ agent, onSuccess, onCancel }: AgentFormProps) {
  const isEditing = !!agent;
  const [form, setForm] = useState({
    id: agent?.id || '',
    name: agent?.config?.name || '',
    workspace: agent?.config?.workspace || '',
  });

  const initModel = parseModelCfg(agent?.config?.model);
  const [modelPrimary, setModelPrimary] = useState(initModel.primary);
  const [modelFallbacks, setModelFallbacks] = useState<string[]>(initModel.fallbacks);
  const [toolsProfile, setToolsProfile] = useState<ToolProfile>(
    (agent?.config?.tools?.profile as ToolProfile) ?? 'full'
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const addFallback = () => setModelFallbacks(f => [...f, '']);
  const removeFallback = (i: number) => setModelFallbacks(f => f.filter((_, idx) => idx !== i));
  const setFallback = (i: number, v: string) => setModelFallbacks(f => f.map((x, idx) => idx === i ? v : x));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.id.trim()) { setError('代理 ID 不能为空'); return; }
    if (!form.workspace.trim()) { setError('工作区路径不能为空'); return; }

    setLoading(true);
    try {
      const cfg: Record<string, any> = {
        id: form.id,
        name: form.name || form.id,
        workspace: form.workspace,
        subagents: { allowAgents: ['*'] },
        tools: { profile: toolsProfile },
      };
      const fallbacks = modelFallbacks.map(f => f.trim()).filter(Boolean);
      if (modelPrimary.trim()) {
        cfg.model = fallbacks.length > 0
          ? { primary: modelPrimary.trim(), fallbacks }
          : modelPrimary.trim();
      }
      // config.patch merges partial config using mergeObjectArraysById (matches by `id`)
      // and writes + restarts in one step. baseHash is required for optimistic concurrency.
      const currentCfg = await client.configGet();
      const baseHash = currentCfg?.hash;
      if (!baseHash) throw new Error('无法获取配置 Hash');
      await client.configPatchRaw({ agents: { list: [cfg] } }, baseHash);
      onSuccess();
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">
            {isEditing ? '编辑代理' : '新建代理'}
          </h2>
          <button onClick={onCancel} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="代理 ID" required hint="创建后不可修改">
              <input
                className={inputCls}
                value={form.id}
                onChange={e => set('id', e.target.value)}
                disabled={isEditing}
                placeholder="e.g. my-agent"
              />
            </Field>
            <Field label="显示名称">
              <input
                className={inputCls}
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. My Agent"
              />
            </Field>
          </div>

          <Field label="工作区路径" required>
            <input
              className={inputCls}
              value={form.workspace}
              onChange={e => set('workspace', e.target.value)}
              placeholder="~/.openclaw/workspace-custom"
            />
          </Field>

          <Field label="模型" hint="支持 provider/model 格式，可添加备用模型">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ModelSelect
                  value={modelPrimary}
                  onChange={setModelPrimary}
                  placeholder="e.g. kimi-coding/k2p5"
                  className="flex-1"
                />
              </div>
              {modelFallbacks.map((fb, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-16 shrink-0 text-right">备用 {i + 1}</span>
                  <ModelSelect
                    value={fb}
                    onChange={v => setFallback(i, v)}
                    placeholder="e.g. openai/gpt-4o"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeFallback(i)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addFallback}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加备用模型
              </button>
            </div>
          </Field>

          <Field label="工具权限" hint="控制代理可以使用哪些工具">
            <div className="flex gap-1.5 flex-wrap">
              {TOOL_PROFILES.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setToolsProfile(p.id)}
                  title={p.hint}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    toolsProfile === p.id
                      ? 'bg-indigo-600 text-white border-indigo-600 font-medium'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:text-indigo-600'
                  }`}
                >
                  {p.label}
                  <span className={`ml-1 ${toolsProfile === p.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                    · {p.hint}
                  </span>
                </button>
              ))}
            </div>
          </Field>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-60"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? '保存中…' : isEditing ? '保存' : '创建代理'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
