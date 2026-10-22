import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { PermissionCompareComponent, documentKey } from './permission-compare.component';
import { AuthService } from '../services/auth.service';
import { RagResult, RagService } from '../services/rag.service';

const SEARCH_URL = '/api/rag/search/semantic';

const ALF_A = { sourceId: 'alfresco:aaa', sourceType: 'alfresco', displayName: 'Main', loginKinds: ['ticket'] };
const ALF_B = { sourceId: 'alfresco:bbb', sourceType: 'alfresco', displayName: 'Archive', loginKinds: ['password'] };
const NUX = { sourceId: 'nuxeo:prod', sourceType: 'nuxeo', displayName: 'Nuxeo', loginKinds: ['password'] };

function result(sourceId: string, nodeId: string, title = 'Budget.pdf'): RagResult {
  return { rank: 1, score: 0.9, title, snippet: '', source: 'alfresco', sourceId, nodeId };
}

/** A search response carrying the given hits. */
function searchBody(hits: { sourceId: string; nodeId: string }[]): unknown {
  return {
    query: 'q', model: 'm', vectorDimension: 1, resultCount: hits.length, totalCount: hits.length, searchTimeMs: 1,
    results: hits.map((hit, i) => ({
      rank: i + 1, score: 0.5, chunkText: '',
      sourceDocument: { documentId: hit.nodeId, nodeId: hit.nodeId, sourceId: hit.sourceId, sourceType: 'alfresco',
        name: 'Budget.pdf', path: '/' }
    }))
  };
}

describe('PermissionCompareComponent', () => {

  let httpMock: HttpTestingController;
  let auth: AuthService;
  let component: PermissionCompareComponent;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    component = new PermissionCompareComponent(auth, TestBed.inject(RagService));
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  async function sourcesAre(sources: unknown[]): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
    httpMock.expectOne('/api/rag/sources').flush(sources);
    await auth.ready;
  }

  /** Lets a chain of HTTP calls advance to its next request. */
  function tick(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  it('keysADocumentOnItsSourceAndNodeSoSameNamedDocumentsInTwoSourcesDiffer', () => {
    expect(documentKey(result('alfresco:aaa', 'n1'))).toBe('alfresco:aaa::n1');
    expect(documentKey(result('alfresco:aaa', 'n1'))).not.toBe(documentKey(result('alfresco:bbb', 'n1')));
    // A hit with no node id still has an identity.
    expect(documentKey({ rank: 1, score: 1, title: 'T', snippet: '', openInSourceUrl: 'http://x' })).toBe('http://x');
  });

  it('picksASourceNotATypeAndDefaultsToTheFirstOne', async () => {
    await sourcesAre([ALF_A, ALF_B, NUX]);

    expect(component.sources.map(v => v.source.sourceId)).toEqual(['alfresco:aaa', 'alfresco:bbb', 'nuxeo:prod']);
    expect(component.selectedSource?.source.sourceId).toBe('alfresco:aaa');

    component.compareSourceId = 'alfresco:bbb';
    expect(component.selectedSource?.label).toBe('Archive');
  });

  it('comparesTheSameUserAcrossTheTwoAlfrescoSources', async () => {
    await sourcesAre([ALF_A, ALF_B, NUX]);
    component.query = 'budget';
    component.mainResults = [result('alfresco:aaa', 'n1'), result('alfresco:aaa', 'n2')];
    component.compareSourceId = 'alfresco:bbb';
    component.compareUser = 'jdoe';
    component.comparePass = 'pw';

    component.runComparison();

    // The password is checked by rag-service, carrying only the picked source's credential.
    const expected = `alfresco:bbb Basic ${btoa('jdoe:pw')}`;
    const probe = httpMock.expectOne('/api/status');
    expect(probe.request.headers.get('X-Source-Authorization')).toBe(expected);
    probe.flush({});
    await tick();

    const search = httpMock.expectOne(SEARCH_URL);
    expect(search.request.headers.get('X-Source-Authorization')).toBe(expected);
    expect(search.request.headers.has('Authorization')).toBe(false);
    // Same node ids, other source: none of these is a document the main view holds.
    search.flush(searchBody([{ sourceId: 'alfresco:bbb', nodeId: 'n1' }]));

    expect(component.compareResult?.sourceId).toBe('alfresco:bbb');
    expect(component.compareResult?.sourceLabel).toBe('Archive');
    expect(component.extraResults.map(documentKey)).toEqual(['alfresco:bbb::n1']);
    expect(component.hiddenResults.map(documentKey)).toEqual(['alfresco:aaa::n1', 'alfresco:aaa::n2']);
  });

  it('keepsTheTicketHeaderForThePrimaryAlfrescoWithOneAlfrescoAndOneNuxeo', async () => {
    await sourcesAre([ALF_A, NUX]);
    component.query = 'budget';
    component.mainResults = [result('alfresco:aaa', 'n1')];
    component.compareUser = 'jdoe';
    component.comparePass = 'pw';

    component.runComparison();

    httpMock.expectOne(r => r.url.endsWith('/tickets')).flush({ entry: { id: 'TICKET_C' } });
    await tick();
    const search = httpMock.expectOne(SEARCH_URL);
    expect(search.request.headers.get('Authorization')).toBe(`Basic ${btoa('TICKET_C:')}`);
    expect(search.request.headers.has('X-Source-Authorization')).toBe(false);
    search.flush(searchBody([{ sourceId: 'alfresco:aaa', nodeId: 'n1' }]));

    expect(component.compareResult?.sourceType).toBe('alfresco');
    expect(component.diffDetected).toBeFalse();
    expect(component.extraResults).toEqual([]);
  });

  it('reportsWrongCredentialsWhenRagServiceRejectsThem', async () => {
    await sourcesAre([ALF_A, ALF_B]);
    component.query = 'budget';
    component.compareSourceId = 'alfresco:bbb';
    component.compareUser = 'jdoe';
    component.comparePass = 'bad';

    component.runComparison();
    httpMock.expectOne('/api/status').flush('denied', { status: 401, statusText: 'Unauthorized' });

    expect(component.authError).toBe('Invalid credentials for comparison user.');
    expect(component.comparing).toBeFalse();
    httpMock.expectNone(SEARCH_URL);
  });
});
