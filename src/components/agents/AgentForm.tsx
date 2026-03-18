import { useState } from 'react';
import { client } from '../../api/gateway';
import { X, AlertCircle, Loader2 } from 'lucide-react';

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

export function AgentForm({ agent, onSuccess, onCancel }: AgentFormProps) {
  const isEditing = !!agent;
  const [form, setForm] = useState({
    id: agent?.id || '',
    name: agent?.config?.name || '',
    workspace: agent?.config?.workspace || '',
    model: agent?.config?.model || 'kimi-coding/k2p5',
    description: agent?.config?.description || '',
    enabled: agent?.config?.enabled ?? true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.id.trim()) { setError('Agent ID is required'); return; }
    if (!form.workspace.trim()) { setError('Workspace path is required'); return; }

    setLoading(true);
    try {
      const cfg: Record<string, any> = {
        id: form.id,
        name: form.name || form.id,
        workspace: form.workspace,
        subagents: { allowAgents: ['*'] },
        tools: { profile: 'full' },
      };
      if (form.model) cfg.model = form.model;
      // config.patch merges partial config using mergeObjectArraysById (matches by `id`)
      // and writes + restarts in one step. baseHash is required for optimistic concurrency.
      const currentCfg = await client.configGet();
      const baseHash = currentCfg?.hash;
      if (!baseHash) throw new Error('Could not get config hash');
      await client.configPatchRaw({ agents: { list: [cfg] } }, baseHash);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save agent');
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
            {isEditing ? 'Edit Agent' : 'Create Agent'}
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
            <Field label="Agent ID" required hint="Cannot change after creation">
              <input
                className={inputCls}
                value={form.id}
                onChange={e => set('id', e.target.value)}
                disabled={isEditing}
                placeholder="e.g. my-agent"
              />
            </Field>
            <Field label="Display Name">
              <input
                className={inputCls}
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. My Agent"
              />
            </Field>
          </div>

          <Field label="Workspace Path" required>
            <input
              className={inputCls}
              value={form.workspace}
              onChange={e => set('workspace', e.target.value)}
              placeholder="~/.openclaw/workspace-custom"
            />
          </Field>

          <Field label="Model">
            <input
              className={inputCls}
              value={form.model}
              onChange={e => set('model', e.target.value)}
              placeholder="e.g. kimi-coding/k2p5"
            />
          </Field>

          <Field label="Description">
            <textarea
              className={`${inputCls} h-20 resize-none`}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Brief description of this agent's purpose…"
            />
          </Field>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <div
              onClick={() => set('enabled', !form.enabled)}
              className={`relative w-9 h-5 rounded-full transition-colors ${form.enabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.enabled ? 'translate-x-4' : ''}`} />
            </div>
            <span className="text-sm text-slate-700">Enabled</span>
          </label>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-60"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
