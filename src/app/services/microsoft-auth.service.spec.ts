import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AccountInfo, InteractionRequiredAuthError, IPublicClientApplication } from '@azure/msal-browser';

import { AuthService, ContentSourceDescriptor, MICROSOFT_SOURCE } from './auth.service';
import { MicrosoftAuthService, MicrosoftSignIn, defaultMsalFactory } from './microsoft-auth.service';
import { AuthHttpInterceptor } from '../interceptors/auth.interceptor';
import { environment } from '../../environments/environment';

const SOURCES_URL = '/api/rag/sources';
const CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';
const TENANT_ID = '00000000-0000-4000-8000-0000000000a1';

const ALF: ContentSourceDescriptor = {
  sourceId: 'alfresco:aaa', sourceType: 'alfresco', displayName: 'Alfresco', loginKinds: ['ticket', 'password']
};
const NUX: ContentSourceDescriptor = {
  sourceId: 'nuxeo:prod', sourceType: 'nuxeo', displayName: 'Nuxeo', loginKinds: ['password']
};

function settle(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Stands in for MSAL, so nothing here talks to Entra ID. */
class FakeMicrosoft {
  enabled = true;
  signedIn: MicrosoftSignIn | null = null;
  token: string | null = 'token-1';
  signOuts = 0;
  signIn(): Promise<MicrosoftSignIn> {
    this.signedIn = { username: 'sarah@contoso.com', name: 'Sarah', accessToken: this.token! };
    return Promise.resolve(this.signedIn);
  }
  restore(): Promise<MicrosoftSignIn | null> { return Promise.resolve(this.signedIn); }
  accessToken(): Promise<string | null> { return Promise.resolve(this.signedIn ? this.token : null); }
  signOut(): Promise<void> { this.signOuts++; this.signedIn = null; return Promise.resolve(); }
}

describe('Microsoft sign-in', () => {

  let http: HttpClient;
  let httpMock: HttpTestingController;
  let microsoft: FakeMicrosoft;

  beforeEach(() => {
    sessionStorage.clear();
    microsoft = new FakeMicrosoft();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: AuthHttpInterceptor, multi: true },
        { provide: MicrosoftAuthService, useValue: microsoft }
      ]
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => sessionStorage.clear());

  async function serviceWith(sources: ContentSourceDescriptor[]): Promise<AuthService> {
    const service = TestBed.inject(AuthService);
    await settle();
    httpMock.expectOne(SOURCES_URL).flush(sources);
    await settle();
    return service;
  }

  async function signInWithMicrosoft(service: AuthService): Promise<void> {
    await service.loginWithMicrosoft(MICROSOFT_SOURCE.sourceId);
  }

  it('addsAMicrosoftLoginWhenItIsConfigured', async () => {
    const service = await serviceWith([ALF, NUX]);

    expect(service.getLoginSources().map(s => s.sourceId)).toEqual(['alfresco:aaa', 'nuxeo:prod', 'sharepoint']);
    expect(service.loginKind(MICROSOFT_SOURCE)).toBe('entra');
  });

  it('addsNoMicrosoftLoginWhenItIsNotConfigured', async () => {
    microsoft.enabled = false;
    const service = await serviceWith([ALF, NUX]);

    expect(service.getLoginSources().map(s => s.sourceId)).toEqual(['alfresco:aaa', 'nuxeo:prod']);
  });

  it('keepsTheLegacyHeadersForAlfrescoAndNuxeoWhenMicrosoftIsMerelyOffered', async () => {
    const service = await serviceWith([ALF, NUX]);

    expect(service.isLegacyTopology()).toBeTrue();
  });

  it('signsInAndShowsWhoTheUserIs', async () => {
    const service = await serviceWith([ALF]);

    await signInWithMicrosoft(service);

    const session = service.getSession('sharepoint');
    expect(session?.kind).toBe('entra');
    expect(session?.username).toBe('sarah@contoso.com');
    expect(service.hasSessionForKey('sharepoint:demo-site')).toBeTrue();
  });

  it('sendsTheTokenAloneToRagService', async () => {
    const service = await serviceWith([ALF]);
    const alfLogin = service.login('alfresco:aaa', 'admin', 'admin');
    httpMock.expectOne(r => r.url.endsWith('/tickets')).flush({ entry: { id: 'TICKET_1' } });
    await alfLogin;
    await signInWithMicrosoft(service);

    http.get('/api/rag/search/semantic').subscribe();
    await settle();

    const request = httpMock.expectOne('/api/rag/search/semantic');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request.request.headers.has('X-Nuxeo-Authorization')).toBeFalse();
    expect(request.request.headers.has('X-Source-Authorization')).toBeFalse();
    request.flush({});
  });

  it('sendsTheRenewedTokenWhenMsalHasRefreshedIt', async () => {
    const service = await serviceWith([]);
    await signInWithMicrosoft(service);
    microsoft.token = 'token-2';

    http.get('/api/rag/search/semantic').subscribe();
    await settle();

    httpMock.expectOne('/api/rag/search/semantic').flush({});
    expect(service.getSession('sharepoint')?.credential).toBe('token-2');
  });

  it('dropsTheSessionAndSendsNoCredentialWhenTheTokenCanNoLongerBeRenewed', async () => {
    const service = await serviceWith([]);
    await signInWithMicrosoft(service);
    microsoft.token = null;

    http.get('/api/rag/search/semantic').subscribe();
    await settle();

    const request = httpMock.expectOne('/api/rag/search/semantic');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    expect(service.hasMicrosoftSession()).toBeFalse();
    request.flush({});
  });

  it('signsOutLocallyAndLeavesLaterRequestsUnauthenticated', async () => {
    const service = await serviceWith([]);
    await signInWithMicrosoft(service);

    service.logout('sharepoint');
    await settle();

    expect(microsoft.signOuts).toBe(1);
    http.get('/api/rag/search/semantic').subscribe();
    await settle();
    const request = httpMock.expectOne('/api/rag/search/semantic');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({});
  });

  it('neverWritesTheTokenUnderItsOwnStorageKey', async () => {
    const service = await serviceWith([]);
    await signInWithMicrosoft(service);

    expect(sessionStorage.getItem(AuthService.SESSIONS_KEY)).toBeNull();
  });

  it('restoresASignInMsalStillHolds', async () => {
    microsoft.signedIn = { username: 'alex@contoso.com', name: 'Alex', accessToken: 'token-1' };

    const service = await serviceWith([]);
    await settle();
    // validateSessions probes the status endpoint with the restored token.
    const probe = httpMock.expectOne('/api/status');
    expect(probe.request.headers.get('Authorization')).toBe('Bearer token-1');
    probe.flush({});
    await settle();

    expect(service.getSession('sharepoint')?.username).toBe('alex@contoso.com');
  });
});

describe('MicrosoftAuthService', () => {

  let originalClient: string;
  let originalTenant: string;
  let msal: jasmine.SpyObj<IPublicClientApplication>;
  const account = { username: 'alex@contoso.com', name: 'Alex' } as AccountInfo;

  beforeEach(() => {
    originalClient = environment.entraClientId;
    originalTenant = environment.entraTenantId;
    environment.entraClientId = CLIENT_ID;
    environment.entraTenantId = TENANT_ID;
    msal = jasmine.createSpyObj<IPublicClientApplication>('msal', [
      'initialize', 'loginPopup', 'setActiveAccount', 'getActiveAccount', 'getAllAccounts',
      'acquireTokenSilent', 'clearCache'
    ]);
    msal.initialize.and.resolveTo();
    msal.clearCache.and.resolveTo();
    MicrosoftAuthService.factory = () => msal;
  });

  afterEach(() => {
    environment.entraClientId = originalClient;
    environment.entraTenantId = originalTenant;
    MicrosoftAuthService.factory = defaultMsalFactory;
  });

  it('isOffUntilBothIdsAreConfigured', () => {
    environment.entraTenantId = '';
    expect(new MicrosoftAuthService().enabled).toBeFalse();
  });

  it('asksForThisApplicationsOwnScopeAndNeverForGraph', async () => {
    msal.loginPopup.and.resolveTo({ account, accessToken: 'tok' } as never);

    await new MicrosoftAuthService().signIn();

    const scopes = msal.loginPopup.calls.mostRecent().args[0]!.scopes;
    expect(scopes).toEqual([`api://${CLIENT_ID}/access_as_user`]);
    expect(scopes.join(' ')).not.toContain('graph.microsoft.com');
  });

  it('answersNullWhenRenewalNeedsTheUserAgain', async () => {
    msal.getActiveAccount.and.returnValue(account);
    msal.acquireTokenSilent.and.rejectWith(new InteractionRequiredAuthError('login_required'));

    expect(await new MicrosoftAuthService().accessToken()).toBeNull();
  });

  it('clearsTheCacheOnSignOut', async () => {
    msal.loginPopup.and.resolveTo({ account, accessToken: 'tok' } as never);
    const service = new MicrosoftAuthService();
    await service.signIn();

    await service.signOut();

    expect(msal.setActiveAccount).toHaveBeenCalledWith(null);
    expect(msal.clearCache).toHaveBeenCalled();
  });
});
