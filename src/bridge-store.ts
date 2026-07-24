// Gemini Bridge 内存状态管理与事件广播 (共享库)
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'

export interface BridgeRequest {
  requestId: string;
  sessionId: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  files?: Array<{ name: string; mediaType: string; data: string }>;
  status: 'pending' | 'resolving' | 'resolved' | 'error';
  content?: string;
  error?: string;
  createdAt: number;
}

export interface BridgeSession {
  sessionId: string;
  createdAt: number;
  requests: Map<string, BridgeRequest>;
}

export interface PendingRequest {
  requestId: string
  sessionId: string
  messages: Array<{ role: string; content: string }>
  files?: Array<{ name: string; mediaType: string; data: string }>
  model?: string
  temperature?: number
  resolve: (value: { content?: string; error?: string }) => void
  createdAt: number
}

export class GeminiBridgeManager extends EventEmitter {
  private pendingRequests = new Map<string, PendingRequest>()
  public videoMap = new Map<string, string>()

  createRequest(payload: {
    messages: Array<{ role: string; content: string }>
    files?: Array<{ name: string; mediaType: string; data: string }>
    model?: string
    temperature?: number
  }): Promise<{ content?: string; error?: string }> {
    const requestId = `req_${randomUUID()}`
    const sessionId = `sess_${randomUUID()}`

    return new Promise((resolve) => {
      const pendingItem: PendingRequest = {
        requestId,
        sessionId,
        messages: payload.messages,
        files: payload.files,
        model: payload.model,
        temperature: payload.temperature,
        resolve,
        createdAt: Date.now(),
      }

      this.pendingRequests.set(requestId, pendingItem)

      // 广播 SSE 给前端页面
      this.emit('llm-request', {
        requestId,
        sessionId,
        messages: payload.messages,
        files: payload.files,
        model: payload.model || 'qingqiu-gemini::gemini-2.5-flash',
      })

      // 300秒(5分钟)超时保护
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          resolve({ error: '桥接扩展响应超时 (300s)' })
        }
      }, 300000)
    })
  }

  resolveRequest(requestId: string, result: { content?: string; error?: string }): boolean {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return false

    this.pendingRequests.delete(requestId)
    pending.resolve(result)
    return true
  }
}

const globalForBridge = global as unknown as { geminiBridgeManager: GeminiBridgeManager }
export const geminiBridgeManager = globalForBridge.geminiBridgeManager || new GeminiBridgeManager()
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
  globalForBridge.geminiBridgeManager = geminiBridgeManager
}

type EventCallback = (event: string, data: any) => void;

class GeminiBridgeStore {
  private sessions = new Map<string, BridgeSession>();
  private listeners = new Set<EventCallback>();

  createSession(): string {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: Date.now(),
      requests: new Map(),
    });
    return sessionId;
  }

  getSession(sessionId: string): BridgeSession | undefined {
    return this.sessions.get(sessionId);
  }

  addRequest(sessionId: string, req: Omit<BridgeRequest, 'status' | 'createdAt'>): BridgeRequest {
    let session = this.sessions.get(sessionId);
    if (!session) {
      this.sessions.set(sessionId, {
        sessionId,
        createdAt: Date.now(),
        requests: new Map(),
      });
      session = this.sessions.get(sessionId)!;
    }

    const bridgeReq: BridgeRequest = {
      ...req,
      status: 'pending',
      createdAt: Date.now(),
    };

    session.requests.set(req.requestId, bridgeReq);
    this.broadcast('gemini:llm-request', bridgeReq);
    return bridgeReq;
  }

  resolveRequest(sessionId: string, requestId: string, result: { content?: string; error?: string }): boolean {
    // 优先处理 NodeJS EventEmitter 格式的 pendingRequests
    if (geminiBridgeManager.resolveRequest(requestId, result)) {
      return true
    }

    const session = this.sessions.get(sessionId);
    if (!session) return false;
    const req = session.requests.get(requestId);
    if (!req) return false;

    if (result.error) {
      req.status = 'error';
      req.error = result.error;
    } else {
      req.status = 'resolved';
      req.content = result.content;
    }

    this.broadcast('gemini:llm-response', req);
    return true;
  }

  getRequest(sessionId: string, requestId: string): BridgeRequest | undefined {
    const session = this.sessions.get(sessionId);
    return session?.requests.get(requestId);
  }

  subscribe(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private broadcast(event: string, data: any) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        // ignore subscriber errors
      }
    }
  }
}

export const globalBridgeStore = new GeminiBridgeStore();
