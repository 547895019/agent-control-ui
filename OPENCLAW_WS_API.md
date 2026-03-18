# OpenClaw Gateway WebSocket API

本文档描述 OpenClaw Gateway 的 WebSocket 接口协议，基于实际对接经验整理，供前端客户端使用。

---

## 目录

1. [连接信息](#1-连接信息)
2. [消息帧格式](#2-消息帧格式)
3. [握手认证流程](#3-握手认证流程)
4. [设备密钥与签名](#4-设备密钥与签名)
5. [RPC 调用方法](#5-rpc-调用方法)
6. [服务端事件](#6-服务端事件)
7. [错误码](#7-错误码)
8. [配置管理实践](#8-配置管理实践)
9. [完整对接示例](#9-完整对接示例)

---

## 1. 连接信息

| 项目 | 值 |
|------|-----|
| 默认地址 | `ws://127.0.0.1:18789` |
| 协议 | WebSocket (RFC 6455) |
| 数据格式 | JSON (UTF-8 文本帧) |
| 当前协议版本 | `minProtocol: 3, maxProtocol: 3` |

---

## 2. 消息帧格式

### 2.1 请求帧 (Client → Server)

```json
{
  "type": "req",
  "id": "req_1_1700000000000",
  "method": "config.get",
  "params": {}
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"req"` | 固定值 |
| `id` | `string` | 请求唯一 ID，用于匹配响应 |
| `method` | `string` | RPC 方法名 |
| `params` | `object` | 方法参数（不接受额外字段，schema 严格校验） |

### 2.2 响应帧 (Server → Client)

成功响应：
```json
{
  "type": "res",
  "id": "req_1_1700000000000",
  "ok": true,
  "payload": { ... }
}
```

错误响应：
```json
{
  "type": "res",
  "id": "req_1_1700000000000",
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "invalid config.patch params: must have required property 'raw'",
    "retryable": false
  }
}
```

### 2.3 事件帧 (Server → Client)

```json
{
  "type": "event",
  "event": "chat",
  "payload": { ... }
}
```

> **注意：** 事件名在 `event` 字段，不是 `event.event`（如聊天事件是 `"chat"` 而非 `"chat.event"`）。

---

## 3. 握手认证流程

### 流程概览

```
Client                              Server
  |                                   |
  |-- WebSocket Connect ------------->|
  |<-- { event: "connect.challenge" } |  服务端主动推送 challenge
  |                                   |
  |-- { type:"req", method:"connect"} |  客户端签名后发送连接请求
  |<-- { type:"res", ok:true,         |
  |      payload:{type:"hello-ok"} }  |  连接成功
  |                                   |
  |-- { type:"req", method:"..." } -->|  正常 RPC 调用
  |<-- { type:"res", ... } ----------|
```

### 3.1 Challenge 事件 (Server → Client)

WebSocket 连接建立后，服务端立即推送（注意是 `event` 帧，不是 `res` 帧）：

```json
{
  "event": "connect.challenge",
  "payload": {
    "nonce": "58e8f803-3b54-4c6f-a11c-b8eafd8ce4c7",
    "ts": 1773814450494
  }
}
```

### 3.2 Connect 请求 (Client → Server)

客户端收到 challenge 后，发送标准 RPC 请求（`method: "connect"`）：

```json
{
  "type": "req",
  "id": "connect_1700000000000",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "openclaw-control-ui",
      "version": "1.0.0",
      "platform": "web",
      "mode": "webchat"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write", "operator.admin"],
    "caps": [],
    "commands": [],
    "permissions": {},
    "auth": { "token": "YOUR_OPERATOR_TOKEN" },
    "locale": "zh-CN",
    "userAgent": "openclaw-web-ui/1.0.0",
    "device": {
      "id": "DEVICE_ID_HEX",
      "publicKey": "BASE64URL_ED25519_PUBLIC_KEY",
      "signature": "BASE64URL_SIGNATURE",
      "signedAt": 1773814450500,
      "nonce": "58e8f803-3b54-4c6f-a11c-b8eafd8ce4c7"
    }
  }
}
```

**合法的 `client.id` 值：**
```
"cli" | "webchat" | "webchat-ui" | "openclaw-control-ui" |
"gateway-client" | "openclaw-macos" | "openclaw-ios" |
"openclaw-android" | "node-host" | "test" | "fingerprint" | "openclaw-probe"
```

**合法的 `client.mode` 值：**
```
"node" | "cli" | "ui" | "webchat" | "test" | "backend" | "probe"
```

### 3.3 Hello-OK 响应 (Server → Client)

认证成功后，服务端以标准 RPC 响应格式回复（`payload.type === "hello-ok"`）：

```json
{
  "type": "res",
  "id": "connect_1700000000000",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": { "version": "1.x.x", "connId": "conn_abc" }
  }
}
```

认证失败时 `ok: false`，`error.message` 包含失败原因。

---

## 4. 设备密钥与签名

### 4.1 生成 Ed25519 密钥对并持久化

```typescript
const STORAGE_KEY = 'openclaw_web_device_v1';

async function initDeviceKeys() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    const privateKey = await crypto.subtle.importKey(
      'jwk', parsed.privateKeyJwk,
      { name: 'Ed25519' } as any, false, ['sign']
    );
    return { deviceId: parsed.deviceId, publicKey: parsed.publicKeyB64, privateKey };
  }

  // 生成新密钥对
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' } as any, true, ['sign', 'verify']
  );
  const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as any;
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey) as any;

  // Device ID = SHA-256(原始公钥字节) 转十六进制
  const pubBytes = base64urlToBytes(pubJwk.x);
  const hash = await crypto.subtle.digest('SHA-256', pubBytes);
  const deviceId = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    deviceId,
    publicKeyB64: pubJwk.x,   // 公钥 base64url
    privateKeyJwk: privJwk,
  }));
  return { deviceId, publicKey: pubJwk.x, privateKey: keyPair.privateKey };
}
```

> **注意：** 公钥使用 JWK 的 `x` 字段（原始 base64url 编码的 32 字节），Device ID 是该字节的 SHA-256 十六进制串。

### 4.2 V3 签名载荷格式

字段用 `|` 拼接，`scopes` 用 `,` 拼接：

```
v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}
```

**示例：**
```
v3|abc123...hex|openclaw-control-ui|webchat|operator|operator.read,operator.write,operator.admin|1773814450500|token_xxx|58e8f803-...|web|
```

### 4.3 执行签名

```typescript
const payloadStr = [
  'v3',
  deviceId,
  'openclaw-control-ui',                               // client.id
  'webchat',                                           // client.mode
  'operator',                                          // role
  'operator.read,operator.write,operator.admin',       // scopes (逗号分隔)
  String(signedAt),
  token,
  nonce,
  'web',                                               // platform
  '',                                                  // deviceFamily (可为空)
].join('|');

const signature = bytesToBase64url(new Uint8Array(
  await crypto.subtle.sign({ name: 'Ed25519' } as any, privateKey,
    new TextEncoder().encode(payloadStr))
));
```

### 4.4 辅助函数

```typescript
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
```

---

## 5. RPC 调用方法

### 5.1 配置管理

#### `config.get`

获取当前配置快照。

- **Params:** `{}` （严格，不接受额外字段）
- **Response:**
  ```json
  {
    "hash": "sha256_hex_of_config",
    "config": { "agents": { "list": [...] }, ... },
    "raw": "yaml or json5 string",
    "parsed": { ... },
    "resolved": { "agents": { "list": [...] }, ... }
  }
  ```

| 字段 | 说明 |
|------|------|
| `hash` | 配置哈希，用于 `config.patch` / `config.apply` 的乐观并发控制 |
| `config` | 原始配置对象（用户显式设置的值，无默认值填充） |
| `resolved` | 完整解析后的配置（含默认值和环境变量替换） |

> **Agent 列表：** 展示用 `resolved.agents.list`；写回配置时用 `config.agents.list`（避免将默认值写回）。

#### `config.patch`

**增量合并**修改配置，写入磁盘并重启生效。

- **Params:**
  ```json
  {
    "raw": "{\"agents\":{\"list\":[{\"id\":\"my-agent\",\"name\":\"My Agent\",\"workspace\":\"/path\"}]}}",
    "baseHash": "来自 config.get 的 hash 字段"
  }
  ```
  - `raw`：部分配置的 **JSON 字符串**（不是对象！）
  - `baseHash`：乐观并发控制，hash 不匹配时报错 `"config changed since last load"`

- **合并规则（mergeObjectArraysById）：**
  - 数组通过 `id` 字段匹配，可新增和更新列表项
  - 无法直接删除数组项（见 [8. 配置管理实践](#8-配置管理实践)）
  - 将某个键设为 `null` 会删除该键

- **Response:** `{ "ok": true, "config": { ... }, "hash": "..." }`

#### `config.apply`

将**完整配置**写入磁盘并重启生效。

> **重要：** `config.apply` 的 `raw` 是完整配置，不是增量补丁。增量更新请使用 `config.patch`。

- **Params:**
  ```json
  {
    "raw": "{完整配置的 JSON 字符串}",
    "baseHash": "来自 config.get 的 hash 字段"
  }
  ```

#### `config.set`

完整替换配置（不重启）。

- **Params:** `{ "raw": "...", "baseHash": "..." }`

---

### 5.2 Agent 管理

> **注意：** Gateway 没有 `agents.create` / `agents.update` / `agents.delete` 方法。Agent 的增删改均通过 `config.patch` 操作配置文件实现。

#### `agents.list`

列出所有已配置的 Agent。

- **Params:** `{}`
- **Response:**
  ```json
  {
    "defaultId": "default",
    "agents": [
      {
        "id": "frontend",
        "name": "Frontend Dev",
        "workspace": "/path/to/workspace",
        "model": "kimi-coding/k2p5",
        "identity": { "name": "Frontend Dev" }
      }
    ]
  }
  ```

**AgentEntry 可写字段（schema 严格，不支持额外字段）：**

```
id, default, name, workspace, agentDir, model, skills, memorySearch,
humanDelay, heartbeat, identity, groupChat, subagents, sandbox,
params, tools, runtime
```

> **不支持的字段：** `enabled`、`description`（写入会报 `Unrecognized key`）。

---

### 5.3 Agent 文件管理

#### `agents.files.get`

获取 Agent 工作区中的指定文件（IDENTITY.md、AGENTS.md 等）。

- **Params:** `{ "agentId": "frontend", "name": "IDENTITY.md" }`
- **Response:** `{ "agentId": "...", "workspace": "...", "file": { "name": "...", "content": "...", "size": 1234 } }`

#### `agents.files.set`

写入 Agent 工作区文件。

- **Params:** `{ "agentId": "frontend", "name": "IDENTITY.md", "content": "# Frontend Dev\n..." }`
- **Response:** `{ "ok": true }`

---

### 5.4 会话管理

#### `sessions.list`

列出会话列表。按 `agent:<agentId>:*` 格式过滤（见 [会话键格式](#会话键格式)）。

- **Params:**
  ```json
  {
    "agentId": "frontend",
    "limit": 50,
    "includeDerivedTitles": true,
    "includeLastMessage": true
  }
  ```
- **Response:**
  ```json
  {
    "sessions": [
      {
        "key": "agent:frontend:main",
        "title": "User specified title",
        "derivedTitle": "Auto-derived title",
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-02T00:00:00Z",
        "model": "kimi-coding/k2p5",
        "inputTokens": 1234,
        "outputTokens": 567,
        "fastMode": false,
        "thinkingLevel": "off",
        "verboseLevel": "off"
      }
    ],
    "defaults": { "model": "kimi-coding/k2p5" }
  }
  ```

#### `sessions.patch`

修改会话级别的参数（不重启 Agent）。

- **Params:**
  ```json
  {
    "key": "agent:frontend:main",
    "model": "kimi-coding/k2p5",
    "thinkingLevel": "low",
    "verboseLevel": "off",
    "fastMode": false
  }
  ```
- **Response:** `{ "resolved": { "model": "...", ... } }`

#### `sessions.compact`

压缩会话上下文（减少 token 占用）。

- **Params:** `{ "key": "agent:frontend:main" }`
- **Response:** `{ "ok": true }`

---

### 5.5 聊天

#### 会话键格式

会话键格式为 `agent:<agentId>:<scope>`，Gateway 通过此格式路由到对应 Agent：

```
agent:frontend:main       ← 主会话
agent:frontend:web_xxx    ← 自定义会话（任意 scope 字符串）
```

> **错误示例：** `main::frontend`、`frontend:main` 等格式无法被正确解析，会导致路由到默认 Agent。

#### `chat.send`

向 Agent 发送消息（异步，响应通过 `chat` 事件流式推送）。

- **Params:**
  ```json
  {
    "sessionKey": "agent:frontend:main",
    "message": "帮我写一个 React 组件",
    "idempotencyKey": "web_1700000000000_abc123",
    "deliver": true,
    "attachments": [
      {
        "type": "image",
        "mimeType": "image/png",
        "content": "BASE64_ENCODED_IMAGE_DATA"
      }
    ]
  }
  ```
  > `attachments` 中 `content` 为纯 base64（不含 `data:image/png;base64,` 前缀）。

- **Response:** 立即返回 `{ "runId": "run_abc123" }`，流式内容通过 `chat` 事件推送。

#### `chat.history`

获取会话历史消息。

- **Params:** `{ "sessionKey": "agent:frontend:main", "limit": 200 }`
- **Response:**
  ```json
  {
    "messages": [
      {
        "role": "user",
        "content": "帮我写一个 React 组件",
        "timestamp": 1700000000000
      },
      {
        "role": "assistant",
        "content": [
          { "type": "text", "text": "好的，这是一个..." },
          { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
        ],
        "timestamp": 1700000001000
      }
    ]
  }
  ```

#### `chat.abort`

中止正在进行的对话。

- **Params:** `{ "sessionKey": "agent:frontend:main", "runId": "run_abc123" }`
- **Response:** `{ "aborted": true }`

---

### 5.6 模型列表

#### `models.list`

获取可用模型列表。

- **Params:** `{}`
- **Response:**
  ```json
  {
    "models": [
      {
        "id": "kimi-coding/k2p5",
        "name": "Kimi K2P5",
        "provider": "moonshot",
        "contextWindow": 128000
      }
    ]
  }
  ```

---

### 5.7 日志

#### `logs.tail`

增量拉取日志。

- **Params:** `{ "cursor": 0, "limit": 100, "maxBytes": 65536 }`
- **Response:**
  ```json
  {
    "cursor": 4096,
    "size": 4096,
    "lines": ["[INFO] ...", "[DEBUG] ..."],
    "truncated": false
  }
  ```
  将返回的 `cursor` 传入下次请求实现增量拉取。

---

### 5.8 通道状态

#### `channels.status`

获取消息通道（微信、Slack 等）连接状态。

- **Params:** `{ "probe": false }`
- **Response:** 包含各通道账号状态的对象。

---

## 6. 服务端事件

### `chat` — 聊天流式事件

> **注意：** 事件名是 `"chat"`，不是 `"chat.event"`。

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "run_abc123",
    "sessionKey": "agent:frontend:main",
    "seq": 5,
    "state": "delta",
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    }
  }
}
```

**`state` 取值：**

| state | 说明 |
|-------|------|
| `"delta"` | 流式增量（**每个 delta 包含迄今为止的完整文本**，替换而非追加）|
| `"final"` | 响应完成 |
| `"aborted"` | 被中止 |
| `"error"` | 发生错误 |

> **Delta 处理：** `message.content` 每次是**累积全文**（replace），不是新增片段（append）。

**处理示例：**
```typescript
client.onEvent((event) => {
  if (event.event !== 'chat') return;
  const { state, message, sessionKey } = event.payload;
  if (sessionKey !== activeSessionKey) return;

  if (state === 'delta') {
    const text = typeof message.content === 'string'
      ? message.content
      : message.content?.map((c: any) => c.text ?? '').join('') ?? '';
    // 替换（非追加）当前流式文本
    if (!streamText || text.length >= streamText.length) {
      setStreamText(text);
    }
  } else if (state === 'final') {
    setMessages(prev => [...prev, { role: 'assistant', content: streamText }]);
    setStreamText('');
  }
});
```

### `tick` — 心跳

```json
{ "type": "event", "event": "tick", "payload": { "ts": 1700000000000 } }
```

### `shutdown` — 服务关闭通知

```json
{
  "type": "event",
  "event": "shutdown",
  "payload": { "reason": "restart", "restartExpectedMs": 3000 }
}
```

---

## 7. 错误码

| 错误码 | 说明 |
|--------|------|
| `INVALID_REQUEST` | 请求参数校验失败（schema 严格校验，不允许额外字段）|
| `NOT_LINKED` | 客户端未连接到 Gateway |
| `NOT_PAIRED` | 设备未配对 |
| `AGENT_TIMEOUT` | Agent 操作超时 |
| `UNAVAILABLE` | 服务或方法不可用 |
| `AUTH_FAILED` | 认证失败 |

**常见错误信息：**

| 错误信息 | 原因 | 解决方法 |
|----------|------|----------|
| `must have required property 'raw'` | `config.patch`/`config.apply` 未传 `raw` | 传入 JSON 字符串 |
| `config base hash required` | 未传 `baseHash` | 先调用 `config.get` 获取 hash |
| `config changed since last load` | `baseHash` 过期 | 重新 `config.get` 获取最新 hash |
| `Unrecognized key: 'enabled'` | AgentEntry 不支持该字段 | 删除该字段 |
| `at root: unexpected property 'ops'` | `config.patch` 格式错误 | 使用 `{ raw, baseHash }` 格式 |

---

## 8. 配置管理实践

### 新增/更新 Agent

```typescript
// 1. 获取当前 hash
const cfg = await client.rpc('config.get', {});
const baseHash = cfg.hash;

// 2. 用 config.patch 合并（mergeObjectArraysById 按 id 匹配）
await client.rpc('config.patch', {
  raw: JSON.stringify({
    agents: {
      list: [{
        id: 'my-agent',
        name: 'My Agent',
        workspace: '/path/to/workspace',
        model: 'kimi-coding/k2p5',
        subagents: { allowAgents: ['*'] },
        tools: { profile: 'full' },
        // 不要加 enabled/description，schema 严格校验
      }]
    }
  }),
  baseHash,
});
```

### 删除 Agent

`mergeObjectArraysById` 无法删除数组项，需要两步操作：

```typescript
const cfg = await client.rpc('config.get', {});
const baseHash = cfg.hash;

// 从 config（原始配置，非 resolved）读取列表
const currentList = cfg.config?.agents?.list ?? [];
const filteredList = currentList.filter((a: any) => a.id !== targetId);

// 第一步：将 list 置 null（删除键）
await client.rpc('config.patch', {
  raw: JSON.stringify({ agents: { list: null } }),
  baseHash,
});

// 第二步：重新设置过滤后的列表（此时 list 键不存在，直接赋值）
const cfg2 = await client.rpc('config.get', {});
await client.rpc('config.patch', {
  raw: JSON.stringify({ agents: { list: filteredList } }),
  baseHash: cfg2.hash,
});
```

### config.patch vs config.apply 区别

| 方法 | `raw` 含义 | 合并方式 | 触发重启 |
|------|-----------|---------|---------|
| `config.patch` | **部分配置**（增量补丁）| `mergeObjectArraysById` 深度合并 | 是 |
| `config.apply` | **完整配置**（全量替换）| 直接替换整个配置文件 | 是 |
| `config.set` | **完整配置**（全量替换）| 直接替换整个配置文件 | 否 |

> 日常 Agent 增删改用 `config.patch`；`config.apply` 用于从配置编辑器提交完整配置。

---

## 9. 完整对接示例

```typescript
const WS_URL = 'ws://127.0.0.1:18789';
const TOKEN = 'your_operator_token';

class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private reqId = 0;
  private deviceKeys: { deviceId: string; publicKey: string; privateKey: CryptoKey } | null = null;
  private eventHandlers: ((e: any) => void)[] = [];

  onEvent(handler: (e: any) => void) {
    this.eventHandlers.push(handler);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);

      this.ws.onmessage = async (e) => {
        const msg = JSON.parse(e.data);

        // RPC 响应
        if (msg.type === 'res' && msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.ok) resolve(msg.payload);
          else reject(new Error(msg.error?.message ?? 'RPC error'));

          // 连接成功
          if (msg.ok && msg.payload?.type === 'hello-ok') resolve();
          return;
        }

        // Challenge → 触发握手
        if (msg.event === 'connect.challenge') {
          await this.handleChallenge(msg.payload).catch(reject);
          return;
        }

        // 服务端事件
        if (msg.type === 'event') {
          this.eventHandlers.forEach(h => h(msg));
        }
      };

      this.ws.onerror = () => reject(new Error('WebSocket error'));
      this.ws.onclose = () => {/* 重连逻辑 */};
    });
  }

  private async handleChallenge(challenge: { nonce: string; ts: number }) {
    const keys = await this.getDeviceKeys();
    const signedAt = Date.now();
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];

    const payloadStr = [
      'v3', keys.deviceId, 'openclaw-control-ui', 'webchat',
      'operator', scopes.join(','), String(signedAt),
      TOKEN, challenge.nonce, 'web', ''
    ].join('|');

    const sig = await crypto.subtle.sign(
      { name: 'Ed25519' } as any, keys.privateKey,
      new TextEncoder().encode(payloadStr)
    );

    this.ws!.send(JSON.stringify({
      type: 'req',
      id: `connect_${Date.now()}`,
      method: 'connect',
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'openclaw-control-ui', version: '1.0.0', platform: 'web', mode: 'webchat' },
        role: 'operator',
        scopes,
        caps: [], commands: [], permissions: {},
        auth: { token: TOKEN },
        locale: 'zh-CN',
        userAgent: 'openclaw-web-ui/1.0.0',
        device: {
          id: keys.deviceId,
          publicKey: keys.publicKey,
          signature: bytesToBase64url(new Uint8Array(sig)),
          signedAt,
          nonce: challenge.nonce,
        },
      },
    }));
  }

  async rpc(method: string, params: any = {}): Promise<any> {
    const id = `req_${++this.reqId}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('RPC timeout'));
        }
      }, 10000);
    });
  }

  private async getDeviceKeys() {
    if (this.deviceKeys) return this.deviceKeys;
    const stored = localStorage.getItem('openclaw_web_device_v1');
    if (stored) {
      const p = JSON.parse(stored);
      const privateKey = await crypto.subtle.importKey(
        'jwk', p.privateKeyJwk, { name: 'Ed25519' } as any, false, ['sign']
      );
      return this.deviceKeys = { deviceId: p.deviceId, publicKey: p.publicKeyB64, privateKey };
    }
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' } as any, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey) as any;
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey) as any;
    const hash = await crypto.subtle.digest('SHA-256', base64urlToBytes(pub.x));
    const deviceId = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('openclaw_web_device_v1', JSON.stringify({
      deviceId, publicKeyB64: pub.x, privateKeyJwk: priv
    }));
    return this.deviceKeys = { deviceId, publicKey: pub.x, privateKey: kp.privateKey as CryptoKey };
  }
}

// ── 使用示例 ──────────────────────────────────────────────────────────────────

const client = new OpenClawClient();
await client.connect();

// 订阅聊天事件
client.onEvent((msg) => {
  if (msg.event !== 'chat') return;
  const { state, message, sessionKey } = msg.payload;
  if (state === 'delta') {
    // message.content 是累积全文（替换，不追加）
    const text = typeof message.content === 'string' ? message.content
      : (message.content ?? []).map((c: any) => c.text ?? '').join('');
    console.log('streaming:', text);
  } else if (state === 'final') {
    console.log('done');
  }
});

// 获取 Agent 列表（resolved 含默认值，config 是原始值）
const cfg = await client.rpc('config.get', {});
const agentList = cfg.resolved?.agents?.list ?? [];

// 新增 Agent（通过 config.patch 增量合并）
await client.rpc('config.patch', {
  raw: JSON.stringify({
    agents: {
      list: [{
        id: 'my-agent',
        name: 'My Agent',
        workspace: '/home/user/.openclaw/workspaces/my-agent',
        model: 'kimi-coding/k2p5',
        subagents: { allowAgents: ['*'] },
        tools: { profile: 'full' },
      }]
    }
  }),
  baseHash: cfg.hash,
});

// 发送消息（session key 格式必须是 agent:<id>:<scope>）
const { runId } = await client.rpc('chat.send', {
  sessionKey: 'agent:my-agent:main',
  message: 'Hello!',
  idempotencyKey: `web_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  deliver: true,
});
```

---

## 附录：辅助函数

```typescript
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
```
