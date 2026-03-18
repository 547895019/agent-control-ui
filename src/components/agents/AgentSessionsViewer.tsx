import { useState, useEffect, useRef } from 'react';
import { client } from '../../api/gateway';
import { X, MessageSquare, Loader2, AlertCircle, ChevronDown, ChevronRight, Bot, User, Wrench } from 'lucide-react';

interface SessionMeta {
  key: string;
  title?: string;
  derivedTitle?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  agentId?: string;
}

// ── message content extraction ────────────────────────────────────────────────

type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; args: string }
  | { kind: 'tool_result'; toolName: string; content: string; isError: boolean };

function extractContent(msg: any): ContentBlock[] {
  const role = msg?.message?.role ?? msg?.role;
  const raw = msg?.message ?? msg;
  const content = raw?.content ?? raw?.text ?? '';

  if (role === 'toolResult') {
    const text = Array.isArray(content)
      ? content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
      : String(content ?? '');
    return [{ kind: 'tool_result', toolName: raw.toolName ?? 'tool', content: text, isError: !!raw.isError }];
  }

  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  if (!Array.isArray(content)) return [{ kind: 'text', text: JSON.stringify(content) }];

  return content.flatMap((block: any): ContentBlock[] => {
    if (block.type === 'text') return [{ kind: 'text', text: block.text ?? '' }];
    if (block.type === 'thinking') return [{ kind: 'thinking', text: block.thinking ?? '' }];
    if (block.type === 'toolCall') {
      const args = block.arguments ? JSON.stringify(block.arguments, null, 2) : '';
      return [{ kind: 'tool', name: block.name ?? 'tool', args }];
    }
    return [];
  });
}

// ── sub-components ─────────────────────────────────────────────────────────────

function ToolBlock({ name, args }: { name: string; args: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 text-xs overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-slate-500 hover:bg-slate-100 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Wrench className="w-3 h-3 shrink-0 text-amber-500" />
        <span className="font-mono">{name}</span>
      </button>
      {open && args && (
        <pre className="px-3 py-2 text-slate-600 overflow-x-auto leading-relaxed border-t border-slate-200 whitespace-pre-wrap font-mono">
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
    <div className="mt-1 rounded-lg border border-indigo-100 bg-indigo-50/50 text-xs overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-indigo-400 hover:bg-indigo-50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="italic">思考过程</span>
      </button>
      {open && (
        <p className="px-3 py-2 text-indigo-600 leading-relaxed border-t border-indigo-100 whitespace-pre-wrap">
          {text}
        </p>
      )}
    </div>
  );
}

function ChatMessage({ event }: { event: { role: 'user' | 'assistant'; content: any } }) {
  const role = event.role;
  const blocks = extractContent(event);
  const isUser = role === 'user';
  const ts = '';

  const textBlocks = blocks.filter(b => b.kind === 'text') as { kind: 'text'; text: string }[];
  const mainText = textBlocks.map(b => b.text).join('\n').trim();

  // strip subagent context prefix for cleaner display
  const displayText = mainText.replace(/^\[.*?\]\s*(\[Subagent .*?\]\s*)?(\[Subagent Task\]:?\s*)?/s, '').trim() || mainText;

  if (!displayText && blocks.every(b => b.kind !== 'tool' && b.kind !== 'thinking')) return null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${
        isUser ? 'bg-indigo-100' : 'bg-slate-100'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-indigo-600" />
          : <Bot className="w-3.5 h-3.5 text-slate-500" />
        }
      </div>

      {/* Bubble */}
      <div className={`max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {displayText && (
          <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-slate-100 text-slate-800 rounded-tl-sm'
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
        {ts && <span className="text-[10px] text-slate-400 px-1">{ts}</span>}
      </div>
    </div>
  );
}

// ── main component ──────────────────────────────────────────────────────────────

interface AgentSessionsViewerProps {
  agentId: string;
  agentName: string;
  workspace: string;
  onClose: () => void;
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
  const raw: any[] = Array.isArray(res?.messages) ? res.messages : Array.isArray(res) ? res : [];
  return raw.filter((e: any) => e?.role === 'user' || e?.role === 'assistant')
    .map((e: any) => ({ role: e.role as 'user' | 'assistant', content: e.content ?? '' }));
}

export function AgentSessionsViewer({ agentId, agentName, workspace: _workspace, onClose }: AgentSessionsViewerProps) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState('');

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: any }[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  // load sessions list — same agentId as AgentChat
  useEffect(() => {
    setSessionsLoading(true);
    setSessionsError('');
    client.sessionsList({ agentId, limit: 50, includeLastMessage: true, includeDerivedTitles: true })
      .then(res => {
        const list: SessionMeta[] = (res?.sessions ?? []).sort((a: SessionMeta, b: SessionMeta) =>
          (b.updatedAt ?? '') > (a.updatedAt ?? '') ? 1 : -1
        );
        setSessions(list);
        if (list.length > 0) setActiveKey(list[0].key);
      })
      .catch(err => setSessionsError(err.message || 'Failed to load sessions'))
      .finally(() => setSessionsLoading(false));
  }, [agentId]);

  // load messages when session selected — same parsing as AgentChat
  useEffect(() => {
    if (!activeKey) return;
    setMessagesLoading(true);
    setMessagesError('');
    setMessages([]);
    client.chatHistory(activeKey, 300)
      .then(res => setMessages(parseHistory(res)))
      .catch(err => setMessagesError(err.message || 'Failed to load messages'))
      .finally(() => setMessagesLoading(false));
  }, [activeKey]);

  // auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const activeSession = sessions.find(s => s.key === activeKey);
  const sessionTitle = activeSession?.derivedTitle ?? activeSession?.title ?? activeKey?.slice(0, 8);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <span className="font-semibold text-slate-800 text-sm">{agentName}</span>
            <span className="text-slate-400 text-xs ml-2">历史对话</span>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Sessions sidebar */}
          <div className="w-56 shrink-0 border-r border-slate-100 flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                会话列表
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                </div>
              ) : sessionsError ? (
                <div className="p-3">
                  <p className="text-xs text-red-500 flex items-start gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {sessionsError}
                  </p>
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4 gap-2">
                  <MessageSquare className="w-8 h-8 text-slate-200" />
                  <p className="text-xs text-slate-500 font-medium">无活跃会话</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    该 Agent 的历史会话已被归档或删除，
                    <br/>无法通过网关 API 访问。
                  </p>
                </div>
              ) : (
                sessions.map(s => {
                  const title = s.derivedTitle ?? s.title ?? s.key.slice(0, 12) + '…';
                  const date = formatDate(s.updatedAt ?? s.createdAt);
                  const isActive = s.key === activeKey;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setActiveKey(s.key)}
                      className={`w-full text-left px-3 py-3 border-b border-slate-50 transition-colors ${
                        isActive ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-slate-50 border-l-2 border-l-transparent'
                      }`}
                    >
                      <p className={`text-xs font-medium truncate ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {title}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{date}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Chat panel */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {!activeKey ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <MessageSquare className="w-12 h-12 text-slate-200 mb-3" />
                <p className="text-sm text-slate-400">选择左侧会话查看对话记录</p>
              </div>
            ) : (
              <>
                {/* Chat header */}
                <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
                  <p className="text-xs font-medium text-slate-600 truncate">{sessionTitle}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{activeKey}</p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    </div>
                  ) : messagesError ? (
                    <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-600">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {messagesError}
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <p className="text-sm text-slate-400">该会话暂无消息记录</p>
                    </div>
                  ) : (
                    messages.map((event, i) => (
                      <ChatMessage key={i} event={event} />
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
