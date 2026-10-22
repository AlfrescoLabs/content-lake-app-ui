import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { resolveStatusUrl } from '../utils/api-paths';
import { splitSourceKey } from '../utils/source-presentation';
import { AuthService } from './auth.service';

// ---- API response types (match backend SemanticSearchResponse) ----

/**
 * A source type as reported by rag-service.
 *
 * Deliberately open (#9): the index holds whatever has been ingested into it, which today can be a
 * filesystem tree, a CMIS repository or any plugin connector, and a UI that closes this union cannot
 * even name such a source. `ALFRESCO` and `NUXEO` are the two that have dedicated styling and a login
 * of their own; nothing else about them is special.
 */
export type ContentSourceType = string;

export const ALFRESCO: ContentSourceType = 'alfresco';
export const NUXEO: ContentSourceType = 'nuxeo';

interface SemanticSearchRequest {
  query: string;
  topK?: number;
  minScore?: number;
  sourceType?: ContentSourceType;
  filter?: string;
  /** hxpr named query whose matching documents scope the search (#10). */
  namedQuery?: string;
  /** Distinct documents to return chunks from; owns the budget and ignores topK when set (#11). */
  topDocuments?: number;
  /** Most chunks to take from any one document (#11). */
  chunksPerDocument?: number;
}

/** Options for a search request. Anything omitted is left off the body entirely. */
export interface SearchOptions {
  sourceType?: ContentSourceType;
  filter?: string;
  namedQuery?: string;
  topDocuments?: number;
  chunksPerDocument?: number;
}

/** A search response, with the counters the caller needs to describe the result set (#11). */
export interface SearchOutcome {
  results: RagResult[];
  /** Distinct documents the results came from. Populated by rag-service on every response. */
  documentCount?: number;
  appliedTopDocuments?: number;
  appliedChunksPerDocument?: number;
  /** Server-measured search time, as distinct from the round trip the caller sees. */
  searchTimeMs: number;
}

// ---- Faceted search (#2) ----

export interface FacetsRequest {
  property: string;
  filter?: string;
  sourceType?: ContentSourceType;
  searchTerm?: string;
  topN?: number;
}

export interface FacetBucket { value: string; count: number; }

export interface FacetsResponse { property: string; buckets: FacetBucket[]; }

interface SearchResultSourceDocument {
  documentId: string;
  nodeId: string;
  sourceId?: string;
  sourceType?: ContentSourceType;
  name: string;
  path: string;
  mimeType?: string;
  openInSourceUrl?: string;
}

/** Whether a chunk kept its markdown structure. A TABLE chunk holds a markdown table (#118). */
export type ChunkType = 'PROSE' | 'TABLE';

interface SearchResultChunkMetadata {
  embeddingId?: string;
  embeddingType?: string;
  page?: number;
  paragraph?: number;
  chunkLength?: number;
  chunkType?: ChunkType;
}

interface SearchResultItem {
  rank: number;
  score: number;
  chunkText: string;
  sourceDocument: SearchResultSourceDocument;
  chunkMetadata?: SearchResultChunkMetadata;
}

interface SemanticSearchResponse {
  query: string;
  model: string;
  vectorDimension: number;
  resultCount: number;
  totalCount: number;
  /** Distinct documents behind `results` (#135). */
  documentCount?: number;
  appliedTopDocuments?: number;
  appliedChunksPerDocument?: number;
  searchTimeMs: number;
  results: SearchResultItem[];
}

// ---- RAG Prompt (Q&A) ----

export type RagResponseFormat = 'TEXT' | 'STRUCTURED';

export interface RagPromptRequest {
  question: string;
  sessionId?: string;
  resetSession?: boolean;
  topK?: number;
  minScore?: number;
  filter?: string;
  sourceType?: ContentSourceType;
  embeddingType?: string;
  systemPrompt?: string;
  includeContext?: boolean;
  inferFilters?: boolean;
  responseFormat?: RagResponseFormat;
}

export interface RagPromptOptions {
  sessionId?: string;
  resetSession?: boolean;
  topK?: number;
  minScore?: number;
  filter?: string;
  sourceType?: ContentSourceType;
  systemPrompt?: string;
  includeContext?: boolean;
  inferFilters?: boolean;
  responseFormat?: RagResponseFormat;
}

export interface PromptSource {
  documentId: string;
  nodeId: string;
  sourceId?: string;
  sourceType?: ContentSourceType;
  name: string;
  path: string;
  chunkText: string;
  score: number;
  openInSourceUrl?: string;
  chunkType?: ChunkType;
}

export interface Citation { sourceName: string; quote: string; }

export interface StructuredAnswer {
  summary: string;
  keyPoints: string[];
  citations: Citation[];
}

export interface RagPromptResponse {
  answer: string;
  question: string;
  sessionId?: string;
  /**
   * Correlation key for this answer. Typed so it survives the stream normaliser; it is what
   * `POST /api/rag/feedback` needs to attach a rating to a specific answer.
   */
  requestId?: string;
  /**
   * The running conversation summary (#10). It is the summary that *informed* this answer rather than
   * one that includes it: rag-service refreshes it on its own executor after the response is sent.
   */
  currentSummary?: string;
  retrievalQuery?: string;
  historyTurnsUsed?: number;
  model: string;
  tokenCount?: number;
  searchTimeMs: number;
  generationTimeMs: number;
  totalTimeMs: number;
  sourcesUsed: number;
  sources: PromptSource[];
  verified?: boolean;
  unsupportedClaims?: string[];
  structured?: StructuredAnswer;
}

export type RagPromptStreamEvent =
  | { type: 'token'; token: string }
  | { type: 'metadata'; response: RagPromptResponse }
  | { type: 'done' };

// ---- Chat UI view models ----

export interface ChunkSnippet { text: string; score: number; chunkType?: ChunkType; }

export interface MergedDocument {
  nodeId: string;
  sourceId?: string;
  sourceType?: ContentSourceType;
  name: string;
  path: string;
  score: number;
  chunks: ChunkSnippet[];
  openInSourceUrl?: string;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  model?: string;
  tokenCount?: number;
  totalMs?: number;
  searchTimeMs?: number;
  generationTimeMs?: number;
  sources?: MergedDocument[];
  loading?: boolean;
  error?: string;
  verified?: boolean;
  unsupportedClaims?: string[];
  structured?: StructuredAnswer;
  requestId?: string;
  /**
   * Plain-text mirror of a partially streamed answer.
   *
   * `content` is markdown and is rendered as markdown, but a half-arrived answer is not valid markdown,
   * so the stream is shown flattened and the markdown renders once the answer is whole. Only set while
   * `loading` is true.
   */
  streamPreview?: string;
}

// ---- Operational status (#6) ----

export interface ModelRunnerStatus { status: string; url?: string; }

export interface StatusResponse {
  hxprStatus: string;
  totalDocuments: number;
  sourceCounts: Record<string, number>;
  embeddingModel: ModelRunnerStatus;
}

// ---- Conversation summary (#10) ----

export interface SessionSummaryResponse { sessionId: string; summary: string; }

// ---- Loaded connectors (#9) ----

/**
 * One connector an ingester has loaded.
 *
 * `origin` is `in-tree` for a connector compiled into the build, or the jar it was loaded from.
 */
export interface ConnectorInfo {
  sourceType: string;
  displayName: string;
  origin: string;
  implementation: string;
  settings: number;
}

/** `problems` is empty when every jar in the plugin directory loaded. */
export interface ConnectorListing {
  connectors: ConnectorInfo[];
  problems: string[];
}

// ---- View model used by the UI ----

export interface RagResult {
  rank: number;
  score: number;
  title: string;
  snippet: string;
  source?: ContentSourceType;
  sourceId?: string;
  /** The document's id within its source. With `sourceId` it identifies the document. */
  nodeId?: string;
  path?: string;
  openInSourceUrl?: string;
  /** Kept for ResultsComponent backward compat */
  url?: string;
  /** TABLE means the snippet is a markdown table and must not be reflowed as prose (#118). */
  chunkType?: ChunkType;
}

@Injectable({ providedIn: 'root' })
export class RagService {

  /** Properties offered in the faceted-search panel (#2). */
  readonly facetProperties: string[] = ['cin_sourceId', 'cin_ingestProperties.source_mimeType'];

  constructor(private http: HttpClient, private auth: AuthService) {}

  search(query: string, options: SearchOptions = {}): Observable<SearchOutcome> {
    return this.http
      .post<SemanticSearchResponse>(`${environment.ragUrl}/search/semantic`, this.searchBody(query, options))
      .pipe(map(resp => this.mapOutcome(resp)));
  }

  /** Faceted search (#2): top property values with document counts. */
  facets(request: FacetsRequest): Observable<FacetsResponse> {
    return this.http.post<FacetsResponse>(`${environment.ragUrl}/search/facets`, request);
  }

  /** Operational status snapshot (#6). /api/status is a sibling of /api/rag. */
  getStatus(): Observable<StatusResponse> {
    return this.http.get<StatusResponse>(resolveStatusUrl());
  }

  /**
   * hxpr named queries usable as saved searches (#10). An empty list, or a failure, means the feature
   * is simply not offered: it must never stop a search from running.
   */
  getNamedQueries(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.ragUrl}/named-queries`).pipe(
      map(names => Array.isArray(names) ? names : []),
      catchError(() => of<string[]>([]))
    );
  }

  /** The running conversation summary for a session (#10). 404 means there is not one yet. */
  getSessionSummary(sessionId: string): Observable<SessionSummaryResponse> {
    return this.http.get<SessionSummaryResponse>(
      `${environment.ragUrl}/sessions/${encodeURIComponent(sessionId)}/summary`);
  }

  /**
   * Connectors an ingester has loaded (#9), or null when no connectors URL is configured.
   *
   * This is not a rag-service route: `RagServiceApplication` leaves `ConnectorSchemaController` out of
   * its component scan, and the deployment proxy does not forward `/api/connectors`. It lives on each
   * ingester, and `connector-batch-ingester` publishes its own port, so the URL is configured rather
   * than derived from `ragUrl`.
   */
  getConnectors(): Observable<ConnectorListing> | null {
    const url = (environment.connectorsUrl ?? '').trim();
    if (!url) return null;
    return this.http.get<ConnectorListing>(url);
  }

  /**
   * Runs a search with explicit auth headers, bypassing the stored session interceptor.
   * Used by the permission comparison panel to search as a different user without
   * touching the active session.
   *
   * It must send the same scope the main search did (#12), or the comparison diffs two different
   * queries and reports filtered-out documents as ones the other user cannot see.
   */
  searchWithHeaders(
    query: string,
    authHeaders: HttpHeaders,
    options: SearchOptions = {}
  ): Observable<RagResult[]> {
    return this.http
      .post<SemanticSearchResponse>(`${environment.ragUrl}/search/semantic`,
        this.searchBody(query, options), { headers: authHeaders })
      .pipe(map(resp => this.mapOutcome(resp).results));
  }

  private searchBody(query: string, options: SearchOptions): SemanticSearchRequest {
    const body: SemanticSearchRequest = { query, topK: 10 };
    if (options.sourceType) body.sourceType = options.sourceType;
    if (options.filter) body.filter = options.filter;
    if (options.namedQuery) body.namedQuery = options.namedQuery;
    if (options.topDocuments) body.topDocuments = options.topDocuments;
    if (options.chunksPerDocument) body.chunksPerDocument = options.chunksPerDocument;
    return body;
  }

  prompt(question: string, options: RagPromptOptions = {}): Observable<RagPromptResponse> {
    const body: RagPromptRequest = { question, ...options };
    return this.http.post<RagPromptResponse>(`${environment.ragUrl}/prompt`, body);
  }

  streamPrompt(question: string, options: RagPromptOptions = {}): Observable<RagPromptStreamEvent> {
    const body: RagPromptRequest = { question, ...options };
    const url = `${environment.ragUrl}/chat/stream`;

    return new Observable<RagPromptStreamEvent>((observer) => {
      const controller = new AbortController();
      let cancelled = false;

      const run = async (attempt: number): Promise<void> => {
        let gotDone = false;
        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json',
                       ...this.streamAuthHeaders() },
            body: JSON.stringify(body),
            signal: controller.signal,
            cache: 'no-store'
          });

          if (!resp.ok || !resp.body) {
            throw new StreamHttpError(resp.status, resp.statusText || 'HTTP error');
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';

          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            buf = this.consumeSse(buf, (type, data) => {
              if (type === 'done') gotDone = true;
              this.forwardSse(observer, type, data);
            });
          }

          if (!cancelled) {
            buf += decoder.decode();
            this.consumeSse(buf, (type, data) => {
              if (type === 'done') gotDone = true;
              this.forwardSse(observer, type, data);
            }, true);
            if (!gotDone) observer.next({ type: 'done' });
            observer.complete();
          }
        } catch (err) {
          if (cancelled) return;
          if (attempt === 0 && this.isTransient(err)) {
            await new Promise(r => setTimeout(r, 250));
            await run(1);
            return;
          }
          observer.error(err instanceof Error ? err : new Error('Stream failed'));
        }
      };

      void run(0);
      return () => { cancelled = true; controller.abort(); };
    });
  }

  private streamAuthHeaders(): Record<string, string> {
    return this.auth.credentialHeaders();
  }

  private consumeSse(
    buf: string,
    onEvent: (type: string, data: string) => void,
    flush = false
  ): string {
    let rest = buf;
    let idx = this.sseBoundary(rest);
    while (idx >= 0) {
      const raw = rest.slice(0, idx).trim();
      if (raw) this.parseSse(raw, onEvent);
      rest = rest.slice(idx + (rest.startsWith('\r\n\r\n', idx) ? 4 : 2));
      idx = this.sseBoundary(rest);
    }
    if (flush && rest.trim()) this.parseSse(rest.trim(), onEvent);
    return flush ? '' : rest;
  }

  private sseBoundary(buf: string): number {
    const lf = buf.indexOf('\n\n'), crlf = buf.indexOf('\r\n\r\n');
    if (lf < 0) return crlf;
    if (crlf < 0) return lf;
    return Math.min(lf, crlf);
  }

  private parseSse(raw: string, onEvent: (type: string, data: string) => void): void {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    let type = 'message';
    const data: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) type = line.slice(6).trim() || 'message';
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    onEvent(type, data.join('\n'));
  }

  private forwardSse(
    obs: { next: (v: RagPromptStreamEvent) => void; error: (e: any) => void },
    type: string, data: string
  ): void {
    const t = type.toLowerCase();
    const payload = data ? (() => { try { return JSON.parse(data); } catch { return null; } })() : null;

    if (t === 'error') {
      const msg = (payload as any)?.message ?? (payload as any)?.error ?? data ?? 'Stream failed';
      obs.error(new Error(String(msg)));
      return;
    }
    if (t === 'done' || t === 'complete') { obs.next({ type: 'done' }); return; }

    // metadata / final event
    if (t === 'metadata' || t === 'final' || t === 'result' ||
        (payload && typeof payload === 'object' &&
         (typeof (payload as any).answer === 'string' || Array.isArray((payload as any).sources)))) {
      const r = this.normalizePromptResponse(payload, data);
      if (r) { obs.next({ type: 'metadata', response: r }); } else { obs.next({ type: 'done' }); }
      return;
    }

    const token = payload && typeof payload === 'object'
      ? ((payload as any).token ?? (payload as any).delta ?? (payload as any).text ?? (payload as any).content ?? null)
      : null;
    if (typeof token === 'string') { obs.next({ type: 'token', token }); return; }
    if (data) obs.next({ type: 'token', token: data });
  }

  private normalizePromptResponse(payload: unknown, fallback: string): RagPromptResponse | null {
    const c: any = (payload && typeof payload === 'object' && (payload as any).response)
      ? (payload as any).response : payload;
    if (!c || typeof c !== 'object') {
      return fallback ? { answer: fallback, question: '', model: 'unknown',
        searchTimeMs: 0, generationTimeMs: 0, totalTimeMs: 0, sourcesUsed: 0, sources: [] } : null;
    }
    return {
      answer: typeof c.answer === 'string' ? c.answer : (fallback || ''),
      question: typeof c.question === 'string' ? c.question : '',
      sessionId: typeof c.sessionId === 'string' ? c.sessionId : undefined,
      requestId: typeof c.requestId === 'string' ? c.requestId : undefined,
      currentSummary: typeof c.currentSummary === 'string' ? c.currentSummary : undefined,
      retrievalQuery: typeof c.retrievalQuery === 'string' ? c.retrievalQuery : undefined,
      historyTurnsUsed: typeof c.historyTurnsUsed === 'number' ? c.historyTurnsUsed : undefined,
      model: typeof c.model === 'string' ? c.model : 'unknown',
      tokenCount: typeof c.tokenCount === 'number' ? c.tokenCount : undefined,
      searchTimeMs: typeof c.searchTimeMs === 'number' ? c.searchTimeMs : 0,
      generationTimeMs: typeof c.generationTimeMs === 'number' ? c.generationTimeMs : 0,
      totalTimeMs: typeof c.totalTimeMs === 'number' ? c.totalTimeMs : 0,
      sourcesUsed: typeof c.sourcesUsed === 'number' ? c.sourcesUsed : (Array.isArray(c.sources) ? c.sources.length : 0),
      sources: Array.isArray(c.sources) ? c.sources : [],
      verified: typeof c.verified === 'boolean' ? c.verified : undefined,
      unsupportedClaims: Array.isArray(c.unsupportedClaims) ? c.unsupportedClaims : undefined,
      structured: (c.structured && typeof c.structured === 'object') ? c.structured : undefined
    };
  }

  private isTransient(err: unknown): boolean {
    if (err instanceof StreamHttpError) return err.status >= 500;
    if (err instanceof DOMException) return err.name !== 'AbortError';
    return err instanceof TypeError;
  }

  private mapOutcome(resp: SemanticSearchResponse): SearchOutcome {
    return {
      results: (resp?.results ?? []).map(item => ({
        rank: item.rank,
        score: item.score,
        title: resolveTitle(item.sourceDocument),
        snippet: item.chunkText ?? '',
        source: resolveSourceType(item.sourceDocument),
        sourceId: item.sourceDocument?.sourceId,
        nodeId: item.sourceDocument?.nodeId,
        path: item.sourceDocument?.path,
        openInSourceUrl: item.sourceDocument?.openInSourceUrl,
        url: item.sourceDocument?.openInSourceUrl,
        chunkType: item.chunkMetadata?.chunkType,
      })),
      documentCount: resp?.documentCount,
      appliedTopDocuments: resp?.appliedTopDocuments,
      appliedChunksPerDocument: resp?.appliedChunksPerDocument,
      searchTimeMs: resp?.searchTimeMs ?? 0,
    };
  }
}

/**
 * A displayable title for a hit.
 *
 * A connector's documents arrive with no `name`, so every one of them rendered as "(untitled)". The
 * `nodeId` is the connector's own identifier and is a path for any connector that walks one, so its last
 * segment is the file name. A connector whose ids are not path-like falls back to the id itself, which
 * still identifies the document.
 */
function resolveTitle(doc?: { name?: string; nodeId?: string }): string {
  const name = doc?.name?.trim();
  if (name) return name;
  const nodeId = doc?.nodeId?.trim();
  if (!nodeId) return '(untitled)';
  const segments = nodeId.split(/[/\\]+/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : nodeId;
}

/**
 * The source type of a hit, reading it off the qualified source id when the field is absent.
 *
 * Only the Alfresco and Nuxeo adapters put `source_type` on the document, so a hit from a connector
 * arrives with `sourceDocument` carrying `documentId`, `nodeId` and `sourceId` alone. `sourceId` is the
 * full `<sourceType>:<sourceId>` value, which is where the type comes from in that case; without this,
 * every connector-sourced result draws as an unknown source.
 */
function resolveSourceType(doc?: { sourceType?: string; sourceId?: string }): string | undefined {
  if (doc?.sourceType) return doc.sourceType;
  const derived = splitSourceKey(doc?.sourceId ?? '').sourceType;
  return derived || undefined;
}

class StreamHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Stream request failed (${status}): ${message}`);
  }
}
