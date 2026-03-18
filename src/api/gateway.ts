export interface GatewayEvent {
  type: string;
  data: any;
}

interface ReconnectOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

interface DeviceKeys {
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
}

function base64urlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private token: string = '';
  private wsBase: string = 'ws://127.0.0.1:18789';
  private eventHandlers: Set<(event: GatewayEvent) => void> = new Set();
  private connectionStateHandlers: Set<(state: ConnectionState) => void> = new Set();
  private deviceKeys: DeviceKeys | null = null;

  private reconnectOptions: ReconnectOptions = {
    maxRetries: 10,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  };
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: any) => void) | null = null;

  private pending: Map<string, { resolve: (val: any) => void, reject: (err: any) => void }> = new Map();
  private msgIdCounter = 0;

  private async initDeviceKeys(): Promise<DeviceKeys> {
    if (this.deviceKeys) return this.deviceKeys;

    const STORAGE_KEY = 'openclaw_web_device_v1';
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const privateKey = await crypto.subtle.importKey(
          'jwk', parsed.privateKeyJwk, { name: 'Ed25519' } as any, false, ['sign']
        );
        this.deviceKeys = { deviceId: parsed.deviceId, publicKey: parsed.publicKeyB64, privateKey };
        return this.deviceKeys;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    // Generate new Ed25519 key pair
    const keyPair = await crypto.subtle.generateKey(
      { name: 'Ed25519' } as any, true, ['sign', 'verify']
    );

    const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey as CryptoKey) as any;
    const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey as CryptoKey) as any;

    // Device ID = SHA-256 of raw public key bytes, hex encoded
    const publicKeyBytes = base64urlToBytes(pubJwk.x);
    const hashBuffer = await crypto.subtle.digest('SHA-256', publicKeyBytes);
    const deviceId = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      deviceId,
      publicKeyB64: pubJwk.x,
      privateKeyJwk: privJwk
    }));

    this.deviceKeys = { deviceId, publicKey: pubJwk.x, privateKey: keyPair.privateKey as CryptoKey };
    return this.deviceKeys;
  }

  connect(token: string): Promise<void> {
    this.token = token;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    // If already connecting, attach to the existing attempt
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        this.connectResolve = resolve;
        this.connectReject = reject;
      });
    }
    // Close existing open connection before reconnecting
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.shouldReconnect = false;
      this.ws.close();
      this.ws = null;
      this.shouldReconnect = true;
    }
    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      try {
        this.ws = new WebSocket(this.wsBase);
        this.notifyConnectionState('connecting');

        this.ws.onopen = () => {
          console.log('WebSocket opened, waiting for challenge...');
        };

        this.ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          console.log('WS message:', data);

          // Handle RPC responses first (before generic error handler)
          if (data.id && this.pending.has(data.id)) {
            const { resolve, reject } = this.pending.get(data.id)!;
            this.pending.delete(data.id);
            if (data.error) {
              reject(data.error);
            } else {
              resolve(data.payload || data.result);
            }
            return;
          }

          // Handle challenge from server
          if (data.event === 'connect.challenge') {
            this.handleChallenge(data.payload).catch(err => {
              console.error('Challenge handling failed:', err);
              this.connectReject?.(err);
            });
            return;
          }

          // Handle successful connection
          if (data.type === 'res' && data.ok === true && data.payload?.type === 'hello-ok') {
            this.reconnectAttempts = 0;
            this.notifyConnectionState('connected');
            this.connectResolve?.();
            this.connectResolve = null;
            this.connectReject = null;
            return;
          }

          // Handle connection error (only during connect phase)
          if (data.type === 'res' && data.ok === false && this.connectReject) {
            console.error('Connection failed:', data.error);
            this.connectReject?.(data.error);
            this.connectResolve = null;
            this.connectReject = null;
            return;
          }

          // Handle events
          if (data.type?.startsWith('event.') || data.event) {
            this.eventHandlers.forEach(h => h(data));
          }
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          this.connectReject?.(err);
        };

        this.ws.onclose = () => {
          console.log('WebSocket closed');
          this.ws = null;
          this.notifyConnectionState('disconnected');
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        };
      } catch (err) {
        this.connectReject?.(err);
      }
    });
  }

  private async handleChallenge(challenge: { nonce: string; ts: number }) {
    console.log('Got challenge, sending connect...');

    const currentWs = this.ws; // capture before any async operations

    const keys = await this.initDeviceKeys();
    console.log('Using device ID:', keys.deviceId);

    const signedAt = Date.now();
    const clientId = 'openclaw-control-ui';
    const clientMode = 'webchat';
    const role = 'operator';
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];
    const platform = 'web';
    const deviceFamily = '';

    // Build V3 signing payload:
    // v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily
    const payloadStr = [
      'v3',
      keys.deviceId,
      clientId,
      clientMode,
      role,
      scopes.join(','),
      String(signedAt),
      this.token,
      challenge.nonce,
      platform,
      deviceFamily
    ].join('|');

    const payloadBytes = new TextEncoder().encode(payloadStr);
    const signatureBuffer = await crypto.subtle.sign(
      { name: 'Ed25519' } as any, keys.privateKey, payloadBytes
    );
    const signature = bytesToBase64url(new Uint8Array(signatureBuffer));

    const connectMsg = {
      type: 'req',
      id: `connect_${Date.now()}`,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          version: '1.0.0',
          platform,
          mode: clientMode
        },
        role,
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: this.token },
        locale: 'zh-CN',
        userAgent: 'openclaw-web-ui/1.0.0',
        device: {
          id: keys.deviceId,
          publicKey: keys.publicKey,
          signature,
          signedAt,
          nonce: challenge.nonce
        }
      }
    };

    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify(connectMsg));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.reconnectOptions.maxRetries) {
      this.notifyConnectionState('failed');
      return;
    }

    const delay = Math.min(
      this.reconnectOptions.initialDelay * Math.pow(
        this.reconnectOptions.backoffMultiplier,
        this.reconnectAttempts
      ),
      this.reconnectOptions.maxDelay
    );

    this.reconnectAttempts++;
    this.notifyConnectionState('reconnecting');

    console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.reconnectOptions.maxRetries})`);

    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch(() => {});
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.notifyConnectionState('disconnected');
  }

  onEvent(handler: (event: GatewayEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onConnectionState(handler: (state: ConnectionState) => void): () => void {
    this.connectionStateHandlers.add(handler);
    return () => this.connectionStateHandlers.delete(handler);
  }

  private notifyConnectionState(state: ConnectionState) {
    this.connectionStateHandlers.forEach(h => h(state));
  }

  private rpc<T>(method: string, params: any = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket not connected"));
    }

    const id = `req_${++this.msgIdCounter}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws?.send(JSON.stringify({
        type: 'req',
        id,
        method,
        params
      }));

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("RPC Timeout"));
        }
      }, 10000);
    });
  }

  configGet(): Promise<any> {
    return this.rpc('config.get', {});
  }

  configPatch(ops: any[]): Promise<any> {
    return this.rpc('config.patch', { ops });
  }

  configPatchRaw(raw: Record<string, any>): Promise<any> {
    return this.rpc('config.patch', { raw });
  }

  // Local file server (localfile-server.mjs) runs on port 19876 in dev mode.
  // Use same hostname as current page so WSL2 / remote access works correctly.
  private get localFileBase() {
    return `http://${window.location.hostname}:19876`;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const res = await fetch(`${this.localFileBase}/?path=${encodeURIComponent(filePath)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? 'Write failed');
    }
  }

  async readFile(filePath: string): Promise<string> {
    const res = await fetch(`${this.localFileBase}/?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? 'Read failed');
    }
    const data = await res.json();
    return data.content;
  }

  async listDir(dirPath: string): Promise<string[]> {
    const res = await fetch(`${this.localFileBase}/?dir=${encodeURIComponent(dirPath)}`);
    const data = await res.json();
    return data.files ?? [];
  }

  async deleteFile(filePath: string): Promise<void> {
    const res = await fetch(`${this.localFileBase}/?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? 'Delete failed');
    }
  }

  configApply(): Promise<any> {
    return this.rpc('config.apply');
  }

  agentFilesGet(agentId: string, name: string): Promise<any> {
    return this.rpc('agents.files.get', { agentId, name });
  }

  agentFilesSet(agentId: string, name: string, content: string): Promise<any> {
    return this.rpc('agents.files.set', { agentId, name, content });
  }

  sessionsList(params: { agentId?: string; limit?: number; search?: string; includeDerivedTitles?: boolean; includeLastMessage?: boolean }): Promise<any> {
    return this.rpc('sessions.list', { includeDerivedTitles: true, limit: 50, ...params });
  }

  chatHistory(sessionKey: string, limit?: number): Promise<any> {
    return this.rpc('chat.history', { sessionKey, limit: limit ?? 200 });
  }


  async invokeTool(tool: string, params: Record<string, any>): Promise<any> {
    return this.rpc('tools.invoke', { tool, params });
  }

  getConnectionState(): ConnectionState {
    if (!this.ws) return 'disconnected';
    if (this.reconnectTimer) return 'reconnecting';
    if (this.ws.readyState === WebSocket.OPEN) return 'connected';
    return 'connecting';
  }

  getDeviceId(): string | null {
    return this.deviceKeys?.deviceId ?? null;
  }
}

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'failed';

export const client = new GatewayClient();
