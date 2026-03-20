import { useState, useEffect, useRef } from 'react';
import { client } from '../../api/gateway';
import {
  X, Send, Square, Loader2, AlertCircle,
  Bot, User, Wrench, ChevronDown, ChevronRight,
  MessageSquare, Plus, Hash, Paperclip,
} from 'lucide-react';

// ── types ─────────────────────────────────────────────────────────────────────

interface SessionMeta {
  key: string;
  title?: string;
  derivedTitle?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
}

interface ChatAttachment {
  id: string;
  dataUrl: string;   // full data URL for preview
  mimeType: string;
}

type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; args: string }
  | { kind: 'image'; dataUrl: string };

// ── helpers ───────────────────────────────────────────────────────────────────

/** Strip data URL prefix, return { mimeType, content } */
function dataUrlToBase64(dataUrl: string): { mimeType: string; content: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mimeType: m[1], content: m[2] } : null;
}

function extractContent(content: any): ContentBlock[] {
  if (typeof content === 'string') return content ? [{ kind: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [{ kind: 'text', text: JSON.stringify(content) }];
  return content.flatMap((block: any): ContentBlock[] => {
    if (block.type === 'text') return [{ kind: 'text', text: block.text ?? '' }];
    if (block.type === 'thinking') return [{ kind: 'thinking', text: block.thinking ?? '' }];
    if (block.type === 'toolCall') {
      const args = block.arguments ? JSON.stringify(block.arguments, null, 2) : '';
      return [{ kind: 'tool', name: block.name ?? 'tool', args }];
    }
    if (block.type === 'image') {
      // source.data may already be a full data URL or raw base64
      const src = block.source ?? block;
      const data: string = src.data ?? src.url ?? '';
      const mime: string = src.media_type ?? src.mimeType ?? 'image/*';
      const dataUrl = data.startsWith('data:') ? data : `data:${mime};base64,${data}`;
      return [{ kind: 'image', dataUrl }];
    }
    return [];
  });
}


function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function parseHistory(res: any): { role: 'user' | 'assistant'; content: any }[] {
  // Official API returns { messages: [...] } where each item is { role, content, timestamp, ... }
  const raw: any[] = Array.isArray(res?.messages) ? res.messages
    : Array.isArray(res) ? res : [];
  return raw.filter((e: any) => e?.role === 'user' || e?.role === 'assistant')
    .map((e: any) => ({ role: e.role as 'user' | 'assistant', content: e.content ?? '' }));
}

// ── slash commands ────────────────────────────────────────────────────────────

type SlashCategory = 'session' | 'model' | 'tools' | 'agents';

interface SlashCmd {
  cmd: string;
  desc: string;
  args?: string;
  category: SlashCategory;
  executeLocal: boolean;
  argOptions?: string[];
}

const CATEGORY_LABELS: Record<SlashCategory, string> = {
  session: '会话', model: '模型', tools: '工具', agents: 'Agents',
};

const ALL_CMDS: SlashCmd[] = [
  // session
  { cmd: '/new',     desc: '开启新会话',         category: 'session', executeLocal: true },
  { cmd: '/reset',   desc: '重置当前会话',        category: 'session', executeLocal: true },
  { cmd: '/compact', desc: '压缩会话上下文',      category: 'session', executeLocal: true },
  { cmd: '/stop',    desc: '停止当前运行',        category: 'session', executeLocal: true },
  { cmd: '/clear',   desc: '清空聊天历史',        category: 'session', executeLocal: true },
  { cmd: '/focus',   desc: '切换专注模式',        category: 'session', executeLocal: true },
  // model
  { cmd: '/model',   desc: '查看或切换模型',      args: '[name]',              category: 'model', executeLocal: true },
  { cmd: '/think',   desc: '设置思考级别',        args: '<off|low|medium|high>', category: 'model', executeLocal: true, argOptions: ['off','low','medium','high'] },
  { cmd: '/verbose', desc: '设置详细模式',        args: '<on|off|full>',         category: 'model', executeLocal: true, argOptions: ['on','off','full'] },
  { cmd: '/fast',    desc: '设置快速模式',        args: '<on|off|status>',       category: 'model', executeLocal: true, argOptions: ['on','off','status'] },
  // tools
  { cmd: '/help',    desc: '显示可用命令',        category: 'tools', executeLocal: true },
  { cmd: '/usage',   desc: '查看 token 用量',     category: 'tools', executeLocal: true },
  { cmd: '/export',  desc: '导出为 Markdown',     category: 'tools', executeLocal: true },
  { cmd: '/status',  desc: '显示会话状态',        category: 'tools', executeLocal: false },
  { cmd: '/skill',   desc: '运行技能',            args: '<name>',  category: 'tools',   executeLocal: false },
  // agents
  { cmd: '/agents',  desc: '列出所有 Agent',      category: 'agents', executeLocal: true },
  { cmd: '/kill',    desc: '中止子任务',          args: '<id|all>', category: 'agents', executeLocal: true },
  { cmd: '/steer',   desc: '引导子任务',          args: '<id> <msg>', category: 'agents', executeLocal: false },
];

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Filter + sort completions, grouped by category order */
function getCompletions(filter: string): SlashCmd[] {
  const lower = filter.toLowerCase();
  const CATEGORY_ORDER: SlashCategory[] = ['session', 'model', 'tools', 'agents'];
  return (lower
    ? ALL_CMDS.filter(c => c.cmd.slice(1).startsWith(lower) || c.desc.toLowerCase().includes(lower))
    : ALL_CMDS
  ).slice().sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category), bi = CATEGORY_ORDER.indexOf(b.category);
    if (ai !== bi) return ai - bi;
    if (lower) {
      return (a.cmd.slice(1).startsWith(lower) ? 0 : 1) - (b.cmd.slice(1).startsWith(lower) ? 0 : 1);
    }
    return 0;
  });
}

// ── sub-components ────────────────────────────────────────────────────────────

function ToolBlock({ name, args }: { name: string; args: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 rounded-lg border border-white/20 bg-white/8 text-xs overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-white/50 hover:bg-white/10 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Wrench className="w-3 h-3 shrink-0 text-amber-500" />
        <span className="font-mono">{name}</span>
      </button>
      {open && args && (
        <pre className="px-3 py-2 text-white/70 overflow-x-auto leading-relaxed border-t border-white/20 whitespace-pre-wrap font-mono">
          {args}
        </pre>
      )}
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="mt-1 rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-xs overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-indigo-300 hover:bg-indigo-500/15 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="italic">思考过程</span>
      </button>
      {open && (
        <p className="px-3 py-2 text-indigo-300 leading-relaxed border-t border-indigo-500/20 whitespace-pre-wrap">
          {text}
        </p>
      )}
    </div>
  );
}

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: any }) {
  const blocks = extractContent(content);
  const isUser = role === 'user';

  const textBlocks = blocks.filter(b => b.kind === 'text') as { kind: 'text'; text: string }[];
  const mainText = textBlocks.map(b => b.text).join('\n').trim();
  const displayText = mainText
    .replace(/^\[.*?\]\s*(\[Subagent .*?\]\s*)?(\[Subagent Task\]:?\s*)?/s, '')
    .trim() || mainText;

  const imageBlocks = blocks.filter(b => b.kind === 'image') as { kind: 'image'; dataUrl: string }[];
  if (!displayText && blocks.every(b => b.kind !== 'tool' && b.kind !== 'thinking' && b.kind !== 'image')) return null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${
        isUser ? 'bg-indigo-500/30' : 'bg-white/10'
      }`}>
        {isUser ? <User className="w-3.5 h-3.5 text-indigo-300" /> : <Bot className="w-3.5 h-3.5 text-white/50" />}
      </div>
      <div className={`max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {imageBlocks.map((b, i) => (
          <img key={i} src={b.dataUrl} alt="attachment" className="max-w-xs max-h-64 rounded-xl object-cover border border-white/20" />
        ))}
        {displayText && (
          <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white/10 text-white/85 rounded-tl-sm'
          }`}>
            {displayText}
          </div>
        )}
        {blocks.filter(b => b.kind === 'thinking').map((b, i) => (
          <ThinkingBlock key={i} text={(b as any).text} />
        ))}
        {blocks.filter(b => b.kind === 'tool').map((b, i) => (
          <ToolBlock key={i} name={(b as any).name} args={(b as any).args} />
        ))}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export interface AgentChatProps {
  agentId: string;
  agentName: string;
  workspace: string;
  onClose: () => void;
  /** If set, auto-send this message once after the session history loads. */
  autoSendMessage?: string;
}

export function AgentChat({ agentId, agentName, workspace: _workspace, onClose, autoSendMessage }: AgentChatProps) {
  // Session keys must use the gateway format: "agent:<agentId>:<scope>"
  // so the gateway can parse the agentId and route to the correct agent.
  const defaultSessionKey = `agent:${agentId}:main`;

  // ── session list ────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string>(defaultSessionKey);

  const sessionKey = activeKey;

  // ── chat state ───────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: any }[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState('');

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState('');
  const [sendError, setSendError] = useState('');

  // ── slash commands ──────────────────────────────────────────────────────────
  const [showCmds, setShowCmds] = useState(false);
  const [cmdIdx, setCmdIdx] = useState(0);
  const [filteredCmds, setFilteredCmds] = useState<SlashCmd[]>(ALL_CMDS);
  // Two-phase completion: 'commands' lists commands, 'args' lists argOptions for a command
  const [cmdMode, setCmdMode] = useState<'commands' | 'args'>('commands');
  const [argCmd, setArgCmd] = useState<SlashCmd | null>(null);
  const [filteredArgs, setFilteredArgs] = useState<string[]>([]);
  const [focusMode, setFocusMode] = useState(false);

  // ── refs ─────────────────────────────────────────────────────────────────────
  const streamTextRef = useRef('');
  const activeRunIdRef = useRef<string | null>(null);
  const preSendCountRef = useRef(0);
  const autoSentRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cmdListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── load sessions ────────────────────────────────────────────────────────────
  useEffect(() => {
    setSessionsLoading(true);
    client.sessionsList({ agentId, limit: 50, includeLastMessage: true, includeDerivedTitles: true })
      .then(res => {
        const list: SessionMeta[] = (res?.sessions ?? []).sort((a: SessionMeta, b: SessionMeta) =>
          (b.updatedAt ?? '') > (a.updatedAt ?? '') ? 1 : -1
        );
        setSessions(list);
        // Default to most recent session, fall back to agent-scoped default key
        setActiveKey(list.length > 0 ? list[0].key : defaultSessionKey);
      })
      .catch(() => setActiveKey(defaultSessionKey))
      .finally(() => setSessionsLoading(false));
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── load history when session changes ───────────────────────────────────────
  useEffect(() => {
    // Clear sending state from previous session
    setSending(false);
    setRunId(null);
    setStreamText('');
    streamTextRef.current = '';
    activeRunIdRef.current = null;
    setSendError('');

    setHistLoading(true);
    setHistError('');
    setMessages([]);
    client.chatHistory(sessionKey, 200)
      .then(res => setMessages(parseHistory(res)))
      .catch(err => setHistError(err.message || 'Failed to load history'))
      .finally(() => setHistLoading(false));
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── streaming event subscription ─────────────────────────────────────────────
  useEffect(() => {
    return client.onEvent((event: any) => {
      // Gateway sends: { type: "event", event: "chat", payload: { ... } }
      if (event.event !== 'chat') return;

      const payload = event.payload ?? event.data ?? event;

      console.log('[AgentChat] chat event', payload.state, 'runId:', payload.runId,
        'session:', payload.sessionKey, '| active:', activeRunIdRef.current, '| ours:', sessionKey);

      if (payload.sessionKey !== sessionKey) return;

      const { state, message } = payload;

      if (state === 'delta') {
        // Each delta contains the FULL accumulated text so far — replace, not append
        const raw = message?.content ?? message?.text ?? '';
        const next = typeof raw === 'string' ? raw
          : Array.isArray(raw) ? raw.map((c: any) => c.text ?? '').join('') : '';
        const current = streamTextRef.current ?? '';
        if (!current || next.length >= current.length) {
          streamTextRef.current = next;
          setStreamText(next);
        }
      } else if (state === 'final') {
        const content = streamTextRef.current || message?.content || '';
        streamTextRef.current = '';
        activeRunIdRef.current = null;
        setStreamText('');
        setRunId(null);
        setSending(false);
        setMessages(prev => [...prev, { role: 'assistant', content }]);
        // Refresh sessions list to update last-message preview
        client.sessionsList({ agentId, limit: 50, includeLastMessage: true, includeDerivedTitles: true })
          .then(res => setSessions((res?.sessions ?? []).sort((a: SessionMeta, b: SessionMeta) =>
            (b.updatedAt ?? '') > (a.updatedAt ?? '') ? 1 : -1)))
          .catch(() => {});
      } else if (state === 'aborted' || state === 'error') {
        if (streamTextRef.current) {
          setMessages(prev => [...prev, { role: 'assistant', content: streamTextRef.current }]);
        }
        streamTextRef.current = '';
        activeRunIdRef.current = null;
        setStreamText('');
        setRunId(null);
        setSending(false);
      }
    });
  }, [sessionKey, agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── polling fallback ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sending) return;
    const poll = async () => {
      try {
        const res = await client.chatHistory(sessionKey, 200);
        const msgs = parseHistory(res);
        if (msgs.length > preSendCountRef.current && msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
          console.log('[AgentChat] poll found response');
          setMessages(msgs);
          streamTextRef.current = '';
          activeRunIdRef.current = null;
          setStreamText('');
          setRunId(null);
          setSending(false);
        }
      } catch {}
    };
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [sending, sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── auto-send initial message ─────────────────────────────────────────────────
  useEffect(() => {
    if (!autoSendMessage || autoSentRef.current || histLoading || sending) return;
    autoSentRef.current = true;
    preSendCountRef.current = messages.length;
    setMessages(prev => [...prev, { role: 'user', content: autoSendMessage }]);
    setSending(true);
    setSendError('');
    streamTextRef.current = '';
    setStreamText('');
    client.chatSend(sessionKey, autoSendMessage).then(res => {
      activeRunIdRef.current = res.runId;
      setRunId(res.runId);
    }).catch((e: any) => {
      setSending(false);
      setSendError(e.message || 'Failed to send');
    });
  }, [autoSendMessage, histLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── auto-scroll command list ──────────────────────────────────────────────────
  useEffect(() => {
    if (!cmdListRef.current) return;
    const buttons = cmdListRef.current.querySelectorAll('button');
    buttons[cmdIdx]?.scrollIntoView({ block: 'nearest' });
  }, [cmdIdx]);

  // ── auto-scroll ───────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  // ── new session ───────────────────────────────────────────────────────────────
  const handleNewSession = () => {
    const newKey = `agent:${agentId}:web_${Date.now()}`;
    setSessions(prev => [{ key: newKey, derivedTitle: '新会话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...prev]);
    setActiveKey(newKey);
    setMessages([]);
    setInput('');
    setShowCmds(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ── clear/reload ──────────────────────────────────────────────────────────────
  const handleClear = () => {
    setInput('');
    setShowCmds(false);
    setHistLoading(true);
    setMessages([]);
    client.chatHistory(sessionKey, 200)
      .then(res => setMessages(parseHistory(res)))
      .catch(err => setHistError(err.message || 'Failed'))
      .finally(() => setHistLoading(false));
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ── local command execution ───────────────────────────────────────────────────
  const executeLocalCmd = async (cmdName: string, args: string): Promise<string | null> => {
    switch (cmdName) {
      case 'new':   handleNewSession(); return null;
      case 'reset': handleNewSession(); return null;
      case 'clear': handleClear(); return null;
      case 'stop':  handleAbort(); return null;
      case 'focus': setFocusMode(v => !v); return null;
      case 'compact': {
        try {
          await client.sessionsCompact(sessionKey);
          return 'Context compacted successfully.';
        } catch (err: any) { return `Compaction failed: ${err.message}`; }
      }
      case 'help': {
        const lines = ['**Available Commands**'];
        let cat = '';
        for (const c of ALL_CMDS) {
          if (c.category !== cat) { cat = c.category; lines.push(`\n**${CATEGORY_LABELS[cat as SlashCategory]}**`); }
          lines.push(`\`${c.cmd}${c.args ? ' ' + c.args : ''}\` — ${c.desc}`);
        }
        return lines.join('\n');
      }
      case 'usage': {
        try {
          const res = await client.sessionsList({ agentId, limit: 100 });
          const s = (res?.sessions ?? []).find((x: any) => x.key === sessionKey);
          if (!s) return 'No session data found.';
          const inp = s.inputTokens ?? 0, out = s.outputTokens ?? 0, tot = s.totalTokens ?? (inp + out);
          const lines = ['**Session Usage**', `Input: **${fmtTokens(inp)}** tokens`, `Output: **${fmtTokens(out)}** tokens`, `Total: **${fmtTokens(tot)}** tokens`];
          if (s.model) lines.push(`Model: \`${s.model}\``);
          return lines.join('\n');
        } catch (err: any) { return `Failed to get usage: ${err.message}`; }
      }
      case 'model': {
        try {
          if (!args) {
            const res = await client.sessionsList({ agentId, limit: 100 });
            const s = (res?.sessions ?? []).find((x: any) => x.key === sessionKey);
            return `**Current model:** \`${s?.model ?? 'default'}\``;
          }
          await client.sessionsPatch(sessionKey, { model: args.trim() });
          return `Model set to \`${args.trim()}\`.`;
        } catch (err: any) { return `Failed: ${err.message}`; }
      }
      case 'think':
      case 'verbose':
      case 'fast': {
        try {
          if (!args) {
            const res = await client.sessionsList({ agentId, limit: 100 });
            const s = (res?.sessions ?? []).find((x: any) => x.key === sessionKey);
            const val = cmdName === 'think' ? (s?.thinkingLevel ?? 'off')
              : cmdName === 'verbose' ? (s?.verboseLevel ?? 'off')
              : (s?.fastMode ? 'on' : 'off');
            const c = ALL_CMDS.find(x => x.cmd === `/${cmdName}`);
            return `Current **${cmdName}**: \`${val}\`\nOptions: ${c?.args ?? ''}`;
          }
          const patch = cmdName === 'think' ? { thinkingLevel: args.trim() }
            : cmdName === 'verbose' ? { verboseLevel: args.trim() }
            : { fastMode: args.trim() === 'on' };
          await client.sessionsPatch(sessionKey, patch);
          return `**${cmdName}** set to \`${args.trim()}\`.`;
        } catch (err: any) { return `Failed: ${err.message}`; }
      }
      case 'agents': {
        try {
          const result = await client.agentsList();
          const agents = result?.agents ?? [];
          if (agents.length === 0) return 'No agents configured.';
          const lines = [`**Agents** (${agents.length})`];
          for (const a of agents) {
            const name = a.identity?.name || a.name || a.id;
            lines.push(`- \`${a.id}\` — ${name}${a.id === result?.defaultId ? ' *(default)*' : ''}`);
          }
          return lines.join('\n');
        } catch (err: any) { return `Failed to list agents: ${err.message}`; }
      }
      case 'kill': {
        if (!args.trim()) return 'Usage: `/kill <id|all>`';
        if (args.trim() === 'all' && runId) {
          try { await client.chatAbort(sessionKey, runId); return 'Aborted current run.'; }
          catch (err: any) { return `Failed to abort: ${err.message}`; }
        }
        return 'Usage: `/kill all` to abort the current run.';
      }
      case 'export': {
        const lines: string[] = [`# ${agentName} — ${sessionKey}\n`];
        for (const msg of messages) {
          const role = msg.role === 'user' ? '**User**' : '**Assistant**';
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
          lines.push(`### ${role}\n\n${content}\n`);
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${agentId}-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
        return 'Session exported.';
      }
      default: return `Unknown command: \`/${cmdName}\``;
    }
  };

  // ── execute slash command (local or send to agent) ────────────────────────────
  const execCmd = (fullText: string) => {
    setShowCmds(false);
    setInput('');
    const trimmed = fullText.trim();
    const spaceIdx = trimmed.search(/\s/);
    const cmdStr = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trimStart();
    const cmdName = cmdStr.slice(1).toLowerCase();
    const cmdDef = ALL_CMDS.find(c => c.cmd === cmdStr.toLowerCase());

    if (!cmdDef || !cmdDef.executeLocal) {
      // Send to agent as a regular message
      preSendCountRef.current = messages.length;
      setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
      setSending(true);
      setSendError('');
      streamTextRef.current = '';
      setStreamText('');
      client.chatSend(sessionKey, trimmed).then(res => {
        activeRunIdRef.current = res.runId;
        setRunId(res.runId);
      }).catch((e: any) => {
        setSending(false);
        setSendError(e.message || 'Failed to send');
      });
      return;
    }

    executeLocalCmd(cmdName, args).then(result => {
      if (result !== null) {
        setMessages(prev => [...prev, { role: 'assistant', content: result }]);
      }
    });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ── input change ──────────────────────────────────────────────────────────────
  // ── tab completion helpers ────────────────────────────────────────────────────
  /** Tab on a command: fill text; if it has argOptions switch to args mode */
  const tabCompleteCmd = (cmd: SlashCmd) => {
    if (cmd.argOptions?.length) {
      setInput(`${cmd.cmd} `);
      setCmdMode('args');
      setArgCmd(cmd);
      setFilteredArgs(cmd.argOptions);
      setCmdIdx(0);
      setShowCmds(true);
    } else {
      // No args options: fill command text (trailing space if expects free-form args)
      setInput(cmd.args ? `${cmd.cmd} ` : cmd.cmd);
      setShowCmds(false);
      setCmdMode('commands');
      setArgCmd(null);
    }
  };

  /** Tab/Enter on an arg: fill text and optionally execute */
  const selectArg = (arg: string, execute: boolean) => {
    const name = argCmd?.cmd ?? '';
    const filled = `${name} ${arg}`;
    setInput(filled);
    setShowCmds(false);
    setCmdMode('commands');
    setArgCmd(null);
    if (execute) {
      // slight delay so input state settles before execCmd reads it
      setTimeout(() => execCmd(filled), 0);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    // If user edits while in args mode, go back to command mode
    if (cmdMode === 'args') {
      setCmdMode('commands');
      setArgCmd(null);
    }
    if (val.startsWith('/')) {
      const q = val.slice(1).split(/\s/)[0].toLowerCase();
      const filtered = getCompletions(q);
      setFilteredCmds(filtered);
      setShowCmds(filtered.length > 0);
      setCmdIdx(0);
    } else {
      setShowCmds(false);
    }
  };

  // ── attachments ──────────────────────────────────────────────────────────────
  const addFilesAsAttachments = (files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          dataUrl: reader.result as string,
          mimeType: file.type,
        }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach(item => {
      const file = item.getAsFile();
      if (file) addFilesAsAttachments([file]);
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    addFilesAsAttachments(imageFiles);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFilesAsAttachments(files);
    e.target.value = '';
  };

  // ── send ──────────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending) return;
    // Execute slash command — pass full input so args are preserved
    if (text.startsWith('/') && showCmds && filteredCmds.length > 0) {
      execCmd(text);
      return;
    }

    // Build content blocks for local display (text + images)
    const pendingAttachments = [...attachments];
    const userContent: any = pendingAttachments.length > 0
      ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...pendingAttachments.map(a => ({ type: 'image', source: { type: 'base64', media_type: a.mimeType, data: a.dataUrl } })),
        ]
      : text;

    preSendCountRef.current = messages.length;
    setMessages(prev => [...prev, { role: 'user', content: userContent }]);
    setInput('');
    setAttachments([]);
    setShowCmds(false);
    setSending(true);
    setSendError('');
    streamTextRef.current = '';
    setStreamText('');

    // Convert attachments to API format (base64 content only, no data URL prefix)
    const apiAttachments = pendingAttachments.length > 0
      ? pendingAttachments.map(a => {
          const parsed = dataUrlToBase64(a.dataUrl);
          return parsed ? { type: 'image' as const, mimeType: parsed.mimeType, content: parsed.content } : null;
        }).filter((a): a is NonNullable<typeof a> => a !== null)
      : undefined;

    try {
      const res = await client.chatSend(sessionKey, text, undefined, apiAttachments);
      activeRunIdRef.current = res.runId;
      setRunId(res.runId);
      console.log('[AgentChat] chatSend ok, runId:', res.runId, 'sessionKey:', sessionKey);
    } catch (e: any) {
      setSending(false);
      setSendError(e.message || 'Failed to send');
    }
  };

  const handleAbort = async () => {
    if (!runId) return;
    try { await client.chatAbort(sessionKey, runId); } catch {}
    activeRunIdRef.current = null;
  };

  // ── keyboard in textarea ──────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCmds) {
      // ── Args mode (argOptions list) ────────────────────────────────────────
      if (cmdMode === 'args' && filteredArgs.length > 0) {
        const len = filteredArgs.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx(i => (i + 1) % len); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setCmdIdx(i => (i - 1 + len) % len); return; }
        if (e.key === 'Tab') {
          e.preventDefault();
          selectArg(filteredArgs[cmdIdx], false);   // fill only
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          selectArg(filteredArgs[cmdIdx], true);    // fill + execute
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowCmds(false);
          setCmdMode('commands');
          setArgCmd(null);
          return;
        }
      }

      // ── Command mode (command list) ────────────────────────────────────────
      if (cmdMode === 'commands' && filteredCmds.length > 0) {
        const len = filteredCmds.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx(i => (i + 1) % len); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setCmdIdx(i => (i - 1 + len) % len); return; }
        if (e.key === 'Tab') {
          e.preventDefault();
          if (filteredCmds[cmdIdx]) tabCompleteCmd(filteredCmds[cmdIdx]);  // fill only
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (filteredCmds[cmdIdx]) execCmd(filteredCmds[cmdIdx].cmd);    // execute
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); setShowCmds(false); return; }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeSession = sessions.find(s => s.key === sessionKey);
  const sessionTitle = activeSession?.derivedTitle ?? activeSession?.title ?? sessionKey;

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-heavy rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/30 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4 text-indigo-300" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-white text-sm">{agentName}</span>
            <span className="text-white/40 text-xs ml-2 truncate hidden sm:inline">{sessionTitle}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: sidebar + chat */}
        <div className="flex flex-1 min-h-0">

          {/* Session sidebar — hidden in focus mode */}
          <div className={`w-48 shrink-0 border-r border-white/10 flex flex-col transition-all ${focusMode ? 'hidden' : ''}`}>
            <div className="px-3 py-2 border-b border-white/8">
              <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">会话列表</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-white/40 text-center py-6 px-3">暂无会话</p>
              ) : (
                sessions.map(s => {
                  const title = s.derivedTitle ?? s.title ?? s.key.slice(0, 12) + '…';
                  const date = formatDate(s.updatedAt ?? s.createdAt);
                  const isActive = s.key === sessionKey;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setActiveKey(s.key)}
                      className={`w-full text-left px-3 py-2.5 border-b border-white/8 transition-colors ${
                        isActive
                          ? 'bg-indigo-500/15 border-l-2 border-l-indigo-400'
                          : 'hover:bg-white/8 border-l-2 border-l-transparent'
                      }`}
                    >
                      <p className={`text-xs font-medium truncate ${isActive ? 'text-indigo-300' : 'text-white/80'}`}>
                        {title}
                      </p>
                      {date && <p className="text-[10px] text-white/40 mt-0.5">{date}</p>}
                    </button>
                  );
                })
              )}
            </div>
            <div className="border-t border-white/10 p-2">
              <button
                onClick={handleNewSession}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-white/40 hover:text-indigo-300 hover:bg-indigo-500/15 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                新建会话
              </button>
            </div>
          </div>

          {/* Chat panel */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {histLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin text-white/40" />
                </div>
              ) : histError ? (
                <div className="flex items-center gap-2 p-3 bg-amber-500/15 rounded-lg text-sm text-amber-300">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {histError} — 开始发送消息即可开启新会话
                </div>
              ) : messages.length === 0 && !streamText ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Bot className="w-12 h-12 text-white/20 mb-3" />
                  <p className="text-sm text-white/40">向 {agentName} 发送消息开始对话</p>
                  <p className="text-xs text-white/30 mt-1">输入 / 查看快捷命令</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <ChatBubble key={i} role={msg.role} content={msg.content} />
                ))
              )}

              {/* Streaming bubble */}
              {streamText && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 bg-white/10">
                    <Bot className="w-3.5 h-3.5 text-white/50" />
                  </div>
                  <div className="max-w-[78%] bg-white/10 text-white/85 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {streamText}
                    <span className="inline-block w-0.5 h-3.5 bg-white/50 ml-0.5 align-middle animate-pulse" />
                  </div>
                </div>
              )}

              {/* Typing indicator */}
              {sending && !streamText && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 bg-white/10">
                    <Bot className="w-3.5 h-3.5 text-white/50" />
                  </div>
                  <div className="bg-white/10 rounded-2xl rounded-tl-sm px-3.5 py-3">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Error bar */}
            {sendError && (
              <div className="px-5 py-2 bg-red-500/15 text-xs text-red-300 flex items-center gap-2 shrink-0">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {sendError}
              </div>
            )}

            {/* Input area */}
            <div className="px-4 pb-4 pt-2 shrink-0 border-t border-white/10">

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileInput}
              />

              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2 px-1">
                  {attachments.map(att => (
                    <div key={att.id} className="relative group">
                      <img
                        src={att.dataUrl}
                        alt="attachment"
                        className="w-16 h-16 object-cover rounded-lg border border-white/20"
                      />
                      <button
                        onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input box with slash-command dropdown anchored just above it */}
              <div className="relative">

                {/* Slash command dropdown */}
                {showCmds && (
                  <div ref={cmdListRef} className="absolute left-0 right-0 bottom-full mb-2 glass-heavy rounded-xl overflow-hidden z-10 max-h-72 overflow-y-auto shadow-2xl shadow-black/40">

                    {/* ── Args mode: show argOptions for the selected command ── */}
                    {cmdMode === 'args' && argCmd && filteredArgs.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 bg-white/8 border-b border-white/10 flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-indigo-300 font-mono">{argCmd.cmd}</span>
                          <span className="text-[10px] text-white/40">{argCmd.desc}</span>
                          <span className="ml-auto text-[10px] text-white/30">Tab 填入 · Enter 执行</span>
                        </div>
                        {filteredArgs.map((arg, i) => (
                          <button
                            key={arg}
                            onClick={() => selectArg(arg, true)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                              i === cmdIdx ? 'bg-indigo-500/15' : 'hover:bg-white/8'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                              i === cmdIdx ? 'bg-indigo-500/30' : 'bg-white/10'
                            }`}>
                              <Hash className={`w-2.5 h-2.5 ${i === cmdIdx ? 'text-indigo-300' : 'text-white/40'}`} />
                            </div>
                            <span className={`text-xs font-mono font-medium ${i === cmdIdx ? 'text-indigo-300' : 'text-white/80'}`}>
                              {arg}
                            </span>
                          </button>
                        ))}
                      </>
                    )}

                    {/* ── Command mode: show command list ── */}
                    {cmdMode === 'commands' && filteredCmds.length > 0 && (() => {
                      const items: React.ReactNode[] = [];
                      let lastCat = '';
                      filteredCmds.forEach((c, i) => {
                        if (c.category !== lastCat) {
                          lastCat = c.category;
                          items.push(
                            <div key={`cat-${c.category}`} className="px-3 py-1 bg-white/8 border-b border-white/10">
                              <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">
                                {CATEGORY_LABELS[c.category]}
                              </span>
                            </div>
                          );
                        }
                        items.push(
                          <button
                            key={c.cmd}
                            onClick={() => tabCompleteCmd(c)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                              i === cmdIdx ? 'bg-indigo-500/15' : 'hover:bg-white/8'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                              i === cmdIdx ? 'bg-indigo-500/30' : 'bg-white/10'
                            }`}>
                              <Hash className={`w-2.5 h-2.5 ${i === cmdIdx ? 'text-indigo-300' : 'text-white/40'}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className={`text-xs font-medium font-mono ${i === cmdIdx ? 'text-indigo-300' : 'text-white/80'}`}>
                                {c.cmd}{c.args ? <span className="text-white/40 font-normal ml-1">{c.args}</span> : null}
                              </span>
                              <span className="text-[11px] text-white/40 ml-2">{c.desc}</span>
                            </div>
                            {!c.executeLocal && (
                              <span className="text-[10px] text-white/30 shrink-0">agent</span>
                            )}
                          </button>
                        );
                      });
                      return items;
                    })()}
                  </div>
                )}

              <div
                className="flex items-end gap-2 border border-white/20 rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-white/40 focus-within:border-white/40 transition-all"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
              >
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-300 hover:bg-white/10 transition-colors shrink-0 disabled:opacity-40"
                  title="附加图片"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  disabled={sending}
                  placeholder="输入消息… (Enter 发送 · / 查看命令 · 可粘贴图片)"
                  rows={1}
                  className="flex-1 resize-none text-sm text-white placeholder-white/40 focus:outline-none leading-relaxed bg-transparent disabled:opacity-60"
                  style={{ maxHeight: '8rem', overflowY: 'auto' }}
                />
                {sending ? (
                  <button
                    onClick={handleAbort}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-red-300 hover:bg-red-500/20 transition-colors shrink-0"
                    title="停止"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && attachments.length === 0}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors shrink-0"
                    title="发送"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
              </div>{/* end relative wrapper */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
