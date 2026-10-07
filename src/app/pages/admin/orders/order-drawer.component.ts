import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subject, catchError, map, merge, of, switchMap, tap } from 'rxjs';
import { AdminOrderDetail, AdminService, ORDER_STATUS_OPTIONS, OrderCard, OrderUnit, OrderUpdate, PartnerOption, SelectedArticle, UnitApproval, canMoveOrderStatus } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { UiService } from '../../../core/services/ui.service';
import { OrderStatus } from '../../../core/models/api.models';
import { ApprovalChipComponent } from '../../../shared/components/approval-chip.component';
import { VoiceNotePlayComponent } from '../../../shared/components/voice-note-field/voice-note-play.component';
import { chartTitle, groupMeasurements } from '../../../core/utils/measurements';
import { DayPipe, HumanizePipe, PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

const STATUS_LABEL = Object.fromEntries(ORDER_STATUS_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>;

/**
 * Right-side drawer with everything about one order. Loads by reference (`?ref=SA-1001`).
 */
@Component({
  selector: 'app-order-drawer',
  standalone: true,
  imports: [DecimalPipe, RouterLink, IonSpinner, DayPipe, HumanizePipe, PkrPipe, EmptyStateComponent, StatusBadgeComponent, VoiceNotePlayComponent, ApprovalChipComponent],
  templateUrl: './order-drawer.component.html',
  styleUrls: ['./order-drawer.component.scss'],
})
export class OrderDrawerComponent {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private destroyRef = inject(DestroyRef);

  readonly reference = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly statusOptions = ORDER_STATUS_OPTIONS;
  readonly order = signal<AdminOrderDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private retry$ = new Subject<void>();

  // Edit state
  readonly notesDraft = signal('');
  readonly dueDraft = signal('');
  readonly priorityDraft = signal<'normal' | 'rush'>('normal');
  readonly statusDraft = signal<OrderStatus | ''>('');
  readonly statusNote = signal('');
  readonly notifyCustomer = signal(true);
  readonly busy = signal<'notes' | 'schedule' | 'status' | 'issue' | null>(null);
  readonly resolvingUnit = signal<string | null>(null);

  // Assign to partner (only while production has not started)
  readonly partners = signal<PartnerOption[]>([]);
  readonly partnerDraft = signal('');
  readonly assigningPartner = signal(false);
  private partnersLoaded = false;

  readonly notesDirty = computed(() => (this.order()?.admin_notes || '') !== this.notesDraft());
  readonly scheduleDirty = computed(() => {
    const o = this.order();
    return !!o && ((o.due_date || '') !== this.dueDraft() || o.priority !== this.priorityDraft());
  });
  readonly invoiceLines = computed(() => this.order()?.invoice?.lines || []);
  readonly issueUnits = computed(() => (this.order()?.units || []).filter((u) => u.status === 'issue').length);

  // ── Presentational state ──
  private readonly adminBox = viewChild<ElementRef<HTMLElement>>('adminBox');

  readonly overdue = computed(() => {
    const o = this.order();
    if (!o?.due_date || ['shipped', 'delivered', 'cancelled'].includes(o.status)) return false;
    return o.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
  });

  /** Packed and no issued invoice yet: the next step is building the invoice. */
  readonly canInvoice = computed(() => {
    const o = this.order();
    return !!o && o.status === 'packed' && (!o.invoice || o.invoice.status === 'draft');
  });

  /** Production has not started: the order can still move to another partner. The server has the final say. */
  readonly canAssignPartner = computed(() => {
    const o = this.order();
    return !!o && ['submitted', 'received'].includes(o.status) && o.cards.every((c) => c.stage === 'to_assign');
  });
  /** Active partners other than the current one. */
  readonly partnerChoices = computed(() => this.partners().filter((p) => p.status === 'active' && p.id !== this.order()?.partner?.id));

  /** What needs attention on this order, most urgent first (shown at the top of the drawer). */
  readonly alerts = computed(() => {
    const o = this.order();
    if (!o) return [];
    const out: { tag: string; text: string; tone: 'bad' | 'attn' }[] = [];
    const n = this.issueUnits();
    if (n) out.push({ tag: 'Issue', tone: 'bad', text: `${n} ${n === 1 ? 'article has' : 'articles have'} an issue — review and resolve under Articles.` });
    else if (o.has_issue) out.push({ tag: 'Issue', tone: 'bad', text: 'This order is flagged for follow-up. Clear the flag under Admin controls when it is sorted.' });
    if (this.overdue()) out.push({ tag: 'Late', tone: 'bad', text: 'Past its due date. Check with the partner or move the due date.' });
    if (o.change_request) out.push({ tag: 'Change', tone: 'attn', text: 'The customer asked for a change — see Order details.' });
    if (this.canInvoice()) out.push({ tag: 'Invoice', tone: 'attn', text: o.invoice ? 'A draft invoice is waiting to be issued.' : 'Packed at the partner — build and issue the invoice.' });
    return out;
  });

  constructor() {
    merge(toObservable(this.reference), this.retry$.pipe(map(() => this.reference())))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((ref) =>
          this.admin.getOrderByRef(ref).pipe(
            map((o) => ({ o, err: null as unknown })),
            catchError((err) => of({ o: null, err }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ o, err }) => {
        this.loading.set(false);
        if (o) this.setOrder(o);
        else {
          this.order.set(null);
          this.error.set(apiErrorMessage(err, 'Could not load this order.'));
        }
      });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState()) this.close();
  }

  close(): void {
    this.closed.emit();
  }

  retry(): void {
    this.retry$.next();
  }

  focusAdmin(): void {
    const el = this.adminBox()?.nativeElement;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }

  /** Badge tone of an article: its display status (production stage, then the order's own progress). Shipped / delivered = green. */
  cardTone(c: OrderCard): string {
    switch (c.display_status ?? c.stage) {
      case 'shipped':
      case 'delivered':
        return 'green';
      case 'packed':
      case 'customer_approval':
        return 'amber';
      default:
        return 'blue'; // in production, invoiced, awaiting payment, paid, dispatching
    }
  }

  /** Greyed out in the status picker: the API will not move a paid / shipped order backwards. */
  statusDisabled(target: OrderStatus): boolean {
    const o = this.order();
    return !!o && !canMoveOrderStatus(o.status, target);
  }

  statusText(status: string): string {
    return STATUS_LABEL[status] || status.replace(/_/g, ' ');
  }

  designEntries(unit: OrderUnit): { key: string; value: string }[] {
    return Object.entries(unit.design || {})
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([key, value]) => ({ key, value: String(value) }));
  }

  readonly chartTitle = chartTitle;

  measureGroups(unit: OrderUnit) {
    return groupMeasurements(unit.size_chart?.measurements);
  }

  /** The piece's own customer approval: from the unit, else from its production card. */
  approvalOf(unit: OrderUnit): UnitApproval | null {
    if (unit.approval) return unit.approval;
    const card = this.order()?.cards.find((c) => c.unit_id === unit.id);
    if (!card?.approval_status) return null;
    return { status: card.approval_status, photos: card.approval_photos, change_request: card.change_request, change_request_audio: card.change_request_audio };
  }

  hasPrice(a: SelectedArticle): boolean {
    return (a.customer_price !== null && a.customer_price !== undefined) || (a.partner_cost !== null && a.partner_cost !== undefined);
  }

  hasInternalPrice(unit: OrderUnit): boolean {
    return !!unit.selected_articles?.some((a) => this.hasPrice(a));
  }

  isImage(m: { url: string; type?: string }): boolean {
    return !m.type || m.type.startsWith('image') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m.url);
  }

  saveNotes(): void {
    this.patch({ admin_notes: this.notesDraft() }, 'notes', 'Admin notes saved.');
  }

  saveSchedule(): void {
    const o = this.order();
    if (!o) return;
    const patch: OrderUpdate = {};
    if ((o.due_date || '') !== this.dueDraft()) patch.due_date = this.dueDraft() || null;
    if (o.priority !== this.priorityDraft()) patch.priority = this.priorityDraft();
    this.patch(patch, 'schedule', 'Due date and priority updated.');
  }

  async changeStatus(): Promise<void> {
    const o = this.order();
    const status = this.statusDraft();
    if (!o || !status || status === o.status) return;
    const ok = await this.ui.confirm({
      title: `Change status to “${this.statusText(status)}”?`,
      message: this.notifyCustomer()
        ? 'The customer will be notified and the change is added to the order timeline.'
        : 'The change is added to the order timeline. The customer will not be notified.',
      confirmText: 'Change status',
      danger: status === 'cancelled',
    });
    if (!ok) return;
    this.patch(
      { status, note: this.statusNote().trim() || undefined, notifyCustomer: this.notifyCustomer() },
      'status',
      'Status updated.',
      () => this.statusNote.set('')
    );
  }

  async toggleIssueFlag(): Promise<void> {
    const o = this.order();
    if (!o) return;
    this.patch({ has_issue: !o.has_issue }, 'issue', o.has_issue ? 'Issue flag cleared.' : 'Order flagged with an issue.');
  }

  async resolveIssue(unit: OrderUnit): Promise<void> {
    const o = this.order();
    if (!o) return;
    // UiService.confirm resolves to the entered text (or null) when `input` is set
    const note = (await this.ui.confirm({
      title: `Resolve issue on “${unit.unit_title}”?`,
      message: 'The unit is marked received and can go into production.',
      confirmText: 'Resolve issue',
      input: { label: 'Note (optional)', placeholder: 'e.g. Customer sent the missing dupatta', multiline: true },
    })) as unknown as string | null;
    if (note === null) return;
    this.resolvingUnit.set(unit.id);
    this.admin.resolveUnitIssue(o.id, unit.id, note || undefined).subscribe({
      next: (res) => {
        this.ui.success(res.message || 'Issue resolved.');
        this.badges.refresh();
        this.changed.emit();
        this.admin.getOrder(o.id).subscribe({
          next: (fresh) => {
            this.resolvingUnit.set(null);
            this.setOrder(fresh);
          },
          error: () => this.resolvingUnit.set(null),
        });
      },
      error: (err) => {
        this.resolvingUnit.set(null);
        this.ui.error(err);
      },
    });
  }

  private patch(body: OrderUpdate, kind: 'notes' | 'schedule' | 'status' | 'issue', fallback: string, after?: () => void): void {
    const o = this.order();
    if (!o || this.busy()) return;
    this.busy.set(kind);
    this.admin.updateOrder(o.id, body).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.setOrder(res.data);
        this.ui.success(res.message && res.message !== 'Success' ? res.message : fallback);
        after?.();
        this.changed.emit();
        if (kind === 'status' || kind === 'issue') this.badges.refresh();
      },
      error: (err) => {
        this.busy.set(null);
        this.ui.error(err); // shows the server's message, e.g. a 409 "cannot move a shipped order back"
        if (kind === 'status') this.refreshOrder(o.id);
      },
    });
  }

  /** Load the order again so the drawer shows what the server really has. */
  private refreshOrder(id: string): void {
    this.admin.getOrder(id).subscribe({ next: (fresh) => this.setOrder(fresh), error: () => undefined });
  }

  private loadPartners(): void {
    if (this.partnersLoaded) return;
    this.partnersLoaded = true;
    this.admin.listPartnerOptions().subscribe({
      next: (list) => this.partners.set(list),
      error: () => (this.partnersLoaded = false),
    });
  }

  async assignPartner(): Promise<void> {
    const o = this.order();
    const target = this.partners().find((p) => p.id === this.partnerDraft());
    if (!o || !target || this.assigningPartner()) return;
    const ok = await this.ui.confirm({
      title: `Move ${o.reference} to ${target.name}?`,
      message: o.partner ? `It leaves ${o.partner.name}. This only works while production has not started.` : 'This only works while production has not started.',
      confirmText: 'Assign to partner',
    });
    if (!ok) return;
    this.assigningPartner.set(true);
    this.admin.assignOrderPartner(o.id, target.id).subscribe({
      next: (res) => {
        this.ui.success(res.message && res.message !== 'Success' ? res.message : `Order moved to ${target.name}.`);
        this.partnerDraft.set('');
        this.changed.emit();
        this.admin.getOrder(o.id).subscribe({
          next: (fresh) => {
            this.assigningPartner.set(false);
            this.setOrder(fresh);
          },
          error: () => this.assigningPartner.set(false),
        });
      },
      error: (err) => {
        this.assigningPartner.set(false);
        this.ui.error(err); // the server's reason, e.g. production already started
        this.refreshOrder(o.id);
      },
    });
  }

  private setOrder(o: AdminOrderDetail): void {
    this.order.set(o);
    this.notesDraft.set(o.admin_notes || '');
    this.dueDraft.set(o.due_date ? o.due_date.slice(0, 10) : '');
    this.priorityDraft.set(o.priority === 'rush' ? 'rush' : 'normal');
    this.statusDraft.set(o.status);
    if (['submitted', 'received'].includes(o.status)) this.loadPartners();
  }
}
