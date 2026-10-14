import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { ProductionService, ReceivingProgress, ReceivingScreen } from '../../../core/services/production.service';
import { QrScannerComponent } from '../qr-scanner.component';

interface LogEntry {
  id: number;
  code: string;
  tone: 'ok' | 'notice' | 'error';
  message: string;
  at: Date;
}

const SAME_CODE_PAUSE_MS = 3000;
const KIND_LABEL: Record<string, string> = {
  awaiting: 'Awaiting receipt',
  received: 'Received',
  done: 'Received · moved on',
  not_ready: 'Not ready yet',
  assigned: 'Assigned to someone else',
};

/**
 * Receiving by scanning. The person's production stage is found from their own account (staff type, team record, permissions):
 * nothing is chosen here. Each scan receives ONE article; the order's progress (received / remaining and who received each
 * article) updates at once from the server's reply, and by Socket.IO when anyone else receives an article.
 */
@Component({
  selector: 'app-scan-receive',
  standalone: true,
  imports: [FormsModule, DatePipe, QrScannerComponent],
  template: `
    @if (open()) {
      <div class="modal-backdrop sr-backdrop" (click)="close()">
        <div class="modal scan-recv" role="dialog" aria-modal="true" aria-labelledby="sr-title" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div>
              <span class="eyebrow">Production</span>
              <h3 id="sr-title">Receive articles</h3>
              <p class="muted small">
                @if (screen(); as s) {
                  @if (s.stageLabel) { You receive for <b>{{ s.stageLabel }}</b>. Scan each article's QR code. }
                  @else { Each scan moves the article into the stage that follows its own. }
                } @else { Scan an article's QR code. }
              </p>
            </div>
            <button type="button" class="close-btn" (click)="close()" aria-label="Close">×</button>
          </div>

          <div class="modal-body sr-body">
            <app-qr-scanner [active]="open()" [busy]="busy()" (scanned)="receive($event)" />

            <form class="manual" (submit)="$event.preventDefault(); receive(manual())">
              <input class="input" placeholder="Or type the code, e.g. SA-1061-1" aria-label="Article code" autocomplete="off" autocapitalize="characters" [ngModel]="manual()" (ngModelChange)="manual.set($event)" name="code" />
              <button type="submit" class="btn" [disabled]="busy() || !manual().trim()">Receive</button>
            </form>

            @if (last(); as l) {
              <div class="last" [class]="'last-' + l.tone" role="status" aria-live="polite">
                <span class="dot" aria-hidden="true">{{ l.tone === 'ok' ? '✓' : l.tone === 'notice' ? '!' : '×' }}</span>
                <div><strong>{{ l.code }}</strong><span>{{ l.message }}</span></div>
              </div>
            }

            @if (current(); as p) {
              <section class="order-card" aria-label="Order progress">
                <header>
                  <div>
                    <strong>{{ p.reference }}</strong>
                    <span class="muted small">{{ p.customer_name || 'Customer' }}@if (p.brand) { · {{ p.brand }} } · {{ p.stage_label }}</span>
                  </div>
                  <div class="counts" aria-label="Progress">
                    <span class="big">{{ p.received }}<small>/{{ p.total }}</small></span>
                    <span class="muted small">received</span>
                  </div>
                </header>
                <div class="bar" role="progressbar" [attr.aria-valuenow]="p.received" aria-valuemin="0" [attr.aria-valuemax]="p.total" [attr.aria-label]="p.received + ' of ' + p.total + ' received'">
                  <span [style.width.%]="p.total ? (p.received / p.total) * 100 : 0"></span>
                </div>
                <div class="numbers">
                  <span><b>{{ p.received }}</b> received</span>
                  <span><b>{{ p.remaining }}</b> remaining</span>
                  @if (p.mine) { <span><b>{{ p.mine }}</b> by you</span> }
                </div>
                <p class="next">{{ p.next_action }}</p>
                <ul class="articles">
                  @for (a of p.articles; track a.unit_id) {
                    <li [attr.data-kind]="a.kind">
                      <span class="n">{{ a.line_no }}</span>
                      <div class="a-main">
                        <strong>{{ a.title }}</strong>
                        <span class="muted small">{{ a.code }}</span>
                        @if (a.kind === 'received' || a.kind === 'done') {
                          <span class="small who">Received by {{ a.received_by || 'the team' }}@if (a.mine) { (you) }@if (a.received_at) { · {{ a.received_at | date: 'MMM d, h:mm a' }} }</span>
                        } @else if (a.reason) {
                          <span class="small who">{{ a.reason }}</span>
                        }
                      </div>
                      <span class="state" [attr.data-kind]="a.kind">{{ kindLabel(a.kind) }}</span>
                    </li>
                  }
                </ul>
              </section>
            }

            @if (others().length) {
              <section class="waiting" aria-label="Orders waiting for you">
                <h4>Orders for you <span class="muted small">({{ orders().length }})</span></h4>
                <ul>
                  @for (o of others(); track key(o)) {
                    <li>
                      <button type="button" (click)="focus.set(key(o))">
                        <span><strong>{{ o.reference }}</strong><small>{{ o.stage_label }}</small></span>
                        <span class="pills"><span class="pill">{{ o.received }}/{{ o.total }}</span><span class="pill amber">{{ o.awaiting }} to scan</span></span>
                      </button>
                    </li>
                  }
                </ul>
              </section>
            } @else if (!current() && screen()) {
              <p class="muted small empty">Nothing is waiting for you right now. New articles appear here by themselves.</p>
            }

            @if (log().length > 1) {
              <details class="history">
                <summary>Recent scans ({{ log().length }})</summary>
                <ul>
                  @for (e of log(); track e.id) {
                    <li [class]="'log-' + e.tone"><span><strong>{{ e.code }}</strong> {{ e.message }}</span><time>{{ e.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</time></li>
                  }
                </ul>
              </details>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .scan-recv { max-width: 620px; }
    .manual { display: flex; gap: 8px; margin-top: 12px; input { flex: 1; min-width: 0; } }
    .last { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 12px 14px; border-radius: 14px; }
    .last div { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
    .dot { flex: none; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; }
    .last-ok { background: var(--c-green-soft); .dot { background: var(--c-green); } }
    .last-notice { background: var(--c-amber-soft); .dot { background: var(--c-amber); } }
    .last-error { background: var(--c-red-soft); .dot { background: var(--c-red); } }
    .order-card { margin-top: 14px; padding: 14px; border: 1px solid var(--c-line); border-radius: 16px; background: var(--c-bg-soft); display: flex; flex-direction: column; gap: 10px; }
    .order-card header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .order-card header > div:first-child { display: flex; flex-direction: column; min-width: 0; }
    .counts { text-align: right; flex: none; display: flex; flex-direction: column; }
    .big { font-size: 28px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; small { font-size: 16px; color: var(--c-muted); } }
    .bar { height: 8px; border-radius: 999px; background: var(--c-neutral-soft); overflow: hidden; span { display: block; height: 100%; background: var(--c-green); transition: width 0.3s ease; } }
    .numbers { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--c-ink-2); }
    .next { margin: 0; font-size: 13px; font-weight: 600; color: var(--c-gold-dark); }
    .articles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .articles li { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; background: var(--c-surface); border: 1px solid var(--c-line-soft); }
    .articles li[data-kind='awaiting'] { border-color: var(--c-amber); }
    .articles li[data-kind='received'], .articles li[data-kind='done'] { border-color: var(--c-green); }
    .n { flex: none; width: 24px; height: 24px; border-radius: 8px; background: var(--c-neutral-soft); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
    .a-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow-wrap: anywhere; }
    .who { color: var(--c-muted); }
    .state { flex: none; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--c-neutral-soft); color: var(--c-neutral); text-align: center; }
    .state[data-kind='awaiting'] { background: var(--c-amber-soft); color: var(--c-amber); }
    .state[data-kind='received'], .state[data-kind='done'] { background: var(--c-green-soft); color: var(--c-green); }
    .waiting { margin-top: 16px; h4 { margin: 0 0 8px; font-size: 14px; } ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; } button { width: 100%; min-height: 52px; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-surface); font: inherit; text-align: left; cursor: pointer; } span:first-child { display: flex; flex-direction: column; } small { color: var(--c-muted); } }
    .pills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .pill { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--c-neutral-soft); color: var(--c-neutral); }
    .pill.amber { background: var(--c-amber-soft); color: var(--c-amber); }
    .empty { margin: 16px 0 0; }
    .history { margin-top: 14px; font-size: 13px; summary { cursor: pointer; color: var(--c-muted); } ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; } li { display: flex; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 8px; } time { color: var(--c-faint); flex: none; } }
    .history .log-ok { background: var(--c-green-soft); } .history .log-notice { background: var(--c-amber-soft); } .history .log-error { background: var(--c-red-soft); }

    /* Phones: the receiving screen fills the whole screen, the scanner and the numbers stay reachable with one thumb */
    @media (max-width: 640px) {
      .sr-backdrop { padding: 0; align-items: stretch; }
      .scan-recv { max-width: none; width: 100%; height: 100%; max-height: none; border-radius: 0; }
      .sr-body { padding: 4px 14px 24px; flex: 1; -webkit-overflow-scrolling: touch; }
      .big { font-size: 26px; }
      .manual input { font-size: 16px; }
    }
  `,
})
export class ScanReceiveComponent {
  private production = inject(ProductionService);
  private socket = inject(ChatSocketService);
  private destroyRef = inject(DestroyRef);

  readonly open = input(false);
  readonly closed = output<void>();
  /** An article was received: the board refreshes. */
  readonly received = output<void>();

  readonly screen = signal<ReceivingScreen | null>(null);
  readonly orders = signal<ReceivingProgress[]>([]);
  /** Which order the progress card shows (`order_id|stage`). */
  readonly focus = signal<string | null>(null);
  readonly last = signal<LogEntry | null>(null);
  readonly log = signal<LogEntry[]>([]);
  readonly manual = signal('');
  readonly busy = signal(false);

  readonly current = computed(() => {
    const list = this.orders();
    return list.find((o) => this.key(o) === this.focus()) ?? list[0] ?? null;
  });
  readonly others = computed(() => this.orders().filter((o) => this.key(o) !== (this.current() ? this.key(this.current()!) : null)));

  private seq = 0;
  private refresh$ = new Subject<void>();

  constructor() {
    effect(() => {
      if (this.open()) untracked(() => this.opened());
    });
    // somebody (maybe someone else) received an article: the numbers follow, with no refresh
    this.socket.on('unit:update').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.open()) this.refresh$.next();
    });
    this.refresh$.pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load(true));
    this.socket.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.open()) this.load(true);
    });
  }

  key(p: ReceivingProgress): string {
    return `${p.order_id}|${p.stage}`;
  }

  kindLabel(kind: string): string {
    return KIND_LABEL[kind] ?? kind;
  }

  private opened(): void {
    this.log.set([]);
    this.last.set(null);
    this.manual.set('');
    this.load();
  }

  /** What is waiting for this person, from the server (so reopening or refreshing shows the true progress). */
  load(silent = false): void {
    this.production.receiving().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        this.screen.set(r);
        // keep an order that was just finished visible until the person moves on
        const keep = this.current();
        const merged = keep && !r.orders.some((o) => this.key(o) === this.key(keep)) ? [keep, ...r.orders] : r.orders;
        this.orders.set(merged);
      },
      error: (e) => {
        if (!silent) this.add('', 'error', apiErrorMessage(e));
      },
    });
  }

  close(): void {
    this.closed.emit();
  }

  // ───────── receiving ─────────

  receive(code: string): void {
    const value = code.trim();
    if (!value || this.busy()) return;
    this.busy.set(true);
    this.production.scanReceive(value).subscribe({
      next: ({ data, message }) => {
        this.busy.set(false);
        this.manual.set('');
        if (data.progress) this.applyProgress(data.progress);
        if (data.kind === 'order') {
          this.add(value, 'notice', message || 'Order scanned. Scan each article.');
          return;
        }
        this.add(value, 'ok', message);
        navigator.vibrate?.(60);
        this.received.emit();
      },
      error: (e) => {
        this.busy.set(false);
        const status = e?.status;
        // already received / not its turn yet: a notice, not an error
        this.add(value, status === 409 ? 'notice' : 'error', apiErrorMessage(e));
        if (status !== 409) navigator.vibrate?.([80, 60, 80]);
      },
    });
  }

  /** The server's numbers for the order that was just scanned replace what is on screen. */
  private applyProgress(p: ReceivingProgress): void {
    this.orders.update((list) => {
      const i = list.findIndex((o) => this.key(o) === this.key(p));
      return i >= 0 ? list.map((o, n) => (n === i ? p : o)) : [p, ...list];
    });
    this.focus.set(this.key(p));
  }

  private add(code: string, tone: LogEntry['tone'], message: string): void {
    const entry: LogEntry = { id: ++this.seq, code: code || 'Scan', tone, message, at: new Date() };
    this.last.set(entry);
    this.log.update((l) => [entry, ...l].slice(0, 12));
  }
}
