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

  const BRANCH = {
    sourceId: 'alfresco:55d96fae-4d3a-aef9ebdade53', sourceType: 'alfresco',
    displayName: 'Northgate Branch', loginKinds: ['password', 'ticket']
  };
  const HEAD_OFFICE = {
    sourceId: 'alfresco:5ce58fd0-91b2-07c4a1e2f3d9', sourceType: 'alfresco',
    displayName: 'Northgate Head Office', loginKinds: ['password', 'ticket']
  };
  const ALFRESCO = { sourceId: 'alfresco', sourceType: 'alfresco', displayName: 'Alfresco', loginKinds: ['ticket'] };
  const NUXEO = { sourceId: 'nuxeo', sourceType: 'nuxeo', displayName: 'Nuxeo', loginKinds: ['password'] };

  /** Answers the `/api/rag/sources` request the AuthService constructor makes. */
  async function sourcesAre(sources: unknown[] | 'missing'): Promise<void> {
    const auth = TestBed.inject(AuthService);
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = httpMock.expectOne('/api/rag/sources');
    if (sources === 'missing') {
      request.flush('not found', { status: 404, statusText: 'Not Found' });
    } else {
      request.flush(sources);
    }
    await auth.ready;
  }

  /**
   * Resolves the option list, answering the status request with `sourceCounts` (or failing it) and the
   * source list with `sources`, which an older backend answers 404.
   */
  async function optionsFor(
    sourceCounts: Record<string, number> | 'failed',
    sources: unknown[] | 'missing' = 'missing'
  ): Promise<ContentSourceOption[]> {
    const pending = firstValueFrom(service.options());
    const request = httpMock.expectOne(STATUS_URL);
    if (sourceCounts === 'failed') {
      request.error(new ProgressEvent('network error'));
    } else {
      request.flush(status(sourceCounts));
    }
    await sourcesAre(sources);
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

  it('namesEachOfTwoAlfrescoSourcesAndOffersNothingElse', async () => {
    // No Nuxeo is configured or indexed, and "All Alfresco" would repeat "All sources".
    const options = await optionsFor(
      { [BRANCH.sourceId]: 4, [HEAD_OFFICE.sourceId]: 9 }, [BRANCH, HEAD_OFFICE]);

    expect(options.map(o => o.label)).toEqual(['Northgate Branch', 'Northgate Head Office']);
    expect(options.map(o => o.level)).toEqual(['id', 'id']);
    expect(options.map(o => o.count)).toEqual([4, 9]);
  });

  it('keepsOneTypeOptionEachForOneAlfrescoAndOneNuxeo', async () => {
    const options = await optionsFor({ 'alfresco:acs-uuid': 3, 'nuxeo:prod': 2 }, [ALFRESCO, NUXEO]);

    expect(options.map(o => o.key)).toEqual(['alfresco', 'nuxeo']);
    expect(options.map(o => o.label)).toEqual(['Alfresco', 'Nuxeo']);
    expect(options.map(o => o.level)).toEqual(['type', 'type']);
    // The bare configured entry takes the id the index holds for its type.
    expect(service.knownSources().map(s => s.sourceId)).toEqual(['alfresco:acs-uuid', 'nuxeo:prod']);
    expect(['alfresco', 'nuxeo'].map(key => service.colourClass(key))).toEqual(['source-c1', 'source-c2']);
  });

  it('addsATypeOptionForSeveralSourcesOfATypeOnlyBesideAnotherType', async () => {
    const options = await optionsFor(
      { [BRANCH.sourceId]: 4, [HEAD_OFFICE.sourceId]: 9, 'nuxeo:prod': 2 }, [BRANCH, HEAD_OFFICE, NUXEO]);

    expect(options.map(o => o.label))
      .toEqual(['All Alfresco', 'Northgate Branch', 'Northgate Head Office', 'Nuxeo']);
    expect(options[0].sourceKeys).toEqual([BRANCH.sourceId, HEAD_OFFICE.sourceId]);
    expect(options[0].count).toBe(13);
  });

  it('labelsAnUnnamedSourceByAShortIdUniqueWithinItsType', async () => {
    const options = await optionsFor({ 'alfresco:55d96fae-1': 1, 'alfresco:55d9b0c1-2': 1, 'alfresco:5ce58fd0': 1 });

    expect(options.map(o => o.label)).toEqual(['Alfresco (55d96)', 'Alfresco (55d9b)', 'Alfresco (5ce5)']);
  });

  it('coloursSourcesByTheirPlaceInTheConfiguredListAlfrescoFirst', async () => {
    await optionsFor({}, [NUXEO, BRANCH, HEAD_OFFICE]);

    expect(service.colourClass(BRANCH.sourceId)).toBe('source-c1');
    expect(service.colourClass(HEAD_OFFICE.sourceId)).toBe('source-c2');
    expect(service.colourClass('nuxeo')).toBe('source-c3');
    expect(service.colourClass('cmis:docmgr')).toBe('');
  });

  it('fallsBackToTheTwoKnownSourcesOnlyWhenNeitherListNamesOne', async () => {
    // sourceCounts is empty whenever hxpr is down, and either request can fail outright. With nothing
    // known the filter keeps the two options it always had.
    const options = await optionsFor('failed', 'missing');

    expect(options.map(o => o.key)).toEqual(['alfresco', 'nuxeo']);
    expect(options.map(o => o.label)).toEqual(['Alfresco', 'Nuxeo']);
  });

  it('offersNoTypeThatNeitherListNames', async () => {
    const options = await optionsFor({ 'cmis:docmgr': 5 });

    expect(options.map(o => o.key)).toEqual(['cmis']);
  });

  it('scopesATypeOptionByNamingItsSourcesAndAnIdOptionThroughTheFilter', async () => {
    const options = await optionsFor({ 'cmis:docmgr': 1, 'cmis:archive': 1, 'nuxeo:prod': 1 });

    // A type is scoped by naming its sources, not through the sourceType request field: that field
    // filters on the source_type ingest property, which only the Alfresco and Nuxeo adapters populate,
    // so sourceType: 'cmis' matches nothing against a live index.
    const type = service.find(options, 'cmis')!;
    expect(service.scope(type)).toEqual({
      filter: "cin_sourceId = 'cmis:archive' OR cin_sourceId = 'cmis:docmgr'"
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

  it('fallsBackToSourceTypeOnlyForATypeWithNoKnownSourceId', async () => {
    // A configured Alfresco without an id, before anything is ingested into it. The adapter does populate
    // source_type, so the request field works for it.
    const options = await optionsFor({ 'cmis:docmgr': 1 }, [ALFRESCO]);

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
    await optionsFor({ 'nuxeo:prod': 1 });

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

    beforeEach(() => {
      auth = TestBed.inject(AuthService);
    });

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
      const options = await optionsFor({ 'alfresco:aaa': 3, 'alfresco:bbb': 5, 'cmis:docmgr': 1 }, [ALF_A, ALF_B]);
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
      const options = await optionsFor({ 'alfresco:aaa': 3, 'alfresco:bbb': 5 }, 'missing');

      expect(service.isSelectable(service.find(options, 'alfresco:aaa')!)).toBeFalse();

      await signInTo('alfresco');

      expect(service.isSelectable(service.find(options, 'alfresco:aaa')!)).toBeTrue();
      expect(service.isSelectable(service.find(options, 'alfresco:bbb')!)).toBeTrue();
    });
  });
});
