import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subject, debounceTime } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { ProductionOrderRow, ProductionService } from '../../../core/services/production.service';
import { QrCodeComponent } from '../../../shared/components/qr-code.component';

/**
 * "By order": each order is the parent; every article sits under it with its own state, stage, and who received it.
 * It refreshes by itself when an article moves (Socket.IO `unit:update`).
 */
@Component({
  selector: 'app-production-orders',
  standalone: true,
  imports: [DatePipe, IonSpinner, QrCodeComponent],
  template: `
    @if (loading() && !orders().length) {
      <div class="center"><ion-spinner name="crescent" /></div>
    } @else if (error()) {
      <div class="card"><p class="muted">{{ error() }}</p><button type="button" class="btn btn-sm" (click)="load()">Retry</button></div>
    } @else if (!orders().length) {
      <div class="card"><p class="muted">No orders in production yet.</p></div>
    }
    @for (o of orders(); track o.id) {
      <article class="card po">
        <header class="po-head" (click)="toggle(o.id)" tabindex="0" (keydown.enter)="toggle(o.id)" role="button" [attr.aria-expanded]="isOpen(o.id)">
          <app-qr-code [value]="o.reference" [size]="52" />
          <div class="po-title">
            <strong>{{ o.reference }} <span class="muted">· {{ o.customer_name || 'Customer' }}</span></strong>
            <span class="muted small">{{ o.brand || '' }} · {{ o.status_label }}</span>
          </div>
          <div class="po-progress" [attr.aria-label]="o.progress.in_production + ' in production, ' + o.progress.completed + ' completed, ' + o.progress.waiting + ' waiting of ' + o.progress.total">
            <span class="pill">{{ o.progress.total }} article{{ o.progress.total === 1 ? '' : 's' }}</span>
            @if (o.progress.in_production) { <span class="pill blue">{{ o.progress.in_production }} in production</span> }
            @if (o.progress.waiting) { <span class="pill amber">{{ o.progress.waiting }} waiting</span> }
            @if (o.progress.completed) { <span class="pill green">{{ o.progress.completed }} done</span> }
          </div>
          <span class="chev" aria-hidden="true">{{ isOpen(o.id) ? '▴' : '▾' }}</span>
        </header>
        @if (isOpen(o.id)) {
          <ul class="units">
            @for (u of o.units; track u.id) {
              <li class="unit" [attr.data-state]="u.state">
                @if (u.code) { <app-qr-code [value]="u.code" [size]="44" /> }
                <div class="u-main">
                  <strong>{{ u.title }}</strong>
                  <span class="mono small">{{ u.code }}</span>
                  @if (u.receipts.length) {
                    <ol class="receipts">
                      @for (r of u.receipts; track $index) {
                        <li><b>{{ stageName(r.stage) }}</b> received by {{ r.user_name || r.role }} · {{ r.received_at | date: 'MMM d, h:mm a' }}</li>
                      }
                    </ol>
                  } @else if (u.master || u.tailor) {
                    <span class="muted small">{{ u.master ? 'Master ' + u.master : '' }}{{ u.master && u.tailor ? ' · ' : '' }}{{ u.tailor ? 'Tailor ' + u.tailor : '' }}</span>
                  }
                </div>
                <div class="u-state">
                  <span class="badge" [class]="badgeFor(u.state)">{{ u.state_label }}</span>
                  @if (u.stage_label) { <span class="muted small">{{ u.stage_label }}</span> }
                </div>
              </li>
            }
          </ul>
        }
      </article>
    }
  `,
  styles: `
    .center { display: flex; justify-content: center; padding: 30px; }
    .po { padding: 0; overflow: hidden; margin-bottom: 12px; }
    .po-head { display: flex; align-items: center; gap: 14px; padding: 14px 16px; cursor: pointer; flex-wrap: wrap; }
    .po-title { display: flex; flex-direction: column; flex: 1; min-width: 180px; }
    .po-progress { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--c-neutral-soft); color: var(--c-neutral); }
    .pill.blue { background: var(--c-blue-soft); color: var(--c-blue); }
    .pill.amber { background: var(--c-amber-soft); color: var(--c-amber); }
    .pill.green { background: var(--c-green-soft); color: var(--c-green); }
    .units { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--c-line-soft); }
    .unit { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--c-line-soft); }
    .unit:last-child { border-bottom: 0; }
    .u-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .u-state { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .receipts { margin: 4px 0 0; padding-left: 16px; font-size: 12px; color: var(--c-muted); }
    @media (max-width: 640px) {
      .po-head { padding: 12px; gap: 10px; }
      .po-title { min-width: 0; flex-basis: calc(100% - 140px); }
      .po-progress { order: 3; width: 100%; }
      .unit { flex-wrap: wrap; padding: 12px; }
      .u-main { flex-basis: calc(100% - 70px); }
      .u-state { flex-direction: row; align-items: center; gap: 8px; width: 100%; justify-content: flex-start; }
    }
  `,
})
export class ProductionOrdersComponent implements OnInit {
  private production = inject(ProductionService);
  private socket = inject(ChatSocketService);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);

  readonly search = input('');
  readonly orders = signal<ProductionOrderRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private opened = signal<Set<string>>(new Set());
  private refresh$ = new Subject<void>();

  ngOnInit(): void {
    this.load();
    // an article moved anywhere: refresh quietly (many scans in a row become one refresh)
    this.socket.on('unit:update').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh$.next());
    this.refresh$.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load(true));
    this.socket.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load(true));
  }

  load(silent = false): void {
    if (!silent) this.loading.set(true);
    this.production.orders({ search: this.search() || undefined, limit: 20 }).subscribe({
      next: (r) => {
        this.orders.set(r.items);
        this.loading.set(false);
        this.error.set(null);
        if (!this.opened().size && r.items[0]) this.opened.set(new Set([r.items[0].id]));
      },
      error: (e) => {
        this.loading.set(false);
        if (!silent) this.error.set(apiErrorMessage(e));
      },
    });
  }

  isOpen(id: string): boolean {
    return this.opened().has(id);
  }

  toggle(id: string): void {
    this.opened.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  stageName(stage: string): string {
    return { cutting: 'Cutting', stitching: 'Stitching', qc: 'Quality check', pressing: 'Pressing', packed: 'Packing' }[stage] ?? stage;
  }

  badgeFor(state: string): string {
    if (['approved', 'completed'].includes(state)) return 'badge green dot';
    if (state === 'in_production') return 'badge blue dot';
    if (['rejected', 'issue'].includes(state)) return 'badge red dot';
    if (['pending_approval', 'return_requested', 'returned'].includes(state)) return 'badge amber dot';
    return 'badge dot';
  }
}
