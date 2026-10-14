import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonSpinner } from '@ionic/angular';
import { Subject, debounceTime } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { MasterTracking, ProductionService, TrackedArticle, TrackedOrder } from '../../../core/services/production.service';
import { CanDirective } from '../../../shared/can.directive';
import { QrCodeComponent } from '../../../shared/components/qr-code.component';
import { ScanReceiveComponent } from '../../../shared/components/scan-receive/scan-receive.component';

/**
 * Master tracking: one master and their tailors. Every order with an article assigned to the team, how many articles were
 * picked up and exactly which ones are still waiting, plus each member's received / pending / completed numbers.
 * Scanning an article's QR code receives it; the numbers follow at once (and for everyone, through Socket.IO).
 */
@Component({
  selector: 'app-master-tracking',
  standalone: true,
  imports: [DatePipe, IonSpinner, CanDirective, QrCodeComponent, ScanReceiveComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Production</span>
          <h1>Master tracking</h1>
          <p class="subtitle">
            @if (data(); as d) {
              @if (d.master) { <b>{{ d.master.name }}</b>'s orders and team. Scan each article to receive it. }
              @else { No master is set up yet. }
            } @else { Orders and articles of a master and their team. }
          </p>
        </div>
        <div class="actions">
          @if (data()?.masters?.length; as n) {
            <label class="pick">
              <span class="sr-only">Master</span>
              <select class="select" [value]="masterId() ?? data()!.master?.id" (change)="choose($any($event.target).value)" aria-label="Choose a master">
                @for (m of data()!.masters; track m.id) { <option [value]="m.id" [selected]="m.id === data()!.master?.id">{{ m.name }}</option> }
              </select>
            </label>
          }
          <button *can="'production.update'" type="button" class="btn btn-primary scan" (click)="scanOpen.set(true)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 5a2 2 0 0 1 2-2h4v2H5v4H3V5Zm12-2h4a2 2 0 0 1 2 2v4h-2V5h-4V3ZM3 15h2v4h4v2H5a2 2 0 0 1-2-2v-4Zm16 0h2v4a2 2 0 0 1-2 2h-4v-2h4v-4ZM7 7h4v4H7V7Zm6 0h4v4h-4V7ZM7 13h4v4H7v-4Zm6 2h2v2h-2v-2Zm2-2h2v2h-2v-2Z"/></svg>
            Scan to receive
          </button>
        </div>
      </header>

      @if (loading() && !data()) {
        <div class="center"><ion-spinner name="crescent" /></div>
      } @else if (error()) {
        <div class="card"><p>{{ error() }}</p><button type="button" class="btn btn-sm" (click)="load()">Retry</button></div>
      } @else if (data(); as d) {
        @if (d.master) {
          <section class="totals" aria-label="Totals">
            <div class="tot"><span>{{ d.totals.orders }}</span><small>Orders</small></div>
            <div class="tot"><span>{{ d.totals.articles }}</span><small>Articles</small></div>
            <div class="tot ok"><span>{{ d.totals.received }}</span><small>Picked up</small></div>
            <div class="tot warn"><span>{{ d.totals.remaining }}</span><small>To pick up</small></div>
            <div class="tot"><span>{{ d.totals.completed }}</span><small>Completed</small></div>
          </section>

          <section class="members" aria-label="Team members">
            <button type="button" class="member" [class.on]="!member()" (click)="member.set(null)">
              <strong>Everyone</strong><small>{{ d.members.length }} people</small>
            </button>
            @for (m of d.members; track m.id) {
              <button type="button" class="member" [class.on]="member() === m.name" (click)="member.set(member() === m.name ? null : m.name)">
                <strong>{{ m.name }}</strong>
                <small>{{ m.is_master ? 'Master' : 'Tailor' }}</small>
                <span class="nums">
                  <span class="n ok" title="Received"><b>{{ m.received }}</b> received</span>
                  <span class="n warn" title="Waiting to be picked up"><b>{{ m.pending }}</b> pending</span>
                  <span class="n" title="Completed"><b>{{ m.completed }}</b> completed</span>
                </span>
              </button>
            }
          </section>

          <div class="filters">
            <label class="check"><input type="checkbox" [checked]="onlyRemaining()" (change)="onlyRemaining.set($any($event.target).checked)" /> Only orders with articles still to pick up</label>
          </div>

          @for (o of shown(); track o.order_id) {
            <article class="card order" [class.complete]="o.remaining === 0">
              <button type="button" class="o-head" (click)="toggle(o.order_id)" [attr.aria-expanded]="isOpen(o)">
                <div class="o-title">
                  <strong>{{ o.reference }}</strong>
                  <span class="muted small">{{ o.customer_name || 'Customer' }}@if (o.brand) { · {{ o.brand }} }@if (o.due_date) { · due {{ o.due_date | date: 'd MMM' }} }</span>
                  <span class="muted small">{{ o.members.join(' · ') }}</span>
                </div>
                <div class="o-count" [attr.aria-label]="o.received + ' of ' + o.total + ' picked up, ' + o.remaining + ' remaining'">
                  <span class="big">{{ o.received }}<small>/{{ o.total }}</small></span>
                  <span class="muted small">picked up</span>
                </div>
                <span class="chev" [class.open]="isOpen(o)" aria-hidden="true">▾</span>
              </button>
              <div class="bar" role="progressbar" [attr.aria-valuenow]="o.received" aria-valuemin="0" [attr.aria-valuemax]="o.total"><span [style.width.%]="o.total ? (o.received / o.total) * 100 : 0"></span></div>
              <p class="remaining" [class.zero]="o.remaining === 0"><b>{{ o.remaining }}/{{ o.total }}</b> {{ o.remaining_text }}</p>

              @if (isOpen(o)) {
                <ul class="articles">
                  @for (a of articlesOf(o); track a.unit_id) {
                    <li [attr.data-state]="a.state">
                      @if (a.code) { <app-qr-code [value]="a.code" [size]="44" /> }
                      <div class="a-main">
                        <strong>{{ a.title }}</strong>
                        <span class="mono small">{{ a.code }}</span>
                        @if (a.state === 'pending') {
                          <span class="small who">{{ a.master ? 'Assigned to ' + a.master : 'Not assigned yet' }} · waiting to be picked up</span>
                        } @else {
                          <span class="small who">{{ a.stage_label }}@if (a.received_by) { · received by {{ a.received_by }} }@if (a.tailor) { · tailor {{ a.tailor }} }@if (a.received_at) { · {{ a.received_at | date: 'MMM d, h:mm a' }} }</span>
                        }
                      </div>
                      <span class="state" [attr.data-state]="a.state">{{ a.state_label }}</span>
                    </li>
                  } @empty {
                    <li class="none muted small">No article of this order belongs to {{ member() }}.</li>
                  }
                </ul>
              }
            </article>
          } @empty {
            <div class="card"><p class="muted">{{ onlyRemaining() ? 'Everything has been picked up.' : 'No orders are assigned to this team yet.' }}</p></div>
          }
        } @else {
          <div class="card"><p class="muted">Add a master in Teams first.</p></div>
        }
      }
    </div>

    <app-scan-receive [open]="scanOpen()" (closed)="scanOpen.set(false)" (received)="refresh$.next()" />
  `,
  styles: `
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .pick select { min-height: 44px; min-width: 180px; }
    .center { display: flex; justify-content: center; padding: 40px; }
    .totals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 14px; }
    .tot { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
    .tot span { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .tot small { color: var(--c-muted); }
    .tot.ok span { color: var(--c-green); } .tot.warn span { color: var(--c-amber); }
    .members { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 10px; margin-bottom: 6px; scrollbar-width: thin; }
    .member { flex: none; min-width: 190px; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: 14px; border: 1.5px solid var(--c-line); background: var(--c-surface); font: inherit; cursor: pointer; }
    .member.on { border-color: var(--c-green); background: var(--c-green-soft); }
    .member small { color: var(--c-muted); }
    .nums { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; color: var(--c-muted); }
    .nums b { font-size: 15px; color: var(--c-ink); } .n.ok b { color: var(--c-green); } .n.warn b { color: var(--c-amber); }
    .filters { margin: 6px 0 12px; }
    .check { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
    .order { padding: 0; margin-bottom: 12px; overflow: hidden; }
    .o-head { width: 100%; display: flex; align-items: center; gap: 14px; padding: 14px 16px 10px; border: 0; background: transparent; font: inherit; text-align: left; cursor: pointer; }
    .o-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .o-count { text-align: right; display: flex; flex-direction: column; flex: none; }
    .big { font-size: 28px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; small { font-size: 16px; color: var(--c-muted); } }
    .chev { color: var(--c-muted); transition: transform 0.2s ease; } .chev.open { transform: rotate(180deg); }
    .bar { height: 6px; margin: 0 16px; border-radius: 999px; background: var(--c-neutral-soft); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--c-green); transition: width 0.3s ease; }
    .remaining { margin: 8px 16px 12px; font-size: 14px; color: var(--c-amber); font-weight: 600; }
    .remaining.zero { color: var(--c-green); }
    .articles { list-style: none; margin: 0; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--c-line-soft); padding-top: 10px; }
    .articles li { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 12px; border: 1px solid var(--c-line-soft); background: var(--c-bg-soft); }
    .articles li[data-state='pending'] { border-color: var(--c-amber); background: var(--c-amber-soft); }
    .articles li[data-state='completed'] { border-color: var(--c-green); }
    .a-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow-wrap: anywhere; }
    .who { color: var(--c-muted); }
    .state { flex: none; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: var(--c-neutral-soft); color: var(--c-neutral); text-align: center; }
    .state[data-state='pending'] { background: var(--c-amber-soft); color: var(--c-amber); }
    .state[data-state='with_master'], .state[data-state='with_tailor'] { background: var(--c-blue-soft); color: var(--c-blue); }
    .state[data-state='completed'] { background: var(--c-green-soft); color: var(--c-green); }
    .none { padding: 8px; }
    @media (max-width: 760px) {
      .totals { grid-template-columns: repeat(3, 1fr); }
      .actions { width: 100%; } .actions .scan { flex: 1; min-height: 48px; justify-content: center; } .pick { flex: 1 1 100%; } .pick select { width: 100%; }
      .member { min-width: 160px; }
      .o-head { padding: 12px; gap: 10px; }
      .articles li { flex-wrap: wrap; } .state { margin-left: auto; }
    }
  `,
})
export class MasterTrackingPage implements OnInit {
  private production = inject(ProductionService);
  private socket = inject(ChatSocketService);
  private destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);

  readonly data = signal<MasterTracking | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly masterId = signal<string | null>(null);
  readonly member = signal<string | null>(null);
  readonly onlyRemaining = signal(false);
  readonly scanOpen = signal(false);
  private opened = signal<ReadonlySet<string>>(new Set());
  readonly refresh$ = new Subject<void>();

  readonly shown = computed(() => {
    const d = this.data();
    if (!d) return [];
    const m = this.member();
    return d.orders.filter((o) => (!this.onlyRemaining() || o.remaining > 0) && (!m || o.articles.some((a) => a.master === m || a.tailor === m)));
  });

  ngOnInit(): void {
    this.load();
    // an article was received anywhere: the numbers follow without a refresh
    this.socket.on('unit:update').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh$.next());
    this.refresh$.pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load(true));
    this.socket.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load(true));
  }

  load(silent = false): void {
    if (!silent) this.loading.set(true);
    this.production.masterTracking(this.masterId()).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
        this.error.set(null);
        // the first order that still has articles to pick up opens by itself
        if (!this.opened().size) {
          const first = d.orders.find((o) => o.remaining > 0) ?? d.orders[0];
          if (first) this.opened.set(new Set([first.order_id]));
        }
      },
      error: (e) => {
        this.loading.set(false);
        if (!silent) this.error.set(apiErrorMessage(e));
      },
    });
  }

  choose(id: string): void {
    this.masterId.set(id);
    this.member.set(null);
    this.opened.set(new Set());
    this.load();
  }

  isOpen(o: TrackedOrder): boolean {
    return this.opened().has(o.order_id);
  }

  toggle(id: string): void {
    this.opened.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  /** The articles of an order, narrowed to the chosen team member. */
  articlesOf(o: TrackedOrder): TrackedArticle[] {
    const m = this.member();
    return m ? o.articles.filter((a) => a.master === m || a.tailor === m) : o.articles;
  }
}
