import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { FormsModule } from '@angular/forms';
import { IonSpinner } from '@ionic/angular';
import { ApiService, apiErrorMessage } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { UiService } from '../../../core/services/ui.service';

interface Cod {
  payment_type: 'COD' | 'NON_COD' | null;
  email_order: boolean;
  email_says_cod: boolean;
  can_choose: boolean;
  amount: number | null;
  currency: string | null;
  amount_status: 'extracted' | 'needs_verification' | 'verified' | 'corrected' | null;
  amount_note: string | null;
  payment_status: 'UNPAID' | 'PENDING' | 'PAID' | null;
  needs_verification: boolean;
  can_pay: boolean;
  locked: boolean;
  paid_at: string | null;
  source?: 'shopify' | 'email' | 'manual';
  payment_state?: 'not_required' | 'payment_required' | 'processing' | 'verification_pending' | 'paid';
  receive_blocked?: boolean;
  receive_block_reason?: string | null;
  shopify?: { financial_status: string; amount_paid: number | null; outstanding: number | null } | null;
}

interface HistoryRow {
  id: string;
  old_amount: number | null;
  old_currency: string | null;
  new_amount: number;
  new_currency: string;
  reason: string;
  created_at: string;
}

const AMOUNT_LABEL: Record<string, string> = { extracted: 'Read from the email', needs_verification: 'Needs verification', verified: 'Verified by our team', corrected: 'Corrected by our team' };

/**
 * COD / Non-COD of an email order, seen by authorised staff: the type, the total read from the original email (or typed by staff),
 * its currency and the payment status. Staff can set the type and verify or correct the total (a reason is always written and kept).
 * The server enforces every rule; this only shows the state and sends the requests.
 */
@Component({
  selector: 'app-cod-payment-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IonSpinner, DatePipe],
  template: `
    @if (cod(); as c) {
      @if (c.email_order) {
        <section class="card cod" aria-label="Payment type and total">
          <div class="head">
            <h2 class="card-title">Payment type</h2>
            <span class="pill" [attr.data-t]="c.payment_type || 'none'">{{ c.payment_type === 'COD' ? 'COD' : c.payment_type === 'NON_COD' ? 'Non-COD' : 'Not chosen yet' }}</span>
          </div>
          @if (c.email_says_cod) { <p class="muted small">The email says cash on delivery.</p> }

          @if (c.payment_type === 'COD') {
            <dl class="kv">
              <dt>Order total</dt><dd><b>{{ c.amount == null ? '—' : c.amount }}</b> {{ c.currency || '' }}</dd>
              <dt>Total status</dt><dd>{{ amountLabel(c.amount_status) }}</dd>
              <dt>Payment status</dt><dd><span class="pill" [attr.data-s]="c.payment_status">{{ statusLabel(c.payment_status) }}</span>@if (c.paid_at) { <span class="muted small"> · {{ c.paid_at | date: 'MMM d, y, h:mm a' }}</span> }</dd>
            </dl>
            @if (c.receive_blocked) {
              <p class="warn" role="status">
                <b>Payment is required before receiving this order.</b> The Received button stays closed until the customer's payment is confirmed by Stripe.
                <button type="button" class="btn btn-sm" (click)="checkAgain()" [disabled]="busy()">Check payment again</button>
              </p>
            } @else if (c.payment_status === 'PAID') {
              <p class="ok" role="status">Payment confirmed. This order can be received.</p>
            }
            @if (c.shopify) {
              <dl class="kv">
                <dt>Shopify says</dt><dd>{{ c.shopify.financial_status }}@if (c.shopify.outstanding != null) { · outstanding {{ c.shopify.outstanding }} {{ c.currency || '' }} }</dd>
              </dl>
            }
            @if (c.needs_verification) {
              <p class="warn" role="alert">The total could not be read with certainty. Check the original email and enter the total payable below; the customer cannot pay until it is confirmed.</p>
              @if (c.amount_note) { <p class="muted small">{{ c.amount_note }}</p> }
            }
          }

          @if (canEdit() && c.payment_status !== 'PAID') {
            <div class="row">
              <button type="button" class="btn btn-sm" [class.btn-primary]="c.payment_type === 'COD'" (click)="setType('COD')" [disabled]="busy() || c.payment_type === 'COD'">Mark COD</button>
              <button type="button" class="btn btn-sm" [class.btn-primary]="c.payment_type === 'NON_COD'" (click)="setType('NON_COD')" [disabled]="busy() || c.payment_type === 'NON_COD'">Mark Non-COD</button>
            </div>
            @if (c.payment_type === 'COD') {
              <form class="verify" (submit)="$event.preventDefault(); saveAmount()">
                <strong>{{ c.needs_verification ? 'Enter the verified total' : 'Verify or correct the total' }}</strong>
                <div class="grid">
                  <label class="field"><span>Total payable *</span><input class="input" inputmode="decimal" [ngModel]="amount()" (ngModelChange)="amount.set($event)" name="amount" placeholder="e.g. 4200.00" /></label>
                  <label class="field"><span>Currency *</span><input class="input" maxlength="3" [ngModel]="currency()" (ngModelChange)="currency.set($event)" name="currency" placeholder="PKR" /></label>
                </div>
                <label class="field"><span>Reason * (where the total comes from, or why it changed)</span><input class="input" maxlength="500" [ngModel]="reason()" (ngModelChange)="reason.set($event)" name="reason" /></label>
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || !amount() || currency().length !== 3 || reason().trim().length < 3">
                  @if (busy()) { <ion-spinner name="crescent" /> } Save total
                </button>
              </form>
            }
          }

          @if (history().length) {
            <details class="history">
              <summary>Changes to the total ({{ history().length }})</summary>
              <ul>
                @for (h of history(); track h.id) {
                  <li><b>{{ h.old_amount == null ? '—' : h.old_amount + ' ' + (h.old_currency || '') }} → {{ h.new_amount }} {{ h.new_currency }}</b> · {{ h.reason }} <span class="muted small">{{ h.created_at | date: 'MMM d, y, h:mm a' }}</span></li>
                }
              </ul>
            </details>
          }
          @if (error()) { <p class="warn" role="alert">{{ error() }}</p> }
        </section>
      }
    }
  `,
  styles: `
    .cod { display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: var(--c-neutral-soft); color: var(--c-neutral); }
    .pill[data-t='COD'], .pill[data-s='UNPAID'], .pill[data-s='PENDING'] { background: var(--c-amber-soft); color: var(--c-amber); }
    .pill[data-s='PAID'] { background: var(--c-green-soft); color: var(--c-green); }
    .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; }
    .kv dt { color: var(--c-muted); }
    .kv dd { margin: 0; }
    .warn { margin: 0; padding: 8px 10px; border-radius: 10px; background: var(--c-red-soft); color: var(--c-red); font-size: 13.5px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .ok { margin: 0; padding: 8px 10px; border-radius: 10px; background: var(--c-green-soft); color: var(--c-green); font-size: 13.5px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .verify { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px solid var(--c-line-soft); }
    .grid { display: grid; grid-template-columns: 1fr 110px; gap: 8px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .history ul { margin: 6px 0 0; padding-left: 18px; font-size: 13px; }
    @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class CodPaymentPanelComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private ui = inject(UiService);
  private socket = inject(ChatSocketService);
  private destroyRef = inject(DestroyRef);

  readonly orderId = input.required<string>();
  /** 'admin' uses the admin routes, 'partner' the receiving routes of the partner that owns the order. */
  readonly scope = input<'admin' | 'partner'>('admin');

  readonly cod = signal<Cod | null>(null);
  readonly history = signal<HistoryRow[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly amount = signal('');
  readonly currency = signal('');
  readonly reason = signal('');

  /** The partner needs the receiving permission; an admin may always. The server re-checks. */
  readonly canEdit = computed(() => this.scope() === 'admin' || this.auth.can('receiving.receive'));
  private base = computed(() => (this.scope() === 'admin' ? `/admin/orders/${this.orderId()}` : `/partner/receiving/orders/${this.orderId()}`));

  constructor() {
    effect(() => {
      this.orderId();
      untracked(() => this.load());
    });
    // the customer paid (or a payment changed) while this page is open: the state and the Received button follow without a refresh
    this.socket
      .on('unit:update')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (e?.orderId === this.orderId()) this.load();
      });
  }

  /** Asks the server to check with Stripe again. It only reads from Stripe: it never charges anyone. */
  checkAgain(): void {
    this.busy.set(true);
    this.api.post<{ cod: Cod; history: HistoryRow[] }>(`${this.base()}/cod/check`).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.apply(res);
        this.ui.success(res.cod.payment_status === 'PAID' ? 'Payment confirmed.' : 'Not paid yet.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(e));
      },
    });
  }

  amountLabel(s: string | null): string {
    return (s && AMOUNT_LABEL[s]) || '—';
  }

  statusLabel(s: string | null): string {
    return s === 'PAID' ? 'Paid' : s === 'PENDING' ? 'Pending' : 'Unpaid';
  }

  private apply(res: { cod: Cod; history?: HistoryRow[] }): void {
    this.cod.set(res.cod);
    if (res.history) this.history.set(res.history);
    if (res.cod.amount != null) {
      this.amount.set(String(res.cod.amount));
      this.currency.set(res.cod.currency || '');
    }
  }

  load(): void {
    this.api.get<{ cod: Cod; history: HistoryRow[] }>(`${this.base()}/cod`).subscribe({
      next: (res) => this.apply(res),
      // the panel is an extra: when it cannot load (older server, no access) it simply stays hidden
      error: () => this.cod.set(null),
    });
  }

  setType(type: 'COD' | 'NON_COD'): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.put<{ cod: Cod; history: HistoryRow[] }>(`${this.base()}/payment-type`, { type }).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.apply(res);
        this.ui.success(type === 'COD' ? 'Marked as COD.' : 'Marked as Non-COD.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(e));
      },
    });
  }

  saveAmount(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.put<{ cod: Cod; history: HistoryRow[] }>(`${this.base()}/cod-amount`, { amount: this.amount(), currency: this.currency().toUpperCase(), reason: this.reason().trim() }).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.reason.set('');
        this.apply(res);
        this.ui.success('Total saved.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(e));
      },
    });
  }
}
