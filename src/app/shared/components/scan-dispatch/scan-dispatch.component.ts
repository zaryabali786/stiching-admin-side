import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonSpinner } from '@ionic/angular';
import { apiErrorMessage } from '../../../core/services/api.service';
import { DispatchScan, PartnerService } from '../../../core/services/partner.service';
import { QrScannerComponent } from '../qr-scanner.component';

interface Notice {
  tone: 'ok' | 'notice' | 'error';
  text: string;
}

/**
 * Ready for dispatch: scan the articles' QR codes, then make the loadsheet or print the CNs of the scanned parcels. Each scan is
 * looked up on the server (the real article, order and shipment), so only parcels that are truly booked are listed. The loadsheet
 * and the CN printing themselves are the warehouse page's own (they come back as events): nothing is duplicated here.
 */
@Component({
  selector: 'app-scan-dispatch',
  standalone: true,
  imports: [FormsModule, IonSpinner, QrScannerComponent],
  template: `
    @if (open()) {
      <div class="modal-backdrop sd-backdrop" (click)="close()">
        <div class="modal scan-dispatch" role="dialog" aria-modal="true" aria-labelledby="sd-title" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div>
              <span class="eyebrow">Ready for dispatch</span>
              <h3 id="sd-title">Scan for Loadsheet / CN</h3>
              <p class="muted small">Scan each article's QR code. Scanned articles are listed below; then generate the loadsheet or print their CNs.</p>
            </div>
            <button type="button" class="close-btn" (click)="close()" aria-label="Close">×</button>
          </div>

          <div class="sd-top">
            <app-qr-scanner [active]="open()" [busy]="looking()" (scanned)="add($event)" />
            <form class="manual" (submit)="$event.preventDefault(); add(manual()); manual.set('')">
              <input class="input" placeholder="Or type the code, e.g. SA-1108-1" aria-label="Article code" autocomplete="off" autocapitalize="characters" [ngModel]="manual()" (ngModelChange)="manual.set($event)" name="code" />
              <button type="submit" class="btn" [disabled]="looking() || !manual().trim()">Add</button>
            </form>
            @if (notice(); as n) {
              <div class="notice" [class]="'notice-' + n.tone" role="status" aria-live="polite">
                <span class="dot" aria-hidden="true">{{ n.tone === 'ok' ? '✓' : n.tone === 'notice' ? '!' : '×' }}</span>
                <span>{{ n.text }}</span>
              </div>
            }
          </div>

          <div class="sd-list" aria-label="Scanned articles">
            <div class="sd-list-head">
              <b>Scanned ({{ items().length }})</b>
              @if (items().length) { <button type="button" class="btn btn-ghost btn-xs" [disabled]="working()" (click)="clear()">Clear all</button> }
            </div>
            @if (!items().length) {
              <p class="muted small empty">Nothing scanned yet. Point the camera at an article's QR code.</p>
            }
            <ul>
              @for (it of items(); track it.key) {
                <li [class.skip]="!it.scan.can_loadsheet">
                  <div class="main">
                    <strong>{{ it.scan.article?.code || it.scan.order.reference }}</strong>
                    <span class="muted small">{{ it.scan.article?.title || 'Whole parcel' }} · Order {{ it.scan.order.reference }}</span>
                    <span class="small">
                      {{ it.scan.order.customer_name || 'Customer' }}@if (it.scan.order.customer_code) { · {{ it.scan.order.customer_code }} }@if (it.scan.order.destination_city) { · {{ it.scan.order.destination_city }} }
                    </span>
                    <span class="small cn">{{ it.scan.shipment?.courier }} · CN {{ it.scan.shipment?.tracking_number }}</span>
                    @if (it.scan.reason) { <span class="small warn">{{ it.scan.reason }}</span> }
                  </div>
                  <button type="button" class="rm" [disabled]="working()" (click)="remove(it.key)" [attr.aria-label]="'Remove ' + (it.scan.article?.code || it.scan.order.reference)">Remove</button>
                </li>
              }
            </ul>
          </div>

          <div class="modal-foot sd-foot">
            <span class="muted small sd-count">{{ parcelCount() }} parcel{{ parcelCount() === 1 ? '' : 's' }}@if (items().length !== parcelCount()) { from {{ items().length }} articles }</span>
            <div class="sd-actions">
              <button type="button" class="btn" [disabled]="!printable().length || working()" (click)="printCn.emit(printable())">
                @if (printing()) { <ion-spinner name="crescent" /> } Print CN@if (printable().length) { ({{ printable().length }}) }
              </button>
              <button type="button" class="btn btn-primary" [disabled]="!sheetable().length || working()" (click)="loadsheet.emit(sheetable())">
                @if (sheetBusy()) { <ion-spinner name="crescent" /> } Generate Loadsheet@if (sheetable().length) { ({{ sheetable().length }}) }
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .scan-dispatch { max-width: 640px; display: flex; flex-direction: column; max-height: calc(100vh - 40px); overflow: hidden; }
    .sd-top { padding: 4px 22px 10px; flex: none; }
    .manual { display: flex; gap: 8px; margin-top: 10px; input { flex: 1; min-width: 0; } }
    .notice { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 10px 12px; border-radius: 12px; font-size: 14px; overflow-wrap: anywhere; }
    .dot { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; }
    .notice-ok { background: var(--c-green-soft); .dot { background: var(--c-green); } }
    .notice-notice { background: var(--c-amber-soft); .dot { background: var(--c-amber); } }
    .notice-error { background: var(--c-red-soft); .dot { background: var(--c-red); } }
    .sd-list { flex: 1 1 auto; min-height: 120px; overflow-y: auto; padding: 0 22px 12px; -webkit-overflow-scrolling: touch; border-top: 1px solid var(--c-line-soft); }
    .sd-list-head { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center; padding: 10px 0 6px; background: var(--c-surface); }
    .sd-list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .sd-list li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--c-green); border-radius: 12px; background: var(--c-surface); }
    .sd-list li.skip { border-color: var(--c-amber); }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow-wrap: anywhere; }
    .cn { color: var(--c-ink-2); }
    .warn { color: var(--c-amber); font-weight: 600; }
    .rm { flex: none; min-height: 36px; padding: 0 12px; border: 1px solid var(--c-line); border-radius: 10px; background: var(--c-surface); color: var(--c-red); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .empty { margin: 8px 0; }
    .sd-foot { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 22px; border-top: 1px solid var(--c-line-soft); }
    .sd-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
    @media (max-width: 640px) {
      .sd-backdrop { padding: 0; align-items: stretch; }
      .scan-dispatch { max-width: none; width: 100%; height: 100%; max-height: none; border-radius: 0; }
      .sd-top { padding: 4px 14px 10px; }
      .sd-list { padding: 0 14px 10px; }
      .sd-foot { padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); }
      .sd-actions { width: 100%; .btn { flex: 1 1 0; } }
      .manual input { font-size: 16px; }
    }
  `,
})
export class ScanDispatchComponent {
  private partner = inject(PartnerService);

  readonly open = input(false);
  /** The warehouse page is making the loadsheet / printing the CN. */
  readonly sheetBusy = input(false);
  readonly printing = input(false);
  readonly closed = output<void>();
  /** Shipment ids to put on one loadsheet / whose CNs to print. The warehouse page does the work with its own methods. */
  readonly loadsheet = output<string[]>();
  readonly printCn = output<string[]>();

  readonly items = signal<{ key: string; scan: DispatchScan }[]>([]);
  readonly notice = signal<Notice | null>(null);
  readonly manual = signal('');
  readonly looking = signal(false);

  readonly working = computed(() => this.sheetBusy() || this.printing());
  /** One parcel can have several scanned articles: each parcel is sent once. */
  readonly sheetable = computed(() => [...new Set(this.items().filter((i) => i.scan.can_loadsheet && i.scan.shipment).map((i) => i.scan.shipment!.id))]);
  readonly printable = computed(() => [...new Set(this.items().filter((i) => i.scan.can_print_cn && i.scan.shipment).map((i) => i.scan.shipment!.id))]);
  readonly parcelCount = computed(() => new Set(this.items().map((i) => i.scan.shipment?.id ?? i.scan.order.id)).size);

  private say(tone: Notice['tone'], text: string): void {
    this.notice.set({ tone, text });
  }

  add(raw: string): void {
    const code = raw.trim();
    if (!code || this.looking()) return;
    // the same article twice never lands in the list
    if (this.items().some((i) => i.key === code.toUpperCase())) {
      this.say('notice', `${code} is already scanned.`);
      navigator.vibrate?.([60, 40, 60]);
      return;
    }
    this.looking.set(true);
    this.partner.scanLookupDispatch(code).subscribe({
      next: (scan) => {
        this.looking.set(false);
        const label = scan.article?.code || scan.order.reference;
        const key = label.toUpperCase();
        if (this.items().some((i) => i.key === key)) {
          this.say('notice', `${label} is already scanned.`);
          return;
        }
        // a parcel that is not booked / already dispatched has nothing to put on a loadsheet or print
        if (!scan.can_print_cn) {
          this.say('error', `${label}: ${scan.reason || 'not ready for dispatch.'}`);
          navigator.vibrate?.([80, 60, 80]);
          return;
        }
        this.items.update((l) => [{ key, scan }, ...l]);
        this.say(scan.can_loadsheet ? 'ok' : 'notice', scan.can_loadsheet ? `${label} added · Order ${scan.order.reference}.` : `${label} added for CN only. ${scan.reason}`);
        navigator.vibrate?.(60);
      },
      error: (e) => {
        this.looking.set(false);
        this.say('error', apiErrorMessage(e));
        navigator.vibrate?.([80, 60, 80]);
      },
    });
  }

  remove(key: string): void {
    this.items.update((l) => l.filter((i) => i.key !== key));
  }

  /** The loadsheet was made: what was scanned is processed, the list starts empty again. */
  reset(): void {
    this.items.set([]);
    this.notice.set(null);
  }

  clear(): void {
    this.reset();
  }

  close(): void {
    if (this.working()) return;
    this.closed.emit();
  }
}
