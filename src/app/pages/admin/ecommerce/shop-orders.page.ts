import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { ShopAdminService, ShopBrand, ShopBrandOrder, ShopOrderDetail, ShopOrderRow } from '../../../core/services/shop-admin.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PAGE_SIZES, PagedList, SKELETON_ROWS, intParam, setQuery } from '../admin-list';
import { COMMISSION_LABELS, ORDER_STATUSES, brandStateLabel, brandStateTone, commissionTerms, commissionTone, fulfilmentLabel, money, orderTone, paymentLabel, paymentTone } from './shop-format';

interface OrderQuery {
  search: string;
  status: string;
  brand: string;
  from: string;
  to: string;
  page: number;
  limit: number;
}

/** Ecommerce > Orders: every order placed through the Shop, one parent order and one child order per brand. */
@Component({
  selector: 'app-admin-shop-orders',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, NgClass, RouterLink, SearchInputComponent, PaginationComponent, EmptyStateComponent],
  styleUrls: ['./ecommerce.page.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Ecommerce</span>
          <h1>Shop orders</h1>
          <p class="subtitle">Orders placed through the Shop (not stitching orders). Each brand fulfils its own part: open an order to see every brand's order, tracking and commission.</p>
        </div>
      </header>

      <div class="toolbar">
        <app-search-input placeholder="Search SH number, Shopify #, customer, brand…" [value]="query().search" (search)="set({ search: $event })" />
        @if (list.meta(); as m) { <span class="result-count">{{ m.total }} {{ m.total === 1 ? 'order' : 'orders' }}</span> }
        <label class="page-size">
          Rows
          <select class="select" (change)="set({ limit: $any($event.target).value })">
            @for (s of pageSizes; track s) { <option [value]="s" [selected]="s === query().limit">{{ s }}</option> }
          </select>
        </label>
      </div>

      <div class="filters">
        <label>Status
          <select class="select" aria-label="Filter by status" (change)="set({ status: $any($event.target).value })">
            <option value="" [selected]="!query().status">All statuses</option>
            @for (s of statuses; track s.value) { <option [value]="s.value" [selected]="s.value === query().status">{{ s.label }}</option> }
          </select>
        </label>
        <label>Brand
          <select class="select" aria-label="Filter by brand" (change)="set({ brand: $any($event.target).value })">
            <option value="" [selected]="!query().brand">All brands</option>
            @for (b of brands(); track b.store_id) { <option [value]="b.store_id" [selected]="b.store_id === query().brand">{{ b.brand_name }}</option> }
          </select>
        </label>
        <label>From <input class="input" type="date" [value]="query().from" (change)="set({ from: $any($event.target).value })" aria-label="From date" /></label>
        <label>To <input class="input" type="date" [value]="query().to" (change)="set({ to: $any($event.target).value })" aria-label="To date" /></label>
      </div>

      <div class="table-card" [class.refreshing]="list.refreshing()">
        @if (list.error()) {
          <app-empty-state kind="error" [message]="list.error()" (retry)="list.reload()" />
        } @else {
          <div class="table-scroll" [class.sticky-head]="query().limit > 15">
            <table class="data-table">
              <caption class="sr-only">Shop orders. Select a row to see its brand orders.</caption>
              <thead>
                <tr><th>Order</th><th>Customer</th><th>Brands</th><th>Status</th><th>Payment</th><th class="num">Total</th><th>Placed</th></tr>
              </thead>
              <tbody>
                @if (list.loading()) {
                  @for (i of skeleton; track i) { <tr>@for (c of [1, 2, 3, 4, 5, 6, 7]; track c) { <td><span class="skeleton"></span></td> }</tr> }
                } @else {
                  @for (o of list.items(); track o.id) {
                    <tr class="clickable" tabindex="0" [class.selected]="selectedId() === o.id" [attr.aria-label]="'Open order ' + o.reference" (click)="open(o.id)" (keydown.enter)="open(o.id)">
                      <td class="mono nowrap"><span class="cell-main">{{ o.reference }}</span></td>
                      <td><span class="cell-main">{{ o.customer.name || '—' }}</span><span class="cell-sub">{{ o.customer.email }}</span></td>
                      <td>{{ o.brands.join(', ') || '—' }}@if (o.brand_orders_count > 1) { <span class="cell-sub">{{ o.brand_orders_count }} brand orders</span> }</td>
                      <td><span class="badge" [ngClass]="tone(o.status)">{{ o.status_label }}</span></td>
                      <td><span class="badge" [ngClass]="payTone(o.payment_status)">{{ payLabel(o.payment_status) }}</span></td>
                      <td class="num">{{ money(o.total, o.currency) }}</td>
                      <td class="nowrap">{{ o.created_at | date: 'MMM d, y' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7">
                      <app-empty-state [title]="filtered() ? 'No matching orders' : 'No Shop orders yet'"
                        [message]="filtered() ? 'Try a different search or filter.' : 'Orders appear here when customers buy from the Shop.'" />
                    </td></tr>
                  }
                }
              </tbody>
            </table>
          </div>
          <app-pagination [meta]="list.meta()" (pageChange)="set({ page: $event })" />
        }
      </div>
    </div>

    @if (selectedId()) {
      <div class="drawer-backdrop" (click)="close()"></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="Shop order">
        @if (detailLoading()) {
          <div class="drawer-body">@for (i of [1, 2, 3]; track i) { <span class="skeleton" style="height: 80px; margin-bottom: 12px"></span> }</div>
        } @else if (detailError()) {
          <div class="drawer-body"><app-empty-state kind="error" [message]="detailError()" (retry)="load(selectedId()!)" /></div>
        } @else if (detail(); as d) {
          <div class="drawer-head">
            <div>
              <span class="eyebrow">Shop order · {{ d.created_at | date: 'MMM d, y, h:mm a' }}</span>
              <h3>{{ d.reference }}</h3>
              <p class="head-sub">{{ d.customer.name || d.customer.email }} · {{ money(d.total, d.currency) }}</p>
            </div>
            <button type="button" class="close-btn" (click)="close()" aria-label="Close order">×</button>
          </div>
          <div class="drawer-body">
            <div class="badges" style="display:flex;gap:6px;flex-wrap:wrap">
              <span class="badge" [ngClass]="tone(d.status)">{{ d.status_label }}</span>
              <span class="badge" [ngClass]="payTone(d.payment.status)">{{ payLabel(d.payment.status) }}</span>
            </div>

            <h4 class="sec">Customer &amp; delivery</h4>
            <dl class="kv">
              <dt>Name</dt><dd>{{ d.customer.name || '—' }}</dd>
              <dt>Email</dt><dd>{{ d.customer.email || '—' }}</dd>
              @if (d.address; as a) {
                <dt>Ship to</dt>
                <dd>{{ a.name }}@if (a.phone) { · {{ a.phone }} }<br />{{ a.address1 }}@if (a.address2) { , {{ a.address2 }} }<br />{{ a.city }}@if (a.province) { , {{ a.province }} } {{ a.zip }} · {{ a.country_code }}</dd>
              }
            </dl>

            <h4 class="sec">Payment</h4>
            <dl class="kv">
              <dt>Status</dt><dd>{{ payLabel(d.payment.status) }}</dd>
              <dt>Stripe payment</dt><dd class="mono">{{ d.payment.intent_id || '—' }}</dd>
              <dt>Paid</dt><dd>{{ d.payment.paid_at ? (d.payment.paid_at | date: 'MMM d, y, h:mm a') : '—' }}</dd>
              @if (d.payment.refunded_amount) { <dt>Refunded</dt><dd>{{ money(d.payment.refunded_amount, d.currency) }}</dd> }
            </dl>
            <p class="muted small">The customer paid us. The brand's Shopify orders are created as unpaid on purpose: we settle each brand's share separately (see Commission).</p>

            <h4 class="sec">Brand orders ({{ d.brand_orders.length }})</h4>
            @for (b of d.brand_orders; track b.id) {
              <div class="bo-card">
                <div class="bo-head">
                  <strong>{{ b.brand.name }}</strong>
                  <div class="badges">
                    <span class="badge" [ngClass]="stateTone(b.state)">{{ stateLabel(b.state) }}</span>
                    <span class="badge" [ngClass]="b.fulfillment_status === 'unfulfilled' ? '' : 'blue'">{{ fulfil(b) }}</span>
                  </div>
                </div>
                <dl class="kv">
                  <dt>Shopify order</dt>
                  <dd>
                    @if (b.shopify_order_name) {
                      @if (b.shopify_order_url) { <a class="link" [href]="b.shopify_order_url" target="_blank" rel="noopener">{{ b.shopify_order_name }} ↗</a> } @else { {{ b.shopify_order_name }} }
                      <span class="muted small"> · {{ b.shop_domain }}</span>
                    } @else { Not created in the brand's store yet }
                  </dd>
                  @if (b.financial_status) { <dt>Shopify payment</dt><dd>{{ b.financial_status }}</dd> }
                  @if (b.tracking.length) {
                    <dt>Tracking</dt>
                    <dd>@for (t of b.tracking; track $index) { <div>{{ t.company || 'Carrier' }} · @if (t.url) { <a class="link" [href]="t.url" target="_blank" rel="noopener">{{ t.number }}</a> } @else { {{ t.number || '—' }} }</div> }</dd>
                  }
                  <dt>Brand subtotal</dt><dd>{{ money(b.subtotal, d.currency) }} + shipping {{ money(b.shipping, d.currency) }}</dd>
                  <dt>Commission terms</dt><dd>{{ terms(b, d.currency) }} <span class="muted small">(fixed when the order was placed)</span></dd>
                  <dt>Our commission</dt><dd>{{ money(b.commission_amount, d.currency) }} <span class="badge" [ngClass]="comTone(b.commission_status)">{{ comLabel(b.commission_status) }}</span></dd>
                  <dt>Payable to brand</dt><dd>{{ money(b.brand_payable, d.currency) }}@if (b.settled_at) { <span class="muted small"> · settled {{ b.settled_at | date: 'MMM d, y' }}</span> }</dd>
                </dl>
                @if (b.last_error) { <div class="small err" role="alert">{{ b.last_error }}</div> }
                <ul class="items">
                  @for (i of b.items; track $index) {
                    <li><span>{{ i.quantity }} × {{ i.title }}@if (i.variant_title) { <span class="muted"> · {{ i.variant_title }}</span> }@if (i.sku) { <span class="muted"> · {{ i.sku }}</span> }</span><span>{{ money(i.line_total ?? i.unit_price * i.quantity, d.currency) }}</span></li>
                  }
                </ul>
                <div class="row-actions">
                  @if (b.state === 'failed' || b.state === 'pending') {
                    <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="retry(b)">Create in Shopify</button>
                  }
                  @if (b.shopify_order_id) {
                    <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="sync(b)">Sync from Shopify</button>
                  }
                </div>
              </div>
            } @empty {
              <p class="muted">{{ d.payment.status === 'paid' ? 'The brand orders are being created.' : 'Brand orders are created once the payment is confirmed.' }}</p>
            }

            <h4 class="sec">Items ({{ d.items.length }})</h4>
            <ul class="items">
              @for (i of d.items; track $index) {
                <li><span>{{ i.quantity }} × {{ i.title }}@if (i.variant_title) { <span class="muted"> · {{ i.variant_title }}</span> }</span><span>{{ money(i.line_total ?? i.unit_price * i.quantity, d.currency) }}</span></li>
              }
            </ul>

            @if (d.timeline.length) {
              <h4 class="sec">History</h4>
              <ul class="timeline">
                @for (t of d.timeline; track $index) { <li><time>{{ t.at | date: 'MMM d, h:mm a' }}</time>{{ t.text }}</li> }
              </ul>
            }
          </div>
          <div class="drawer-foot">
            <button type="button" class="btn btn-ghost" (click)="close()">Close</button>
            <span class="foot-spacer"></span>
            <a class="btn btn-ghost" routerLink="/admin/shop-commission">Commission</a>
            @if (d.status !== 'cancelled' && d.status !== 'delivered') {
              <button type="button" class="btn danger" [disabled]="busy()" (click)="cancel(d)">Cancel order</button>
            }
          </div>
        }
      </aside>
    }
  `,
})
export class AdminShopOrdersPage implements OnInit {
  readonly money = money;
  readonly statuses = ORDER_STATUSES;
  readonly tone = orderTone;
  readonly payTone = paymentTone;
  readonly payLabel = paymentLabel;
  readonly stateTone = brandStateTone;
  readonly stateLabel = brandStateLabel;
  readonly comTone = commissionTone;
  readonly comLabel = (s: keyof typeof COMMISSION_LABELS) => COMMISSION_LABELS[s];

  private shop = inject(ShopAdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly pageSizes = PAGE_SIZES;
  readonly list = new PagedList<ShopOrderRow>();
  readonly query = signal<OrderQuery>({ search: '', status: '', brand: '', from: '', to: '', page: 1, limit: 15 });
  readonly brands = signal<ShopBrand[]>([]);

  readonly selectedId = signal<string | null>(null);
  readonly detail = signal<ShopOrderDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly busy = signal(false);

  ngOnInit(): void {
    this.shop.brands().subscribe({ next: (b) => this.brands.set(b), error: () => undefined });
    const q$ = this.route.queryParamMap.pipe(
      map((p): OrderQuery => ({
        search: p.get('search') || '',
        status: p.get('status') || '',
        brand: p.get('brand') || '',
        from: p.get('from') || '',
        to: p.get('to') || '',
        page: intParam(p, 'page', 1),
        limit: intParam(p, 'limit', 15, PAGE_SIZES),
      })),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        return this.shop.orders({ ...q });
      },
      this.destroyRef
    );
  }

  set(patch: Partial<Record<keyof OrderQuery, string | number>>): void {
    const reset = 'page' in patch ? {} : { page: 1 };
    setQuery(this.router, this.route, { ...patch, ...reset });
  }

  filtered(): boolean {
    const q = this.query();
    return !!(q.search || q.status || q.brand || q.from || q.to);
  }

  terms(b: ShopBrandOrder, currency: string): string {
    return commissionTerms(b.commission_model, b.commission_rate, b.commission_fixed, currency);
  }

  fulfil(b: ShopBrandOrder): string {
    return fulfilmentLabel(b.fulfillment_status, b.delivery_verified);
  }

  open(id: string): void {
    this.selectedId.set(id);
    this.load(id);
  }

  load(id: string): void {
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.shop.order(id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.detailLoading.set(false);
      },
      error: (err) => {
        this.detailError.set(apiErrorMessage(err, 'Could not load this order.'));
        this.detailLoading.set(false);
      },
    });
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.selectedId.set(null);
    this.detail.set(null);
  }

  private refresh(): void {
    const id = this.selectedId();
    if (id) this.shop.order(id).subscribe({ next: (d) => this.detail.set(d), error: () => undefined });
    this.list.reload();
  }

  retry(b: ShopBrandOrder): void {
    this.busy.set(true);
    this.shop.retryBrandOrder(b.id).subscribe({
      next: (row) => {
        this.busy.set(false);
        if (row.state === 'created') this.ui.success(`Created ${row.shopify_order_name || 'the order'} in ${row.brand.name}'s store.`);
        else this.ui.error(row.last_error || 'The brand order could not be created.');
        this.refresh();
      },
      error: (err) => {
        this.busy.set(false);
        this.ui.error(err, 'Could not create the brand order.');
        this.refresh();
      },
    });
  }

  sync(b: ShopBrandOrder): void {
    this.busy.set(true);
    this.shop.syncBrandOrder(b.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.ui.success('Updated from Shopify.');
        this.refresh();
      },
      error: (err) => {
        this.busy.set(false);
        this.ui.error(err, 'Could not read the order from Shopify.');
      },
    });
  }

  async cancel(d: ShopOrderDetail): Promise<void> {
    const reason = await this.ui.confirm({
      title: `Cancel ${d.reference}?`,
      message: 'Brand orders that are not dispatched yet are cancelled in the brand\'s store and the commission is reversed. Parcels already dispatched cannot be recalled. Refund the customer in Stripe separately.',
      confirmText: 'Cancel order',
      danger: true,
      input: { label: 'Reason (kept in the history)', required: false, multiline: true },
    });
    if (reason === null) return;
    this.busy.set(true);
    this.shop.cancelOrder(d.id, String(reason) || undefined).subscribe({
      next: (row) => {
        this.busy.set(false);
        this.detail.set(row);
        this.ui.success('Order cancelled.');
        this.list.reload();
      },
      error: (err) => {
        this.busy.set(false);
        this.ui.error(err, 'Could not cancel the order.');
      },
    });
  }
}
