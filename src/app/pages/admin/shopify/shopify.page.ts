import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { ApiService, apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';

interface Store {
  id: string;
  shop_domain: string;
  status: 'pending' | 'active' | 'uninstalled';
  connected: boolean;
  installed_at: string | null;
  install_url: string | null;
  brand?: { id: string; name: string } | null;
  settings: { cod_gateway_names?: string[]; sms_enabled?: boolean };
}

interface QueueRow {
  id: string;
  shopify_order_id: string;
  shopify_order_name: string | null;
  order_id: string | null;
  order?: { id: string; reference: string } | null;
  customer_email: string | null;
  state: string;
  address_state: string;
  hold_state: string;
  notified_at: string | null;
  last_error: string | null;
  created_at: string;
  store?: { shop_domain: string } | null;
  needs_attention: boolean;
}

/**
 * Brand stores connected through the Stitch&Ship Shopify app, and the orders that came from them. The "needs attention" list is the
 * work for a person: a failed order, a shipment held because the customer changed the address, a customer who was not emailed.
 */
@Component({
  selector: 'app-admin-shopify',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IonSpinner, DatePipe],
  template: `
    <header class="page-head">
      <div>
        <span class="eyebrow">Settings</span>
        <h1>Shopify stores</h1>
        <p class="muted">Brand stores that offer "Customise stitching with Stitch&Ship", and the orders that came from them.</p>
      </div>
    </header>

    @if (loading()) {
      <p class="muted"><ion-spinner name="crescent" /> Loading…</p>
    } @else {
      @if (!configured()) {
        <div class="notice warn" role="alert">
          The Shopify connection is not set up on the server. Add <code>SHOPIFY_APP_API_KEY</code>, <code>SHOPIFY_APP_API_SECRET</code>, <code>SHOPIFY_APP_URL</code> and <code>SHOPIFY_TOKEN_KEY</code> to the server's .env, then restart it.
        </div>
      }
      @if (error()) { <div class="notice warn" role="alert">{{ error() }}</div> }

      <section class="card">
        <h2 class="card-title">Needs attention ({{ attention().length }})</h2>
        @if (!attention().length) {
          <p class="muted">Nothing is waiting for you.</p>
        } @else {
          <ul class="list">
            @for (r of attention(); track r.id) {
              <li>
                <div class="main">
                  <strong>{{ r.shopify_order_name || r.shopify_order_id }}</strong>
                  <span class="muted small">{{ r.store?.shop_domain }} · {{ r.customer_email || 'no email' }} · {{ r.created_at | date: 'MMM d, h:mm a' }}</span>
                  <span class="small">{{ why(r) }}</span>
                  @if (r.last_error) { <span class="small err">{{ r.last_error }}</span> }
                </div>
                <div class="row">
                  @if (r.order?.reference) { <a class="btn btn-sm" [routerLink]="['/admin/orders']" [queryParams]="{ ref: r.order?.reference }">Open order</a> }
                  @if (r.state === 'failed') { <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="retry(r)">Try again</button> }
                  @if (r.order_id && !r.notified_at) { <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="resend(r)">Send email</button> }
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <section class="card">
        <h2 class="card-title">Stores</h2>
        <form class="add" (submit)="$event.preventDefault(); addStore()">
          <input class="input" placeholder="my-brand.myshopify.com" [ngModel]="shop()" (ngModelChange)="shop.set($event)" name="shop" aria-label="Store address" />
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !shop().trim()">Add store</button>
        </form>
        <p class="muted small">Add the store first, then send the brand its install link. Only stores added here can install the app.</p>
        @if (!stores().length) {
          <p class="muted">No store yet.</p>
        } @else {
          <ul class="list">
            @for (s of stores(); track s.id) {
              <li>
                <div class="main">
                  <strong>{{ s.shop_domain }}</strong>
                  <span class="small"><span class="pill" [attr.data-s]="s.connected ? 'ok' : s.status">{{ s.connected ? 'Connected' : s.status === 'uninstalled' ? 'Uninstalled' : 'Waiting for install' }}</span>@if (s.installed_at) { <span class="muted"> · installed {{ s.installed_at | date: 'MMM d, y' }}</span> }@if (s.brand) { <span class="muted"> · brand {{ s.brand.name }}</span> }</span>
                  <label class="small sms">
                    <input type="checkbox" [ngModel]="smsOn(s)" (ngModelChange)="setSms(s, $event)" [name]="'sms-' + s.id" [disabled]="!smsConfigured()" />
                    Also text the customer ("add your sizes")@if (!smsConfigured()) { <span class="muted"> · text messages are not set up on the server</span> }
                  </label>
                  <label class="small gw">Cash on delivery payment names (comma separated, if the store's COD gateway has its own name)
                    <input class="input" [ngModel]="gateways(s)" (ngModelChange)="setGateways(s, $event)" [name]="'gw-' + s.id" placeholder="Cash on Delivery (COD)" />
                  </label>
                </div>
                <div class="row">
                  @if (s.install_url) { <button type="button" class="btn btn-sm" (click)="copy(s.install_url)">Copy install link</button> }
                  <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="saveGateways(s)">Save</button>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <section class="card">
        <h2 class="card-title">Recent Shopify orders</h2>
        @if (!queue().length) {
          <p class="muted">No Shopify order yet.</p>
        } @else {
          <ul class="list">
            @for (r of queue(); track r.id) {
              <li>
                <div class="main">
                  <strong>{{ r.shopify_order_name || r.shopify_order_id }}</strong>
                  <span class="muted small">{{ r.store?.shop_domain }} · {{ r.customer_email }} · {{ r.created_at | date: 'MMM d, h:mm a' }}</span>
                  <span class="small">{{ why(r) || 'All good' }}</span>
                </div>
                @if (r.order?.reference) { <a class="btn btn-sm" [routerLink]="['/admin/orders']" [queryParams]="{ ref: r.order?.reference }">{{ r.order?.reference }}</a> }
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    .notice { padding: 10px 14px; border-radius: 12px; margin-bottom: 14px; }
    .notice.warn { background: var(--c-amber-soft); color: var(--c-amber); }
    .list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .list li { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 12px; flex-wrap: wrap; }
    .main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1 1 260px; overflow-wrap: anywhere; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .err { color: var(--c-red); }
    .add { display: flex; gap: 8px; margin-top: 8px; input { flex: 1; min-width: 0; } }
    .sms { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
    .gw { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: var(--c-neutral-soft); color: var(--c-neutral); }
    .pill[data-s='ok'] { background: var(--c-green-soft); color: var(--c-green); }
    .pill[data-s='pending'] { background: var(--c-amber-soft); color: var(--c-amber); }
  `,
})
export class AdminShopifyPage implements OnInit {
  private api = inject(ApiService);
  private ui = inject(UiService);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly configured = signal(true);
  readonly smsConfigured = signal(false);
  readonly stores = signal<Store[]>([]);
  readonly queue = signal<QueueRow[]>([]);
  readonly shop = signal('');
  private edits = signal<Record<string, string>>({});
  private smsEdits = signal<Record<string, boolean>>({});
  readonly attention = computed(() => this.queue().filter((r) => r.needs_attention));

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    let pending = 2;
    const done = () => {
      if (--pending === 0) this.loading.set(false);
    };
    this.api.get<{ configured: boolean; sms_configured?: boolean; stores: Store[] }>('/admin/shopify/stores').subscribe({
      next: (r) => {
        this.configured.set(r.configured);
        this.smsConfigured.set(!!r.sms_configured);
        this.stores.set(r.stores);
        done();
      },
      error: (e) => {
        this.error.set(apiErrorMessage(e));
        done();
      },
    });
    this.api.get<QueueRow[]>('/admin/shopify/queue').subscribe({
      next: (rows) => {
        this.queue.set(rows);
        done();
      },
      error: () => done(),
    });
  }

  why(r: QueueRow): string {
    if (r.state === 'failed') return 'This order could not be taken in.';
    if (r.address_state === 'address_mismatch' && r.hold_state === 'held') return 'The shipping address is not the atelier. The shipment is on hold until the customer confirms.';
    if (r.hold_state === 'failed') return 'The shipment could not be held or released: check it in Shopify.';
    if (r.state === 'draft_created' && !r.notified_at) return 'The customer has not been emailed yet.';
    if (r.state === 'cancelled') return 'Cancelled by the brand.';
    return '';
  }

  gateways(s: Store): string {
    return this.edits()[s.id] ?? (s.settings?.cod_gateway_names || []).join(', ');
  }

  smsOn(s: Store): boolean {
    return this.smsEdits()[s.id] ?? s.settings?.sms_enabled === true;
  }

  setSms(s: Store, value: boolean): void {
    this.smsEdits.update((m) => ({ ...m, [s.id]: !!value }));
  }

  setGateways(s: Store, value: string): void {
    this.edits.update((m) => ({ ...m, [s.id]: value }));
  }

  private run(call: ReturnType<ApiService['post']>, ok: string): void {
    this.busy.set(true);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.ui.success(ok);
        this.reload();
      },
      error: (e) => {
        this.busy.set(false);
        this.ui.error(apiErrorMessage(e));
        this.reload();
      },
    });
  }

  addStore(): void {
    const shop = this.shop().trim();
    this.run(this.api.post('/admin/shopify/stores', { shop }), 'Store added. Send its install link to the brand.');
    this.shop.set('');
  }

  saveGateways(s: Store): void {
    const names = this.gateways(s).split(',').map((n) => n.trim()).filter(Boolean);
    this.run(this.api.patch(`/admin/shopify/stores/${s.id}`, { settings: { cod_gateway_names: names, sms_enabled: this.smsOn(s) } }), 'Saved.');
  }

  retry(r: QueueRow): void {
    this.run(this.api.post(`/admin/shopify/orders/${r.id}/retry`), 'Tried again.');
  }

  resend(r: QueueRow): void {
    this.run(this.api.post(`/admin/shopify/orders/${r.id}/resend`), 'Email sent.');
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.ui.success('Install link copied.');
    } catch {
      this.ui.error('Could not copy. Select the link and copy it by hand.');
    }
  }
}
