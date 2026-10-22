import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthHttpInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

/**
 * Which credential goes to which service.
 *
 * The two paths authenticate against different things: rag-service takes a content-source session that decides
 * what a caller may read, and the plugin host takes the ingester's sync-admin account, which authorises
 * changing a sync scope. Sending either to the other simply 401s.
 */
describe('AuthHttpInterceptor', () => {

  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let originalConnectorsUrl: string;

  beforeEach(() => {
    sessionStorage.clear();
    originalConnectorsUrl = environment.connectorsUrl;
    environment.connectorsUrl = '/api/connectors';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: AuthHttpInterceptor, multi: true }
      ]
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    environment.connectorsUrl = originalConnectorsUrl;
    sessionStorage.clear();
  });

  function signInToIngester(): void {
    const login = auth.loginIngester('svc', 'pw');
    httpMock.expectOne('/api/connectors').flush({ connectors: [], problems: [] });
    return void login;
  }

  it('attaches the sync-admin credential to a connector request', async () => {
    signInToIngester();
    await Promise.resolve();

    http.get('/api/browse/roots').subscribe();

    const request = httpMock.expectOne('/api/browse/roots');
    expect(request.request.headers.get('Authorization')).toBe(`Basic ${btoa('svc:pw')}`);
    request.flush({ sourceType: 'sharepoint', resolvedFrom: 'connector', roots: [], problems: [] });
  });

  it('covers every connector path, including the selection write and the host status', async () => {
    signInToIngester();
    await Promise.resolve();

    for (const url of ['/api/connectors/schema', '/api/selection', '/api/sync/configured',
      '/api/connector-status']) {
      http.get(url).subscribe({ error: () => {} });
      const request = httpMock.expectOne(url);
      expect(request.request.headers.get('Authorization'))
        .withContext(url)
        .toBe(`Basic ${btoa('svc:pw')}`);
      request.flush({});
    }
  });

  /**
   * Sent anyway, rather than short-circuited. The 401 is what tells the screen to prompt, and it is what
   * distinguishes "no credential yet" from "the host is not reachable", which answers 502 instead.
   */
  it('still sends a connector request with no credential, so the 401 can be acted on', () => {
    http.get('/api/selection').subscribe({ error: () => {} });

    const request = httpMock.expectOne('/api/selection');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush('denied', { status: 401, statusText: 'Unauthorized' });
  });

  /**
   * A password changed underneath the app would otherwise leave every later request retrying the same
   * rejected header, and the screen would report an error it could not explain.
   */
  it('drops a rejected credential so the screen prompts again instead of retrying it', async () => {
    signInToIngester();
    await Promise.resolve();
    expect(auth.isIngesterLoggedIn()).toBe(true);

    http.get('/api/selection').subscribe({ error: () => {} });
    httpMock.expectOne('/api/selection').flush('denied', { status: 401, statusText: 'Unauthorized' });

    expect(auth.isIngesterLoggedIn()).toBe(false);
  });

  it('does not send the sync-admin credential to the RAG service', async () => {
    signInToIngester();
    await Promise.resolve();

    http.get('/api/rag/health').subscribe({ error: () => {} });

    // No repository session is active, so this request goes out bare. The ingester credential must not leak
    // onto it: it is a different service, and sending it there would authenticate nothing while exposing it.
    const request = httpMock.expectOne('/api/rag/health');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('leaves a request that is neither RAG nor connector untouched', () => {
    http.get('/assets/config.json').subscribe();

    const request = httpMock.expectOne('/assets/config.json');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('treats no configured connector host as no connector paths', () => {
    environment.connectorsUrl = '';

    http.get('/api/selection').subscribe({ error: () => {} });

    // Nothing is a connector path now, so this falls through untouched rather than being decorated.
    const request = httpMock.expectOne('/api/selection');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  describe('content-source sessions on RAG requests', () => {

    const ALF_A = { sourceId: 'alfresco:aaa', sourceType: 'alfresco', displayName: 'Main', loginKinds: ['ticket'] };
    const ALF_B = { sourceId: 'alfresco:bbb', sourceType: 'alfresco', displayName: 'Archive', loginKinds: ['password'] };
    const NUX = { sourceId: 'nuxeo:prod', sourceType: 'nuxeo', displayName: 'Nuxeo', loginKinds: ['password'] };

    async function sourcesAre(sources: unknown[]): Promise<void> {
      await new Promise(resolve => setTimeout(resolve, 0));
      httpMock.expectOne('/api/rag/sources').flush(sources);
      await auth.ready;
    }

    async function signInAlfresco(sourceId: string): Promise<void> {
      const login = auth.login(sourceId, 'admin', 'admin');
      httpMock.expectOne(r => r.url.endsWith('/tickets')).flush({ entry: { id: 'TICKET_A' } });
      await login;
    }

    it('keeps the current headers for one Alfresco and one Nuxeo', async () => {
      await sourcesAre([ALF_A, NUX]);
      await signInAlfresco('alfresco:aaa');
      const nuxeo = auth.login('nuxeo:prod', 'jdoe', 'pw');
      httpMock.expectOne('/nuxeo/api/v1/me').flush({ id: 'jdoe' });
      await nuxeo;

      http.post('/api/rag/search/semantic', {}).subscribe();

      const request = httpMock.expectOne('/api/rag/search/semantic');
      expect(request.request.headers.get('Authorization')).toBe(`Basic ${btoa('TICKET_A:')}`);
      expect(request.request.headers.get('X-Nuxeo-Authorization')).toBe(`Basic ${btoa('jdoe:pw')}`);
      expect(request.request.headers.has('X-Source-Authorization')).toBe(false);
      request.flush({ results: [] });
    });

    it('sends one X-Source-Authorization value per session with two Alfresco sources', async () => {
      await sourcesAre([ALF_A, ALF_B, NUX]);
      await signInAlfresco('alfresco:aaa');
      const second = auth.login('alfresco:bbb', 'jdoe', 'pw');
      httpMock.expectOne('/api/status').flush({});
      await second;

      http.get('/api/status').subscribe();

      const request = httpMock.expectOne('/api/status');
      expect(request.request.headers.get('X-Source-Authorization'))
        .toBe(`alfresco:aaa Ticket TICKET_A, alfresco:bbb Basic ${btoa('jdoe:pw')}`);
      expect(request.request.headers.has('Authorization')).toBe(false);
      expect(request.request.headers.has('X-Nuxeo-Authorization')).toBe(false);
      request.flush({});
    });

    it('leaves an explicit X-Source-Authorization alone', async () => {
      await sourcesAre([ALF_A, ALF_B]);
      await signInAlfresco('alfresco:aaa');

      http.get('/api/status', { headers: { 'X-Source-Authorization': 'alfresco:bbb Basic eDp5' } }).subscribe();

      const request = httpMock.expectOne('/api/status');
      expect(request.request.headers.get('X-Source-Authorization')).toBe('alfresco:bbb Basic eDp5');
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    });
  });
});
