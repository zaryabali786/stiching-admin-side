import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, checkmarkCircle, cloudUploadOutline, closeOutline, ellipseOutline, flash, flashOutline, globeOutline, idCardOutline, businessOutline,
  imageOutline, informationCircleOutline, navigateOutline, notifications, notificationsOutline, paperPlaneOutline, peopleOutline, phonePortraitOutline, searchOutline, swapHorizontalOutline, timeOutline, trashOutline,
} from 'ionicons/icons';
import { compressImage } from '../../../core/utils/image';
import { UiService } from '../../../core/services/ui.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import {
  NcAudience, NcBroadcast, NcCategory, NcDestination, NcDestinationType, NcOptions, NcOrderOption, NcPageMeta, NcProduct, NcRecipient, NcStatus, NotificationCenterService, NotificationPortal,
} from '../../../core/services/notification-center.service';
import { PaginationComponent } from '../pagination.component';

type Tab = 'compose' | 'scheduled' | 'history';
type Mode = 'all' | 'selected' | 'filter';

const CATEGORY_LABEL: Record<NcCategory, string> = { clients: 'Clients', staff: 'Staff', partners: 'Partners' };
const STATUS_LABEL: Record<NcStatus, string> = { scheduled: 'Scheduled', processing: 'Sending', sent: 'Sent', partial: 'Partly sent', failed: 'Failed', cancelled: 'Cancelled' };

/** Date + time + time zone (as typed) -> the exact instant, as an ISO string in UTC. No library: Intl tells the zone's offset. */
export const zonedToUtcIso = (date: string, time: string, timeZone: string): string | null => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const offsetAt = (utc: number): number => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
    return Date.UTC(+p['year'], +p['month'] - 1, +p['day'], +p['hour'], +p['minute']) - utc;
  };
  let utc = wanted - offsetAt(wanted);
  utc = wanted - offsetAt(utc); // a second pass settles the days when the offset changes (daylight saving)
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
};

const timeZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
};

/**
 * The Notification Center, for both portals:
 *   <app-notification-center portal="admin" />     clients, staff and partners
 *   <app-notification-center portal="partner" />   the partner's own staff only
 * What is shown follows what the server says this person may do (`/options`); the server checks every request again.
 */
@Component({
  selector: 'app-notification-center',
  standalone: true,
  imports: [DatePipe, IonIcon, PaginationComponent],
  template: `
    @if (loadError()) {
      <div class="card empty-card"><p>{{ loadError() }}</p></div>
    } @else if (opts(); as o) {
      <div class="tabs" role="tablist" aria-label="Notification Center">
        @if (o.abilities.create) {
          <button type="button" role="tab" [class.active]="tab() === 'compose'" [attr.aria-selected]="tab() === 'compose'" (click)="setTab('compose')">New notification</button>
        }
        @if (o.abilities.history) {
          <button type="button" role="tab" [class.active]="tab() === 'scheduled'" [attr.aria-selected]="tab() === 'scheduled'" (click)="setTab('scheduled')">Scheduled</button>
          <button type="button" role="tab" [class.active]="tab() === 'history'" [attr.aria-selected]="tab() === 'history'" (click)="setTab('history')">History</button>
        }
      </div>

      @if (tab() === 'compose' && o.abilities.create) {
        <form class="compose" (submit)="$event.preventDefault(); submit()">
          <div class="compose-main">

            <!-- 1 · who -->
            <section class="step">
              <header class="step-head"><span class="num">1</span><div><h3>Who should receive it?</h3><p>Choose the audience, then who exactly.</p></div></header>

              @if (o.categories.length > 1) {
                <div class="cats" role="radiogroup" aria-label="Audience">
                  @for (c of o.categories; track c) {
                    <button type="button" role="radio" class="cat" [attr.aria-checked]="category() === c" [class.on]="category() === c" (click)="setCategory(c)">
                      <span class="cat-ico"><ion-icon [name]="catIcon(c)" aria-hidden="true"></ion-icon></span>
                      <b>{{ categoryLabel(c) }}</b>
                      <small>{{ catHint(c) }}</small>
                    </button>
                  }
                </div>
              } @else {
                <div class="only-note"><ion-icon name="people-outline" aria-hidden="true"></ion-icon> Your notification goes to <b>your own staff</b> only.</div>
              }

              <div class="pills" role="radiogroup" aria-label="Which ones">
                <button type="button" role="radio" class="pill" [attr.aria-checked]="mode() === 'all'" [class.on]="mode() === 'all'" (click)="setMode('all')">{{ allLabel() }}</button>
                @if (category() === 'staff') {
                  <button type="button" role="radio" class="pill" [attr.aria-checked]="mode() === 'filter'" [class.on]="mode() === 'filter'" (click)="setMode('filter')">By department or role</button>
                }
                <button type="button" role="radio" class="pill" [attr.aria-checked]="mode() === 'selected'" [class.on]="mode() === 'selected'" (click)="setMode('selected')">{{ selectedLabel() }}</button>
              </div>

              @if (category() === 'staff' && o.kind === 'admin' && mode() !== 'selected') {
                <div class="sub-box">
                  <span class="sub-label">Partner <em>(none chosen = every partner and the admin team)</em></span>
                  <div class="chips">
                    @for (p of o.partners; track p.id) {
                      <button type="button" class="chip" [class.on]="partnerIds().includes(p.id)" (click)="toggle(partnerIds, p.id)">{{ p.name }}</button>
                    } @empty { <span class="muted small">No partners yet.</span> }
                  </div>
                </div>
              }
              @if (category() === 'staff' && mode() === 'filter') {
                <div class="sub-box">
                  <span class="sub-label">Department or role</span>
                  <div class="chips">
                    @for (t of o.staff_types; track t.id) {
                      <button type="button" class="chip" [class.on]="staffTypes().includes(t.id)" (click)="toggle(staffTypes, t.id)">{{ t.label }}</button>
                    }
                  </div>
                  <label class="switch-row">
                    <input type="checkbox" [checked]="subordinates()" (change)="subordinates.set(!subordinates())" />
                    <span class="sw" aria-hidden="true"></span>
                    <span><b>Include subordinate staff</b><small>Office staff include the whole production floor; a master includes the tailors.</small></span>
                  </label>
                </div>
              }

              @if (mode() === 'selected') {
                <div class="picker">
                  <div class="picker-bar">
                    <label class="searchbox"><ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                      <input type="search" placeholder="Search by name or email" [value]="search()" (input)="onSearch($any($event.target).value)" aria-label="Search" /></label>
                    @if (category() === 'staff') {
                      @if (o.kind === 'admin') {
                        <select class="select" aria-label="Partner" (change)="pickPartner($any($event.target).value)">
                          <option value="">All partners</option>
                          @for (p of o.partners; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                        </select>
                      }
                      <select class="select" aria-label="Department or role" (change)="pickType($any($event.target).value)">
                        <option value="">Any role</option>
                        @for (t of o.staff_types; track t.id) { <option [value]="t.id">{{ t.label }}</option> }
                      </select>
                    }
                  </div>
                  <div class="picker-tools">
                    <span class="count-pill">{{ picked().length }} selected</span>
                    <button type="button" class="link" (click)="selectPage()" [disabled]="!results().length">Select this page</button>
                    <button type="button" class="link muted" (click)="clearSelection()" [disabled]="!picked().length">Clear</button>
                  </div>
                  @if (picked().length) {
                    <div class="chips picked">
                      @for (p of picked(); track p.id) {
                        <span class="chip on">{{ p.name }}<button type="button" class="x" (click)="unpick(p.id)" [attr.aria-label]="'Remove ' + p.name"><ion-icon name="close-outline" aria-hidden="true"></ion-icon></button></span>
                      }
                    </div>
                  }
                  <ul class="results" [class.busy]="searching()">
                    @for (r of results(); track r.id) {
                      <li>
                        <label [class.on]="isPicked(r.id)"><input type="checkbox" [checked]="isPicked(r.id)" (change)="togglePick(r)" />
                          <span class="avatar" aria-hidden="true">{{ r.name.charAt(0).toUpperCase() }}</span>
                          <span class="who"><b>{{ r.name }}</b><span class="muted small">{{ r.email || r.detail }}</span></span>
                          @if (r.email) { <span class="tag">{{ r.detail }}</span> }
                        </label>
                      </li>
                    } @empty {
                      <li class="muted small pad">{{ searching() ? 'Searching…' : 'Nobody found.' }}</li>
                    }
                  </ul>
                  <app-pagination [meta]="resultMeta()" (pageChange)="loadResults($event)" />
                </div>
              }
            </section>

            <!-- 2 · what -->
            <section class="step">
              <header class="step-head"><span class="num">2</span><div><h3>What do you want to say?</h3><p>A short title and a clear message.</p></div></header>
              <div class="field">
                <label for="ncTitle">Title</label>
                <input id="ncTitle" class="input" maxlength="120" autocomplete="off" placeholder="e.g. Eid collection is live" [value]="title()" (input)="title.set($any($event.target).value)" />
                <span class="counter">{{ title().length }}/{{ o.limits.title }}</span>
              </div>
              <div class="field">
                <label for="ncBody">Message</label>
                <textarea id="ncBody" class="input" rows="4" [attr.maxlength]="o.limits.body" placeholder="Write your message…" [value]="body()" (input)="body.set($any($event.target).value)"></textarea>
                <span class="counter">{{ body().length }}/{{ o.limits.body }}</span>
              </div>

              @if (o.abilities.image) {
                <div class="field">
                  <label>Picture <em>(optional)</em></label>
                  @if (image(); as img) {
                    <div class="uploaded">
                      <img [src]="img.dataUrl" alt="The picture you chose" />
                      <div class="uploaded-info">
                        <span class="ok"><ion-icon name="checkmark-circle" aria-hidden="true"></ion-icon> Picture added</span>
                        <b class="fname">{{ img.name }}</b>
                        <small>About {{ imageKb() }} KB · ready to send</small>
                        <div class="uploaded-actions">
                          <label class="btn btn-sm" for="ncImage2"><ion-icon name="swap-horizontal-outline" aria-hidden="true"></ion-icon> Replace</label>
                          <button type="button" class="btn btn-sm btn-ghost danger" (click)="image.set(null)"><ion-icon name="trash-outline" aria-hidden="true"></ion-icon> Remove</button>
                        </div>
                        <input id="ncImage2" class="sr" type="file" accept="image/png,image/jpeg,image/webp" (change)="pickImage($event)" />
                      </div>
                    </div>
                  } @else {
                    <label class="drop" [class.over]="dragging()" for="ncImage" (dragover)="onDragOver($event)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
                      <span class="drop-ico"><ion-icon name="cloud-upload-outline" aria-hidden="true"></ion-icon></span>
                      <b>Drop a picture here, or <u>browse</u></b>
                      <small>PNG, JPG or WebP · it is shrunk automatically so it sends fast</small>
                    </label>
                    <input id="ncImage" class="sr" type="file" accept="image/png,image/jpeg,image/webp" (change)="pickImage($event)" />
                  }
                </div>
              }
            </section>

            <!-- 3 · where it opens -->
            <section class="step">
              <header class="step-head"><span class="num">3</span><div><h3>Where should it open?</h3><p>Optional. What the person sees when they tap the notification.</p></div></header>
              <div class="field">
                <label for="ncDestType">Destination</label>
                <select id="ncDestType" class="select" [value]="destType()" (change)="setDestType($any($event.target).value)">
                  <option value="none">Nothing: just show the message</option>
                  @if (pageOptions().length) { <option value="page">A page of the app</option> }
                  @if (canLinkProduct()) { <option value="product">A product</option> }
                  <option value="url">A custom address</option>
                </select>
              </div>

              @if (destType() === 'page') {
                <div class="field">
                  <label for="ncDestPage">Page</label>
                  <select id="ncDestPage" class="select" [value]="destPage()" (change)="setDestPage($any($event.target).value)">
                    <option value="">Choose a page…</option>
                    @for (p of pageOptions(); track p.key) { <option [value]="p.key" [selected]="destPage() === p.key">{{ p.label }}</option> }
                  </select>
                </div>
                @if (pageEntity() === 'order') {
                  <div class="field">
                    <label>Which order</label>
                    @if (!singleClientId()) {
                      <p class="hint">An order opens only for the client it belongs to. Choose "Selected clients" above and pick exactly one client, then choose the order here.</p>
                    } @else {
                      @if (destOrder(); as order) {
                        <div class="dest-chosen"><b>Order {{ order.reference }}</b><button type="button" class="btn btn-sm btn-ghost" (click)="destOrder.set(null)">Change</button></div>
                      } @else {
                        <input class="input" type="search" placeholder="Search by order number" [value]="orderQuery()" (input)="onOrderSearch($any($event.target).value)" />
                        <ul class="dest-list">
                          @for (o of orderResults(); track o.id) { <li><button type="button" (click)="destOrder.set(o)"><b>{{ o.reference }}</b> <small>{{ o.status }}</small></button></li> }
                          @empty { <li class="muted">{{ orderLoading() ? 'Searching…' : 'This client has no orders.' }}</li> }
                        </ul>
                      }
                    }
                  </div>
                }
              }

              @if (destType() === 'product') {
                <div class="field">
                  <label>Product</label>
                  @if (destProduct(); as p) {
                    <div class="dest-chosen prod-chosen">
                      <span class="prod-img sm">@if (p.image_url) { <img [src]="p.image_url" [alt]="p.title" referrerpolicy="no-referrer" /> } @else { <ion-icon name="image-outline" aria-hidden="true"></ion-icon> }</span>
                      <span class="prod-meta"><b>{{ p.title }}</b><small>{{ p.brand }}</small></span>
                      <button type="button" class="btn btn-sm btn-ghost" (click)="destProduct.set(null)">Change</button>
                    </div>
                  } @else {
                    <div class="prod-filters">
                      <input class="input" type="search" placeholder="Search products by name" [value]="productQuery()" (input)="onProductSearch($any($event.target).value)" aria-label="Search products" />
                      <select class="select" aria-label="Filter by brand" [value]="productBrand()" (change)="setProductBrand($any($event.target).value)">
                        <option value="">All brands</option>
                        @for (b of productBrands(); track b.id) { <option [value]="b.id" [selected]="productBrand() === b.id">{{ b.name }}</option> }
                      </select>
                    </div>
                    <div class="prod-grid" role="listbox" aria-label="Products" (scroll)="onProductScroll($event)">
                      @for (p of productResults(); track p.id) {
                        <button type="button" class="prod-card" role="option" (click)="destProduct.set(p)">
                          <span class="prod-img">
                            @if (p.image_url) { <img [src]="p.image_url" [alt]="p.title" loading="lazy" referrerpolicy="no-referrer" /> } @else { <ion-icon name="image-outline" aria-hidden="true"></ion-icon> }
                          </span>
                          <span class="prod-name">{{ p.title }}</span>
                          <span class="prod-brand">{{ p.brand }}</span>
                        </button>
                      }
                      @if (productLoading()) { <p class="prod-state">Loading products…</p> }
                      @else if (!productResults().length) { <p class="prod-state">No product found{{ productBrand() || productQuery() ? ' for this search' : '' }}.</p> }
                      @else if (!productMore()) { <p class="prod-state">That is every product.</p> }
                    </div>
                    <label for="ncProductUrl" class="sub">Or paste the product address</label>
                    <input id="ncProductUrl" class="input" type="url" placeholder="https://store.myshopify.com/products/…" [value]="productUrl()" (input)="productUrl.set($any($event.target).value)" />
                    <p class="hint">The product opens in the client's app through its own product page. Hidden or unavailable products are refused.</p>
                  }
                </div>
              }

              @if (destType() === 'url') {
                <div class="field">
                  <label for="ncDestUrl">Address</label>
                  <input id="ncDestUrl" class="input" type="text" placeholder="/app/orders  or  https://…" [value]="destUrl()" (input)="destUrl.set($any($event.target).value)" />
                  <p class="hint">A page of the app, or an https address of an approved website. Addresses with a login, a token, or any other scheme are refused.</p>
                </div>
              }
              @if (destinationSummary(); as d) { <span class="note"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon> {{ d }}</span> }
            </section>

            <!-- 4 · how -->
            <section class="step">
              <header class="step-head"><span class="num">4</span><div><h3>How and when?</h3><p>Priority, delivery and timing.</p></div></header>

              <div class="field">
                <label>Priority</label>
                <div class="duo" role="radiogroup" aria-label="Priority">
                  <button type="button" role="radio" class="tile" [attr.aria-checked]="priority() === 'normal'" [class.on]="priority() === 'normal'" (click)="priority.set('normal')">
                    <ion-icon name="notifications-outline" aria-hidden="true"></ion-icon><span><b>Normal</b><small>A regular message</small></span>
                  </button>
                  <button type="button" role="radio" class="tile urgent" [attr.aria-checked]="priority() === 'urgent'" [class.on]="priority() === 'urgent'" [disabled]="!o.abilities.urgent" (click)="priority.set('urgent')" [attr.title]="o.abilities.urgent ? null : 'You are not allowed to send urgent notifications'">
                    <ion-icon name="flash-outline" aria-hidden="true"></ion-icon><span><b>Urgent</b><small>Marked in red</small></span>
                  </button>
                </div>
              </div>

              <div class="field">
                <label>Delivery <em>(choose one or both)</em></label>
                <div class="duo">
                  <button type="button" class="tile" role="checkbox" [attr.aria-checked]="webOn()" [class.on]="webOn()" (click)="webOn.set(!webOn())">
                    <ion-icon name="globe-outline" aria-hidden="true"></ion-icon><span><b>Web</b><small>In the app’s bell</small></span><ion-icon class="tick" [name]="webOn() ? 'checkmark-circle' : 'ellipse-outline'" aria-hidden="true"></ion-icon>
                  </button>
                  <button type="button" class="tile" role="checkbox" [attr.aria-checked]="pushOn()" [class.on]="pushOn()" (click)="pushOn.set(!pushOn())">
                    <ion-icon name="phone-portrait-outline" aria-hidden="true"></ion-icon><span><b>Push</b><small>To their phone</small></span><ion-icon class="tick" [name]="pushOn() ? 'checkmark-circle' : 'ellipse-outline'" aria-hidden="true"></ion-icon>
                  </button>
                </div>
                @if (pushOn()) {
                  <span class="note"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon> Push reaches people who have the app installed and allowed notifications. The delivery status shows who had no device.</span>
                }
              </div>

              <div class="field">
                <label>When</label>
                <div class="duo" role="radiogroup" aria-label="When">
                  <button type="button" role="radio" class="tile" [attr.aria-checked]="!scheduled()" [class.on]="!scheduled()" [disabled]="!o.abilities.send" (click)="scheduled.set(false)">
                    <ion-icon name="paper-plane-outline" aria-hidden="true"></ion-icon><span><b>Send now</b><small>Right away</small></span>
                  </button>
                  <button type="button" role="radio" class="tile" [attr.aria-checked]="scheduled()" [class.on]="scheduled()" [disabled]="!o.abilities.schedule" (click)="scheduled.set(true)" [attr.title]="o.abilities.schedule ? null : 'You are not allowed to schedule notifications'">
                    <ion-icon name="time-outline" aria-hidden="true"></ion-icon><span><b>Schedule</b><small>Pick a date and time</small></span>
                  </button>
                </div>
                @if (scheduled()) {
                  <div class="when">
                    <input class="input" type="date" aria-label="Date" [min]="today()" [value]="date()" (input)="date.set($any($event.target).value)" />
                    <input class="input" type="time" aria-label="Time" [value]="time()" (input)="time.set($any($event.target).value)" />
                    <select class="select" aria-label="Time zone" (change)="zone.set($any($event.target).value)">
                      @for (z of zones; track z) { <option [value]="z" [selected]="z === zone()">{{ z }}</option> }
                    </select>
                  </div>
                  @if (scheduleInfo(); as s) { <span class="note" [class.bad]="!s.ok"><ion-icon [name]="s.ok ? 'time-outline' : 'alert-circle-outline'" aria-hidden="true"></ion-icon> {{ s.text }}</span> }
                  @if (priority() === 'urgent') { <span class="note"><ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon> An urgent notification that is scheduled goes out at its scheduled time, not before.</span> }
                }
              </div>
            </section>

            @if (formError()) { <p class="form-error" role="alert"><ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon> {{ formError() }}</p> }
          </div>

          <!-- live preview + send -->
          <aside class="compose-side">
            <div class="preview-card">
              <span class="preview-label">Preview</span>
              <div class="phone-note" [class.urgent]="priority() === 'urgent'">
                <span class="pn-ico"><ion-icon [name]="priority() === 'urgent' ? 'flash' : 'notifications'" aria-hidden="true"></ion-icon></span>
                <div class="pn-body">
                  @if (priority() === 'urgent') { <span class="pn-urgent">Urgent</span> }
                  <b>{{ title().trim() || 'Your title appears here' }}</b>
                  <p>{{ body().trim() || 'Your message appears here. Keep it short and clear.' }}</p>
                  @if (image(); as img) { <img [src]="img.dataUrl" alt="" /> }
                  <small>just now</small>
                </div>
              </div>
              <ul class="summary">
                <li><ion-icon [name]="catIcon(category())" aria-hidden="true"></ion-icon> {{ categoryLabel(category()) }} · {{ audienceText() }}</li>
                <li><ion-icon name="navigate-outline" aria-hidden="true"></ion-icon> {{ destinationSummary() || 'Opens nothing (message only)' }}</li>
                <li><ion-icon name="globe-outline" aria-hidden="true"></ion-icon> {{ webOn() && pushOn() ? 'Web + push' : webOn() ? 'Web only' : pushOn() ? 'Push only' : 'No delivery chosen' }}</li>
                <li><ion-icon [name]="scheduled() ? 'time-outline' : 'paper-plane-outline'" aria-hidden="true"></ion-icon> {{ scheduled() ? 'Scheduled' : 'Sent right away' }}</li>
              </ul>
              <button type="submit" class="send" [class.urgent]="priority() === 'urgent'" [disabled]="sending()">
                <ion-icon [name]="scheduled() ? 'time-outline' : 'paper-plane-outline'" aria-hidden="true"></ion-icon>
                {{ sending() ? 'Working…' : scheduled() ? 'Schedule notification' : priority() === 'urgent' ? 'Send urgent notification' : 'Send notification' }}
              </button>
            </div>
          </aside>
        </form>
      }

      @if (tab() !== 'compose' && o.abilities.history) {
        <div class="card list-card">
          @if (tab() === 'history') {
            <div class="filters">
              <select class="select" aria-label="Status" (change)="setFilter('status', $any($event.target).value)">
                <option value="">Any status</option>
                @for (s of statuses; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
              </select>
              <select class="select" aria-label="Priority" (change)="setFilter('priority', $any($event.target).value)">
                <option value="">Any priority</option><option value="normal">Normal</option><option value="urgent">Urgent</option>
              </select>
              @if (o.categories.length > 1) {
                <select class="select" aria-label="Audience" (change)="setFilter('category', $any($event.target).value)">
                  <option value="">Any audience</option>
                  @for (c of o.categories; track c) { <option [value]="c">{{ categoryLabel(c) }}</option> }
                </select>
              }
              <input class="input" type="date" aria-label="From" (change)="setFilter('from', $any($event.target).value)" />
              <input class="input" type="date" aria-label="To" (change)="setFilter('to', $any($event.target).value ? $any($event.target).value + 'T23:59:59' : '')" />
            </div>
          }

          @if (listError()) {
            <p class="form-error">{{ listError() }} <button type="button" class="btn btn-sm" (click)="loadList(1)">Try again</button></p>
          } @else if (!rows().length && !listLoading()) {
            <p class="muted pad">{{ tab() === 'scheduled' ? 'Nothing is scheduled.' : 'Nothing sent yet.' }}</p>
          }
          <div class="table-wrap" [class.busy]="listLoading()">
            @if (rows().length) {
              <table class="table">
                <thead>
                  <tr><th>Notification</th><th>Audience</th><th>{{ tab() === 'scheduled' ? 'Goes out' : 'Sent' }}</th><th>Status</th><th>Delivered</th><th></th></tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.id) {
                    <tr (click)="open(r)" class="clickable">
                      <td>
                        <b>@if (r.priority === 'urgent') { <span class="urgent-badge">Urgent</span> }{{ r.title }}</b>
                        <div class="muted small clip">{{ r.body }}</div>
                        @if (r.creator_name) { <div class="muted small">by {{ r.creator_name }}</div> }
                      </td>
                      <td>{{ categoryLabel(r.category) }}<div class="muted small">{{ audienceSummary(r) }}</div></td>
                      <td>{{ (r.status === 'scheduled' ? r.send_at : r.sent_at || r.created_at) | date: 'd MMM y, h:mm a' }}@if (r.timezone && r.status === 'scheduled') { <div class="muted small">{{ r.timezone }}</div> }</td>
                      <td><span class="badge" [class]="'st-' + r.status">{{ statusLabel(r.status) }}</span></td>
                      <td class="small">
                        @if (r.status === 'scheduled' || r.status === 'cancelled') { <span class="muted">{{ r.recipient_count }} planned</span> } @else {
                          {{ r.recipient_count }} people
                          <div class="muted">{{ channelSummary(r) }}</div>
                        }
                      </td>
                      <td class="row-actions" (click)="$event.stopPropagation()">
                        @if (r.status === 'scheduled' && o.abilities.edit) { <button type="button" class="btn btn-sm" (click)="startEdit(r)">Edit</button> }
                        @if (r.status === 'scheduled' && o.abilities.cancel) { <button type="button" class="btn btn-sm btn-ghost danger" (click)="cancel(r)">Cancel</button> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
          <app-pagination [meta]="listMeta()" (pageChange)="loadList($event)" />
        </div>
      }

      <!-- detail / delivery status -->
      @if (detail(); as d) {
        <div class="overlay" (click)="detail.set(null)">
          <section class="dialog" role="dialog" aria-modal="true" aria-label="Notification details" (click)="$event.stopPropagation()">
            <header>
              <h3>@if (d.priority === 'urgent') { <span class="urgent-badge">Urgent</span> }{{ d.title }}</h3>
              <button type="button" class="btn btn-sm btn-ghost" (click)="detail.set(null)" aria-label="Close">×</button>
            </header>
            <p class="msg">{{ d.body }}</p>
            @if (d.image_url) { <img class="pic" [src]="d.image_url" alt="" /> }
            <dl class="facts">
              <div><dt>Audience</dt><dd>{{ categoryLabel(d.category) }}: {{ audienceSummary(d) }}</dd></div>
              @if (d.destination) { <div><dt>Opens</dt><dd>{{ d.destination.label || d.destination.url || d.destination.type }}</dd></div> }
              <div><dt>Status</dt><dd><span class="badge" [class]="'st-' + d.status">{{ statusLabel(d.status) }}</span></dd></div>
              <div><dt>Channels</dt><dd>{{ d.channels.join(' + ') }}</dd></div>
              <div><dt>Created</dt><dd>{{ d.created_at | date: 'd MMM y, h:mm a' }}@if (d.creator_name) { by {{ d.creator_name }} }</dd></div>
              @if (d.status === 'scheduled') { <div><dt>Goes out</dt><dd>{{ d.send_at | date: 'd MMM y, h:mm a' }} {{ d.timezone }}</dd></div> }
              @if (d.sent_at) { <div><dt>Sent</dt><dd>{{ d.sent_at | date: 'd MMM y, h:mm a' }}</dd></div> }
              @if (d.status !== 'scheduled' && d.status !== 'cancelled') {
                <div><dt>Web</dt><dd>{{ d.web_sent }} delivered@if (d.web_failed) { , {{ d.web_failed }} failed }</dd></div>
                <div><dt>Push</dt><dd>{{ d.push_sent }} accepted by the provider@if (d.push_failed) { , {{ d.push_failed }} failed }@if (d.push_no_device) { , {{ d.push_no_device }} with no registered device }</dd></div>
              }
              @if (d.error) { <div><dt>Problem</dt><dd class="bad">{{ d.error }}</dd></div> }
            </dl>
            @if (d.status === 'partial' || d.status === 'failed') {
              @if (o.abilities.send) { <button type="button" class="btn btn-primary btn-sm" (click)="retry(d)">Retry the failed deliveries</button> }
            }
            @if (d.deliveries) {
              <h4>Delivery status</h4>
              <div class="table-wrap">
                <table class="table small">
                  <thead><tr><th>Person</th><th>Web</th><th>Push</th><th>Problem</th></tr></thead>
                  <tbody>
                    @for (x of d.deliveries; track x.user_id) {
                      <tr><td>{{ x.name || x.email || x.user_id }}</td><td>{{ x.web_status || '–' }}</td><td>{{ x.push_status || '–' }}@if (x.push_devices) { ({{ x.push_devices }}) }</td><td class="bad">{{ x.error }}</td></tr>
                    } @empty { <tr><td colspan="4" class="muted">No deliveries yet.</td></tr> }
                  </tbody>
                </table>
              </div>
              <app-pagination [meta]="detailMeta()" (pageChange)="openPage(d.id, $event)" />
            }
          </section>
        </div>
      }

      <!-- edit a pending scheduled notification -->
      @if (editing(); as e) {
        <div class="overlay" (click)="editing.set(null)">
          <form class="dialog" role="dialog" aria-modal="true" aria-label="Edit scheduled notification" (click)="$event.stopPropagation()" (submit)="$event.preventDefault(); saveEdit()">
            <header><h3>Edit scheduled notification</h3><button type="button" class="btn btn-sm btn-ghost" (click)="editing.set(null)" aria-label="Close">×</button></header>
            <div class="field"><label for="edTitle">Title</label><input id="edTitle" class="input" maxlength="120" [value]="e.title" (input)="patchEdit({ title: $any($event.target).value })" /></div>
            <div class="field"><label for="edBody">Message</label><textarea id="edBody" class="input" rows="4" [attr.maxlength]="o.limits.body" [value]="e.body" (input)="patchEdit({ body: $any($event.target).value })"></textarea></div>
            <div class="row">
              <div class="field"><label>Priority</label>
                <select class="select" (change)="patchEdit({ priority: $any($event.target).value })"><option value="normal" [selected]="e.priority === 'normal'">Normal</option><option value="urgent" [selected]="e.priority === 'urgent'" [disabled]="!o.abilities.urgent">Urgent</option></select></div>
              <div class="field"><label>Delivery</label>
                <select class="select" (change)="patchEdit({ channels: $any($event.target).value.split(',') })">
                  <option value="web" [selected]="e.channels.join() === 'web'">Web</option><option value="push" [selected]="e.channels.join() === 'push'">Push</option><option value="web,push" [selected]="e.channels.join() === 'web,push'">Web and push</option>
                </select></div>
            </div>
            @if (o.abilities.schedule) {
              <div class="field"><label>Goes out</label>
                <div class="when">
                  <input class="input" type="date" aria-label="Date" [min]="today()" [value]="editDate()" (input)="editDate.set($any($event.target).value)" />
                  <input class="input" type="time" aria-label="Time" [value]="editTime()" (input)="editTime.set($any($event.target).value)" />
                  <select class="select" aria-label="Time zone" (change)="editZone.set($any($event.target).value)">@for (z of zones; track z) { <option [value]="z" [selected]="z === editZone()">{{ z }}</option> }</select>
                </div></div>
            }
            <p class="hint">The audience stays as it was. Cancel this one and create a new notification to change who receives it.</p>
            @if (formError()) { <p class="form-error" role="alert">{{ formError() }}</p> }
            <div class="actions"><button type="button" class="btn" (click)="editing.set(null)">Close</button><button type="submit" class="btn btn-primary" [disabled]="sending()">Save changes</button></div>
          </form>
        </div>
      }
    } @else {
      <div class="card empty-card"><p class="muted">Loading…</p></div>
    }
  `,
  styles: [`
    :host { display: block; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    ion-icon { flex: none; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--c-line); margin-bottom: 20px; overflow-x: auto; }
    .tabs button { position: relative; border: none; background: transparent; padding: 10px 16px; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--c-muted); cursor: pointer; white-space: nowrap; }
    .tabs button.active { color: var(--c-ink); }
    .tabs button.active::after { content: ''; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 3px; background: var(--c-dark-2); border-radius: 3px; }

    /* ───── compose: the form on the left, a live preview on the right ───── */
    .compose { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 22px; align-items: start; }
    .compose-main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
    .step { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 20px; padding: 20px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
    .dest-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 190px; overflow: auto; border: 1px solid var(--c-border); border-radius: 10px; }
    .dest-list li { padding: 0; } .dest-list li.muted { padding: 10px 12px; }
    .dest-list button { width: 100%; text-align: left; background: none; border: 0; padding: 9px 12px; font: inherit; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
    .dest-list button:hover { background: rgba(0, 0, 0, 0.04); }
    .dest-chosen { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border: 1px solid var(--c-border); border-radius: 10px; }
    .prod-filters { display: grid; grid-template-columns: 1fr 200px; gap: 8px; }
    .prod-grid { margin-top: 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; max-height: 420px; overflow-y: auto; padding: 4px; border: 1px solid var(--c-border); border-radius: 12px; }
    .prod-card { display: flex; flex-direction: column; gap: 6px; text-align: left; background: var(--c-surface, #fff); border: 1px solid var(--c-border); border-radius: 12px; padding: 8px; cursor: pointer; font: inherit; transition: border-color .15s, box-shadow .15s, transform .15s; }
    .prod-card:hover, .prod-card:focus-visible { border-color: var(--c-green); box-shadow: 0 4px 14px rgba(0, 0, 0, .08); transform: translateY(-1px); outline: none; }
    .prod-img { display: grid; place-items: center; aspect-ratio: 1; width: 100%; border-radius: 8px; background: rgba(0, 0, 0, .05); overflow: hidden; color: var(--c-muted); font-size: 28px; }
    .prod-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .prod-img.sm { width: 56px; height: 56px; aspect-ratio: auto; flex: none; font-size: 22px; }
    .prod-name { font-size: 13px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
    .prod-brand { align-self: flex-start; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, .06); color: var(--c-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .prod-state { grid-column: 1 / -1; margin: 6px 0; text-align: center; font-size: 12.5px; color: var(--c-muted); }
    .prod-chosen { justify-content: flex-start; gap: 12px; }
    .prod-meta { display: flex; flex-direction: column; flex: 1; min-width: 0; } .prod-meta small { color: var(--c-muted); }
    .field .sub { margin-top: 10px; display: block; font-size: 12.5px; color: var(--c-muted); }
    .step-head { display: flex; align-items: center; gap: 12px; }
    .step-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
    .step-head p { margin: 1px 0 0; font-size: 12.5px; color: var(--c-muted); }
    .num { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--c-dark-2); color: var(--portal-on-primary, #fff); font-weight: 700; font-size: 14px; }
    .field { display: flex; flex-direction: column; gap: 6px; position: relative; }
    .field > label { font-size: 12.5px; font-weight: 700; color: var(--c-ink-2); }
    em { font-style: normal; font-weight: 500; color: var(--c-muted); }
    .counter { align-self: flex-end; font-size: 11.5px; color: var(--c-faint, var(--c-muted)); margin-top: -2px; }
    textarea.input { resize: vertical; min-height: 100px; line-height: 1.5; }

    /* audience cards */
    .cats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .cat { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 14px; border: 1.5px solid var(--c-line); border-radius: 16px; background: var(--c-surface); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
    .cat:hover { border-color: var(--c-dark-2); transform: translateY(-1px); }
    .cat.on { border-color: var(--c-dark-2); background: var(--c-bg); box-shadow: 0 0 0 3px rgba(23, 54, 42, .08); }
    .cat b { font-size: 14.5px; } .cat small { font-size: 11.5px; color: var(--c-muted); line-height: 1.3; }
    .cat-ico { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; background: var(--c-bg); color: var(--c-dark-2); font-size: 20px; margin-bottom: 6px; }
    .cat.on .cat-ico { background: var(--c-dark-2); color: var(--portal-on-primary, #fff); }
    .only-note { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: var(--c-bg); font-size: 13px; }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill { padding: 8px 16px; border: 1.5px solid var(--c-line); border-radius: 999px; background: var(--c-surface); font: inherit; font-size: 13px; font-weight: 600; color: var(--c-ink-2); cursor: pointer; }
    .pill.on { background: var(--c-dark-2); border-color: var(--c-dark-2); color: var(--portal-on-primary, #fff); }
    .sub-box { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; background: var(--c-bg); }
    .sub-label { font-size: 12.5px; font-weight: 700; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 6px 13px; border: 1.5px solid var(--c-line); border-radius: 999px; background: var(--c-surface); font: inherit; font-size: 12.5px; color: var(--c-ink-2); cursor: pointer; }
    .chip.on { border-color: var(--c-dark-2); background: var(--c-surface); color: var(--c-dark-2); font-weight: 700; }
    .chip .x { display: grid; place-items: center; border: 0; background: none; padding: 0; margin-left: 2px; cursor: pointer; color: var(--c-muted); font-size: 15px; }
    .switch-row { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; font-size: 13px; }
    .switch-row input { position: absolute; opacity: 0; pointer-events: none; }
    .switch-row small { display: block; color: var(--c-muted); font-size: 12px; margin-top: 1px; }
    .sw { flex: none; width: 40px; height: 24px; border-radius: 999px; background: var(--c-line); position: relative; transition: background .15s; margin-top: 1px; }
    .sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .25); transition: transform .15s; }
    .switch-row input:checked + .sw { background: var(--c-dark-2); }
    .switch-row input:checked + .sw::after { transform: translateX(16px); }
    .switch-row input:focus-visible + .sw { box-shadow: var(--focus-ring); }

    /* the people picker */
    .picker { border: 1px solid var(--c-line); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .picker-bar { display: flex; flex-wrap: wrap; gap: 8px; }
    .searchbox { flex: 1 1 220px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1.5px solid var(--c-line); border-radius: 999px; background: var(--c-surface); min-height: 40px; color: var(--c-muted); }
    .searchbox:focus-within { border-color: var(--c-dark-2); }
    .searchbox input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; color: var(--c-ink); }
    .picker-bar .select { width: auto; min-width: 140px; }
    .picker-tools { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .count-pill { padding: 3px 12px; border-radius: 999px; background: var(--c-dark-2); color: var(--portal-on-primary, #fff); font-size: 12px; font-weight: 700; }
    .link { border: 0; background: none; padding: 0; font: inherit; font-size: 13px; font-weight: 700; color: var(--c-green); cursor: pointer; }
    .link.muted { color: var(--c-muted); } .link:disabled { opacity: .4; cursor: default; }
    .picked { max-height: 104px; overflow-y: auto; }
    .results { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow-y: auto; border: 1px solid var(--c-line-soft); border-radius: 12px; }
    .results.busy { opacity: .55; }
    .results li { border-bottom: 1px solid var(--c-line-soft); } .results li:last-child { border-bottom: 0; }
    .results label { display: flex; align-items: center; gap: 12px; padding: 9px 12px; cursor: pointer; }
    .results label:hover { background: var(--c-bg-soft); } .results label.on { background: var(--c-bg); }
    .results input { accent-color: var(--c-dark-2); width: 17px; height: 17px; }
    .avatar { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--c-bg); color: var(--c-dark-2); font-weight: 700; font-size: 13px; }
    .who { display: flex; flex-direction: column; min-width: 0; flex: 1; } .who b, .who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: var(--c-bg); color: var(--c-ink-2); text-transform: capitalize; white-space: nowrap; }

    /* picture upload */
    .drop { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 28px 16px; text-align: center; border: 2px dashed var(--c-line); border-radius: 18px; background: var(--c-bg-soft, var(--c-bg)); cursor: pointer; transition: border-color .15s, background .15s; }
    .drop:hover, .drop.over { border-color: var(--c-dark-2); background: var(--c-bg); }
    .drop-ico { width: 54px; height: 54px; display: grid; place-items: center; border-radius: 50%; background: var(--c-surface); color: var(--c-dark-2); font-size: 28px; box-shadow: 0 2px 8px rgba(15, 23, 42, .08); margin-bottom: 6px; }
    .drop b { font-size: 14px; } .drop u { color: var(--c-green); text-underline-offset: 3px; } .drop small { color: var(--c-muted); font-size: 12px; }
    .uploaded { display: flex; gap: 16px; padding: 12px; border: 1.5px solid var(--c-line); border-radius: 18px; background: var(--c-surface); align-items: stretch; }
    .uploaded img { width: 150px; min-height: 110px; max-height: 150px; flex: none; border-radius: 14px; object-fit: cover; background: var(--c-bg); box-shadow: 0 2px 10px rgba(15, 23, 42, .12); }
    .uploaded-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; justify-content: center; }
    .uploaded-info .ok { display: inline-flex; align-items: center; gap: 5px; color: var(--c-green); font-size: 12.5px; font-weight: 700; }
    .uploaded-info .fname { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .uploaded-info small { color: var(--c-muted); font-size: 12px; }
    .uploaded-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .uploaded-actions .btn { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }

    /* big on/off tiles: priority, delivery, when. Always two side by side, even on a phone */
    .duo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .tile { position: relative; display: flex; align-items: center; gap: 10px; padding: 12px; min-width: 0; border: 1.5px solid var(--c-line); border-radius: 16px; background: var(--c-surface); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s, background .15s; }
    .tile > ion-icon:first-child { width: 36px; height: 36px; flex: none; display: grid; padding: 8px; box-sizing: border-box; border-radius: 11px; background: var(--c-bg); color: var(--c-dark-2); }
    .tile span { display: flex; flex-direction: column; min-width: 0; }
    .tile b { font-size: 14px; } .tile small { font-size: 11.5px; color: var(--c-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile .tick { position: absolute; top: 8px; right: 8px; font-size: 18px; color: var(--c-line); }
    .tile.on { border-color: var(--c-dark-2); background: var(--c-bg); }
    .tile.on > ion-icon:first-child { background: var(--c-dark-2); color: var(--portal-on-primary, #fff); }
    .tile.on .tick { color: var(--c-green); }
    .tile.urgent.on { border-color: var(--c-red); background: var(--c-red-soft); }
    .tile.urgent.on > ion-icon:first-child { background: var(--c-red); color: #fff; }
    .tile:disabled { opacity: .45; cursor: not-allowed; }
    .when { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
    .when .select { grid-column: 1 / -1; width: 100%; }
    .note { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: var(--c-muted); line-height: 1.4; } .note ion-icon { margin-top: 1px; font-size: 15px; }
    .note.bad, .bad { color: var(--c-red); }
    .form-error { display: flex; align-items: center; gap: 8px; margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--c-red-soft); color: var(--c-red); font-size: 13px; }

    /* the preview + send panel */
    .compose-side { position: sticky; top: 16px; }
    .preview-card { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 6px 20px rgba(15, 23, 42, .06); }
    .preview-label { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--c-muted); }
    .phone-note { display: flex; gap: 12px; padding: 14px; border-radius: 16px; background: var(--c-bg); border: 1.5px solid var(--c-line); }
    .phone-note.urgent { background: var(--c-red-soft); border-color: #f0b4ae; }
    .pn-ico { width: 38px; height: 38px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--c-dark-2); color: var(--portal-on-primary, #fff); font-size: 18px; }
    .urgent .pn-ico { background: var(--c-red); color: #fff; }
    .pn-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .pn-body b { font-size: 14px; overflow-wrap: anywhere; } .pn-body p { margin: 0; font-size: 12.5px; color: var(--c-ink-2); line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 8.5em; overflow: hidden; }
    .pn-body img { width: 100%; max-height: 150px; margin-top: 6px; border-radius: 10px; object-fit: cover; }
    .pn-body small { color: var(--c-muted); font-size: 11px; margin-top: 4px; }
    .pn-urgent { align-self: flex-start; padding: 0 8px; border-radius: 999px; background: var(--c-red); color: #fff; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .summary { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; color: var(--c-ink-2); }
    .summary li { display: flex; align-items: center; gap: 8px; } .summary ion-icon { color: var(--c-muted); font-size: 16px; }
    .send { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; border: 0; border-radius: 14px; background: var(--c-dark-2); color: var(--portal-on-primary, #fff); font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; transition: transform .1s, opacity .15s; }
    .send.urgent { background: var(--c-red); color: #fff; }
    .send:hover:not(:disabled) { transform: translateY(-1px); } .send:disabled { opacity: .6; cursor: default; }

    /* ───── lists ───── */
    .muted { color: var(--c-muted); } .small { font-size: 12px; } .pad { padding: 14px; margin: 0; }
    .empty-card { padding: 28px; text-align: center; }
    .list-card { padding: 0; overflow: hidden; border-radius: 20px; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--c-line-soft); }
    .filters .select, .filters .input { width: auto; min-width: 130px; flex: 1 1 130px; max-width: 200px; }
    .table-wrap { overflow-x: auto; } .table-wrap.busy { opacity: .6; }
    .table { width: 100%; border-collapse: collapse; } .table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--c-muted); padding: 10px 14px; }
    .table td { padding: 12px 14px; border-top: 1px solid var(--c-line-soft); vertical-align: top; font-size: 13px; }
    .table.small td, .table.small th { padding: 7px 10px; }
    .clickable { cursor: pointer; } .clickable:hover { background: var(--c-bg-soft); }
    .clip { max-width: 320px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .row-actions { white-space: nowrap; text-align: right; } .danger { color: var(--c-red); }
    .urgent-badge { display: inline-block; margin-right: 6px; padding: 0 8px; border-radius: 999px; background: var(--c-red-soft); color: var(--c-red); font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; vertical-align: 1px; }
    .badge { padding: 3px 11px; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: var(--c-bg); color: var(--c-ink-2); white-space: nowrap; }
    .st-sent { background: var(--c-green-soft); color: var(--c-green); } .st-partial { background: var(--c-amber-soft); color: var(--c-amber); }
    .st-failed { background: var(--c-red-soft); color: var(--c-red); } .st-scheduled, .st-processing { background: var(--c-blue-soft); color: var(--c-blue); }
    .overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(18, 24, 20, .45); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .dialog { background: var(--c-surface); border-radius: 20px; width: min(720px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-lg); }
    .dialog header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; } .dialog h3 { margin: 0; font-size: 17px; } .dialog h4 { margin: 6px 0 0; font-size: 14px; }
    .dialog .row { display: flex; flex-wrap: wrap; gap: 14px; } .dialog .row .field { flex: 1 1 200px; }
    .dialog .actions { display: flex; gap: 10px; justify-content: flex-end; }
    .hint { font-size: 12px; color: var(--c-muted); }
    .msg { margin: 0; white-space: pre-wrap; } .pic { max-width: 100%; max-height: 240px; border-radius: 12px; object-fit: cover; align-self: flex-start; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 18px; margin: 0; }
    .facts dt { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--c-muted); } .facts dd { margin: 2px 0 0; font-size: 13px; }

    /* ───── responsive ───── */
    @media (max-width: 1020px) {
      .compose { grid-template-columns: 1fr; }
      .compose-side { position: static; order: -1; }
      .preview-card { padding: 14px; }
      .summary { flex-direction: row; flex-wrap: wrap; gap: 6px 16px; }
    }
    @media (max-width: 640px) {
      .step { padding: 16px; border-radius: 18px; }
      .cats { grid-template-columns: 1fr; }
      .cat { flex-direction: row; align-items: center; gap: 12px; flex-wrap: wrap; }
      .cat-ico { margin: 0; } .cat small { flex-basis: 100%; margin-left: 50px; margin-top: -8px; }
      .uploaded { flex-direction: column; } .uploaded img { width: 100%; max-height: 190px; }
      .tile { flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 10px; } .tile .tick { top: 10px; right: 10px; }
      .tile small { white-space: normal; }
      .when { grid-template-columns: 1fr; }
      .table th:nth-child(2), .table td:nth-child(2) { display: none; }
      .filters .select, .filters .input { max-width: none; }
      .prod-filters { grid-template-columns: 1fr; }
      .prod-grid { grid-template-columns: repeat(2, 1fr); max-height: 360px; }
    }
  `],
})
export class NotificationCenterComponent {
  readonly portal = input.required<NotificationPortal>();

  private api = inject(NotificationCenterService);
  private ui = inject(UiService);
  private destroyRef = inject(DestroyRef);

  readonly statuses: NcStatus[] = ['sent', 'partial', 'failed', 'processing', 'scheduled', 'cancelled'];
  readonly zones = timeZones();

  readonly opts = signal<NcOptions | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly tab = signal<Tab>('compose');

  // ── the form ──
  readonly category = signal<NcCategory>('clients');
  readonly mode = signal<Mode>('all');
  readonly partnerIds = signal<string[]>([]);
  readonly staffTypes = signal<string[]>([]);
  readonly subordinates = signal(false);
  readonly picked = signal<NcRecipient[]>([]);
  readonly title = signal('');
  readonly body = signal('');
  readonly image = signal<{ name: string; dataUrl: string } | null>(null);
  readonly priority = signal<'normal' | 'urgent'>('normal');
  readonly webOn = signal(true);
  readonly pushOn = signal(false);
  readonly scheduled = signal(false);
  readonly date = signal('');
  readonly time = signal('09:00');
  readonly zone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  readonly dragging = signal(false);
  readonly sending = signal(false);
  readonly formError = signal<string | null>(null);

  // ── where a tap leads ──
  readonly destType = signal<NcDestinationType>('none');
  readonly destPage = signal('');
  readonly destOrder = signal<NcOrderOption | null>(null);
  readonly destProduct = signal<NcProduct | null>(null);
  readonly destUrl = signal('');
  readonly productUrl = signal('');
  readonly productQuery = signal('');
  readonly productResults = signal<NcProduct[]>([]);
  readonly productLoading = signal(false);
  readonly productMore = signal(false);
  readonly productBrand = signal('');
  readonly productBrands = signal<{ id: string; name: string }[]>([]);
  private productPage = 0;
  private productRequest = 0;
  readonly orderQuery = signal('');
  readonly orderResults = signal<NcOrderOption[]>([]);
  readonly orderLoading = signal(false);
  private productSearch$ = new Subject<string>();
  private orderSearch$ = new Subject<string>();

  /** The pages the server offers for this audience (it builds the list from the app's real pages). */
  readonly pageOptions = computed(() => this.opts()?.destinations?.[this.category()] ?? []);
  readonly pageEntity = computed(() => this.pageOptions().find((p) => p.key === this.destPage())?.entity ?? null);
  /** Products are linked only for clients, and only by an admin (a partner has no access to the Shop catalogue). */
  readonly canLinkProduct = computed(() => this.opts()?.kind === 'admin' && this.category() === 'clients');
  /** The one client an order link is for (an order opens only for its owner). */
  readonly singleClientId = computed(() => (this.category() === 'clients' && this.mode() === 'selected' && this.picked().length === 1 ? this.picked()[0].id : null));
  readonly destinationSummary = computed(() => {
    switch (this.destType()) {
      case 'page': {
        const p = this.pageOptions().find((x) => x.key === this.destPage());
        return p ? `Opens ${p.label}${this.destOrder() ? ' · order ' + this.destOrder()!.reference : ''}` : null;
      }
      case 'product': return this.destProduct() ? `Opens the product "${this.destProduct()!.title}"` : null;
      case 'url': return this.destUrl().trim() ? `Opens ${this.destUrl().trim().startsWith('/') ? 'the app page' : 'the website'} ${this.destUrl().trim()}` : null;
      default: return null;
    }
  });

  // ── the picker ──
  readonly search = signal('');
  readonly results = signal<NcRecipient[]>([]);
  readonly resultMeta = signal<NcPageMeta | null>(null);
  readonly searching = signal(false);
  private pickPartnerId = '';
  private pickTypeId = '';
  private search$ = new Subject<string>();

  // ── lists ──
  readonly rows = signal<NcBroadcast[]>([]);
  readonly listMeta = signal<NcPageMeta | null>(null);
  readonly listLoading = signal(false);
  readonly listError = signal<string | null>(null);
  private filters: Record<string, string> = {};
  readonly detail = signal<NcBroadcast | null>(null);
  readonly detailMeta = signal<NcPageMeta | null>(null);
  readonly editing = signal<NcBroadcast | null>(null);
  readonly editDate = signal('');
  readonly editTime = signal('');
  readonly editZone = signal('UTC');

  readonly today = computed(() => new Date().toISOString().slice(0, 10));
  readonly scheduleInfo = computed(() => {
    if (!this.scheduled() || !this.date() || !this.time()) return null;
    const iso = zonedToUtcIso(this.date(), this.time(), this.zone());
    if (!iso) return { ok: false, text: 'Choose a valid date and time.' };
    if (new Date(iso).getTime() <= Date.now() + 60_000) return { ok: false, text: 'The scheduled time must be in the future.' };
    return { ok: true, text: `Goes out ${new Date(iso).toLocaleString()} your time (${this.date()} ${this.time()} ${this.zone()}).` };
  });

  constructor() {
    addIcons({
      alertCircleOutline, checkmarkCircle, cloudUploadOutline, closeOutline, ellipseOutline, flash, flashOutline, globeOutline, idCardOutline, businessOutline,
      informationCircleOutline, notifications, notificationsOutline, paperPlaneOutline, peopleOutline, phonePortraitOutline, searchOutline, swapHorizontalOutline, timeOutline, trashOutline,
    });
    effect(() => {
      const portal = this.portal();
      untracked(() => this.start(portal));
    });
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadResults(1));
    this.productSearch$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadProducts(true));
    this.orderSearch$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((q) => this.loadOrders(q));
    // the audience changed: a chosen order, page or product may no longer fit it
    effect(() => {
      const client = this.singleClientId();
      untracked(() => {
        this.destOrder.set(null);
        this.orderResults.set([]);
        if (client && this.pageEntity() === 'order') this.loadOrders('');
      });
    });
    effect(() => {
      const options = this.pageOptions();
      const canProduct = this.canLinkProduct();
      untracked(() => {
        if (this.destPage() && !options.some((p) => p.key === this.destPage())) this.destPage.set('');
        if (this.destType() === 'product' && !canProduct) this.setDestType('none');
        if (this.destType() === 'page' && !options.length) this.setDestType('none');
      });
    });
  }

  setDestType(type: NcDestinationType): void {
    this.destType.set(type);
    if (type === 'product' && !this.productResults().length) {
      this.api.productBrands().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (b) => this.productBrands.set(b), error: () => undefined });
      this.loadProducts(true);
    }
  }

  setDestPage(key: string): void {
    this.destPage.set(key);
    this.destOrder.set(null);
    if (this.singleClientId() && this.pageEntity() === 'order') this.loadOrders('');
  }

  onProductSearch(q: string): void { this.productQuery.set(q); this.productSearch$.next(q); }
  onOrderSearch(q: string): void { this.orderQuery.set(q); this.orderSearch$.next(q); }

  setProductBrand(id: string): void {
    this.productBrand.set(id);
    this.loadProducts(true);
  }

  /** The grid scrolled near its end: the next page comes from the server. */
  onProductScroll(event: Event): void {
    const el = event.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) this.loadProducts(false);
  }

  /** One page of products from the server (search and brand applied there). `reset` starts again from the first page. */
  private loadProducts(reset: boolean): void {
    if (!reset && (this.productLoading() || !this.productMore())) return;
    const page = reset ? 1 : this.productPage + 1;
    const request = ++this.productRequest; // an older answer (the search changed meanwhile) is ignored
    if (reset) this.productResults.set([]);
    this.productLoading.set(true);
    this.api.products({ search: this.productQuery().trim(), brand: this.productBrand(), page, limit: 12 }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ items, meta }) => {
        if (request !== this.productRequest) return;
        this.productPage = page;
        this.productResults.update((list) => (reset ? items : [...list, ...items.filter((i) => !list.some((x) => x.id === i.id))]));
        this.productMore.set(meta.hasMore);
        this.productLoading.set(false);
      },
      error: () => {
        if (request !== this.productRequest) return;
        this.productMore.set(false);
        this.productLoading.set(false);
      },
    });
  }

  private loadOrders(q: string): void {
    const client = this.singleClientId();
    if (!client) return;
    this.orderLoading.set(true);
    this.api.clientOrders(client, q.trim()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => { this.orderResults.set(rows); this.orderLoading.set(false); },
      error: () => { this.orderResults.set([]); this.orderLoading.set(false); },
    });
  }

  /** The destination to send: null for none, a string for a missing field (shown to the sender). The server validates it again. */
  private destination(): NcDestination | null | string {
    switch (this.destType()) {
      case 'page': {
        if (!this.destPage()) return 'Choose the page the notification opens.';
        if (this.pageEntity() === 'order') {
          if (!this.singleClientId()) return 'To link an order, select exactly one client.';
          if (!this.destOrder()) return 'Choose the order to open.';
          return { type: 'page', page: this.destPage(), entity_id: this.destOrder()!.id };
        }
        return { type: 'page', page: this.destPage() };
      }
      case 'product':
        if (this.destProduct()) return { type: 'product', product_id: this.destProduct()!.id };
        return this.productUrl().trim() ? ({ type: 'product', url: this.productUrl().trim() } as NcDestination) : 'Choose a product or paste its address.';
      case 'url':
        return this.destUrl().trim() ? { type: 'url', url: this.destUrl().trim() } : 'Enter the address to open.';
      default:
        return null;
    }
  }

  private start(portal: NotificationPortal): void {
    this.api.options(portal).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (o) => {
        this.opts.set(o);
        this.category.set(o.categories[0] ?? 'staff');
        if (!o.abilities.send && o.abilities.schedule) this.scheduled.set(true);
        this.tab.set(o.abilities.create ? 'compose' : o.abilities.history ? 'history' : 'compose');
        if (this.tab() !== 'compose') this.loadList(1);
      },
      error: (err) => this.loadError.set(apiErrorMessage(err) || 'You do not have access to the Notification Center.'),
    });
  }

  categoryLabel(c: NcCategory): string { return CATEGORY_LABEL[c] ?? c; }
  statusLabel(s: NcStatus): string { return STATUS_LABEL[s] ?? s; }

  allLabel(): string {
    const o = this.opts();
    return this.category() === 'clients' ? 'All clients' : this.category() === 'partners' ? 'All partners' : o?.kind === 'partner' ? 'All my staff' : 'All staff';
  }
  selectedLabel(): string {
    return this.category() === 'clients' ? 'Selected clients' : this.category() === 'partners' ? 'Selected partners' : 'Selected staff members';
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    this.filters = {};
    if (t !== 'compose') this.loadList(1);
  }

  setCategory(c: NcCategory): void {
    if (this.category() === c) return;
    this.category.set(c);
    this.mode.set('all');
    this.picked.set([]);
    this.partnerIds.set([]);
    this.staffTypes.set([]);
    this.results.set([]);
  }

  setMode(m: Mode): void {
    this.mode.set(m);
    if (m === 'selected') this.loadResults(1);
  }

  toggle(sig: { (): string[]; set(v: string[]): void }, id: string): void {
    sig.set(sig().includes(id) ? sig().filter((x) => x !== id) : [...sig(), id]);
  }

  // ── picker ──
  onSearch(v: string): void { this.search.set(v); this.search$.next(v); }
  pickPartner(v: string): void { this.pickPartnerId = v; this.loadResults(1); }
  pickType(v: string): void { this.pickTypeId = v; this.loadResults(1); }

  loadResults(page: number): void {
    this.searching.set(true);
    this.api
      .recipients(this.portal(), { category: this.category(), search: this.search(), page, limit: 20, partner_id: this.pickPartnerId || null, staff_type: this.pickTypeId || null })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ items, meta }) => { this.results.set(items); this.resultMeta.set(meta); this.searching.set(false); },
        error: (err) => { this.searching.set(false); this.ui.error(err); },
      });
  }

  isPicked(id: string): boolean { return this.picked().some((p) => p.id === id); }
  togglePick(r: NcRecipient): void { this.picked.update((l) => (l.some((p) => p.id === r.id) ? l.filter((p) => p.id !== r.id) : [...l, r])); }
  unpick(id: string): void { this.picked.update((l) => l.filter((p) => p.id !== id)); }
  selectPage(): void { this.picked.update((l) => [...l, ...this.results().filter((r) => !l.some((p) => p.id === r.id))]); }
  clearSelection(): void { this.picked.set([]); }

  async pickImage(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.setImageFile(file);
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(true);
  }

  async onDrop(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    this.dragging.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) await this.setImageFile(file);
  }

  private async setImageFile(file: File): Promise<void> {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return void this.ui.error(new Error('Choose a PNG, JPG or WebP picture.'));
    try {
      this.image.set(await compressImage(file));
    } catch (err) {
      this.ui.error(err);
    }
  }

  /** Size of the shrunk picture, from its data URL. */
  imageKb(): number {
    const url = this.image()?.dataUrl ?? '';
    return Math.max(1, Math.round(((url.length - url.indexOf(',') - 1) * 3) / 4 / 1024));
  }

  catIcon(c: NcCategory): string {
    return c === 'clients' ? 'people-outline' : c === 'partners' ? 'business-outline' : 'id-card-outline';
  }

  catHint(c: NcCategory): string {
    return c === 'clients' ? 'Customers with the app' : c === 'partners' ? 'Partner accounts' : 'Team members';
  }

  /** One line for the preview panel: who exactly. */
  audienceText(): string {
    const mode = this.mode();
    if (mode === 'selected') return `${this.picked().length} selected`;
    if (mode === 'filter') return this.staffTypes().length ? this.staffTypes().join(', ') + (this.subordinates() ? ' + subordinates' : '') : 'by partner';
    return this.allLabel().toLowerCase();
  }

  private audience(): NcAudience {
    const category = this.category();
    const mode = this.mode();
    const a: NcAudience = { category, mode };
    if (mode === 'selected') a.ids = this.picked().map((p) => p.id);
    if (category === 'staff') {
      a.partner_ids = this.partnerIds();
      a.staff_types = mode === 'filter' ? this.staffTypes() : [];
      a.include_subordinates = mode === 'filter' && this.subordinates();
    }
    return a;
  }

  submit(): void {
    this.formError.set(null);
    const channels = [...(this.webOn() ? ['web'] : []), ...(this.pushOn() ? ['push'] : [])];
    if (!this.title().trim()) return void this.formError.set('Write a title.');
    if (!this.body().trim()) return void this.formError.set('Write a message.');
    if (!channels.length) return void this.formError.set('Choose web, push or both.');
    if (this.mode() === 'selected' && !this.picked().length) return void this.formError.set('Select at least one person.');
    if (this.mode() === 'filter' && this.category() === 'staff' && !this.staffTypes().length && !this.partnerIds().length) return void this.formError.set('Choose a department, a role or a partner.');
    const destination = this.destination();
    if (typeof destination === 'string') return void this.formError.set(destination);
    let schedule: { at: string; timezone: string } | null = null;
    if (this.scheduled()) {
      const info = this.scheduleInfo();
      if (!info?.ok) return void this.formError.set(info?.text || 'Choose the date and time.');
      schedule = { at: zonedToUtcIso(this.date(), this.time(), this.zone())!, timezone: this.zone() };
    }
    this.sending.set(true);
    this.api
      .create(this.portal(), { title: this.title().trim(), body: this.body().trim(), priority: this.priority(), channels, audience: this.audience(), destination, schedule, image: this.image() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ message }) => {
          this.sending.set(false);
          this.ui.success(message);
          this.reset();
          this.setTab(schedule ? 'scheduled' : 'history');
        },
        error: (err) => {
          this.sending.set(false);
          this.formError.set(apiErrorMessage(err) || 'Could not send the notification.');
        },
      });
  }

  private reset(): void {
    this.title.set('');
    this.body.set('');
    this.image.set(null);
    this.priority.set('normal');
    this.picked.set([]);
    this.mode.set('all');
    this.scheduled.set(false);
    this.date.set('');
    this.destType.set('none');
    this.destPage.set('');
    this.destOrder.set(null);
    this.destProduct.set(null);
    this.destUrl.set('');
    this.productUrl.set('');
  }

  // ── lists ──
  setFilter(key: string, value: string): void {
    this.filters = { ...this.filters, [key]: value };
    this.loadList(1);
  }

  loadList(page: number): void {
    this.listLoading.set(true);
    this.listError.set(null);
    this.api
      .list(this.portal(), { ...this.filters, ...(this.tab() === 'scheduled' ? { scheduled: 'true' } : {}), page, limit: 15 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ items, meta }) => { this.rows.set(items); this.listMeta.set(meta); this.listLoading.set(false); },
        error: (err) => { this.listError.set(apiErrorMessage(err) || 'Could not load.'); this.listLoading.set(false); },
      });
  }

  audienceSummary(r: NcBroadcast): string {
    const a = r.audience;
    if (!a) return '';
    if (a.mode === 'selected') return `${a.ids?.length ?? 0} selected`;
    if (a.mode === 'filter') return [(a.staff_types || []).join(', '), a.include_subordinates ? '+ subordinates' : ''].filter(Boolean).join(' ');
    return a.category === 'staff' && a.partner_ids?.length ? `All staff of ${a.partner_ids.length} partner(s)` : 'Everyone';
  }

  channelSummary(r: NcBroadcast): string {
    const parts: string[] = [];
    if (r.channels.includes('web')) parts.push(`web ${r.web_sent}${r.web_failed ? ` (${r.web_failed} failed)` : ''}`);
    if (r.channels.includes('push')) parts.push(`push ${r.push_sent}${r.push_failed ? ` (${r.push_failed} failed)` : ''}`);
    return parts.join(' · ');
  }

  open(r: NcBroadcast): void { this.openPage(r.id, 1); }

  openPage(id: string, page: number): void {
    this.api.get(this.portal(), id, { page }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => { this.detail.set(d); this.detailMeta.set((d as unknown as { deliveries_meta?: NcPageMeta }).deliveries_meta ?? null); },
      error: (err) => this.ui.error(err),
    });
  }

  async cancel(r: NcBroadcast): Promise<void> {
    const ok = await this.ui.confirm({ title: 'Cancel this notification?', message: `"${r.title}" will not be sent.`, confirmText: 'Cancel notification', danger: true });
    if (!ok) return;
    this.api.cancel(this.portal(), r.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.ui.success('Scheduled notification cancelled.'); this.loadList(this.listMeta()?.page ?? 1); },
      error: (err) => this.ui.error(err),
    });
  }

  retry(d: NcBroadcast): void {
    this.api.retry(this.portal(), d.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.ui.success('Trying the failed deliveries again.'); this.detail.set(null); setTimeout(() => this.loadList(1), 1500); },
      error: (err) => this.ui.error(err),
    });
  }

  startEdit(r: NcBroadcast): void {
    this.formError.set(null);
    const zone = r.timezone || this.zone();
    this.editZone.set(zone);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(r.send_at)).map((p) => [p.type, p.value]));
    this.editDate.set(`${parts['year']}-${parts['month']}-${parts['day']}`);
    this.editTime.set(`${parts['hour']}:${parts['minute']}`);
    this.editing.set({ ...r });
  }

  patchEdit(patch: Partial<NcBroadcast>): void {
    this.editing.update((e) => (e ? ({ ...e, ...patch } as NcBroadcast) : e));
  }

  saveEdit(): void {
    const e = this.editing();
    if (!e || this.sending()) return;
    const body: Record<string, unknown> = { title: e.title, body: e.body, priority: e.priority, channels: e.channels };
    if (this.opts()?.abilities.schedule) {
      const iso = zonedToUtcIso(this.editDate(), this.editTime(), this.editZone());
      if (!iso || new Date(iso).getTime() <= Date.now() + 60_000) return void this.formError.set('The scheduled time must be in the future.');
      body['schedule'] = { at: iso, timezone: this.editZone() };
    }
    this.sending.set(true);
    this.api.update(this.portal(), e.id, body).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.sending.set(false); this.editing.set(null); this.ui.success('Scheduled notification updated.'); this.loadList(this.listMeta()?.page ?? 1); },
      error: (err) => { this.sending.set(false); this.formError.set(apiErrorMessage(err) || 'Could not save.'); },
    });
  }
}
