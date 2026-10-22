import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService, SourceSessionView } from '../services/auth.service';
import { ConnectorService } from '../services/connector.service';
import { SourceModifier, sourceIcon, sourceModifier } from '../utils/source-presentation';

// Satori App Chrome integration point:
// When Satori's Application Shell header component is available, replace this
// custom toolbar with the platform-provided chrome (Level 3 adoption).
// https://hyland.atlassian.net/wiki/spaces/HDF/pages/2566653230
// https://hyland.atlassian.net/wiki/spaces/HDF/pages/3076359112
@Component({
  selector: 'app-navbar',
  template: `
    <header class="app-header">
      <div class="header-shell">

        <button class="brand-block" type="button" (click)="router.navigate(['/search'])">
          <img src="assets/hyland-logo.svg" class="hy-logo" alt="Hyland" />
          <span class="brand-divider" aria-hidden="true"></span>
          <span class="brand-copy">
            <span class="brand-title">AI Ready Content Hub</span>
            <span class="brand-subtitle">Multi-source search &amp; RAG</span>
          </span>
        </button>

        <nav class="header-nav" aria-label="Main navigation">
          <a routerLink="/search" routerLinkActive="nav-active" class="nav-link">
            <mat-icon>search</mat-icon>
            <span>Search</span>
          </a>
          <a routerLink="/chat" routerLinkActive="nav-active" class="nav-link">
            <mat-icon>chat</mat-icon>
            <span>Chat</span>
          </a>
          <a routerLink="/status" routerLinkActive="nav-active" class="nav-link">
            <mat-icon>monitor_heart</mat-icon>
            <span>Status</span>
          </a>
          <!-- Only when a connector host is configured. A deployment without the connector profile is a
               supported shape, so the entry is absent there rather than leading to a screen that cannot
               work. -->
          <a *ngIf="sourcesAvailable" routerLink="/sources" routerLinkActive="nav-active" class="nav-link">
            <mat-icon>account_tree</mat-icon>
            <span>Sources</span>
          </a>
          <a routerLink="/login" routerLinkActive="nav-active" class="nav-link">
            <mat-icon>manage_accounts</mat-icon>
            <span>Connections</span>
          </a>
        </nav>

        <div class="header-sessions" role="status" aria-label="Repository sessions">

          <div *ngFor="let view of views$ | async; trackBy: trackSource"
               class="session-pill"
               [ngClass]="'session-pill-' + modifierFor(view.source.sourceType)"
               [class.connected]="view.session !== null">
            <mat-icon class="session-icon">{{ iconFor(view.source.sourceType) }}</mat-icon>
            <span class="session-label">
              <span class="session-source">{{ view.label }}</span>
              <ng-container *ngIf="view.session as session; else off">
                <strong class="session-user">{{ session.username }}</strong>
              </ng-container>
              <ng-template #off>
                <span class="session-offline">offline</span>
              </ng-template>
            </span>
            <button *ngIf="view.session !== null"
                    mat-icon-button type="button"
                    class="session-logout"
                    [matTooltip]="'Disconnect ' + view.label"
                    (click)="logout(view.source.sourceId, $event)">
              <mat-icon>logout</mat-icon>
            </button>
          </div>

        </div>
      </div>

      <!-- 4-colour accent strip — mirrors the logo mark's parallelogram order. -->
      <div class="header-accent" aria-hidden="true"></div>
    </header>
  `,
  styles: [`
    :host { display: block; }

    .app-header {
      position: sticky;
      top: 0;
      z-index: 20;
      background: #ffffff;
      color: var(--hy-navy);
      border-bottom: 1px solid var(--cl-border);
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 4px 18px -12px rgba(0, 40, 85, 0.18);
    }

    .header-shell {
      width: 100%;
      max-width: var(--container-wide);
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 72px;
      padding: 0 24px;
    }

    /* ── Brand block ───────────────────────────────────────── */

    .brand-block {
      display: flex;
      align-items: center;
      gap: 14px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 8px 10px 8px 0;
      text-align: left;
      border-radius: var(--radius-sm);
      transition: background 140ms var(--ease-out);
      flex-shrink: 0;
    }

    .brand-block:hover { background: var(--hy-gray-50); }

    .hy-logo {
      height: 32px;
      width: auto;
      display: block;
      image-rendering: crisp-edges;
    }

    .brand-divider {
      width: 1px;
      height: 30px;
      background: var(--cl-border);
      flex-shrink: 0;
    }

    .brand-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .brand-title {
      font-family: var(--cl-font-display);
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.015em;
      color: var(--hy-navy);
      line-height: 1.15;
    }

    .brand-subtitle {
      font-size: 10px;
      color: var(--cl-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-weight: 500;
      line-height: 1.2;
    }

    /* ── Navigation ────────────────────────────────────────── */

    .header-nav {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 20px;
    }

    .nav-link {
      position: relative;
      height: 44px;
      padding: 0 14px;
      border-radius: var(--radius-sm);
      color: var(--hy-gray-500);
      font-family: var(--cl-font-display);
      font-size: 14px;
      font-weight: 500;
      letter-spacing: -0.005em;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      text-decoration: none;
      transition: color 140ms var(--ease-out), background 140ms var(--ease-out);
    }

    .nav-link mat-icon {
      font-size: 18px;
      height: 18px;
      width: 18px;
    }

    .nav-link:hover {
      color: var(--hy-navy);
      background: var(--hy-gray-50);
      text-decoration: none;
    }

    /* Active state: hyland.com-style bottom indicator (teal underline) */
    .nav-active {
      color: var(--hy-navy) !important;
      background: transparent !important;
    }

    .nav-active::after {
      content: "";
      position: absolute;
      left: 14px;
      right: 14px;
      bottom: -1px;
      height: 3px;
      border-radius: 3px 3px 0 0;
      background: var(--hy-mark-teal);
    }

    /* ── Session pills ─────────────────────────────────────── */

    .header-sessions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .session-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 8px 6px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--cl-border);
      background: var(--hy-gray-50);
      color: var(--hy-gray-400);
      font-size: 12px;
      transition: all 160ms var(--ease-out);
    }

    .session-pill.connected {
      color: var(--hy-navy);
      background: #ffffff;
      border-color: var(--cl-border-strong);
    }

    .session-icon {
      font-size: 16px;
      height: 16px;
      width: 16px;
      flex-shrink: 0;
      color: var(--hy-gray-300);
    }

    .connected .session-icon { color: var(--hy-gray-500); }

    .session-pill-alfresco.connected .session-icon { color: var(--source-alfresco-strong); }
    .session-pill-nuxeo.connected   .session-icon { color: var(--source-nuxeo-strong); }

    .session-pill-alfresco.connected {
      border-color: rgba(120, 190, 32, 0.35);
      background: rgba(239, 248, 223, 0.6);
    }

    .session-pill-nuxeo.connected {
      border-color: rgba(0, 163, 224, 0.3);
      background: rgba(229, 246, 252, 0.6);
    }

    .session-label {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .session-source {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-weight: 700;
      color: var(--hy-gray-400);
      line-height: 1.1;
    }

    .connected .session-source { color: var(--cl-text-muted); }

    .session-user {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
      line-height: 1.2;
      color: var(--hy-navy);
    }

    .session-offline {
      font-size: 11px;
      color: var(--hy-gray-300);
      font-style: italic;
    }

    .session-logout {
      width: 26px;
      height: 26px;
      line-height: 26px;
      color: var(--hy-gray-400);
      flex-shrink: 0;
    }

    .session-logout mat-icon { font-size: 14px; }
    .session-logout:hover { color: var(--hy-navy); }

    /* ── 4-colour brand accent ─────────────────────────────── */

    .header-accent {
      height: 2px;
      background: linear-gradient(90deg,
        var(--hy-mark-yellow)  0%,
        var(--hy-mark-yellow) 25%,
        var(--hy-mark-purple) 25%,
        var(--hy-mark-purple) 50%,
        var(--hy-mark-blue)   50%,
        var(--hy-mark-blue)   75%,
        var(--hy-mark-teal)   75%,
        var(--hy-mark-teal)  100%
      );
    }

    /* ── Responsive ────────────────────────────────────────── */

    @media (max-width: 1040px) {
      .header-shell {
        flex-wrap: wrap;
        padding: 10px 16px;
        min-height: 0;
        gap: 10px;
      }
      .header-nav { margin-left: 8px; }
      .header-sessions { margin-left: auto; }
    }

    @media (max-width: 700px) {
      .brand-subtitle { display: none; }
      .session-user   { max-width: 72px; }
      .nav-link span  { display: none; }
    }
  `]
})
export class NavbarComponent {
  /** One pill per source with a login, in the order rag-service lists them. */
  views$: Observable<SourceSessionView[]>;

  constructor(public router: Router, private auth: AuthService, private connectors: ConnectorService) {
    this.views$ = auth.sessionViews$;
  }

  /**
   * Whether this deployment has a connector host at all.
   *
   * Read from configuration rather than probed. A probe would put a request on every page load to decide
   * whether to draw a link, and the answer cannot change without a redeploy: the screen itself reports an
   * unreachable host, which is the right place for a runtime failure.
   */
  get sourcesAvailable(): boolean {
    return this.connectors.configured;
  }

  iconFor(sourceType?: string): string { return sourceIcon(sourceType); }

  modifierFor(sourceType?: string): SourceModifier { return sourceModifier(sourceType); }

  trackSource(_i: number, view: SourceSessionView): string { return view.source.sourceId; }

  logout(sourceId: string, event: Event): void {
    event.stopPropagation();
    this.auth.logout(sourceId);
  }
}
