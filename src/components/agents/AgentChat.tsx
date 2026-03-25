import React, { useState, useEffect, useRef, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { client } from '../../api/gateway';
import { ModelSelect } from '../shared/ModelSelect';

// Configure marked once
marked.use({ breaks: true, gfm: true } as any);

/** Convert a local file path to a URL served by localfile-server (/raw).
 *  Port is injected by Vite: 19877 in dev, 19876 in production.
 *  Token is embedded as a query param so <img src="..."> requests are authenticated. */
function localFileUrl(path: string, token = ''): string {
  const base = `http://${window.location.hostname}:${__LOCALFILE_PORT__}`;
  const tok = token ? `&token=${token}` : '';
  return `${base}/raw?path=${encodeURIComponent(path)}${tok}`;
}

// Module-level token cache — fetched once on load, used by renderMarkdown & MarkdownBody
let _lfToken = '';
client.localToken().then(t => { _lfToken = t; });

/** Returns true if the string looks like a local filesystem path (not an HTTP/data URL). */
function isLocalPath(s: string): boolean {
  return (s.startsWith('/') || s.startsWith('~')) &&
    !s.startsWith('//');
}

function renderMarkdown(text: string): string {
  // Pre-process: rewrite local file paths in markdown image syntax to /raw endpoint (with token)
  const processed = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
    const resolvedSrc = isLocalPath(src) ? localFileUrl(src, _lfToken) : src;
    return `![${alt}](${resolvedSrc})`;
  });
  const html = marked.parse(processed) as string;
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'a',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'width', 'height'],
  });
  return clean.replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=');
}

function MarkdownBody({ text, dim }: { text: string; dim?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className={`md-body text-sm leading-relaxed transition-opacity break-words ${dim ? 'opacity-40' : 'opacity-100'}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
import {
  X, Send, Square, Loader2, AlertCircle,
  Bot, User, Wrench, ChevronDown, ChevronRight,
  MessageSquare, Plus, Hash, Paperclip, Brain,
  Copy, Check, Search, Trash2, Pencil,
  Mic, MicOff, Volume2, VolumeX,
  Maximize2, Minimize2, Download, FileDown,
} from 'lucide-react';

// ── types ─────────────────────────────────────────────────────────────────────

interface SessionMeta {
  key: string;
  title?: string;
  derivedTitle?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  model?: string;
}

interface ChatAttachment {
  id: string;
  dataUrl: string;    // preview (always available immediately)
  mimeType: string;
  name: string;       // original filename
  path?: string;      // set after upload to workspace
  uploading?: boolean;
}

type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; args: string };

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
    return [];
  });
}


/** Human-readable session name.
 * Key format: "agent:<agentId>:<scope>" — show derived/title first, then scope.
 * "web_<timestamp>" scopes are formatted as a short date-time. */
function sessionLabel(s: { key: string }): string {
  return s.key.split(':').pop() ?? s.key;
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

interface MessageUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: any;
  usage?: MessageUsage;
}

let _idCtr = 0;
function makeId() { return `m${Date.now()}_${(_idCtr++).toString(36)}`; }


// ── Deleted-message localStorage helpers ──────────────────────────────────────
function loadDeletedIds(sessionKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`openclaw:deleted:${sessionKey}`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function saveDeletedIds(sessionKey: string, ids: Set<string>) {
  try { localStorage.setItem(`openclaw:deleted:${sessionKey}`, JSON.stringify([...ids])); } catch {}
}

function parseHistory(res: any): ChatMessage[] {
  const raw: any[] = Array.isArray(res?.messages) ? res.messages
    : Array.isArray(res) ? res : [];
  return raw.filter((e: any) => e?.role === 'user' || e?.role === 'assistant')
    // Use stable index-based IDs so localStorage-persisted deleted IDs survive reopens
    .map((e: any, i: number) => ({ id: `hist_${i}`, role: e.role as 'user' | 'assistant', content: e.content ?? '' }));
}

const MD_IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

async function exportConversation(
  agentName: string,
  sessionKey: string,
  messages: ChatMessage[]
) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const assetsFolder = zip.folder('assets')!;
  const assetMap = new Map<string, string>(); // localPath -> filename in assets/
  const fileDataUrls = new Map<string, string>(); // filename -> data URL for HTML embedding

  // 1. Collect all local asset paths from messages
  for (const msg of messages) {
    const text = extractContent(msg.content).filter(b => b.kind === 'text').map(b => b.text).join('\n\n');
    for (const match of text.matchAll(new RegExp(MD_IMG_RE.source, 'g'))) {
      const src = match[2];
      if (isLocalPath(src) && !assetMap.has(src)) {
        const basename = src.split('/').pop() || `file_${assetMap.size}`;
        const uniqueName = assetMap.size === 0 ? basename : `${assetMap.size}_${basename}`;
        assetMap.set(src, uniqueName);
      }
    }
  }

  // 2. Download all assets in parallel; build data URLs for self-contained HTML
  await Promise.all([...assetMap.entries()].map(async ([localPath, assetName]) => {
    try {
      const url = localFileUrl(localPath, _lfToken);
      const res = await fetch(url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        assetsFolder.file(assetName, buf);
        const mime = res.headers.get('content-type') || 'application/octet-stream';
        const bytes = new Uint8Array(buf);
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192) {
          chunks.push(String.fromCharCode(...(bytes.subarray(i, i + 8192) as unknown as number[])));
        }
        fileDataUrls.set(assetName, `data:${mime};base64,${btoa(chunks.join(''))}`);
      }
    } catch {}
  }));

  // 3. Build conversation.md and index.html (local paths → ./assets/filename)
  const mdLines: string[] = [`# ${agentName} — ${sessionKey}\n`];
  const htmlParts: string[] = [];
  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    let text = extractContent(msg.content).filter(b => b.kind === 'text').map(b => b.text).join('\n\n');
    if (!text.trim()) continue;
    text = text.replace(new RegExp(MD_IMG_RE.source, 'g'), (_m: string, alt: string, src: string) => {
      if (isLocalPath(src) && assetMap.has(src)) {
        return `![${alt}](./assets/${assetMap.get(src)})`;
      }
      return `![${alt}](${src})`;
    });
    mdLines.push(`### **${roleLabel}**\n\n${text}\n`);
    let bodyHtml = DOMPurify.sanitize(marked.parse(text) as string, {
      ALLOWED_TAGS: ['p','br','strong','b','em','i','del','s','code','pre',
        'h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','a',
        'table','thead','tbody','tr','th','td','hr','img'],
      ALLOWED_ATTR: ['href','src','alt','width','height'],
    });
    // Replace ./assets/filename with inline data URLs so HTML is self-contained
    bodyHtml = bodyHtml.replace(/src="\.\/assets\/([^"]+)"/g, (_m, filename) => {
      const dataUrl = fileDataUrls.get(filename);
      return dataUrl ? `src="${dataUrl}"` : `src="./assets/${filename}"`;
    });
    htmlParts.push(
      `<div class="msg ${msg.role}"><div class="role">${roleLabel}</div><div class="body">${bodyHtml}</div></div>`
    );
  }
  zip.file('conversation.md', mdLines.join('\n'));

  const title = `${agentName} — ${sessionKey}`;
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f9fafb;color:#111827;line-height:1.65}
.container{max-width:880px;margin:0 auto;padding:2rem 1rem}
h1{font-size:1.1rem;color:#374151;padding-bottom:1rem;border-bottom:1px solid #e5e7eb;margin-bottom:1.5rem;font-weight:600}
.msg{margin-bottom:1.25rem;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.role{padding:.4rem 1rem;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.body{padding:1rem 1.25rem;background:#fff}.body>*+*{margin-top:.75rem}
.user .role{background:#eff6ff;color:#1d4ed8}.assistant .role{background:#f0fdf4;color:#15803d}
img{max-width:100%;border-radius:6px;display:block;margin:.25rem 0}
pre{background:#1e1e2e;color:#cdd6f4;padding:1rem;border-radius:6px;overflow-x:auto;font-size:.85rem;line-height:1.5}
code{background:#f3f4f6;padding:.15em .4em;border-radius:4px;font-size:.85em;font-family:ui-monospace,'Cascadia Code',monospace}
pre code{background:none;padding:0;font-size:inherit}
blockquote{border-left:4px solid #d1d5db;padding:.5rem 1rem;color:#6b7280;background:#f9fafb;border-radius:0 4px 4px 0}
table{width:100%;border-collapse:collapse;font-size:.9rem;margin:.5rem 0}
th,td{border:1px solid #e5e7eb;padding:.45rem .75rem;text-align:left}th{background:#f3f4f6;font-weight:600}
a{color:#2563eb}hr{border:none;border-top:1px solid #e5e7eb;margin:.5rem 0}
ul,ol{padding-left:1.5rem}h2,h3,h4{font-weight:600}
p{margin:0}
</style>
</head>
<body>
<div class="container">
<h1>${title}</h1>
${htmlParts.join('\n')}
</div>
</body>
</html>`;
  zip.file('index.html', htmlContent);

  // 4. Trigger download
  const date = new Date().toISOString().slice(0, 10);
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${agentName}_${date}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── slash commands ────────────────────────────────────────────────────────────

type SlashCategory = 'session' | 'model' | 'tools' | 'agents' | 'gateway';

interface SlashCmd {
  cmd: string;
  desc: string;
  args?: string;
  category: SlashCategory;
  executeLocal: boolean;
  argOptions?: string[];
}

const CATEGORY_LABELS: Record<SlashCategory, string> = {
  session: '会话', model: '模型', tools: '工具', agents: 'Agents', gateway: '网关',
};

const ALL_CMDS: SlashCmd[] = [
  // session
  { cmd: '/new',        desc: '开启新会话',                   category: 'session', executeLocal: true },
  { cmd: '/reset',      desc: '重置当前会话',                 category: 'session', executeLocal: true },
  { cmd: '/compact',    desc: '压缩会话上下文',               category: 'session', executeLocal: true },
  { cmd: '/stop',       desc: '停止当前运行',                 category: 'session', executeLocal: true },
  { cmd: '/clear',      desc: '清空聊天历史',                 category: 'session', executeLocal: true },
  { cmd: '/focus',      desc: '切换专注模式',                 category: 'session', executeLocal: true },
  { cmd: '/session',    desc: '显示当前会话信息',             category: 'session', executeLocal: true },
  { cmd: '/activation', desc: '设置组激活模式',               args: '<mention|always>', category: 'session', executeLocal: true, argOptions: ['mention','always'] },
  { cmd: '/send',       desc: '设置发送策略',                 args: '<on|off|inherit>', category: 'session', executeLocal: true, argOptions: ['on','off','inherit'] },
  // model
  { cmd: '/model',      desc: '查看或切换模型',               args: '[name]',                    category: 'model', executeLocal: true },
  { cmd: '/models',     desc: '列出所有可用模型',             category: 'model', executeLocal: true },
  { cmd: '/think',      desc: '设置思考级别',                 args: '<off|minimal|low|medium|high|xhigh>', category: 'model', executeLocal: true, argOptions: ['off','minimal','low','medium','high','xhigh'] },
  { cmd: '/verbose',    desc: '设置详细模式',                 args: '<on|off>',                  category: 'model', executeLocal: true, argOptions: ['on','off'] },
  { cmd: '/fast',       desc: '设置快速模式',                 args: '<on|off|status>',           category: 'model', executeLocal: true, argOptions: ['on','off','status'] },
  { cmd: '/reasoning',  desc: '设置推理可见性',               args: '<on|off|stream>',           category: 'model', executeLocal: true, argOptions: ['on','off','stream'] },
  { cmd: '/elevated',   desc: '设置提升模式',                 args: '<on|off|ask|full>',         category: 'model', executeLocal: true, argOptions: ['on','off','ask','full'] },
  // tools
  { cmd: '/help',       desc: '显示可用命令',                 category: 'tools', executeLocal: true },
  { cmd: '/usage',      desc: '查看 token 用量',              category: 'tools', executeLocal: true },
  { cmd: '/export',     desc: '导出会话为 Markdown',          category: 'tools', executeLocal: true },
  { cmd: '/status',     desc: '显示网关状态',                 category: 'tools', executeLocal: false },
  { cmd: '/whoami',     desc: '显示当前发送者 ID',            category: 'tools', executeLocal: false },
  { cmd: '/context',    desc: '解释上下文构建方式',           category: 'tools', executeLocal: false },
  { cmd: '/skill',      desc: '按名称运行技能',               args: '<name> [input]',            category: 'tools', executeLocal: false },
  { cmd: '/btw',        desc: '不影响上下文的附加问题',       args: '<message>',                 category: 'tools', executeLocal: false },
  // agents
  { cmd: '/agents',     desc: '列出所有 Agent',               category: 'agents', executeLocal: true },
  { cmd: '/subagents',  desc: '管理子代理',                   args: '<list|kill|log> [id]',      category: 'agents', executeLocal: false },
  { cmd: '/kill',       desc: '中止子任务',                   args: '<id|all>',                  category: 'agents', executeLocal: true },
  { cmd: '/steer',      desc: '引导子任务',                   args: '<id> <msg>',                category: 'agents', executeLocal: false },
  { cmd: '/acp',        desc: '管理 ACP 会话',                args: '<action> [value]',          category: 'agents', executeLocal: false },
  // gateway
  { cmd: '/config',     desc: '查看或设置配置',               args: '<show|get|set|unset> [path] [value]', category: 'gateway', executeLocal: false },
  { cmd: '/mcp',        desc: '管理 MCP 服务器',              args: '<show|get|set|unset> [path] [value]', category: 'gateway', executeLocal: false },
  { cmd: '/plugins',    desc: '管理插件',                     args: '<list|show|enable|disable> [name]',   category: 'gateway', executeLocal: false },
  { cmd: '/debug',      desc: '设置运行时调试覆盖',           args: '<show|reset|set|unset> [path] [value]', category: 'gateway', executeLocal: false },
  { cmd: '/bash',       desc: '运行主机 Shell 命令',          args: '<command>',                 category: 'gateway', executeLocal: false },
  { cmd: '/tts',        desc: '控制文本转语音',               args: '<on|off|status|provider>',  category: 'gateway', executeLocal: false, argOptions: ['on','off','status','provider','limit','summary','audio','help'] },
  { cmd: '/approval',   desc: '管理执行审批请求',             category: 'gateway', executeLocal: false },
  { cmd: '/restart',    desc: '重启 OpenClaw 网关',           category: 'gateway', executeLocal: false },
  { cmd: '/queue',      desc: '调整队列设置',                 args: '<mode> [debounce] [cap]',   category: 'gateway', executeLocal: false },
  { cmd: '/allowlist',  desc: '管理执行白名单',               args: '[list|add|remove] [entry]', category: 'gateway', executeLocal: false },
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
  // Inline for short single-line args (≤80 chars), collapsible for longer
  const inlinePreview = args.replace(/\s+/g, ' ').slice(0, 80);
  const isShort = !args || args.length <= 80;

  if (isShort) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-white/40 rounded-lg border border-white/12 bg-white/5 px-3 py-1.5 max-w-full">
        <Wrench className="w-3 h-3 text-amber-500/70 shrink-0" />
        <span className="font-mono text-white/55">{name}</span>
        {args && <span className="text-white/25 font-mono truncate">{inlinePreview}</span>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/20 bg-white/8 text-xs overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-white/50 hover:bg-white/10 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Wrench className="w-3 h-3 shrink-0 text-amber-500" />
        <span className="font-mono">{name}</span>
        {!open && <span className="text-white/25 font-mono truncate ml-1">{inlinePreview}…</span>}
      </button>
      {open && args && (
        <pre className="px-3 py-2 text-white/70 overflow-x-auto leading-relaxed border-t border-white/20 whitespace-pre-wrap font-mono">
          {args}
        </pre>
      )}
    </div>
  );
}

function ThinkingBlock({ text, forceOpen }: { text: string; forceOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen ?? open;
  if (!text.trim()) return null;
  return (
    <div className="mt-1 rounded-lg border border-indigo-500/25 bg-indigo-500/8 text-xs overflow-hidden">
      <button
        onClick={() => !forceOpen && setOpen(v => !v)}
        className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-indigo-300 transition-colors text-left ${forceOpen ? 'cursor-default' : 'hover:bg-indigo-500/15'}`}
      >
        {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Brain className="w-3 h-3 shrink-0 opacity-60" />
        <span className="italic">思考过程</span>
        <span className="ml-auto text-indigo-400/50">{text.length > 0 ? `${text.length} chars` : ''}</span>
      </button>
      {isOpen && (
        <p className="px-3 py-2 text-indigo-200/70 leading-relaxed border-t border-indigo-500/20 whitespace-pre-wrap font-mono text-[11px]">
          {text}
        </p>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      onClick={handleCopy}
      title={copied ? '已复制' : '复制为 Markdown'}
      className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md text-white/30 hover:text-white/70 hover:bg-white/10 transition-all shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

  const handleSpeak = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  };

  return (
    <button
      onClick={handleSpeak}
      title={speaking ? '停止朗读' : '朗读消息'}
      className={`w-6 h-6 flex items-center justify-center rounded-md transition-all shrink-0 ${
        speaking
          ? 'opacity-100 text-indigo-400 bg-indigo-500/15'
          : 'opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 hover:bg-white/10'
      }`}
    >
      {speaking ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
    </button>
  );
}

function UsageBadge({ usage }: { usage: MessageUsage }) {
  const parts: React.ReactNode[] = [];
  if (usage.inputTokens)      parts.push(<span key="in">↑{fmtTokens(usage.inputTokens)}</span>);
  if (usage.outputTokens)     parts.push(<span key="out">↓{fmtTokens(usage.outputTokens)}</span>);
  if (usage.cacheReadTokens)  parts.push(<span key="cr" className="text-cyan-400/50">R{fmtTokens(usage.cacheReadTokens)}</span>);
  if (usage.cacheWriteTokens) parts.push(<span key="cw" className="text-violet-400/50">W{fmtTokens(usage.cacheWriteTokens)}</span>);
  if (parts.length === 0) return null;
  const modelShort = usage.model?.split('/').pop()?.replace(/^claude-/, '').split('-').slice(0, 2).join('-');
  return (
    <div className="flex items-center gap-2 text-[10px] text-white/25 pl-1 mt-0.5 font-mono">
      {parts.map((p, i) => <React.Fragment key={i}>{p}</React.Fragment>)}
      {modelShort && <span className="ml-1 text-white/20">{modelShort}</span>}
    </div>
  );
}

function ChatBubble({ role, content, showThinking, usage, agentName, isFirst = true, isLast = true, onDelete }: {
  role: 'user' | 'assistant'; content: any; showThinking: boolean; usage?: MessageUsage;
  agentName: string; isFirst?: boolean; isLast?: boolean; onDelete?: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const blocks = extractContent(content);
  const isUser = role === 'user';

  const textBlocks    = blocks.filter(b => b.kind === 'text')    as { kind: 'text'; text: string }[];
  const thinkingBlocks = blocks.filter(b => b.kind === 'thinking') as { kind: 'thinking'; text: string }[];
  const toolBlocks    = blocks.filter(b => b.kind === 'tool')    as { kind: 'tool'; name: string; args: string }[];

  const mainText = textBlocks.map(b => b.text).join('\n').trim();
  const displayText = mainText
    .replace(/^\[.*?\]\s*(\[Subagent .*?\]\s*)?(\[Subagent Task\]:?\s*)?/s, '')
    .trim() || mainText;

  const hasContent = displayText || toolBlocks.length > 0 || thinkingBlocks.length > 0;
  if (!hasContent) return null;

  // Avatar placeholder — keeps alignment even when hidden
  const avatar = (
    <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${
      isUser ? 'bg-indigo-500/30' : 'bg-white/10'
    } ${isFirst ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      {isUser ? <User className="w-3.5 h-3.5 text-indigo-300" /> : <Bot className="w-3.5 h-3.5 text-white/50" />}
    </div>
  );

  return (
    <div className={`flex gap-3 group w-full min-w-0 ${isUser ? 'flex-row-reverse' : ''}`}>
      {avatar}
      <div className={`max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1 min-w-0`}>
        {thinkingBlocks.length > 0 && thinkingBlocks.map((b, i) => (
          <ThinkingBlock key={i} text={b.text} forceOpen={showThinking || undefined} />
        ))}
        {displayText && (
          <div className={`rounded-2xl px-3.5 py-2.5 overflow-hidden w-full ${
            isUser
              ? `bg-indigo-600 text-white ${isFirst ? 'rounded-tr-sm' : ''}`
              : `bg-white/10 text-white/85 ${isFirst ? 'rounded-tl-sm' : ''}`
          }`}>
            {/* Both user and assistant messages use MarkdownBody so image paths render as <img> */}
            <MarkdownBody text={displayText} dim={!isUser && showThinking && thinkingBlocks.length > 0} />
          </div>
        )}
        {toolBlocks.map((b, i) => (
          <ToolBlock key={i} name={b.name} args={b.args} />
        ))}
        {/* Bottom row — usage / copy / delete (last bubble in group only) */}
        {isLast && (
          <div className={`flex items-center gap-1 ${isUser ? 'flex-row-reverse' : ''}`}>
            {!isUser && usage && <UsageBadge usage={usage} />}
            {!isUser && displayText && <CopyButton text={displayText} />}
            {!isUser && displayText && <SpeakButton text={displayText} />}
            {!isUser && displayText && <PdfButton text={displayText} agentName={agentName} />}
            {/* Delete button */}
            {onDelete && (
              confirmDel ? (
                <div className="flex items-center gap-1 text-[10px]">
                  <button onClick={() => { onDelete(); setConfirmDel(false); }}
                    className="px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/20 transition-colors">确认删除</button>
                  <button onClick={() => setConfirmDel(false)}
                    className="px-1.5 py-0.5 rounded text-white/30 hover:bg-white/10 transition-colors">取消</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDel(true)} title="删除消息"
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md text-white/25 hover:text-red-400 hover:bg-red-500/15 transition-all shrink-0">
                  <Trash2 className="w-3 h-3" />
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PdfButton({ text, agentName }: { text: string; agentName: string }) {
  const [generating, setGenerating] = useState(false);

  const generatePdf = async () => {
    if (generating) return;

    setGenerating(true);

    try {
      // Use html2canvas + jsPDF for Chinese character support
      const { default: jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;

      // Process the text to convert Markdown tables to proper HTML tables
      // This will ensure tables are rendered properly in the PDF
      let processedText = text;

      // Convert markdown tables to HTML tables
      // Find lines that look like markdown tables (contain | and --- separators)
      const lines = processedText.split('\n');
      let i = 0;
      const htmlLines = [];

      while (i < lines.length) {
        const line = lines[i];

        // Check if current line starts a markdown table
        if (line.trim().startsWith('|') && lines[i + 1] && lines[i + 1].trim().includes('|---')) {
          // Start collecting table lines
          const tableRows = [];

          // Add header row
          const headerRow = line.trim()
            .replace(/^\||\|$/g, '') // Remove leading/trailing pipes
            .split('|')
            .map(cell => cell.trim());

          // Add separator row (ignore for HTML)
          const separatorLine = lines[++i]; // Advance to separator line

          // Add data rows
          i++; // Move to first data row
          while (i < lines.length && lines[i].trim().startsWith('|')) {
            const dataRow = lines[i].trim()
              .replace(/^\||\|$/g, '') // Remove leading/trailing pipes
              .split('|')
              .map(cell => cell.trim());
            tableRows.push(dataRow);
            i++;
          }

          // Generate HTML table
          let htmlTable = '<table style="border-collapse: collapse; width: 100%; margin: 10px 0; border: 1px solid #ddd;">';

          // Add header
          htmlTable += '<thead><tr>';
          headerRow.forEach(header => {
            htmlTable += `<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">${DOMPurify.sanitize(header)}</th>`;
          });
          htmlTable += '</tr></thead>';

          // Add body
          htmlTable += '<tbody>';
          tableRows.forEach(row => {
            htmlTable += '<tr>';
            row.forEach(cell => {
              htmlTable += `<td style="border: 1px solid #ddd; padding: 8px;">${DOMPurify.sanitize(cell)}</td>`;
            });
            htmlTable += '</tr>';
          });
          htmlTable += '</tbody></table>';

          htmlLines.push(htmlTable);
        } else {
          // Regular line, convert markdown elements and add to HTML
          let convertedLine = line;

          // Convert markdown bold (**text**) to HTML
          convertedLine = convertedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          // Convert markdown italic (*text*) to HTML
          convertedLine = convertedLine.replace(/\*(.*?)\*/g, '<em>$1</em>');
          // Convert markdown inline code (`code`) to HTML
          convertedLine = convertedLine.replace(/`(.*?)`/g, '<code style="background-color: #eee; padding: 2px 4px; border-radius: 3px;">$1</code>');

          htmlLines.push(DOMPurify.sanitize(convertedLine));
          i++;
        }
      }

      // Create a temporary element with the content styled for print
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = `
        <div style="font-family: 'Microsoft YaHei', SimHei, sans-serif; padding: 20px; max-width: 100%;">
          <h2 style="font-size: 18px; margin-bottom: 10px;">${DOMPurify.sanitize(agentName || 'Chat Message')}</h2>
          <p style="font-size: 12px; color: #666; margin-bottom: 20px;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>
          <div style="font-size: 12px; line-height: 1.6; white-space: pre-wrap;">${htmlLines.join('<br>')}</div>
        </div>
      `;
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.width = '210mm'; // A4 width
      tempDiv.style.backgroundColor = 'white';
      tempDiv.style.fontFamily = "'Microsoft YaHei', SimHei, sans-serif";
      tempDiv.style.fontSize = '12px';
      document.body.appendChild(tempDiv);

      // Wait for any potential DOM updates before capturing
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(tempDiv, {
        scale: 2, // Better quality
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0
      });

      document.body.removeChild(tempDiv);

      const imgData = canvas.toDataURL('image/png', 0.9);
      const pdf = new jsPDF('p', 'mm', 'a4');

      // Calculate dimensions to fit the content
      const imgWidth = 210 - 20; // A4 width minus margins (170mm)
      const pageHeight = 297 - 20; // A4 height minus margins (277mm)
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Calculate how many pages we need
      const totalPages = Math.ceil(imgHeight / pageHeight);

      // Loop through and add content page by page with proper cropping
      for (let pageNo = 0; pageNo < totalPages; pageNo++) {
        if (pageNo !== 0) {
          pdf.addPage();
        }

        // Calculate which portion of the source image to use for this page
        // Convert from PDF mm to canvas pixels
        const sourceY = pageNo * pageHeight * (canvas.height / imgHeight);
        const sourceHeight = Math.min(pageHeight * (canvas.height / imgHeight), canvas.height - sourceY);

        // Create a temporary canvas to crop the image for this page
        const croppedCanvas = document.createElement('canvas');
        const croppedCtx = croppedCanvas.getContext('2d');

        croppedCanvas.width = canvas.width;
        croppedCanvas.height = sourceHeight;

        if (croppedCtx) {
          croppedCtx.drawImage(
            canvas,
            0, sourceY, canvas.width, sourceHeight,
            0, 0, canvas.width, sourceHeight
          );
        }

        const croppedImgData = croppedCanvas.toDataURL('image/png', 0.9);
        const displayHeight = (sourceHeight * imgWidth) / canvas.width;

        pdf.addImage(croppedImgData, 'PNG', 10, 10, imgWidth, displayHeight);
      }

      const cleanAgentName = (agentName || 'chat').replace(/[<>:"/\\|?*]/g, '_');
      const fileName = `${cleanAgentName}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
      pdf.save(fileName);
    } catch (error) {
      console.error('Failed to generate PDF:', error);

      // Show an error message to the user
      alert('PDF生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <button
      onClick={generatePdf}
      title={generating ? '生成中...' : '导出为 PDF'}
      className={`w-6 h-6 flex items-center justify-center rounded-md transition-all shrink-0 ${
        generating
          ? 'opacity-100 text-orange-400 bg-orange-500/15'
          : 'opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 hover:bg-white/10'
      }`}
      disabled={generating}
    >
      {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
    </button>
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

export function AgentChat({ agentId, agentName, workspace, onClose, autoSendMessage }: AgentChatProps) {
  // Session keys must use the gateway format: "agent:<agentId>:<scope>"
  // so the gateway can parse the agentId and route to the correct agent.
  const defaultSessionKey = `agent:${agentId}:main`;

  // ── session list ────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [inputExpanded, setInputExpanded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inputOverflows, setInputOverflows] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(defaultSessionKey);
  const [sessionModel, setSessionModel] = useState('');

  const sessionKey = activeKey;

  // ── chat state ───────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState('');

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState('');
  const [streamThinking, setStreamThinking] = useState('');
  const [showThinking, setShowThinking] = useState(false);
  const [sendError, setSendError] = useState('');
  const [contextPct, setContextPct] = useState<number | null>(null);

  // ── search ───────────────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [maximized, setMaximized] = useState(false);

  // ── deleted messages (soft-delete, localStorage) ──────────────────────────
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  // ── toast ────────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ text: string; ok?: boolean } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── voice: STT ───────────────────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // ── voice: TTS auto-speak ────────────────────────────────────────────────────
  const [autoTTS, setAutoTTS] = useState(false);
  const lastSpokenIdRef = useRef('');

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
  const streamThinkingRef = useRef('');
  const activeRunIdRef = useRef<string | null>(null);
  const preSendCountRef = useRef(0);
  const autoSentRef = useRef(false);
  // ── input history ─────────────────────────────────────────────────────────
  const inputHistoryRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const draftRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const cmdListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const showToast = (text: string, ok = false) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text, ok });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  };

  const handleDeleteMessage = (id: string) => {
    setDeletedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      saveDeletedIds(sessionKey, next);
      return next;
    });
  };

  // ── STT: start / stop listening ───────────────────────────────────────────────
  const inputBeforeMicRef = useRef('');
  const handleToggleMic = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { showToast('浏览器不支持语音输入'); return; }
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;
    inputBeforeMicRef.current = input;
    let finalTranscript = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInput(inputBeforeMicRef.current + (finalTranscript || interim));
    };
    rec.onend = () => {
      setIsListening(false);
      setInput(inputBeforeMicRef.current + finalTranscript);
    };
    rec.onerror = () => { setIsListening(false); showToast('语音识别出错，请重试'); };
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  };

  // ── load sessions ────────────────────────────────────────────────────────────
  useEffect(() => {
    setSessionsLoading(true);
    client.sessionsList({ agentId, limit: 50, includeLastMessage: true, includeDerivedTitles: true })
      .then(res => {
        const list: SessionMeta[] = (res?.sessions ?? []).sort((a: SessionMeta, b: SessionMeta) =>
          (b.updatedAt ?? '') > (a.updatedAt ?? '') ? 1 : -1
        ).map((s: SessionMeta) => {
          const saved = localStorage.getItem(`openclaw:session-title:${s.key}`);
          return saved ? { ...s, title: saved } : s;
        });
        setSessions(list);
        // Default to most recent session, fall back to agent-scoped default key
        setActiveKey(list.length > 0 ? list[0].key : defaultSessionKey);
      })
      .catch(() => setActiveKey(defaultSessionKey))
      .finally(() => setSessionsLoading(false));
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── load history when session changes ───────────────────────────────────────
  useEffect(() => {
    setSending(false);
    setRunId(null);
    setStreamText('');
    streamTextRef.current = '';
    activeRunIdRef.current = null;
    setSendError('');
    setShowSearch(false);
    setSearchQuery('');
    setDeletedIds(loadDeletedIds(sessionKey));

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
        // Each delta contains the FULL accumulated content — replace, not append
        const raw = message?.content ?? message?.text ?? '';
        let nextText = '';
        let nextThinking = '';
        if (typeof raw === 'string') {
          nextText = raw;
        } else if (Array.isArray(raw)) {
          nextText     = raw.filter((c: any) => c.type === 'text').map((c: any) => c.text ?? '').join('');
          nextThinking = raw.filter((c: any) => c.type === 'thinking').map((c: any) => c.thinking ?? '').join('');
        }
        if (!streamTextRef.current || nextText.length >= streamTextRef.current.length) {
          streamTextRef.current = nextText;
          setStreamText(nextText);
        }
        if (!streamThinkingRef.current || nextThinking.length >= streamThinkingRef.current.length) {
          streamThinkingRef.current = nextThinking;
          setStreamThinking(nextThinking);
        }
      } else if (state === 'final') {
        const content = message?.content ?? streamTextRef.current ?? '';
        // Extract usage data from payload
        const rawUsage = payload.usage ?? payload.tokenUsage ?? null;
        const usage: MessageUsage | undefined = rawUsage ? {
          inputTokens:      rawUsage.inputTokens      ?? rawUsage.input_tokens,
          outputTokens:     rawUsage.outputTokens     ?? rawUsage.output_tokens,
          cacheReadTokens:  rawUsage.cacheReadTokens  ?? rawUsage.cache_read_input_tokens,
          cacheWriteTokens: rawUsage.cacheWriteTokens ?? rawUsage.cache_creation_input_tokens,
          model:            rawUsage.model ?? payload.model,
        } : undefined;
        // Context usage percentage
        const ctxTokens = rawUsage?.contextTokens ?? rawUsage?.context_tokens;
        const ctxWindow  = rawUsage?.contextWindow  ?? rawUsage?.context_window;
        if (ctxTokens != null && ctxWindow != null && ctxWindow > 0) {
          setContextPct(Math.round(ctxTokens / ctxWindow * 100));
        }
        streamTextRef.current = '';
        streamThinkingRef.current = '';
        activeRunIdRef.current = null;
        setStreamText('');
        setStreamThinking('');
        setRunId(null);
        setSending(false);
        setMessages(prev => [...prev, { id: makeId(), role: 'assistant', content, usage }]);
        // Refresh sessions list to update last-message preview
        client.sessionsList({ agentId, limit: 50, includeLastMessage: true, includeDerivedTitles: true })
          .then(res => setSessions((res?.sessions ?? []).sort((a: SessionMeta, b: SessionMeta) =>
            (b.updatedAt ?? '') > (a.updatedAt ?? '') ? 1 : -1)))
          .catch(() => {});
      } else if (state === 'aborted' || state === 'error') {
        const savedContent = message?.content || streamTextRef.current || '';
        if (savedContent) {
          setMessages(prev => [...prev, { id: makeId(), role: 'assistant', content: savedContent }]);
        }
        streamTextRef.current = '';
        streamThinkingRef.current = '';
        activeRunIdRef.current = null;
        setStreamText('');
        setStreamThinking('');
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
    setMessages(prev => [...prev, { id: makeId(), role: 'user', content: autoSendMessage }]);
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

  // ── auto-TTS: speak new assistant messages ─────────────────────────────────
  useEffect(() => {
    if (!autoTTS || !('speechSynthesis' in window)) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.id === lastSpokenIdRef.current) return;
    lastSpokenIdRef.current = last.id;
    const raw = last.content;
    const text = (typeof raw === 'string' ? raw
      : Array.isArray(raw) ? raw.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('') : '').trim();
    if (!text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    window.speechSynthesis.speak(utter);
  }, [messages, autoTTS]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── textarea auto-grow (max 6 lines, expandable) ──────────────────────────────
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const maxH = lineHeight * 6;
    const expandedMaxH = Math.floor(window.innerHeight * 0.5);
    const overflows = el.scrollHeight > maxH;
    setInputOverflows(overflows);
    if (!overflows) setInputExpanded(false);
    el.style.height = Math.min(el.scrollHeight, inputExpanded ? expandedMaxH : maxH) + 'px';
  }, [input, inputExpanded]);

  // ── new session ───────────────────────────────────────────────────────────────
  const sendStartup = (key: string, cmd: '/new' | '/reset') => {
    preSendCountRef.current = 0;
    streamTextRef.current = '';
    streamThinkingRef.current = '';
    setStreamText('');
    setStreamThinking('');
    setSending(true);
    setSendError('');
    client.chatSend(key, cmd)
      .then(res => { activeRunIdRef.current = res.runId; setRunId(res.runId); })
      .catch((e: any) => { setSending(false); setSendError(e.message || 'Failed'); });
  };

  const handleNewSession = (withStartup = true) => {
    const newKey = `agent:${agentId}:web_${Date.now()}`;
    setSessions(prev => [{ key: newKey, derivedTitle: '新会话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...prev]);
    setActiveKey(newKey);
    setMessages([]);
    setInput('');
    setShowCmds(false);
    if (withStartup) {
      // slight delay so sessionKey state propagates before event listener re-mounts
      setTimeout(() => sendStartup(newKey, '/new'), 50);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // ── sync session model when active session changes ────────────────────────────
  useEffect(() => {
    const s = sessions.find(s => s.key === activeKey);
    setSessionModel(s?.model ?? '');
  }, [activeKey, sessions]);

  const handleModelChange = async (model: string) => {
    const prev = sessionModel;
    setSessionModel(model);
    try {
      await client.sessionsPatch(sessionKey, { model: model || null });
    } catch {
      setSessionModel(prev);
    }
  };

  // ── session rename / delete ───────────────────────────────────────────────────
  const handleSessionRename = (key: string, newTitle: string) => {
    setEditingSessionKey(null);
    if (!newTitle.trim()) return;
    try { localStorage.setItem(`openclaw:session-title:${key}`, newTitle.trim()); } catch {}
    setSessions(prev => prev.map(s => s.key === key ? { ...s, title: newTitle.trim() } : s));
  };

  const handleSessionDelete = async (key: string) => {
    if (!window.confirm('确认删除该会话？此操作不可恢复。')) return;
    try { localStorage.removeItem(`openclaw:session-title:${key}`); } catch {}
    try {
      await client.sessionsDelete(key);
    } catch {}
    setSessions(prev => {
      const next = prev.filter(s => s.key !== key);
      if (key === activeKey && next.length > 0) setActiveKey(next[0].key);
      return next;
    });
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
      case 'new':   handleNewSession(true); return null;
      case 'reset': {
        // Reset session context on gateway, then send /reset to trigger startup sequence
        try { await client.sessionsReset(sessionKey, 'reset'); } catch {}
        setMessages([]);
        setInput('');
        setShowCmds(false);
        sendStartup(sessionKey, '/reset');
        return null;
      }
      case 'clear': handleClear(); return null;
      case 'stop':  handleAbort(); return null;
      case 'focus': setFocusMode(v => !v); return null;
      case 'compact': {
        showToast('正在压缩上下文…');
        try {
          await client.sessionsCompact(sessionKey);
          showToast('上下文压缩完成 ✓', true);
        } catch (err: any) { showToast(`压缩失败: ${(err as any).message}`); }
        return null;
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
      case 'fast':
      case 'reasoning':
      case 'elevated': {
        try {
          if (!args) {
            const res = await client.sessionsList({ agentId, limit: 100 });
            const s = (res?.sessions ?? []).find((x: any) => x.key === sessionKey);
            const val = cmdName === 'think'     ? (s?.thinkingLevel ?? 'off')
              : cmdName === 'verbose'           ? (s?.verboseLevel ?? 'off')
              : cmdName === 'fast'              ? (s?.fastMode ? 'on' : 'off')
              : cmdName === 'reasoning'         ? (s?.reasoningLevel ?? 'off')
              :                                   (s?.elevatedLevel ?? 'off');
            const c = ALL_CMDS.find(x => x.cmd === `/${cmdName}`);
            return `Current **${cmdName}**: \`${val}\`\nOptions: ${c?.args ?? ''}`;
          }
          const a = args.trim();
          const patch = cmdName === 'think'     ? { thinkingLevel: a }
            : cmdName === 'verbose'             ? { verboseLevel: a }
            : cmdName === 'fast'                ? { fastMode: a === 'on' }
            : cmdName === 'reasoning'           ? { reasoningLevel: a }
            :                                     { elevatedLevel: a };
          await client.sessionsPatch(sessionKey, patch);
          return `**${cmdName}** set to \`${a}\`.`;
        } catch (err: any) { return `Failed: ${err.message}`; }
      }
      case 'activation': {
        try {
          if (!args) {
            const res = await client.sessionsList({ agentId, limit: 100 });
            const s = (res?.sessions ?? []).find((x: any) => x.key === sessionKey);
            return `Current **activation**: \`${s?.groupActivation ?? 'mention'}\`\nOptions: \`mention\` | \`always\``;
          }
          await client.sessionsPatch(sessionKey, { groupActivation: args.trim() });
          return `**activation** set to \`${args.trim()}\`.`;
        } catch (err: any) { return `Failed: ${err.message}`; }
      }
      case 'send': {
        try {
          if (!args) {
            const res = await client.sessionsList({ agentId, limit: 100 });
            const s = (res?.sessions ?? []).find((x: any) => x.key === sessionKey);
            return `Current **send policy**: \`${s?.sendPolicy ?? 'inherit'}\`\nOptions: \`on\` | \`off\` | \`inherit\``;
          }
          const a = args.trim();
          const sendPolicy = a === 'on' ? 'allow' : a === 'off' ? 'deny' : null;
          await client.sessionsPatch(sessionKey, { sendPolicy });
          return `**send** set to \`${a}\`.`;
        } catch (err: any) { return `Failed: ${err.message}`; }
      }
      case 'session': {
        try {
          const res = await client.sessionsList({ agentId, limit: 100, includeDerivedTitles: true });
          const s = (res?.sessions ?? []).find((x: any) => x.key === sessionKey);
          if (!s) return 'Session not found.';
          const lines = [
            `**Session Info**`,
            `Key: \`${s.key}\``,
            `Model: \`${s.model ?? 'default'}\``,
            `Think: \`${s.thinkingLevel ?? 'off'}\``,
            `Fast: \`${s.fastMode ? 'on' : 'off'}\``,
            `Verbose: \`${s.verboseLevel ?? 'off'}\``,
            `Reasoning: \`${s.reasoningLevel ?? 'off'}\``,
            `Elevated: \`${s.elevatedLevel ?? 'off'}\``,
            `Activation: \`${s.groupActivation ?? 'mention'}\``,
            `Send: \`${s.sendPolicy ?? 'inherit'}\``,
          ];
          if (s.inputTokens || s.outputTokens) {
            lines.push(`Tokens: \`${fmtTokens(s.inputTokens ?? 0)}\` in / \`${fmtTokens(s.outputTokens ?? 0)}\` out`);
          }
          return lines.join('\n');
        } catch (err: any) { return `Failed: ${err.message}`; }
      }
      case 'models': {
        try {
          const res = await client.modelsList();
          const models = res?.models ?? res ?? [];
          if (!models.length) return 'No models available.';
          const lines = [`**Available Models** (${models.length})`];
          let lastProvider = '';
          for (const m of models) {
            if (m.provider !== lastProvider) {
              lastProvider = m.provider;
              lines.push(`\n**${m.provider}**`);
            }
            const tags = [m.reasoning ? '🧠' : '', m.contextWindow ? `${fmtTokens(m.contextWindow)} ctx` : ''].filter(Boolean).join(' ');
            lines.push(`- \`${m.id}\` — ${m.name}${tags ? ' ' + tags : ''}`);
          }
          return lines.join('\n');
        } catch (err: any) { return `Failed to list models: ${err.message}`; }
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
      // Record in history
      const hist = inputHistoryRef.current;
      if (hist.length === 0 || hist[hist.length - 1] !== trimmed) {
        hist.push(trimmed);
        if (hist.length > 50) hist.shift();
      }
      historyIdxRef.current = -1;
      draftRef.current = '';
      // Send to agent as a regular message
      preSendCountRef.current = messages.length;
      setMessages(prev => [...prev, { id: makeId(), role: 'user', content: trimmed }]);
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
        setMessages(prev => [...prev, { id: makeId(), role: 'assistant', content: result }]);
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

  /** Compress any image to JPEG via Canvas (max 1920px, quality 0.85). Returns a JPEG data URL. */
  function compressImage(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width >= height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(dataUrl); // fallback: use original
      img.src = dataUrl;
    });
  }

  const addFilesAsAttachments = (files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') continue;
      const attId = `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // Always save as .jpg after compression (except PDFs)
      // Strip only characters invalid in filenames (path separators, control chars, etc.)
      // Chinese and other Unicode characters are preserved
      const stripInvalid = (s: string) => s.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').trim() || 'file';
      const baseName = stripInvalid(file.name.replace(/\.[^.]+$/, '')) || 'image';
      const safeName = file.type === 'application/pdf'
        ? stripInvalid(file.name)
        : `${baseName}.jpg`;
      const reader = new FileReader();
      reader.onload = async () => {
        const rawDataUrl = reader.result as string;
        // Show original as preview immediately
        setAttachments(prev => [...prev, { id: attId, dataUrl: rawDataUrl, mimeType: file.type, name: safeName, uploading: true }]);
        // Compress images via Canvas before uploading
        const uploadDataUrl = file.type.startsWith('image/')
          ? await compressImage(rawDataUrl)
          : rawDataUrl;
        // Upload to {workspace}/uploads/ (workspace from agent config)
        const uploadDir = workspace ? `${workspace}/uploads` : '~/.openclaw/uploads';
        const destPath = `${uploadDir}/${Date.now()}_${safeName}`;
        try {
          await client.writeFile(destPath, uploadDataUrl);
          setAttachments(prev => prev.map(a => a.id === attId ? { ...a, path: destPath, uploading: false } : a));
        } catch (e) {
          console.error('[attach] upload failed', e);
          setAttachments(prev => prev.map(a => a.id === attId ? { ...a, uploading: false } : a));
        }
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
    if ((!text && attachments.length === 0) || sending || attachments.some(a => a.uploading)) return;
    // Execute slash command — pass full input so args are preserved
    if (text.startsWith('/') && showCmds && filteredCmds.length > 0) {
      execCmd(text);
      return;
    }

    // Build path references for uploaded attachments
    const pendingAttachments = [...attachments];
    const pathRefs = pendingAttachments
      .filter(a => a.path)
      .map(a => `![${a.name}](${a.path})`)
      .join('\n');
    // When no text, use filenames as first line so message never starts with '!'
    // (Gateway interprets '!' prefix as a bash command)
    const textForSend = text || pendingAttachments.filter(a => a.path).map(a => a.name).join('、');
    const fullText = [textForSend, pathRefs].filter(Boolean).join('\n');
    if (!fullText.trim()) return;

    // Record in input history (deduplicated)
    if (text) {
      const hist = inputHistoryRef.current;
      if (hist.length === 0 || hist[hist.length - 1] !== text) {
        hist.push(text);
        if (hist.length > 50) hist.shift();
      }
      historyIdxRef.current = -1;
      draftRef.current = '';
    }
    preSendCountRef.current = messages.length;
    setMessages(prev => [...prev, { id: makeId(), role: 'user', content: fullText }]);
    setInput('');
    setAttachments([]);
    setShowCmds(false);
    setInputExpanded(false);
    setSending(true);
    setSendError('');
    streamTextRef.current = '';
    setStreamText('');

    try {
      const res = await client.chatSend(sessionKey, fullText);
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
    // ── Input history navigation ─────────────────────────────────────────────
    if (!showCmds) {
      if (e.key === 'ArrowUp') {
        const atStart = inputRef.current?.selectionStart === 0;
        const singleLine = !input.includes('\n');
        if (atStart && singleLine) {
          const hist = inputHistoryRef.current;
          if (hist.length === 0) return;
          e.preventDefault();
          if (historyIdxRef.current === -1) {
            draftRef.current = input;
            historyIdxRef.current = hist.length - 1;
          } else if (historyIdxRef.current > 0) {
            historyIdxRef.current--;
          }
          setInput(hist[historyIdxRef.current]);
          return;
        }
      }
      if (e.key === 'ArrowDown' && historyIdxRef.current !== -1) {
        e.preventDefault();
        const hist = inputHistoryRef.current;
        if (historyIdxRef.current < hist.length - 1) {
          historyIdxRef.current++;
          setInput(hist[historyIdxRef.current]);
        } else {
          historyIdxRef.current = -1;
          setInput(draftRef.current);
        }
        return;
      }
    }

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
  };

  // ── filtered + grouped messages ───────────────────────────────────────────────
  const visibleMessages = useMemo(() => {
    let msgs = messages.filter(m => !deletedIds.has(m.id));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      msgs = msgs.filter(m => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return text.toLowerCase().includes(q);
      });
    }
    return msgs;
  }, [messages, deletedIds, searchQuery]);

  interface MessageGroup { role: 'user' | 'assistant'; messages: ChatMessage[]; }
  const messageGroups = useMemo((): MessageGroup[] => {
    const groups: MessageGroup[] = [];
    for (const msg of visibleMessages) {
      const last = groups[groups.length - 1];
      if (last && last.role === msg.role) { last.messages.push(msg); }
      else { groups.push({ role: msg.role, messages: [msg] }); }
    }
    return groups;
  }, [visibleMessages]);

  const activeSession = sessions.find(s => s.key === sessionKey);
  const sessionTitle = sessionLabel(activeSession ?? { key: sessionKey });

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className={`fixed inset-0 z-50 ${maximized ? '' : 'bg-black/50 backdrop-blur-sm flex items-center justify-center p-4'}`}>
      <div className={`relative glass-heavy flex flex-col overflow-hidden ${maximized ? 'w-full h-full rounded-none' : 'rounded-2xl w-full max-w-4xl h-[85vh]'}`}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/30 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4 text-indigo-300" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-white text-sm">{agentName}</span>
            <span className="text-white/40 text-xs ml-2 truncate hidden sm:inline">{sessionTitle}</span>
          </div>
          <button
            onClick={() => setMaximized(v => !v)}
            title={maximized ? '还原窗口' : '最大化窗口'}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors shrink-0"
          >
            {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowThinking(v => !v)}
            title={showThinking ? '当前：思考模式 — 点击切换到工作输出' : '当前：工作输出 — 点击切换到思考过程'}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
              showThinking ? 'text-indigo-300 bg-indigo-500/20' : 'text-white/40 hover:text-white/70 hover:bg-white/10'
            }`}
          >
            <Brain className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAutoTTS(v => {
              if (v) window.speechSynthesis?.cancel();
              return !v;
            })}
            title={autoTTS ? '关闭自动朗读' : '开启自动朗读'}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
              autoTTS ? 'text-indigo-300 bg-indigo-500/20' : 'text-white/40 hover:text-white/70 hover:bg-white/10'
            }`}
          >
            <Volume2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => exportConversation(agentName, activeKey, messages)}
            title="导出会话（Markdown + 资源）"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors shrink-0"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setShowSearch(v => !v); if (showSearch) setSearchQuery(''); }}
            title="搜索消息"
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
              showSearch ? 'text-indigo-300 bg-indigo-500/20' : 'text-white/40 hover:text-white/70 hover:bg-white/10'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="px-4 py-2 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2 bg-white/8 rounded-lg px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-white/30 shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索消息…"
                className="flex-1 bg-transparent text-sm text-white placeholder-white/30 focus:outline-none"
                onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); } }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-white/30 hover:text-white/60 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {searchQuery && (
              <p className="text-[10px] text-white/30 mt-1 px-1">{visibleMessages.length} 条结果</p>
            )}
          </div>
        )}

        {/* Body: sidebar + chat */}
        <div className="flex flex-1 min-h-0">

          {/* Session sidebar — hidden in focus mode */}
          <div className={`shrink-0 border-r border-white/10 flex flex-col transition-all duration-200 ${focusMode ? 'hidden' : ''} ${sidebarCollapsed ? 'w-8' : 'w-48'}`}>
            <div className="px-3 py-2 border-b border-white/8 flex items-center gap-1 min-w-0">
              {!sidebarCollapsed && <span className="text-[10px] font-medium text-white/40 uppercase tracking-wider flex-1 truncate">会话列表</span>}
              <button
                onClick={() => setSidebarCollapsed(v => !v)}
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
                title={sidebarCollapsed ? '展开会话列表' : '折叠会话列表'}
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${sidebarCollapsed ? '-rotate-90' : 'rotate-90'}`} />
              </button>
            </div>
            <div className={`flex-1 overflow-y-auto ${sidebarCollapsed ? 'hidden' : ''}`}>
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-white/40 text-center py-6 px-3">暂无会话</p>
              ) : (
                sessions.map(s => {
                  const title = (s as any).title ?? sessionLabel(s);
                  const date = formatDate(s.updatedAt ?? s.createdAt);
                  const isActive = s.key === sessionKey;
                  const isEditing = editingSessionKey === s.key;
                  return (
                    <div
                      key={s.key}
                      className={`group relative border-b border-white/8 ${
                        isActive
                          ? 'bg-indigo-500/15 border-l-2 border-l-indigo-400'
                          : 'border-l-2 border-l-transparent hover:bg-white/8'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1 px-2 py-2">
                          <input
                            autoFocus
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSessionRename(s.key, editingTitle);
                              if (e.key === 'Escape') setEditingSessionKey(null);
                            }}
                            onBlur={() => handleSessionRename(s.key, editingTitle)}
                            className="flex-1 min-w-0 bg-white/10 text-white text-xs px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                          <button
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => handleSessionRename(s.key, editingTitle)}
                            className="shrink-0 text-indigo-300 hover:text-white"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setActiveKey(s.key)}
                          className="w-full text-left px-3 py-2.5 pr-14"
                        >
                          <p className={`text-xs font-medium truncate ${isActive ? 'text-indigo-300' : 'text-white/80'}`}>
                            {title}
                          </p>
                          {date && <p className="text-[10px] text-white/40 mt-0.5">{date}</p>}
                        </button>
                      )}
                      {!isEditing && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                          <button
                            onClick={e => { e.stopPropagation(); setEditingTitle(title); setEditingSessionKey(s.key); }}
                            className="w-5 h-5 flex items-center justify-center text-white/40 hover:text-white/80 rounded transition-colors"
                            title="重命名"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleSessionDelete(s.key); }}
                            className="w-5 h-5 flex items-center justify-center text-white/40 hover:text-red-400 rounded transition-colors"
                            title="删除会话"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-white/10 p-2 space-y-1.5">
              {!sidebarCollapsed && (
                <ModelSelect
                  value={sessionModel}
                  onChange={handleModelChange}
                  placeholder="默认模型"
                  disabled={sending}
                  upward
                />
              )}
              <button
                onClick={() => handleNewSession(true)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-white/40 hover:text-indigo-300 hover:bg-indigo-500/15 rounded-lg transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
                title="新建会话"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                {!sidebarCollapsed && '新建会话'}
              </button>
            </div>
          </div>

          {/* Chat panel */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Messages */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 space-y-4">
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
              ) : visibleMessages.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Search className="w-8 h-8 text-white/20 mb-3" />
                  <p className="text-sm text-white/40">无匹配结果</p>
                </div>
              ) : (
                messageGroups.map((group, gi) =>
                  group.messages.map((msg, mi) => (
                    <ChatBubble
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      showThinking={showThinking}
                      usage={msg.usage}
                      agentName={agentName}
                      isFirst={mi === 0}
                      isLast={mi === group.messages.length - 1}
                      onDelete={() => handleDeleteMessage(msg.id)}
                    />
                  ))
                )
              )}

              {/* Streaming bubble */}
              {(streamText || streamThinking) && (
                <div className="flex gap-3 w-full min-w-0">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 bg-white/10">
                    <Bot className="w-3.5 h-3.5 text-white/50" />
                  </div>
                  <div className="max-w-[78%] flex flex-col gap-1 min-w-0">
                    {/* Thinking stream */}
                    {streamThinking && (
                      <div className={`rounded-lg border border-indigo-500/25 bg-indigo-500/8 px-3.5 py-2.5 text-[11px] font-mono text-indigo-200/70 leading-relaxed whitespace-pre-wrap transition-opacity ${showThinking ? 'opacity-100' : 'opacity-40'}`}>
                        <div className="flex items-center gap-1.5 mb-1.5 text-indigo-300 text-xs">
                          <Brain className="w-3 h-3" />
                          <span className="italic">思考中…</span>
                        </div>
                        {streamThinking}
                        <span className="inline-block w-0.5 h-3 bg-indigo-400/60 ml-0.5 align-middle animate-pulse" />
                      </div>
                    )}
                    {/* Text stream */}
                    {streamText && (
                      <div className="bg-white/10 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-white/85">
                        <MarkdownBody text={streamText} dim={showThinking && !!streamThinking} />
                        {!streamThinking && <span className="inline-block w-0.5 h-3.5 bg-white/50 ml-0.5 align-middle animate-pulse" />}
                      </div>
                    )}
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

            {/* Context usage warning */}
            {contextPct !== null && contextPct >= 85 && (
              <div className="px-5 py-1.5 shrink-0 border-t border-white/8">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-mono shrink-0 ${contextPct >= 95 ? 'text-red-400' : 'text-amber-400'}`}>
                    上下文 {contextPct}%
                  </span>
                  <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${contextPct >= 95 ? 'bg-red-400' : 'bg-amber-400'}`}
                      style={{ width: `${Math.min(contextPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-white/30 shrink-0">建议 /compact</span>
                </div>
              </div>
            )}

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
                        className={`w-16 h-16 object-cover rounded-lg border border-white/20 ${att.uploading ? 'opacity-50' : ''}`}
                      />
                      {att.uploading && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                        </div>
                      )}
                      {att.path && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-green-400 text-center rounded-b-lg px-1 truncate">✓</div>
                      )}
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
                className="relative flex items-end gap-2 border border-white/20 rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-white/40 focus-within:border-white/40 transition-all"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
              >
                {(inputOverflows || inputExpanded) && (
                  <button
                    type="button"
                    onClick={() => setInputExpanded(v => !v)}
                    className="absolute right-2 top-2 w-5 h-5 flex items-center justify-center text-white/30 hover:text-white/70 transition-colors z-10"
                    title={inputExpanded ? '收起' : '展开'}
                  >
                    {inputExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-300 hover:bg-white/10 transition-colors shrink-0 disabled:opacity-40"
                  title="附加图片"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleToggleMic}
                  disabled={sending}
                  title={isListening ? '停止录音' : '语音输入'}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors shrink-0 disabled:opacity-40 ${
                    isListening
                      ? 'text-red-400 bg-red-500/15 animate-pulse'
                      : 'text-white/40 hover:text-indigo-300 hover:bg-white/10'
                  }`}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  disabled={sending}
                  placeholder="输入消息… (/ 查看命令 · 可粘贴图片)"
                  rows={1}
                  className="flex-1 resize-none text-sm text-white placeholder-white/40 focus:outline-none leading-relaxed bg-transparent disabled:opacity-60"
                  style={{ overflowY: 'auto' }}
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
                    disabled={(!input.trim() && attachments.length === 0) || attachments.some(a => a.uploading)}
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

        {/* Toast overlay */}
        {toast && (
          <div className={`absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl shadow-xl text-xs font-medium z-20 whitespace-nowrap pointer-events-none transition-all ${
            toast.ok
              ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
              : 'bg-white/10 border border-white/15 text-white/70'
          }`}>
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}
