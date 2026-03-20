import { useState, useEffect, useCallback } from 'react';
import { client } from '../api/gateway';
import { useAppStore } from '../stores/useAppStore';
import { ModelSelect } from '../components/shared/ModelSelect';
import {
  Terminal, Webhook, Puzzle, Plus, Trash2, Pencil, X,
  Loader2, AlertCircle, Save, RefreshCw, ChevronDown, ChevronRight,
  HelpCircle, BookOpen,
} from 'lucide-react';

// ─── shared helpers ───────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 text-sm border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:bg-white/5 disabled:text-white/40';
const labelCls = 'block text-xs font-medium text-white/70 mb-1';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-white/40 mt-1">{hint}</p>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/8 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8 bg-white/5">
        <h3 className="text-sm font-semibold text-white/80">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1">{msg}</span>
      {onDismiss && <button onClick={onDismiss} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
}

async function loadConfig() {
  return client.configGet();
}

// ─── HELP PANEL ───────────────────────────────────────────────────────────────

type HelpTabId = 'commands' | 'hooks' | 'plugins';

const HELP_CONTENT: Record<HelpTabId, React.ReactNode> = {
  commands: (
    <div className="space-y-5 text-sm text-white/80">
      <div>
        <h4 className="font-semibold text-white mb-1">命令是什么？</h4>
        <p className="text-white/50 leading-relaxed">
          命令（Webhook 映射）让外部系统可以通过 HTTP 请求触发 Agent 执行任务。
          比如：GitHub 有代码推送时自动通知 Agent、定时任务系统调用 Agent 处理数据等。
        </p>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">两种动作类型</h4>
        <div className="space-y-2">
          <div className="flex gap-2.5 p-3 bg-indigo-50 rounded-lg">
            <span className="text-indigo-600 font-mono text-xs bg-indigo-100 px-2 py-0.5 rounded h-fit shrink-0">agent</span>
            <p className="text-white/70 text-xs leading-relaxed">
              触发 Agent 执行任务，Agent 处理完后可把结果推送到频道（WhatsApp、Slack 等）。
              <br /><span className="text-white/40">适合需要 AI 处理后回复的场景。</span>
            </p>
          </div>
          <div className="flex gap-2.5 p-3 bg-amber-50 rounded-lg">
            <span className="text-amber-700 font-mono text-xs bg-amber-100 px-2 py-0.5 rounded h-fit shrink-0">wake</span>
            <p className="text-white/70 text-xs leading-relaxed">
              只唤醒 Agent，往主会话加一条系统通知，不开独立任务。
              <br /><span className="text-white/40">适合轻量提醒、不需要 AI 回复的场景。</span>
            </p>
          </div>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">消息模板变量</h4>
        <p className="text-white/50 text-xs mb-2">模板里用 <code className="bg-white/10 px-1 rounded">{'{{变量}}'}</code> 取请求体里的数据：</p>
        <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono space-y-1">
          <p className="text-white/40">{'// 请求体: {"from":"alice","subject":"你好"}'}</p>
          <p className="text-emerald-400">{'发件人：{{from}}'}</p>
          <p className="text-emerald-400">{'主题：{{subject}}'}</p>
          <p className="text-white/50 mt-2">{'// 数组取值'}</p>
          <p className="text-emerald-400">{'第一封邮件：{{messages[0].subject}}'}</p>
          <p className="text-white/50 mt-2">{'// 其他内置变量'}</p>
          <p className="text-blue-400">{'{{path}}   // 匹配的路径'}</p>
          <p className="text-blue-400">{'{{now}}    // 当前时间'}</p>
          <p className="text-blue-400">{'{{headers.x-event-type}}  // 请求头'}</p>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">完整示例</h4>
        <p className="text-xs text-white/40 mb-2">GitHub 推送时通知 Agent，结果发到 Slack：</p>
        <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono space-y-0.5">
          <p className="text-white/40">{'{'}</p>
          <p className="text-blue-300 pl-4">{'id: "github-push",'}</p>
          <p className="text-blue-300 pl-4">{'name: "GitHub 推送",'}</p>
          <p className="text-yellow-300 pl-4">{'match: { path: "github" },'}</p>
          <p className="text-green-300 pl-4">{'action: "agent",'}</p>
          <p className="text-green-300 pl-4">{'agentId: "devops",'}</p>
          <p className="text-emerald-300 pl-4">{'messageTemplate: "仓库 {{repository}} 有新推送",'}</p>
          <p className="text-purple-300 pl-4">{'deliver: true,'}</p>
          <p className="text-purple-300 pl-4">{'channel: "slack",'}</p>
          <p className="text-white/40">{'}'}</p>
        </div>
        <p className="text-xs text-white/40 mt-2">对应的 curl 调用：</p>
        <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono">
          <p className="text-emerald-300">{'curl -X POST /hooks/github \\'}</p>
          <p className="text-white/40 pl-2">{"-H 'Authorization: Bearer SECRET' \\"}</p>
          <p className="text-white/40 pl-2">{"  -d '{\"repository\":\"my-app\"}'"}</p>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">会话 Key 有什么用？</h4>
        <div className="space-y-1.5 text-xs text-white/50 leading-relaxed">
          <p>• <span className="text-white/80">不填</span>：每次请求都开一个新的独立会话</p>
          <p>• <span className="text-white/80">固定值</span>，如 <code className="bg-white/10 px-1 rounded">hook:email</code>：所有请求共用同一会话（可多轮对话）</p>
          <p>• <span className="text-white/80">带模板</span>，如 <code className="bg-white/10 px-1 rounded">{'hook:email:{{messageId}}'}</code>：每封邮件独立会话，支持追溯</p>
        </div>
      </div>
    </div>
  ),

  hooks: (
    <div className="space-y-5 text-sm text-white/80">
      <div>
        <h4 className="font-semibold text-white mb-1">钩子是什么？</h4>
        <p className="text-white/50 leading-relaxed">
          钩子（内部事件钩子）让你在 Agent 运行的特定时刻自动执行自定义代码。
          比如：收到消息时自动预处理、Agent 启动时加载自定义数据、会话结束时清理资源。
        </p>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">可以监听的事件</h4>
        <div className="space-y-1">
          {[
            { event: 'message:received', desc: '收到新消息时触发（在 Agent 处理之前）' },
            { event: 'message:sent', desc: '消息发出后触发' },
            { event: 'message:transcribed', desc: '语音转文字完成后触发' },
            { event: 'message:preprocessed', desc: '消息预处理完成、即将路由时触发' },
            { event: 'command:new', desc: '收到新命令时触发' },
            { event: 'session:start', desc: '新会话开始时触发' },
            { event: 'session:end', desc: '会话结束时触发' },
            { event: 'agent:bootstrap', desc: 'Agent 启动/初始化时触发' },
            { event: 'gateway:startup', desc: '网关服务启动时触发（只执行一次）' },
          ].map(({ event, desc }) => (
            <div key={event} className="flex gap-2 text-xs">
              <code className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-mono shrink-0 h-fit">{event}</code>
              <span className="text-white/50 leading-relaxed">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">处理器模块怎么写？</h4>
        <p className="text-xs text-white/40 mb-2">在工作区创建一个 JS 文件，导出一个函数：</p>
        <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono space-y-0.5">
          <p className="text-white/40">{'// hooks/on-message.js'}</p>
          <p className="text-blue-300">{'export default async function(ctx) {'}</p>
          <p className="text-white/40 pl-4">{'// ctx 包含事件相关数据'}</p>
          <p className="text-emerald-300 pl-4">{'console.log("收到消息:", ctx.from, ctx.content);'}</p>
          <p className="text-blue-300">{'}'}</p>
        </div>
        <p className="text-xs text-white/40 mt-2">然后在处理器列表里配置：</p>
        <div className="space-y-1 text-xs mt-1">
          <p className="text-white/70">• <span className="font-medium">事件</span>：选择要监听的事件，如 <code className="bg-white/10 px-1 rounded">message:received</code></p>
          <p className="text-white/70">• <span className="font-medium">模块路径</span>：相对于工作区的路径，如 <code className="bg-white/10 px-1 rounded">hooks/on-message.js</code></p>
          <p className="text-white/70">• <span className="font-medium">导出名</span>：留空默认用 <code className="bg-white/10 px-1 rounded">default</code> 导出</p>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">全局设置说明</h4>
        <div className="space-y-1.5 text-xs text-white/50 leading-relaxed">
          <p>• <span className="text-white/80 font-medium">监听路径</span>：外部 Webhook 的根路径，默认 <code className="bg-white/10 px-1 rounded">/hooks</code></p>
          <p>• <span className="text-white/80 font-medium">认证 Token</span>：外部调用必须携带此 Token，防止未授权访问</p>
          <p>• <span className="text-white/80 font-medium">最大请求体</span>：限制外部请求的大小，防止超大数据攻击</p>
          <p>• <span className="text-white/80 font-medium">默认会话 Key</span>：外部 Hook 请求没有指定会话时使用的默认会话</p>
          <p>• <span className="text-white/80 font-medium">允许的 Agent ID</span>：限制外部请求只能路由到这些 Agent，留空表示不限制</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 leading-relaxed">
        ⚠️ <span className="font-medium">注意</span>：启用 Hooks 后必须设置认证 Token，否则任何人都可以触发你的 Agent。
      </div>
    </div>
  ),

  plugins: (
    <div className="space-y-5 text-sm text-white/80">
      <div>
        <h4 className="font-semibold text-white mb-1">插件是什么？</h4>
        <p className="text-white/50 leading-relaxed">
          插件给系统增加新能力，比如接入新的 AI 模型提供商、添加新的消息频道、扩展 Agent 的工具等。
          这里可以控制哪些插件启用、每个插件的权限和配置。
        </p>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">插件类型</h4>
        <div className="space-y-1.5 text-xs text-white/70">
          {[
            { name: '模型提供商', desc: '接入新的 AI 模型，如 OpenAI、Anthropic、Moonshot 等' },
            { name: '消息频道', desc: '支持新的聊天平台，如 Telegram、WhatsApp、Slack 等' },
            { name: '工具插件', desc: '给 Agent 增加新工具，如网页搜索、代码执行等' },
            { name: '语音插件', desc: '文字转语音、语音转文字（ElevenLabs、Azure 等）' },
            { name: 'Memory 插件', desc: '让 Agent 拥有跨会话的长期记忆' },
          ].map(({ name, desc }) => (
            <div key={name} className="flex gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
              <span><span className="font-medium text-white/80">{name}</span>：{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">允许/拒绝列表</h4>
        <div className="space-y-1.5 text-xs text-white/50 leading-relaxed">
          <p>• <span className="text-white/80 font-medium">允许列表</span>：只加载列表里的插件，留空表示加载全部</p>
          <p>• <span className="text-white/80 font-medium">拒绝列表</span>：屏蔽特定插件，即使它在允许列表里也不加载</p>
          <p className="text-white/40">两者同时设置时，先过滤允许列表，再排除拒绝列表。</p>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">插件权限配置</h4>
        <p className="text-xs text-white/40 mb-2">点击插件条目右侧的箭头展开详细配置：</p>
        <div className="space-y-2">
          <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 text-xs">
            <p className="font-medium text-white/80 mb-0.5">允许 Prompt 注入</p>
            <p className="text-white/50">允许插件修改发给 AI 的系统提示词。默认关闭，开启后插件可以加入自定义指令。</p>
          </div>
          <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 text-xs">
            <p className="font-medium text-white/80 mb-0.5">允许模型覆盖</p>
            <p className="text-white/50">允许插件在运行子任务时切换到其他 AI 模型。可以配合"允许的模型列表"限制范围。</p>
          </div>
          <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 text-xs">
            <p className="font-medium text-white/80 mb-0.5">插件配置（JSON）</p>
            <p className="text-white/50">插件特有的配置，比如 API 密钥、账号信息等。格式是 JSON，具体字段取决于插件。</p>
          </div>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">特殊插槽</h4>
        <div className="space-y-1.5 text-xs text-white/50 leading-relaxed">
          <p>• <span className="text-white/80 font-medium">Memory 插槽</span>：指定哪个插件负责管理 Agent 的长期记忆</p>
          <p>• <span className="text-white/80 font-medium">Context Engine 插槽</span>：指定哪个插件负责构建 Agent 的上下文信息</p>
          <p className="text-white/40">同一时间只能有一个插件占据每个插槽。</p>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-white mb-2">添加插件步骤</h4>
        <div className="space-y-1 text-xs text-white/50">
          <p className="flex gap-2"><span className="text-indigo-600 font-bold shrink-0">1.</span>在下方输入框输入插件 ID，点击"添加"</p>
          <p className="flex gap-2"><span className="text-indigo-600 font-bold shrink-0">2.</span>勾选"启用"开关</p>
          <p className="flex gap-2"><span className="text-indigo-600 font-bold shrink-0">3.</span>点击展开配置权限和参数（如需要）</p>
          <p className="flex gap-2"><span className="text-indigo-600 font-bold shrink-0">4.</span>点击页面底部"保存"按钮</p>
          <p className="flex gap-2"><span className="text-indigo-600 font-bold shrink-0">5.</span>重启 Gateway 服务使插件生效</p>
        </div>
      </div>
    </div>
  ),
};

function HelpPanel({ activeTab, onClose }: { activeTab: HelpTabId; onClose: () => void }) {
  const [tab, setTab] = useState<HelpTabId>(activeTab);

  // Sync tab when parent tab changes
  useState(() => { setTab(activeTab); });

  const tabLabels: Record<HelpTabId, { label: string; icon: React.ElementType }> = {
    commands: { label: '命令', icon: Terminal },
    hooks:    { label: '钩子', icon: Webhook },
    plugins:  { label: '插件', icon: Puzzle },
  };

  return (
    <div className="w-[360px] shrink-0 border-l border-white/10 bg-slate-900/80 backdrop-blur-2xl sticky top-0 h-screen overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/8 shrink-0 bg-slate-900/90 sticky top-0 z-10">
        <BookOpen className="w-4 h-4 text-indigo-500 shrink-0" />
        <span className="font-semibold text-white text-sm">使用说明</span>
        <button
          onClick={onClose}
          className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white/70 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-2 shrink-0 border-b border-white/8 bg-slate-900/90">
        {(Object.keys(tabLabels) as HelpTabId[]).map(t => {
          const { label, icon: Icon } = tabLabels[t];
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                active ? 'bg-indigo-600 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-4">
        {HELP_CONTENT[tab]}
      </div>
    </div>
  );
}

// ─── COMMANDS TAB (hooks.mappings) ────────────────────────────────────────────

const ACTIONS = ['wake', 'agent'] as const;
const WAKE_MODES = ['now', 'next-heartbeat'] as const;
const CHANNELS = ['last', 'whatsapp', 'telegram', 'discord', 'slack', 'signal', 'imessage', 'googlechat', 'msteams', 'irc'] as const;
const THINKING = ['', 'off', 'minimal', 'low', 'medium', 'high'] as const;

interface Mapping {
  id: string;
  name?: string;
  match?: { path?: string; source?: string };
  action?: 'wake' | 'agent';
  wakeMode?: 'now' | 'next-heartbeat';
  agentId?: string;
  sessionKey?: string;
  messageTemplate?: string;
  deliver?: boolean;
  channel?: string;
  to?: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
}

function newMapping(): Mapping {
  return { id: `cmd-${Date.now()}`, action: 'agent', wakeMode: 'now' };
}

function MappingForm({ mapping, onSave, onCancel }: {
  mapping: Mapping;
  onSave: (m: Mapping) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Mapping>({ ...mapping });
  const set = (k: keyof Mapping, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setMatch = (k: 'path' | 'source', v: string) =>
    setForm(f => ({ ...f, match: { ...f.match, [k]: v || undefined } }));

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900/80 backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
          <h3 className="text-sm font-semibold text-white">
            {mapping.name ? '编辑命令' : '新建命令'}
          </h3>
          <button onClick={onCancel} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID" hint="唯一标识符">
              <input className={inputCls} value={form.id} onChange={e => set('id', e.target.value)} placeholder="cmd-xxx" />
            </Field>
            <Field label="名称">
              <input className={inputCls} value={form.name ?? ''} onChange={e => set('name', e.target.value || undefined)} placeholder="我的命令" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="匹配路径" hint="URL 路径，如 /my-cmd">
              <input className={inputCls} value={form.match?.path ?? ''} onChange={e => setMatch('path', e.target.value)} placeholder="/my-command" />
            </Field>
            <Field label="匹配来源">
              <input className={inputCls} value={form.match?.source ?? ''} onChange={e => setMatch('source', e.target.value)} placeholder="可选" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="动作">
              <select className={inputCls} value={form.action ?? 'agent'} onChange={e => set('action', e.target.value)}>
                {ACTIONS.map(a => <option key={a} value={a}>{a === 'agent' ? 'agent（触发 Agent）' : 'wake（唤醒）'}</option>)}
              </select>
            </Field>
            <Field label="唤醒模式">
              <select className={inputCls} value={form.wakeMode ?? 'now'} onChange={e => set('wakeMode', e.target.value)}>
                {WAKE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent ID">
              <input className={inputCls} value={form.agentId ?? ''} onChange={e => set('agentId', e.target.value || undefined)} placeholder="默认 Agent" />
            </Field>
            <Field label="会话 Key">
              <input className={inputCls} value={form.sessionKey ?? ''} onChange={e => set('sessionKey', e.target.value || undefined)} placeholder="可选" />
            </Field>
          </div>

          <Field label="消息模板" hint="发送给 Agent 的消息，可用 {{body}}、{{from}} 等变量">
            <textarea
              className={`${inputCls} resize-y min-h-[64px]`}
              value={form.messageTemplate ?? ''}
              onChange={e => set('messageTemplate', e.target.value || undefined)}
              placeholder="收到消息：{{body}}"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="模型">
              <ModelSelect value={form.model ?? ''} onChange={v => set('model', v || undefined)} placeholder="provider/model" />
            </Field>
            <Field label="Thinking">
              <select className={inputCls} value={form.thinking ?? ''} onChange={e => set('thinking', e.target.value || undefined)}>
                {THINKING.map(t => <option key={t} value={t}>{t || '默认'}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="超时（秒）">
              <input
                type="number" className={inputCls}
                value={form.timeoutSeconds ?? ''}
                onChange={e => set('timeoutSeconds', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="默认"
              />
            </Field>
            <Field label="投递频道">
              <select className={inputCls} value={form.channel ?? ''} onChange={e => set('channel', e.target.value || undefined)}>
                <option value="">不投递</option>
                {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
            <input type="checkbox" checked={!!form.deliver} onChange={e => set('deliver', e.target.checked || undefined)}
              className="w-4 h-4 accent-indigo-600" />
            投递结果到频道
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/8 shrink-0">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-white/70 bg-white/10 hover:bg-white/15 rounded-lg transition-colors">取消</button>
          <button onClick={() => onSave(form)} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">保存</button>
        </div>
      </div>
    </div>
  );
}

function CommandsTab() {
  const { connectionStatus } = useAppStore();
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [configHash, setConfigHash] = useState('');
  const [editingMapping, setEditingMapping] = useState<Mapping | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await loadConfig();
      setConfigHash(res?.hash ?? '');
      setMappings(res?.config?.hooks?.mappings ?? []);
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (connectionStatus === 'connected') load(); }, [connectionStatus]);

  const save = async (newMappings: Mapping[]) => {
    setSaving(true); setError('');
    try {
      const res = await loadConfig();
      await client.configPatchRaw({ hooks: { mappings: newMappings } }, res.hash);
      setConfigHash(res.hash);
      setMappings(newMappings);
    } catch (e: any) { setError(e.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const handleSaveMapping = (m: Mapping) => {
    const idx = mappings.findIndex(x => x.id === m.id);
    const next = idx >= 0 ? mappings.map((x, i) => i === idx ? m : x) : [...mappings, m];
    setShowForm(false); setEditingMapping(null);
    save(next);
  };

  const handleDelete = (id: string) => {
    if (!confirm('确认删除此命令映射？')) return;
    save(mappings.filter(m => m.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/50">Webhook 命令映射 — 外部 HTTP 请求触发 Agent</p>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 border border-white/10 bg-white/8 backdrop-blur-xl rounded-lg hover:bg-white/5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <button onClick={() => { setEditingMapping(newMapping()); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg">
            <Plus className="w-3.5 h-3.5" /> 新建映射
          </button>
        </div>
      </div>

      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
      ) : mappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2 text-white/40">
          <Webhook className="w-10 h-10 opacity-30" />
          <p className="text-sm">暂无命令映射</p>
          <button onClick={() => { setEditingMapping(newMapping()); setShowForm(true); }} className="text-xs text-indigo-600 hover:text-indigo-500">+ 创建第一个</button>
        </div>
      ) : (
        <div className="space-y-2">
          {mappings.map(m => (
            <div key={m.id} className="bg-white/8 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-3 flex items-start gap-3 hover:border-indigo-200 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">{m.name || m.id}</span>
                  <span className="text-xs font-mono text-white/40 bg-white/10 px-1.5 py-0.5 rounded">{m.id}</span>
                  {m.action && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${m.action === 'agent' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-700'}`}>{m.action}</span>}
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {m.match?.path && <span className="text-xs text-white/50 font-mono">{m.match.path}</span>}
                  {m.agentId && <span className="text-xs text-white/40">→ {m.agentId}</span>}
                  {m.model && <span className="text-xs text-white/40 font-mono">{m.model}</span>}
                </div>
                {m.messageTemplate && (
                  <p className="text-xs text-white/40 mt-1 truncate">{m.messageTemplate}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditingMapping(m); setShowForm(true); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-600 hover:bg-indigo-50">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(m.id)} disabled={saving} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-red-500 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && editingMapping && (
        <MappingForm
          mapping={editingMapping}
          onSave={handleSaveMapping}
          onCancel={() => { setShowForm(false); setEditingMapping(null); }}
        />
      )}
    </div>
  );
}

// ─── HOOKS TAB (hooks global config + internal handlers) ──────────────────────

interface InternalHandler {
  event: string;
  module: string;
  export?: string;
}

const HOOK_EVENTS = [
  'command:new', 'command:run', 'command:reset',
  'message:received', 'message:sent', 'message:transcribed', 'message:preprocessed',
  'session:start', 'session:end', 'agent:bootstrap', 'gateway:startup',
];

function HandlerForm({ handler, onSave, onCancel }: {
  handler: InternalHandler; onSave: (h: InternalHandler) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState<InternalHandler>({ ...handler });
  const set = (k: keyof InternalHandler, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900/80 backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <h3 className="text-sm font-semibold text-white">内部钩子处理器</h3>
          <button onClick={onCancel} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/10"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <Field label="事件" hint="监听的事件类型">
            <input list="hook-events" className={inputCls} value={form.event} onChange={e => set('event', e.target.value)} placeholder="message:received" />
            <datalist id="hook-events">{HOOK_EVENTS.map(e => <option key={e} value={e} />)}</datalist>
          </Field>
          <Field label="模块路径" hint="工作区相对路径，如 hooks/my-handler.js">
            <input className={inputCls} value={form.module} onChange={e => set('module', e.target.value)} placeholder="hooks/my-handler.js" />
          </Field>
          <Field label="导出名" hint="默认为 default">
            <input className={inputCls} value={form.export ?? ''} onChange={e => set('export', e.target.value || '')} placeholder="default" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/8">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-white/70 bg-white/10 hover:bg-white/15 rounded-lg">取消</button>
          <button
            onClick={() => onSave({ ...form, export: form.export || undefined })}
            disabled={!form.event || !form.module}
            className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function HooksTab() {
  const { connectionStatus } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // global hooks config
  const [enabled, setEnabled] = useState(true);
  const [path, setPath] = useState('/hooks');
  const [token, setToken] = useState('');
  const [maxBodyBytes, setMaxBodyBytes] = useState('');
  const [defaultSessionKey, setDefaultSessionKey] = useState('');
  const [allowedAgentIds, setAllowedAgentIds] = useState('');

  // internal handlers
  const [internalEnabled, setInternalEnabled] = useState(true);
  const [handlers, setHandlers] = useState<InternalHandler[]>([]);
  const [editingHandler, setEditingHandler] = useState<InternalHandler | null>(null);
  const [editingHandlerIdx, setEditingHandlerIdx] = useState<number | null>(null);
  const [showHandlerForm, setShowHandlerForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await loadConfig();
      const h = res?.config?.hooks ?? {};
      setEnabled(h.enabled !== false);
      setPath(h.path ?? '/hooks');
      setToken(h.token ?? '');
      setMaxBodyBytes(h.maxBodyBytes ? String(h.maxBodyBytes) : '');
      setDefaultSessionKey(h.defaultSessionKey ?? '');
      setAllowedAgentIds(Array.isArray(h.allowedAgentIds) ? h.allowedAgentIds.join(', ') : '');
      const internal = h.internal ?? {};
      setInternalEnabled(internal.enabled !== false);
      setHandlers(internal.handlers ?? []);
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (connectionStatus === 'connected') load(); }, [connectionStatus]);

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const res = await loadConfig();
      const patch = {
        hooks: {
          enabled,
          path: path || '/hooks',
          token: token || undefined,
          maxBodyBytes: maxBodyBytes ? Number(maxBodyBytes) : undefined,
          defaultSessionKey: defaultSessionKey || undefined,
          allowedAgentIds: allowedAgentIds
            ? allowedAgentIds.split(',').map(s => s.trim()).filter(Boolean)
            : undefined,
          internal: {
            enabled: internalEnabled,
            handlers,
          },
        },
      };
      await client.configPatchRaw(patch, res.hash);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { setError(e.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const handleSaveHandler = (h: InternalHandler) => {
    setHandlers(prev => {
      if (editingHandlerIdx !== null) return prev.map((x, i) => i === editingHandlerIdx ? h : x);
      return [...prev, h];
    });
    setShowHandlerForm(false); setEditingHandler(null); setEditingHandlerIdx(null);
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
      ) : (
        <>
          <SectionCard title="全局设置">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                启用 Hooks 系统
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="监听路径" hint="Webhook 根路径">
                  <input className={inputCls} value={path} onChange={e => setPath(e.target.value)} placeholder="/hooks" />
                </Field>
                <Field label="认证 Token" hint="Bearer token 鉴权">
                  <input type="password" className={inputCls} value={token} onChange={e => setToken(e.target.value)} placeholder="留空则不鉴权" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="最大请求体（字节）">
                  <input type="number" className={inputCls} value={maxBodyBytes} onChange={e => setMaxBodyBytes(e.target.value)} placeholder="默认" />
                </Field>
                <Field label="默认会话 Key">
                  <input className={inputCls} value={defaultSessionKey} onChange={e => setDefaultSessionKey(e.target.value)} placeholder="hook:main" />
                </Field>
              </div>
              <Field label="允许的 Agent ID" hint="逗号分隔，留空表示允许所有">
                <input className={inputCls} value={allowedAgentIds} onChange={e => setAllowedAgentIds(e.target.value)} placeholder="agent1, agent2 或留空" />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="内部事件钩子">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                <input type="checkbox" checked={internalEnabled} onChange={e => setInternalEnabled(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                启用内部事件钩子
              </label>

              <div className="space-y-2">
                {handlers.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 bg-white/5 border border-white/10 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{h.event}</span>
                        <span className="text-xs text-white/50 font-mono truncate">{h.module}</span>
                      </div>
                      {h.export && <span className="text-[11px] text-white/40">导出: {h.export}</span>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { setEditingHandler(h); setEditingHandlerIdx(i); setShowHandlerForm(true); }}
                        className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-indigo-600 hover:bg-indigo-50">
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button onClick={() => setHandlers(prev => prev.filter((_, idx) => idx !== i))}
                        className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-red-500 hover:bg-red-50">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => { setEditingHandler({ event: '', module: '' }); setEditingHandlerIdx(null); setShowHandlerForm(true); }}
                  className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-500"
                >
                  <Plus className="w-3.5 h-3.5" /> 添加处理器
                </button>
              </div>
            </div>
          </SectionCard>

          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-xs text-emerald-600">已保存</span>}
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </>
      )}

      {showHandlerForm && editingHandler && (
        <HandlerForm
          handler={editingHandler}
          onSave={handleSaveHandler}
          onCancel={() => { setShowHandlerForm(false); setEditingHandler(null); setEditingHandlerIdx(null); }}
        />
      )}
    </div>
  );
}

// ─── PLUGINS TAB ──────────────────────────────────────────────────────────────

interface PluginEntry {
  id: string;
  enabled?: boolean;
  allowPromptInjection?: boolean;
  allowModelOverride?: boolean;
  allowedModels?: string;
  config?: string; // JSON string
}

function PluginEntryRow({ entry, onChange, onRemove }: {
  entry: PluginEntry;
  onChange: (e: PluginEntry) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const set = (k: keyof PluginEntry, v: any) => onChange({ ...entry, [k]: v });

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-white/5 hover:bg-white/10">
        <button onClick={() => setExpanded(v => !v)} className="text-white/40 hover:text-white/70">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
          <input type="checkbox" checked={entry.enabled !== false} onChange={e => set('enabled', e.target.checked)}
            className="w-4 h-4 accent-indigo-600 shrink-0" />
          <span className="text-sm font-mono text-white/80 truncate">{entry.id}</span>
        </label>
        <button onClick={onRemove} className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-red-500 hover:bg-red-50 shrink-0">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      {expanded && (
        <div className="px-4 py-3 border-t border-white/8 bg-white/5 space-y-3">
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
              <input type="checkbox" checked={!!entry.allowPromptInjection} onChange={e => set('allowPromptInjection', e.target.checked)}
                className="w-3.5 h-3.5 accent-indigo-600" />
              允许 Prompt 注入
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
              <input type="checkbox" checked={!!entry.allowModelOverride} onChange={e => set('allowModelOverride', e.target.checked)}
                className="w-3.5 h-3.5 accent-indigo-600" />
              允许模型覆盖
            </label>
          </div>
          {entry.allowModelOverride && (
            <Field label="允许覆盖的模型" hint="逗号分隔，* 表示所有">
              <input className={inputCls} value={entry.allowedModels ?? ''} onChange={e => set('allowedModels', e.target.value)}
                placeholder="provider/model, * " />
            </Field>
          )}
          <Field label="插件配置（JSON）">
            <textarea className={`${inputCls} font-mono text-xs resize-y min-h-[64px]`}
              value={entry.config ?? ''}
              onChange={e => set('config', e.target.value)}
              placeholder="{}" />
          </Field>
        </div>
      )}
    </div>
  );
}

function PluginsTab() {
  const { connectionStatus } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [allow, setAllow] = useState('');
  const [deny, setDeny] = useState('');
  const [loadPaths, setLoadPaths] = useState('');
  const [memorySlot, setMemorySlot] = useState('');
  const [contextEngineSlot, setContextEngineSlot] = useState('');
  const [entries, setEntries] = useState<PluginEntry[]>([]);
  const [newPluginId, setNewPluginId] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await loadConfig();
      const p = res?.config?.plugins ?? {};
      setEnabled(p.enabled !== false);
      setAllow(Array.isArray(p.allow) ? p.allow.join(', ') : '');
      setDeny(Array.isArray(p.deny) ? p.deny.join(', ') : '');
      setLoadPaths(Array.isArray(p.load?.paths) ? p.load.paths.join('\n') : '');
      setMemorySlot(p.slots?.memory ?? '');
      setContextEngineSlot(p.slots?.contextEngine ?? '');
      const rawEntries = p.entries ?? {};
      setEntries(Object.entries(rawEntries).map(([id, cfg]: [string, any]) => ({
        id,
        enabled: cfg.enabled,
        allowPromptInjection: cfg.hooks?.allowPromptInjection,
        allowModelOverride: cfg.subagent?.allowModelOverride,
        allowedModels: Array.isArray(cfg.subagent?.allowedModels)
          ? cfg.subagent.allowedModels.join(', ')
          : (cfg.subagent?.allowedModels ?? ''),
        config: cfg.config ? JSON.stringify(cfg.config, null, 2) : '',
      })));
    } catch (e: any) { setError(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (connectionStatus === 'connected') load(); }, [connectionStatus]);

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const res = await loadConfig();
      const entriesObj: Record<string, any> = {};
      for (const e of entries) {
        let cfg: any = {};
        try { cfg = e.config ? JSON.parse(e.config) : {}; } catch { /* ignore */ }
        entriesObj[e.id] = {
          enabled: e.enabled,
          hooks: e.allowPromptInjection ? { allowPromptInjection: true } : undefined,
          subagent: (e.allowModelOverride || e.allowedModels)
            ? {
                allowModelOverride: e.allowModelOverride || undefined,
                allowedModels: e.allowedModels
                  ? e.allowedModels.split(',').map((s: string) => s.trim()).filter(Boolean)
                  : undefined,
              }
            : undefined,
          config: Object.keys(cfg).length ? cfg : undefined,
        };
      }
      const paths = loadPaths.split('\n').map(s => s.trim()).filter(Boolean);
      await client.configPatchRaw({
        plugins: {
          enabled,
          allow: allow ? allow.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          deny: deny ? deny.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          load: paths.length ? { paths } : undefined,
          slots: {
            memory: memorySlot || undefined,
            contextEngine: contextEngineSlot || undefined,
          },
          entries: entriesObj,
        },
      }, res.hash);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { setError(e.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const addEntry = () => {
    const id = newPluginId.trim();
    if (!id || entries.find(e => e.id === id)) return;
    setEntries(prev => [...prev, { id, enabled: true }]);
    setNewPluginId('');
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
      ) : (
        <>
          <SectionCard title="全局设置">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                启用插件系统
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="允许列表" hint="插件 ID，逗号分隔，留空不限">
                  <input className={inputCls} value={allow} onChange={e => setAllow(e.target.value)} placeholder="plugin-id1, plugin-id2" />
                </Field>
                <Field label="拒绝列表" hint="插件 ID，逗号分隔">
                  <input className={inputCls} value={deny} onChange={e => setDeny(e.target.value)} placeholder="blocked-plugin" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Memory 插槽" hint="负责 Memory 的插件 ID">
                  <input className={inputCls} value={memorySlot} onChange={e => setMemorySlot(e.target.value)} placeholder="插件 ID" />
                </Field>
                <Field label="Context Engine 插槽">
                  <input className={inputCls} value={contextEngineSlot} onChange={e => setContextEngineSlot(e.target.value)} placeholder="插件 ID" />
                </Field>
              </div>
              <Field label="额外加载路径" hint="每行一个路径">
                <textarea className={`${inputCls} font-mono text-xs resize-y min-h-[56px]`}
                  value={loadPaths} onChange={e => setLoadPaths(e.target.value)} placeholder="/path/to/plugins" />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="插件配置">
            <div className="space-y-2">
              {entries.length === 0 && (
                <p className="text-sm text-white/40 text-center py-4">暂无插件配置项</p>
              )}
              {entries.map((e, i) => (
                <PluginEntryRow
                  key={e.id}
                  entry={e}
                  onChange={updated => setEntries(prev => prev.map((x, idx) => idx === i ? updated : x))}
                  onRemove={() => setEntries(prev => prev.filter((_, idx) => idx !== i))}
                />
              ))}
              <div className="flex items-center gap-2 pt-1">
                <input
                  className={`${inputCls} flex-1 text-xs`}
                  value={newPluginId}
                  onChange={e => setNewPluginId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addEntry()}
                  placeholder="输入插件 ID 后按 Enter 或点击添加"
                />
                <button onClick={addEntry} disabled={!newPluginId.trim()}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded-lg disabled:opacity-40">
                  <Plus className="w-3.5 h-3.5" /> 添加
                </button>
              </div>
            </div>
          </SectionCard>

          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-xs text-emerald-600">已保存</span>}
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'commands', label: '命令', icon: Terminal, desc: 'Webhook 命令映射' },
  { id: 'hooks',    label: '钩子', icon: Webhook,  desc: '内部事件钩子' },
  { id: 'plugins',  label: '插件', icon: Puzzle,   desc: '插件配置' },
] as const;

type TabId = typeof TABS[number]['id'];

export function AutomationPage() {
  const [tab, setTab] = useState<TabId>('commands');
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="flex items-start min-h-full">
      {/* Main content */}
      <div className="flex-1 min-w-0 p-6">
        <div className={showHelp ? 'max-w-3xl' : 'max-w-5xl'}>
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white">自动化</h2>
              <p className="text-white/50 text-sm mt-0.5">命令、钩子和插件设置</p>
            </div>
            <button
              onClick={() => setShowHelp(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
                showHelp
                  ? 'text-indigo-600 border-indigo-300 bg-indigo-50'
                  : 'text-white/50 border-white/10 bg-white hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50'
              }`}
              title="使用说明"
            >
              <HelpCircle className="w-4 h-4" />
              使用说明
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mb-5 bg-white/10 p-1 rounded-xl w-fit">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium transition-all ${
                    active ? 'bg-white text-white shadow-sm' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {tab === 'commands' && <CommandsTab />}
          {tab === 'hooks'    && <HooksTab />}
          {tab === 'plugins'  && <PluginsTab />}
        </div>
      </div>

      {/* Help panel — inline sidebar */}
      {showHelp && (
        <HelpPanel activeTab={tab as HelpTabId} onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}
