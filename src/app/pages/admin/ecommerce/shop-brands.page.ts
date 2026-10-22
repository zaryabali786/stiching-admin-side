import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { apiErrorMessage } from '../../../core/services/api.service';
import { CommissionModel, ShopAdminService, ShopBrand } from '../../../core/services/shop-admin.service';
import { UiService } from '../../../core/services/ui.service';

interface Draft {
  commission_model: CommissionModel;
  commission_rate: number;
  commission_fixed: number;
  shipping_flat: number;
}

/** Ecommerce > Brands: which connected stores sell through the Shop, on what commission, and how healthy their sync is. */
@Component({
  selector: 'app-admin-shop-brands',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgClass, DatePipe, RouterLink, IonSpinner],
  styleUrls: ['./ecommerce.page.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Ecommerce</span>
          <h1>Brands</h1>
          <p class="subtitle">The connected Shopify stores. Approve a brand to list its products in the Shop, set its commission, and watch its product and order sync.</p>
        </div>
        <a class="btn" routerLink="/admin/shopify">Connect a store →</a>
      </header>

      @if (error()) { <div class="notice" role="alert">{{ error() }}</div> }
      <div class="notice info">
        Commission is copied onto every order when it is placed: changing a brand's terms here never changes orders that were already placed.
      </div>

      @if (loading()) {
        <p class="muted"><ion-spinner name="crescent" /> Loading…</p>
      } @else if (!brands().length) {
        <p class="muted">No Shopify store is connected yet. Connect one under Shopify stores first.</p>
      } @else {
        <ul class="brand-list">
          @for (b of brands(); track b.store_id) {
            @let d = draft(b);
            <li class="brand-card">
              <div class="brand-top">
                <div>
                  <h3>{{ b.brand_name }}</h3>
                  <span class="muted small">{{ b.shop_domain }}</span>
                  <div class="badges">
                    <span class="badge" [ngClass]="b.status === 'active' ? 'green' : b.status === 'uninstalled' ? 'red' : 'amber'">{{ b.status === 'active' ? 'Connected' : b.status === 'uninstalled' ? 'Disconnected' : 'Waiting for install' }}</span>
                    <span class="badge" [ngClass]="b.approved ? 'green' : ''">{{ b.approved ? 'Selling in the Shop' : 'Not approved' }}</span>
                    @if (b.currency) { <span class="badge">{{ b.currency }}</span> }
                  </div>
                </div>
                <div class="row-actions">
                  <button type="button" class="switch" [class.on]="b.approved" role="switch" [attr.aria-checked]="b.approved" [attr.aria-label]="'Approve ' + b.brand_name + ' to sell in the Shop'" [disabled]="busy() === b.store_id" (click)="toggleApproved(b)"><span></span></button>
                  <span class="switch-label">{{ b.approved ? 'Approved to sell' : 'Not approved' }}</span>
                </div>
              </div>

              @if (b.status !== 'active') {
                <div class="notice">This store is not connected. Reconnect it (the brand opens the install link again) before it can sell or sync.</div>
              }
              @if (b.permissions.missing.length) {
                <div class="notice" role="alert">
                  Missing Shopify permissions: <b>{{ b.permissions.missing.join(', ') }}</b>. The brand must open the install link again and approve the new permissions. Until then
                  @if (!b.permissions.products) { products cannot be read. } @else if (!b.permissions.orders) { orders cannot be created in its store. } @else { stock levels cannot be read. }
                </div>
              }

              <div class="brand-grid">
                <div class="brand-box">
                  <h4>Commission</h4>
                  <div class="fields">
                    <label>Model
                      <select class="select" [ngModel]="d.commission_model" (ngModelChange)="edit(b, { commission_model: $event })" [name]="'m-' + b.store_id">
                        <option value="percent">Percentage</option>
                        <option value="fixed">Fixed per order</option>
                      </select>
                    </label>
                    @if (d.commission_model === 'percent') {
                      <label>Rate (%)
                        <input class="input" type="number" min="0" max="100" step="0.01" [ngModel]="d.commission_rate" (ngModelChange)="edit(b, { commission_rate: +$event })" [name]="'r-' + b.store_id" />
                      </label>
                    } @else {
                      <label>Amount per order{{ b.currency ? ' (' + b.currency + ')' : '' }}
                        <input class="input" type="number" min="0" step="0.01" [ngModel]="d.commission_fixed" (ngModelChange)="edit(b, { commission_fixed: +$event })" [name]="'f-' + b.store_id" />
                      </label>
                    }
                    <label>Flat shipping{{ b.currency ? ' (' + b.currency + ')' : '' }}
                      <input class="input" type="number" min="0" step="0.01" [ngModel]="d.shipping_flat" (ngModelChange)="edit(b, { shipping_flat: +$event })" [name]="'s-' + b.store_id" />
                    </label>
                  </div>
                  <div class="row-actions">
                    <button type="button" class="btn btn-sm btn-primary" [disabled]="busy() === b.store_id || !dirty(b)" (click)="save(b)">Save terms</button>
                    @if (dirty(b)) { <button type="button" class="btn btn-sm btn-ghost" (click)="reset(b)">Undo</button> }
                  </div>
                </div>

                <div class="brand-box">
                  <h4>Product sync</h4>
                  <span>
                    <span class="badge" [ngClass]="b.catalog.status === 'ok' ? 'green' : b.catalog.status === 'error' ? 'red' : 'amber'">{{ catalogLabel(b) }}</span>
                  </span>
                  <span class="small">{{ b.catalog.products }} products · {{ b.catalog.hidden }} hidden by us</span>
                  <span class="muted small">{{ b.catalog.synced_at ? 'Last synced ' + (b.catalog.synced_at | date: 'MMM d, h:mm a') : 'Never synced' }}</span>
                  @if (b.catalog.error) { <span class="small err">{{ b.catalog.error }}</span> }
                  <div class="row-actions">
                    <button type="button" class="btn btn-sm" [disabled]="busy() === b.store_id || b.status !== 'active' || !b.permissions.products" (click)="sync(b)">
                      @if (syncing() === b.store_id) { <ion-spinner name="crescent" /> Syncing… } @else { Sync now }
                    </button>
                    <a class="btn btn-sm btn-ghost" routerLink="/admin/shop-products" [queryParams]="{ store: b.store_id }">View products</a>
                  </div>
                </div>

                <div class="brand-box">
                  <h4>Orders sent to this brand</h4>
                  <span>
                    <span class="badge" [ngClass]="b.orders.status === 'ok' ? 'green' : b.orders.status === 'attention' ? 'red' : ''">{{ b.orders.status === 'ok' ? 'Working' : b.orders.status === 'attention' ? 'Needs attention' : 'No orders yet' }}</span>
                  </span>
                  <span class="small">{{ b.orders.failed }} failed {{ b.orders.failed === 1 ? 'order' : 'orders' }}</span>
                  @if (b.orders.last_error) { <span class="small err">{{ b.orders.last_error }}</span> }
                  <div class="row-actions">
                    <a class="btn btn-sm btn-ghost" routerLink="/admin/shop-orders" [queryParams]="{ brand: b.store_id }">View orders</a>
                  </div>
                </div>
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class AdminShopBrandsPage implements OnInit {
  private shop = inject(ShopAdminService);
  private ui = inject(UiService);

  readonly brands = signal<ShopBrand[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly syncing = signal<string | null>(null);
  private drafts = signal<Record<string, Partial<Draft>>>({});

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.shop.brands().subscribe({
      next: (rows) => {
        this.brands.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'Could not load the brands.'));
        this.loading.set(false);
      },
    });
  }

  draft(b: ShopBrand): Draft {
    return {
      commission_model: b.commission_model,
      commission_rate: b.commission_rate,
      commission_fixed: b.commission_fixed,
      shipping_flat: b.shipping_flat,
      ...(this.drafts()[b.store_id] || {}),
    };
  }

  dirty(b: ShopBrand): boolean {
    const d = this.drafts()[b.store_id];
    return !!d && (Object.keys(d) as (keyof Draft)[]).some((k) => d[k] !== b[k]);
  }

  edit(b: ShopBrand, patch: Partial<Draft>): void {
    this.drafts.update((all) => ({ ...all, [b.store_id]: { ...(all[b.store_id] || {}), ...patch } }));
  }

  reset(b: ShopBrand): void {
    this.drafts.update((all) => {
      const { [b.store_id]: _drop, ...rest } = all;
      return rest;
    });
  }

  catalogLabel(b: ShopBrand): string {
    return { never: 'Not synced yet', syncing: 'Syncing…', ok: 'Up to date', error: 'Sync failed' }[b.catalog.status];
  }

  private replace(row: ShopBrand): void {
    this.brands.update((list) => list.map((x) => (x.store_id === row.store_id ? row : x)));
  }

  toggleApproved(b: ShopBrand): void {
    this.busy.set(b.store_id);
    this.shop.patchBrand(b.store_id, { approved: !b.approved }).subscribe({
      next: (row) => {
        this.replace(row);
        this.busy.set(null);
        this.ui.success(row.approved ? `${row.brand_name} now sells in the Shop.` : `${row.brand_name} is hidden from the Shop.`);
      },
      error: (err) => {
        this.busy.set(null);
        this.ui.error(err, 'Could not change the approval.');
      },
    });
  }

  save(b: ShopBrand): void {
    const d = this.draft(b);
    if (d.commission_model === 'percent' && (d.commission_rate < 0 || d.commission_rate > 100)) return this.ui.error('The commission rate must be between 0 and 100.');
    if (d.commission_fixed < 0 || d.shipping_flat < 0) return this.ui.error('Amounts cannot be negative.');
    this.busy.set(b.store_id);
    this.shop.patchBrand(b.store_id, d).subscribe({
      next: (row) => {
        this.replace(row);
        this.reset(row);
        this.busy.set(null);
        this.ui.success('Terms saved. They apply to new orders only.');
      },
      error: (err) => {
        this.busy.set(null);
        this.ui.error(err, 'Could not save the terms.');
      },
    });
  }

  sync(b: ShopBrand): void {
    this.busy.set(b.store_id);
    this.syncing.set(b.store_id);
    this.shop.syncBrand(b.store_id).subscribe({
      next: (r) => {
        this.busy.set(null);
        this.syncing.set(null);
        if (r.error) this.ui.error(r.error);
        else this.ui.success(`Synced ${r.products} products (${r.variants} variants)${r.removed ? `, ${r.removed} removed` : ''}.`);
        this.load();
      },
      error: (err) => {
        this.busy.set(null);
        this.syncing.set(null);
        this.ui.error(err, 'The sync failed.');
        this.load();
      },
    });
  }
}
