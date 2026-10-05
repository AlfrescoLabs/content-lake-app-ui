import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-auth',
  template: `
    <!-- Editorial hero on dark navy canvas ---------------------------------- -->
    <section class="auth-hero-canvas">
      <div class="hero-glow hero-glow-yellow"></div>
      <div class="hero-glow hero-glow-purple"></div>
      <div class="hero-glow hero-glow-blue"></div>
      <div class="hero-glow hero-glow-teal"></div>

      <div class="hero-shell">
        <div class="hero-copy">
          <span class="eyebrow eyebrow-oncanvas">Connections</span>
          <h1 class="display-1 hero-title">
            Connect once. Keep source identity visible
            <span class="accent-teal">everywhere</span>.
          </h1>
          <p class="hero-lede">
            Alfresco uses green accents and Nuxeo uses blue accents across search and chat —
            so provenance stays readable even when both repositories contribute to the same session.
          </p>

          <div class="hero-chips">
            <span class="source-badge source-badge-alfresco">
              <mat-icon>storage</mat-icon>
              Alfresco
            </span>
            <span class="source-badge source-badge-nuxeo">
              <mat-icon>folder_open</mat-icon>
              Nuxeo
            </span>
            <span class="metric-chip metric-chip-oncanvas">
              <mat-icon>lock</mat-icon>
              Independent permissions
            </span>
          </div>
        </div>

        <aside class="hero-stat">
          <span class="stat-label">Active sessions</span>
          <div class="stat-value-row">
            <strong class="stat-value">{{ activeSessionCount }}</strong>
            <span class="stat-of">/ 2</span>
          </div>
          <p class="stat-note">
            Search and chat automatically merge the active identities you establish here.
          </p>
          <div class="stat-dots">
            <span class="stat-dot" [class.dot-alfresco]="alfrescoLoggedIn" [class.dot-inactive]="!alfrescoLoggedIn"></span>
            <span class="stat-dot" [class.dot-nuxeo]="nuxeoLoggedIn" [class.dot-inactive]="!nuxeoLoggedIn"></span>
          </div>
        </aside>
      </div>
    </section>

    <div class="page-container-wide auth-body">

      <div class="auth-grid">

        <mat-card class="connect-card" [class.connect-ready]="alfrescoLoggedIn">
          <div class="card-accent card-accent-alfresco"></div>
          <div class="connect-card-shell">
            <div class="connect-header">
              <div class="connect-icon connect-icon-alfresco">
                <mat-icon>storage</mat-icon>
              </div>
              <div class="connect-identity">
                <span class="eyebrow">Repository</span>
                <h2>Alfresco</h2>
                <p class="connect-status" [class.connected-label]="alfrescoLoggedIn">
                  <mat-icon class="status-dot-icon">{{ alfrescoLoggedIn ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
                  {{ alfrescoLoggedIn ? ('Connected as ' + alfrescoUser) : 'Not connected' }}
                </p>
              </div>
            </div>

            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Username</mat-label>
              <input matInput [(ngModel)]="alfrescoUsername" [disabled]="alfrescoLoading" autocomplete="username" />
            </mat-form-field>

            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Password</mat-label>
              <input matInput
                     type="password"
                     [(ngModel)]="alfrescoPassword"
                     [disabled]="alfrescoLoading"
                     autocomplete="current-password"
                     (keyup.enter)="loginAlfresco()" />
            </mat-form-field>

            <p *ngIf="alfrescoError" class="error-text">
              <mat-icon>error_outline</mat-icon>
              {{ alfrescoError }}
            </p>

            <div class="action-row">
              <button mat-raised-button color="primary"
                      class="connect-action"
                      (click)="loginAlfresco()"
                      [disabled]="alfrescoLoading">
                <mat-spinner *ngIf="alfrescoLoading" diameter="16"></mat-spinner>
                <span>{{ alfrescoLoggedIn ? 'Reconnect' : 'Connect Alfresco' }}</span>
                <mat-icon *ngIf="!alfrescoLoading">arrow_forward</mat-icon>
              </button>
              <button mat-button type="button" class="logout-link" *ngIf="alfrescoLoggedIn" (click)="logoutAlfresco()">
                Disconnect
              </button>
            </div>
          </div>
        </mat-card>

        <mat-card class="connect-card" [class.connect-ready]="nuxeoLoggedIn">
          <div class="card-accent card-accent-nuxeo"></div>
          <div class="connect-card-shell">
            <div class="connect-header">
              <div class="connect-icon connect-icon-nuxeo">
                <mat-icon>folder_open</mat-icon>
              </div>
              <div class="connect-identity">
                <span class="eyebrow">Repository</span>
                <h2>Nuxeo</h2>
                <p class="connect-status" [class.connected-label]="nuxeoLoggedIn">
                  <mat-icon class="status-dot-icon">{{ nuxeoLoggedIn ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
                  {{ nuxeoLoggedIn ? ('Connected as ' + nuxeoUser) : 'Not connected' }}
                </p>
              </div>
            </div>

            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Username</mat-label>
              <input matInput [(ngModel)]="nuxeoUsername" [disabled]="nuxeoLoading" autocomplete="username" />
            </mat-form-field>

            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Password</mat-label>
              <input matInput
                     type="password"
                     [(ngModel)]="nuxeoPassword"
                     [disabled]="nuxeoLoading"
                     autocomplete="current-password"
                     (keyup.enter)="loginNuxeo()" />
            </mat-form-field>

            <p *ngIf="nuxeoError" class="error-text">
              <mat-icon>error_outline</mat-icon>
              {{ nuxeoError }}
            </p>

            <div class="action-row">
              <button mat-raised-button
                      type="button"
                      class="connect-action connect-action-nuxeo"
                      (click)="loginNuxeo()"
                      [disabled]="nuxeoLoading">
                <mat-spinner *ngIf="nuxeoLoading" diameter="16"></mat-spinner>
                <span>{{ nuxeoLoggedIn ? 'Reconnect' : 'Connect Nuxeo' }}</span>
                <mat-icon *ngIf="!nuxeoLoading">arrow_forward</mat-icon>
              </button>
              <button mat-button type="button" class="logout-link" *ngIf="nuxeoLoggedIn" (click)="logoutNuxeo()">
                Disconnect
              </button>
            </div>
          </div>
        </mat-card>

      </div>

      <section class="proceed-card editorial-surface">
        <div class="proceed-accent" aria-hidden="true"></div>
        <div class="proceed-copy">
          <span class="eyebrow">Next step</span>
          <h2 class="display-2">Move into search once at least one repository is available.</h2>
          <p class="section-copy">Both repositories are optional. The UI adapts to whichever sessions are active.</p>
        </div>

        <div class="proceed-actions">
          <button mat-raised-button color="primary"
                  class="proceed-button"
                  (click)="proceed()">
            <span>Proceed to search</span>
            <mat-icon>arrow_forward</mat-icon>
          </button>
        </div>
      </section>

    </div>
  `,
  styles: [`
    :host { display: block; }

    /* ── Hero canvas ────────────────────────────────────────── */

    .auth-hero-canvas {
      position: relative;
      overflow: hidden;
      background:
        radial-gradient(120% 160% at 85% -10%, #0F2A52 0%, transparent 55%),
        linear-gradient(180deg, var(--cl-bg-canvas) 0%, #061127 100%);
      color: var(--cl-text-oncanvas);
      padding: clamp(56px, 8vw, 96px) 0 clamp(60px, 8vw, 104px);
    }

    /* Mark-colour ambient glows */
    .hero-glow {
      position: absolute;
      pointer-events: none;
      border-radius: 50%;
      filter: blur(80px);
      opacity: 0.55;
    }
    .hero-glow-yellow {
      width: 320px; height: 320px;
      top: -80px; left: 8%;
      background: var(--hy-mark-yellow);
      opacity: 0.18;
    }
    .hero-glow-purple {
      width: 360px; height: 360px;
      top: 30%; left: 38%;
      background: var(--hy-mark-purple);
      opacity: 0.22;
    }
    .hero-glow-blue {
      width: 380px; height: 380px;
      top: 10%; right: 10%;
      background: var(--hy-mark-blue);
      opacity: 0.25;
    }
    .hero-glow-teal {
      width: 280px; height: 280px;
      bottom: -60px; right: 30%;
      background: var(--hy-mark-teal);
      opacity: 0.22;
    }

    .hero-shell {
      position: relative;
      max-width: var(--container-wide);
      margin: 0 auto;
      padding: 0 24px;
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.85fr);
      gap: clamp(28px, 5vw, 64px);
      align-items: end;
    }

    .hero-copy {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .hero-title {
      color: var(--cl-text-oncanvas);
      max-width: 18ch;
    }

    .accent-teal {
      background: linear-gradient(90deg, var(--hy-mark-teal), var(--hy-mark-blue));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .hero-lede {
      margin: 0;
      color: var(--cl-text-oncanvas-muted);
      font-size: clamp(15px, 1.25vw, 17px);
      line-height: 1.7;
      max-width: 58ch;
    }

    .hero-chips {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    /* ── Hero stat card ─────────────────────────────────────── */

    .hero-stat {
      justify-self: end;
      width: 100%;
      max-width: 340px;
      padding: 28px 28px 24px;
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(14px);
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.5);
    }

    .stat-label {
      font-family: var(--cl-font);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--hy-mark-teal);
    }

    .stat-value-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .stat-value {
      font-family: var(--cl-font-display);
      font-size: 64px;
      font-weight: 700;
      letter-spacing: -0.04em;
      color: var(--cl-text-oncanvas);
      line-height: 1;
    }

    .stat-of {
      font-size: 22px;
      font-weight: 500;
      color: var(--cl-text-oncanvas-muted);
    }

    .stat-note {
      margin: 0;
      font-size: 13px;
      line-height: 1.65;
      color: var(--cl-text-oncanvas-muted);
    }

    .stat-dots {
      display: flex;
      gap: 8px;
      margin-top: auto;
    }

    .stat-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.4);
    }

    .dot-alfresco {
      background: var(--source-alfresco);
      border-color: var(--source-alfresco);
      box-shadow: 0 0 0 4px rgba(120, 190, 32, 0.25);
    }
    .dot-nuxeo {
      background: var(--source-nuxeo);
      border-color: var(--source-nuxeo);
      box-shadow: 0 0 0 4px rgba(0, 163, 224, 0.25);
    }
    .dot-inactive { background: transparent; }

    /* ── Body ───────────────────────────────────────────────── */

    .auth-body {
      display: flex;
      flex-direction: column;
      gap: 20px;
      /* Overlap hero by pulling content up — hyland.com editorial move */
      margin-top: clamp(-56px, -5vw, -40px);
      position: relative;
      z-index: 2;
    }

    /* ── Connection cards ──────────────────────────────────── */

    .auth-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
    }

    .connect-card {
      overflow: hidden;
      position: relative;
      border-radius: var(--radius-lg) !important;
      border: 1px solid var(--cl-border);
      box-shadow: var(--cl-shadow);
      transition: transform 220ms var(--ease-out), box-shadow 220ms var(--ease-out);
    }

    .connect-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--cl-shadow-raised);
    }

    .card-accent {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
    }

    .card-accent-alfresco {
      background: linear-gradient(90deg, var(--source-alfresco) 0%, rgba(120, 190, 32, 0.2) 100%);
    }

    .card-accent-nuxeo {
      background: linear-gradient(90deg, var(--source-nuxeo) 0%, rgba(0, 163, 224, 0.2) 100%);
    }

    .connect-card-shell {
      padding: 28px 28px 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 4px;
    }

    .connect-header {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }

    .connect-icon {
      width: 52px;
      height: 52px;
      border-radius: var(--radius-md);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .connect-icon mat-icon {
      font-size: 26px;
      height: 26px;
      width: 26px;
    }

    .connect-icon-alfresco {
      background: var(--source-alfresco-soft);
      color: var(--source-alfresco-strong);
    }

    .connect-icon-nuxeo {
      background: var(--source-nuxeo-soft);
      color: var(--source-nuxeo-strong);
    }

    .connect-identity { min-width: 0; }

    .connect-identity .eyebrow { margin-bottom: 2px; }

    .connect-identity h2 {
      margin: 6px 0 4px;
      font-family: var(--cl-font-display);
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.025em;
    }

    .connect-status {
      margin: 0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--cl-text-soft);
    }

    .status-dot-icon {
      font-size: 14px !important;
      height: 14px !important;
      width: 14px !important;
    }

    .connect-status.connected-label {
      color: var(--cl-success);
      font-weight: 600;
    }

    .auth-field {
      width: 100%;
      margin-bottom: -1.25em;
    }

    .error-text {
      margin: 0;
      color: var(--cl-danger);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .error-text mat-icon {
      font-size: 15px;
      height: 15px;
      width: 15px;
    }

    .action-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 6px;
    }

    .connect-action {
      min-height: 44px;
      padding: 0 18px;
      border-radius: var(--radius-sm);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: var(--cl-font-display);
      font-weight: 600;
      letter-spacing: -0.005em;
    }

    .connect-action mat-icon {
      font-size: 18px;
      height: 18px;
      width: 18px;
    }

    .connect-action-nuxeo {
      --mdc-protected-button-container-color: var(--source-nuxeo);
      --mdc-protected-button-label-text-color: #ffffff;
      --mdc-filled-button-container-color: var(--source-nuxeo);
      --mdc-filled-button-label-text-color: #ffffff;
    }

    .logout-link {
      color: var(--cl-text-muted);
      font-size: 12px;
    }

    /* ── Proceed card ──────────────────────────────────────── */

    .proceed-card {
      position: relative;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 24px;
      flex-wrap: wrap;
      padding: 32px 36px;
      overflow: hidden;
    }

    .proceed-accent {
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: linear-gradient(180deg,
        var(--hy-mark-yellow) 0%,
        var(--hy-mark-purple) 33%,
        var(--hy-mark-blue)   66%,
        var(--hy-mark-teal)   100%);
    }

    .proceed-copy h2 {
      margin: 10px 0 8px;
    }

    .proceed-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
      flex-shrink: 0;
    }

    .proceed-button {
      min-height: 52px;
      padding: 0 24px;
      border-radius: 999px; /* hyland.com-style pill CTA */
      min-width: 200px;
      font-family: var(--cl-font-display);
      font-weight: 600;
      font-size: 15px;
      letter-spacing: -0.005em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .proceed-button mat-icon {
      font-size: 20px;
      height: 20px;
      width: 20px;
      transition: transform 220ms var(--ease-out);
    }

    .proceed-button:not([disabled]):hover mat-icon { transform: translateX(3px); }

    .proceed-hint {
      margin: 0;
      color: var(--cl-text-soft);
      font-size: 12px;
    }

    /* ── Responsive ────────────────────────────────────────── */

    @media (max-width: 980px) {
      .hero-shell { grid-template-columns: 1fr; }
      .hero-stat  { justify-self: stretch; max-width: none; }
      .auth-grid  { grid-template-columns: 1fr; }
      .proceed-actions { align-items: stretch; width: 100%; }
      .proceed-button  { width: 100%; }
    }
  `]
})
export class AuthComponent {
  alfrescoUsername = '';
  alfrescoPassword = '';
  alfrescoLoading = false;
  alfrescoError = '';

  nuxeoUsername = '';
  nuxeoPassword = '';
  nuxeoLoading = false;
  nuxeoError = '';

  constructor(private auth: AuthService, private router: Router) {}

  get alfrescoLoggedIn(): boolean { return this.auth.isAlfrescoLoggedIn(); }
  get nuxeoLoggedIn(): boolean   { return this.auth.isNuxeoLoggedIn(); }
  get anyLoggedIn(): boolean     { return this.auth.isAnyLoggedIn(); }
  get alfrescoUser(): string     { return this.auth.getAlfrescoSession()?.username ?? ''; }
  get nuxeoUser(): string        { return this.auth.getNuxeoSession()?.username ?? ''; }

  get activeSessionCount(): number {
    return Number(this.alfrescoLoggedIn) + Number(this.nuxeoLoggedIn);
  }

  loginAlfresco(): void {
    if (!this.alfrescoUsername || !this.alfrescoPassword) return;
    this.alfrescoLoading = true;
    this.alfrescoError = '';
    this.auth.loginAlfresco(this.alfrescoUsername, this.alfrescoPassword)
      .then(() => { this.alfrescoPassword = ''; })
      .catch(err => {
        this.alfrescoError = err?.error?.error?.briefSummary
          ?? err?.message
          ?? 'Login failed. Check credentials.';
      })
      .finally(() => { this.alfrescoLoading = false; });
  }

  logoutAlfresco(): void { this.auth.logoutAlfresco(); }

  loginNuxeo(): void {
    if (!this.nuxeoUsername || !this.nuxeoPassword) return;
    this.nuxeoLoading = true;
    this.nuxeoError = '';
    this.auth.loginNuxeo(this.nuxeoUsername, this.nuxeoPassword)
      .then(() => { this.nuxeoPassword = ''; })
      .catch(err => {
        this.nuxeoError = err?.status === 401
          ? 'Invalid credentials.'
          : err?.message ?? 'Login failed. Check credentials.';
      })
      .finally(() => { this.nuxeoLoading = false; });
  }

  logoutNuxeo(): void { this.auth.logoutNuxeo(); }

  proceed(): void { this.router.navigate(['/search']); }
}
