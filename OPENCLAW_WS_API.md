# OpenClaw Gateway WebSocket API

本文档描述 OpenClaw Gateway 的 WebSocket 接口协议，供前端客户端对接使用。

---

## 目录

1. [连接信息](#1-连接信息)
2. [消息帧格式](#2-消息帧格式)
3. [握手认证流程](#3-握手认证流程)
4. [设备密钥与签名](#4-设备密钥与签名)
5. [RPC 调用方法](#5-rpc-调用方法)
6. [服务端事件](#6-服务端事件)
7. [错误码](#7-错误码)
8. [完整对接示例](#8-完整对接示例)

---

## 1. 连接信息

| 项目 | 值 |
|------|-----|
| 默认地址 | `ws://127.0.0.1:18789` |
| 协议 | WebSocket (RFC 6455) |
| 数据格式 | JSON (UTF-8 文本帧) |
| 支持协议版本 | `minProtocol: 1`, `maxProtocol: 5` |

---

## 2. 消息帧格式

所有 WebSocket 消息均为 JSON 对象，分三种帧类型：

### 2.1 请求帧 (Client → Server)

```json
{
  "type": "req",
  "id": "abc123",
  "method": "config.get",
  "params": {}
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"req"` | 固定值 |
| `id` | `string` | 请求唯一 ID，用于匹配响应 |
| `method` | `string` | RPC 方法名 |
| `params` | `object` | 方法参数（可为空对象） |

### 2.2 响应帧 (Server → Client)

```json
{
  "type": "res",
  "id": "abc123",
  "ok": true,
  "payload": { ... }
}
```

错误响应：

```json
{
  "type": "res",
  "id": "abc123",
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "at /client/id: ...",
    "retryable": false
  }
}
```

### 2.3 事件帧 (Server → Client)

```json
{
  "type": "event",
  "event": "chat.event",
  "payload": { ... },
  "seq": 42
}
```

---

## 3. 握手认证流程

### 流程概览

```
Client                          Server
  |                               |
  |-- WebSocket Connect --------->|
  |<-- { type: "challenge" } -----|
  |                               |
  |-- { type: "connect", ... } -->|  (含设备签名)
  |<-- { type: "hello-ok" } ------|  (连接成功)
  |                               |
  |-- { type: "req", method: ... }|  (正常 RPC 调用)
  |<-- { type: "res", ... } ------|
```

### 3.1 Challenge 帧 (Server → Client)

连接建立后服务端立即发送：

```json
{
  "type": "challenge",
  "nonce": "58e8f803-3b54-4c6f-a11c-b8eafd8ce4c7",
  "ts": 1773814450494
}
```

### 3.2 Connect 帧 (Client → Server)

客户端收到 challenge 后发送连接请求：

```json
{
  "type": "connect",
  "minProtocol": 1,
  "maxProtocol": 5,
  "client": {
    "id": "openclaw-control-ui",
    "displayName": "Agent Control UI",
    "version": "1.0.0",
    "platform": "web",
    "deviceFamily": "browser",
    "mode": "webchat"
  },
  "auth": {
    "token": "YOUR_OPERATOR_TOKEN"
  },
  "device": {
    "id": "DEVICE_ID",
    "publicKey": "BASE64URL_ED25519_PUBLIC_KEY",
    "signature": "BASE64URL_SIGNATURE",
    "signedAt": 1773814450500,
    "nonce": "58e8f803-3b54-4c6f-a11c-b8eafd8ce4c7"
  },
  "role": "operator",
  "scopes": ["*"]
}
```

**合法的 `client.id` 值**（必须是以下之一）：

```
"cli" | "webchat" | "webchat-ui" | "openclaw-control-ui" |
"gateway-client" | "openclaw-macos" | "openclaw-ios" |
"openclaw-android" | "node-host" | "test" | "fingerprint" | "openclaw-probe"
```

**合法的 `client.mode` 值**：

```
"node" | "cli" | "ui" | "webchat" | "test" | "backend" | "probe"
```

### 3.3 Hello-OK 帧 (Server → Client)

认证成功后服务端响应：

```json
{
  "type": "hello-ok",
  "protocol": 5,
  "server": {
    "version": "1.2.3",
    "connId": "conn_abc123"
  },
  "features": {
    "methods": ["config.get", "agents.list", "..."],
    "events": ["chat.event", "agent.event", "..."]
  },
  "snapshot": {
    "presence": [],
    "health": {},
    "stateVersion": { "presence": 1, "health": 1 },
    "uptimeMs": 12345,
    "sessionDefaults": {
      "defaultAgentId": "default",
      "mainKey": "main",
      "mainSessionKey": "main::default"
    },
    "authMode": "token"
  },
  "auth": {
    "deviceToken": "ISSUED_DEVICE_TOKEN",
    "role": "operator",
    "scopes": ["*"]
  },
  "policy": {
    "maxPayload": 1048576,
    "maxBufferedBytes": 4194304,
    "tickIntervalMs": 30000
  }
}
```

---

## 4. 设备密钥与签名

### 4.1 生成 Ed25519 密钥对

使用 Web Crypto API（浏览器原生支持）：

```typescript
const keyPair = await crypto.subtle.generateKey(
  { name: 'Ed25519' } as any,
  true,
  ['sign', 'verify']
);

// 导出公钥（DER 格式）
const pubKeyDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
// 取最后 32 字节为原始公钥
const pubKeyBytes = new Uint8Array(pubKeyDer).slice(-32);
const publicKeyB64 = bytesToBase64url(pubKeyBytes);
```

### 4.2 V3 签名载荷格式

签名字符串由以下字段用 `|` 拼接（均为字符串，`scopes` 用 `,` 拼接）：

```
v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}
```

**示例：**

```
v3|my-device-001|openclaw-control-ui|webchat|operator|*|1773814450500|yptDiIi...token...|58e8f803-...-nonce|web|browser
```

### 4.3 执行签名

```typescript
const payloadStr = [
  'v3',
  deviceId,
  'openclaw-control-ui',  // client.id
  'webchat',              // client.mode
  'operator',             // role
  ['*'].join(','),        // scopes
  String(signedAt),       // signedAtMs
  token,                  // operator token
  nonce,                  // challenge nonce
  'web',                  // platform
  'browser',              // deviceFamily
].join('|');

const payloadBytes = new TextEncoder().encode(payloadStr);
const signatureBuffer = await crypto.subtle.sign(
  { name: 'Ed25519' } as any,
  privateKey,             // CryptoKey (Ed25519)
  payloadBytes
);

const signature = bytesToBase64url(new Uint8Array(signatureBuffer));
```

### 4.4 辅助函数

```typescript
function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(b64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
```

### 4.5 设备 ID 与密钥持久化

建议将设备 ID 和密钥存入 `localStorage`，避免每次刷新重新配对：

```typescript
const STORAGE_KEY = 'openclaw_device_keys';

async function initDeviceKeys(): Promise<DeviceKeys> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    // 重新导入存储的密钥
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', base64urlToBytes(parsed.privateKeyRaw),
      { name: 'Ed25519' } as any, false, ['sign']
    );
    return { ...parsed, privateKey };
  }
  // 新设备，生成密钥对
  const keyPair = await crypto.subtle.generateKey(...);
  const deviceId = 'web-' + Date.now();
  // 存储并返回
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ deviceId, publicKey, privateKeyRaw }));
  return { deviceId, publicKey, privateKey };
}
```

---

## 5. RPC 调用方法

### 5.1 配置管理

#### `config.get`

获取当前完整配置。

- **Params:** `{}`（空对象，不接受额外字段）
- **Response:**
  ```json
  {
    "path": "/home/user/.openclaw/config.yml",
    "exists": true,
    "raw": "...",
    "parsed": { ... },
    "resolved": {
      "agents": {
        "list": {
          "agentId": {
            "name": "My Agent",
            "workspace": "/path/to/workspace",
            "model": "kimi-coding/k2p5",
            "enabled": true
          }
        }
      }
    }
  }
  ```

> **注意：** Agent 列表在 `resolved.agents.list` 中，而不是顶层。

#### `config.patch`

增量修改配置。

- **Params:**
  ```json
  [
    { "op": "add", "path": "agents.my-agent", "value": { ... } },
    { "op": "replace", "path": "agents.my-agent.enabled", "value": false },
    { "op": "remove", "path": "agents.old-agent" }
  ]
  ```
- **Response:** `{ "ok": true, "hash": "..." }`

#### `config.apply`

应用配置变更（重载生效）。

- **Params:** `{}`
- **Response:** `{ "ok": true }`

#### `config.set`

完整替换配置（YAML 字符串）。

- **Params:**
  ```json
  { "raw": "agents:\n  list:\n    ...", "baseHash": "optional_hash" }
  ```
- **Response:** `{ "ok": true, "hash": "..." }`

#### `config.schema`

获取配置 JSON Schema。

- **Params:** `{}`
- **Response:** `{ "schema": { ... }, "uiHints": { ... }, "version": "1.0" }`

---

### 5.2 Agent 管理

#### `agents.list`

列出所有 Agents。

- **Params:** `{}`
- **Response:**
  ```json
  {
    "defaultId": "default",
    "mainKey": "main",
    "scope": "global",
    "agents": [
      { "id": "my-agent", "name": "My Agent" }
    ]
  }
  ```

#### `agents.create`

创建新 Agent。

- **Params:**
  ```json
  {
    "name": "My Agent",
    "workspace": "/home/user/.openclaw/my-workspace",
    "emoji": "🤖",
    "avatar": "optional_avatar_url"
  }
  ```
- **Response:** `{ "ok": true, "agentId": "my-agent", "name": "My Agent", "workspace": "..." }`

#### `agents.update`

更新 Agent 配置。

- **Params:**
  ```json
  {
    "agentId": "my-agent",
    "name": "New Name",
    "workspace": "/new/path",
    "model": "gpt-4"
  }
  ```
- **Response:** `{ "ok": true, "agentId": "my-agent" }`

#### `agents.delete`

删除 Agent。

- **Params:**
  ```json
  { "agentId": "my-agent", "deleteFiles": false }
  ```
- **Response:** `{ "ok": true, "agentId": "my-agent", "removedBindings": 1 }`

---

### 5.3 Agent 文件管理

#### `agents.files.list`

列出 Agent 工作区文件（IDENTITY.md、AGENTS.md 等）。

- **Params:** `{ "agentId": "my-agent" }`
- **Response:**
  ```json
  {
    "agentId": "my-agent",
    "workspace": "/path/to/workspace",
    "files": [
      {
        "name": "IDENTITY.md",
        "path": "/path/to/workspace/IDENTITY.md",
        "missing": false,
        "size": 1234,
        "updatedAtMs": 1700000000000,
        "content": "..."
      }
    ]
  }
  ```

#### `agents.files.get`

获取指定文件内容。

- **Params:** `{ "agentId": "my-agent", "name": "IDENTITY.md" }`
- **Response:** `{ "agentId": "...", "workspace": "...", "file": { ... } }`

#### `agents.files.set`

写入文件内容。

- **Params:**
  ```json
  { "agentId": "my-agent", "name": "IDENTITY.md", "content": "# My Agent\n..." }
  ```
- **Response:** `{ "ok": true, "agentId": "...", "workspace": "...", "file": { ... } }`

---

### 5.4 聊天与会话

#### `chat.send`

向 Agent 发送消息（异步流式）。

- **Params:**
  ```json
  {
    "sessionKey": "main::default",
    "message": "Hello, agent!",
    "idempotencyKey": "unique-key-001",
    "deliver": true,
    "timeoutMs": 60000
  }
  ```
- **Response:** 立即返回 `{ "runId": "run_xxx" }`，后续通过 `chat.event` 事件推送流式内容。

#### `chat.history`

获取会话历史。

- **Params:** `{ "sessionKey": "main::default", "limit": 50 }`
- **Response:** 消息历史数组。

#### `chat.inject`

注入消息到会话（不触发 AI 响应）。

- **Params:** `{ "sessionKey": "main::default", "message": "System note", "label": "system" }`
- **Response:** `{ "ok": true }`

#### `chat.abort`

中止正在进行的对话。

- **Params:** `{ "sessionKey": "main::default", "runId": "run_xxx" }`
- **Response:** `{ "ok": true }`

---

### 5.5 模型列表

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
        "contextWindow": 128000,
        "reasoning": false
      }
    ]
  }
  ```

---

### 5.6 日志

#### `logs.tail`

获取最新日志行（类似 `tail -f`）。

- **Params:**
  ```json
  { "cursor": 0, "limit": 100, "maxBytes": 65536 }
  ```
- **Response:**
  ```json
  {
    "file": "/path/to/openclaw.log",
    "cursor": 4096,
    "size": 4096,
    "lines": ["[INFO] ...", "[DEBUG] ..."],
    "truncated": false,
    "reset": false
  }
  ```
  使用返回的 `cursor` 作为下次请求的起点，实现增量拉取。

---

### 5.7 通道状态

#### `channels.status`

获取所有消息通道（微信、Slack 等）的连接状态。

- **Params:** `{ "probe": false, "timeoutMs": 5000 }`
- **Response:**
  ```json
  {
    "ts": 1700000000000,
    "channelOrder": ["wechat", "slack"],
    "channelLabels": { "wechat": "WeChat", "slack": "Slack" },
    "channels": { ... },
    "channelAccounts": {
      "wechat": [{ "accountId": "wx_001", "status": "connected" }]
    }
  }
  ```

#### `channels.logout`

登出指定通道账号。

- **Params:** `{ "channel": "wechat", "accountId": "wx_001" }`
- **Response:** `{ "ok": true }`

---

### 5.8 执行审批

#### `exec.approvals.get`

获取当前执行审批规则配置。

- **Params:** `{}`
- **Response:** 当前审批配置快照。

#### `exec.approvals.request`

提交一个工具执行审批请求（由 Agent 发起）。

- **Params:**
  ```json
  {
    "id": "approval_001",
    "command": "bash",
    "commandArgv": ["bash", "-c", "rm -rf /tmp/test"],
    "cwd": "/home/user",
    "agentId": "my-agent",
    "sessionKey": "main::my-agent",
    "timeoutMs": 30000
  }
  ```

#### `exec.approvals.resolve`

人工审批/拒绝执行请求。

- **Params:** `{ "id": "approval_001", "decision": "approve" }`
- **Response:** `{ "ok": true }`

---

## 6. 服务端事件

连接成功后，服务端会主动推送以下事件：

### `chat.event` - 聊天流式事件

```json
{
  "type": "event",
  "event": "chat.event",
  "payload": {
    "runId": "run_abc123",
    "sessionKey": "main::default",
    "seq": 5,
    "state": "delta",
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help?"
    }
  }
}
```

`state` 取值：`"delta"` | `"final"` | `"aborted"` | `"error"`

### `agent.event` - Agent 活动事件

```json
{
  "type": "event",
  "event": "agent.event",
  "payload": {
    "runId": "run_abc123",
    "seq": 10,
    "stream": "tool_use",
    "ts": 1700000000000,
    "data": { "tool": "bash", "command": "ls -la" }
  }
}
```

### `tick` - 心跳

```json
{
  "type": "event",
  "event": "tick",
  "payload": { "ts": 1700000000000 }
}
```

### `shutdown` - 服务关闭通知

```json
{
  "type": "event",
  "event": "shutdown",
  "payload": { "reason": "restart", "restartExpectedMs": 3000 }
}
```

### `node.event` - 节点事件

```json
{
  "type": "event",
  "event": "node.event",
  "payload": {
    "event": "status.update",
    "payload": { "nodeId": "node_001", "status": "online" }
  }
}
```

### `node.invoke.result` - 节点调用结果

```json
{
  "type": "event",
  "event": "node.invoke.result",
  "payload": {
    "id": "invoke_001",
    "nodeId": "node_001",
    "ok": true,
    "payload": { ... }
  }
}
```

---

## 7. 错误码

| 错误码 | 说明 |
|--------|------|
| `INVALID_REQUEST` | 请求参数校验失败（schema 不匹配） |
| `NOT_LINKED` | 客户端未连接到 Gateway |
| `NOT_PAIRED` | 设备/节点未配对 |
| `AGENT_TIMEOUT` | Agent 操作超时 |
| `UNAVAILABLE` | 服务或方法不可用 |
| `AUTH_FAILED` | 认证失败 |

错误响应体：

```json
{
  "code": "INVALID_REQUEST",
  "message": "at /client/id: Expected one of [...] but received 'ui'",
  "details": { ... },
  "retryable": false,
  "retryAfterMs": null
}
```

---

## 8. 完整对接示例

以下是一个最小可用的 TypeScript 客户端示例：

```typescript
const WS_URL = 'ws://127.0.0.1:18789';
const TOKEN = 'your_operator_token';

class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, (res: any) => void>();
  private reqId = 0;

  async connect() {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);

      this.ws.onmessage = async (e) => {
        const msg = JSON.parse(e.data);

        // 1. 处理 RPC 响应
        if (msg.type === 'res' && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
          return;
        }

        // 2. 处理 Challenge
        if (msg.type === 'challenge') {
          await this.handleChallenge(msg);
          return;
        }

        // 3. 连接成功
        if (msg.type === 'hello-ok') {
          resolve();
          return;
        }

        // 4. 连接失败
        if (msg.type === 'hello-fail') {
          reject(new Error(msg.error?.message || 'Connection failed'));
          return;
        }

        // 5. 服务端事件
        if (msg.type === 'event') {
          this.onEvent(msg);
        }
      };

      this.ws.onerror = () => reject(new Error('WebSocket error'));
    });
  }

  private async handleChallenge(challenge: { nonce: string; ts: number }) {
    // 获取或生成设备密钥（建议持久化到 localStorage）
    const keys = await getDeviceKeys();
    const signedAt = Date.now();

    const payloadStr = [
      'v3', keys.deviceId, 'openclaw-control-ui', 'webchat',
      'operator', '*', String(signedAt), TOKEN,
      challenge.nonce, 'web', 'browser'
    ].join('|');

    const sig = await crypto.subtle.sign(
      { name: 'Ed25519' } as any,
      keys.privateKey,
      new TextEncoder().encode(payloadStr)
    );

    this.ws!.send(JSON.stringify({
      type: 'connect',
      minProtocol: 1, maxProtocol: 5,
      client: {
        id: 'openclaw-control-ui',
        version: '1.0.0',
        platform: 'web',
        deviceFamily: 'browser',
        mode: 'webchat',
      },
      auth: { token: TOKEN },
      role: 'operator',
      scopes: ['*'],
      device: {
        id: keys.deviceId,
        publicKey: keys.publicKey,
        signature: bytesToBase64url(new Uint8Array(sig)),
        signedAt,
        nonce: challenge.nonce,
      },
    }));
  }

  async call(method: string, params: any = {}): Promise<any> {
    const id = String(++this.reqId);
    return new Promise((resolve, reject) => {
      this.pending.set(id, (res) => {
        if (res.ok) resolve(res.payload);
        else reject(new Error(res.error?.message || 'RPC error'));
      });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  private onEvent(msg: any) {
    console.log('Event:', msg.event, msg.payload);
  }
}

// 使用示例
const client = new OpenClawClient();
await client.connect();

// 获取配置（Agent 列表在 resolved.agents.list）
const config = await client.call('config.get', {});
const agents = config.resolved?.agents?.list ?? {};

// 创建 Agent（通过 config.patch）
await client.call('config.patch', [
  { op: 'add', path: 'agents.my-agent', value: {
    name: 'My Agent',
    workspace: '/home/user/.openclaw/my-workspace',
    model: 'kimi-coding/k2p5',
    enabled: true,
  }}
]);
await client.call('config.apply', {});

// 发送消息
const { runId } = await client.call('chat.send', {
  sessionKey: 'main::my-agent',
  message: 'Hello!',
  idempotencyKey: `msg-${Date.now()}`,
});
```

---

## 附录：设备配对

首次连接时，服务端会记录新设备并要求管理员批准：

```bash
# 查看等待配对的设备
openclaw devices list

# 批准设备
openclaw devices approve <deviceId>

# 拒绝设备
openclaw devices reject <deviceId>
```

已配对设备的 token 可以在 `/home/USER/.openclaw/devices/paired.json` 中查看：

```json
[
  {
    "deviceId": "web-1234567890",
    "token": "yptDiIicrzNPuF5Dk0Sk...",
    "role": "operator",
    "scopes": ["*"]
  }
]
```
