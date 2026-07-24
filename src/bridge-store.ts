// Gemini Bridge 内存状态管理与事件广播 (共享库)

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
