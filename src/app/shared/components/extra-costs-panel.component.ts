import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonSpinner } from '@ionic/angular';
import { ApiService, apiErrorMessage } from '../../core/services/api.service';
import { UiService } from '../../core/services/ui.service';
import { compressImage } from '../../core/utils/image';
import { PkrPipe } from '../pipes';

export interface ExtraCost {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_pkr: number;
  notes: string | null;
  stage: 'cutting' | 'stitching';
  status: 'pending' | 'approved' | 'rejected';
  decision_note: string | null;
  added_by_name: string | null;
  created_at: string;
  bill: { name: string; type: string; url?: string | null } | null;
}

interface Form {
  id: string | null;
  name: string;
  quantity: string;
  unit_price: string;
  notes: string;
  bill: { name: string; dataUrl: string } | null;
  keepBill: boolean;
  billName: string | null;
  key: string;
}

const newKey = (): string => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const BILL_MAX = 8 * 1024 * 1024;

/**
 * Extra materials bought while an article is being cut or stitched, with the supplier's bill. The admin sees them on the invoice
 * screen and decides which to charge. They can be changed or removed here until the admin decides.
 */
@Component({
  selector: 'app-extra-costs-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IonSpinner, PkrPipe],
  template: `
    <section class="card extras" aria-label="Extra items">
      <div class="head">
        <h2 class="card-title">Extra items</h2>
        @if (canAdd() && !form()) { <button type="button" class="btn btn-sm btn-primary" (click)="openNew()">+ Add item</button> }
      </div>
      <p class="muted small">Materials bought for this order while it is cut or stitched (lining, buttons, lace ...). Add the supplier's bill; the admin reviews it and adds the approved cost to the invoice.</p>

      @if (form(); as f) {
        <form class="form" (submit)="$event.preventDefault(); save()">
          <div class="grid">
            <label class="field wide"><span>Item / material *</span>
              <input class="input" maxlength="160" placeholder="e.g. Lining cloth" [ngModel]="f.name" (ngModelChange)="patch({ name: $event })" name="name" /></label>
            <label class="field"><span>Quantity *</span>
              <input class="input" type="number" min="0.01" step="0.01" inputmode="decimal" [ngModel]="f.quantity" (ngModelChange)="patch({ quantity: $event })" name="qty" /></label>
            <label class="field"><span>Price per item (PKR) *</span>
              <input class="input" type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="f.unit_price" (ngModelChange)="patch({ unit_price: $event })" name="price" /></label>
            <div class="field"><span>Total</span><strong class="total">{{ total() | pkr }}</strong></div>
          </div>
          <label class="field"><span>Notes <em class="muted">optional</em></span>
            <textarea class="textarea" rows="2" maxlength="500" [ngModel]="f.notes" (ngModelChange)="patch({ notes: $event })" name="notes"></textarea></label>
          <div class="field">
            <span>Supplier bill <em class="muted">photo or PDF, optional</em></span>
            <div class="bill-row">
              <label class="btn btn-sm" [class.disabled]="reading()">
                @if (reading()) { <ion-spinner name="crescent" /> } {{ f.bill || (f.keepBill && f.billName) ? 'Change bill' : 'Upload bill' }}
                <input type="file" accept="image/*,application/pdf" hidden [disabled]="reading()" (change)="onBill($any($event.target))" />
              </label>
              @if (f.bill) { <span class="small">{{ f.bill.name }}</span> <button type="button" class="link" (click)="patch({ bill: null })">Remove</button> }
              @else if (f.keepBill && f.billName) { <span class="small">{{ f.billName }}</span> <button type="button" class="link" (click)="patch({ keepBill: false })">Remove</button> }
            </div>
          </div>
          @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
          <div class="actions">
            <button type="button" class="btn btn-ghost" [disabled]="saving()" (click)="form.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving() || reading()">
              @if (saving()) { <ion-spinner name="crescent" /> } {{ f.id ? 'Save changes' : 'Add item' }}
            </button>
          </div>
        </form>
      }

      @if (loading()) {
        <span class="skeleton" style="height: 44px"></span>
      } @else if (!items().length) {
        <p class="muted small empty">No extra items yet.</p>
      } @else {
        <ul class="list">
          @for (c of items(); track c.id) {
            <li>
              <div class="main">
                <strong>{{ c.name }}</strong>
                <span class="muted small">{{ c.quantity }} × {{ c.unit_price | pkr }} · added in {{ c.stage }}@if (c.added_by_name) { by {{ c.added_by_name }} }</span>
                @if (c.notes) { <span class="small">{{ c.notes }}</span> }
                @if (c.bill?.url) { <a class="link small" [href]="c.bill!.url" target="_blank" rel="noopener">View bill ({{ c.bill!.name }})</a> }
                @if (c.status === 'rejected' && c.decision_note) { <span class="small bad">Not charged: {{ c.decision_note }}</span> }
              </div>
              <div class="side">
                <strong>{{ c.total_pkr | pkr }}</strong>
                <span class="badge" [class.green]="c.status === 'approved'" [class.red]="c.status === 'rejected'">{{ c.status === 'pending' ? 'Waiting for admin' : c.status === 'approved' ? 'Approved' : 'Rejected' }}</span>
                @if (canAdd() && c.status === 'pending') {
                  <span class="row">
                    <button type="button" class="link" (click)="openEdit(c)">Edit</button>
                    <button type="button" class="link danger" [disabled]="busyId() === c.id" (click)="remove(c)">Remove</button>
                  </span>
                }
              </div>
            </li>
          }
        </ul>
        <p class="sum muted small">Pending and approved items total <b>{{ sum() | pkr }}</b>.</p>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .extras { display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .head h2 { margin: 0; }
    .form { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px dashed var(--c-line-strong, #d8d2c2); border-radius: 12px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .wide { grid-column: 1 / -1; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
    .field em { font-weight: 400; font-style: normal; }
    .total { font-size: 18px; padding-top: 6px; }
    .bill-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .list li { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--c-line, #e6e2d8); }
    .main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
    .row { display: flex; gap: 12px; }
    .link { background: none; border: 0; padding: 0; font: inherit; font-size: 13px; font-weight: 600; color: var(--c-green, #2f7d4f); cursor: pointer; text-decoration: underline; }
    .link.danger, .bad { color: #b3261e; }
    .empty { margin: 0; }
    .sum { margin: 0; text-align: right; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } .list li { flex-direction: column; } .side { align-items: flex-start; } }
  `,
})
export class ExtraCostsPanelComponent implements OnInit {
  private api = inject(ApiService);
  private ui = inject(UiService);

  /** The order the items belong to. */
  readonly orderId = input.required<string>();
  /** Whether this person may add / change items (production permission). */
  readonly canEdit = input(false);
  /** The article's current stage: items can be added only while it is being cut or stitched. */
  readonly stage = input<string | null>(null);

  readonly items = signal<ExtraCost[]>([]);
  readonly loading = signal(true);
  readonly form = signal<Form | null>(null);
  readonly saving = signal(false);
  readonly reading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  readonly canAdd = computed(() => this.canEdit() && (this.stage() === 'cutting' || this.stage() === 'stitching'));
  readonly total = computed(() => {
    const f = this.form();
    return f ? Math.round((Number(f.quantity) || 0) * (Number(f.unit_price) || 0) * 100) / 100 : 0;
  });
  readonly sum = computed(() => this.items().filter((c) => c.status !== 'rejected').reduce((a, c) => a + Number(c.total_pkr), 0));

  ngOnInit(): void {
    this.load();
  }

  private base(): string {
    return `/partner/production/orders/${this.orderId()}/extras`;
  }

  load(): void {
    this.api.get<ExtraCost[]>(this.base()).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openNew(): void {
    this.error.set(null);
    this.form.set({ id: null, name: '', quantity: '1', unit_price: '', notes: '', bill: null, keepBill: false, billName: null, key: newKey() });
  }

  openEdit(c: ExtraCost): void {
    this.error.set(null);
    this.form.set({ id: c.id, name: c.name, quantity: String(c.quantity), unit_price: String(c.unit_price), notes: c.notes ?? '', bill: null, keepBill: !!c.bill, billName: c.bill?.name ?? null, key: newKey() });
  }

  patch(p: Partial<Form>): void {
    this.error.set(null);
    this.form.update((f) => (f ? { ...f, ...p } : f));
  }

  async onBill(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > BILL_MAX) {
      this.error.set('The bill must be smaller than 8 MB.');
      return;
    }
    this.reading.set(true);
    try {
      if (file.type === 'application/pdf') {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error('Could not read the file.'));
          r.readAsDataURL(file);
        });
        this.patch({ bill: { name: file.name, dataUrl } });
      } else {
        this.patch({ bill: await compressImage(file) });
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not read this file.');
    } finally {
      this.reading.set(false);
    }
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    const qty = Number(f.quantity);
    const price = Number(f.unit_price);
    const problem = !String(f.name ?? '').trim() ? 'Enter the item or material name.' : !(qty > 0) ? 'Enter a quantity above 0.' : String(f.unit_price ?? '').trim() === '' || !(price >= 0) ? 'Enter the price per item.' : null;
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.saving.set(true);
    const body = {
      name: String(f.name).trim(), quantity: qty, unit_price: price, notes: String(f.notes ?? '').trim(),
      ...(f.bill ? { bill: f.bill } : {}),
      ...(f.id && !f.bill && !f.keepBill ? { remove_bill: true } : {}),
      ...(f.id ? {} : { client_key: f.key }),
    };
    const req$ = f.id ? this.api.patch<ExtraCost>(`/partner/production/extras/${f.id}`, body) : this.api.post<ExtraCost>(this.base(), body);
    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.form.set(null);
        this.ui.success(f.id ? 'Item updated.' : 'Item added. The admin will see it on the invoice.');
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiErrorMessage(e));
      },
    });
  }

  async remove(c: ExtraCost): Promise<void> {
    const ok = await this.ui.confirm({ title: `Remove “${c.name}”?`, message: 'The item and its bill are deleted.', confirmText: 'Remove', danger: true });
    if (!ok) return;
    this.busyId.set(c.id);
    this.api.delete(`/partner/production/extras/${c.id}`).subscribe({
      next: () => {
        this.busyId.set(null);
        this.load();
      },
      error: (e) => {
        this.busyId.set(null);
        this.ui.error(e);
      },
    });
  }
}
