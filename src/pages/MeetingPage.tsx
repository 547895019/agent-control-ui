import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { client } from '../api/gateway';
import { AgentChat } from '../components/agents/AgentChat';
import { fillTemplate } from '../utils/template';
import meetingHostPromptTemplate from '../templates/meeting-host-prompt.md?raw';
import {
  Users, Plus, Loader2, CheckCircle2, ChevronDown, ChevronRight,
  Trash2, RotateCcw,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MeetingRecord {
  id: string;
  title: string;
  topic: string;
  hostId: string;
  hostName: string;
  participantIds: string[];
  status: 'running' | 'done' | 'error';
  createdAt: string;
  result: string;
  sessionKey: string;  // unique per meeting, never reused
  channel?: { channelId: string; target: string };  // optional channel delivery
  prompt?: string;  // custom prompt set at creation time (may be user-edited)
}

// ── Constants ──────────────────────────────────────────────────────────────────

const LS_KEY = 'openclaw:meetings';
const MAX_RECORDS = 50;

function buildHostPrompt(
  topic: string,
  participants: Array<{ id: string; name: string }>,
  channel?: { channelId: string; target: string },
): string {
  const list = participants
    .map(p => `- Agent ID: \`${p.id}\`（${p.name}）`)
    .join('\n');

  const channelSection = channel
    ? `## 发送频道\n会议结束后，请通过 ${CHANNEL_LABELS[channel.channelId] ?? channel.channelId} 频道将最终结论发送给 ${channel.target}。`
    : '';

  return fillTemplate(meetingHostPromptTemplate, { topic, list, channelSection }).trimEnd();
}

// ── Channel helpers ────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '📱', telegram: '✈️', discord: '🎮', slack: '💼', signal: '🔒',
  googlechat: '💬', imessage: '🍎', nostr: '⚡', email: '📧', sms: '📲',
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord',
  slack: 'Slack', signal: 'Signal', googlechat: 'Google Chat',
  imessage: 'iMessage', nostr: 'Nostr', email: 'Email', sms: 'SMS',
};

const CHANNEL_TARGET_PLACEHOLDER: Record<string, string> = {
  telegram: '@username 或频道 ID',
  whatsapp: '手机号（含国际区号）',
  discord: '频道 ID',
  slack: '#频道名称',
  email: '邮件地址',
  signal: '手机号（含国际区号）',
  sms: '手机号',
};

// ── localStorage helpers ───────────────────────────────────────────────────────

function loadMeetings(): MeetingRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveMeetings(records: MeetingRecord[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
}

function upsertMeeting(record: MeetingRecord) {
  const all = loadMeetings();
  const idx = all.findIndex(r => r.id === record.id);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  saveMeetings(all);
}

function deleteMeetingFromStore(id: string) {
  saveMeetings(loadMeetings().filter(r => r.id !== id));
}

// ── Avatar helpers ─────────────────────────────────────────────────────────────

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

// ── Org grouping helpers ───────────────────────────────────────────────────────

interface AgentGroup {
  orgName: string;
  orgColor?: string;
  teams: Array<{
    teamName: string;
    teamColor?: string;
    agents: Array<[string, any]>;
  }>;
}

function buildAgentGroups(
  agentList: Array<[string, any]>,
  excludeId: string,
): { groups: AgentGroup[]; ungrouped: Array<[string, any]> } {
  let orgsIndex: { orgs: any[] } = { orgs: [] };
  try { orgsIndex = JSON.parse(localStorage.getItem('openclaw_orgs_index') ?? '{}') ?? { orgs: [] }; } catch {}

  // agentId → { orgName, orgColor, teamName, teamColor }
  const agentMap = new Map<string, { orgName: string; orgColor?: string; teamName: string; teamColor?: string }>();
  for (const orgEntry of orgsIndex.orgs ?? []) {
    let cfg: any = null;
    try { cfg = JSON.parse(localStorage.getItem(`openclaw_org_${orgEntry.id}`) ?? 'null'); } catch {}
    if (!cfg) continue;
    const orgName = cfg.company?.name || orgEntry.name;
    for (const team of cfg.teams ?? []) {
      for (const member of team.members ?? []) {
        agentMap.set(member.agentId, { orgName, orgColor: orgEntry.color, teamName: team.name, teamColor: team.color });
      }
    }
  }

  const available = agentList.filter(([id]) => id !== excludeId);
  const groupMap = new Map<string, { orgColor?: string; teams: Map<string, { teamColor?: string; agents: Array<[string, any]> }> }>();
  const ungrouped: Array<[string, any]> = [];

  for (const entry of available) {
    const info = agentMap.get(entry[0]);
    if (!info) { ungrouped.push(entry); continue; }
    if (!groupMap.has(info.orgName)) groupMap.set(info.orgName, { orgColor: info.orgColor, teams: new Map() });
    const og = groupMap.get(info.orgName)!;
    if (!og.teams.has(info.teamName)) og.teams.set(info.teamName, { teamColor: info.teamColor, agents: [] });
    og.teams.get(info.teamName)!.agents.push(entry);
  }

  const groups: AgentGroup[] = Array.from(groupMap.entries()).map(([orgName, { orgColor, teams }]) => ({
    orgName, orgColor,
    teams: Array.from(teams.entries()).map(([teamName, { teamColor, agents }]) => ({ teamName, teamColor, agents })),
  }));

  return { groups, ungrouped };
}

function formatRelTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

// ── AgentToggleCard ───────────────────────────────────────────────────────────

function AgentToggleCard({
  id, cfg, selected, onToggle,
}: { id: string; cfg: any; selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-left w-full ${
        selected
          ? 'bg-indigo-500/20 border-indigo-400/40 text-white'
          : 'glass border-white/10 text-white/60 hover:text-white hover:border-white/20'
      }`}
    >
      <div className={`w-6 h-6 rounded-lg ${getAvatarColor(id)} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
        {getInitials(id, cfg.name)}
      </div>
      <span className="text-xs font-medium truncate flex-1">{cfg.name || id}</span>
      {selected && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
    </button>
  );
}

// ── MeetingSetupForm ──────────────────────────────────────────────────────────

function MeetingSetupForm({ onStart }: { onStart: (record: MeetingRecord) => void }) {
  const { agents } = useAppStore();
  const agentList = Object.entries(agents);

  const [topic, setTopic] = useState('');
  const [hostId, setHostId] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);

  // Channel state
  const [channelId, setChannelId] = useState('');
  const [channelTarget, setChannelTarget] = useState('');
  const [availableChannels, setAvailableChannels] = useState<Array<{ id: string }>>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

  useEffect(() => {
    setChannelsLoading(true);
    client.channelsStatus({ timeoutMs: 8000 })
      .then((snap: any) => {
        const channels = snap?.channels ?? {};
        const accounts = snap?.channelAccounts ?? {};
        const all = new Set([...Object.keys(channels), ...Object.keys(accounts)]);
        const connected = [...all].filter(id => {
          const s = channels[id];
          const accs = accounts[id] ?? [];
          return s?.configured || s?.running || s?.connected || s?.linked
            || accs.some((a: any) => a.configured || a.running || a.connected || a.linked);
        });
        setAvailableChannels(connected.map(id => ({ id })));
      })
      .catch(() => setAvailableChannels([]))
      .finally(() => setChannelsLoading(false));
  }, []);

  useEffect(() => {
    setParticipantIds(prev => prev.filter(p => p !== hostId));
  }, [hostId]);

  const toggleParticipant = (id: string) => {
    setParticipantIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const toggleTeam = (teamAgents: Array<[string, any]>) => {
    const ids = teamAgents.map(([id]) => id);
    const allSelected = ids.every(id => participantIds.includes(id));
    setParticipantIds(prev =>
      allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    );
  };

  const canStart = topic.trim().length > 0 && hostId && participantIds.length > 0;

  const previewChannel = (channelId && channelTarget.trim())
    ? { channelId, target: channelTarget.trim() }
    : undefined;

  const previewPrompt = (topic && hostId && participantIds.length > 0)
    ? buildHostPrompt(topic.trim(), participantIds.map(id => ({ id, name: agents[id]?.name || id })), previewChannel)
    : '填写主题、发起人和参会人后预览…';

  // Keep editedPrompt in sync with auto-generated prompt when user hasn't manually edited
  useEffect(() => {
    if (!promptDirty) {
      setEditedPrompt(previewPrompt);
    }
  }, [previewPrompt, promptDirty]);

  const handleStart = () => {
    if (!canStart) return;
    const id = `mtg_${Date.now()}`;
    const finalPrompt = promptDirty ? editedPrompt : previewPrompt;
    const record: MeetingRecord = {
      id,
      title: topic.slice(0, 30),
      topic: topic.trim(),
      hostId,
      hostName: agents[hostId]?.name || hostId,
      participantIds,
      status: 'running',
      createdAt: new Date().toISOString(),
      result: '',
      sessionKey: `agent:${hostId}:mtg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      prompt: finalPrompt,
      ...(channelId && channelTarget.trim() ? { channel: { channelId, target: channelTarget.trim() } } : {}),
    };
    upsertMeeting(record);
    onStart(record);
  };

  const { groups, ungrouped } = buildAgentGroups(agentList, hostId);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-indigo-300" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-sm">发起新会议</h2>
            <p className="text-white/40 text-xs">发起人 Agent 协调子代理并汇总结论</p>
          </div>
        </div>
        <button
          onClick={handleStart}
          disabled={!canStart}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white btn-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg"
        >
          <Users className="w-3.5 h-3.5" />
          发起会议
        </button>
      </div>

      {/* Body: two columns */}
      <div className="flex-1 grid grid-cols-2 divide-x divide-white/10 overflow-hidden min-h-0">

        {/* Left: topic + host + preview */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs text-white/50 font-medium uppercase tracking-wide">会议主题</label>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="请输入会议主题或讨论问题…"
              rows={5}
              className="w-full bg-white/8 border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-white/50 font-medium uppercase tracking-wide">发起人（负责协调与汇总）</label>
            {agentList.length === 0 ? (
              <p className="text-white/30 text-sm">暂无可用 Agent</p>
            ) : (
              <select
                value={hostId}
                onChange={e => setHostId(e.target.value)}
                className="w-full bg-white/8 border border-white/15 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-400/60 appearance-none cursor-pointer"
              >
                <option value="" className="bg-gray-900">— 选择发起人 —</option>
                {agentList.map(([id, cfg]) => (
                  <option key={id} value={id} className="bg-gray-900">{cfg.name || id}</option>
                ))}
              </select>
            )}
          </div>

          {/* Channel delivery */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-white/50 font-medium uppercase tracking-wide flex-1">
                发送到频道（可选）
              </label>
              {channelsLoading && <Loader2 className="w-3 h-3 text-white/30 animate-spin" />}
            </div>

            {!channelsLoading && availableChannels.length === 0 && (
              <p className="text-xs text-white/25">暂无已连接频道</p>
            )}

            {availableChannels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => { setChannelId(''); setChannelTarget(''); }}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                    !channelId
                      ? 'bg-white/12 border-white/25 text-white/70'
                      : 'border-white/8 text-white/30 hover:text-white/50 hover:border-white/15'
                  }`}
                >
                  不发送
                </button>
                {availableChannels.map(({ id }) => (
                  <button
                    key={id}
                    onClick={() => { setChannelId(id); setChannelTarget(''); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                      channelId === id
                        ? 'bg-indigo-500/20 border-indigo-400/40 text-white'
                        : 'glass border-white/10 text-white/50 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <span>{CHANNEL_ICONS[id] ?? '🔌'}</span>
                    {CHANNEL_LABELS[id] ?? id}
                  </button>
                ))}
              </div>
            )}

            {channelId && (
              <input
                value={channelTarget}
                onChange={e => setChannelTarget(e.target.value)}
                placeholder={CHANNEL_TARGET_PLACEHOLDER[channelId] ?? '发送目标'}
                className="w-full bg-white/8 border border-white/15 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all"
              />
            )}
          </div>

          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs">
              <button
                onClick={() => setShowPreview(v => !v)}
                className="flex items-center gap-2 text-white/40 hover:text-white/60 transition-colors flex-1 text-left"
              >
                {showPreview ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                发送给发起人的提示词{promptDirty ? <span className="text-amber-400/70">（已编辑）</span> : <span className="text-white/25">预览</span>}
              </button>
              {promptDirty && (
                <button
                  onClick={() => { setEditedPrompt(previewPrompt); setPromptDirty(false); }}
                  className="flex items-center gap-1 text-white/30 hover:text-white/60 transition-colors shrink-0"
                  title="重置为自动生成的提示词"
                >
                  <RotateCcw className="w-3 h-3" />
                  重置
                </button>
              )}
            </div>
            {showPreview && (
              <textarea
                value={editedPrompt}
                onChange={e => { setEditedPrompt(e.target.value); setPromptDirty(true); }}
                rows={10}
                className="w-full px-3.5 py-3 text-[11px] text-white/70 font-mono border-t border-white/10 leading-relaxed bg-white/3 resize-y focus:outline-none focus:bg-white/5 transition-colors"
                placeholder="填写主题、发起人和参会人后预览…"
              />
            )}
          </div>
        </div>

        {/* Right: participants grouped by org/team */}
        <div className="p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs text-white/50 font-medium uppercase tracking-wide">
              参会子代理
            </label>
            {participantIds.length > 0 && (
              <span className="text-xs text-indigo-300 font-medium">{participantIds.length} 已选</span>
            )}
          </div>

          {agentList.length === 0 ? (
            <p className="text-white/30 text-sm">暂无可用 Agent</p>
          ) : groups.length === 0 && ungrouped.length === 0 ? (
            <p className="text-white/30 text-sm">{!hostId ? '请先选择发起人' : '没有其他可用 Agent'}</p>
          ) : (
            <div className="space-y-5">
              {/* Grouped by org → team */}
              {groups.map(({ orgName, orgColor, teams }) => (
                <div key={orgName}>
                  {/* Org header */}
                  <div className="flex items-center gap-2 mb-2.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: orgColor ?? '#6366f1' }}
                    />
                    <span className="text-xs font-semibold text-white/70 tracking-wide">{orgName}</span>
                  </div>

                  <div className="space-y-3 pl-4">
                    {teams.map(({ teamName, teamColor, agents: teamAgents }) => {
                      const teamIds = teamAgents.map(([id]) => id);
                      const allSel = teamIds.length > 0 && teamIds.every(id => participantIds.includes(id));
                      const someSel = teamIds.some(id => participantIds.includes(id));
                      return (
                        <div key={teamName}>
                          {/* Team header */}
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-sm shrink-0"
                                style={{ background: teamColor ?? '#8b5cf6' }}
                              />
                              <span className="text-xs text-white/50 font-medium">{teamName}</span>
                            </div>
                            <button
                              onClick={() => toggleTeam(teamAgents)}
                              className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                                allSel
                                  ? 'text-indigo-300 bg-indigo-500/20 hover:bg-indigo-500/30'
                                  : someSel
                                  ? 'text-white/40 bg-white/8 hover:bg-white/12'
                                  : 'text-white/30 bg-white/5 hover:bg-white/10 hover:text-white/50'
                              }`}
                            >
                              {allSel ? '取消全选' : '全选'}
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {teamAgents.map(([id, cfg]) => (
                              <AgentToggleCard
                                key={id}
                                id={id}
                                cfg={cfg}
                                selected={participantIds.includes(id)}
                                onToggle={() => toggleParticipant(id)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Ungrouped */}
              {ungrouped.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-white/20" />
                    <span className="text-xs font-semibold text-white/40 tracking-wide">未分配</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pl-4">
                    {ungrouped.map(([id, cfg]) => (
                      <AgentToggleCard
                        key={id}
                        id={id}
                        cfg={cfg}
                        selected={participantIds.includes(id)}
                        onToggle={() => toggleParticipant(id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MeetingRunner ─────────────────────────────────────────────────────────────

function MeetingRunner({
  meeting: initialMeeting,
  agents,
  onDone,
  onOpenChat,
}: {
  meeting: MeetingRecord;
  agents: Record<string, any>;
  onDone: (updated: MeetingRecord) => void;
  onOpenChat: (agentId: string) => void;
}) {
  // Use the stored sessionKey (generated fresh at meeting creation time).
  // Fallback for records created before this field was added.
  const sessionKey = initialMeeting.sessionKey
    ?? `agent:${initialMeeting.hostId}:meeting_${initialMeeting.id}`;

  const [streamText, setStreamText] = useState(initialMeeting.result);
  const [done, setDone] = useState(initialMeeting.status !== 'running');
  const streamTextRef = useRef(initialMeeting.result);
  const meetingRef = useRef(initialMeeting);

  useEffect(() => {
    if (initialMeeting.status !== 'running') return;

    const unsub = client.onEvent((event: any) => {
      if (event.event !== 'chat') return;
      const payload = event.payload ?? event.data ?? event;
      if (payload.sessionKey !== sessionKey) return;

      const { state, message } = payload;
      const raw = message?.content ?? message?.text ?? '';
      const text = typeof raw === 'string' ? raw
        : Array.isArray(raw) ? raw.map((c: any) => c.text ?? '').join('') : '';

      if (state === 'delta') {
        if (!streamTextRef.current || text.length >= streamTextRef.current.length) {
          streamTextRef.current = text;
          setStreamText(text);
        }
      } else if (state === 'final') {
        const finalText = streamTextRef.current || text;
        streamTextRef.current = finalText;
        setStreamText(finalText);
        setDone(true);
        const updated = { ...meetingRef.current, result: finalText, status: 'done' as const };
        meetingRef.current = updated;
        upsertMeeting(updated);
        onDone(updated);
      } else if (state === 'aborted' || state === 'error') {
        setDone(true);
        const updated = { ...meetingRef.current, result: streamTextRef.current, status: 'error' as const };
        meetingRef.current = updated;
        upsertMeeting(updated);
        onDone(updated);
      }
    });
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialMeeting.status !== 'running') return;
    const participants = initialMeeting.participantIds.map(id => ({
      id,
      name: agents[id]?.name || id,
    }));
    const prompt = initialMeeting.prompt
      || buildHostPrompt(initialMeeting.topic, participants, initialMeeting.channel);
    client.chatSend(sessionKey, prompt).catch(() => {
      setDone(true);
      const updated = { ...meetingRef.current, status: 'error' as const };
      meetingRef.current = updated;
      upsertMeeting(updated);
      onDone(updated);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hostName = agents[initialMeeting.hostId]?.name || initialMeeting.hostId;

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-white font-semibold text-base leading-snug">
            {initialMeeting.title || initialMeeting.topic.slice(0, 30)}
          </h3>
          <p className="text-white/40 text-xs mt-0.5">
            {new Date(initialMeeting.createdAt).toLocaleString('zh-CN')}
          </p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${
          done && initialMeeting.status !== 'error' ? 'bg-emerald-500/20 text-emerald-300'
          : done ? 'bg-red-500/20 text-red-300'
          : 'bg-indigo-500/20 text-indigo-300'
        }`}>
          {done && initialMeeting.status !== 'error' ? '已完成' : done ? '出错' : '进行中'}
        </span>
      </div>

      {/* Topic */}
      <div className="glass rounded-xl px-4 py-3">
        <p className="text-xs text-white/40 mb-1 font-medium">会议主题</p>
        <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{initialMeeting.topic}</p>
      </div>

      {/* Participant tags */}
      <div className="flex flex-wrap gap-2">
        {initialMeeting.participantIds.map(pid => {
          const name = agents[pid]?.name || pid;
          return (
            <button
              key={pid}
              onClick={done ? () => onOpenChat(pid) : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full glass border border-white/10 text-xs text-white/60 transition-colors ${
                done ? 'hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:text-white cursor-pointer' : 'cursor-default'
              }`}
            >
              <div className={`w-4 h-4 rounded ${getAvatarColor(pid)} flex items-center justify-center text-white text-[8px] font-bold`}>
                {getInitials(pid, name)}
              </div>
              {name}
            </button>
          );
        })}
      </div>

      {/* Host output */}
      <div className="glass-heavy rounded-xl p-4 space-y-3">
        <div
          onClick={done ? () => onOpenChat(initialMeeting.hostId) : undefined}
          className={`flex items-center gap-2.5 rounded-lg -m-1 p-1 transition-colors ${
            done ? 'hover:bg-white/8 cursor-pointer' : ''
          }`}
        >
          <div className={`w-8 h-8 rounded-lg ${getAvatarColor(initialMeeting.hostId)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
            {getInitials(initialMeeting.hostId, hostName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">{hostName}</p>
            <p className="text-[11px] text-white/40">
              {done ? '主持人 · 点击继续对话' : '主持人 · 正在协调各子代理…'}
            </p>
          </div>
          {done
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            : <Loader2 className="w-4 h-4 text-indigo-300 animate-spin shrink-0" />
          }
        </div>

        {streamText ? (
          <p className="font-mono text-xs text-white/75 whitespace-pre-wrap leading-relaxed">
            {streamText}
            {!done && (
              <span className="inline-block w-0.5 h-3 bg-white/40 ml-0.5 align-middle animate-pulse" />
            )}
          </p>
        ) : !done ? (
          <div className="flex items-center gap-1.5 py-2">
            <span className="w-1.5 h-1.5 bg-indigo-400/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-indigo-400/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-indigo-400/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : null}
      </div>

      {/* Channel info tag */}
      {initialMeeting.channel && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl glass border border-white/10 text-xs text-white/40">
          <span>{CHANNEL_ICONS[initialMeeting.channel.channelId] ?? '🔌'}</span>
          <span>{CHANNEL_LABELS[initialMeeting.channel.channelId] ?? initialMeeting.channel.channelId}</span>
          <span className="text-white/20">→</span>
          <span className="font-mono text-white/50">{initialMeeting.channel.target}</span>
          <span className="ml-auto text-white/25">已含在提示词中</span>
        </div>
      )}

    </div>
  );
}

// ── MeetingPage ───────────────────────────────────────────────────────────────

export function MeetingPage() {
  const { agents } = useAppStore();
  const [meetings, setMeetings] = useState<MeetingRecord[]>(() =>
    loadMeetings().reverse()
  );
  const [activeMeeting, setActiveMeeting] = useState<MeetingRecord | null>(null);
  const [view, setView] = useState<'setup' | 'runner'>('setup');
  const [chatAgent, setChatAgent] = useState<{ id: string } | null>(null);

  const refreshMeetings = useCallback(() => {
    setMeetings(loadMeetings().reverse());
  }, []);

  const handleStart = (record: MeetingRecord) => {
    setActiveMeeting(record);
    setView('runner');
    refreshMeetings();
  };

  const handleDone = (updated: MeetingRecord) => {
    setActiveMeeting(updated);
    refreshMeetings();
  };

  const handleDelete = (id: string) => {
    deleteMeetingFromStore(id);
    refreshMeetings();
    if (activeMeeting?.id === id) {
      setActiveMeeting(null);
      setView('setup');
    }
  };

  const handleOpenChat = (agentId: string) => {
    setChatAgent({ id: agentId });
  };

  return (
    <div className="h-full flex">
      {/* Left sidebar */}
      <aside className="w-52 shrink-0 border-r border-white/10 flex flex-col glass">
        <div className="px-3 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wider">会议记录</span>
          <button
            onClick={() => { setActiveMeeting(null); setView('setup'); }}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-white/40 hover:text-indigo-300 hover:bg-indigo-500/20 transition-colors"
            title="新建会议"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {meetings.length === 0 ? (
            <p className="text-xs text-white/30 text-center py-8 px-3">暂无记录</p>
          ) : (
            meetings.map(m => {
              const isActive = activeMeeting?.id === m.id;
              return (
                <div
                  key={m.id}
                  className={`relative group border-b border-white/8 border-l-2 transition-colors ${
                    isActive ? 'bg-indigo-500/15 border-l-indigo-400' : 'hover:bg-white/8 border-l-transparent'
                  }`}
                >
                  <button
                    onClick={() => { setActiveMeeting(m); setView('runner'); }}
                    className="w-full text-left px-3 py-2.5 pr-8"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        m.status === 'done' ? 'bg-emerald-400'
                        : m.status === 'error' ? 'bg-red-400'
                        : 'bg-indigo-400 animate-pulse'
                      }`} />
                      <p className={`text-xs font-medium truncate ${isActive ? 'text-indigo-300' : 'text-white/80'}`}>
                        {m.title || m.topic.slice(0, 20)}
                      </p>
                    </div>
                    <p className="text-[10px] text-white/30 pl-3">{formatRelTime(m.createdAt)}</p>
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-white/0 group-hover:text-white/30 hover:!text-red-400 hover:bg-red-500/15 transition-colors"
                    title="删除记录"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="p-2 border-t border-white/10">
          <button
            onClick={() => { setActiveMeeting(null); setView('setup'); }}
            className="w-full flex items-center justify-center gap-2 py-1.5 text-xs text-white/40 hover:text-indigo-300 hover:bg-indigo-500/15 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新建会议
          </button>
        </div>
      </aside>

      {/* Right content */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {view === 'setup' || !activeMeeting ? (
          <MeetingSetupForm onStart={handleStart} />
        ) : (
          <MeetingRunner
            key={activeMeeting.id}
            meeting={activeMeeting}
            agents={agents}
            onDone={handleDone}
            onOpenChat={handleOpenChat}
          />
        )}
      </main>

      {/* AgentChat modal */}
      {chatAgent && (
        <AgentChat
          agentId={chatAgent.id}
          agentName={agents[chatAgent.id]?.name || chatAgent.id}
          workspace={agents[chatAgent.id]?.workspace || ''}
          onClose={() => setChatAgent(null)}
        />
      )}
    </div>
  );
}
