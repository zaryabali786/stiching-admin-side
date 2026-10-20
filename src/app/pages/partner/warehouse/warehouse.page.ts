import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { AuthService } from '../../../core/services/auth.service';
import { CourierRef, CourierSelectComponent } from '../../../shared/components/courier-select/courier-select.component';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subject, firstValueFrom, debounceTime, catchError, combineLatest, forkJoin, map, of, startWith, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { LanguageService } from '../../../core/services/language.service';
import { CatalogueService } from '../../../core/services/catalogue.service';
import { BulkBookResult, DispatchRoute, DispatchShipment, PartnerService, Transfer, WarehouseMeta, WarehouseOrder, WarehouseTab } from '../../../core/services/partner.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe, HumanizePipe } from '../../../shared/pipes';
import { ScanDispatchComponent } from '../../../shared/components/scan-dispatch/scan-dispatch.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

const TABS: { value: WarehouseTab; en: string; ur: string }[] = [
  { value: 'to_invoice', en: 'Waiting for invoice', ur: 'انوائس کا انتظار' },
  { value: 'awaiting_payment', en: 'Awaiting payment', ur: 'ادائیگی کا انتظار' },
  { value: 'paid', en: 'Paid · book courier', ur: 'ادا شدہ · کوریئر بک کریں' },
  { value: 'ready_dispatch', en: 'Ready for dispatch', ur: 'روانگی کے لیے تیار' },
  { value: 'dispatched', en: 'Dispatched', ur: 'روانہ' },
  { value: 'delivered', en: 'Delivered', ur: 'ڈیلیور شدہ' },
  { value: 'failed_delivery', en: 'Failed delivery · return to partner', ur: 'ڈیلیوری ناکام · واپسی' },
];

const DOMESTIC = ['pakistan', 'pk'];

@Component({
  selector: 'app-partner-warehouse',
  standalone: true,
  imports: [CourierSelectComponent, ScanDispatchComponent, FormsModule, IonSpinner, DayPipe, HumanizePipe, EmptyStateComponent, PaginationComponent, SearchInputComponent, StatusBadgeComponent],
  templateUrl: './warehouse.page.html',
  styleUrls: ['./warehouse.page.scss'],
})
export class PartnerWarehousePage implements OnInit {
  readonly lang = inject(LanguageService);
  private auth = inject(AuthService);
  /** May this person change things here? View-only people see the data but no working buttons (the server re-checks every request). */
  /** Any change in the Warehouse; the buttons below each need their own action. */
  readonly canEdit = computed(() => this.auth.canAny('warehouse.book', 'warehouse.loadsheet', 'warehouse.tracking', 'warehouse.transfer'));
  readonly canBook = computed(() => this.auth.can('warehouse.book'));
  readonly canLoadsheet = computed(() => this.auth.can('warehouse.loadsheet'));
  readonly canTrack = computed(() => this.auth.can('warehouse.tracking'));
  readonly canTransfer = computed(() => this.auth.can('warehouse.transfer'));
  private partner = inject(PartnerService);
  private ui = inject(UiService);
  private catalogueApi = inject(CatalogueService);
  private badges = inject(BadgeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private socket = inject(ChatSocketService);

  readonly tabs = TABS;
  readonly tab = signal<WarehouseTab>('paid');
  readonly search = signal('');
  readonly orders = signal<WarehouseOrder[]>([]);
  readonly meta = signal<(PageMeta & WarehouseMeta) | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();
  private silent = false;

  readonly busy = signal<Set<string>>(new Set());

  // Inline weight editing
  readonly weightEdit = signal<{ id: string; value: number | null } | null>(null);

  // Paid tab: route chooser
  readonly selectedId = signal<string | null>(null);
  readonly routeChoice = signal<DispatchRoute>('admin_warehouse');
  readonly selected = computed(() => this.orders().find((o) => o.id === this.selectedId()) ?? null);

  // Bulk booking (Paid tab): tick orders, then Bulk action
  readonly bulkSel = signal<ReadonlySet<string>>(new Set());
  readonly bulkMenuOpen = signal(false);
  readonly bulkDlg = signal<{ mode: 'api' | 'manual'; courierName: string | null; courier: CourierRef | null; route: DispatchRoute; results: BulkBookResult['results'] | null } | null>(null);
  readonly bulkBusy = signal(false);
  /** The paid orders of this page that can still be booked (no booking yet). */
  readonly bulkable = computed(() => (this.tab() === 'paid' ? this.orders().filter((o) => !o.shipment || o.shipment.status === 'needs_label') : []));
  readonly allBulkSelected = computed(() => this.bulkable().length > 0 && this.bulkable().every((o) => this.bulkSel().has(o.id)));
  /** Cn typed for parcels that were booked by hand without one, by shipment id. */
  readonly cnDraft = signal<Record<string, string>>({});

  // Ship modal
  readonly shipForm = signal<{ order: WarehouseOrder; courier: CourierRef | null; tracking: string; manual: boolean } | null>(null);
  /** Couriers with an API connection (PostEx), and whether the server has it set up. */
  readonly apiCouriers = signal<{ name: string; configured: boolean; ok: boolean | null; message: string | null }[]>([]);
  readonly shipSaving = signal(false);

  // Transfers
  readonly transfers = signal<Transfer[]>([]);
  readonly transfersLoading = signal(true);
  readonly transfersError = signal<string | null>(null);
  private transfersReload$ = new Subject<void>();
  readonly openTransfer = computed(() => this.transfers().find((t) => t.status === 'open') ?? null);

  ngOnInit(): void {
    this.partner.apiCouriers().subscribe({ next: (list) => this.apiCouriers.set(list), error: () => undefined });
    // a parcel moved (booked, downloaded, handed over, delivered, failed): the tabs follow without a refresh
    this.socket.on('shipment:update').pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    combineLatest([this.route.queryParamMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        map(([q]) => {
          const t = q.get('tab') as WarehouseTab;
          return {
            tab: TABS.some((x) => x.value === t) ? t : ('paid' as WarehouseTab),
            search: (q.get('search') || '').trim(),
            page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
          };
        }),
        tap((s) => {
          this.tab.set(s.tab);
          this.search.set(s.search);
          this.error.set(null);
          if (!this.silent) this.loading.set(true);
          this.silent = false;
        }),
        switchMap((s) =>
          this.partner.warehouse({ tab: s.tab, search: s.search, page: s.page, limit: 10 }).pipe(
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
        if (!r.items.length && r.meta.page > 1) {
          this.go({ page: r.meta.page - 1 > 1 ? r.meta.page - 1 : null });
          return;
        }
        this.orders.set(r.items);
        this.meta.set(r.meta);
        this.bulkSel.update((sel) => new Set([...sel].filter((id) => r.items.some((o) => o.id === id))));
        this.bulkMenuOpen.set(false);
        this.picked.update((p) => new Set([...p].filter((id) => r.items.some((o) => o.shipment?.id === id))));
        this.weightEdit.set(null);
        // Keep the route card on a visible order.
        if (this.tab() === 'paid') {
          const keep = r.items.find((o) => o.id === this.selectedId());
          this.select(keep ?? r.items[0] ?? null);
        } else {
          this.selectedId.set(null);
        }
      });

    this.transfersReload$
      .pipe(
        startWith(undefined),
        tap(() => this.transfersError.set(null)),
        switchMap(() =>
          forkJoin([this.partner.transfers({ status: 'open', limit: 10 }), this.partner.transfers({ status: 'in_transit', limit: 10 })]).pipe(
            map(([a, b]) => ({ list: [...a.items, ...b.items], err: null as string | null })),
            catchError((e) => of({ list: [] as Transfer[], err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ list, err }) => {
        this.transfersLoading.set(false);
        if (err) this.transfersError.set(err);
        else this.transfers.set(list);
      });
  }

  // ───────────── Filters ─────────────

  private go(params: Record<string, string | number | null>): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setTab(tab: WarehouseTab): void {
    if (tab !== this.tab()) this.go({ tab: tab === 'paid' ? null : tab, page: null });
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

  retryTransfers(): void {
    this.transfersLoading.set(true);
    this.transfersReload$.next();
  }

  private refresh(alsoTransfers = false): void {
    this.silent = true;
    this.reload$.next();
    if (alsoTransfers) this.transfersReload$.next();
    this.badges.refresh();
  }

  count(tab: WarehouseTab): number {
    return this.meta()?.counts?.[tab] ?? 0;
  }

  // ───────────── Helpers ─────────────

  isBusy(key: string): boolean {
    return this.busy().has(key);
  }

  private setBusy(key: string, on: boolean): void {
    this.busy.update((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }

  destination(o: { destination_city: string | null; destination_country: string | null }): string {
    return [o.destination_city, o.destination_country].filter(Boolean).join(', ') || '—';
  }

  isInternational(o: WarehouseOrder): boolean {
    return !!o.destination_country && !DOMESTIC.includes(o.destination_country.trim().toLowerCase());
  }

  transferWeight(t: Transfer): number {
    return Math.round(t.orders.reduce((a, o) => a + (Number(o.weight_kg) || 0), 0) * 100) / 100;
  }

  canEditWeight(o: WarehouseOrder): boolean {
    return this.canBook() && ['packed', 'invoice_issued', 'awaiting_payment', 'paid', 'partner_dispatch'].includes(o.status);
  }

  // ───────────── Weight ─────────────

  editWeight(o: WarehouseOrder): void {
    this.weightEdit.set({ id: o.id, value: o.weight_kg });
  }

  setWeightValue(v: number | null): void {
    this.weightEdit.update((w) => (w ? { ...w, value: v } : w));
  }

  cancelWeight(): void {
    this.weightEdit.set(null);
  }

  saveWeight(o: WarehouseOrder): void {
    const w = this.weightEdit();
    if (!w || w.id !== o.id) return;
    const kg = Number(w.value);
    if (!(kg > 0 && kg < 50)) {
      this.ui.error('Enter a weight between 0 and 50 kg.');
      return;
    }
    if (kg === Number(o.weight_kg)) {
      this.weightEdit.set(null);
      return;
    }
    const key = `w:${o.id}`;
    this.setBusy(key, true);
    this.partner.setWeight(o.id, kg).subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.weightEdit.set(null);
        this.orders.update((list) => list.map((x) => (x.id === o.id ? { ...x, weight_kg: res.data?.weight_kg ?? kg } : x)));
        this.ui.success(res.message || 'Weight saved.');
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  // ───────────── Route ─────────────

  select(o: WarehouseOrder | null): void {
    this.selectedId.set(o?.id ?? null);
    if (o) this.routeChoice.set(this.isInternational(o) ? 'admin_warehouse' : 'direct_dispatch');
  }

  onRowClick(o: WarehouseOrder): void {
    if (this.tab() === 'paid') {
      if (this.canBook() && !o.shipment) this.select(o);
      return;
    }
    this.detailId.set(o.id);
  }

  // ───────────── Details drawer + courier status ─────────────

  readonly detailId = signal<string | null>(null);
  readonly detail = computed(() => this.orders().find((o) => o.id === this.detailId()) ?? null);
  /** Tabs that show the courier's status of a parcel (and nothing else about its progress). */
  courierTab(): boolean {
    return ['dispatched', 'delivered', 'failed_delivery'].includes(this.tab());
  }

  courierStatus(s: DispatchShipment): string {
    const map: Record<string, string> = {
      handed_to_courier: 'Dispatched', in_transit: 'In transit', delivered: 'Delivered', failed_delivery: 'Attempt failed',
      returning_to_partner: 'Returning to us', returned_to_partner: 'Received back',
    };
    return map[s.status] ?? this.shipLabel(s);
  }

  /** A courier whose tracking comes through its API (its status is read from the courier, not typed). */
  isApiCourier(s: DispatchShipment | null | undefined): boolean {
    const c = (s?.courier ?? '').trim().toLowerCase();
    return !!c && this.apiCouriers().some((a) => a.name.toLowerCase() === c);
  }

  confirmRoute(): void {
    const o = this.selected();
    if (!o) return;
    // direct dispatch starts with booking the courier: the parcel is routed only once the CN is saved
    if (this.routeChoice() === 'direct_dispatch') {
      this.openShip(o);
      return;
    }
    const key = `r:${o.id}`;
    if (this.isBusy(key)) return;
    this.setBusy(key, true);
    this.partner.setRoute(o.id, this.routeChoice()).subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Route saved.');
        this.selectedId.set(null);
        this.refresh(true);
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  // ───────────── Bulk booking ─────────────

  toggleBulk(id: string): void {
    this.bulkSel.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  toggleAllBulk(): void {
    this.bulkSel.set(this.allBulkSelected() ? new Set() : new Set(this.bulkable().map((o) => o.id)));
  }

  clearBulk(): void {
    this.bulkSel.set(new Set());
    this.bulkMenuOpen.set(false);
  }

  toggleBulkMenu(): void {
    if (!this.apiCouriers().length) this.partner.apiCouriers().subscribe({ next: (list) => this.apiCouriers.set(list), error: () => undefined });
    this.bulkMenuOpen.update((v) => !v);
  }

  openBulk(mode: 'api' | 'manual', courierName: string | null = null): void {
    this.bulkMenuOpen.set(false);
    if (!this.bulkSel().size) return;
    this.bulkDlg.set({ mode, courierName, courier: null, route: 'direct_dispatch', results: null });
  }

  patchBulk(patch: { courier?: CourierRef | null; route?: DispatchRoute }): void {
    this.bulkDlg.update((d) => (d ? { ...d, ...patch } : d));
  }

  closeBulk(): void {
    if (this.bulkBusy()) return;
    this.bulkDlg.set(null);
  }

  /** The bulk action button is ready: the dialog needs a courier for a manual booking that goes directly to the customer. */
  bulkReady(d: { mode: 'api' | 'manual'; courier: CourierRef | null; route: DispatchRoute }): boolean {
    return d.route === 'admin_warehouse' || d.mode === 'api' || !!d.courier;
  }

  confirmBulk(): void {
    const d = this.bulkDlg();
    const ids = [...this.bulkSel()];
    if (!d || !ids.length || this.bulkBusy() || !this.bulkReady(d)) return;
    this.bulkBusy.set(true);
    const body = d.route === 'admin_warehouse'
      ? { order_ids: ids, route: d.route }
      : d.mode === 'api'
        ? { order_ids: ids, route: d.route, mode: 'api' as const, courier: d.courierName ?? '' }
        : { order_ids: ids, route: d.route, mode: 'manual' as const, courier_id: d.courier!.id };
    this.partner.bulkBook(body).subscribe({
      next: (res) => {
        this.bulkBusy.set(false);
        this.bulkDlg.update((x) => (x ? { ...x, results: res.data.results } : x));
        // only the orders that failed stay ticked, so they can be tried again
        const failed = new Set(res.data.results.filter((r) => !r.ok).map((r) => r.order_id));
        this.bulkSel.set(failed);
        if (res.data.failed) this.ui.error(res.message);
        else this.ui.success(res.message);
        this.refresh(d.route === 'admin_warehouse');
      },
      error: (e) => {
        this.bulkBusy.set(false);
        this.ui.error(e);
      },
    });
  }

  // ───────────── CN added later (manual bookings) ─────────────

  needsCn(o: WarehouseOrder): boolean {
    return o.shipment?.status === 'booked' && !o.shipment.tracking_number;
  }

  setCnDraft(shipmentId: string, value: string): void {
    this.cnDraft.update((m) => ({ ...m, [shipmentId]: value }));
  }

  saveCn(o: WarehouseOrder): void {
    const sh = o.shipment;
    const cn = (this.cnDraft()[sh?.id ?? ''] ?? '').trim();
    if (!sh || cn.length < 4) {
      this.ui.error('Enter the CN number the courier gave for this parcel.');
      return;
    }
    const key = `cn:${o.id}`;
    this.setBusy(key, true);
    this.partner.addDispatchCn(sh.id, cn).subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.cnDraft.update((m) => {
          const { [sh.id]: _gone, ...rest } = m;
          return rest;
        });
        this.ui.success(res.message || 'CN saved.');
        this.refresh();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  // ───────────── Direct dispatch: mark shipped ─────────────

  openShip(o: WarehouseOrder): void {
    this.shipForm.set({ order: o, courier: null, tracking: o.shipment?.tracking_number || '', manual: false });
    if (!this.apiCouriers().length) this.partner.apiCouriers().subscribe({ next: (list) => this.apiCouriers.set(list), error: () => undefined });
    this.preselectCourier(o);
  }

  /** First time the form opens: pick the courier that was chosen in the invoice's shipping line (the partner can still change it). */
  private preselectCourier(o: WarehouseOrder): void {
    const line = o.invoice?.lines?.find((l) => l.kind === 'shipping');
    const name = line?.label.split(' · ')[0].trim();
    if (!name) return;
    this.catalogueApi.listLookup('couriers', { status: 'active', search: name, page: 1, limit: 10 }).subscribe({
      next: ({ items }) => {
        const match = items.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
        const f = this.shipForm();
        // only if the same order is still open and nobody has chosen a courier meanwhile
        if (match && f && f.order.id === o.id && !f.courier) this.patchShip({ courier: { id: match.id, name: match.name } });
      },
      error: () => undefined,
    });
  }

  patchShip(patch: { courier?: CourierRef | null; tracking?: string; manual?: boolean }): void {
    this.shipForm.update((f) => (f ? { ...f, ...patch } : f));
  }

  /** The chosen courier can be booked through its API and the server is connected to it. */
  apiBookable(f: { courier: CourierRef | null }): boolean {
    const c = f.courier?.name?.trim().toLowerCase();
    return !!c && this.apiCouriers().some((a) => a.configured && a.name.toLowerCase() === c);
  }

  /** The chosen courier has an API connection in the code but it is not set up on the server. */
  apiMissing(f: { courier: CourierRef | null }): { message: string | null } | null {
    const c = f.courier?.name?.trim().toLowerCase();
    const a = c ? this.apiCouriers().find((x) => x.name.toLowerCase() === c) : undefined;
    return a && !a.configured ? { message: a.message } : null;
  }

  closeShip(): void {
    if (!this.shipSaving()) this.shipForm.set(null);
  }

  submitShip(): void {
    const f = this.shipForm();
    if (!f) return;
    const viaApi = this.apiBookable(f) && !f.manual;
    if (!f.courier || (!viaApi && !f.tracking.trim())) {
      this.ui.error(viaApi ? 'Choose the courier.' : 'Choose the courier and enter the CN number.');
      return;
    }
    this.shipSaving.set(true);
    this.partner.bookDispatch(f.order.id, { courier_id: f.courier.id, cn_number: viaApi ? undefined : f.tracking.trim(), manual: viaApi ? undefined : this.apiBookable(f) ? true : undefined }).subscribe({
      next: (res) => {
        this.shipSaving.set(false);
        this.shipForm.set(null);
        this.selectedId.set(null);
        this.ui.success(res.message || 'CN saved. The parcel is ready for dispatch.');
        this.refresh();
      },
      error: (e) => {
        this.shipSaving.set(false);
        this.ui.error(e);
      },
    });
  }

  // ───────────── Ready for dispatch · loadsheet · handover ─────────────

  /** Parcels ticked for the loadsheet. */
  readonly picked = signal<ReadonlySet<string>>(new Set());
  readonly sheetBusy = signal(false);
  /** A loadsheet that was downloaded and waits for the courier: the handover is confirmed here. */
  readonly pendingHandover = signal<{ id: string; number: string; count: number } | null>(null);
  readonly handoverBusy = signal(false);
  readonly track = signal<{ order: WarehouseOrder; status: 'in_transit' | 'delivered' | 'failed_delivery' | 'returning_to_partner'; note: string; reason: string } | null>(null);
  readonly trackSaving = signal(false);

  /** Parcels of this page whose CN is booked or whose loadsheet was downloaded. */
  readyShipments(): { id: string; courier: string; status: string; sheet: string | null; cn: boolean }[] {
    return this.orders().filter((o) => o.shipment && ['booked', 'labelled'].includes(o.shipment.status)).map((o) => ({ id: o.shipment!.id, courier: o.shipment!.courier ?? '', status: o.shipment!.status, sheet: o.shipment!.loadsheet_id ?? null, cn: !!o.shipment!.tracking_number }));
  }

  readyCouriers(): string[] {
    return [...new Set(this.readyShipments().map((s) => s.courier))];
  }

  isPicked(id: string): boolean {
    return this.picked().has(id);
  }

  /** A parcel can be ticked once it has its CN (a manual booking waits for it). One courier per loadsheet is checked when the loadsheet is made. */
  canPick(sh: DispatchShipment): boolean {
    return !!sh.tracking_number;
  }

  readonly readyMenuOpen = signal(false);

  /** The parcels of this page that can be ticked. */
  readonly pickable = computed(() => {
    if (this.tab() === 'ready_dispatch') return this.orders().filter((o) => o.shipment && ['booked', 'labelled'].includes(o.shipment.status) && !!o.shipment.tracking_number);
    if (this.tab() === 'dispatched') return this.orders().filter((o) => !!o.shipment);
    return [];
  });
  readonly allPicked = computed(() => this.pickable().length > 0 && this.pickable().every((o) => this.picked().has(o.shipment!.id)));

  toggleAllPicked(): void {
    this.picked.set(this.allPicked() ? new Set() : new Set(this.pickable().map((o) => o.shipment!.id)));
  }

  /** Bulk action > Cancel booking: every ticked parcel that is booked and not on a downloaded loadsheet. */
  async bulkCancelBookings(): Promise<void> {
    this.readyMenuOpen.set(false);
    const targets = this.orders().filter((o) => o.shipment && this.picked().has(o.shipment.id));
    const cancellable = targets.filter((o) => o.shipment!.status === 'booked');
    if (!cancellable.length) {
      this.ui.error('None of the ticked parcels can be cancelled: their loadsheet was already downloaded.');
      return;
    }
    const ok = await this.ui.confirm({
      title: `Cancel ${cancellable.length} booking${cancellable.length === 1 ? '' : 's'}?`,
      message: `${targets.length - cancellable.length ? `${targets.length - cancellable.length} ticked parcel(s) already have a downloaded loadsheet and are skipped. ` : ''}A booking made through a courier's API is cancelled at the courier too. The parcels go back to the Paid tab.`,
      confirmText: 'Cancel bookings',
    });
    if (!ok) return;
    this.sheetBusy.set(true);
    let done = 0;
    const failed: string[] = [];
    const next = (i: number): void => {
      if (i >= cancellable.length) {
        this.sheetBusy.set(false);
        this.picked.set(new Set());
        if (failed.length) this.ui.error(`${done} cancelled. Could not cancel: ${failed.join(', ')}.`);
        else this.ui.success(`${done} booking${done === 1 ? '' : 's'} cancelled.`);
        this.refresh();
        return;
      }
      this.partner.cancelDispatchBooking(cancellable[i].id).subscribe({
        next: () => {
          done++;
          next(i + 1);
        },
        error: () => {
          failed.push(cancellable[i].reference);
          next(i + 1);
        },
      });
    };
    next(0);
  }

  readonly listBusy = signal(false);

  /** Bulk action > Download order list: a printable page with every order's QR code and its articles (code, name, quantity, brand, QR). */
  downloadOrderList(): void {
    this.bulkMenuOpen.set(false);
    this.readyMenuOpen.set(false);
    const ids = this.tab() === 'paid' ? [...this.bulkSel()] : this.pickedOrders().map((o) => o.id);
    if (!ids.length || this.listBusy()) return;
    this.listBusy.set(true);
    this.partner.orderList(ids).subscribe({
      next: (blob) => {
        this.listBusy.set(false);
        if (!blob || !blob.size) {
          this.ui.error('The order list was empty.');
          return;
        }
        const url = URL.createObjectURL(new Blob([blob], { type: 'text/html' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `order-list-${new Date().toISOString().slice(0, 10)}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        this.ui.success(`Order list downloaded (${ids.length} order${ids.length === 1 ? '' : 's'}). Open it to print or save as PDF.`);
      },
      error: (e) => {
        this.listBusy.set(false);
        const body = (e as { error?: unknown })?.error;
        if (body instanceof Blob) {
          body.text().then((t) => {
            try { this.ui.error(JSON.parse(t).message || 'Could not make the order list.'); } catch { this.ui.error('Could not make the order list.'); }
          });
        } else this.ui.error(e);
      },
    });
  }

  /** The ticked parcels of this page, with their orders. */
  private pickedOrders(): WarehouseOrder[] {
    return this.orders().filter((o) => o.shipment && this.picked().has(o.shipment.id));
  }

  /** Bulk action > Refresh courier tracking: only parcels of a courier with an API (PostEx); manual couriers are skipped. */
  async bulkRefreshTracking(): Promise<void> {
    this.readyMenuOpen.set(false);
    const api = this.pickedOrders().filter((o) => this.isPostex(o));
    const skipped = this.picked().size - api.length;
    if (!api.length) {
      this.ui.error('Refresh works for couriers connected through their API. The ticked parcels use manual couriers: use the status options instead.');
      return;
    }
    this.sheetBusy.set(true);
    let applied = 0;
    const failed: string[] = [];
    for (const o of api) {
      try {
        const res = await firstValueFrom(this.partner.refreshDispatchTracking(o.shipment!.id));
        applied += res.data?.applied ?? 0;
      } catch {
        failed.push(o.reference);
      }
    }
    this.sheetBusy.set(false);
    const text = `${api.length - failed.length} refreshed${applied ? `, ${applied} new update${applied === 1 ? '' : 's'}` : ', no new updates'}${skipped ? `. ${skipped} manual-courier parcel(s) skipped` : ''}${failed.length ? `. Failed: ${failed.join(', ')}` : ''}.`;
    if (failed.length) this.ui.error(text);
    else this.ui.success(text);
    this.refresh();
  }

  readonly bulkTrack = signal<{ status: 'in_transit' | 'delivered' | 'failed_delivery' | 'returning_to_partner'; note: string; reason: string } | null>(null);

  /** Bulk action > a courier status (manual couriers). */
  openBulkTrack(status: 'in_transit' | 'delivered' | 'failed_delivery' | 'returning_to_partner'): void {
    this.readyMenuOpen.set(false);
    if (!this.pickedOrders().some((o) => !this.isApiCourier(o.shipment))) {
      this.ui.error('The ticked parcels use a courier connected through its API: their status comes from the courier. Use Refresh courier tracking.');
      return;
    }
    this.bulkTrack.set({ status, note: '', reason: '' });
  }

  async confirmBulkTrack(): Promise<void> {
    const f = this.bulkTrack();
    if (!f || this.trackSaving()) return;
    const manual = this.pickedOrders().filter((o) => !this.isApiCourier(o.shipment));
    const skipped = this.picked().size - manual.length;
    this.trackSaving.set(true);
    const failed: string[] = [];
    for (const o of manual) {
      try {
        await firstValueFrom(this.partner.updateDispatchTracking(o.shipment!.id, { status: f.status, note: f.note.trim() || undefined, reason: f.reason.trim() || undefined }));
      } catch (e) {
        failed.push(`${o.reference} (${apiErrorMessage(e)})`);
      }
    }
    this.trackSaving.set(false);
    this.bulkTrack.set(null);
    this.picked.set(new Set());
    const text = `${manual.length - failed.length} parcel${manual.length - failed.length === 1 ? '' : 's'} updated${skipped ? `. ${skipped} API-courier parcel(s) skipped` : ''}${failed.length ? `. Not updated: ${failed.join('; ')}` : ''}.`;
    if (failed.length) this.ui.error(text);
    else this.ui.success(text);
    this.refresh();
  }

  /** Bulk action > Print CN. */
  bulkPrintCn(): void {
    this.readyMenuOpen.set(false);
    this.printCn([...this.picked()]);
  }

  /** Bulk action > Generate loadsheet (one courier per loadsheet). */
  bulkLoadsheet(): void {
    this.readyMenuOpen.set(false);
    const couriers = new Set(this.readyShipments().filter((s) => this.picked().has(s.id)).map((s) => s.courier));
    if (couriers.size > 1) {
      this.ui.error('A loadsheet is for one courier. Tick the parcels of one courier only.');
      return;
    }
    this.downloadLoadsheet();
  }

  togglePick(id: string): void {
    this.picked.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  pickAllOf(courier: string): void {
    this.picked.set(new Set(this.readyShipments().filter((s) => s.courier === courier && s.cn).map((s) => s.id)));
  }

  clearPicked(): void {
    this.picked.set(new Set());
  }

  readonly printing = signal(false);

  /** Print the CN slip of one parcel, or of every ticked parcel (PostEx: its own PDF, 10 at a time; other couriers: a slip made here). */
  printCn(ids: string[], onDone?: () => void): void {
    if (!ids.length || this.printing()) return;
    this.printing.set(true);
    // PostEx prints 10 CNs per file: a larger selection opens one file per 10
    const parts: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) parts.push(ids.slice(i, i + 10));
    const next = (i: number): void => {
      if (i >= parts.length) {
        this.printing.set(false);
        onDone?.();
        return;
      }
      this.partner.printCn(parts[i]).subscribe({
        next: (blob) => {
          if (!blob || !blob.size) {
            this.printing.set(false);
            this.ui.error('The CN file was empty.');
            return;
          }
          const url = URL.createObjectURL(blob);
          const win = window.open(url, '_blank');
          if (!win) {
            // the browser blocked the new tab: save the file instead
            const a = document.createElement('a');
            a.href = url;
            a.download = blob.type.includes('pdf') ? `cn-${i + 1}.pdf` : `cn-${i + 1}.html`;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          next(i + 1);
        },
        error: (e) => {
          this.printing.set(false);
          // an error answer arrives as a blob: read its message
          const body = (e as { error?: unknown })?.error;
          if (body instanceof Blob) {
            body.text().then((t) => {
              try { this.ui.error(JSON.parse(t).message || 'Could not print the CN.'); } catch { this.ui.error('Could not print the CN.'); }
            });
          } else this.ui.error(e);
        },
      });
    };
    next(0);
  }

  // ───────────── Scan for loadsheet / CN ─────────────

  readonly scanOpen = signal(false);

  /** The scan modal asked for a loadsheet of the scanned parcels. One courier per loadsheet, like the bulk action. */
  scanLoadsheet(ids: string[], modal: ScanDispatchComponent): void {
    this.downloadLoadsheet(ids, () => {
      modal.reset();
      this.scanOpen.set(false);
    });
  }

  scanPrintCn(ids: string[]): void {
    this.printCn(ids);
  }

  cancelBooking(o: WarehouseOrder): void {
    const key = `cb:${o.id}`;
    this.setBusy(key, true);
    this.partner.cancelDispatchBooking(o.id).subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Booking cancelled.');
        this.refresh();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  /** Make the loadsheet and save the file. Only a saved file marks the parcels as downloaded; the handover is a separate, explicit step. */
  downloadLoadsheet(ids: string[] = [...this.picked()], onProcessed?: () => void): void {
    if (!ids.length || this.sheetBusy()) return;
    this.sheetBusy.set(true);
    this.partner.createDispatchLoadsheet(ids).subscribe({
      next: ({ data: sheet }) => {
        this.partner.downloadDispatchLoadsheet(sheet.id).subscribe({
          next: (blob) => {
            if (!blob || !blob.size) {
              this.sheetBusy.set(false);
              this.ui.error('The loadsheet file was empty. Nothing changed.');
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
            this.partner.markLoadsheetDownloaded(sheet.id).subscribe({
              next: (res) => {
                this.picked.set(new Set());
                // the loadsheet is saved: the parcels go straight to Dispatched (no separate "confirm handed over" step)
                this.partner.confirmDispatchHandover(sheet.id).subscribe({
                  next: (done) => {
                    this.sheetBusy.set(false);
                    this.ui.success(done.message || `${sheet.number} downloaded. Parcels dispatched.`);
                    onProcessed?.();
                    this.go({ tab: 'dispatched', page: null });
                  },
                  error: (e) => {
                    // the file is saved but the dispatch failed: the handover bar stays so it can be confirmed again
                    this.sheetBusy.set(false);
                    this.pendingHandover.set({ id: sheet.id, number: sheet.number, count: sheet.count });
                    onProcessed?.();
                    this.ui.error(e);
                    this.refresh();
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
      },
      error: (e) => {
        this.sheetBusy.set(false);
        this.ui.error(e);
      },
    });
  }

  /** The courier took the parcels: only now are they Dispatched. */
  confirmHandover(sheetId: string): void {
    if (this.handoverBusy()) return;
    this.handoverBusy.set(true);
    this.partner.confirmDispatchHandover(sheetId).subscribe({
      next: (res) => {
        this.handoverBusy.set(false);
        this.pendingHandover.set(null);
        this.ui.success(res.message || 'Parcels dispatched.');
        this.refresh();
      },
      error: (e) => {
        this.handoverBusy.set(false);
        this.ui.error(e);
      },
    });
  }

  /** The loadsheets of the downloaded parcels on this page that still wait for the courier. */
  awaitingHandover(): { id: string; count: number }[] {
    const by = new Map<string, number>();
    for (const s of this.readyShipments()) if (s.status === 'labelled' && s.sheet) by.set(s.sheet, (by.get(s.sheet) ?? 0) + 1);
    return [...by.entries()].map(([id, count]) => ({ id, count }));
  }

  openTrack(o: WarehouseOrder, status: 'in_transit' | 'delivered' | 'failed_delivery' | 'returning_to_partner'): void {
    this.track.set({ order: o, status, note: '', reason: '' });
  }

  confirmTrack(): void {
    const f = this.track();
    const sh = f?.order.shipment;
    if (!f || !sh || this.trackSaving()) return;
    this.trackSaving.set(true);
    this.partner.updateDispatchTracking(sh.id, { status: f.status, note: f.note.trim() || undefined, reason: f.reason.trim() || undefined }).subscribe({
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

  /** Read PostEx's tracking now (otherwise it is checked every few minutes by the server). */
  refreshTracking(o: WarehouseOrder): void {
    const sh = o.shipment;
    if (!sh) return;
    const key = `rt:${o.id}`;
    this.setBusy(key, true);
    this.partner.refreshDispatchTracking(sh.id).subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Tracking updated.');
        this.refresh();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  isPostex(o: WarehouseOrder): boolean {
    return /^postex$/i.test((o.shipment?.courier ?? '').trim());
  }

  receivedBack(o: WarehouseOrder): void {
    const sh = o.shipment;
    if (!sh) return;
    const key = `rb:${o.id}`;
    this.setBusy(key, true);
    this.partner.confirmReturnedParcel(sh.id).subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Marked as received back.');
        this.refresh();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  shipLabel(s: DispatchShipment): string {
    const map: Record<string, string> = {
      needs_label: 'No courier booked', booked: s.tracking_number ? 'CN booked · ready for dispatch' : 'Booked · CN to be added', labelled: 'Loadsheet downloaded · confirm handover', handed_to_courier: 'Dispatched', in_transit: 'In transit',
      delivered: 'Delivered', failed_delivery: 'Delivery attempt failed', returning_to_partner: 'Returning to the partner', returned_to_partner: 'Received back',
    };
    return map[s.status] ?? s.status;
  }

  // ───────────── Transfers ─────────────

  async dispatchTransfer(t: Transfer): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Dispatch ${t.code}?`,
      message: `${t.orders.length} parcel${t.orders.length === 1 ? '' : 's'} (${this.transferWeight(t)} kg) will be marked as on the way to the admin warehouse.`,
      confirmText: 'Dispatch transfer',
    });
    if (!ok) return;
    const key = `t:${t.id}`;
    this.setBusy(key, true);
    this.partner.dispatchTransfer(t.id).subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Transfer dispatched.');
        this.refresh(true);
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }
}
