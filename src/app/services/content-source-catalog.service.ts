import { Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, from, map, of, shareReplay } from 'rxjs';
import { RagService } from './rag.service';
import { AuthService } from './auth.service';
import {
  SourceRef,
  findSourceRef,
  sourceColourClass,
  sourceDisplayLabel,
  sourceTypeLabel,
  splitSourceKey
} from '../utils/source-presentation';
import { combineFilters, sourceIdClause, sourceIdsClause } from '../utils/hxql';

/**
 * What sources exist, and how to scope a search to one of them (#9).
 *
 * Two lists feed it, merged into one:
 *
 * - `GET /api/rag/sources` (through {@link AuthService}), the sources rag-service is configured with,
 *   which carry their display names;
 * - `GET /api/status`'s `sourceCounts`, whose keys are the stored `cin_sourceId` values
 *   (`<sourceType>:<sourceId>`). That is the set of sources the index actually holds, so a source type this
 *   build has never heard of - a CMIS repository, a plugin connector, a filesystem tree - is offered
 *   without any change here. It covers the whole index rather than what the caller may read, and
 *   `StatusController` populates it only while hxpr is UP, so a hxpr blip returns it empty.
 *
 * A type is offered only when one of the two lists holds a source of it. {@link FALLBACK_TYPES} is used
 * only when both are empty or failed, so an older backend still gets the two options it always had.
 */
@Injectable({ providedIn: 'root' })
export class ContentSourceCatalogService {

  /** Offered only when neither list names a source, and drawn first in any list. */
  static readonly FALLBACK_TYPES: readonly string[] = ['alfresco', 'nuxeo'];

  /** The "every source" option's key. Empty so it can be an `<option value="">`-style default. */
  static readonly ALL_SOURCES = '';

  private cached?: Observable<ContentSourceOption[]>;
  private known?: KnownSource[];

  constructor(private rag: RagService, private auth: AuthService) {}

  /**
   * The options to offer: one per source, plus one per type that has several sources while another type
   * exists too. A type with a single source is one type-level option, labelled with that source's name.
   *
   * Cached for the lifetime of the app: `sourceCounts` changes only when a new source is ingested into,
   * and both the search and chat screens ask for it.
   */
  options(): Observable<ContentSourceOption[]> {
    if (!this.cached) {
      const status = this.rag.getStatus().pipe(
        map((body) => body?.sourceCounts ?? {}),
        catchError(() => of({} as Record<string, number>))
      );
      this.cached = forkJoin([from(this.auth.ready.catch(() => undefined)), status]).pipe(
        map(([, sourceCounts]) => {
          this.known = this.merge(sourceCounts);
          return this.derive(this.known);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.cached;
  }

  /** Drops the cache so the next `options()` call re-reads `/api/status`. */
  refresh(): void {
    this.cached = undefined;
  }

  /**
   * Every known source, in colour order: the configured ones first, in the order rag-service lists them
   * with Alfresco and Nuxeo ahead of other types, then the ones only the index holds. Until `options()`
   * has loaded, the configured list alone.
   */
  knownSources(): KnownSource[] {
    return this.known ?? this.merge({});
  }

  /** The display name of a `<sourceType>:<sourceId>` key. */
  label(sourceKey: string | undefined): string {
    return sourceDisplayLabel(sourceKey, this.knownSources());
  }

  /** The `source-c<n>` colour class of a key, or '' for a source no list holds. */
  colourClass(sourceKey: string | undefined): string {
    return sourceColourClass(sourceKey, this.knownSources());
  }

  /** The colour of the one source an option covers, or '' for a type-level option over several. */
  optionColourClass(option: ContentSourceOption): string {
    return this.colourClass(option.sourceKeys.length === 1 ? option.sourceKeys[0] : option.key);
  }

  /**
   * Turns a selected option into the request fields that scope a search to it, ANDed with whatever
   * filter the caller already had.
   *
   * Scoping goes through an equality clause on `cin_sourceId` rather than through the `sourceType`
   * request field, because that is the value actually stored on the document. rag-service reads such a
   * clause in the caller's own filter as the caller naming a source, and gives it precedence over
   * everything else when it builds the permission filter, so this narrows the ACL as well as the query.
   */
  scope(option: ContentSourceOption | undefined, existingFilter?: string): SourceScope {
    if (!option || option.key === ContentSourceCatalogService.ALL_SOURCES) {
      return { filter: combineFilters(existingFilter, undefined) };
    }
    if (option.level === 'id') {
      return { filter: combineFilters(existingFilter, sourceIdClause(option.key)) };
    }
    // A type whose sources the index knows is scoped by naming them, not through the `sourceType`
    // request field. That field filters on the `source_type` ingest property, which only the Alfresco
    // and Nuxeo adapters populate: measured against a live stack, `sourceType: 'sample-directory'`
    // returned zero results for two documents that a bare query returned. Naming the ids matches the
    // stored `cin_sourceId` and works for every source.
    const named = sourceIdsClause(option.sourceKeys);
    if (named) {
      return { filter: combineFilters(existingFilter, named) };
    }
    // Only reachable for Alfresco and Nuxeo before anything is ingested into them, since every other
    // option exists because the index reported a source for it. Both populate `source_type`.
    return { sourceType: option.sourceType, filter: combineFilters(existingFilter, undefined) };
  }

  /**
   * Whether an option can be picked with the sessions held now.
   *
   * A source that needs a login is selectable only with a session for it: an id-level option needs the
   * session of that very source, and a type-level option needs a session in any source of the type. Any
   * other source is offered outright.
   */
  isSelectable(option: ContentSourceOption): boolean {
    if (!option.loginGated && !this.auth.isLoginSourceType(option.sourceType)) return true;
    return option.level === 'id'
      ? this.auth.hasSessionForKey(option.key)
      : this.auth.hasSessionOfType(option.sourceType);
  }

  /** Finds an option by the key held in a form control. */
  find(options: readonly ContentSourceOption[], key: string): ContentSourceOption | undefined {
    return options.find((option) => option.key === key);
  }

  /**
   * The configured sources and the indexed ones as one list. A configured entry with a bare type takes the
   * id of the one indexed source of its type, if the index holds exactly one.
   */
  private merge(sourceCounts: Record<string, number>): KnownSource[] {
    const configured: KnownSource[] = (this.auth.hasSourceList() ? this.auth.getSources() : [])
      .map((source) => ({
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        displayName: source.displayName,
        count: 0
      }))
      .sort((a, b) => typeRank(a.sourceType) - typeRank(b.sourceType));

    const indexed: KnownSource[] = [];
    for (const [key, count] of Object.entries(sourceCounts ?? {})) {
      const { sourceType, sourceId } = splitSourceKey(key);
      if (!sourceType || !sourceId) continue;
      indexed.push({ sourceId: key, sourceType, displayName: '', count: count ?? 0 });
    }

    const unlisted: KnownSource[] = [];
    for (const entry of indexed) {
      const exact = configured.find((source) => source.sourceId === entry.sourceId);
      const sameType = indexed.filter((other) => other.sourceType === entry.sourceType);
      // findSourceRef answers a bare entry only when it is the one configured source of the type.
      const bare = !exact && sameType.length === 1 ? findSourceRef(entry.sourceId, configured) : undefined;
      const target = exact ?? bare;
      if (target) {
        target.sourceId = entry.sourceId;
        target.count = entry.count;
      } else {
        unlisted.push(entry);
      }
    }
    unlisted.sort((a, b) => byFallbackFirstThenName(a.sourceType, b.sourceType)
      || b.count - a.count || a.sourceId.localeCompare(b.sourceId));

    // A bare entry left beside indexed sources of its type cannot tell which of them it is, and they
    // already name every source of the type.
    const listed = configured.filter((source) => splitSourceKey(source.sourceId).sourceId
      || !unlisted.some((entry) => entry.sourceType === source.sourceType));
    const known = [...listed, ...unlisted];

    if (known.length > 0) return known;
    return ContentSourceCatalogService.FALLBACK_TYPES.map((type) => ({
      sourceId: type,
      sourceType: type,
      displayName: sourceTypeLabel(type),
      count: 0
    }));
  }

  private derive(known: KnownSource[]): ContentSourceOption[] {
    const byType = new Map<string, KnownSource[]>();
    for (const source of known) {
      byType.set(source.sourceType, [...(byType.get(source.sourceType) ?? []), source]);
    }

    const types = [...byType.keys()].sort(byFallbackFirstThenName);
    const options: ContentSourceOption[] = [];

    for (const sourceType of types) {
      const sources = byType.get(sourceType) ?? [];
      const loginGated = ContentSourceCatalogService.FALLBACK_TYPES.includes(sourceType);
      const sourceKeys = sources.map((source) => source.sourceId).filter((key) => splitSourceKey(key).sourceId);
      const count = sources.reduce((total, source) => total + source.count, 0);

      // One source is the whole type, so it stays a type-level option: one Alfresco and one Nuxeo read
      // and scope exactly as they always have.
      if (sources.length === 1) {
        options.push({
          key: sourceType,
          level: 'type',
          sourceType,
          label: sourceDisplayLabel(sources[0].sourceId, known),
          sourceKeys,
          count,
          loginGated
        });
        continue;
      }

      // "All Alfresco" next to "All sources" would offer the same thing twice.
      if (types.length > 1) {
        options.push({
          key: sourceType,
          level: 'type',
          sourceType,
          label: `All ${sourceTypeLabel(sourceType)}`,
          sourceKeys,
          count,
          loginGated
        });
      }

      for (const source of sources) {
        options.push({
          key: source.sourceId,
          level: 'id',
          sourceType,
          sourceId: splitSourceKey(source.sourceId).sourceId,
          label: sourceDisplayLabel(source.sourceId, known),
          sourceKeys: [source.sourceId],
          count: source.count,
          loginGated
        });
      }
    }

    return options;
  }
}

/** One source either list names, with the documents the index holds for it. */
export interface KnownSource extends SourceRef {
  sourceType: string;
  displayName: string;
  count: number;
}

/** One selectable source: a whole type, or one repository within a type. */
export interface ContentSourceOption {
  /** The control's value: a bare source type, or the full `<sourceType>:<sourceId>` key. */
  key: string;
  level: 'type' | 'id';
  sourceType: string;
  sourceId?: string;
  label: string;
  /**
   * The `cin_sourceId` values this option covers: every source of the type for a type-level option, and
   * the one source for an id-level option. Empty only for a type the index reported nothing for.
   */
  sourceKeys: string[];
  /** Documents this option covers, as reported by `/api/status`. */
  count: number;
  /** Whether selecting it requires a session in that repository (Alfresco and Nuxeo do). */
  loginGated: boolean;
}

/** The request fields that scope a search to a selected source. */
export interface SourceScope {
  sourceType?: string;
  filter?: string;
}

function typeRank(type: string): number {
  const idx = ContentSourceCatalogService.FALLBACK_TYPES.indexOf(type);
  return idx < 0 ? ContentSourceCatalogService.FALLBACK_TYPES.length : idx;
}

function byFallbackFirstThenName(a: string, b: string): number {
  return typeRank(a) - typeRank(b) || a.localeCompare(b);
}
