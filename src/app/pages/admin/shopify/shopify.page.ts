import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { IonSpinner } from '@ionic/angular';
import { ApiService, apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PAGE_SIZES, PagedList, SKELETON_ROWS, intParam, setQuery } from '../admin-list';

interface Store {
  id: string;
  shop_domain: string;
  status: 'pending' | 'active' | 'uninstalled';
  connected: boolean;
  installed_at: string | null;
  install_url: string | null;
  setup_links?: { cart_badges: string; product_block: string; cart_notice: string; checkout_editor: string };
  brand?: { id: string; name: string } | null;
  settings: { cod_gateway_names?: string[]; sms_enabled?: boolean; stitch_mode?: 'enabled' | 'customer'; tick_box?: { ok: boolean; at: string; error: string | null }; webhooks?: { ok: boolean; at: string; failed: string[] }; shipping?: { at: string; method: { ok: boolean; error: string | null }; rule: { ok: boolean; error: string | null } } };
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

interface OrdersQuery {
  search: string;
  store: string;
  page: number;
  limit: number;
}

/**
 * Brand stores connected through the Stitch&Ship Shopify app, and the orders that came from them. The "needs attention" list is the
 * work for a person: a failed order, a shipment held because the customer changed the address, a customer who was not emailed.
 */
@Component({
  selector: 'app-admin-shopify',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IonSpinner, DatePipe, NgClass, SearchInputComponent, PaginationComponent, EmptyStateComponent],
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
          <div class="panel-head">
            <h2 class="panel-title">Stores</h2>
            <span class="muted small">{{ connectedCount() }} of {{ stores().length }} connected</span>
          </div>

          @if (publicInstallUrl(); as link) {
            <div class="invite">
              <div class="invite-text">
                <strong>One link for every brand</strong>
                <span>Send this link to a brand. They type their store address and approve the app in Shopify, and the store appears below by itself. You do not need to add it first.</span>
              </div>
              <div class="invite-link">
                <input class="input" readonly [value]="link" aria-label="Public install link" (focus)="$any($event.target).select()" />
                <button type="button" class="btn btn-primary" (click)="copy(link, 'Public link copied.')">Copy link</button>
              </div>
            </div>
          }

          <details class="manual">
            <summary>Add a store by hand (optional)</summary>
            <form class="add" (submit)="$event.preventDefault(); addStore()">
              <input class="input" placeholder="my-brand.myshopify.com" [ngModel]="shop()" (ngModelChange)="shop.set($event)" name="shop" aria-label="Store address" />
              <button type="submit" class="btn" [disabled]="busy() || !shop().trim()">Add store</button>
            </form>
            <p class="muted small hint">Only needed to prepare a store before the brand installs. Otherwise a store is added when the brand installs the app.</p>
          </details>

          @if (!stores().length) {
            <p class="muted empty">No store yet. Send the link above to your first brand.</p>
          } @else {
            <ul class="stores">
              @for (s of stores(); track s.id) {
                <li class="store">
                  <div class="store-top">
                    <span class="avatar" aria-hidden="true">{{ s.shop_domain.charAt(0).toUpperCase() }}</span>
                    <div class="main">
                      <strong class="shop">{{ s.shop_domain }}</strong>
                      <span class="small meta">
                        <span class="badge" [ngClass]="s.connected ? 'green' : s.status === 'uninstalled' ? 'red' : 'amber'">{{ s.connected ? 'Connected' : s.status === 'uninstalled' ? 'Uninstalled' : 'Waiting for install' }}</span>
                        @if (s.installed_at) { <span class="muted">Installed {{ s.installed_at | date: 'MMM d, y' }}</span> }
                        @if (s.brand) { <span class="muted">· Brand {{ s.brand.name }}</span> }
                      </span>
                    </div>
                    <div class="row">
                      @if (s.connected) { <a class="btn btn-sm" [href]="adminUrl(s)" target="_blank" rel="noopener">Open in Shopify</a> }
                      @if (s.install_url) { <button type="button" class="btn btn-sm" (click)="copy(s.install_url, 'Install link copied.')">Copy install link</button> }
                    </div>
                  </div>

                  @if (s.connected) {
                    <div class="health" role="list" aria-label="Setup status">
                      <div class="h-item" role="listitem" [class.ok]="!!s.settings.webhooks?.ok">
                        <span class="h-dot" aria-hidden="true">{{ s.settings.webhooks?.ok ? '✓' : '!' }}</span>
                        <span class="h-text"><b>Order notifications</b><small>{{ s.settings.webhooks?.ok ? 'On' : 'Not connected' }}</small></span>
                        @if (!s.settings.webhooks?.ok) { <button type="button" class="btn btn-xs btn-primary" [disabled]="busy()" (click)="reconnect(s)">Connect</button> }
                      </div>
                      <div class="h-item" role="listitem" [class.ok]="!!s.settings.tick_box?.ok">
                        <span class="h-dot" aria-hidden="true">{{ s.settings.tick_box?.ok ? '✓' : '!' }}</span>
                        <span class="h-text"><b>Product tick box</b><small>{{ s.settings.tick_box?.ok ? 'Ready' : 'Not set up' }}</small></span>
                        @if (!s.settings.tick_box?.ok) { <button type="button" class="btn btn-xs btn-primary" [disabled]="busy()" (click)="createTickBox(s)">Create</button> }
                      </div>
                      <div class="h-item" role="listitem" [class.ok]="!!s.settings.shipping?.method?.ok">
                        <span class="h-dot" aria-hidden="true">{{ s.settings.shipping?.method?.ok ? '✓' : '!' }}</span>
                        <span class="h-text"><b>Shipping method</b><small>{{ s.settings.shipping?.method?.ok ? 'Ready' : 'Not set up' }}</small></span>
                        @if (!s.settings.shipping?.method?.ok) { <button type="button" class="btn btn-xs btn-primary" [disabled]="busy()" (click)="setupShipping(s)">Set up</button> }
                      </div>
                    </div>
                    @if (!s.settings.webhooks?.ok && s.settings.webhooks?.failed?.length) { <p class="small err">{{ s.settings.webhooks?.failed?.[0] }}</p> }
                    @if (!s.settings.shipping?.method?.ok) { <p class="small err">{{ s.settings.shipping?.method?.error || 'The "Ship to Stitch & Ship" shipping method is not in the store yet.' }}</p> }
                    @if (!s.settings.tick_box?.ok) { <p class="small err">{{ s.settings.tick_box?.error || 'The "Stitch&Ship available" tick box is not on the products yet.' }}</p> }

                    @if (s.setup_links; as l) {
                      <div class="theme">
                        <div class="theme-title">Theme setup <span class="muted">opens the brand's Shopify admin</span></div>
                        <div class="theme-links">
                          <a class="link-card" [href]="l.cart_badges" target="_blank" rel="noopener"><b>1</b><span>Cart badges</span></a>
                          <a class="link-card" [href]="l.product_block" target="_blank" rel="noopener"><b>2</b><span>Tick box on the product page</span></a>
                          <a class="link-card" [href]="l.cart_notice" target="_blank" rel="noopener"><b>3</b><span>Cart page notice <small>optional</small></span></a>
                          <a class="link-card" [href]="l.checkout_editor" target="_blank" rel="noopener"><b>4</b><span>Checkout editor <small>Plus only</small></span></a>
                        </div>
                      </div>
                    }
                  }

                  <details class="more">
                    <summary>Store settings</summary>
                    <div class="more-body">
                      <label class="field">
                        <span class="field-label">When does an order become a Stitch&amp;Ship order?</span>
                        <span class="field-help">The whole order then goes to the atelier as ONE order.</span>
                        <select class="input" [ngModel]="stitchMode(s)" (ngModelChange)="setStitchMode(s, $event)" [name]="'sm-' + s.id">
                          <option value="customer">The customer ticked Stitch&amp;Ship on the product page AND the product has "Stitch&amp;Ship available" ticked (recommended)</option>
                          <option value="enabled">The product has "Stitch&amp;Ship available" ticked (no tick needed from the customer)</option>
                        </select>
                      </label>
                      <label class="field">
                        <span class="field-label">Cash on delivery payment names</span>
                        <span class="field-help">Comma separated. Only if the store's cash on delivery method has its own name.</span>
                        <input class="input" [ngModel]="gateways(s)" (ngModelChange)="setGateways(s, $event)" [name]="'gw-' + s.id" placeholder="Cash on Delivery (COD)" />
                      </label>
                      <label class="check">
                        <input type="checkbox" [ngModel]="smsOn(s)" (ngModelChange)="setSms(s, $event)" [name]="'sms-' + s.id" [disabled]="!smsConfigured()" />
                        <span>Also text the customer ("add your sizes")@if (!smsConfigured()) { <span class="muted"> · text messages are not set up on the server</span> }</span>
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
          <h2 class="panel-title pad">Shopify orders</h2>
          <div class="toolbar-row">
            <app-search-input placeholder="Search order number, customer email, store, SA number…" [value]="ordersQuery().search" (search)="setOrders({ search: $event })" />
            <label class="filter">Store
              <select class="select" aria-label="Filter by store" (change)="setOrders({ store: $any($event.target).value })">
                <option value="" [selected]="!ordersQuery().store">All stores</option>
                @for (st of stores(); track st.id) { <option [value]="st.id" [selected]="st.id === ordersQuery().store">{{ st.shop_domain }}</option> }
              </select>
            </label>
            <label class="filter">Rows
              <select class="select" aria-label="Rows per page" (change)="setOrders({ limit: $any($event.target).value })">
                @for (n of pageSizes; track n) { <option [value]="n" [selected]="n === ordersQuery().limit">{{ n }}</option> }
              </select>
            </label>
            @if (orders.meta(); as m) { <span class="result-count">{{ m.total }} {{ m.total === 1 ? 'order' : 'orders' }}</span> }
          </div>

          <div class="orders-card" [class.refreshing]="orders.refreshing()">
            @if (orders.error()) {
              <app-empty-state kind="error" [message]="orders.error()" (retry)="orders.reload()" />
            } @else {
              <div class="table-scroll">
                <table class="data-table orders-table">
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
                    @if (orders.loading()) {
                      @for (i of skeleton; track i) { <tr class="sk">@for (c of [1, 2, 3, 4, 5, 6, 7]; track c) { <td><span class="skeleton"></span></td> }</tr> }
                    } @else {
                      @for (r of orders.items(); track r.id) {
                        <tr [class.attn-row]="r.needs_attention">
                          <td data-label="Shopify order"><span class="cell-main">{{ r.shopify_order_name || r.shopify_order_id }}</span></td>
                          <td data-label="Store" class="store-cell">{{ r.store?.shop_domain }}</td>
                          <td data-label="Customer" class="email-cell">{{ r.customer_email || '—' }}</td>
                          <td data-label="Received" class="nowrap">{{ r.created_at | date: 'MMM d, h:mm a' }}</td>
                          <td data-label="Progress">
                            <ol class="steps" aria-label="Progress">
                              @for (st of steps(r); track st.label) { <li [attr.data-s]="st.state" [attr.title]="st.label">{{ st.short }}</li> }
                            </ol>
                          </td>
                          <td data-label="Status">
                            <span class="badge" [ngClass]="badge(r).tone">{{ badge(r).label }}</span>
                            @if (r.last_error) { <span class="cell-sub err">{{ r.last_error }}</span> }
                          </td>
                          <td data-label="Stitch&amp;Ship order">
                            @if (r.order?.reference) { <a class="btn btn-sm" [routerLink]="['/admin/orders']" [queryParams]="{ ref: r.order?.reference }">{{ r.order?.reference }}</a> }
                            @else { <span class="muted">—</span> }
                          </td>
                        </tr>
                      } @empty {
                        <tr class="empty-row"><td colspan="7">
                          <app-empty-state [title]="ordersFiltered() ? 'No matching orders' : 'No Shopify order yet'"
                            [message]="ordersFiltered() ? 'Try a different search or store.' : 'Orders appear here when a customer buys with Stitch&Ship.'" />
                        </td></tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
              <app-pagination [meta]="orders.meta()" (pageChange)="setOrders({ page: $event })" />
            }
          </div>
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
    .panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .panel-head .panel-title { margin: 0; }
    .alerts, .stores { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .alerts li { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; padding: 12px 14px; border-radius: var(--radius); background: var(--c-bg-soft); }
    .stores { gap: 14px; }
    .invite { display: flex; gap: 16px 24px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 16px 18px; margin-bottom: 14px; border-radius: var(--radius); background: var(--c-gold-soft); border: 1px solid var(--c-line); }
    .invite-text { display: flex; flex-direction: column; gap: 3px; flex: 1 1 280px; font-size: 13.5px; line-height: 1.5; color: var(--c-ink-2); }
    .invite-text strong { font-size: 15px; color: var(--c-ink); }
    .invite-link { display: flex; gap: 8px; flex: 1 1 340px; max-width: 520px; input { flex: 1; min-width: 0; background: var(--c-surface); } }
    .manual { margin-bottom: 16px; font-size: 13px; }
    .manual summary { cursor: pointer; font-weight: 600; color: var(--c-muted); width: fit-content; }
    .manual .add { margin-top: 10px; }
    .empty { padding: 18px 0 4px; }
    .store { border: 1px solid var(--c-line); border-radius: var(--radius-lg); padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; background: var(--c-surface); }
    .store-top { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .avatar { width: 42px; height: 42px; border-radius: 12px; background: var(--c-gold-soft); color: var(--c-gold-dark); font-weight: 700; display: grid; place-items: center; flex: none; }
    .main { display: flex; flex-direction: column; gap: 5px; min-width: 0; flex: 1 1 240px; overflow-wrap: anywhere; }
    .shop { font-size: 15px; }
    .title { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .meta { display: flex; gap: 6px 10px; align-items: center; flex-wrap: wrap; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .err { color: var(--c-red); margin: 0; }
    .add { display: flex; gap: 10px; margin-top: 4px; input { flex: 1; min-width: 0; } }
    .hint { margin: 8px 0 4px; }
    .health { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
    .h-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: var(--radius); background: var(--c-bg-soft); }
    .h-item.ok { background: var(--c-surface); }
    .h-dot { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--c-amber-soft); color: var(--c-amber); }
    .h-item.ok .h-dot { background: #e3f1ea; color: var(--c-green); }
    .h-text { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.25; }
    .h-text b { font-size: 13px; }
    .h-text small { color: var(--c-muted); font-size: 12px; }
    .theme { display: flex; flex-direction: column; gap: 8px; }
    .theme-title { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-muted); }
    .theme-title .muted { text-transform: none; letter-spacing: 0; font-weight: 400; margin-left: 6px; }
    .theme-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
    .link-card { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: var(--radius); text-decoration: none; color: var(--c-ink); font-size: 13px; font-weight: 600; background: var(--c-surface); transition: border-color 0.15s, box-shadow 0.15s; }
    .link-card:hover { border-color: var(--c-green); box-shadow: var(--shadow-sm); }
    .link-card b { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--c-gold-soft); color: var(--c-gold-dark); display: grid; place-items: center; font-size: 12px; }
    .link-card small { display: block; font-weight: 400; color: var(--c-muted); font-size: 11.5px; }
    .more { border-top: 1px dashed var(--c-line); padding-top: 12px; }
    .more summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--c-muted); }
    .more-body { display: flex; flex-direction: column; gap: 16px; margin-top: 14px; max-width: 720px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font-size: 13px; font-weight: 600; }
    .field-help { font-size: 12.5px; color: var(--c-muted); margin-bottom: 2px; }
    .check { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.4; }
    .check input { margin-top: 2px; }
    .nowrap { white-space: nowrap; }
    .toolbar-row { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; padding: 0 22px 14px; }
    .toolbar-row .filter { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--c-muted); }
    .toolbar-row .select { width: auto; min-height: 40px; max-width: 240px; }
    .result-count { font-size: 12.5px; color: var(--c-muted); margin-left: auto; }
    .orders-card { border-top: 1px solid var(--c-line); transition: opacity 0.15s; }
    .orders-card.refreshing { opacity: 0.6; }
    .orders-table td { vertical-align: middle; }
    .orders-table .store-cell, .orders-table .email-cell { overflow-wrap: anywhere; max-width: 240px; }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 4px; flex-wrap: wrap; }
    .steps li { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 1.6; background: var(--c-bg-soft); color: var(--c-muted); border: 1px solid var(--c-line); white-space: nowrap; }
    .steps li[data-s='done'] { background: #e3f1ea; color: var(--c-green); border-color: transparent; }
    .steps li[data-s='bad'] { background: var(--c-red-soft); color: var(--c-red); border-color: transparent; }
    @media (max-width: 860px) {
      .toolbar-row { padding: 0 14px 12px; }
      .toolbar-row app-search-input { flex: 1 1 100%; max-width: none; }
      .toolbar-row .filter { flex: 1 1 140px; }
      .toolbar-row .select { flex: 1; max-width: none; }
      .result-count { margin-left: 0; }
      /* a row becomes a card: each cell shows its own label */
      .orders-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .orders-table, .orders-table tbody { display: block; }
      .orders-table tr { display: block; padding: 12px 14px; border-top: 1px solid var(--c-line); }
      .orders-table tr.attn-row { border-left: 3px solid var(--c-red); }
      .orders-table td { display: flex; gap: 12px; justify-content: space-between; align-items: flex-start; padding: 5px 0; border: 0; text-align: right; }
      .orders-table td::before { content: attr(data-label); flex: none; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--c-muted); text-align: left; padding-top: 2px; }
      .orders-table td .steps { justify-content: flex-end; }
      .orders-table .store-cell, .orders-table .email-cell { max-width: none; }
      .orders-table tr.empty-row td { display: block; text-align: center; }
      .orders-table tr.empty-row td::before { content: none; }
      .orders-table tr.sk td::before { content: none; }
    }
  `,
})
export class AdminShopifyPage implements OnInit {
  private api = inject(ApiService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly pageSizes = PAGE_SIZES;
  readonly skeleton = SKELETON_ROWS;
  /** The orders table: one page at a time, searched on the server. The "needs attention" list and the numbers above use `queue`. */
  readonly orders = new PagedList<QueueRow>();
  readonly ordersQuery = signal<OrdersQuery>({ search: '', store: '', page: 1, limit: 15 });

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly configured = signal(true);
  readonly publicInstallUrl = signal<string | null>(null);
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

  steps(r: QueueRow): { label: string; short: string; state: 'done' | 'todo' | 'bad' }[] {
    return [
      { label: 'Order received', short: 'Received', state: 'done' },
      { label: r.address_state === 'address_mismatch' ? 'Wrong address' : 'Address checked', short: r.address_state === 'address_mismatch' ? 'Wrong address' : 'Address', state: r.address_state === 'address_ok' ? 'done' : r.address_state === 'address_mismatch' ? 'bad' : 'todo' },
      { label: 'Draft order', short: 'Draft', state: r.order_id ? 'done' : r.state === 'failed' ? 'bad' : 'todo' },
      { label: 'Customer emailed', short: 'Emailed', state: r.notified_at ? 'done' : 'todo' },
    ];
  }

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): OrdersQuery => ({ search: p.get('search') || '', store: p.get('store') || '', page: intParam(p, 'page', 1), limit: intParam(p, 'limit', 15, PAGE_SIZES) })),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    this.orders.connect(
      q$,
      (q) => {
        this.ordersQuery.set(q);
        return this.api.list<QueueRow>('/admin/shopify/orders', { ...q });
      },
      this.destroyRef
    );
    this.reload();
  }

  setOrders(patch: Partial<Record<keyof OrdersQuery, string | number>>): void {
    const reset = 'page' in patch ? {} : { page: 1 };
    setQuery(this.router, this.route, { ...patch, ...reset });
  }

  ordersFiltered(): boolean {
    const q = this.ordersQuery();
    return !!(q.search || q.store);
  }

  reload(): void {
    this.orders.reload();
    let pending = 2;
    const done = () => {
      if (--pending === 0) this.loading.set(false);
    };
    this.api.get<{ configured: boolean; public_install_url?: string | null; sms_configured?: boolean; stores: Store[] }>('/admin/shopify/stores').subscribe({
      next: (r) => {
        this.configured.set(r.configured);
        this.publicInstallUrl.set(r.public_install_url ?? null);
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

  setupShipping(s: Store): void {
    this.busy.set(true);
    this.api.post<{ ok: boolean; error: string | null }>(`/admin/shopify/stores/${s.id}/shipping`).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r?.ok) this.ui.success('Done. "Ship to Stitch & Ship" is now a shipping method of the store.');
        else this.ui.error(r?.error || 'The shipping method could not be created.');
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

  /** The brand's own Shopify admin. */
  adminUrl(s: Store): string {
    return `https://admin.shopify.com/store/${s.shop_domain.replace(/\.myshopify\.com$/, '')}`;
  }

  async copy(text: string, done = 'Install link copied.'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.ui.success(done);
    } catch {
      this.ui.error('Could not copy. Select the link and copy it by hand.');
    }
  }
}
