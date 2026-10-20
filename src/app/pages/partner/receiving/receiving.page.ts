import { CanDirective } from '../../../shared/can.directive';
import { VoiceNote, voicePayload } from '../../../core/models/chat.models';
import { VoiceNoteFieldComponent } from '../../../shared/components/voice-note-field/voice-note-field.component';
import { VoiceNotePlayComponent } from '../../../shared/components/voice-note-field/voice-note-play.component';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { CourierRef, CourierSelectComponent } from '../../../shared/components/courier-select/courier-select.component';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { Observable, Subject, firstValueFrom, forkJoin, catchError, debounceTime, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { LanguageService } from '../../../core/services/language.service';
import {
  ElsewhereOrder,
  ISSUE_TYPES,
  IssueType,
  PartnerService,
  ReceivingMeta,
  ReceivingOrder,
  ReceivingTab,
  ReceivingUnit,
  ReturnShipmentInfo,
  UnmatchedParcel,
  UploadFile,
  filesToUploads,
} from '../../../core/services/partner.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe, TimeAgoPipe } from '../../../shared/pipes';
import { CodPaymentPanelComponent } from '../../../shared/components/cod-payment-panel/cod-payment-panel.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { QrCodeComponent } from '../../../shared/components/qr-code.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

const TABS: { value: ReceivingTab; en: string; ur: string }[] = [
  { value: 'expected', en: 'Expected', ur: 'متوقع' },
  { value: 'issues', en: 'Issues', ur: 'مسائل' },
  { value: 'return_requested', en: 'Return requested', ur: 'واپسی کی درخواست' },
  { value: 'ready_return', en: 'Ready for return', ur: 'واپسی کے لیے تیار' },
  { value: 'handed_over', en: 'Handed over to courier', ur: 'کوریئر کے حوالے' },
  { value: 'returns', en: 'Returns', ur: 'واپس شدہ' },
  { value: 'hold', en: 'On hold', ur: 'ہولڈ' },
  { value: 'recent', en: 'Recently received', ur: 'حال ہی میں وصول' },
];

const MAX_MEDIA = 4;

interface RcvUnit {
  unit: ReceivingUnit;
  media: UploadFile[];
  /** Something is wrong with this article (missing, damaged ...): it is reported instead of received. */
  problem: boolean;
  issueType: IssueType;
  note: string;
  /** Weight of the article in kg, as typed. */
  weight: string;
}

interface IssueForm {
  order: ReceivingOrder;
  unit: ReceivingUnit;
  issueType: IssueType;
  note: string;
  audio: VoiceNote | null;
  media: UploadFile[];
}

@Component({
  selector: 'app-partner-receiving',
  standalone: true,
  imports: [RouterLink, CanDirective, CodPaymentPanelComponent, CourierSelectComponent, FormsModule, IonSpinner, DayPipe, TimeAgoPipe, QrCodeComponent, EmptyStateComponent, PaginationComponent, SearchInputComponent, StatusBadgeComponent, VoiceNoteFieldComponent, VoiceNotePlayComponent],
  templateUrl: './receiving.page.html',
  styleUrls: ['./receiving.page.scss'],
})
export class PartnerReceivingPage implements OnInit {
  readonly lang = inject(LanguageService);
  private partner = inject(PartnerService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private socket = inject(ChatSocketService);

  readonly tabs = TABS;
  readonly issueTypes = ISSUE_TYPES;
  readonly maxMedia = MAX_MEDIA;

  // List state (mirrors the URL)
  readonly tab = signal<ReceivingTab>('expected');
  readonly search = signal('');
  readonly page = signal(1);

  readonly orders = signal<ReceivingOrder[]>([]);
  readonly meta = signal<(PageMeta & ReceivingMeta) | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();
  private silent = false;

  /** "Suggested team" banner on the Expected tab. */
  readonly suggestion = computed(() => {
    const s = this.meta()?.suggestion;
    return this.tab() === 'expected' && s?.master ? { master: s.master, tailor: s.tailor } : null;
  });

  // Unmatched parcels
  readonly unmatched = signal<UnmatchedParcel[]>([]);
  readonly unmatchedTotal = signal(0);
  readonly unmatchedLoading = signal(true);
  readonly unmatchedError = signal<string | null>(null);
  private unmatchedReload$ = new Subject<void>();

  // Actions
  readonly busy = signal<Set<string>>(new Set());

  // Issue modal
  readonly issue = signal<IssueForm | null>(null);
  readonly issueSaving = signal(false);
  readonly voiceBusy = signal(false);
  readonly mediaReading = signal(false);
  readonly issueTouched = signal(false);

  // A parcel that reached the wrong partner
  readonly elsewhere = signal<ElsewhereOrder[]>([]);
  readonly forwarding = signal<string | null>(null);

  /** Nothing matched the typed code here: see whether it belongs to another partner's order. */
  private lookElsewhere(text: string): void {
    if (text.trim().length < 3) {
      this.elsewhere.set([]);
      return;
    }
    this.partner.findElsewhere(text.trim()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => this.elsewhere.set(rows),
      error: () => this.elsewhere.set([]),
    });
  }

  async forward(o: ElsewhereOrder): Promise<void> {
    if (this.forwarding()) return;
    const target = o.partner?.name ?? 'the right partner';
    const ok = await this.ui.confirm({
      title: `Send this parcel to ${target}?`,
      message: `Order ${o.reference} was placed for ${target}. Send the parcel on to them. ${target}, the admin and the customer are told, and ${target} receives it when it arrives.`,
      confirmText: 'I am sending it',
    });
    if (!ok) return;
    this.forwarding.set(o.id);
    this.partner.forwardParcel(o.id).subscribe({
      next: (res) => {
        this.forwarding.set(null);
        this.ui.success(res.message || 'Noted.');
        this.elsewhere.update((list) => list.filter((x) => x.id !== o.id));
      },
      error: (err) => {
        this.forwarding.set(null);
        this.ui.error(err);
      },
    });
  }

  partnerLine(p: NonNullable<ElsewhereOrder['partner']>): string {
    return [p.receiving_name || p.name, p.receiving_address, p.receiving_city || p.city].filter(Boolean).join(', ');
  }

  orderedFor(o: ReceivingOrder): string {
    const p = o.partner;
    return p ? [p.receiving_name || p.name, p.receiving_address, p.receiving_city].filter(Boolean).join(', ') : '';
  }

  // Unmatched modal
  readonly unmatchedForm = signal<{ label_text: string; brand: string; tracking_number: string; notes: string } | null>(null);
  readonly unmatchedSaving = signal(false);

  ngOnInit(): void {
    // an article was approved, held, returned or its corrected copy was approved: the groups follow without a refresh
    this.socket.on('unit:update').pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    combineLatest([this.route.queryParamMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        map(([q]) => {
          const t = q.get('tab') as ReceivingTab;
          return {
            tab: TABS.some((x) => x.value === t) ? t : ('expected' as ReceivingTab),
            search: (q.get('search') || '').trim(),
            page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
          };
        }),
        tap((s) => {
          this.tab.set(s.tab);
          this.search.set(s.search);
          this.page.set(s.page);
          this.error.set(null);
          if (!this.silent) this.loading.set(true);
          this.silent = false;
        }),
        switchMap((s) =>
          this.partner.receiving({ tab: s.tab, search: s.search, page: s.page, limit: 10 }).pipe(
            map((r) => ({ r, err: null as string | null })),
            catchError((e) => of({ r: null, err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ r, err }) => {
        this.loading.set(false);
        if (err || !r) {
          this.error.set(err);
          return;
        }
        // The last item on a page was handled → step back a page.
        if (!r.items.length && r.meta.page > 1) {
          this.go({ page: r.meta.totalPages > 1 ? Math.min(r.meta.page - 1, r.meta.totalPages) : null });
          return;
        }
        this.orders.set(r.items);
        this.meta.set(r.meta);
        this.lookElsewhere(r.items.length === 0 ? this.search() : '');
      });

    this.unmatchedReload$
      .pipe(
        startWith(undefined),
        tap(() => this.unmatchedError.set(null)),
        switchMap(() =>
          this.partner.unmatched({ limit: 5 }).pipe(
            map((r) => ({ r, err: null as string | null })),
            catchError((e) => of({ r: null, err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ r, err }) => {
        this.unmatchedLoading.set(false);
        if (err || !r) this.unmatchedError.set(err);
        else {
          this.unmatched.set(r.items);
          this.unmatchedTotal.set(r.meta.total);
        }
      });
  }

  // ───────────── Navigation / filters ─────────────

  private go(params: Record<string, string | number | null>): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setTab(tab: ReceivingTab): void {
    if (tab !== this.tab()) this.go({ tab: tab === 'expected' ? null : tab, page: null });
  }

  onSearch(text: string): void {
    this.go({ search: text || null, page: null });
  }

  goToPage(page: number): void {
    this.go({ page: page > 1 ? page : null });
  }

  retry(): void {
    this.reload$.next();
  }

  private refresh(): void {
    this.silent = true;
    this.reload$.next();
    this.badges.refresh();
  }

  count(tab: ReceivingTab): number {
    return this.meta()?.counts?.[tab] ?? 0;
  }

  // ───────────── Helpers ─────────────

  isBusy(key: string): boolean {
    return this.busy().has(key);
  }

  private setBusy(key: string, on: boolean): void {
    this.busy.update((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private run(key: string, req: Observable<{ message: string }>, after?: () => void): void {
    if (this.isBusy(key)) return;
    this.setBusy(key, true);
    req.subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Saved.');
        after?.();
        this.refresh();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  pendingCount(order: ReceivingOrder): number {
    return order.units.filter((u) => u.status === 'pending').length;
  }

  receivedCount(order: ReceivingOrder): number {
    return order.units.filter((u) => u.status === 'received').length;
  }

  issueCount(order: ReceivingOrder): number {
    return order.units.filter((u) => u.status === 'issue').length;
  }

  issueLabel(type: IssueType | null): string {
    const t = ISSUE_TYPES.find((x) => x.value === type);
    return t ? this.lang.t(t.en, t.ur) : 'Issue';
  }

  unitTone(status: ReceivingUnit['status']): string {
    return status === 'received' ? 'green' : status === 'issue' ? 'red' : '';
  }

  unitLabel(status: ReceivingUnit['status']): string {
    return status === 'received' ? this.lang.t('Received', 'وصول') : status === 'issue' ? this.lang.t('Issue', 'مسئلہ') : this.lang.t('Pending', 'باقی');
  }

  destination(o: ReceivingOrder): string {
    return [o.destination_city, o.destination_country].filter(Boolean).join(', ');
  }

  // ───────────── Receive parcel (one popup per order) ─────────────

  /** Bought direct from a website: a draft made from the customer's email. */
  isWebsite(o: ReceivingOrder): boolean {
    return o.import_source === 'email';
  }

  sourceLabel(o: ReceivingOrder): string {
    const s = o.order_source ?? (o.import_source === 'email' ? 'email' : 'customer');
    return s === 'website' ? 'Website' : s === 'email' ? 'Email' : 'Customer';
  }

  /** A rejected article still has to be posted back: nothing new can be received for this order yet. */
  returnWaiting(o: ReceivingOrder): boolean {
    return o.units.some((u) => u.review_status === 'rejected' && u.return_status === 'requested');
  }

  sentBackCount(o: ReceivingOrder): number {
    return o.units.filter((u) => u.return_status === 'sent_back').length;
  }

  returnWhere(to: 'brand' | 'customer' | null | undefined): string {
    return to === 'brand' ? 'the brand' : 'the customer';
  }

  isVideo(file: UploadFile): boolean {
    return file.dataUrl.startsWith('data:video');
  }

  /** The popup: photos / video of the whole parcel, then of each article that is still to be received. */
  readonly rcv = signal<{ order: ReceivingOrder; parcelMedia: UploadFile[]; units: RcvUnit[] } | null>(null);
  readonly rcvSaving = signal(false);
  readonly rcvTouched = signal(false);
  readonly problemTypes = ISSUE_TYPES;

  // Mark a rejected article as sent back to the customer
  readonly sendBack = signal<{ order: ReceivingOrder; unit: ReceivingUnit; courier: CourierRef | null; tracking: string; whole: boolean } | null>(null);
  // A hold: the corrected article arrived ("Receive Corrected Article")
  readonly corrected = signal<{ order: ReceivingOrder; unit: ReceivingUnit; note: string } | null>(null);
  readonly correctedSaving = signal(false);

  openCorrected(order: ReceivingOrder, unit: ReceivingUnit): void {
    this.corrected.set({ order, unit, note: '' });
  }

  confirmCorrected(): void {
    const f = this.corrected();
    if (!f || this.correctedSaving()) return;
    this.correctedSaving.set(true);
    this.partner.receiveCorrected(f.unit.id, { note: f.note.trim() || undefined }).subscribe({
      next: (res) => {
        this.correctedSaving.set(false);
        this.corrected.set(null);
        this.ui.success(res.message || 'Corrected article received.');
        this.refresh();
      },
      error: (e) => {
        this.correctedSaving.set(false);
        this.ui.error(e);
      },
    });
  }

  /** The Receive parcel button only belongs to the normal order: hold articles have their own button, returns have none. */
  canReceiveParcel(o: ReceivingOrder): boolean {
    return (!o.group || o.group === 'main') && !this.returnWaiting(o);
  }

  // ───────── return courier workflow ─────────
  /** Book the CN the courier gave for a returned article. */
  readonly book = signal<{ order: ReceivingOrder; unit: ReceivingUnit; courier: CourierRef | null; cn: string; manual: boolean } | null>(null);
  /** Couriers with an API connection (PostEx) and whether the server has it set up. */
  readonly apiCouriers = signal<{ name: string; configured: boolean; ok: boolean | null; message: string | null }[]>([]);
  readonly bookSaving = signal(false);
  readonly track = signal<{ order: ReceivingOrder; unit: ReceivingUnit; status: 'in_transit' | 'delivered'; note: string } | null>(null);
  readonly trackSaving = signal(false);
  /** Parcels ticked for the loadsheet (Ready for return tab). */
  readonly picked = signal<ReadonlySet<string>>(new Set());
  readonly sheetBusy = signal(false);

  readonly routing = signal<string | null>(null);

  // Weight of a single article, edited in the list (to add a missing weight or correct one)
  readonly weightEdit = signal<{ id: string; value: string } | null>(null);
  readonly weightSaving = signal(false);

  editWeight(u: ReceivingUnit): void {
    this.weightEdit.set({ id: u.id, value: u.weight_kg ? String(u.weight_kg) : '' });
  }

  setWeightText(value: string): void {
    this.weightEdit.update((w) => (w ? { ...w, value } : w));
  }

  saveWeight(u: ReceivingUnit): void {
    const w = this.weightEdit();
    if (!w || this.weightSaving()) return;
    const kg = Number(w.value);
    if (w.value.trim() === '' || !(kg > 0 && kg < 50)) {
      this.ui.error('Enter the weight in kg, more than 0 and less than 50 (for example 0.65).');
      return;
    }
    this.weightSaving.set(true);
    this.partner.setUnitWeight(u.id, kg).subscribe({
      next: (res) => {
        this.weightSaving.set(false);
        this.weightEdit.set(null);
        this.ui.success(res.message || 'Weight saved.');
        this.refresh();
      },
      error: (e) => {
        this.weightSaving.set(false);
        this.ui.error(e);
      },
    });
  }

  /** The weight is still editable until the order is invoiced. */
  canEditWeight(o: ReceivingOrder): boolean {
    return !['awaiting_payment', 'paid', 'partner_dispatch', 'at_admin_warehouse', 'shipped', 'delivered', 'cancelled'].includes(o.status);
  }

  /** Send to Admin or Return Directly to Customer: the article leaves Receiving and continues in the Warehouse. */
  async routeReturn(unit: ReceivingUnit, destination: 'customer' | 'admin'): Promise<void> {
    if (this.routing()) return;
    const ok = await this.ui.confirm({
      title: destination === 'admin' ? 'Send to Admin?' : 'Return directly to the customer?',
      message: destination === 'admin'
        ? `${unit.unit_title} is added to your transfer to the admin warehouse. The admin sends it on to the customer. No invoice is made.`
        : `${unit.unit_title} moves to the Warehouse (Waiting for invoice). The customer is invoiced for the return shipping, pays, and then you book the courier and dispatch it like any other parcel.`,
      confirmText: destination === 'admin' ? 'Send to Admin' : 'Send to Warehouse',
    });
    if (!ok) return;
    this.routing.set(unit.id);
    this.partner.routeReturn(unit.id, destination).subscribe({
      next: (res) => {
        this.routing.set(null);
        this.ui.success(res.message || 'Done.');
        this.refresh();
      },
      error: (e) => {
        this.routing.set(null);
        this.ui.error(e);
      },
    });
  }

  openBook(order: ReceivingOrder, unit: ReceivingUnit): void {
    this.book.set({ order, unit, courier: null, cn: '', manual: false });
    if (!this.apiCouriers().length) this.partner.returnApiCouriers().subscribe({ next: (l) => this.apiCouriers.set(l), error: () => undefined });
  }

  confirmBook(): void {
    const f = this.book();
    if (!f || this.bookSaving()) return;
    if (!f.courier) {
      this.ui.error('Choose the courier.');
      return;
    }
    const viaApi = this.apiBookable(f) && !f.manual;
    if (!viaApi && f.cn.trim().length < 4) {
      this.ui.error('Enter the CN number the courier gave.');
      return;
    }
    this.bookSaving.set(true);
    this.partner.bookReturnCn(f.unit.id, { courier_id: f.courier.id, cn_number: viaApi ? undefined : f.cn.trim(), manual: !viaApi && this.apiBookable(f) ? true : undefined }).subscribe({
      next: (res) => {
        this.bookSaving.set(false);
        this.book.set(null);
        this.ui.success(res.message || 'CN booked.');
        this.refresh();
      },
      error: (e) => {
        this.bookSaving.set(false);
        this.ui.error(e);
      },
    });
  }

  /** The chosen courier can be booked through its API and the server is connected to it. */
  apiBookable(f: { courier: CourierRef | null }): boolean {
    const c = f.courier?.name?.trim().toLowerCase();
    return !!c && this.apiCouriers().some((a) => a.configured && a.name.toLowerCase() === c);
  }

  apiMissing(f: { courier: CourierRef | null }): { message: string | null } | null {
    const c = f.courier?.name?.trim().toLowerCase();
    const a = c ? this.apiCouriers().find((x) => x.name.toLowerCase() === c) : undefined;
    return a && !a.configured ? { message: a.message } : null;
  }

  /** Read PostEx's tracking of a return parcel now (the server also checks it every few minutes). */
  refreshTracking(unit: ReceivingUnit): void {
    const sh = unit.return_shipment;
    if (!sh) return;
    this.partner.refreshReturnTracking(sh.id).subscribe({
      next: (res) => {
        this.ui.success(res.message || 'Tracking updated.');
        this.refresh();
      },
      error: (e) => this.ui.error(e),
    });
  }

  cancelBooking(unit: ReceivingUnit): void {
    this.partner.cancelReturnBooking(unit.id).subscribe({
      next: (res) => {
        this.ui.success(res.message || 'Booking cancelled.');
        this.refresh();
      },
      error: (e) => this.ui.error(e),
    });
  }

  openTrack(order: ReceivingOrder, unit: ReceivingUnit, status: 'in_transit' | 'delivered'): void {
    this.track.set({ order, unit, status, note: '' });
  }

  confirmTrack(): void {
    const f = this.track();
    const sh = f?.unit.return_shipment;
    if (!f || !sh || this.trackSaving()) return;
    this.trackSaving.set(true);
    this.partner.updateReturnTracking(sh.id, { status: f.status, note: f.note.trim() || undefined }).subscribe({
      next: (res) => {
        this.trackSaving.set(false);
        this.track.set(null);
        this.ui.success(res.message || 'Tracking updated.');
        this.refresh();
      },
      error: (e) => {
        this.trackSaving.set(false);
        this.ui.error(e);
      },
    });
  }

  /** Every booked parcel on the page, in order. */
  bookedShipments(): { shipmentId: string; courier: string; label: string }[] {
    return this.orders().flatMap((o) =>
      o.units.filter((u) => u.return_shipment?.status === 'booked').map((u) => ({ shipmentId: u.return_shipment!.id, courier: u.return_shipment!.courier_name, label: u.code ?? u.unit_title }))
    );
  }

  /** The couriers that have booked parcels on this page (for "select all of one courier"). */
  bookedCouriers(): string[] {
    return [...new Set(this.bookedShipments().map((b) => b.courier))];
  }

  isPicked(id: string): boolean {
    return this.picked().has(id);
  }

  /** One loadsheet is for one courier: once a parcel is ticked, the other couriers' parcels cannot be. */
  canPick(sh: ReturnShipmentInfo): boolean {
    const first = this.bookedShipments().find((b) => this.picked().has(b.shipmentId));
    return !first || first.courier === sh.courier_name;
  }

  togglePick(id: string): void {
    this.picked.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  pickAllOfCourier(courier: string): void {
    this.picked.set(new Set(this.bookedShipments().filter((b) => b.courier === courier).map((b) => b.shipmentId)));
  }

  clearPicked(): void {
    this.picked.set(new Set());
  }

  /**
   * Make the loadsheet, download it, and only when the file really was saved tell the server the parcels are with the courier.
   * A failure at any step leaves the parcels in Ready for return.
   */
  downloadLoadsheet(): void {
    const ids = [...this.picked()];
    if (!ids.length || this.sheetBusy()) return;
    this.sheetBusy.set(true);
    this.partner.createLoadsheet(ids).subscribe({
      next: ({ data: sheet }) => {
        this.partner.downloadLoadsheet(sheet.id).subscribe({
          next: (blob) => {
            if (!blob || !blob.size) {
              this.sheetBusy.set(false);
              this.ui.error('The loadsheet file was empty. Nothing was handed over.');
              return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `loadsheet-${sheet.number}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            this.partner.confirmLoadsheetHandover(sheet.id).subscribe({
              next: (res) => {
                this.sheetBusy.set(false);
                this.picked.set(new Set());
                this.ui.success(res.message || `${sheet.number} downloaded. The parcels are handed over.`);
                this.refresh();
              },
              error: (e) => {
                this.sheetBusy.set(false);
                this.ui.error(e);
              },
            });
          },
          error: (e) => {
            this.sheetBusy.set(false);
            this.ui.error(e);
          },
        });
      },
      error: (e) => {
        this.sheetBusy.set(false);
        this.ui.error(e);
      },
    });
  }

  readonly sendBackSaving = signal(false);

  openSendBack(order: ReceivingOrder, unit: ReceivingUnit): void {
    this.sendBack.set({ order, unit, courier: null, tracking: '', whole: false });
  }

  patchSendBack(patch: Partial<{ courier: CourierRef | null; tracking: string; whole: boolean }>): void {
    this.sendBack.update((f) => (f ? { ...f, ...patch } : f));
  }

  /** The articles of this parcel that wait to be sent back (the one opened first), for “send the whole parcel”. */
  sendBackUnits(f: { order: ReceivingOrder; unit: ReceivingUnit }): ReceivingUnit[] {
    return f.order.units.filter((u) => u.review_status === 'rejected' && u.return_status === 'requested' && u.return_to === f.unit.return_to);
  }

  confirmSendBack(): void {
    const f = this.sendBack();
    if (!f || this.sendBackSaving()) return;
    this.sendBackSaving.set(true);
    const body = { courier: f.courier?.name || undefined, tracking: f.tracking.trim() || undefined };
    const units = f.whole ? this.sendBackUnits(f) : [f.unit];
    forkJoin(units.map((u) => this.partner.sendArticleBack(u.id, body))).subscribe({
      next: (res) => {
        this.sendBackSaving.set(false);
        this.sendBack.set(null);
        this.ui.success(units.length > 1 ? `${units.length} articles marked as sent back.` : res[0]?.message || 'Marked as sent back.');
        this.refresh();
      },
      error: (e) => {
        this.sendBackSaving.set(false);
        this.ui.error(e);
      },
    });
  }

  rcvProblems = computed(() => this.rcv()?.units.filter((u) => u.problem).length ?? 0);

  openReceive(order: ReceivingOrder): void {
    this.rcvTouched.set(false);
    this.rcv.set({
      order,
      parcelMedia: [],
      units: order.units.filter((u) => u.status !== 'received').map((unit) => ({ unit, media: [], problem: false, issueType: unit.issue_type || 'piece_missing', note: '', weight: unit.weight_kg ? String(unit.weight_kg) : '' })),
    });
  }

  closeReceive(): void {
    if (!this.rcvSaving() && !this.mediaReading()) this.rcv.set(null);
  }

  patchRcvUnit(index: number, patch: Partial<RcvUnit>): void {
    this.rcv.update((f) => (f ? { ...f, units: f.units.map((u, i) => (i === index ? { ...u, ...patch } : u)) } : f));
  }

  /** `index` = an article's position in the popup, or -1 for the whole parcel. */
  async onRcvMedia(index: number, input: HTMLInputElement): Promise<void> {
    const f = this.rcv();
    const files = input.files;
    if (!f || !files?.length) return;
    const current = index < 0 ? f.parcelMedia : f.units[index].media;
    const room = MAX_MEDIA - current.length;
    if (room <= 0) {
      this.ui.error(`You can add up to ${MAX_MEDIA} photos or videos here.`);
      input.value = '';
      return;
    }
    this.mediaReading.set(true);
    try {
      const uploads = await filesToUploads(Array.from(files).slice(0, room), { allowVideo: true });
      if (index < 0) this.rcv.update((x) => (x ? { ...x, parcelMedia: [...x.parcelMedia, ...uploads].slice(0, MAX_MEDIA) } : x));
      else this.rcv.update((x) => (x ? { ...x, units: x.units.map((u, i) => (i === index ? { ...u, media: [...u.media, ...uploads].slice(0, MAX_MEDIA) } : u)) } : x));
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.mediaReading.set(false);
      input.value = '';
    }
  }

  removeRcvMedia(index: number, mediaIndex: number): void {
    if (index < 0) this.rcv.update((x) => (x ? { ...x, parcelMedia: x.parcelMedia.filter((_, i) => i !== mediaIndex) } : x));
    else this.rcv.update((x) => (x ? { ...x, units: x.units.map((u, i) => (i === index ? { ...u, media: u.media.filter((_, j) => j !== mediaIndex) } : u)) } : x));
  }

  async confirmReceive(): Promise<void> {
    const f = this.rcv();
    if (!f || this.rcvSaving() || this.mediaReading()) return;
    this.rcvTouched.set(true);
    if (f.units.some((u) => u.problem && !u.note.trim())) {
      this.ui.error('Write what is wrong with the article you marked as a problem.');
      return;
    }
    const typed = (u: RcvUnit): number | null => (u.weight.trim() === '' ? null : Number(u.weight));
    const badWeight = f.units.find((u) => (typed(u) !== null && !(typed(u)! > 0 && typed(u)! < 50)) || (!u.problem && typed(u) === null));
    if (badWeight) {
      this.ui.error(`Enter the weight in kg (more than 0, less than 50) of ${badWeight.unit.unit_title}.`);
      return;
    }
    this.rcvSaving.set(true);
    try {
      if (f.parcelMedia.length) await firstValueFrom(this.partner.addParcelMedia(f.order.id, f.parcelMedia));
      for (const u of f.units) {
        if (u.problem) {
          await firstValueFrom(this.partner.reportIssue(u.unit.id, { issue_type: u.issueType, note: u.note.trim(), media: u.media.length ? u.media : undefined, ...(typed(u) ? { weight_kg: typed(u)! } : {}) }));
        } else {
          await firstValueFrom(this.partner.receiveUnit(u.unit.id, u.media, typed(u)));
        }
      }
      const problems = f.units.filter((u) => u.problem).length;
      this.rcv.set(null);
      this.ui.success(problems ? `Parcel saved. ${problems} article${problems === 1 ? '' : 's'} reported with a problem.` : 'Parcel received.');
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.rcvSaving.set(false);
      this.refresh();
    }
  }

  // ───────────── Unmatched parcels ─────────────

  openUnmatched(): void {
    this.unmatchedForm.set({ label_text: '', brand: '', tracking_number: '', notes: '' });
  }

  closeUnmatched(): void {
    if (!this.unmatchedSaving()) this.unmatchedForm.set(null);
  }

  patchUnmatched(key: 'label_text' | 'brand' | 'tracking_number' | 'notes', value: string): void {
    this.unmatchedForm.update((f) => (f ? { ...f, [key]: value } : f));
  }

  submitUnmatched(): void {
    const f = this.unmatchedForm();
    if (!f) return;
    if (!f.label_text.trim() && !f.tracking_number.trim()) {
      this.ui.error('Enter what is written on the label or the tracking number.');
      return;
    }
    this.unmatchedSaving.set(true);
    this.partner
      .logUnmatched({
        label_text: f.label_text.trim() || undefined,
        brand: f.brand.trim() || undefined,
        tracking_number: f.tracking_number.trim() || undefined,
        notes: f.notes.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.unmatchedSaving.set(false);
          this.unmatchedForm.set(null);
          this.ui.success(res.message || 'Parcel logged.');
          this.unmatchedReload$.next();
        },
        error: (e) => {
          this.unmatchedSaving.set(false);
          this.ui.error(e);
        },
      });
  }

  retryUnmatched(): void {
    this.unmatchedLoading.set(true);
    this.unmatchedReload$.next();
  }
}
