import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService, ContentSourceDescriptor, SourceSession } from './auth.service';

const SOURCES_URL = '/api/rag/sources';
const STATUS_URL = '/api/status';
const ALFRESCO_ME_URL = '/alfresco/api/-default-/public/alfresco/versions/1/people/-me-';
const NUXEO_ME_URL = '/nuxeo/api/v1/me';

const ALF_A: ContentSourceDescriptor = {
  sourceId: 'alfresco:aaa', sourceType: 'alfresco', displayName: 'Alfresco Main', loginKinds: ['ticket', 'password']
};
const ALF_B: ContentSourceDescriptor = {
  sourceId: 'alfresco:bbb', sourceType: 'alfresco', displayName: 'Alfresco Archive', loginKinds: ['password']
};
const NUX: ContentSourceDescriptor = {
  sourceId: 'nuxeo:prod', sourceType: 'nuxeo', displayName: 'Nuxeo', loginKinds: ['password']
};
const FILES: ContentSourceDescriptor = {
  sourceId: 'filesystem:local', sourceType: 'filesystem', displayName: 'Files', loginKinds: []
};

/** Lets the constructor's deferred calls run before assertions. */
function settle(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

describe('AuthService', () => {

  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  /** Builds the service and answers its source-list request. */
  async function serviceWith(sources: ContentSourceDescriptor[] | 'missing'): Promise<AuthService> {
    const service = TestBed.inject(AuthService);
    await settle();
    const request = httpMock.expectOne(SOURCES_URL);
    if (sources === 'missing') {
      request.flush('not found', { status: 404, statusText: 'Not Found' });
    } else {
      request.flush(sources);
    }
    await settle();
    return service;
  }

  async function loginAlfrescoTicket(service: AuthService, sourceId: string, ticket: string): Promise<void> {
    const login = service.login(sourceId, 'admin', 'admin');
    httpMock.expectOne(r => r.url.endsWith('/tickets')).flush({ entry: { id: ticket } });
    await login;
  }

  describe('source list', () => {

    it('fallsBackToOneAlfrescoAndOneNuxeoWhenTheBackendHasNoSourceList', async () => {
      const service = await serviceWith('missing');

      expect(service.getLoginSources().map(s => s.sourceType)).toEqual(['alfresco', 'nuxeo']);
      expect(service.sessionViews().map(v => v.label)).toEqual(['Alfresco', 'Nuxeo']);
      expect(service.isLegacyTopology()).toBeTrue();
    });

    it('fallsBackWhenTheCallFailsOrTheBodyIsNotAList', async () => {
      const service = TestBed.inject(AuthService);
      await settle();
      httpMock.expectOne(SOURCES_URL).error(new ProgressEvent('network error'));
      await settle();
      expect(service.getSources().map(s => s.sourceId)).toEqual(['alfresco', 'nuxeo']);

      const reload = service.loadSources();
      httpMock.expectOne(SOURCES_URL).flush({ unexpected: true });
      await reload;
      expect(service.getSources().map(s => s.sourceId)).toEqual(['alfresco', 'nuxeo']);
    });

    it('rendersOneLoginEntryPerSourceWithALoginAndNamesSameTypeSourcesApart', async () => {
      const service = await serviceWith([ALF_A, ALF_B, NUX, FILES]);

      // The filesystem source has no login, so it gets no card.
      expect(service.getLoginSources().map(s => s.sourceId)).toEqual(['alfresco:aaa', 'alfresco:bbb', 'nuxeo:prod']);
      // Two Alfresco sources need their display names; the one Nuxeo keeps the type label.
      expect(service.sessionViews().map(v => v.label)).toEqual(['Alfresco Main', 'Alfresco Archive', 'Nuxeo']);
      expect(service.isLegacyTopology()).toBeFalse();
      expect(service.hasSeveralSources('alfresco')).toBeTrue();
      expect(service.hasSeveralSources('nuxeo')).toBeFalse();
    });

    it('keepsTheTypeLabelForOneAlfrescoAndOneNuxeo', async () => {
      // rag-service answers the type label as the display name of the only source of a type.
      const service = await serviceWith([{ ...ALF_A, displayName: 'Alfresco' }, NUX]);

      expect(service.sessionViews().map(v => v.label)).toEqual(['Alfresco', 'Nuxeo']);
      expect(service.isLegacyTopology()).toBeTrue();
      expect(service.resultSourceLabel('alfresco', 'alfresco:aaa')).toBe('Alfresco');
    });

    it('labelsAResultByTheDisplayNameOfItsSource', async () => {
      const service = await serviceWith([ALF_A, ALF_B, NUX]);

      expect(service.resultSourceLabel('alfresco', 'alfresco:bbb')).toBe('Alfresco Archive');
      expect(service.resultSourceLabel('nuxeo', 'nuxeo:prod')).toBe('Nuxeo');
      // Without a source id the type alone names no single source.
      expect(service.resultSourceLabel('alfresco')).toBe('Alfresco');
    });

    it('labelsASourceWithoutAConfiguredNameByAShortId', async () => {
      // rag-service fills an unnamed source's display name with the type and the full id.
      const service = await serviceWith([
        { ...ALF_A, sourceId: 'alfresco:55d96fae-1', displayName: 'Alfresco (55d96fae-1)' },
        { ...ALF_B, sourceId: 'alfresco:5ce58fd0-2', displayName: 'Alfresco (5ce58fd0-2)' }
      ]);

      expect(service.sessionViews().map(v => v.label)).toEqual(['Alfresco (55d9)', 'Alfresco (5ce5)']);
      expect(service.resultSourceLabel('alfresco', 'alfresco:5ce58fd0-2')).toBe('Alfresco (5ce5)');
    });
  });

  describe('sessions', () => {

    it('keepsThePrimaryNuxeoCredentialInMemoryAndOutOfSessionStorage', async () => {
      const service = await serviceWith([ALF_A, NUX]);

      const login = service.login('nuxeo:prod', 'jdoe', 'secret');
      const request = httpMock.expectOne(NUXEO_ME_URL);
      expect(request.request.headers.get('Authorization')).toBe(`Basic ${btoa('jdoe:secret')}`);
      request.flush({ id: 'jdoe' });
      await login;

      expect(service.getSession('nuxeo:prod')).toEqual({
        sourceId: 'nuxeo:prod', sourceType: 'nuxeo', displayName: 'Nuxeo',
        username: 'jdoe', credential: btoa('jdoe:secret'), kind: 'password'
      });
      // ...but it must never reach web storage, where any script on the origin could read it back.
      expect(sessionStorage.length).toBe(0);
    });

    it('storesTicketSessionsUnderOneKeyAndRehydratesThem', async () => {
      let service = await serviceWith([ALF_A, NUX]);
      await loginAlfrescoTicket(service, 'alfresco:aaa', 'TICKET_A');

      const stored = JSON.parse(sessionStorage.getItem(AuthService.SESSIONS_KEY)!);
      expect(stored.map((s: SourceSession) => s.sourceId)).toEqual(['alfresco:aaa']);

      // A fresh instance, as after a reload.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
      httpMock = TestBed.inject(HttpTestingController);
      service = TestBed.inject(AuthService);
      expect(service.getSession('alfresco:aaa')?.credential).toBe('TICKET_A');

      await settle();
      httpMock.expectOne(SOURCES_URL).flush([ALF_A, NUX]);
      await settle();
      const validation = httpMock.expectOne(ALFRESCO_ME_URL);
      expect(validation.request.headers.get('Authorization')).toBe(`Basic ${btoa('TICKET_A')}`);
      validation.flush({ entry: { id: 'admin' } });
      await service.ready;

      expect(service.isLoggedIn('alfresco:aaa')).toBeTrue();
    });

    it('dropsTheKeysEarlierBuildsWroteOnePerType', async () => {
      sessionStorage.setItem('alfrescoSession', JSON.stringify({ username: 'admin', ticket: 'TICKET_OLD' }));
      sessionStorage.setItem('nuxeoSession', JSON.stringify({ username: 'jdoe', credentials: btoa('jdoe:pw') }));

      const service = await serviceWith([ALF_A, NUX]);

      expect(sessionStorage.getItem('alfrescoSession')).toBeNull();
      expect(sessionStorage.getItem('nuxeoSession')).toBeNull();
      expect(service.isAnyLoggedIn()).toBeFalse();
      httpMock.verify();
    });

    it('movesARestoredTicketToTheOneAlfrescoWhenTheListChangedIds', async () => {
      // Written while the list was the fallback, read back once the real ids are known.
      sessionStorage.setItem(AuthService.SESSIONS_KEY, JSON.stringify([{
        sourceId: 'alfresco', sourceType: 'alfresco', displayName: 'Alfresco',
        username: 'admin', credential: 'TICKET_X', kind: 'ticket'
      }]));

      const service = await serviceWith([ALF_A, NUX]);
      httpMock.expectOne(ALFRESCO_ME_URL).flush({});
      await service.ready;

      expect(service.getSession('alfresco')).toBeNull();
      expect(service.getSession('alfresco:aaa')?.credential).toBe('TICKET_X');
    });

    it('signsInToASecondAlfrescoWithAPasswordThatRagServiceChecks', async () => {
      const service = await serviceWith([ALF_A, ALF_B, NUX]);

      const login = service.login('alfresco:bbb', 'jdoe', 'pw');
      const probe = httpMock.expectOne(STATUS_URL);
      // Only this source's credential goes on the probe, so a 401 is about this credential alone.
      expect(probe.request.headers.get('X-Source-Authorization'))
        .toBe(`alfresco:bbb Basic ${btoa('jdoe:pw')}`);
      expect(probe.request.headers.has('Authorization')).toBeFalse();
      probe.flush({});
      await login;

      expect(service.getSession('alfresco:bbb')?.kind).toBe('password');
      expect(service.isLoggedIn('alfresco:aaa')).toBeFalse();
      expect(sessionStorage.length).toBe(0);
    });

    it('rejectsASecondAlfrescoLoginThatRagServiceAnswers401', async () => {
      const service = await serviceWith([ALF_A, ALF_B, NUX]);

      const login = service.login('alfresco:bbb', 'jdoe', 'wrong');
      httpMock.expectOne(STATUS_URL).flush('denied', { status: 401, statusText: 'Unauthorized' });

      await expectAsync(login).toBeRejected();
      expect(service.isLoggedIn('alfresco:bbb')).toBeFalse();
    });

    it('signsInAndOutOfTwoAlfrescoSourcesIndependently', async () => {
      const service = await serviceWith([ALF_A, ALF_B, NUX]);
      await loginAlfrescoTicket(service, 'alfresco:aaa', 'TICKET_A');
      const second = service.login('alfresco:bbb', 'jdoe', 'pw');
      httpMock.expectOne(STATUS_URL).flush({});
      await second;

      service.logout('alfresco:aaa');

      expect(service.isLoggedIn('alfresco:aaa')).toBeFalse();
      expect(service.isLoggedIn('alfresco:bbb')).toBeTrue();
      expect(sessionStorage.getItem(AuthService.SESSIONS_KEY)).toBeNull();
    });
  });

  describe('credential headers', () => {

    it('sendsTodaysHeadersForOneAlfrescoAndOneNuxeo', async () => {
      const service = await serviceWith([ALF_A, NUX]);
      await loginAlfrescoTicket(service, 'alfresco:aaa', 'TICKET_A');
      expect(service.credentialHeaders()).toEqual({ Authorization: `Basic ${btoa('TICKET_A:')}` });

      const login = service.login('nuxeo:prod', 'jdoe', 'pw');
      httpMock.expectOne(NUXEO_ME_URL).flush({ id: 'jdoe' });
      await login;
      expect(service.credentialHeaders()).toEqual({
        Authorization: `Basic ${btoa('TICKET_A:')}`,
        'X-Nuxeo-Authorization': `Basic ${btoa('jdoe:pw')}`
      });

      service.logout('alfresco:aaa');
      expect(service.credentialHeaders()).toEqual({ Authorization: `Basic ${btoa('jdoe:pw')}` });
    });

    it('sendsOneSourceAuthorizationValuePerSessionWithTwoAlfrescoSources', async () => {
      const service = await serviceWith([ALF_A, ALF_B, NUX]);
      await loginAlfrescoTicket(service, 'alfresco:aaa', 'TICKET_A');
      const second = service.login('alfresco:bbb', 'jdoe', 'pw');
      httpMock.expectOne(STATUS_URL).flush({});
      await second;

      expect(service.credentialHeaders()).toEqual({
        'X-Source-Authorization': `alfresco:aaa Ticket TICKET_A, alfresco:bbb Basic ${btoa('jdoe:pw')}`
      });
    });

    it('sendsNothingWithNoSession', async () => {
      const service = await serviceWith([ALF_A, ALF_B]);
      expect(service.credentialHeaders()).toEqual({});
    });
  });
});
