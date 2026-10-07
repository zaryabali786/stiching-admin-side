import { Component, DestroyRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subject, catchError, firstValueFrom, map, merge, of, switchMap, tap } from 'rxjs';
import {
  AdminService,
  INVOICE_CURRENCIES,
  InvoiceBuilderData,
  InvoiceLineKind,
  LINE_KIND_OPTIONS,
  PRICE_CATEGORY_OPTIONS,
  PlatformConfig,
  PriceItem,
  ShippingOption,
} from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe, HumanizePipe, PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

interface EditLine {
  key: number;
  kind: InvoiceLineKind;
  label: string;
  description: string;
  quantity: number;
  customer_amount: number;
  partner_amount: number;
  price_item_id: string | null;
  unit_id: string | null;
  /** Per-unit prices when the line came from the price list: quantity changes recompute the amounts. */
  unitCustomer: number | null;
  unitPartner: number | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Invoice builder for one order: editable charge lines (customer amount + partner payout),
 * price-list and courier pickers, currency / FX, live totals, save → issue → mark paid.
 */
@Component({
  selector: 'app-invoice-builder',
  standalone: true,
  imports: [RouterLink, IonSpinner, PkrPipe, DayPipe, HumanizePipe, EmptyStateComponent, StatusBadgeComponent],
  templateUrl: './invoice-builder.component.html',
  styleUrls: ['./invoice-builder.component.scss'],
})
export class InvoiceBuilderComponent {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private destroyRef = inject(DestroyRef);

  readonly orderId = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly kinds = LINE_KIND_OPTIONS;
  readonly currencies = INVOICE_CURRENCIES;

  readonly data = signal<InvoiceBuilderData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();
  readonly config = signal<PlatformConfig | null>(null);

  readonly lines = signal<EditLine[]>([]);
  readonly currency = signal('PKR');
  readonly fxRate = signal('1');
  readonly notes = signal('');
  readonly dirty = signal(false);
  readonly busy = signal<'save' | 'issue' | 'reopen' | 'paid' | null>(null);
  readonly picker = signal<'price' | 'shipping' | null>(null);
  readonly pickerSearch = signal('');
  readonly pickerQty = signal(1);
  readonly showPayment = signal(false);
  readonly payMethod = signal<'bank_transfer' | 'manual'>('bank_transfer');
  readonly payReference = signal('');
  private nextKey = 1;

  readonly invoice = computed(() => this.data()?.invoice ?? null);
  readonly order = computed(() => this.data()?.order ?? null);
  readonly status = computed(() => this.invoice()?.status ?? 'new');
  readonly canEdit = computed(() => {
    const d = this.data();
    if (!d) return false;
    return d.order.status === 'packed' && (!d.invoice || d.invoice.status === 'draft');
  });
  readonly notPackedReason = computed(() => {
    const d = this.data();
    if (!d || d.invoice || d.order.status === 'packed') return null;
    return `This order is “${d.order.status_label}”. Invoices can only be built once the order is packed.`;
  });

  readonly totals = computed(() => {
    const lines = this.lines();
    const subtotal = round2(lines.filter((l) => l.kind !== 'discount').reduce((a, l) => a + num(l.customer_amount), 0));
    const discount = round2(lines.filter((l) => l.kind === 'discount').reduce((a, l) => a + num(l.customer_amount), 0));
    const total = round2(Math.max(0, subtotal - discount));
    const payout = round2(lines.filter((l) => l.kind !== 'discount').reduce((a, l) => a + num(l.partner_amount), 0));
    const margin = round2(total - payout);
    const fx = this.currency() === 'PKR' ? 1 : num(this.fxRate());
    return {
      subtotal,
      discount,
      total,
      payout,
      margin,
      marginPct: total > 0 ? Math.round((margin / total) * 100) : 0,
      foreign: fx > 0 ? round2(total / fx) : null,
    };
  });

  readonly fxMissing = computed(() => this.currency() !== 'PKR' && !(num(this.fxRate()) > 0));

  readonly priceGroups = computed(() => {
    const items = this.data()?.priceItems || [];
    const q = this.pickerSearch().trim().toLowerCase();
    const filtered = q ? items.filter((p) => `${p.name} ${p.unit}`.toLowerCase().includes(q)) : items;
    return PRICE_CATEGORY_OPTIONS.map((c) => ({ ...c, items: filtered.filter((p) => p.category === c.value) })).filter((g) => g.items.length);
  });

  readonly totalUnits = computed(() => (this.order()?.units || []).reduce((a, u) => a + (u.quantity || 1), 0));

  constructor() {
    merge(toObservable(this.orderId), this.reload$.pipe(map(() => this.orderId())))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((id) =>
          this.admin.getInvoiceBuilder(id).pipe(
            map((d) => ({ d, err: null as unknown })),
            catchError((err) => of({ d: null, err }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ d, err }) => {
        this.loading.set(false);
        if (d) this.applyData(d);
        else this.error.set(apiErrorMessage(err, 'Could not open the invoice builder.'));
      });

    this.admin.getConfig().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (c) => this.config.set(c), error: () => undefined });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.ui.confirmState()) return;
    if (this.picker()) this.picker.set(null);
    else void this.close();
  }

  async close(): Promise<void> {
    if (this.dirty() && this.canEdit()) {
      const ok = await this.ui.confirm({ title: 'Discard unsaved changes?', message: 'Your edits to this invoice have not been saved.', confirmText: 'Discard', danger: true });
      if (!ok) return;
    }
    this.closed.emit();
  }

  retry(): void {
    this.reload$.next();
  }

  // ── Line editing ──

  updateLine(key: number, patch: Partial<EditLine>): void {
    this.lines.update((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    this.dirty.set(true);
  }

  setKind(line: EditLine, kind: InvoiceLineKind): void {
    this.updateLine(line.key, kind === 'discount' ? { kind, partner_amount: 0 } : { kind });
  }

  setQty(line: EditLine, value: string): void {
    const quantity = Math.max(1, Math.round(num(value)) || 1);
    const patch: Partial<EditLine> = { quantity };
    if (line.unitCustomer !== null) patch.customer_amount = round2(line.unitCustomer * quantity);
    if (line.unitPartner !== null && line.kind !== 'discount') patch.partner_amount = round2(line.unitPartner * quantity);
    this.updateLine(line.key, patch);
  }

  setAmount(line: EditLine, field: 'customer_amount' | 'partner_amount', value: string): void {
    const amount = Math.max(0, num(value));
    // A manual amount stops automatic price-list maths for that column
    this.updateLine(line.key, field === 'customer_amount' ? { customer_amount: amount, unitCustomer: null } : { partner_amount: amount, unitPartner: null });
  }

  removeLine(line: EditLine): void {
    this.lines.update((list) => list.filter((l) => l.key !== line.key));
    this.dirty.set(true);
  }

  addCustom(): void {
    this.push({ kind: 'other', label: '', description: '', quantity: 1, customer_amount: 0, partner_amount: 0 });
  }

  addDiscount(): void {
    this.push({ kind: 'discount', label: 'Discount', description: '', quantity: 1, customer_amount: 0, partner_amount: 0 });
  }

  openPicker(kind: 'price' | 'shipping'): void {
    this.pickerSearch.set('');
    this.pickerQty.set(1);
    this.picker.set(this.picker() === kind ? null : kind);
  }

  addPriceItem(item: PriceItem): void {
    const qty = Math.max(1, Math.round(this.pickerQty()) || 1);
    const kind: InvoiceLineKind = item.category === 'accessory' ? 'accessory' : item.category === 'accessory_stitching' ? 'accessory_stitching' : item.category === 'stitching' ? 'stitching' : 'other';
    this.push({
      kind,
      label: item.name,
      description: item.unit || '',
      quantity: qty,
      customer_amount: round2(num(item.customer_price) * qty),
      partner_amount: round2(num(item.partner_cost) * qty),
      price_item_id: item.id,
      unitCustomer: num(item.customer_price),
      unitPartner: num(item.partner_cost),
    });
    this.ui.success(`Added ${item.name}${qty > 1 ? ` × ${qty}` : ''}.`);
  }

  addShipping(opt: ShippingOption): void {
    const weight = this.order()?.weight_kg;
    // One courier per invoice: replace any existing shipping / duties lines
    const hadShipping = this.lines().some((l) => l.kind === 'shipping' || l.kind === 'duties');
    this.lines.update((list) => list.filter((l) => l.kind !== 'shipping' && l.kind !== 'duties'));
    this.push({
      kind: 'shipping',
      label: `${opt.courier} · ${opt.zone}`,
      description: [weight ? `${weight} kg` : null, opt.transit_time].filter(Boolean).join(' · '),
      quantity: 1,
      customer_amount: num(opt.price_pkr),
      partner_amount: 0,
    });
    if (opt.ddp_available && num(opt.ddp_fee) > 0) {
      this.push({ kind: 'duties', label: 'Duties paid (DDP)', description: 'No charges at the door', quantity: 1, customer_amount: num(opt.ddp_fee), partner_amount: 0 });
    }
    this.picker.set(null);
    this.ui.success(hadShipping ? `Shipping replaced with ${opt.courier}.` : `Added ${opt.courier} shipping.`);
  }

  setCurrency(cur: string): void {
    this.currency.set(cur);
    const d = this.data();
    if (cur === 'PKR') this.fxRate.set('1');
    else if (d && cur === d.currency && d.suggestedFxRate) this.fxRate.set(String(d.suggestedFxRate));
    else if (this.invoice()?.currency === cur) this.fxRate.set(String(this.invoice()!.fx_rate));
    else this.fxRate.set('');
    this.dirty.set(true);
  }

  // ── Actions ──

  async saveDraft(): Promise<void> {
    if (await this.save()) this.reload$.next();
  }

  async issue(): Promise<void> {
    const d = this.data();
    if (!d || !this.validate()) return;
    const t = this.totals();
    const ok = await this.ui.confirm({
      title: `Issue invoice for ${d.order.reference}?`,
      message: `The customer is asked to pay ${this.currency()} ${t.foreign?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'} (PKR ${t.total.toLocaleString('en-US')}). The exchange rate is locked and the order moves to Awaiting payment.`,
      confirmText: 'Issue invoice',
    });
    if (!ok) return;
    this.busy.set('issue');
    try {
      const saved = await this.save(true);
      if (!saved) return;
      const res = await firstValueFrom(this.admin.issueInvoice(saved));
      this.ui.success(res.message || 'Invoice issued.');
      this.badges.refresh();
      this.changed.emit();
      this.reload$.next();
    } catch (err) {
      this.ui.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  async reopen(): Promise<void> {
    const inv = this.invoice();
    if (!inv) return;
    const ok = await this.ui.confirm({
      title: `Reopen ${inv.number || 'invoice'} for editing?`,
      message: 'The invoice goes back to draft and the order returns to Packed until you issue it again. The customer cannot pay it meanwhile.',
      confirmText: 'Reopen',
      danger: true,
    });
    if (!ok) return;
    this.busy.set('reopen');
    this.admin.reopenInvoice(inv.id).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.ui.success(res.message || 'Invoice reopened.');
        this.badges.refresh();
        this.changed.emit();
        this.reload$.next();
      },
      error: (err) => {
        this.busy.set(null);
        this.ui.error(err);
      },
    });
  }

  async markPaid(): Promise<void> {
    const inv = this.invoice();
    if (!inv) return;
    const ok = await this.ui.confirm({
      title: `Record payment for ${inv.number}?`,
      message: `${inv.total_pkr.toLocaleString('en-US')} PKR received by ${this.payMethod() === 'bank_transfer' ? 'bank transfer' : 'manual payment'}. The order is released for dispatch and the customer is notified.`,
      confirmText: 'Mark paid',
    });
    if (!ok) return;
    this.busy.set('paid');
    this.admin.markInvoicePaid(inv.id, this.payMethod(), this.payReference().trim()).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.showPayment.set(false);
        this.ui.success(res.message || 'Payment recorded.');
        this.badges.refresh();
        this.changed.emit();
        this.reload$.next();
      },
      error: (err) => {
        this.busy.set(null);
        this.ui.error(err);
      },
    });
  }

  print(): void {
    window.print();
  }

  kindLabel(kind: string): string {
    return LINE_KIND_OPTIONS.find((k) => k.value === kind)?.label || kind;
  }

  // ── Internals ──

  private validate(): boolean {
    const lines = this.lines();
    if (!lines.length) {
      this.ui.error('Add at least one charge.');
      return false;
    }
    const blank = lines.findIndex((l) => !l.label.trim());
    if (blank >= 0) {
      this.ui.error(`Line ${blank + 1}: enter a description for the charge.`);
      return false;
    }
    if (this.fxMissing()) {
      this.ui.error(`Enter the exchange rate (PKR per 1 ${this.currency()}).`);
      return false;
    }
    return true;
  }

  /** Saves the draft; resolves to the invoice id (or null on failure). */
  private async save(silent = false): Promise<string | null> {
    if (!this.validate()) return null;
    if (!silent) this.busy.set('save');
    try {
      const res = await firstValueFrom(
        this.admin.saveInvoiceDraft(this.orderId(), {
          currency: this.currency(),
          fx_rate: this.currency() === 'PKR' ? 1 : num(this.fxRate()),
          notes: this.notes().trim() || null,
          lines: this.lines().map((l) => ({
            kind: l.kind,
            label: l.label.trim(),
            description: l.description.trim() || null,
            quantity: l.quantity,
            customer_amount: round2(num(l.customer_amount)),
            partner_amount: l.kind === 'discount' ? 0 : round2(num(l.partner_amount)),
            price_item_id: l.price_item_id,
            unit_id: l.unit_id,
          })),
        })
      );
      this.dirty.set(false);
      if (!silent) {
        this.ui.success(res.message || 'Draft saved.');
        this.changed.emit();
      }
      return res.data.id;
    } catch (err) {
      this.ui.error(err);
      return null;
    } finally {
      if (!silent) this.busy.set(null);
    }
  }

  private push(line: Partial<EditLine> & Pick<EditLine, 'kind' | 'label'>): void {
    this.lines.update((list) => [...list, this.toEdit(line)]);
    this.dirty.set(true);
  }

  private toEdit(l: Partial<Omit<EditLine, 'description'>> & { description?: string | null }): EditLine {
    return {
      key: this.nextKey++,
      kind: l.kind || 'other',
      label: l.label || '',
      description: l.description || '',
      quantity: Math.max(1, num(l.quantity) || 1),
      customer_amount: num(l.customer_amount),
      partner_amount: num(l.partner_amount),
      price_item_id: l.price_item_id || null,
      unit_id: l.unit_id || null,
      unitCustomer: l.unitCustomer ?? null,
      unitPartner: l.unitPartner ?? null,
    };
  }

  private applyData(d: InvoiceBuilderData): void {
    this.data.set(d);
    const byId = new Map(d.priceItems.map((p) => [p.id, p]));
    const source = d.invoice?.lines?.length ? d.invoice.lines : d.suggestedLines || [];
    this.lines.set(
      source.map((l) => {
        const item = l.price_item_id ? byId.get(l.price_item_id) : undefined;
        const qty = Math.max(1, num(l.quantity) || 1);
        // Keep automatic qty maths only when the saved amounts still match the price list
        const matches = item && round2(num(item.customer_price) * qty) === round2(num(l.customer_amount));
        return this.toEdit({
          ...l,
          unitCustomer: matches ? num(item!.customer_price) : null,
          unitPartner: matches ? num(item!.partner_cost) : null,
        });
      })
    );
    const cur = d.invoice?.currency || d.currency || 'PKR';
    this.currency.set(cur);
    this.fxRate.set(cur === 'PKR' ? '1' : d.invoice?.fx_rate ? String(d.invoice.fx_rate) : d.suggestedFxRate ? String(d.suggestedFxRate) : '');
    this.notes.set(d.invoice?.notes || '');
    this.dirty.set(false);
    this.picker.set(null);
    this.showPayment.set(false);
    this.payReference.set('');
  }
}
