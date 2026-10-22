import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { ContentSourceCatalogService } from '../services/content-source-catalog.service';
import { RagResult } from '../services/rag.service';
import { sourceClass, sourceIcon } from '../utils/source-presentation';

@Component({
  selector: 'app-results',
  template: `
    <mat-card *ngFor="let r of results" class="result-card" [ngClass]="[cardClass(r.source), colourClass(r)]">
      <!-- Source identity stripe — 4px solid bar on left edge, color = source color -->
      <div class="result-stripe"></div>

      <div class="result-shell">
        <div class="result-header">
          <div class="result-icon" [ngClass]="iconClass(r.source)">
            <mat-icon>{{ sourceIcon(r.source) }}</mat-icon>
          </div>

          <div class="result-copy">
            <div class="result-topline">
              <span class="source-badge" [ngClass]="[badgeClass(r.source), colourClass(r)]">
                <mat-icon>{{ sourceIcon(r.source) }}</mat-icon>
                {{ sourceLabel(r) }}
                <!-- A type with several sources already names the source in the label. -->
                <span *ngIf="r.sourceId && !severalSources(r)" class="source-id">· {{ r.sourceId }}</span>
              </span>

              <span class="rank-pill">#{{ r.rank }}</span>
            </div>

            <h3>{{ r.title || '(untitled)' }}</h3>

            <div class="path-row" *ngIf="r.path">
              <mat-icon>chevron_right</mat-icon>
              <span [matTooltip]="r.path">{{ truncatePath(r.path) }}</span>
            </div>
          </div>
        </div>

        <!-- A TABLE chunk is a markdown table: reflowing it as prose destroys it (#118). -->
        <div *ngIf="r.chunkType === 'TABLE'" class="snippet snippet-table-wrap" [ngClass]="snippetClass(r.source)">
          <span class="chunk-badge">Table</span>
          <pre class="snippet-table">{{ r.snippet }}</pre>
        </div>
        <div *ngIf="r.chunkType !== 'TABLE'" class="snippet" [ngClass]="snippetClass(r.source)">{{ r.snippet }}</div>

        <div class="result-footer">
          <div class="footer-meta">
            <span class="metric-chip">
              <mat-icon>insights</mat-icon>
              {{ r.score | number:'1.2-2' }}
            </span>
            <span *ngIf="r.url || r.openInSourceUrl" class="footer-hint">Open in source repository</span>
          </div>

          <button mat-stroked-button
                  type="button"
                  class="open-button"
                  [ngClass]="buttonClass(r.source)"
                  *ngIf="r.openInSourceUrl || r.url"
                  (click)="select.emit(r)"
                  matTooltip="Open in source repository">
            <mat-icon>open_in_new</mat-icon>
            Open source
          </button>
        </div>
      </div>
    </mat-card>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .result-card {
      position: relative;
      overflow: hidden;
      border-radius: var(--radius-lg) !important;
      border: 1px solid var(--cl-border);
      box-shadow: var(--cl-shadow-soft);
      transition: box-shadow 220ms var(--ease-out), transform 220ms var(--ease-out), border-color 220ms var(--ease-out);
    }

    .result-card:hover {
      box-shadow: var(--cl-shadow-raised);
      transform: translateY(-2px);
      border-color: var(--cl-border-strong);
    }

    /* Source-identity stripe — 4px solid left edge */
    .result-stripe {
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--cl-border-strong);
    }

    /* The card carries the source's source-c<n> class, which sets the --src variables read below. */
    .result-card[class*='source-c'] .result-stripe { background: var(--src); }

    .result-shell {
      padding: 22px 24px 20px 26px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* ---- Header ---- */

    .result-header {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }

    .result-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: var(--hy-gray-100);
      color: var(--cl-primary);
      flex-shrink: 0;
    }

    .result-icon mat-icon {
      font-size: 20px;
      height: 20px;
      width: 20px;
    }

    .result-card[class*='source-c'] .result-icon {
      background: var(--src-soft);
      color: var(--src-strong);
    }

    .result-copy {
      min-width: 0;
      flex: 1;
    }

    .result-topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .source-id {
      opacity: 0.65;
      font-weight: 500;
    }

    h3 {
      margin: 0 0 6px;
      font-family: var(--cl-font-display);
      font-size: 18px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -0.02em;
      color: var(--cl-text);
    }

    .path-row {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      color: var(--cl-text-soft);
      font-size: 11px;
      max-width: 100%;
    }

    .path-row mat-icon {
      width: 14px;
      height: 14px;
      font-size: 14px;
      flex-shrink: 0;
      opacity: 0.6;
    }

    .rank-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--hy-gray-100);
      color: var(--cl-text-muted);
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }

    /* ---- Snippet ---- */

    .snippet {
      padding: 14px 16px;
      border-radius: var(--radius-md);
      background: var(--hy-gray-50);
      border-left: 3px solid var(--cl-border-strong);
      color: var(--cl-text);
      font-size: 13.5px;
      line-height: 1.75;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .snippet-generic  { border-left-color: var(--cl-border-strong); }
    .result-card[class*='source-c'] .snippet { border-left-color: color-mix(in srgb, var(--src) 50%, transparent); }

    /* ---- Table chunks (#118) ---- */

    .snippet-table-wrap {
      white-space: normal;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
    }

    .chunk-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: var(--radius-xs);
      background: var(--hy-gray-200);
      color: var(--hy-gray-700);
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .snippet-table {
      margin: 0;
      width: 100%;
      overflow-x: auto;
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px;
      line-height: 1.6;
      white-space: pre;
    }

    /* ---- Footer ---- */

    .result-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }

    .footer-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .footer-hint {
      color: var(--cl-text-soft);
      font-size: 11px;
    }

    .open-button {
      min-height: 36px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .open-button mat-icon {
      font-size: 15px;
      height: 15px;
      width: 15px;
    }

    .result-card[class*='source-c'] .open-button {
      color: var(--src-strong);
      border-color: color-mix(in srgb, var(--src) 30%, transparent);
      background: var(--src-soft);
    }
  `]
})
export class ResultsComponent {
  @Input() results: RagResult[] = [];
  @Output() select = new EventEmitter<RagResult>();

  constructor(private auth: AuthService, private sources: ContentSourceCatalogService) {}

  truncatePath(path: string): string {
    if (!path || path.length <= 56) return path;
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return `/${parts[0]}/…/${parts[parts.length - 1]}`;
  }

  sourceIcon(source: string | undefined): string { return sourceIcon(source); }

  /** The source's display name, or its type with a short id. */
  sourceLabel(r: RagResult): string { return this.auth.resultSourceLabel(r.source, r.sourceId); }

  /** The `source-c<n>` palette class of the hit's source. */
  colourClass(r: RagResult): string { return this.sources.colourClass(r.sourceId || r.source); }

  severalSources(r: RagResult): boolean { return this.auth.hasSeveralSources(r.source); }

  badgeClass(source: string | undefined): string { return sourceClass('source-badge', source); }

  cardClass(source: string | undefined): string { return sourceClass('result', source); }

  iconClass(source: string | undefined): string { return sourceClass('result-icon', source); }

  buttonClass(source: string | undefined): string { return sourceClass('open-button', source); }

  snippetClass(source: string | undefined): string { return sourceClass('snippet', source); }
}
