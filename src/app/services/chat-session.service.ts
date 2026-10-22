import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { ChatMessage } from './rag.service';

interface ChatSessionRecord {
  sessionId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}

interface StoredChatMessage extends Omit<ChatMessage, 'timestamp'> {
  timestamp: string;
}

interface StoredSessionRecord {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
}

interface SessionState {
  activeSessionId: string | null;
  sessions: ChatSessionRecord[];
}

export interface ChatSessionSummary {
  sessionId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

/**
 * Persists chat sessions in sessionStorage so state survives route changes
 * but is cleared when the browser tab is closed.
 *
 * The history belongs to the signed-in user ({@link AuthService.owner$}). A demo signs users in and out
 * on the same tab, and sessionStorage survives that, so the store is wiped when everyone signs out and
 * discarded when a different user signs in. A stored history for another owner is never loaded.
 */
@Injectable({ providedIn: 'root' })
export class ChatSessionService {

  private static readonly KEY = 'content-lake.chat.sessions.v1';
  private state: SessionState = this.load();
  /** The owner {@link state} belongs to; null until the restored sessions are known. */
  private owner: string | null = null;
  private readonly cleared$$ = new Subject<void>();

  /** Emits when the history is wiped for a new owner, so a view can drop what it shows. */
  readonly cleared$: Observable<void> = this.cleared$$.asObservable();

  constructor(auth: AuthService) {
    // Only after the restored sessions are validated: before that the tab looks signed out, and acting
    // on that would wipe the history on every reload.
    auth.ready.then(() => auth.owner$.subscribe(owner => this.adopt(owner)));
  }

  ensureActiveSession(): string {
    const current = this.state.activeSessionId;
    if (current && this.find(current)) return current;
    if (this.state.sessions.length > 0) {
      this.state.activeSessionId = this.state.sessions[0].sessionId;
      this.persist();
      return this.state.activeSessionId;
    }
    return this.createSession();
  }

  createSession(): string {
    const now = new Date();
    const sessionId = this.generateId();
    this.state.sessions = [
      { sessionId, title: 'New conversation', createdAt: now, updatedAt: now, messages: [] },
      ...this.state.sessions
    ];
    this.state.activeSessionId = sessionId;
    this.persist();
    return sessionId;
  }

  activateSession(sessionId: string): void {
    if (!this.find(sessionId)) return;
    this.state.activeSessionId = sessionId;
    this.persist();
  }

  /**
   * Migrates a session record to the id assigned by the backend so a chat that
   * started under a UI-generated id does not fork into a second orphaned
   * session on the next save.
   */
  renameSession(oldSessionId: string, newSessionId: string): void {
    if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) {
      this.state.activeSessionId = newSessionId || this.state.activeSessionId;
      return;
    }
    const session = this.find(oldSessionId);
    if (!session) {
      this.state.activeSessionId = newSessionId;
      this.persist();
      return;
    }
    if (this.find(newSessionId)) {
      this.state.sessions = this.state.sessions.filter((s) => s.sessionId !== oldSessionId);
    } else {
      session.sessionId = newSessionId;
    }
    this.state.activeSessionId = newSessionId;
    this.persist();
  }

  deleteSession(sessionId: string): void {
    this.state.sessions = this.state.sessions.filter((s) => s.sessionId !== sessionId);
    if (this.state.activeSessionId === sessionId) {
      this.state.activeSessionId = this.state.sessions[0]?.sessionId ?? null;
    }
    this.persist();
  }

  getActiveSessionId(): string | null { return this.state.activeSessionId; }

  listSessions(): ChatSessionSummary[] {
    return this.state.sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
      messageCount: s.messages.length
    }));
  }

  getMessages(sessionId: string): ChatMessage[] {
    return (this.find(sessionId)?.messages ?? []).map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
  }

  saveMessages(sessionId: string, messages: ChatMessage[]): void {
    const now = new Date();
    const normalized = messages.map(m => ({ ...m, timestamp: new Date(m.timestamp ?? now) }));
    const existing = this.find(sessionId);
    if (existing) {
      existing.messages = normalized;
      existing.updatedAt = this.latestTs(normalized, now);
      existing.title = this.resolveTitle(normalized);
    } else {
      this.state.sessions.push({
        sessionId,
        title: this.resolveTitle(normalized),
        createdAt: this.earliestTs(normalized, now),
        updatedAt: this.latestTs(normalized, now),
        messages: normalized
      });
    }
    this.state.sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    this.state.activeSessionId = sessionId;
    this.persist();
  }

  private find(sessionId: string): ChatSessionRecord | undefined {
    return this.state.sessions.find(s => s.sessionId === sessionId);
  }

  private resolveTitle(messages: ChatMessage[]): string {
    const first = messages.find(m => m.role === 'user' && m.content?.trim());
    if (!first) return 'New conversation';
    const t = first.content.trim();
    return t.length > 72 ? `${t.slice(0, 69)}…` : t;
  }

  private earliestTs(messages: ChatMessage[], fallback: Date): Date {
    return messages.reduce((min, m) => {
      const ts = new Date(m.timestamp);
      return ts < min ? ts : min;
    }, messages[0] ? new Date(messages[0].timestamp) : fallback);
  }

  private latestTs(messages: ChatMessage[], fallback: Date): Date {
    return messages.reduce((max, m) => {
      const ts = new Date(m.timestamp);
      return ts > max ? ts : max;
    }, messages[0] ? new Date(messages[0].timestamp) : fallback);
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `ui-${crypto.randomUUID()}`;
    }
    return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private adopt(owner: string): void {
    const stored = this.storedOwner();
    if (this.owner === null && stored === owner) {
      this.owner = owner;
      return;
    }
    if (this.owner === owner) return;
    this.owner = owner;
    this.state = { activeSessionId: null, sessions: [] };
    this.persist();
    this.cleared$$.next();
  }

  private storedOwner(): string | null {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(ChatSessionService.KEY);
      return raw ? (JSON.parse(raw).owner ?? null) : null;
    } catch { return null; }
  }

  private load(): SessionState {
    const empty: SessionState = { activeSessionId: null, sessions: [] };
    if (typeof sessionStorage === 'undefined') return empty;
    try {
      const raw = sessionStorage.getItem(ChatSessionService.KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as { activeSessionId: string | null; sessions: StoredSessionRecord[] };
      const sessions = (Array.isArray(parsed.sessions) ? parsed.sessions : []).map(s => ({
        sessionId: s.sessionId,
        title: s.title || 'New conversation',
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        messages: (s.messages ?? []).map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
      }));
      sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return {
        activeSessionId: parsed.activeSessionId ?? sessions[0]?.sessionId ?? null,
        sessions
      };
    } catch { return empty; }
  }

  private persist(): void {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(ChatSessionService.KEY, JSON.stringify({
      owner: this.owner ?? this.storedOwner(),
      activeSessionId: this.state.activeSessionId,
      sessions: this.state.sessions.map(s => ({
        sessionId: s.sessionId,
        title: s.title,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        messages: s.messages.map(m => ({ ...m, timestamp: m.timestamp.toISOString() }))
      }))
    }));
  }
}
