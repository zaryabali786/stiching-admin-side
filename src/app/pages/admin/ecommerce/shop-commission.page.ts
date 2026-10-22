import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { CommissionList, CommissionRow, ShopAdminService, ShopBrand, ShopSettlement } from '../../../core/services/shop-admin.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { PAGE_SIZES, intParam, setQuery } from '../admin-list';
import { COMMISSION_LABELS, commissionTone, money, saveBlob } from './shop-format';

interface CommissionQuery {
  store: string;
  status: string;
  from: string;
  to: string;
  page: number;
  limit: number;
}

const STATUSES = ['estimated', 'pending', 'settled', 'reversed', 'disputed'] as const;

/**
 * Ecommerce > Commission: what each order earns us and what we owe each brand. Estimated and pending amounts are labelled as such and are
 * never added to "settled": only an order marked settled (money actually paid out, with a reference) counts as settled.
 */
@Component({
  selector: 'app-admin-shop-commission',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, NgClass, FormsModule, PaginationComponent, EmptyStateComponent],
  styleUrls: ['./ecommerce.page.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Ecommerce</span>
          <h1>Commission &amp; reconciliation</h1>
          <p class="subtitle">Per brand order: the customer's payment, our commission and what we owe the brand. Commission only counts as settled once you record the settlement.</p>
        </div>
        <button type="button" class="btn" [disabled]="exporting()" (click)="exportCsv()">{{ exporting() ? 'Preparing…' : 'Export CSV' }}</button>
      </header>

      <div class="filters">
        <label>Brand
          <select class="select" aria-label="Filter by brand" (change)="set({ store: $any($event.target).value })">
            <option value="" [selected]="!query().store">All brands</option>
            @for (b of brands(); track b.store_id) { <option [value]="b.store_id" [selected]="b.store_id === query().store">{{ b.brand_name }}</option> }
          </select>
        </label>
        <label>Commission
          <select class="select" aria-label="Filter by commission status" (change)="set({ status: $any($event.target).value })">
            <option value="" [selected]="!query().status">Any status</option>
            @for (s of statuses; track s) { <option [value]="s" [selected]="s === query().status">{{ labels[s] }}</option> }
          </select>
        </label>
        <label>From <input class="input" type="date" [value]="query().from" (change)="set({ from: $any($event.target).value })" aria-label="From date" /></label>
        <label>To <input class="input" type="date" [value]="query().to" (change)="set({ to: $any($event.target).value })" aria-label="To date" /></label>
      </div>

      @if (error()) { <div class="notice" role="alert">{{ error() }}</div> }

      @if (data(); as d) {
        @let s = d.summary;
        @if (!s.currency && d.rows.length) {
          <div class="notice info">The selected orders use more than one currency, so the totals below are not added together. Filter by brand to see totals.</div>
        }
        <div class="tiles">
          <div class="tile"><span class="k">Customers paid (gross)</span><b>{{ money(s.gross, s.currency) }}</b><small>Total of the orders in this view</small></div>
          <div class="tile"><span class="k">Brand item subtotal</span><b>{{ money(s.brand_subtotal, s.currency) }}</b><small>Shipping {{ money(s.shipping, s.currency) }} (taxes and discounts are not collected by the Shop)</small></div>
          <div class="tile"><span class="k">Commission · estimated</span><b>{{ money(s.commission_estimated, s.currency) }}</b><small>Order not paid yet. Not earned.</small></div>
          <div class="tile pending"><span class="k">Commission · pending</span><b>{{ money(s.commission_pending, s.currency) }}</b><small>Paid by the customer, not settled with the brand yet</small></div>
          <div class="tile settled"><span class="k">Commission · settled</span><b>{{ money(s.commission_settled, s.currency) }}</b><small>Verified: settlement recorded</small></div>
          <div class="tile bad"><span class="k">Commission · disputed</span><b>{{ money(s.commission_disputed, s.currency) }}</b><small>On hold until the dispute is resolved</small></div>
          <div class="tile bad"><span class="k">Commission · reversed</span><b>{{ money(s.commission_reversed, s.currency) }}</b><small>Cancelled or refunded orders</small></div>
          <div class="tile"><span class="k">Owed to brands (pending)</span><b>{{ money(s.brand_payable_pending, s.currency) }}</b><small>Brand share of pending orders</small></div>
        </div>
      }

      <div class="toolbar">
        <div class="chips" role="tablist" aria-label="View">
          <button type="button" class="chip" role="tab" [class.active]="tab() === 'orders'" [attr.aria-selected]="tab() === 'orders'" (click)="tab.set('orders')">Brand orders</button>
          <button type="button" class="chip" role="tab" [class.active]="tab() === 'settlements'" [attr.aria-selected]="tab() === 'settlements'" (click)="showSettlements()">Settlement history</button>
        </div>
        @if (tab() === 'orders') {
          <div class="toolbar-end">
            @if (!query().store) { <span class="muted small">Choose a brand to settle its orders.</span> }
            <button type="button" class="btn btn-primary" [disabled]="!canSettle()" (click)="openSettle()">Mark {{ selectedCount() || '' }} settled</button>
          </div>
        }
      </div>

      @if (tab() === 'orders') {
        <div class="table-card" [class.refreshing]="refreshing()">
          <div class="table-scroll">
            <table class="data-table">
              <caption class="sr-only">Commission per brand order</caption>
              <thead>
                <tr>
                  <th class="sel-col"><input type="checkbox" [checked]="allSelected()" [disabled]="!selectable().length || !query().store" (change)="toggleAll($any($event.target).checked)" aria-label="Select all pending" /></th>
                  <th>Order</th><th>Brand</th><th class="num">Gross</th><th class="num">Brand subtotal</th><th class="num">Shipping</th><th>Terms</th><th class="num">Commission</th><th class="num">Payable to brand</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                @if (loading()) {
                  @for (i of [1, 2, 3, 4, 5]; track i) { <tr>@for (c of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; track c) { <td><span class="skeleton"></span></td> }</tr> }
                } @else {
                  @for (r of rows(); track r.id) {
                    <tr [class.selected]="picked().has(r.id)">
                      <td><input type="checkbox" [checked]="picked().has(r.id)" [disabled]="r.commission_status !== 'pending' || !query().store" (change)="toggle(r.id)" [attr.aria-label]="'Select ' + r.order_reference" /></td>
                      <td class="mono nowrap"><span class="cell-main">{{ r.order_reference }}</span><span class="cell-sub">{{ r.created_at | date: 'MMM d, y' }}</span></td>
                      <td>{{ r.brand }}</td>
                      <td class="num">{{ money(r.gross, currency()) }}</td>
                      <td class="num">{{ money(r.subtotal, currency()) }}@if (r.refunded_amount) { <span class="cell-sub err">refunded {{ money(r.refunded_amount, currency()) }}</span> }</td>
                      <td class="num">{{ money(r.shipping, currency()) }}</td>
                      <td class="nowrap">{{ r.rate_text }}</td>
                      <td class="num">{{ money(r.commission_amount, currency()) }}</td>
                      <td class="num">{{ money(r.brand_payable, currency()) }}</td>
                      <td class="nowrap">
                        <span class="badge" [ngClass]="tone(r.commission_status)">{{ labels[r.commission_status] }}</span>
                        @if (r.commission_status === 'pending' || r.commission_status === 'disputed') {
                          <button type="button" class="btn btn-xs btn-ghost" [disabled]="busy()" (click)="dispute(r)">{{ r.commission_status === 'disputed' ? 'Resolve' : 'Dispute' }}</button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="10"><app-empty-state title="Nothing to reconcile" message="Brand orders appear here once customers place Shop orders." /></td></tr>
                  }
                }
              </tbody>
            </table>
          </div>
          <app-pagination [meta]="meta()" (pageChange)="set({ page: $event })" />
        </div>
      } @else {
        <div class="table-card">
          <div class="table-scroll">
            <table class="data-table">
              <caption class="sr-only">Settlement history</caption>
              <thead><tr><th>Settled</th><th>Brand</th><th>Reference</th><th class="num">Amount</th><th class="num">Orders</th><th>Note</th></tr></thead>
              <tbody>
                @for (s of settlements(); track s.id) {
                  <tr>
                    <td class="nowrap">{{ s.settled_at | date: 'MMM d, y' }}</td>
                    <td>{{ s.brand }}</td>
                    <td class="mono">{{ s.reference }}</td>
                    <td class="num">{{ money(s.amount, s.currency) }}</td>
                    <td class="num">{{ s.orders_count }}</td>
                    <td>{{ s.note || '—' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="6"><app-empty-state title="No settlements yet" message="Record one from the Brand orders tab once you have paid a brand." /></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>

    @if (settleOpen()) {
      <div class="modal-backdrop" (click)="settleOpen.set(false)"></div>
      <form class="modal" role="dialog" aria-modal="true" aria-label="Mark settled" (submit)="$event.preventDefault(); settle()">
        <h3>Mark {{ selectedCount() }} {{ selectedCount() === 1 ? 'order' : 'orders' }} settled</h3>
        <p class="muted small">Brand payable: <b>{{ money(selectedPayable(), currency()) }}</b>. Only record this after the money was actually paid to the brand. It cannot be undone here.</p>
        <label>Payment reference (bank transfer id, etc.)
          <input class="input" name="reference" required maxlength="120" [ngModel]="reference()" (ngModelChange)="reference.set($event)" />
        </label>
        <label>Note (optional)
          <textarea class="textarea" name="note" rows="2" maxlength="500" [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea>
        </label>
        <div class="foot">
          <button type="button" class="btn btn-ghost" (click)="settleOpen.set(false)">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !reference().trim()">Mark settled</button>
        </div>
      </form>
    }
  `,
})
export class AdminShopCommissionPage implements OnInit {
  readonly money = money;
  readonly labels = COMMISSION_LABELS;
  readonly statuses = STATUSES;
  readonly tone = commissionTone;

  private shop = inject(ShopAdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly query = signal<CommissionQuery>({ store: '', status: '', from: '', to: '', page: 1, limit: 30 });
  readonly brands = signal<ShopBrand[]>([]);
  readonly data = signal<CommissionList | null>(null);
  readonly meta = signal<PageMeta | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly exporting = signal(false);

  readonly tab = signal<'orders' | 'settlements'>('orders');
  readonly settlements = signal<ShopSettlement[]>([]);

  readonly picked = signal<Set<string>>(new Set());
  readonly settleOpen = signal(false);
  readonly reference = signal('');
  readonly note = signal('');

  readonly rows = computed(() => this.data()?.rows ?? []);
  readonly currency = computed(() => this.data()?.summary.currency ?? null);
  readonly selectable = computed(() => this.rows().filter((r) => r.commission_status === 'pending'));
  readonly selectedCount = computed(() => this.picked().size);
  readonly allSelected = computed(() => this.selectable().length > 0 && this.selectable().every((r) => this.picked().has(r.id)));
  readonly selectedPayable = computed(() => this.rows().filter((r) => this.picked().has(r.id)).reduce((sum, r) => sum + Number(r.brand_payable || 0), 0));
  readonly canSettle = computed(() => !!this.query().store && this.picked().size > 0);

  ngOnInit(): void {
    this.shop.brands().subscribe({ next: (b) => this.brands.set(b), error: () => undefined });
    this.route.queryParamMap
      .pipe(
        map((p): CommissionQuery => ({
          store: p.get('store') || '',
          status: p.get('status') || '',
          from: p.get('from') || '',
          to: p.get('to') || '',
          page: intParam(p, 'page', 1),
          limit: intParam(p, 'limit', 30, [...PAGE_SIZES, 30]),
        })),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((q) => {
          this.query.set(q);
          this.picked.set(new Set());
          this.error.set(null);
          if (this.data()) this.refreshing.set(true);
          else this.loading.set(true);
        }),
        switchMap((q) =>
          this.shop.commissions({ ...q }).pipe(
            map((res) => ({ res, err: null as unknown })),
            catchError((err) => of({ res: null, err }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ res, err }) => {
        this.loading.set(false);
        this.refreshing.set(false);
        if (res) {
          this.data.set(res.data);
          this.meta.set(res.meta);
        } else {
          this.error.set(apiErrorMessage(err, 'Could not load the commission figures.'));
        }
      });
  }

  set(patch: Partial<Record<keyof CommissionQuery, string | number>>): void {
    const reset = 'page' in patch ? {} : { page: 1 };
    setQuery(this.router, this.route, { ...patch, ...reset });
  }

  private reloadNow(): void {
    this.refreshing.set(true);
    this.shop.commissions({ ...this.query() }).subscribe({
      next: (res) => {
        this.data.set(res.data);
        this.meta.set(res.meta);
        this.picked.set(new Set());
        this.refreshing.set(false);
      },
      error: (err) => {
        this.refreshing.set(false);
        this.error.set(apiErrorMessage(err, 'Could not refresh.'));
      },
    });
  }

  toggle(id: string): void {
    this.picked.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleAll(on: boolean): void {
    this.picked.set(on ? new Set(this.selectable().map((r) => r.id)) : new Set());
  }

  openSettle(): void {
    this.reference.set('');
    this.note.set('');
    this.settleOpen.set(true);
  }

  settle(): void {
    const store = this.query().store;
    if (!store || !this.picked().size || !this.reference().trim()) return;
    this.busy.set(true);
    this.shop.settle({ store_id: store, brand_order_ids: [...this.picked()], reference: this.reference().trim(), note: this.note().trim() || undefined }).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.settleOpen.set(false);
        this.ui.success(`Settlement ${s.reference} recorded for ${s.orders_count} ${s.orders_count === 1 ? 'order' : 'orders'}.`);
        this.reloadNow();
        if (this.tab() === 'settlements') this.showSettlements();
      },
      error: (err) => {
        this.busy.set(false);
        this.ui.error(err, 'Could not record the settlement.');
      },
    });
  }

  async dispute(r: CommissionRow): Promise<void> {
    const disputing = r.commission_status !== 'disputed';
    const note = await this.ui.confirm({
      title: disputing ? `Dispute ${r.order_reference}?` : `Resolve the dispute on ${r.order_reference}?`,
      message: disputing ? 'The commission is put on hold and cannot be settled until the dispute is resolved.' : 'The commission goes back to pending.',
      confirmText: disputing ? 'Mark disputed' : 'Resolve',
      input: { label: 'Note', required: false, multiline: true },
    });
    if (note === null) return;
    this.busy.set(true);
    this.shop.dispute(r.id, disputing, String(note) || undefined).subscribe({
      next: () => {
        this.busy.set(false);
        this.reloadNow();
      },
      error: (err) => {
        this.busy.set(false);
        this.ui.error(err, 'Could not change the dispute.');
      },
    });
  }

  showSettlements(): void {
    this.tab.set('settlements');
    this.shop.settlements({ store: this.query().store, limit: 100 }).subscribe({
      next: (r) => this.settlements.set(r.items),
      error: (err) => this.ui.error(err, 'Could not load the settlements.'),
    });
  }

  exportCsv(): void {
    const q = this.query();
    this.exporting.set(true);
    this.shop.exportCsv({ store: q.store, status: q.status, from: q.from, to: q.to }).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        saveBlob(blob, `shop-commission-${new Date().toISOString().slice(0, 10)}.csv`);
      },
      error: (err) => {
        this.exporting.set(false);
        this.ui.error(err, 'Could not export the report.');
      },
    });
  }
}
