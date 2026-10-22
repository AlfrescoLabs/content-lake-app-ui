import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { resolveConnectorUrls, resolveStatusUrl } from '../utils/api-paths';
import { sourceDisplayLabel } from '../utils/source-presentation';

/** How a session proves itself to rag-service: an Alfresco ticket, or a base64(user:pass). */
export type SourceLoginKind = 'password' | 'ticket';

/** One entry of `GET /api/rag/sources`. It carries no URL and no secret. */
export interface ContentSourceDescriptor {
  /** Qualified id, `<sourceType>:<id>`, the same value documents carry as `cin_sourceId`. */
  sourceId: string;
  sourceType: string;
  displayName: string;
  /** Empty for a source that has no login of its own. */
  loginKinds: SourceLoginKind[];
}

/** A signed-in session in one source. */
export interface SourceSession {
  sourceId: string;
  sourceType: string;
  displayName: string;
  username: string;
  /** The Alfresco ticket for kind `ticket`, base64(user:pass) for kind `password`. */
  credential: string;
  kind: SourceLoginKind;
}

/** A login-capable source with the session held for it, if any. For rendering. */
export interface SourceSessionView {
  source: ContentSourceDescriptor;
  label: string;
  session: SourceSession | null;
}

/**
 * The ingester's sync-admin account, for the connector, browse and selection endpoints.
 *
 * Not a content source: this credential does not decide which documents anybody can read. It authenticates
 * against the plugin host's own default-deny rule, and what it authorises is reading a connector's settings
 * schema and changing which folders get synced.
 */
export interface IngesterSession {
  username: string;
  credentials: string;  // base64(user:pass), sent as Authorization: Basic <credentials>
}

/** Header that carries one credential per signed-in source, as `<sourceId> <Basic|Ticket> <value>`. */
export const SOURCE_AUTHORIZATION_HEADER = 'X-Source-Authorization';

/**
 * Holds one session per content source, keyed by the source's qualified id.
 *
 * The source list comes from `GET /api/rag/sources`. When that call fails, or a backend without it answers
 * 404, the list falls back to one Alfresco and one Nuxeo at `environment.alfrescoUrl` and
 * `environment.nuxeoUrl`, which is the shape this UI has always had.
 *
 * The first Alfresco and the first Nuxeo in the list are the *primary* ones: the UI can reach them
 * directly, so it signs in to them the way it always has (an Alfresco ticket, a Nuxeo `/api/v1/me` check).
 * Every other source has no URL the UI knows, so it signs in with a password that rag-service checks.
 *
 * Sessions are treated asymmetrically on purpose. An Alfresco ticket is revocable and scoped, so it survives
 * a reload in `sessionStorage`. A password session is a reusable base64(user:pass) that nothing can revoke
 * short of changing the password, so it is held in memory only and a reload ends it.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {

  /** The one web-storage key. It holds ticket sessions only. */
  static readonly SESSIONS_KEY = 'sourceSessions';

  /** Keys written by earlier builds, one per source type. Dropped on start. */
  private static readonly LEGACY_KEYS = ['alfrescoSession', 'nuxeoSession'];

  /** Used when `/api/rag/sources` is not there. Their ids are bare types, as no real id is known. */
  static readonly FALLBACK_SOURCES: readonly ContentSourceDescriptor[] = [
    { sourceId: 'alfresco', sourceType: 'alfresco', displayName: 'Alfresco', loginKinds: ['ticket', 'password'] },
    { sourceId: 'nuxeo', sourceType: 'nuxeo', displayName: 'Nuxeo', loginKinds: ['password'] }
  ];

  private sources$$ = new BehaviorSubject<ContentSourceDescriptor[]>([...AuthService.FALLBACK_SOURCES]);
  /** Whether the list came from `/api/rag/sources` rather than {@link FALLBACK_SOURCES}. */
  private listed = false;
  private sessions$$ = new BehaviorSubject<Map<string, SourceSession>>(new Map());

  /**
   * In memory only, for the same reason as a password session: it is a reusable base64(user:pass) that
   * nothing can revoke short of changing the password, so persisting it would outlive the tab that earned
   * it. A reload ends it and the Sources screen prompts again, which is the correct trade for a credential
   * that authorises a write.
   */
  private ingester$ = new BehaviorSubject<IngesterSession | null>(null);

  readonly sources$ = this.sources$$.asObservable();
  readonly sessions$: Observable<SourceSession[]> = this.sessions$$.pipe(map(m => [...m.values()]));
  readonly ingesterSession$ = this.ingester$.asObservable();

  /** Every login-capable source with its session, in source-list order. */
  readonly sessionViews$: Observable<SourceSessionView[]> =
    combineLatest([this.sources$$, this.sessions$$]).pipe(map(() => this.sessionViews()));

  /** Settles once the source list is loaded and restored sessions are checked. */
  readonly ready: Promise<void>;

  constructor(private http: HttpClient) {
    for (const key of AuthService.LEGACY_KEYS) sessionStorage.removeItem(key);
    this.restoreSessions();

    // Deferred to a microtask on purpose: these calls go over HTTP, which builds the interceptor chain,
    // and the auth interceptor needs this instance. Firing them from the constructor makes that
    // resolution re-enter a half-built AuthService.
    this.ready = Promise.resolve()
      .then(() => this.loadSources())
      .then(() => this.validateSessions());
  }

  // ---- Sources ----

  getSources(): ContentSourceDescriptor[] {
    return this.sources$$.getValue();
  }

  /** Whether rag-service listed its sources, so {@link getSources} is not the fallback pair. */
  hasSourceList(): boolean {
    return this.listed;
  }

  /** The sources a user can sign in to, which are the ones that get a login card. */
  getLoginSources(): ContentSourceDescriptor[] {
    return this.getSources().filter(s => s.loginKinds.length > 0);
  }

  findSource(sourceId: string): ContentSourceDescriptor | undefined {
    return this.getSources().find(s => s.sourceId === sourceId);
  }

  /** Whether the list holds more than one source of this type, so that the type alone names none. */
  hasSeveralSources(sourceType?: string): boolean {
    const type = (sourceType ?? '').toLowerCase();
    return this.getSources().filter(s => s.sourceType === type).length > 1;
  }

  /** Whether any source of this type needs a sign-in. */
  isLoginSourceType(sourceType?: string): boolean {
    const type = (sourceType ?? '').toLowerCase();
    return this.getLoginSources().some(s => s.sourceType === type);
  }

  /** Display name for a source: its configured name, else the type label, else the type and a short id. */
  sourceLabel(source: ContentSourceDescriptor): string {
    return sourceDisplayLabel(source.sourceId, this.getSources());
  }

  /** Label for a hit's source, named the same way as {@link sourceLabel}. */
  resultSourceLabel(sourceType?: string, sourceKey?: string): string {
    return sourceDisplayLabel(sourceKey || sourceType, this.getSources());
  }

  /**
   * Whether this source is the first of its type and of a type the UI can reach directly. Only Alfresco
   * and Nuxeo are, through `environment.alfrescoUrl` and `environment.nuxeoUrl`.
   */
  isPrimary(source: ContentSourceDescriptor): boolean {
    if (source.sourceType !== 'alfresco' && source.sourceType !== 'nuxeo') return false;
    return this.getSources().find(s => s.sourceType === source.sourceType)?.sourceId === source.sourceId;
  }

  /** The kind of session signing in to this source produces. */
  loginKind(source: ContentSourceDescriptor): SourceLoginKind {
    return source.sourceType === 'alfresco' && this.isPrimary(source) ? 'ticket' : 'password';
  }

  /**
   * Whether the source list is the shape the current headers can express: at most one Alfresco, at most
   * one Nuxeo, and no other source with a login. Then the UI keeps sending `Authorization` and
   * `X-Nuxeo-Authorization`, so it works against a backend that does not read `X-Source-Authorization`.
   */
  isLegacyTopology(): boolean {
    const login = this.getLoginSources();
    const count = (type: string) => login.filter(s => s.sourceType === type).length;
    return count('alfresco') <= 1 && count('nuxeo') <= 1
      && login.every(s => s.sourceType === 'alfresco' || s.sourceType === 'nuxeo');
  }

  /**
   * Reads `GET /api/rag/sources`. Any failure, a 404 from an older backend, or a body that is not a list of
   * sources leaves the fallback list in place.
   */
  loadSources(): Promise<void> {
    return firstValueFrom(
      this.http.get<unknown>(`${environment.ragUrl}/sources`).pipe(
        map(body => parseSources(body)),
        catchError(() => of(null))
      )
    ).then(sources => {
      this.listed = !!sources && sources.length > 0;
      this.sources$$.next(this.listed ? sources! : [...AuthService.FALLBACK_SOURCES]);
      this.reconcileSessions();
    });
  }

  // ---- Sessions ----

  getSessions(): SourceSession[] {
    return [...this.sessions$$.getValue().values()];
  }

  getSession(sourceId: string): SourceSession | null {
    return this.sessions$$.getValue().get(sourceId) ?? null;
  }

  isLoggedIn(sourceId: string): boolean {
    return this.sessions$$.getValue().has(sourceId);
  }

  isAnyLoggedIn(): boolean {
    return this.sessions$$.getValue().size > 0;
  }

  hasSessionOfType(sourceType?: string): boolean {
    const type = (sourceType ?? '').toLowerCase();
    return this.getSessions().some(s => s.sourceType === type);
  }

  /**
   * Whether a session covers this `cin_sourceId` value. A value the source list does not name (an older
   * backend, where the list is the fallback) is covered by any session of its type, as before.
   */
  hasSessionForKey(sourceKey: string): boolean {
    if (this.isLoggedIn(sourceKey)) return true;
    if (this.findSource(sourceKey)) return false;
    const idx = sourceKey.indexOf(':');
    return this.hasSessionOfType(idx < 0 ? sourceKey : sourceKey.slice(0, idx));
  }

  /** Every login-capable source with its session, in source-list order. */
  sessionViews(): SourceSessionView[] {
    return this.getLoginSources().map(source => ({
      source,
      label: this.sourceLabel(source),
      session: this.getSession(source.sourceId)
    }));
  }

  /** Signs in to one source and keeps the session. Other sources' sessions are untouched. */
  login(sourceId: string, username: string, password: string): Promise<void> {
    return firstValueFrom(this.authenticate(sourceId, username, password)).then(session => {
      this.putSession(session);
    });
  }

  logout(sourceId: string): void {
    const next = new Map(this.sessions$$.getValue());
    if (!next.delete(sourceId)) return;
    this.sessions$$.next(next);
    this.persistSessions();
  }

  /**
   * Checks a credential for one source and returns the session, without storing it. The permission
   * comparison uses it directly.
   *
   * - Primary Alfresco: posts to the tickets endpoint and keeps the ticket.
   * - Primary Nuxeo: calls `/api/v1/me` with Basic auth, which also resolves the user id.
   * - Anything else: the UI has no URL for it, so rag-service checks the password. The probe is
   *   `GET /api/status` carrying only this source's `X-Source-Authorization`; a 401 means wrong credentials.
   */
  authenticate(sourceId: string, username: string, password: string): Observable<SourceSession> {
    const source = this.findSource(sourceId);
    if (!source) {
      return new Observable(observer => observer.error(new Error(`Unknown source ${sourceId}`)));
    }
    const base = { sourceId, sourceType: source.sourceType, displayName: source.displayName };

    if (this.loginKind(source) === 'ticket') {
      const url = `${environment.alfrescoUrl}/alfresco/api/-default-/public/authentication/versions/1/tickets`;
      return this.http
        .post<{ entry: { id: string } }>(url, { userId: username, password })
        .pipe(map(resp => {
          const ticket = resp?.entry?.id;
          if (!ticket) throw new Error('No ticket in Alfresco response');
          return { ...base, username, credential: ticket, kind: 'ticket' as const };
        }));
    }

    const credential = btoa(`${username}:${password}`);
    if (source.sourceType === 'nuxeo' && this.isPrimary(source)) {
      const headers = new HttpHeaders({ Authorization: `Basic ${credential}` });
      return this.http
        .get<{ id?: string; username?: string }>(`${environment.nuxeoUrl}/api/v1/me`, { headers })
        .pipe(map(resp => ({
          ...base,
          username: resp?.id ?? resp?.username ?? username,
          credential,
          kind: 'password' as const
        })));
    }

    const session: SourceSession = { ...base, username, credential, kind: 'password' };
    return this.probe(session).pipe(map(() => session));
  }

  // ---- Credential headers ----

  /** The credential headers for every held session, for rag-service and its status endpoint. */
  credentialHeaders(): Record<string, string> {
    return this.headersFor(this.getSessions());
  }

  /**
   * The credential headers for a set of sessions.
   *
   * In the legacy topology (see {@link isLegacyTopology}) these are today's headers:
   * - Alfresco and Nuxeo: `Authorization` (Alfresco ticket) + `X-Nuxeo-Authorization` (Nuxeo Basic)
   * - Alfresco only:      `Authorization: Basic base64(TICKET_...:)`
   * - Nuxeo only:         `Authorization: Basic base64(user:pass)`
   *
   * Otherwise one `X-Source-Authorization` value per session, `<sourceId> Ticket <ticket>` or
   * `<sourceId> Basic <base64(user:pass)>`. A browser joins repeated values of one header with a comma,
   * so they are sent as one comma-separated header.
   */
  headersFor(sessions: readonly SourceSession[]): Record<string, string> {
    if (sessions.length === 0) return {};

    if (this.isLegacyTopology()) {
      const alf = sessions.find(s => s.sourceType === 'alfresco');
      const nux = sessions.find(s => s.sourceType === 'nuxeo');
      if (alf && nux) {
        return { Authorization: basicFor(alf), 'X-Nuxeo-Authorization': `Basic ${nux.credential}` };
      }
      if (alf) return { Authorization: basicFor(alf) };
      if (nux) return { Authorization: `Basic ${nux.credential}` };
      return {};
    }

    return {
      [SOURCE_AUTHORIZATION_HEADER]: sessions
        .map(s => `${s.sourceId} ${s.kind === 'ticket' ? 'Ticket' : 'Basic'} ${s.credential}`)
        .join(', ')
    };
  }

  // ---- Ingester sync-admin (the connector endpoints) ----

  /**
   * Validates the sync-admin credential against the connector listing, and keeps it if it works.
   *
   * `GET /api/connectors` is the cheapest authenticated read the host offers and returns only descriptors,
   * never setting values, so using it to check a password cannot leak one. There is no `/me` equivalent here:
   * the host authenticates a credential but has no notion of a user profile to return.
   */
  loginIngester(username: string, password: string): Promise<void> {
    const urls = resolveConnectorUrls();
    if (!urls) {
      return Promise.reject(new Error('No connector host is configured for this deployment.'));
    }
    const credentials = btoa(`${username}:${password}`);
    const headers = new HttpHeaders({ Authorization: `Basic ${credentials}` });
    return this.http
      .get(urls.connectors, { headers })
      .toPromise()
      .then(() => {
        this.ingester$.next({ username, credentials });
      });
  }

  logoutIngester(): void {
    this.ingester$.next(null);
  }

  getIngesterSession(): IngesterSession | null {
    return this.ingester$.getValue();
  }

  isIngesterLoggedIn(): boolean {
    return this.ingester$.getValue() !== null;
  }

  // ---- Session Validation ----

  /**
   * Validates every held session. Called after the source list loads, and by the interceptor on a 401.
   * Invalid sessions are logged out.
   */
  validateSessions(): Promise<void> {
    const sessions = this.getSessions();
    if (sessions.length === 0) return Promise.resolve();

    return Promise.all(sessions.map(session =>
      firstValueFrom(this.validateSession(session)).then(valid => {
        if (!valid) {
          console.warn(`Session for ${session.sourceId} invalid, logging out`);
          this.logout(session.sourceId);
        }
      })
    )).then(() => {});
  }

  private validateSession(session: SourceSession): Observable<boolean> {
    const source = this.findSource(session.sourceId);
    let check: Observable<unknown>;

    if (source && this.isPrimary(source) && session.sourceType === 'alfresco' && session.kind === 'ticket') {
      const headers = new HttpHeaders({ Authorization: `Basic ${btoa(session.credential + ':')}` });
      check = this.http.get(
        `${environment.alfrescoUrl}/alfresco/api/-default-/public/alfresco/versions/1/people/-me-`, { headers });
    } else if (source && this.isPrimary(source) && session.sourceType === 'nuxeo') {
      const headers = new HttpHeaders({ Authorization: `Basic ${session.credential}` });
      check = this.http.get(`${environment.nuxeoUrl}/api/v1/me`, { headers });
    } else {
      check = this.probe(session);
    }

    return check.pipe(map(() => true), catchError(() => of(false)));
  }

  /** An authenticated rag-service read carrying only this one session's credential. */
  private probe(session: SourceSession): Observable<unknown> {
    const value = `${session.sourceId} ${session.kind === 'ticket' ? 'Ticket' : 'Basic'} ${session.credential}`;
    const headers = new HttpHeaders({ [SOURCE_AUTHORIZATION_HEADER]: value });
    return this.http.get(resolveStatusUrl(), { headers });
  }

  // ---- Storage ----

  private putSession(session: SourceSession): void {
    const next = new Map(this.sessions$$.getValue());
    next.set(session.sourceId, session);
    this.sessions$$.next(next);
    this.persistSessions();
  }

  /** Writes the ticket sessions. A password session never reaches web storage. */
  private persistSessions(): void {
    const tickets = this.getSessions().filter(s => s.kind === 'ticket');
    if (tickets.length === 0) {
      sessionStorage.removeItem(AuthService.SESSIONS_KEY);
    } else {
      sessionStorage.setItem(AuthService.SESSIONS_KEY, JSON.stringify(tickets));
    }
  }

  private restoreSessions(): void {
    let stored: unknown;
    try {
      stored = JSON.parse(sessionStorage.getItem(AuthService.SESSIONS_KEY) ?? '[]');
    } catch {
      stored = [];
    }
    const restored = new Map<string, SourceSession>();
    for (const s of Array.isArray(stored) ? stored : []) {
      if (s && s.kind === 'ticket' && typeof s.sourceId === 'string' && typeof s.credential === 'string') {
        restored.set(s.sourceId, s as SourceSession);
      }
    }
    this.sessions$$.next(restored);
  }

  /**
   * Fits held sessions to a newly loaded source list. A session whose source is not listed moves to the
   * one login source of its type, if there is exactly one, and is dropped otherwise. That keeps a ticket
   * across a reload in which the list switched between the fallback ids and the real ones.
   */
  private reconcileSessions(): void {
    const current = this.sessions$$.getValue();
    if (current.size === 0) return;

    const next = new Map<string, SourceSession>();
    for (const session of current.values()) {
      let source = this.findSource(session.sourceId);
      if (!source || source.loginKinds.length === 0) {
        const sameType = this.getLoginSources().filter(s => s.sourceType === session.sourceType);
        source = sameType.length === 1 ? sameType[0] : undefined;
      }
      if (source && !next.has(source.sourceId)) {
        next.set(source.sourceId, { ...session, sourceId: source.sourceId, displayName: source.displayName });
      }
    }
    this.sessions$$.next(next);
    this.persistSessions();
  }
}

/** The legacy `Authorization` value for an Alfresco session. */
function basicFor(session: SourceSession): string {
  return session.kind === 'ticket'
    ? `Basic ${btoa(session.credential + ':')}`
    : `Basic ${session.credential}`;
}

/** The source list from a `/api/rag/sources` body, or null when it is not one. */
function parseSources(body: unknown): ContentSourceDescriptor[] | null {
  if (!Array.isArray(body)) return null;
  const sources: ContentSourceDescriptor[] = [];
  for (const entry of body) {
    if (!entry || typeof entry.sourceId !== 'string' || typeof entry.sourceType !== 'string') continue;
    const sourceType = entry.sourceType.trim().toLowerCase();
    sources.push({
      sourceId: entry.sourceId,
      sourceType,
      displayName: typeof entry.displayName === 'string' ? entry.displayName : '',
      loginKinds: Array.isArray(entry.loginKinds)
        ? entry.loginKinds.filter((k: unknown): k is SourceLoginKind => k === 'password' || k === 'ticket')
        : []
    });
  }
  return sources;
}
