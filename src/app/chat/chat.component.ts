import { AfterViewChecked, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../services/auth.service';
import { ChatSessionService, ChatSessionSummary } from '../services/chat-session.service';
import {
  ChatMessage,
  ContentSourceType,
  MergedDocument,
  PromptSource,
  RagPromptOptions,
  RagPromptResponse,
  RagService
} from '../services/rag.service';
import {
  ContentSourceCatalogService,
  ContentSourceOption
} from '../services/content-source-catalog.service';
import { markdownToPlainText } from '../utils/markdown-plaintext';
import {
  SourceModifier,
  sourceClass,
  sourceIcon,
  sourceModifier
} from '../utils/source-presentation';

let _nextId = 0;

@Component({
  selector: 'app-delete-session-dialog',
  template: `
    <h2 mat-dialog-title>Delete conversation</h2>
    <mat-dialog-content>
      <p>This will permanently remove this conversation and all its messages.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="warn" [mat-dialog-close]="true">Delete</button>
    </mat-dialog-actions>
  `
})
export class DeleteSessionDialogComponent {}

@Component({
  selector: 'app-chat',
  template: `
    <div class="page-container-wide chat-page">
      <div class="chat-layout editorial-surface">

        <!-- Sidebar: session history -->
        <aside class="chat-sidebar">
          <div class="sidebar-header">
            <div>
              <span class="eyebrow">Conversations</span>
              <h2>Session memory</h2>
            </div>
            <button mat-stroked-button type="button" class="sidebar-action" (click)="newConversation()" [disabled]="thinking">
              <mat-icon>add</mat-icon>
              New
            </button>
          </div>

          <div class="sidebar-legend">
            <span class="source-badge source-badge-alfresco">
              <mat-icon>storage</mat-icon>
              Alfresco
            </span>
            <span class="source-badge source-badge-nuxeo">
              <mat-icon>folder_open</mat-icon>
              Nuxeo
            </span>
          </div>

          <div class="session-list">
            <div *ngFor="let s of sessionSummaries; trackBy: trackSession"
                 class="session-row">
              <button type="button"
                      class="session-item"
                      [class.active]="s.sessionId === activeSessionId"
                      (click)="openConversation(s.sessionId)">
                <span class="session-title">{{ s.title }}</span>
                <span class="session-meta">{{ s.updatedAt | date:'shortDate' }} · {{ s.messageCount }} msg</span>
              </button>
              <button mat-icon-button
                      type="button"
                      class="session-delete"
                      [disabled]="thinking"
                      (click)="deleteConversation(s.sessionId, $event)"
                      matTooltip="Delete conversation">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          </div>
        </aside>

        <!-- Main chat area -->
        <section class="chat-main">

          <div class="chat-toolbar">
            <div class="toolbar-copy">
              <span class="eyebrow">RAG assistant</span>
              <h1>Ask across both repositories with explicit source provenance.</h1>
            </div>

            <div class="toolbar-controls">
              <span *ngIf="!anyLoggedIn" class="toolbar-warning">
                <mat-icon>warning_amber</mat-icon>
                Not logged in. <a routerLink="/login">Connect a repository</a>.
              </span>

              <span *ngIf="anyLoggedIn" class="toolbar-status">
                <mat-icon>lock</mat-icon>
                Session-aware retrieval
              </span>

              <!-- Options come from /api/status, so any ingested source is selectable (#9). -->
              <mat-button-toggle-group [(ngModel)]="sourceKey"
                                       [disabled]="thinking"
                                       class="source-toggle">
                <mat-button-toggle value="">All</mat-button-toggle>
                <mat-button-toggle *ngFor="let option of sourceOptions"
                                   [value]="option.key"
                                   [disabled]="!isSelectable(option)"
                                   [matTooltip]="sourceTooltip(option)">
                  <span class="toggle-label" [ngClass]="'toggle-label-' + modifierFor(option.sourceType)">
                    <mat-icon>{{ iconFor(option.sourceType) }}</mat-icon>
                    {{ option.label }}
                  </span>
                </mat-button-toggle>
              </mat-button-toggle-group>

              <label class="feature-toggle" [class.on]="inferFilters"
                     matTooltip="Let the assistant infer filters (date, type, path) from your question">
                <input type="checkbox" [(ngModel)]="inferFilters" [disabled]="thinking" />
                Auto filters
              </label>
              <label class="feature-toggle" [class.on]="structuredMode"
                     matTooltip="Return a structured answer: summary, key points, citations">
                <input type="checkbox" [(ngModel)]="structuredMode" [disabled]="thinking" />
                Structured
              </label>

              <button mat-stroked-button type="button"
                      class="sidebar-action"
                      (click)="newConversation()"
                      [disabled]="thinking">
                <mat-icon>restart_alt</mat-icon>
                Reset
              </button>
            </div>
          </div>

          <!-- Long-term memory (#10). Absent until rag-service has a summary for this session, which
               takes more than one turn. -->
          <div *ngIf="conversationSummary" class="summary-panel">
            <button mat-button type="button" class="summary-toggle" (click)="toggleSummary()">
              <mat-icon>{{ showSummary ? 'expand_less' : 'expand_more' }}</mat-icon>
              <mat-icon class="summary-icon">psychology</mat-icon>
              Conversation memory
            </button>
            <p *ngIf="showSummary" class="summary-text">{{ conversationSummary }}</p>
          </div>

          <div class="messages-area" #messagesContainer (scroll)="onScroll()">

            <div *ngIf="messages.length === 0" class="welcome-state">
              <div class="welcome-card">
                <div class="welcome-dots" aria-hidden="true">
                  <span class="wd wd-yellow"></span>
                  <span class="wd wd-purple"></span>
                  <span class="wd wd-blue"></span>
                  <span class="wd wd-teal"></span>
                </div>
                <span class="eyebrow">Ask the index</span>
                <h3 class="display-2">Grounded answers from your indexed content.</h3>
                <p>Ask a question, stream the answer, and expand source evidence below the response.</p>
                <div class="welcome-badges">
                  <span class="metric-chip">
                    <mat-icon>hub</mat-icon>
                    Cross-source retrieval
                  </span>
                  <span class="metric-chip">
                    <mat-icon>description</mat-icon>
                    Inline citations
                  </span>
                </div>
              </div>
            </div>

            <div *ngFor="let msg of messages"
                 class="bubble"
                 [class.bubble-user]="msg.role === 'user'"
                 [class.bubble-assistant]="msg.role === 'assistant'">

              <div *ngIf="msg.role === 'user'" class="user-text">{{ msg.content }}</div>

              <div *ngIf="msg.role === 'assistant'" class="assistant-bubble">
                <div *ngIf="msg.loading && !msg.content" class="loading-row">
                  <mat-spinner diameter="16"></mat-spinner>
                  <span>Thinking…</span>
                </div>

                <div *ngIf="msg.error" class="error-row">
                  <mat-icon>error_outline</mat-icon>
                  <span>{{ msg.error }}</span>
                </div>

                <!--
                  Streaming shows the flattened mirror; the finished answer is rendered as the markdown
                  it is. Rendering it raw put literal ** and backticks in front of the reader.
                -->
                <div *ngIf="!msg.error && (msg.content || msg.loading)"
                     class="answer-text"
                     [class.answer-text--streaming]="msg.loading">
                  <ng-container *ngIf="msg.loading; else renderedAnswer">{{ msg.streamPreview }}<span class="stream-cursor">|</span></ng-container>
                  <ng-template #renderedAnswer>
                    <markdown class="answer-markdown" [data]="msg.content"></markdown>
                  </ng-template>
                </div>

                <div *ngIf="!msg.loading && !msg.error && (msg.model || msg.totalMs)" class="msg-meta">
                  <span *ngIf="msg.model" class="metric-chip">
                    <mat-icon>smart_toy</mat-icon>
                    {{ msg.model }}
                  </span>
                  <span *ngIf="msg.tokenCount !== undefined" class="metric-chip">
                    <mat-icon>code</mat-icon>
                    {{ msg.tokenCount }} tokens
                  </span>
                  <span *ngIf="msg.totalMs" class="metric-chip">
                    <mat-icon>schedule</mat-icon>
                    {{ msg.totalMs }}ms
                  </span>
                </div>

                <div *ngIf="!msg.loading && !msg.error && msg.structured" class="structured-block">
                  <div class="structured-summary">{{ msg.structured.summary }}</div>
                  <ul *ngIf="msg.structured.keyPoints?.length" class="structured-points">
                    <li *ngFor="let kp of msg.structured.keyPoints">{{ kp }}</li>
                  </ul>
                  <div *ngIf="msg.structured.citations?.length" class="structured-citations">
                    <div *ngFor="let cit of msg.structured.citations" class="structured-citation">
                      <span class="citation-source">{{ cit.sourceName }}</span>
                      <span class="citation-quote">{{ cit.quote }}</span>
                    </div>
                  </div>
                </div>

                <div *ngIf="!msg.loading && !msg.error && msg.verified !== undefined"
                     class="faithfulness"
                     [class.ok]="msg.verified"
                     [class.warn]="!msg.verified">
                  <mat-icon>{{ msg.verified ? 'verified' : 'report_problem' }}</mat-icon>
                  {{ msg.verified ? 'Grounded in the cited sources' : 'Some claims are not supported by the sources' }}
                </div>
                <div *ngIf="!msg.loading && !msg.error && msg.unsupportedClaims && msg.unsupportedClaims.length"
                     class="unsupported">
                  <div class="unsupported-title">Unsupported claims</div>
                  <ul>
                    <li *ngFor="let claim of msg.unsupportedClaims">{{ claim }}</li>
                  </ul>
                </div>

                <div *ngIf="!msg.loading && !msg.error && msg.sources && msg.sources.length > 0" class="sources-section">
                  <button mat-button type="button" class="sources-toggle" (click)="toggleSources(msg)">
                    <mat-icon>{{ msg['_showSources'] ? 'expand_less' : 'expand_more' }}</mat-icon>
                    {{ msg.sources.length }} source{{ msg.sources.length !== 1 ? 's' : '' }}
                  </button>

                  <div *ngIf="msg['_showSources']" class="sources-list">
                    <div *ngFor="let src of msg.sources"
                         class="source-item"
                         [ngClass]="sourceCardClass(src.sourceType)">
                      <div class="source-header">
                        <div class="source-title-group">
                          <span class="source-icon-wrap" [ngClass]="sourceBadgeClass(src.sourceType)">
                            <mat-icon>{{ sourceIcon(src.sourceType) }}</mat-icon>
                          </span>
                          <div class="source-meta">
                            <a *ngIf="src.openInSourceUrl"
                               [href]="src.openInSourceUrl"
                               target="_blank"
                               rel="noopener noreferrer"
                               class="source-name">{{ src.name }}</a>
                            <span *ngIf="!src.openInSourceUrl" class="source-name">{{ src.name }}</span>
                            <div *ngIf="src.path" class="source-path">{{ src.path }}</div>
                          </div>
                        </div>

                        <span *ngIf="src.sourceType"
                              class="source-badge"
                              [ngClass]="sourceBadgeClass(src.sourceType)">
                          <mat-icon>{{ sourceIcon(src.sourceType) }}</mat-icon>
                          {{ sourceLabel(src.sourceType, src.sourceId) }}
                        </span>
                      </div>

                      <!-- A TABLE chunk holds a markdown table; prose styling destroys its alignment (#118). -->
                      <div *ngFor="let chunk of src.chunks"
                           class="source-chunk"
                           [class.source-chunk-table]="chunk.chunkType === 'TABLE'">
                        <span *ngIf="chunk.chunkType === 'TABLE'" class="chunk-badge">Table</span>
                        <pre *ngIf="chunk.chunkType === 'TABLE'" class="chunk-table">{{ chunk.text }}</pre>
                        <ng-container *ngIf="chunk.chunkType !== 'TABLE'">{{ chunk.text }}</ng-container>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <div class="input-row">
            <mat-form-field appearance="outline" class="question-field">
              <mat-label>Ask a question about your documents</mat-label>
              <input matInput
                     [(ngModel)]="currentQuestion"
                     (keyup.enter)="ask()"
                     [disabled]="thinking" />
            </mat-form-field>
            <button mat-raised-button color="primary"
                    class="send-button"
                    [disabled]="!currentQuestion.trim() || thinking"
                    (click)="ask()">
              <mat-icon>send</mat-icon>
              Send
            </button>
          </div>

        </section>
      </div>
    </div>
  `,
  styles: [`
    .chat-page { padding-top: 24px; }

    .chat-layout {
      display: grid;
      grid-template-columns: 296px minmax(0, 1fr);
      min-height: calc(100vh - 160px);
      overflow: hidden;
    }

    /* ---- Sidebar ---- */

    .chat-sidebar {
      padding: 22px 18px;
      border-right: 1px solid var(--cl-border);
      background: linear-gradient(180deg, var(--hy-gray-50), var(--hy-gray-100));
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .sidebar-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .sidebar-header h2 {
      margin: 6px 0 0;
      font-family: var(--cl-font-display);
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.025em;
    }

    .sidebar-action {
      border-radius: 6px;
      min-height: 36px;
      font-size: 12px;
      font-weight: 600;
    }

    .sidebar-legend {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .session-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--cl-border-strong) transparent;
    }

    .session-list::-webkit-scrollbar { width: 4px; }
    .session-list::-webkit-scrollbar-thumb {
      border-radius: 99px;
      background: var(--cl-border-strong);
    }

    .session-row {
      position: relative;
      display: flex;
      align-items: stretch;
    }

    .session-row .session-delete {
      position: absolute;
      top: 50%;
      right: 4px;
      transform: translateY(-50%);
      opacity: 0;
      transition: opacity 120ms ease;
      color: var(--cl-text-soft);
      width: 28px;
      height: 28px;
      line-height: 28px;
    }

    .session-row:hover .session-delete {
      opacity: 1;
    }

    .session-item {
      border: 1px solid var(--cl-border);
      border-radius: 8px;
      background: var(--cl-surface);
      padding: 10px 12px;
      padding-right: 36px;
      flex: 1;
      text-align: left;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
      transition: all 120ms ease;
      color: var(--cl-text);
    }

    .session-item:hover {
      border-color: var(--cl-border-strong);
      box-shadow: var(--cl-shadow-soft);
    }

    .session-item.active {
      border-color: rgba(0, 40, 85, 0.2);
      background: linear-gradient(135deg, rgba(0, 40, 85, 0.05), rgba(0, 163, 224, 0.04));
    }

    .session-title {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
    }

    .session-meta {
      color: var(--cl-text-soft);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* ---- Main chat area ---- */

    .chat-main {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .chat-toolbar {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 22px 26px 20px;
      border-bottom: 1px solid var(--cl-border);
      background: var(--cl-surface);
    }

    .toolbar-copy h1 {
      margin: 6px 0 0;
      font-family: var(--cl-font-display);
      font-size: 22px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.025em;
      max-width: 540px;
    }

    .toolbar-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .toolbar-warning,
    .toolbar-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }

    .toolbar-warning {
      background: rgba(255, 248, 238, 0.92);
      color: var(--cl-warning);
    }

    .toolbar-status {
      background: rgba(46, 125, 50, 0.07);
      color: var(--cl-success);
      border: 1px solid rgba(46, 125, 50, 0.15);
    }

    .source-toggle {
      height: 40px;
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
    /* Any other source type: readable, and not borrowing either repository's colour (#9). */
    .toggle-label-generic  { color: var(--cl-text-muted); }

    /* ---- Conversation memory (#10) ---- */

    .summary-panel {
      margin: 0 0 12px;
      padding: 8px 12px;
      border: 1px solid var(--cl-border);
      border-radius: var(--radius-md);
      background: var(--hy-gray-50);
    }

    .summary-toggle {
      font-size: 12px;
      font-weight: 600;
      color: var(--cl-text-muted);
    }

    .summary-icon { color: var(--hy-mark-purple); }

    .summary-text {
      margin: 6px 2px 2px;
      font-size: 12.5px;
      line-height: 1.7;
      color: var(--cl-text);
    }

    /* ---- Messages area ---- */

    .messages-area {
      flex: 1;
      overflow-y: auto;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: var(--hy-gray-50);
      scrollbar-width: thin;
      scrollbar-color: var(--cl-border-strong) transparent;
    }

    .messages-area::-webkit-scrollbar { width: 5px; }
    .messages-area::-webkit-scrollbar-thumb {
      border-radius: 99px;
      background: var(--cl-border-strong);
    }

    /* ---- Welcome state ---- */

    .welcome-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 320px;
    }

    .welcome-card {
      max-width: 560px;
      padding: 40px 32px;
      border-radius: var(--radius-xl);
      background:
        radial-gradient(80% 100% at 50% 0%, rgba(75, 189, 224, 0.08) 0%, transparent 60%),
        var(--cl-surface);
      border: 1px solid var(--cl-border);
      box-shadow: var(--cl-shadow);
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .welcome-dots {
      display: inline-flex;
      gap: 10px;
      margin-bottom: 6px;
    }

    .wd {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      display: inline-block;
    }

    .wd-yellow { background: var(--hy-mark-yellow); }
    .wd-purple { background: var(--hy-mark-purple); }
    .wd-blue   { background: var(--hy-mark-blue); }
    .wd-teal   { background: var(--hy-mark-teal); }

    .welcome-card h3 {
      margin: 4px 0 4px;
    }

    .welcome-card p {
      margin: 0;
      color: var(--cl-text-muted);
      line-height: 1.7;
      font-size: 14px;
      max-width: 44ch;
    }

    .welcome-badges {
      display: flex;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }

    /* ---- Message bubbles ---- */

    .bubble {
      max-width: min(880px, 90%);
      display: flex;
    }

    .bubble-user {
      align-self: flex-end;
    }

    .bubble-assistant {
      align-self: flex-start;
      width: 100%;
      max-width: min(960px, 94%);
    }

    .user-text {
      background: linear-gradient(135deg, var(--hy-navy) 0%, var(--hy-navy-light) 100%);
      color: white;
      padding: 13px 18px;
      border-radius: 18px 18px 4px 18px;
      font-size: 14px;
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
      box-shadow: 0 10px 24px -10px rgba(0, 40, 85, 0.45);
    }

    .assistant-bubble {
      background: var(--cl-surface);
      border: 1px solid var(--cl-border);
      border-radius: 4px 18px 18px 18px;
      padding: 18px 20px;
      box-shadow: var(--cl-shadow-soft);
    }

    .loading-row,
    .error-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }

    .loading-row { color: var(--cl-text-muted); }
    .error-row   { color: var(--cl-danger); }

    .answer-text {
      font-size: 14px;
      line-height: 1.78;
      word-break: break-word;
      color: var(--cl-text);
    }

    /* Newlines are the only structure a streamed mirror has; rendered markdown brings its own. */
    .answer-text--streaming {
      white-space: pre-wrap;
    }

    .answer-markdown :first-child { margin-top: 0; }
    .answer-markdown :last-child { margin-bottom: 0; }

    .answer-markdown p,
    .answer-markdown ul,
    .answer-markdown ol,
    .answer-markdown pre {
      margin: 0 0 0.75em;
    }

    .answer-markdown pre {
      padding: 0.6em 0.75em;
      overflow-x: auto;
      background: var(--cl-surface-alt, #f4f6f8);
      border-radius: var(--radius-sm, 4px);
    }

    .answer-markdown table {
      width: 100%;
      margin: 0 0 0.75em;
      border-collapse: collapse;
    }

    .answer-markdown th,
    .answer-markdown td {
      padding: 0.35em 0.6em;
      text-align: left;
      border: 1px solid var(--cl-border, #d8dde3);
    }

    .stream-cursor {
      display: inline-block;
      color: var(--hy-teal);
      animation: blink 0.8s step-end infinite;
      margin-left: 2px;
      font-weight: 300;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    .msg-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
    }

    /* ---- Source citations ---- */

    .feature-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 600;
      color: var(--cl-text-soft);
      border: 1px solid var(--cl-border);
      border-radius: 14px;
      padding: 4px 10px;
      cursor: pointer;
      user-select: none;
      min-height: 40px;
    }

    .feature-toggle.on {
      border-color: rgba(0, 40, 85, 0.35);
      color: var(--hy-navy);
      background: rgba(0, 40, 85, 0.05);
    }

    .structured-block {
      margin-top: 12px;
      padding: 12px 14px;
      border: 1px solid var(--cl-border);
      border-radius: 8px;
      background: var(--hy-gray-50);
    }

    .structured-summary { font-weight: 600; color: var(--cl-text); }

    .structured-points {
      margin: 8px 0 0;
      padding-left: 18px;
      font-size: 13px;
      color: var(--cl-text);
    }

    .structured-citations {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .structured-citation { font-size: 12px; color: var(--cl-text-soft); }
    .citation-source { font-weight: 600; margin-right: 6px; }
    .citation-quote { font-style: italic; }

    .faithfulness {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      font-size: 12px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 12px;
    }

    .faithfulness mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .faithfulness.ok { color: var(--cl-success); background: rgba(46, 125, 50, 0.1); }
    .faithfulness.warn { color: var(--cl-warning); background: rgba(196, 85, 0, 0.12); }

    .unsupported {
      margin-top: 8px;
      font-size: 12px;
      color: var(--cl-warning);
    }

    .unsupported-title { font-weight: 600; }
    .unsupported ul { margin: 4px 0 0; padding-left: 18px; }

    .sources-section { margin-top: 12px; }

    .sources-toggle {
      padding: 0 6px;
      min-height: 32px;
      border-radius: 6px;
      color: var(--cl-primary);
      font-size: 12px;
      font-weight: 600;
    }

    .sources-list {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .source-item {
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--cl-border);
      background: var(--hy-gray-50);
    }

    .source-item-alfresco {
      border-color: rgba(120, 190, 32, 0.2);
      background: rgba(239, 248, 223, 0.5);
    }

    .source-item-nuxeo {
      border-color: rgba(0, 163, 224, 0.18);
      background: rgba(229, 246, 252, 0.5);
    }

    .source-header {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .source-title-group {
      display: flex;
      gap: 10px;
      min-width: 0;
      flex: 1;
      align-items: flex-start;
    }

    .source-icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(0, 40, 85, 0.06);
      color: var(--cl-primary);
      flex-shrink: 0;
    }

    .source-icon-wrap mat-icon {
      font-size: 16px;
      height: 16px;
      width: 16px;
    }

    .source-icon-wrap.source-badge-alfresco {
      background: var(--source-alfresco-soft);
      color: var(--source-alfresco-strong);
    }

    .source-icon-wrap.source-badge-nuxeo {
      background: var(--source-nuxeo-soft);
      color: var(--source-nuxeo-strong);
    }

    .source-meta { min-width: 0; }

    .source-name {
      display: inline-block;
      color: var(--cl-primary);
      font-weight: 600;
      font-size: 13px;
      text-decoration: none;
      margin-bottom: 3px;
    }

    .source-name:hover { text-decoration: underline; }

    .source-path {
      color: var(--cl-text-soft);
      font-size: 11px;
      line-height: 1.5;
      word-break: break-word;
    }

    .source-chunk {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.8);
      border-left: 3px solid var(--cl-border-strong);
      color: var(--cl-text);
      font-size: 12px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .source-item-alfresco .source-chunk { border-left-color: rgba(120, 190, 32, 0.5); }
    .source-item-nuxeo    .source-chunk { border-left-color: rgba(0, 163, 224, 0.45); }

    /* ---- Table chunks (#118) ---- */

    .source-chunk-table { white-space: normal; }

    .chunk-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: var(--radius-xs);
      background: var(--hy-gray-200);
      color: var(--hy-gray-700);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .chunk-table {
      margin: 6px 0 0;
      overflow-x: auto;
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      line-height: 1.6;
      white-space: pre;
    }

    /* ---- Input row ---- */

    .input-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 20px 18px;
      border-top: 1px solid var(--cl-border);
      background: var(--cl-surface);
    }

    .question-field {
      flex: 1;
      margin-bottom: -1.25em;
    }

    .send-button {
      min-height: 46px;
      min-width: 110px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    /* ---- Responsive ---- */

    @media (max-width: 1040px) {
      .chat-layout { grid-template-columns: 1fr; }

      .chat-sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--cl-border);
      }

      .bubble, .bubble-assistant { max-width: 100%; }
    }

    @media (max-width: 760px) {
      .toolbar-copy h1 { font-size: 17px; }

      .input-row {
        flex-direction: column;
        align-items: stretch;
      }

      .send-button { width: 100%; }
    }
  `]
})
export class ChatComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  messages: ChatMessage[] = [];
  sessionSummaries: ChatSessionSummary[] = [];
  currentQuestion = '';
  /** The selected source option's key: '' for every source (#9). */
  sourceKey = '';
  sourceOptions: ContentSourceOption[] = [];
  inferFilters = false;
  structuredMode = false;
  thinking = false;
  activeSessionId: string | null = null;

  /** The running conversation summary for the open session, or null when there is not one yet (#10). */
  conversationSummary: string | null = null;
  showSummary = false;

  private shouldScroll = false;
  private autoScrollEnabled = true;
  private streamBuffers = new Map<string, string>();
  private lastTokenPersistMs = 0;
  private static readonly TOKEN_PERSIST_INTERVAL_MS = 400;

  constructor(
    private auth: AuthService,
    private rag: RagService,
    private sessions: ChatSessionService,
    private dialog: MatDialog,
    private sources: ContentSourceCatalogService
  ) {}

  ngOnInit(): void {
    this.activeSessionId = this.sessions.ensureActiveSession();
    this.messages = this.sessions.getMessages(this.activeSessionId);
    this.healInterruptedMessages();
    this.refreshSummaries();
    this.sources.options().subscribe((options) => { this.sourceOptions = options; });
    this.loadConversationSummary();
    this.shouldScroll = true;
  }

  /**
   * Clears the `loading` flag on assistant messages rehydrated from storage so
   * a stream interrupted by a reload does not leave a permanent "Thinking..."
   * spinner with no request running.
   */
  private healInterruptedMessages(): void {
    let changed = false;
    for (const msg of this.messages) {
      if (msg.role === 'assistant' && msg.loading) {
        msg.loading = false;
        changed = true;
        if (!msg.content?.trim() && !msg.error) {
          msg.error = 'Response interrupted before it completed. Please ask again.';
        }
      }
    }
    if (changed) {
      this.persist();
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  get anyLoggedIn(): boolean     { return this.auth.isAnyLoggedIn(); }

  ask(): void {
    const q = this.currentQuestion.trim();
    if (!q || this.thinking) return;

    const sessionId = this.activeSessionId ?? this.sessions.ensureActiveSession();
    const isFirstTurn = this.messages.length === 0;
    this.activeSessionId = sessionId;

    const userMsg: ChatMessage = {
      id: `msg-${_nextId++}`, role: 'user', content: q, timestamp: new Date()
    };
    const assistantMsg: ChatMessage = {
      id: `msg-${_nextId++}`, role: 'assistant', content: '', timestamp: new Date(), loading: true
    };

    this.messages.push(userMsg, assistantMsg);
    this.currentQuestion = '';
    this.thinking = true;
    this.shouldScroll = true;
    this.lastTokenPersistMs = 0;
    this.persist();

    // An id-level source option scopes through the filter rather than through sourceType, because the
    // prompt request carries no source id (#9).
    const scope = this.sources.scope(this.sources.find(this.sourceOptions, this.sourceKey));

    const opts: RagPromptOptions = {
      sessionId,
      resetSession: isFirstTurn,
      ...(scope.sourceType ? { sourceType: scope.sourceType } : {}),
      ...(scope.filter ? { filter: scope.filter } : {}),
      ...(this.inferFilters ? { inferFilters: true } : {}),
      ...(this.structuredMode ? { responseFormat: 'STRUCTURED' as const } : {})
    };

    this.rag.streamPrompt(q, opts).subscribe({
      next: event => {
        if (event.type === 'token') {
          const buf = (this.streamBuffers.get(assistantMsg.id) ?? '') + event.token;
          this.streamBuffers.set(assistantMsg.id, buf);
          // The markdown is what gets kept and eventually rendered; the flattened mirror is what shows
          // until the answer is whole, since partial markdown renders badly and reflows every token.
          assistantMsg.content = buf;
          assistantMsg.streamPreview = markdownToPlainText(buf);
          this.shouldScroll = this.autoScrollEnabled;
          this.throttlePersist();
          return;
        }
        if (event.type === 'metadata') {
          this.applyResponse(assistantMsg, event.response);
          this.finishMessage(assistantMsg);
          this.persist();
          return;
        }
        this.finishMessage(assistantMsg);
        this.persist();
      },
      error: err => {
        if (this.isUnavailable(err)) {
          this.fallbackToPrompt(q, sessionId, isFirstTurn, assistantMsg, opts);
          return;
        }
        this.streamBuffers.delete(assistantMsg.id);
        assistantMsg.loading = false;
        assistantMsg.error = err?.message ?? 'Request failed';
        this.thinking = false;
        this.shouldScroll = this.autoScrollEnabled;
        this.persist();
      }
    });
  }

  newConversation(): void {
    if (this.thinking) return;
    this.activeSessionId = this.sessions.createSession();
    this.messages = [];
    this.currentQuestion = '';
    this.autoScrollEnabled = true;
    this.refreshSummaries();
    this.loadConversationSummary();
    this.shouldScroll = true;
  }

  openConversation(sessionId: string): void {
    if (this.thinking || sessionId === this.activeSessionId) return;
    this.activeSessionId = sessionId;
    this.sessions.activateSession(sessionId);
    this.messages = this.sessions.getMessages(sessionId);
    this.healInterruptedMessages();
    this.autoScrollEnabled = true;
    this.refreshSummaries();
    this.loadConversationSummary();
    this.shouldScroll = true;
  }

  deleteConversation(sessionId: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.thinking) return;
    this.dialog.open(DeleteSessionDialogComponent)
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.sessions.deleteSession(sessionId);
        if (this.activeSessionId === sessionId) {
          const next = this.sessions.ensureActiveSession();
          this.activeSessionId = next;
          this.messages = this.sessions.getMessages(next);
          this.loadConversationSummary();
          this.shouldScroll = true;
        }
        this.refreshSummaries();
      });
  }

  onScroll(): void {
    const el = this.messagesContainer?.nativeElement as HTMLElement;
    if (el) this.autoScrollEnabled = (el.scrollTop + el.clientHeight) >= (el.scrollHeight - 96);
  }

  toggleSources(msg: ChatMessage): void {
    (msg as any)['_showSources'] = !(msg as any)['_showSources'];
  }

  trackSession(_i: number, s: ChatSessionSummary): string { return s.sessionId; }

  /** A source with a login needs a session in that very source; any other is offered outright. */
  isSelectable(option: ContentSourceOption): boolean {
    return this.sources.isSelectable(option);
  }

  sourceTooltip(option: ContentSourceOption): string {
    if (!this.isSelectable(option)) return `Log in to ${option.label} first`;
    const docs = `${option.count} document${option.count !== 1 ? 's' : ''} indexed`;
    return `${option.label} only (${docs})`;
  }

  iconFor(sourceType?: string): string { return sourceIcon(sourceType); }

  modifierFor(sourceType?: string): SourceModifier { return sourceModifier(sourceType); }

  toggleSummary(): void { this.showSummary = !this.showSummary; }

  /**
   * Reads the running summary for the open session (#10).
   *
   * Skipped while the session id is still the client-side `ui-` one, because the server has never seen
   * that session and would answer 404. A 404 for a real session means the conversation is too short to
   * have a summary yet, which is not an error: the panel is simply absent.
   */
  private loadConversationSummary(): void {
    this.conversationSummary = null;
    const sessionId = this.activeSessionId;
    if (!sessionId || sessionId.startsWith('ui-')) return;

    this.rag.getSessionSummary(sessionId).subscribe({
      next: (resp) => { this.conversationSummary = resp?.summary?.trim() || null; },
      error: () => { this.conversationSummary = null; }
    });
  }

  sourceIcon(source: ContentSourceType | undefined): string { return sourceIcon(source); }

  /** The type, or the qualified source id when the type has more than one source. */
  sourceLabel(source: ContentSourceType | undefined, sourceId?: string): string {
    return this.auth.resultSourceLabel(source, sourceId);
  }

  sourceBadgeClass(source: ContentSourceType | undefined): string {
    return sourceClass('source-badge', source);
  }

  sourceCardClass(source: ContentSourceType | undefined): string {
    return sourceClass('source-item', source);
  }

  private fallbackToPrompt(
    question: string,
    sessionId: string,
    isFirstTurn: boolean,
    assistantMsg: ChatMessage,
    opts: RagPromptOptions
  ): void {
    this.rag.prompt(question, { ...opts, sessionId, resetSession: isFirstTurn }).subscribe({
      next: response => {
        this.applyResponse(assistantMsg, response);
        this.finishMessage(assistantMsg);
        this.persist();
      },
      error: err => {
        this.streamBuffers.delete(assistantMsg.id);
        assistantMsg.loading = false;
        assistantMsg.error = err?.error?.message ?? err?.message ?? 'Request failed';
        this.thinking = false;
        this.persist();
      }
    });
  }

  private applyResponse(msg: ChatMessage, response: RagPromptResponse): void {
    if (response.sessionId && response.sessionId !== this.activeSessionId) {
      if (this.activeSessionId) {
        this.sessions.renameSession(this.activeSessionId, response.sessionId);
      }
      this.activeSessionId = response.sessionId;
    }
    if (response.answer) {
      msg.content = response.answer;
      this.streamBuffers.delete(msg.id);
    }
    delete msg.streamPreview;
    msg.model = response.model;
    msg.tokenCount = response.tokenCount;
    msg.totalMs = response.totalTimeMs;
    msg.searchTimeMs = response.searchTimeMs;
    msg.generationTimeMs = response.generationTimeMs;
    msg.sources = this.mergeSources(response.sources ?? []);
    msg.verified = response.verified;
    msg.unsupportedClaims = response.unsupportedClaims;
    msg.structured = response.structured;
    msg.requestId = response.requestId;
    msg.error = undefined;
    // The summary that informed this answer, not one that includes it: rag-service refreshes it on its
    // own executor after the response is sent, so the next turn is what reflects this one.
    if (response.currentSummary?.trim()) {
      this.conversationSummary = response.currentSummary.trim();
    }
  }

  private finishMessage(msg: ChatMessage): void {
    this.streamBuffers.delete(msg.id);
    msg.loading = false;
    this.thinking = false;
    this.shouldScroll = this.autoScrollEnabled;
  }

  private mergeSources(sources: PromptSource[]): MergedDocument[] {
    const map = new Map<string, MergedDocument>();
    for (const s of sources) {
      const key = `${s.sourceId ?? ''}::${s.nodeId}`;
      const existing = map.get(key);
      if (existing) {
        existing.chunks.push({ text: s.chunkText, score: s.score, chunkType: s.chunkType });
      } else {
        map.set(key, {
          nodeId: s.nodeId,
          sourceId: s.sourceId,
          sourceType: s.sourceType,
          name: s.name,
          path: s.path,
          score: s.score,
          chunks: [{ text: s.chunkText, score: s.score, chunkType: s.chunkType }],
          openInSourceUrl: s.openInSourceUrl
        });
      }
    }
    return Array.from(map.values());
  }

  private persist(): void {
    if (this.activeSessionId) {
      this.sessions.saveMessages(this.activeSessionId, this.messages);
      this.refreshSummaries();
    }
  }

  /**
   * Persists at most once per interval while streaming, so a long answer does
   * not re-serialize the whole session store on every token. Terminal events
   * persist the final state unconditionally.
   */
  private throttlePersist(): void {
    const now = Date.now();
    if (now - this.lastTokenPersistMs >= ChatComponent.TOKEN_PERSIST_INTERVAL_MS) {
      this.lastTokenPersistMs = now;
      this.persist();
    }
  }

  private refreshSummaries(): void {
    this.sessionSummaries = this.sessions.listSessions();
  }

  private scrollToBottom(): void {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch (_) {}
  }

  private isUnavailable(err: any): boolean {
    const m = String(err?.message ?? '').toLowerCase();
    return m.includes('stream request failed (404)') || m.includes('stream request failed (405)');
  }
}
