import { Injectable, Injector } from '@angular/core';
import {
  HttpEvent, HttpHandler, HttpInterceptor, HttpRequest
} from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService, SOURCE_AUTHORIZATION_HEADER } from '../services/auth.service';
import { environment } from '../../environments/environment';
import { connectorPathPrefixes, resolveConnectorUrls, resolveStatusUrl } from '../utils/api-paths';

/**
 * Attaches authentication headers to outbound requests that need them.
 *
 * Two independent credential paths, because they authenticate against different things.
 *
 * **The RAG service and the status endpoint** carry the content-source sessions, which are what decide the
 * documents a caller may read. {@link AuthService.credentialHeaders} decides their shape:
 * - One Alfresco and one Nuxeo at most, as today: Authorization (Alfresco ticket) and, with both,
 *   X-Nuxeo-Authorization (Nuxeo Basic). Nuxeo alone goes as Authorization: Basic base64(user:pass), and
 *   the backend MultiSourceAuthenticationProvider tries Alfresco (fails) then falls back to Nuxeo.
 * - Any other source list: one X-Source-Authorization value per session, `<sourceId> Basic|Ticket <value>`.
 * - A Microsoft session: Authorization: Bearer <token> and nothing else, renewed through MSAL before each
 *   request. The token is for this application's own API, never for Microsoft Graph.
 *
 * **The plugin host's connector endpoints** carry the ingester's sync-admin credential instead. That one
 * authorises reading a connector's settings schema and changing which folders sync; it has nothing to do with
 * document permissions, and sending a repository session to those paths would simply 401.
 *
 * Requests matching neither are passed through unchanged.
 */
@Injectable()
export class AuthHttpInterceptor implements HttpInterceptor {

  constructor(private injector: Injector) {}

  /**
   * Resolved per request instead of injected.
   *
   * AuthService validates restored sessions over HTTP from its own constructor, so the first
   * request of the app's life can be issued while AuthService is still being built. Injecting it
   * here makes this singleton capture that half-built instance and keep it forever, and every later
   * request then dies on it with "credentialHeaders is not a function" before it is even sent.
   */
  private get auth(): AuthService {
    return this.injector.get(AuthService);
  }

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (this.isConnectorRequest(req.url)) {
      return this.handleConnectorRequest(req, next);
    }
    if (!this.isRagRequest(req.url)) {
      return next.handle(req);
    }

    // Comparison-mode requests and login probes carry explicit auth headers — don't overwrite them
    if (req.headers.has('Authorization') || req.headers.has(SOURCE_AUTHORIZATION_HEADER)) {
      return next.handle(req);
    }

    if (this.auth.hasMicrosoftSession()) {
      return from(this.auth.refreshMicrosoftToken()).pipe(
        switchMap(token => this.send(req, next, token ? { Authorization: `Bearer ${token}` } : {})));
    }
    return this.send(req, next, this.auth.credentialHeaders());
  }

  private send(req: HttpRequest<unknown>, next: HttpHandler,
               credentials: Record<string, string>): Observable<HttpEvent<unknown>> {
    if (Object.keys(credentials).length === 0) {
      return next.handle(req);
    }

    let headers = req.headers;
    for (const [name, value] of Object.entries(credentials)) {
      headers = headers.set(name, value);
    }

    return next.handle(req.clone({ headers })).pipe(
      catchError(err => {
        if (err.status === 401) {
          this.auth.validateSessions();
        }
        return throwError(() => err);
      })
    );
  }

  /**
   * A connector request, carrying the sync-admin credential when one has been entered.
   *
   * A request with no credential is still sent rather than short-circuited, deliberately: the 401 it comes
   * back with is what tells the screen to prompt, and it distinguishes "no credential yet" from "the host is
   * not there", which a 502 would report instead. Short-circuiting here would make those look the same.
   *
   * A 401 drops the stored credential. Without that, a password changed underneath the app would leave every
   * later request retrying the same rejected header, and the screen would show an error it could not explain.
   */
  private handleConnectorRequest(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (req.headers.has('Authorization')) {
      return next.handle(req);
    }
    const session = this.auth.getIngesterSession();
    const outbound = session
      ? req.clone({ headers: req.headers.set('Authorization', `Basic ${session.credentials}`) })
      : req;

    return next.handle(outbound).pipe(
      catchError(err => {
        if (err.status === 401 && session) {
          this.auth.logoutIngester();
        }
        return throwError(() => err);
      })
    );
  }

  /**
   * Whether this URL is one of the plugin host's endpoints.
   *
   * Compared by path prefix against the set derived from the one configured connectors URL, so the
   * interceptor and the callers cannot disagree about where those endpoints live. Getting that wrong is not a
   * subtle failure: a path this misses gets no credential, comes back 401 with a Basic challenge, and the
   * browser puts its own password box over the application.
   */
  private isConnectorRequest(url: string): boolean {
    const prefixes = connectorPathPrefixes(resolveConnectorUrls());
    if (prefixes.length === 0) {
      return false;
    }
    const reqPath = this.pathOf(url);
    return reqPath !== null && prefixes.some(prefix => reqPath === prefix || reqPath.startsWith(`${prefix}/`));
  }

  // Match by URL path so that stripped default ports (e.g. :80) don't break
  // the comparison when ragUrl contains an explicit port. /api/status is authenticated like the
  // rest of the API but is a sibling of /api/rag, so a prefix test alone misses it.
  private isRagRequest(url: string): boolean {
    try {
      const ragPath = new URL(environment.ragUrl, window.location.origin).pathname;
      const statusPath = new URL(resolveStatusUrl(), window.location.origin).pathname;
      const reqPath = new URL(url, window.location.origin).pathname;
      return reqPath.startsWith(ragPath) || reqPath === statusPath;
    } catch {
      return url.startsWith(environment.ragUrl) || url === resolveStatusUrl();
    }
  }

  private pathOf(url: string): string | null {
    try {
      return new URL(url, window.location.origin).pathname;
    } catch {
      return null;
    }
  }
}
