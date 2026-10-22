import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService, SourceSessionView } from '../services/auth.service';
import { CompareResult } from '../permission-compare/permission-compare.component';
import { ContentSourceType, FacetBucket, FacetsResponse, RagResult, RagService } from '../services/rag.service';
import {
  ContentSourceCatalogService,
  ContentSourceOption
} from '../services/content-source-catalog.service';
import {
  SourceModifier,
  sourceIcon,
  sourceModifier,
  sourceTypeLabel
} from '../utils/source-presentation';
import { combineFilters, escapeHxqlLiteral } from '../utils/hxql';

interface FacetGroup {
  property: string;
  label: string;
  buckets: FacetBucket[];
}

/** What the last search asked for, so the context bar and the comparison panel agree with it. */
interface SearchContext {
  query: string;
  /** The `sourceType` field sent, if any. Absent for an id-level or unscoped search. */
  sourceType?: ContentSourceType;
  /** The HXQL filter sent, facets and any source-id clause combined. */
  filter?: string;
  namedQuery?: string;
  sourceLabel: string;
  sourceModifier: SourceModifier;
  /** The selected source's `source-c<n>` colour class, '' for a type with several sources. */
  sourceColour: string;
  /** The sessions the search ran with, one chip each. */
  users: SearchContextUser[];
  resultCount: number;
  documentCount?: number;
  searchTimeMs: number;
}

/** One identity the last search ran as. */
interface SearchContextUser {
  sourceId: string;
  sourceType: string;
  label: string;
  username: string;
}

@Component({
  selector: 'app-search',
  template: `
    <!-- Editorial hero --------------------------------------------------- -->
    <section class="search-hero">
      <div class="hero-glow hero-glow-blue"></div>
      <div class="hero-glow hero-glow-teal"></div>

      <div class="hero-shell">
        <div class="hero-copy">
          <span class="eyebrow">Search workspace</span>
          <h1 class="display-1">
            Find the right document faster,
            <span class="accent-teal">and see where it came from.</span>
          </h1>
          <p class="hero-lede">
            Search across every indexed source with clearer ranking, stronger contrast, and persistent
            source cues so you can spot repository ownership at a glance.
          </p>

          <div class="hero-chips">
            <span class="metric-chip">
              <mat-icon>visibility</mat-icon>
              Source-aware results
            </span>
            <span class="metric-chip">
              <mat-icon>lock</mat-icon>
              Permission-aware search
            </span>
            <span *ngFor="let view of sessionViews; trackBy: trackSource"
                  class="source-badge"
                  [ngClass]="sourceColour(view.source.sourceId)">
              <mat-icon>{{ iconFor(view.source.sourceType) }}</mat-icon>
              {{ view.label }}
            </span>
          </div>
        </div>

        <aside class="hero-panel">
          <div class="hero-panel-header">
            <span class="stat-label">Repository sessions</span>
            <span class="hero-panel-count">{{ activeSessionCount }}/{{ sessionViews.length }}</span>
          </div>

          <div class="hero-session-list">
            <div *ngFor="let view of sessionViews; trackBy: trackSource"
                 class="hero-session"
                 [ngClass]="sourceColour(view.source.sourceId)"
                 [class.connected]="view.session !== null">
              <div class="session-indicator" [class.active]="view.session !== null"></div>
              <mat-icon class="session-src-icon">{{ iconFor(view.source.sourceType) }}</mat-icon>
              <div class="session-info">
                <strong>{{ view.label }}</strong>
                <span>{{ view.session?.username ?? 'Not connected' }}</span>
              </div>
            </div>
          </div>

          <p class="hero-panel-note">
            Use the source filter below to narrow to one repository, or keep both to compare relevance.
          </p>
        </aside>
      </div>
    </section>

    <div class="page-container-wide search-body">

      <div *ngIf="!anyLoggedIn" class="warning-banner editorial-surface">
        <div class="warning-accent" aria-hidden="true"></div>
        <mat-icon>warning_amber</mat-icon>
        <span>No active sessions. <a routerLink="/login">Sign in to at least one repository</a> to search.</span>
      </div>

      <!-- Search controls ------------------------------------------------ -->
      <section class="search-controls editorial-surface">
        <div class="search-header">
          <div>
            <span class="eyebrow">Query</span>
            <h2 class="display-2">Readable results, with explicit source identity.</h2>
          </div>
          <span class="search-header-note">Choose a scope, search, then review permission differences below.</span>
        </div>

        <div class="search-bar">
          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Search documents, snippets, or concepts</mat-label>
            <input matInput [(ngModel)]="query" (keyup.enter)="search()" [disabled]="loading" />
            <mat-icon matPrefix>search</mat-icon>
          </mat-form-field>

          <!-- Source filter: options come from /api/status, so a source type this build has never
               heard of is selectable without a change here (#9). -->
          <mat-button-toggle-group [(ngModel)]="sourceKey" class="source-toggle">
            <mat-button-toggle value="">All sources</mat-button-toggle>
            <mat-button-toggle *ngFor="let option of sourceOptions"
                               [value]="option.key"
                               [disabled]="!isSelectable(option)"
                               [matTooltip]="sourceTooltip(option)">
              <span class="toggle-label" [ngClass]="colourFor(option)">
                <mat-icon>{{ iconFor(option.sourceType) }}</mat-icon>
                {{ option.label }}
              </span>
            </mat-button-toggle>
          </mat-button-toggle-group>

          <button mat-raised-button color="primary"
                  class="search-action"
                  (click)="search()"
                  [disabled]="loading || !query.trim()">
            <mat-spinner *ngIf="loading" diameter="18"></mat-spinner>
            <span>{{ loading ? 'Searching…' : 'Run search' }}</span>
            <mat-icon *ngIf="!loading">arrow_forward</mat-icon>
          </button>
        </div>

        <div class="search-advanced">
          <!-- Saved searches (#10). Absent when hxpr has no named queries. -->
          <mat-form-field *ngIf="namedQueries.length > 0" appearance="outline" class="advanced-field">
            <mat-label>Saved query</mat-label>
            <select matNativeControl [(ngModel)]="selectedNamedQuery" [disabled]="loading">
              <option value="">None</option>
              <option *ngFor="let nq of namedQueries" [value]="nq">{{ nq }}</option>
            </select>
          </mat-form-field>

          <!-- The #135 document budget. Both empty sends neither field, which is what this UI used to
               send, so results are unchanged until one is set. -->
          <mat-form-field appearance="outline" class="advanced-field advanced-field-number">
            <mat-label>Documents</mat-label>
            <input matInput type="number" min="1" max="50" [(ngModel)]="topDocuments"
                   [disabled]="loading"
                   matTooltip="Return chunks from at most this many distinct documents. Empty budgets chunks instead." />
          </mat-form-field>

          <mat-form-field appearance="outline" class="advanced-field advanced-field-number">
            <mat-label>Chunks per document</mat-label>
            <input matInput type="number" min="1" max="10" [(ngModel)]="chunksPerDocument"
                   [disabled]="loading"
                   matTooltip="Most chunks to take from any one document. Empty uses the server's cap." />
          </mat-form-field>
        </div>
      </section>

      <div *ngIf="ctx" class="context-bar surface-card">
        <div class="context-group">
          <span class="context-label">Context</span>
          <!-- The source is named only when its type alone does not say which one it is. -->
          <span *ngFor="let user of ctx.users"
                class="ctx-user"
                [ngClass]="sourceColour(user.sourceId)"
                [matTooltip]="user.label">
            <mat-icon>{{ iconFor(user.sourceType) }}</mat-icon>
            {{ user.username }}
          </span>
          <span *ngIf="ctx.users.length === 0" class="ctx-empty">(no session)</span>
        </div>

        <div class="context-stats">
          <!-- A result is a chunk, so the document count is the number that says how much of the corpus
               answered (#11). It comes from the response rather than being derived from the hit list. -->
          <span class="metric-chip">
            <mat-icon>filter_list</mat-icon>
            {{ ctx.resultCount }} chunk{{ ctx.resultCount !== 1 ? 's' : '' }}
            <ng-container *ngIf="ctx.documentCount !== undefined">
              from {{ ctx.documentCount }} document{{ ctx.documentCount !== 1 ? 's' : '' }}
            </ng-container>
          </span>
          <span class="metric-chip">
            <mat-icon>schedule</mat-icon>
            {{ ctx.searchTimeMs }}ms
          </span>
          <span *ngIf="ctx.sourceLabel"
                class="source-badge"
                [ngClass]="['source-badge-' + ctx.sourceModifier, ctx.sourceColour]">
            <mat-icon>{{ iconFor(ctx.sourceType) }}</mat-icon>
            {{ ctx.sourceLabel }} only
          </span>
          <span *ngIf="ctx.namedQuery" class="metric-chip">
            <mat-icon>bookmark</mat-icon>
            {{ ctx.namedQuery }}
          </span>
        </div>
      </div>

      <div *ngIf="facetGroups.length > 0" class="facets surface-card">
        <div *ngIf="activeFacets.length > 0" class="active-facets">
          <span class="facets-title">Filters</span>
          <button *ngFor="let f of activeFacets" type="button"
                  class="facet-chip active" (click)="toggleFacet(f.property, f.value)">
            {{ facetLabel(f.property) }}: {{ facetValueLabel(f.property, f.value) }}
            <mat-icon>close</mat-icon>
          </button>
          <button type="button" class="facet-clear" (click)="clearFacets()">Clear all</button>
        </div>
        <div *ngFor="let group of facetGroups" class="facet-group">
          <span class="facet-group-label">{{ group.label }}</span>
          <button *ngFor="let bucket of group.buckets" type="button"
                  class="facet-chip"
                  [class.active]="isFacetActive(group.property, bucket.value)"
                  (click)="toggleFacet(group.property, bucket.value)">
            {{ facetValueLabel(group.property, bucket.value) }} <span class="facet-count">{{ bucket.count }}</span>
          </button>
        </div>
      </div>

      <div *ngIf="ctx && results.length > 0" class="results-heading">
        <div>
          <span class="eyebrow">Results</span>
          <h2 class="display-2">Ranked document matches.</h2>
        </div>
        <p class="section-copy">
          Repository colors stay attached to each card, badge, and action so provenance remains obvious while scanning.
        </p>
      </div>

      <app-results [results]="results" (select)="openLink($event)"></app-results>

      <div *ngIf="searched && !loading && results.length === 0" class="empty-state surface-card">
        <div class="empty-icon">
          <mat-icon>search_off</mat-icon>
        </div>
        <p class="empty-title">No results for "{{ ctx?.query }}"</p>

        <ng-container *ngIf="lastCompareResult && lastCompareResult.count > 0">
          <div class="permission-callout">
            <mat-icon>shield</mat-icon>
            <div>
              <strong>Permission filtering confirmed</strong>
              <p>
                {{ lastCompareResult.username }} ({{ lastCompareResult.sourceLabel }}) found
                {{ lastCompareResult.count }} result{{ lastCompareResult.count !== 1 ? 's' : '' }} for the same query.
              </p>
            </div>
          </div>
        </ng-container>

        <ng-container *ngIf="!lastCompareResult">
          <p class="empty-copy">No indexed documents matched with your current credentials.</p>
          <p class="empty-copy muted">
            Use the Permission Comparison panel below to check whether documents exist for another identity.
          </p>
        </ng-container>
      </div>

      <div *ngIf="searched && !loading" class="compare-section">
        <!-- The comparison has to run the same scope as the main search, or it diffs two queries (#12). -->
        <app-permission-compare
          [query]="ctx?.query || ''"
          [sourceFilter]="ctx?.sourceType || ''"
          [searchFilter]="ctx?.filter || ''"
          [namedQuery]="ctx?.namedQuery || ''"
          [mainResults]="results"
          [mainUsername]="ctx?.users?.[0]?.username || ''"
          [mainSource]="ctx?.sourceType || ''"
          (compareComplete)="onCompareComplete($event)">
        </app-permission-compare>
      </div>

    </div>
  `,
  styles: [`
    :host { display: block; }

    /* ── Hero (light editorial) ─────────────────────────────── */

    .search-hero {
      position: relative;
      overflow: hidden;
      background:
        radial-gradient(80% 120% at 80% -10%, rgba(75, 189, 224, 0.14) 0%, transparent 60%),
        radial-gradient(60% 80% at 8% 110%, rgba(107, 98, 178, 0.1) 0%, transparent 65%),
        linear-gradient(180deg, #F8FAFE 0%, var(--cl-bg) 100%);
      padding: clamp(44px, 6vw, 72px) 0 clamp(56px, 6vw, 80px);
      border-bottom: 1px solid var(--cl-border);
    }

    .hero-glow {
      position: absolute;
      pointer-events: none;
      border-radius: 50%;
      filter: blur(80px);
    }
    .hero-glow-blue {
      width: 380px; height: 380px;
      top: -40px; right: 6%;
      background: var(--hy-mark-blue);
      opacity: 0.18;
    }
    .hero-glow-teal {
      width: 320px; height: 320px;
      bottom: -60px; left: 20%;
      background: var(--hy-mark-teal);
      opacity: 0.14;
    }

    .hero-shell {
      position: relative;
      max-width: var(--container-wide);
      margin: 0 auto;
      padding: 0 24px;
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.9fr);
      gap: clamp(28px, 4vw, 56px);
      align-items: end;
    }

    .hero-copy {
      display: flex;
      flex-direction: column;
      gap: 18px;
      min-width: 0;
    }

    .accent-teal {
      background: linear-gradient(90deg, var(--hy-teal-dark), var(--hy-mark-teal));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .hero-lede {
      margin: 0;
      font-size: clamp(15px, 1.15vw, 17px);
      line-height: 1.7;
      color: var(--cl-text-muted);
      max-width: 58ch;
    }

    .hero-chips {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    /* ── Hero panel ────────────────────────────────────────── */

    .hero-panel {
      justify-self: end;
      width: 100%;
      max-width: 340px;
      padding: 22px;
      border-radius: var(--radius-lg);
      background: var(--cl-surface);
      border: 1px solid var(--cl-border);
      box-shadow: var(--cl-shadow);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .hero-panel-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .stat-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--cl-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.2em;
    }

    .hero-panel-count {
      font-family: var(--cl-font-display);
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--cl-text);
    }

    .hero-session-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .hero-session {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 11px 13px;
      border-radius: var(--radius-md);
      border: 1px solid var(--cl-border);
      background: var(--hy-gray-50);
      color: var(--cl-text-soft);
      transition: all 180ms var(--ease-out);
    }

    .hero-session.connected {
      color: var(--cl-text);
      background: var(--cl-surface);
    }

    .hero-session-alfresco.connected {
      border-color: rgba(120, 190, 32, 0.35);
      background: linear-gradient(135deg, rgba(120, 190, 32, 0.08), var(--cl-surface));
    }

    .hero-session-nuxeo.connected {
      border-color: rgba(0, 163, 224, 0.3);
      background: linear-gradient(135deg, rgba(0, 163, 224, 0.08), var(--cl-surface));
    }

    .session-indicator {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--cl-border-strong);
      flex-shrink: 0;
    }

    .session-indicator.active {
      background: var(--cl-success);
      box-shadow: 0 0 0 4px rgba(46, 125, 50, 0.15);
    }

    .hero-session[class*='source-c'] .session-indicator.active {
      background: var(--src);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--src) 20%, transparent);
    }

    .session-src-icon {
      font-size: 20px;
      height: 20px;
      width: 20px;
      flex-shrink: 0;
      opacity: 0.5;
    }

    .connected .session-src-icon { opacity: 1; }

    .hero-session.connected .session-src-icon { color: var(--src-strong, inherit); }

    .session-info strong,
    .session-info span {
      display: block;
      line-height: 1.25;
    }

    .session-info strong {
      font-size: 13px;
      font-weight: 600;
    }

    .session-info span {
      font-size: 11px;
      color: var(--cl-text-soft);
    }

    .hero-panel-note {
      margin: 0;
      font-size: 12px;
      line-height: 1.6;
      color: var(--cl-text-muted);
    }

    /* ── Body ─────────────────────────────────────────────── */

    .search-body {
      display: flex;
      flex-direction: column;
      gap: 20px;
      margin-top: clamp(-40px, -3vw, -28px);
      position: relative;
      z-index: 2;
    }

    .warning-banner {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      color: var(--cl-warning);
      background: rgba(255, 248, 238, 0.92);
      border-color: rgba(196, 85, 0, 0.18);
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
    }

    .warning-accent {
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--hy-mark-yellow);
    }

    /* ── Search controls ──────────────────────────────────── */

    .search-controls {
      padding: 28px 32px 28px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .search-header {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    .search-header h2 {
      margin: 8px 0 0;
    }

    .search-header-note {
      color: var(--cl-text-muted);
      font-size: 13px;
      max-width: 360px;
      line-height: 1.65;
    }

    .search-bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 12px;
      align-items: center;
    }

    .search-field {
      min-width: 0;
      margin-bottom: -1.25em;
    }

    .source-toggle {
      height: 46px;
      background: var(--hy-gray-50);
      border-radius: var(--radius-sm);
    }

    /* The source's palette slot, or a readable neutral for a type-level option over several sources. */
    .toggle-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
      font-size: 12px;
      color: var(--src-strong, var(--cl-text-muted));
    }

    .toggle-label mat-icon {
      font-size: 15px;
      height: 15px;
      width: 15px;
    }

    .search-advanced {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 14px;
    }

    .advanced-field { min-width: 190px; }
    .advanced-field-number { max-width: 190px; }

    .search-action {
      min-height: 48px;
      min-width: 154px;
      padding: 0 22px;
      border-radius: var(--radius-sm);
      font-family: var(--cl-font-display);
      font-weight: 600;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .search-action mat-icon {
      font-size: 18px;
      height: 18px;
      width: 18px;
      transition: transform 220ms var(--ease-out);
    }

    .search-action:not([disabled]):hover mat-icon { transform: translateX(3px); }

    /* ── Context bar ──────────────────────────────────────── */

    .context-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 20px;
      flex-wrap: wrap;
      border-radius: var(--radius-lg) !important;
    }

    .context-group,
    .context-stats {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .context-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--cl-text-soft);
    }

    .ctx-user {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 9px;
      border-radius: var(--radius-xs);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .ctx-user mat-icon {
      font-size: 13px;
      height: 13px;
      width: 13px;
    }

    .ctx-user[class*='source-c'] {
      background: var(--src-soft);
      color: var(--src-strong);
    }

    .ctx-empty {
      color: var(--cl-text-soft);
      font-style: italic;
      font-size: 12px;
    }

    /* ── Results heading ──────────────────────────────────── */

    .results-heading {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-end;
      flex-wrap: wrap;
      padding: 12px 4px 0;
    }

    .results-heading h2 {
      margin: 8px 0 0;
    }

    .results-heading p { max-width: 460px; }

    /* ── Empty state ──────────────────────────────────────── */

    .empty-state {
      padding: 44px 32px;
      text-align: center;
      color: var(--cl-text-muted);
      border-radius: var(--radius-lg) !important;
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      border-radius: var(--radius-lg);
      background: var(--hy-gray-100);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
    }

    .empty-icon mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--cl-text-soft);
    }

    .empty-title {
      margin: 4px 0 10px;
      font-family: var(--cl-font-display);
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--cl-text);
    }

    .empty-copy {
      margin: 0;
      font-size: 13px;
      line-height: 1.7;
    }

    .empty-copy.muted {
      margin-top: 6px;
      color: var(--cl-text-soft);
    }

    .permission-callout {
      max-width: 560px;
      margin: 18px auto 0;
      padding: 16px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: rgba(255, 248, 238, 0.92);
      border: 1px solid rgba(184, 107, 23, 0.2);
      text-align: left;
    }

    .permission-callout mat-icon { color: var(--cl-warning); }

    .permission-callout p {
      margin: 4px 0 0;
      font-size: 13px;
      line-height: 1.6;
      color: var(--cl-text-muted);
    }

    .compare-section { margin-top: 2px; }

    /* ── Facets (#2) ──────────────────────────────────────── */

    .facets {
      padding: 16px 20px;
      border-radius: var(--radius-lg) !important;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .active-facets,
    .facet-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }

    .facets-title,
    .facet-group-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--cl-text-soft);
      margin-right: 4px;
    }

    .facet-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--cl-border);
      border-radius: 14px;
      background: var(--cl-surface);
      color: var(--cl-text);
      font-size: 12px;
      padding: 4px 10px;
      cursor: pointer;
    }

    .facet-chip.active {
      border-color: rgba(0, 40, 85, 0.35);
      background: rgba(0, 40, 85, 0.05);
      color: var(--hy-navy);
    }

    .facet-chip mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .facet-count { color: var(--cl-text-soft); font-size: 11px; }

    .facet-clear {
      border: 0;
      background: none;
      color: var(--cl-primary);
      font-size: 12px;
      cursor: pointer;
    }

    /* ── Responsive ───────────────────────────────────────── */

    @media (max-width: 980px) {
      .hero-shell { grid-template-columns: 1fr; }
      .hero-panel { justify-self: stretch; max-width: none; }
      .search-bar { grid-template-columns: 1fr; }
      .search-action { width: 100%; }
    }
  `]
})
export class SearchComponent implements OnInit {
  query = '';
  /** The selected source option's key: '' for every source (#9). */
  sourceKey = '';
  sourceOptions: ContentSourceOption[] = [];
  results: RagResult[] = [];
  loading = false;
  searched = false;
  ctx: SearchContext | null = null;
  lastCompareResult: CompareResult | null = null;

  // #10 saved searches
  namedQueries: string[] = [];
  selectedNamedQuery = '';

  // #11 document budget, both unset so the request is what it always was
  topDocuments?: number;
  chunksPerDocument?: number;

  // #2 faceted search
  facetGroups: FacetGroup[] = [];
  activeFacets: { property: string; value: string }[] = [];

  constructor(
    private rag: RagService,
    private snackBar: MatSnackBar,
    private auth: AuthService,
    private sources: ContentSourceCatalogService
  ) {}

  ngOnInit(): void {
    this.sources.options().subscribe((options) => { this.sourceOptions = options; });
    this.rag.getNamedQueries().subscribe((names) => { this.namedQueries = names; });
  }

  /** A source with a login needs a session in that very source; any other is offered outright. */
  isSelectable(option: ContentSourceOption): boolean {
    return this.sources.isSelectable(option);
  }

  sourceTooltip(option: ContentSourceOption): string {
    if (!this.isSelectable(option)) return `Log in to ${option.label} first`;
    const docs = `${option.count} document${option.count !== 1 ? 's' : ''} indexed`;
    const id = option.level === 'id' ? ` - ${option.key}` : '';
    return `${option.label} only (${docs})${id}`;
  }

  colourFor(option: ContentSourceOption): string { return this.sources.optionColourClass(option); }

  sourceColour(sourceKey: string): string { return this.sources.colourClass(sourceKey); }

  iconFor(sourceType?: string): string { return sourceIcon(sourceType); }

  modifierFor(sourceType?: string): SourceModifier { return sourceModifier(sourceType); }

  typeLabel(sourceType?: string): string { return sourceTypeLabel(sourceType); }

  trackSource(_i: number, view: SourceSessionView): string { return view.source.sourceId; }

  get anyLoggedIn(): boolean { return this.auth.isAnyLoggedIn(); }

  /** One entry per source with a login, in the order rag-service lists them. */
  get sessionViews(): SourceSessionView[] { return this.auth.sessionViews(); }

  /** The source types behind the sessions panel, each once, for the hero badges. */
  get activeSessionCount(): number {
    return this.sessionViews.filter(view => view.session !== null).length;
  }

  search(): void {
    if (!this.query.trim()) return;
    this.loading = true;
    this.searched = false;
    this.results = [];
    this.ctx = null;
    this.lastCompareResult = null;

    const t0 = Date.now();
    const selected = this.sources.find(this.sourceOptions, this.sourceKey);
    // The source scope and the facet filter share one `filter` field, so they are combined here rather
    // than each being sent on its own.
    const scope = this.sources.scope(selected, this.buildFacetFilter());
    const namedQuery = this.selectedNamedQuery || undefined;

    const users: SearchContextUser[] = this.auth.sessionViews()
      .filter(view => view.session !== null)
      .map(view => ({
        sourceId: view.source.sourceId,
        sourceType: view.source.sourceType,
        label: view.label,
        username: view.session!.username
      }));

    this.rag.search(this.query, {
      sourceType: scope.sourceType,
      filter: scope.filter,
      namedQuery,
      topDocuments: this.topDocuments,
      chunksPerDocument: this.chunksPerDocument
    }).subscribe({
      next: outcome => {
        const elapsed = Date.now() - t0;
        this.results = outcome.results;
        this.loadFacets(scope.filter, scope.sourceType);
        this.ctx = {
          query: this.query,
          sourceType: scope.sourceType,
          filter: scope.filter,
          namedQuery,
          sourceLabel: selected?.label ?? '',
          sourceModifier: sourceModifier(selected?.sourceType),
          sourceColour: selected ? this.sources.optionColourClass(selected) : '',
          users,
          resultCount: outcome.results.length,
          documentCount: outcome.documentCount,
          searchTimeMs: elapsed
        };
        this.searched = true;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.searched = true;
        const msg = err.status === 401
          ? 'Authentication failed. Log in again.'
          : err.status === 0
            ? 'Cannot reach the RAG service.'
            : err.status > 0
              ? `Search error: ${err.status} ${err.statusText}`
              : `Search failed: ${err?.message ?? 'Unknown error'}`;
        this.snackBar.open(msg, 'Dismiss', { duration: 6000 });
      }
    });
  }

  openLink(result: RagResult): void {
    const url = result.openInSourceUrl ?? result.url;
    if (url) window.open(url, '_blank');
  }

  /* -------- #2 faceted search -------- */

  toggleFacet(property: string, value: string): void {
    const idx = this.activeFacets.findIndex((f) => f.property === property && f.value === value);
    if (idx >= 0) {
      this.activeFacets.splice(idx, 1);
    } else {
      this.activeFacets.push({ property, value });
    }
    if (this.query.trim()) {
      this.search();
    }
  }

  isFacetActive(property: string, value: string): boolean {
    return this.activeFacets.some((f) => f.property === property && f.value === value);
  }

  clearFacets(): void {
    if (this.activeFacets.length === 0) return;
    this.activeFacets = [];
    if (this.query.trim()) {
      this.search();
    }
  }

  facetLabel(property: string): string {
    if (property === 'cin_sourceId') return 'Source';
    if (property.toLowerCase().endsWith('mimetype')) return 'File type';
    const segment = property.split('.').pop() ?? property;
    const spaced = segment.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /** Human-friendly display for a bucket value (mime types and source ids get readable names). */
  facetValueLabel(property: string, value: string): string {
    if (property.toLowerCase().endsWith('mimetype')) {
      return SearchComponent.MIME_LABELS[value] ?? value;
    }
    // cin_sourceId buckets are `<sourceType>:<sourceId>`, which is not a label.
    if (property === 'cin_sourceId') {
      return this.sources.label(value);
    }
    return value;
  }

  private static readonly MIME_LABELS: Record<string, string> = {
    'text/plain': 'Plain text',
    'text/html': 'HTML',
    'text/csv': 'CSV',
    'application/pdf': 'PDF',
    'application/msword': 'Word document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
    'application/vnd.ms-excel': 'Excel spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel spreadsheet',
    'application/vnd.ms-powerpoint': 'PowerPoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'application/rtf': 'Rich text',
    'application/json': 'JSON',
    'application/xml': 'XML',
    'text/xml': 'XML'
  };

  private loadFacets(filter?: string, sourceType?: string): void {
    const properties = this.rag.facetProperties;
    if (!properties.length) {
      this.facetGroups = [];
      return;
    }

    forkJoin(
      properties.map((property) =>
        this.rag.facets({
          property,
          topN: 10,
          ...(filter ? { filter } : {}),
          ...(sourceType ? { sourceType } : {})
        }).pipe(catchError(() => of({ property, buckets: [] } as FacetsResponse)))
      )
    ).subscribe((responses) => {
      this.facetGroups = responses
        .filter((r) => Array.isArray(r.buckets) && r.buckets.length > 0)
        .map((r) => ({ property: r.property, label: this.facetLabel(r.property), buckets: r.buckets }));
    });
  }

  private buildFacetFilter(): string | undefined {
    if (this.activeFacets.length === 0) return undefined;
    const byProperty = new Map<string, string[]>();
    for (const facet of this.activeFacets) {
      const clauses = byProperty.get(facet.property) ?? [];
      clauses.push(`${facet.property} = '${escapeHxqlLiteral(facet.value)}'`);
      byProperty.set(facet.property, clauses);
    }
    let combined: string | undefined;
    for (const clauses of byProperty.values()) {
      combined = combineFilters(combined, clauses.length > 1 ? clauses.join(' OR ') : clauses[0]);
    }
    return combined;
  }

  onCompareComplete(result: CompareResult): void {
    this.lastCompareResult = result;
  }
}
