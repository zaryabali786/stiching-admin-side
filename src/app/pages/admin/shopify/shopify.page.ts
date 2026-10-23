import { DatePipe, NgClass } from '@angular/common';
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
  setup_links?: { cart_badges: string; product_block: string; cart_notice: string; checkout_editor: string };
  brand?: { id: string; name: string } | null;
  settings: { cod_gateway_names?: string[]; sms_enabled?: boolean; stitch_mode?: 'enabled' | 'customer'; tick_box?: { ok: boolean; at: string; error: string | null }; webhooks?: { ok: boolean; at: string; failed: string[] } };
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
  imports: [FormsModule, RouterLink, IonSpinner, DatePipe, NgClass],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Settings</span>
          <h1>Shopify stores</h1>
          <p class="subtitle">Brand stores that offer "Customise stitching with Stitch&Ship", and the orders that came from them.</p>
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

        <div class="stats">
          <div class="stat"><b>{{ connectedCount() }}<small> / {{ stores().length }}</small></b><span>Stores connected</span></div>
          <div class="stat"><b>{{ queue().length }}</b><span>Shopify orders</span></div>
          <div class="stat" [class.attn]="attention().length > 0"><b>{{ attention().length }}</b><span>Need attention</span></div>
        </div>

        <p class="flow">
          <b>How an order travels:</b> a customer buys on the brand's store → we make a <b>draft order</b> (see it in Orders → Drafts) and email the customer to add sizes → the customer confirms in the portal → the brand ships the parcel to the atelier → only then does it reach <b>Receiving</b>.
        </p>

        @if (attention().length) {
          <section class="panel attn-panel">
            <h2 class="panel-title">Needs attention <span class="badge red">{{ attention().length }}</span></h2>
            <ul class="alerts">
              @for (r of attention(); track r.id) {
                <li>
                  <div class="main">
                    <div class="title"><strong>{{ r.shopify_order_name || r.shopify_order_id }}</strong><span class="badge" [ngClass]="badge(r).tone">{{ badge(r).label }}</span></div>
                    <span class="muted small">{{ r.store?.shop_domain }} · {{ r.customer_email || 'no email' }} · {{ r.created_at | date: 'MMM d, h:mm a' }}</span>
                    @if (why(r)) { <span class="small">{{ why(r) }}</span> }
                    @if (r.last_error) { <span class="small err">{{ r.last_error }}</span> }
                  </div>
                  <div class="row">
                    @if (r.order?.reference) { <a class="btn btn-sm" [routerLink]="['/admin/orders']" [queryParams]="{ ref: r.order?.reference }">Open order</a> }
                    @if (r.state === 'failed' || (r.state === 'draft_created' && /Could not (tag|set the atelier)/i.test(r.last_error || ''))) { <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="retry(r)">Try again</button> }
                    @if (r.order_id && !r.notified_at) { <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="resend(r)">Send email</button> }
                  </div>
                </li>
              }
            </ul>
          </section>
        }

        <section class="panel">
          <h2 class="panel-title">Stores</h2>
          <form class="add" (submit)="$event.preventDefault(); addStore()">
            <input class="input" placeholder="my-brand.myshopify.com" [ngModel]="shop()" (ngModelChange)="shop.set($event)" name="shop" aria-label="Store address" />
            <button type="submit" class="btn btn-primary" [disabled]="busy() || !shop().trim()">Add store</button>
          </form>
          <p class="muted small hint">Add the store first, then send the brand its install link. Only stores added here can install the app.</p>
          @if (!stores().length) {
            <p class="muted">No store yet.</p>
          } @else {
            <ul class="stores">
              @for (s of stores(); track s.id) {
                <li class="store">
                  <div class="store-top">
                    <span class="avatar" aria-hidden="true">{{ s.shop_domain.charAt(0).toUpperCase() }}</span>
                    <div class="main">
                      <strong>{{ s.shop_domain }}</strong>
                      <span class="small meta">
                        <span class="badge" [ngClass]="s.connected ? 'green' : s.status === 'uninstalled' ? 'red' : 'amber'">{{ s.connected ? 'Connected' : s.status === 'uninstalled' ? 'Uninstalled' : 'Waiting for install' }}</span>
                        @if (s.connected) {
                          <span class="badge" [ngClass]="s.settings.webhooks?.ok ? 'green' : 'amber'">Order notifications {{ s.settings.webhooks?.ok ? 'on' : 'off' }}</span>
                          <span class="badge" [ngClass]="s.settings.tick_box?.ok ? 'green' : 'amber'" title="The 'Stitch&Ship available' tick box on every product in Shopify">Product tick box {{ s.settings.tick_box?.ok ? 'ready' : 'not set up' }}</span>
                        }
                        @if (s.installed_at) { <span class="muted">Installed {{ s.installed_at | date: 'MMM d, y' }}</span> }
                        @if (s.brand) { <span class="muted">· Brand {{ s.brand.name }}</span> }
                      </span>
                      @if (s.connected && !s.settings.webhooks?.ok && s.settings.webhooks?.failed?.length) { <span class="small err">{{ s.settings.webhooks?.failed?.[0] }}</span> }
                      @if (s.connected && !s.settings.tick_box?.ok) { <span class="small err">{{ s.settings.tick_box?.error || 'The "Stitch&Ship available" tick box is not on the products yet. Press "Create product tick box".' }}</span> }
                    </div>
                    <div class="row">
                      @if (s.install_url) { <button type="button" class="btn btn-sm" (click)="copy(s.install_url)">Copy install link</button> }
                      @if (s.connected && !s.settings.tick_box?.ok) { <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="createTickBox(s)">Create product tick box</button> }
                    @if (s.connected && !s.settings.webhooks?.ok) { <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="reconnect(s)">Connect order notifications</button> }
                    </div>
                  </div>
                  @if (s.connected && s.setup_links; as l) {
                    <p class="small setup">
                      <strong>Store setup (one click each, opens the brand's Shopify admin):</strong>
                      <a [href]="l.cart_badges" target="_blank" rel="noopener">1. Turn on cart badges + checkout address</a> ·
                      <a [href]="l.product_block" target="_blank" rel="noopener">2. Add the tick box to the product page</a> ·
                      <a [href]="l.cart_notice" target="_blank" rel="noopener">3. Cart page notice (optional)</a> ·
                      <a [href]="l.checkout_editor" target="_blank" rel="noopener">4. Checkout editor (badge below each product)</a>
                    </p>
                  }
                  <details class="more">
                    <summary>Store settings</summary>
                    <div class="more-body">
                      <label class="small sms">
                        <input type="checkbox" [ngModel]="smsOn(s)" (ngModelChange)="setSms(s, $event)" [name]="'sms-' + s.id" [disabled]="!smsConfigured()" />
                        Also text the customer ("add your sizes")@if (!smsConfigured()) { <span class="muted"> · text messages are not set up on the server</span> }
                      </label>
                      <label class="small gw">Cash on delivery payment names (comma separated, if the store's COD gateway has its own name)
                        <input class="input" [ngModel]="gateways(s)" (ngModelChange)="setGateways(s, $event)" [name]="'gw-' + s.id" placeholder="Cash on Delivery (COD)" />
                      </label>
                      <label class="small gw">When does an order become a Stitch&amp;Ship order? (the whole order then goes to the atelier as ONE order)
                        <select class="input" [ngModel]="stitchMode(s)" (ngModelChange)="setStitchMode(s, $event)" [name]="'sm-' + s.id">
                          <option value="customer">The customer ticked Stitch&amp;Ship on the product page AND the product has "Stitch&amp;Ship available" ticked (recommended)</option>
                          <option value="enabled">The product has "Stitch&amp;Ship available" ticked (no tick needed from the customer)</option>
                        </select>
                      </label>
                      <div class="row"><button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" (click)="saveGateways(s)">Save settings</button></div>
                    </div>
                  </details>
                </li>
              }
            </ul>
          }
        </section>

        <section class="panel flush">
          <h2 class="panel-title pad">Recent Shopify orders</h2>
          @if (!queue().length) {
            <p class="muted pad">No Shopify order yet.</p>
          } @else {
            <div class="table-scroll">
              <table class="data-table">
                <caption class="sr-only">Orders that came from Shopify stores</caption>
                <thead>
                  <tr>
                    <th>Shopify order</th>
                    <th>Store</th>
                    <th>Customer</th>
                    <th>Received</th>
                    <th>Progress</th>
                    <th>Status</th>
                    <th>Stitch&amp;Ship order</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of queue(); track r.id) {
                    <tr [class.attn-row]="r.needs_attention">
                      <td><span class="cell-main">{{ r.shopify_order_name || r.shopify_order_id }}</span></td>
                      <td>{{ r.store?.shop_domain }}</td>
                      <td>{{ r.customer_email || '—' }}</td>
                      <td class="nowrap">{{ r.created_at | date: 'MMM d, h:mm a' }}</td>
                      <td>
                        <ol class="steps" aria-label="Progress">
                          @for (st of steps(r); track st.label) { <li [attr.data-s]="st.state" [attr.title]="st.label">{{ st.label }}</li> }
                        </ol>
                      </td>
                      <td>
                        <span class="badge" [ngClass]="badge(r).tone">{{ badge(r).label }}</span>
                        @if (r.last_error) { <span class="cell-sub err">{{ r.last_error }}</span> }
                      </td>
                      <td>
                        @if (r.order?.reference) { <a class="btn btn-sm" [routerLink]="['/admin/orders']" [queryParams]="{ ref: r.order?.reference }">{{ r.order?.reference }}</a> }
                        @else { <span class="muted">—</span> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .notice { padding: 10px 14px; border-radius: 12px; margin-bottom: 14px; }
    .notice.warn { background: var(--c-amber-soft); color: var(--c-amber); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .stat { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 16px 20px; display: flex; flex-direction: column; gap: 4px; }
    .stat b { font-size: 28px; line-height: 1.1; font-weight: 600; color: var(--c-ink); }
    .stat b small { font-size: 16px; color: var(--c-muted); font-weight: 500; }
    .stat span { color: var(--c-muted); font-size: 12.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    .stat.attn b { color: var(--c-red); }
    .flow { background: var(--c-blue-soft); color: var(--c-ink-2); border-radius: var(--radius); padding: 12px 16px; margin: 0 0 18px; line-height: 1.55; font-size: 13.5px; }
    .panel { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 20px 22px; margin-bottom: 18px; }
    .panel.flush { padding: 0; overflow: hidden; }
    .panel-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; display: flex; gap: 8px; align-items: center; }
    .pad { padding: 18px 22px 0; margin-bottom: 14px; }
    p.pad { padding: 0 22px 20px; }
    .attn-panel { border-left: 4px solid var(--c-red); }
    .alerts, .stores { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .alerts li { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; padding: 12px 14px; border-radius: var(--radius); background: var(--c-bg-soft); }
    .store { border: 1px solid var(--c-line); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .store-top { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
    .avatar { width: 40px; height: 40px; border-radius: 12px; background: var(--c-gold-soft); color: var(--c-gold-dark); font-weight: 700; display: grid; place-items: center; flex: none; }
    .main { display: flex; flex-direction: column; gap: 5px; min-width: 0; flex: 1 1 260px; overflow-wrap: anywhere; }
    .title { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .meta { display: flex; gap: 6px 10px; align-items: center; flex-wrap: wrap; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .err { color: var(--c-red); }
    .add { display: flex; gap: 10px; margin-top: 4px; input { flex: 1; min-width: 0; } }
    .hint { margin: 8px 0 4px; }
    .more { border-top: 1px dashed var(--c-line); padding-top: 10px; }
    .more summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--c-muted); }
    .more-body { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
    .sms { display: flex; gap: 8px; align-items: center; }
    .gw { display: flex; flex-direction: column; gap: 6px; }
    .nowrap { white-space: nowrap; }
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
  private modeEdits = signal<Record<string, 'enabled' | 'customer'>>({});
  readonly attention = computed(() => this.queue().filter((r) => r.needs_attention));

  readonly connectedCount = computed(() => this.stores().filter((s) => s.connected).length);

  badge(r: QueueRow): { label: string; tone: 'green' | 'amber' | 'red' | '' } {
    if (r.state === 'split') return { label: 'Split by an earlier version', tone: '' };
    if (r.state === 'split_pending' || r.state === 'split_failed') return { label: 'Split by an earlier version', tone: 'red' };
    if (r.state === 'cancelled') return { label: 'Cancelled', tone: '' };
    if (r.state === 'failed') return { label: 'Could not be taken in', tone: 'red' };
    if (r.address_state === 'address_mismatch' && r.hold_state === 'held') return { label: 'On hold', tone: 'amber' };
    if (r.hold_state === 'failed') return { label: 'Check in Shopify', tone: 'red' };
    if (r.state === 'draft_created' && !r.notified_at) return { label: 'Customer not emailed', tone: 'amber' };
    if (r.state === 'draft_created') return { label: 'Waiting for customer sizes', tone: 'green' };
    return { label: 'Received', tone: '' };
  }

  steps(r: QueueRow): { label: string; state: 'done' | 'todo' | 'bad' }[] {
    return [
      { label: 'Order received', state: 'done' },
      { label: r.address_state === 'address_mismatch' ? 'Wrong address' : 'Address checked', state: r.address_state === 'address_ok' ? 'done' : r.address_state === 'address_mismatch' ? 'bad' : 'todo' },
      { label: 'Draft order', state: r.order_id ? 'done' : r.state === 'failed' ? 'bad' : 'todo' },
      { label: 'Customer emailed', state: r.notified_at ? 'done' : 'todo' },
    ];
  }

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
    if (r.state.startsWith('split')) return 'An earlier version of the app split this order in Shopify. Orders are no longer split: this one is left as it is, look at it in Shopify.';
    if (/Could not tag/i.test(r.last_error || '')) return 'The Stitch&Ship tag could not be set in Shopify. Press "Try again".';
    if (/Could not set the atelier address/i.test(r.last_error || '')) return 'The delivery address could not be changed to the atelier\'s. The shipment stays on hold. Fix the cause shown below, then press "Try again".';
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

  stitchMode(s: Store): 'enabled' | 'customer' {
    return this.modeEdits()[s.id] ?? s.settings?.stitch_mode ?? 'customer';
  }

  setStitchMode(s: Store, value: 'enabled' | 'customer'): void {
    this.modeEdits.update((m) => ({ ...m, [s.id]: value }));
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
    this.run(this.api.patch(`/admin/shopify/stores/${s.id}`, { settings: { cod_gateway_names: names, sms_enabled: this.smsOn(s), stitch_mode: this.stitchMode(s) } }), 'Saved.');
  }

  createTickBox(s: Store): void {
    this.busy.set(true);
    this.api.post<{ ok: boolean; error: string | null }>(`/admin/shopify/stores/${s.id}/tick-box`).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r?.ok) this.ui.success('Done. The brand now sees "Stitch&Ship available" on every product.');
        else this.ui.error(r?.error || 'The tick box could not be created.');
        this.reload();
      },
      error: (e) => {
        this.busy.set(false);
        this.ui.error(apiErrorMessage(e));
      },
    });
  }

  reconnect(s: Store): void {
    this.run(this.api.post(`/admin/shopify/stores/${s.id}/webhooks`), 'Order notifications connected.');
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
