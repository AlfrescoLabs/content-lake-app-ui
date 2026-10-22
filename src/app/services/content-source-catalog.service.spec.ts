import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { ContentSourceCatalogService, ContentSourceOption } from './content-source-catalog.service';
import { AuthService } from './auth.service';

const STATUS_URL = '/api/status';

/** A `/api/status` body carrying only what the catalogue reads. */
function status(sourceCounts: Record<string, number>): unknown {
  return {
    hxprStatus: 'UP',
    totalDocuments: Object.values(sourceCounts).reduce((a, b) => a + b, 0),
    sourceCounts,
    embeddingModel: { status: 'UP' }
  };
}

describe('ContentSourceCatalogService', () => {

  let httpMock: HttpTestingController;
  let service: ContentSourceCatalogService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ContentSourceCatalogService);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  /** Resolves the option list, answering the status request with `sourceCounts`. */
  async function optionsFor(sourceCounts: Record<string, number>): Promise<ContentSourceOption[]> {
    const pending = firstValueFrom(service.options());
    httpMock.expectOne(STATUS_URL).flush(status(sourceCounts));
    return pending;
  }

  it('offersEverySourceTypeTheIndexHoldsIncludingOnesThisBuildDoesNotKnow', async () => {
    const options = await optionsFor({
      'alfresco:acs-uuid': 120,
      'nuxeo:prod': 40,
      'cmis:docmgr': 12,
      'sample-directory:local': 3
    });

    expect(options.map(o => o.key)).toEqual(['alfresco', 'nuxeo', 'cmis', 'sample-directory']);
    expect(options.map(o => o.label))
      .toEqual(['Alfresco', 'Nuxeo', 'CMIS', 'Sample Directory']);
    expect(options.map(o => o.count)).toEqual([120, 40, 12, 3]);

    // Only Alfresco and Nuxeo have a login of their own; anything else is offered outright.
    expect(options.filter(o => o.loginGated).map(o => o.key)).toEqual(['alfresco', 'nuxeo']);
  });

  it('alwaysOffersAlfrescoAndNuxeoEvenWithNothingIndexed', async () => {
    // A fresh stack has an empty index, and the two options are gated on login rather than on content.
    const options = await optionsFor({ 'cmis:docmgr': 5 });

    expect(options.map(o => o.key)).toEqual(['alfresco', 'nuxeo', 'cmis']);
    expect(options.find(o => o.key === 'alfresco')?.count).toBe(0);
  });

  it('fallsBackToTheTwoKnownSourcesWhenStatusFails', async () => {
    // sourceCounts is empty whenever hxpr is down, and the request can fail outright. Neither may empty
    // the filter: the UI has to stay at least as usable as the two hardcoded options it replaced.
    const pending = firstValueFrom(service.options());
    httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));

    expect((await pending).map(o => o.key)).toEqual(['alfresco', 'nuxeo']);
  });

  it('addsAnOptionPerSourceIdOnlyWhenATypeHasSeveral', async () => {
    const options = await optionsFor({
      'cmis:docmgr': 12,
      'cmis:archive': 30,
      'nuxeo:prod': 40
    });

    // Two CMIS repositories are both "CMIS", so the id is what distinguishes them. A type with one
    // repository gains no extra option, because there would be nothing to distinguish.
    expect(options.map(o => o.key))
      .toEqual(['alfresco', 'nuxeo', 'cmis', 'cmis:archive', 'cmis:docmgr']);
    expect(options.filter(o => o.level === 'id').map(o => o.label))
      .toEqual(['CMIS (archive)', 'CMIS (docmgr)']);
  });

  it('scopesATypeOptionThroughSourceTypeAndAnIdOptionThroughTheFilter', async () => {
    const options = await optionsFor({ 'cmis:docmgr': 1, 'cmis:archive': 1 });

    // A type is scoped by naming its sources, not through the sourceType request field: that field
    // filters on the source_type ingest property, which only the Alfresco and Nuxeo adapters populate,
    // so sourceType: 'cmis' matches nothing against a live index.
    const type = service.find(options, 'cmis')!;
    // Order follows the status response, not the count-sorted order the id-level options use; for an
    // OR it makes no difference.
    expect(service.scope(type)).toEqual({
      filter: "cin_sourceId = 'cmis:docmgr' OR cin_sourceId = 'cmis:archive'"
    });

    // The request models carry no source id, so one repository can only be named in the filter.
    const id = service.find(options, 'cmis:archive')!;
    expect(service.scope(id)).toEqual({ filter: "cin_sourceId = 'cmis:archive'" });
  });

  it('andsTheSourceScopeWithAFilterTheCallerAlreadyHad', async () => {
    const options = await optionsFor({ 'cmis:docmgr': 1, 'cmis:archive': 1 });
    const id = service.find(options, 'cmis:docmgr')!;

    expect(service.scope(id, "cin_ingestProperties.source_mimeType = 'application/pdf'").filter)
      .toBe("(cin_ingestProperties.source_mimeType = 'application/pdf') AND (cin_sourceId = 'cmis:docmgr')");
  });

  it('fallsBackToSourceTypeOnlyForATypeTheIndexReportedNothingFor', async () => {
    // Alfresco and Nuxeo are offered before anything is ingested into them, so they alone can have no
    // known source ids. Both adapters do populate source_type, so the request field works for them.
    const options = await optionsFor({ 'cmis:docmgr': 1 });

    const alfresco = service.find(options, 'alfresco')!;
    expect(alfresco.sourceKeys).toEqual([]);
    expect(service.scope(alfresco)).toEqual({ sourceType: 'alfresco', filter: undefined });

    const cmis = service.find(options, 'cmis')!;
    expect(service.scope(cmis)).toEqual({ filter: "cin_sourceId = 'cmis:docmgr'" });
  });

  it('treatsNoSelectionAsEverySourceAndKeepsTheCallersFilter', () => {
    expect(service.scope(undefined)).toEqual({ filter: undefined });
    expect(service.scope(undefined, "a = '1'")).toEqual({ filter: "a = '1'" });
  });

  it('readsStatusOnceForEveryScreenThatAsks', async () => {
    const first = firstValueFrom(service.options());
    httpMock.expectOne(STATUS_URL).flush(status({ 'nuxeo:prod': 1 }));
    await first;

    // The chat and search screens both ask; sourceCounts changes only when a new source is ingested.
    await firstValueFrom(service.options());
    httpMock.expectNone(STATUS_URL);

    service.refresh();
    const third = firstValueFrom(service.options());
    httpMock.expectOne(STATUS_URL).flush(status({ 'nuxeo:prod': 2 }));
    expect((await third).find(o => o.key === 'nuxeo')?.count).toBe(2);
  });

  describe('gating on the session of the option\'s source', () => {

    const ALF_A = { sourceId: 'alfresco:aaa', sourceType: 'alfresco', displayName: 'Main', loginKinds: ['ticket'] };
    const ALF_B = { sourceId: 'alfresco:bbb', sourceType: 'alfresco', displayName: 'Archive', loginKinds: ['password'] };

    let auth: AuthService;

    async function sourcesAre(sources: unknown[] | 'missing'): Promise<void> {
      auth = TestBed.inject(AuthService);
      await new Promise(resolve => setTimeout(resolve, 0));
      const request = httpMock.expectOne('/api/rag/sources');
      if (sources === 'missing') {
        request.flush('not found', { status: 404, statusText: 'Not Found' });
      } else {
        request.flush(sources);
      }
      await auth.ready;
    }

    async function signInTo(sourceId: string): Promise<void> {
      const login = auth.login(sourceId, 'jdoe', 'pw');
      if (sourceId === 'alfresco:aaa' || sourceId === 'alfresco') {
        httpMock.expectOne(r => r.url.endsWith('/tickets')).flush({ entry: { id: 'TICKET' } });
      } else {
        httpMock.expectOne(STATUS_URL).flush({});
      }
      await login;
    }

    it('offersAnIdOptionOnlyWithASessionForThatVerySource', async () => {
      await sourcesAre([ALF_A, ALF_B]);
      const options = await optionsFor({ 'alfresco:aaa': 3, 'alfresco:bbb': 5, 'cmis:docmgr': 1 });
      const pick = (key: string) => service.find(options, key)!;

      expect(service.isSelectable(pick('alfresco:bbb'))).toBeFalse();
      expect(service.isSelectable(pick('alfresco'))).toBeFalse();
      // A source with no login of its own is offered outright.
      expect(service.isSelectable(pick('cmis'))).toBeTrue();

      await signInTo('alfresco:bbb');

      expect(service.isSelectable(pick('alfresco:bbb'))).toBeTrue();
      expect(service.isSelectable(pick('alfresco:aaa'))).toBeFalse();
      // The whole type needs a session in any one of its sources.
      expect(service.isSelectable(pick('alfresco'))).toBeTrue();
    });

    it('acceptsAnySessionOfTheTypeForAnIdTheSourceListDoesNotName', async () => {
      // An older backend: the list is the fallback, so no real source id is known.
      await sourcesAre('missing');
      const options = await optionsFor({ 'alfresco:aaa': 3, 'alfresco:bbb': 5 });

      expect(service.isSelectable(service.find(options, 'alfresco:aaa')!)).toBeFalse();

      await signInTo('alfresco');

      expect(service.isSelectable(service.find(options, 'alfresco:aaa')!)).toBeTrue();
      expect(service.isSelectable(service.find(options, 'alfresco:bbb')!)).toBeTrue();
    });
  });
});
