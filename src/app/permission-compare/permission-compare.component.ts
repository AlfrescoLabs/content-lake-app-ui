import { HttpHeaders } from '@angular/common/http';
import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { AuthService, SourceSessionView } from '../services/auth.service';
import { ContentSourceType, RagResult, RagService } from '../services/rag.service';
import { permissionVerdict } from '../utils/permission-verdict';
import { SourceModifier, sourceClass, sourceIcon, sourceModifier } from '../utils/source-presentation';

export interface CompareResult {
  username: string;
  /** The source the comparison identity signed in to. */
  sourceId: string;
  sourceType: ContentSourceType;
  sourceLabel: string;
  count: number;
  results: RagResult[];
}

/**
 * What identifies one document across sources: its source id and its node id. A title or a link is not
 * enough, because two sources of one type can hold documents with the same name.
 */
export function documentKey(result: RagResult): string {
  if (result.nodeId) return `${result.sourceId ?? ''}::${result.nodeId}`;
  return result.openInSourceUrl ?? result.title;
}

@Component({
  selector: 'app-permission-compare',
  template: `
    <mat-expansion-panel [expanded]="autoExpand" class="compare-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>
          <mat-icon>compare_arrows</mat-icon>
          Permission comparison
        </mat-panel-title>
        <mat-panel-description>
          Re-run this query as another user and inspect the difference.
        </mat-panel-description>
      </mat-expansion-panel-header>

      <div class="compare-shell">

        <div class="compare-form">
          <!-- A source, not a type: two sources of one type are compared one at a time. -->
          <mat-button-toggle-group [ngModel]="selectedSource?.source?.sourceId"
                                   (ngModelChange)="compareSourceId = $event"
                                   class="compare-toggle">
            <mat-button-toggle *ngFor="let view of sources; trackBy: trackSource" [value]="view.source.sourceId">
              <span class="toggle-label" [ngClass]="'toggle-label-' + modifierFor(view.source.sourceType)">
                <mat-icon>{{ iconFor(view.source.sourceType) }}</mat-icon>
                {{ view.label }}
              </span>
            </mat-button-toggle>
          </mat-button-toggle-group>

          <mat-form-field appearance="outline" class="compare-field">
            <mat-label>Username</mat-label>
            <input matInput [(ngModel)]="compareUser" [disabled]="comparing" autocomplete="off" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="compare-field">
            <mat-label>Password</mat-label>
            <input matInput
                   type="password"
                   [(ngModel)]="comparePass"
                   [disabled]="comparing"
                   autocomplete="new-password"
                   (keyup.enter)="runComparison()" />
          </mat-form-field>

          <button mat-raised-button color="primary"
                  type="button"
                  class="compare-action"
                  [disabled]="!canCompare"
                  (click)="runComparison()">
            <mat-spinner *ngIf="comparing" diameter="16"></mat-spinner>
            <span>{{ comparing ? 'Running…' : 'Compare access' }}</span>
          </button>
        </div>

        <p *ngIf="authError" class="auth-error">
          <mat-icon>error_outline</mat-icon>
          {{ authError }}
        </p>

        <div *ngIf="compareResult" class="compare-results">
          <div class="score-grid">

            <div class="score-card score-card-main" [ngClass]="scoreClass(mainSource)">
              <span class="score-label">Current view</span>
              <strong class="score-count">{{ mainCount }}</strong>
              <span class="user-tag" [ngClass]="userTagClass(mainSource)">
                {{ mainUsername || 'Current session' }}
              </span>
            </div>

            <div class="score-card score-card-compare" [ngClass]="scoreClass(compareResult.sourceType)">
              <span class="score-label">Comparison view</span>
              <strong class="score-count">{{ compareResult.count }}</strong>
              <span class="user-tag" [ngClass]="userTagClass(compareResult.sourceType)">
                {{ compareResult.username }}
              </span>
            </div>

            <div class="verdict-box" [class.verdict-equal]="!diffDetected">
              <mat-icon>{{ diffDetected ? 'shield' : 'check_circle' }}</mat-icon>
              <div>
                <strong>{{ diffDetected ? 'Permission filtering detected' : 'Same visible result count' }}</strong>
                <p>
                  {{ diffDetected
                    ? verdictText
                    : 'Both identities see the same number of results for this search.' }}
                </p>
              </div>
            </div>

          </div>

          <ng-container *ngIf="extraResults.length > 0">
            <div class="result-section">
              <div class="result-section-header">
                <span class="eyebrow">More visible to comparison user</span>
                <h3>{{ compareResult.username }} can access these documents and you cannot.</h3>
              </div>
              <app-results [results]="extraResults" (select)="openLink($event)"></app-results>
            </div>
          </ng-container>

          <ng-container *ngIf="hiddenResults.length > 0">
            <div class="result-section">
              <div class="result-section-header">
                <span class="eyebrow">More visible to current user</span>
                <h3>You can access these documents and {{ compareResult.username }} cannot.</h3>
              </div>
              <app-results [results]="hiddenResults" (select)="openLink($event)"></app-results>
            </div>
          </ng-container>
        </div>

      </div>
    </mat-expansion-panel>
  `,
  styles: [`
    .compare-panel {
      /* Shape via MDC token in styles.scss — no internal class selectors */
      overflow: hidden;
      border: 1px solid var(--cl-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--cl-shadow-soft);
    }

    .compare-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-top: 4px;
    }

    /* ---- Form ---- */

    .compare-form {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }

    .compare-toggle {
      height: 44px;
      border-radius: 6px;
      background: var(--hy-gray-50);
    }

    .toggle-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
      font-size: 12px;
    }

    .toggle-label mat-icon {
      width: 15px;
      height: 15px;
      font-size: 15px;
    }

    .toggle-label-alfresco { color: var(--source-alfresco-strong); }
    .toggle-label-nuxeo    { color: var(--source-nuxeo-strong); }

    .compare-field {
      min-width: 0;
      margin-bottom: -1.25em;
    }

    .compare-action {
      min-height: 44px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .auth-error {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      color: var(--cl-danger);
      font-size: 12px;
    }

    .auth-error mat-icon {
      font-size: 15px;
      height: 15px;
      width: 15px;
    }

    /* ---- Results ---- */

    .compare-results {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .score-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(160px, 220px)) minmax(0, 1fr);
      gap: 12px;
      align-items: stretch;
    }

    .score-card {
      padding: 20px;
      border-radius: var(--radius-md);
      border: 1px solid var(--cl-border);
      background: var(--hy-gray-50);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .score-card-alfresco {
      border-color: rgba(120, 190, 32, 0.24);
      background: var(--source-alfresco-soft);
    }

    .score-card-nuxeo {
      border-color: rgba(0, 163, 224, 0.2);
      background: var(--source-nuxeo-soft);
    }

    .score-label {
      color: var(--cl-text-soft);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .score-count {
      font-family: var(--cl-font-display);
      font-size: 44px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.04em;
      color: var(--cl-text);
    }

    .user-tag {
      display: inline-flex;
      width: fit-content;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      color: var(--cl-text-muted);
      background: rgba(0, 40, 85, 0.06);
    }

    .user-tag-alfresco {
      background: rgba(120, 190, 32, 0.12);
      color: var(--source-alfresco-strong);
    }

    .user-tag-nuxeo {
      background: rgba(0, 163, 224, 0.1);
      color: var(--source-nuxeo-strong);
    }

    .verdict-box {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      border-radius: 8px;
      background: rgba(255, 248, 238, 0.9);
      border: 1px solid rgba(184, 107, 23, 0.2);
      color: var(--cl-warning);
    }

    .verdict-box mat-icon { flex-shrink: 0; }

    .verdict-box strong {
      display: block;
      margin-bottom: 4px;
      color: var(--cl-text);
      font-size: 13px;
    }

    .verdict-box p {
      margin: 0;
      color: var(--cl-text-muted);
      font-size: 12px;
      line-height: 1.6;
    }

    .verdict-equal {
      background: rgba(46, 125, 50, 0.06);
      border-color: rgba(46, 125, 50, 0.18);
      color: var(--cl-success);
    }

    .result-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .result-section-header h3 {
      margin: 6px 0 0;
      font-family: var(--cl-font-display);
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--cl-text);
    }

    @media (max-width: 1080px) {
      .compare-form,
      .score-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PermissionCompareComponent implements OnChanges {
  @Input() query = '';
  @Input() sourceFilter: ContentSourceType | '' = '';
  /**
   * The HXQL filter the main search sent: active facets, and any source-id clause (#12).
   *
   * Without it the comparison runs unfiltered against a filtered main search, and documents excluded by
   * a facet are reported as documents the other identity cannot see.
   */
  @Input() searchFilter = '';
  @Input() namedQuery = '';
  @Input() mainResults: RagResult[] = [];
  @Input() mainUsername = '';
  @Input() mainSource: ContentSourceType | '' = '';
  @Output() compareComplete = new EventEmitter<CompareResult>();

  /** The source to sign in to. Empty until picked, which means the first one listed. */
  compareSourceId = '';
  compareUser = '';
  comparePass = '';
  comparing = false;
  authError = '';
  compareResult: CompareResult | null = null;
  autoExpand = false;

  constructor(private auth: AuthService, private rag: RagService) {}

  ngOnChanges(): void {
    this.autoExpand = this.mainResults.length === 0 && this.query.length > 0;
    this.compareResult = null;
    this.authError = '';
  }

  get canCompare(): boolean {
    return !!this.compareUser.trim() && !!this.comparePass.trim() && !!this.query.trim() && !this.comparing;
  }

  get mainCount(): number { return this.mainResults.length; }

  get diffDetected(): boolean {
    return this.compareResult !== null && this.compareResult.count !== this.mainCount;
  }

  /** Which way the difference goes, worded. A bare subtraction here read as "sees -3 more document(s)". */
  get verdictText(): string {
    if (!this.compareResult) return '';
    return permissionVerdict(this.compareResult.username, this.compareResult.count, this.mainCount);
  }

  /** The sources a comparison identity can sign in to. */
  get sources(): SourceSessionView[] { return this.auth.sessionViews(); }

  /** The picked source, or the first one listed when the pick is empty or no longer listed. */
  get selectedSource(): SourceSessionView | undefined {
    const views = this.sources;
    return views.find(view => view.source.sourceId === this.compareSourceId) ?? views[0];
  }

  get extraResults(): RagResult[] {
    if (!this.compareResult) return [];
    const mainIds = new Set(this.mainResults.map(documentKey));
    return this.compareResult.results.filter(r => !mainIds.has(documentKey(r)));
  }

  get hiddenResults(): RagResult[] {
    if (!this.compareResult) return [];
    const compareIds = new Set(this.compareResult.results.map(documentKey));
    return this.mainResults.filter(r => !compareIds.has(documentKey(r)));
  }

  runComparison(): void {
    const selected = this.selectedSource;
    if (!this.canCompare || !selected) return;
    this.comparing = true;
    this.authError = '';
    this.compareResult = null;

    this.auth.authenticate(selected.source.sourceId, this.compareUser, this.comparePass).subscribe({
      next: session => {
        // Only the comparison identity's credential goes out; the interceptor leaves an explicit one alone.
        const headers = new HttpHeaders(this.auth.headersFor([session]));

        this.rag.searchWithHeaders(this.query, headers, {
          sourceType: this.sourceFilter || undefined,
          filter: this.searchFilter || undefined,
          namedQuery: this.namedQuery || undefined
        }).subscribe({
          next: results => {
            this.compareResult = {
              username: session.username,
              sourceId: selected.source.sourceId,
              sourceType: selected.source.sourceType,
              sourceLabel: selected.label,
              count: results.length,
              results
            };
            this.compareComplete.emit(this.compareResult);
            this.comparing = false;
          },
          error: err => {
            this.authError = err?.status > 0
              ? `Search failed: ${err.status} ${err.statusText}`
              : `Search failed: ${err?.message ?? 'Unknown error'}`;
            this.comparing = false;
          }
        });
      },
      error: err => {
        this.authError = err?.status === 401
          ? 'Invalid credentials for comparison user.'
          : err?.message ?? 'Authentication failed.';
        this.comparing = false;
      }
    });
  }

  iconFor(sourceType?: string): string { return sourceIcon(sourceType); }

  modifierFor(sourceType?: string): SourceModifier { return sourceModifier(sourceType); }

  trackSource(_i: number, view: SourceSessionView): string { return view.source.sourceId; }

  openLink(result: RagResult): void {
    const url = result.openInSourceUrl ?? result.url;
    if (url) window.open(url, '_blank');
  }

  scoreClass(source: ContentSourceType | '' | undefined): string {
    return sourceClass('score-card', source || undefined);
  }

  userTagClass(source: ContentSourceType | '' | undefined): string {
    return sourceClass('user-tag', source || undefined);
  }
}
