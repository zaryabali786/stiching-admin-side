import { CourierRef, CourierSelectComponent } from '../../../shared/components/courier-select/courier-select.component';
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subscription, distinctUntilChanged, filter, map } from 'rxjs';
import { AdminService, Parcel, ShipmentStatus, ShippingOption, Transfer, WarehouseSummary } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe, HumanizePipe, PkrPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';
import { PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';

type WarehouseTab = 'transfers' | ShipmentStatus;
const TABS: readonly WarehouseTab[] = ['transfers', 'needs_label', 'labelled', 'handed_to_courier', 'delivered'];

interface WarehouseQuery {
  tab: WarehouseTab;
  search: string;
  page: number;
}

@Component({
  selector: 'app-admin-warehouse',
  standalone: true,
  imports: [CourierSelectComponent, IonSpinner, DayPipe, HumanizePipe, PkrPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent, StatusBadgeComponent],
  templateUrl: './warehouse.page.html',
  styleUrls: ['./warehouse.page.scss'],
})
export class AdminWarehousePage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly tabs: { key: WarehouseTab; label: string }[] = [
    { key: 'transfers', label: 'Incoming transfers' },
    { key: 'needs_label', label: 'Needs label' },
    { key: 'labelled', label: 'Ready for courier' },
    { key: 'handed_to_courier', label: 'Shipped' },
    { key: 'delivered', label: 'Delivered' },
  ];

  readonly query = signal<WarehouseQuery>({ tab: 'transfers', search: '', page: 1 });
  readonly transfers = new PagedList<Transfer>();
  readonly parcels = new PagedList<Parcel>();
  readonly summary = signal<WarehouseSummary | null>(null);
  readonly busyId = signal<string | null>(null);

  // Label panel
  readonly labelParcel = signal<Parcel | null>(null);
  readonly options = signal<ShippingOption[]>([]);
  readonly optionsLoading = signal(false);
  readonly optionsError = signal<string | null>(null);
  readonly rateId = signal<string | null>(null);
  readonly courier = signal('');
  /** A courier from the managed list, used when no shipping rate fits. */
  readonly courierRef = signal<CourierRef | null>(null);
  readonly ratePkr = signal<number | null>(null);
  readonly tracking = signal('');
  readonly dimensions = signal('');
  readonly weight = signal('');
  readonly savingLabel = signal(false);
  private optionsSub?: Subscription;

  readonly isTransfers = computed(() => this.query().tab === 'transfers');
  readonly canSaveLabel = computed(() => (!!this.rateId() || !!this.courierRef()) && !!this.tracking().trim() && !this.savingLabel());

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): WarehouseQuery => ({
        tab: oneOf(p.get('tab'), TABS, 'transfers'),
        search: p.get('search') || '',
        page: intParam(p, 'page', 1),
      })),
      distinctUntilChanged((a, b) => a.tab === b.tab && a.search === b.search && a.page === b.page)
    );
    q$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => this.query.set(q));

    this.transfers.connect(
      q$.pipe(filter((q) => q.tab === 'transfers')),
      (q) => this.admin.listTransfers({ status: 'in_transit', search: q.search, page: q.page, limit: 10 }),
      this.destroyRef
    );
    this.parcels.connect(
      q$.pipe(filter((q) => q.tab !== 'transfers')),
      (q) => this.admin.listParcels({ status: q.tab as ShipmentStatus, search: q.search, page: q.page, limit: 15 }),
      this.destroyRef
    );
    this.loadSummary();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && this.labelParcel()) this.closeLabel();
  }

  loadSummary(): void {
    this.admin.getWarehouseSummary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (s) => this.summary.set(s),
      error: () => undefined,
    });
  }

  /** What to do next on the current tab. */
  tabHint(): string {
    switch (this.query().tab) {
      case 'transfers':
        return 'When a transfer arrives, check the parcels against the list and receive it. Received parcels move to Needs label.';
      case 'needs_label':
        return 'Open a parcel, choose the courier rate, paste the tracking number and save. It then waits in Ready for courier.';
      case 'labelled':
        return 'Hand these parcels to the courier, then mark each one handed over. The customer gets the tracking number.';
      case 'handed_to_courier':
        return 'With the courier. Mark a parcel delivered once the courier confirms delivery.';
      default:
        return 'Delivered parcels. Nothing left to do here.';
    }
  }

  tabCount(tab: WarehouseTab): number | null {
    const s = this.summary();
    if (!s) return null;
    if (tab === 'transfers') return s.transfersInTransit;
    if (tab === 'needs_label') return s.needsLabel;
    if (tab === 'labelled') return s.readyForCourier;
    return null;
  }

  setTab(tab: WarehouseTab): void {
    setQuery(this.router, this.route, { tab: tab === 'transfers' ? null : tab, page: null, search: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  private afterAction(message: string): void {
    this.ui.success(message);
    this.loadSummary();
    this.badges.refresh();
    if (this.isTransfers()) this.transfers.reload();
    else this.parcels.reload();
  }

  // ── Transfers ──

  async receive(t: Transfer): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Receive ${t.code}?`,
      message: `Confirm that ${t.orders.length} parcel(s) arrived at the warehouse. Paid orders move to “At dispatch warehouse” and need a shipping label.`,
      confirmText: 'Receive transfer',
    });
    if (!ok) return;
    this.busyId.set(t.id);
    this.admin.receiveTransfer(t.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.afterAction(res.message || `${t.code} received.`);
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  totalWeight(t: Transfer): number {
    return Math.round(t.orders.reduce((a, o) => a + Number(o.weight_kg || 0), 0) * 100) / 100;
  }

  // ── Parcels ──

  async handed(p: Parcel): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Hand ${p.order?.reference || 'parcel'} to ${p.courier}?`,
      message: `The order is marked shipped and the customer receives tracking number ${p.tracking_number}.`,
      confirmText: 'Handed to courier',
    });
    if (!ok) return;
    this.runParcel(p, () => this.admin.markParcelHanded(p.id), 'Handed to courier.');
  }

  async delivered(p: Parcel): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Mark ${p.order?.reference || 'parcel'} delivered?`,
      message: 'The order is completed and the customer is notified.',
      confirmText: 'Mark delivered',
    });
    if (!ok) return;
    this.runParcel(p, () => this.admin.markParcelDelivered(p.id), 'Marked as delivered.');
  }

  private runParcel(p: Parcel, call: () => ReturnType<AdminService['markParcelHanded']>, fallback: string): void {
    this.busyId.set(p.id);
    call().subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.afterAction(res.message || fallback);
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  // ── Label panel ──

  openLabel(p: Parcel): void {
    this.labelParcel.set(p);
    this.rateId.set(p.shipping_rate_id || null);
    this.courier.set(p.courier || '');
    this.courierRef.set(null);
    this.ratePkr.set(p.rate_pkr ?? null);
    this.tracking.set(p.tracking_number || '');
    this.dimensions.set(p.dimensions || '');
    const w = p.weight_kg ?? p.order?.weight_kg;
    this.weight.set(w ? String(w) : '');
    this.loadOptions(p);
  }

  loadOptions(p: Parcel): void {
    this.optionsSub?.unsubscribe();
    this.options.set([]);
    this.optionsError.set(null);
    this.optionsLoading.set(true);
    this.optionsSub = this.admin.getCourierOptions(p.id).subscribe({
      next: (opts) => {
        this.optionsLoading.set(false);
        this.options.set(opts);
        // Preselect the recommended courier for a new label
        if (!this.rateId() && !this.courier() && !this.courierRef()) {
          const rec = opts.find((o) => o.recommended) || opts[0];
          if (rec) this.pickOption(rec);
        }
      },
      error: (err) => {
        this.optionsLoading.set(false);
        this.optionsError.set(apiErrorMessage(err, 'Could not load courier options.'));
      },
    });
  }

  pickOption(o: ShippingOption): void {
    this.courierRef.set(null); // a rate brings its own courier
    this.rateId.set(o.id);
    this.courier.set(o.courier);
    this.ratePkr.set(o.price_pkr);
  }

  /** Choosing a courier from the list means no rate is used. */
  setCourier(c: CourierRef | null): void {
    this.courierRef.set(c);
    if (c) {
      this.rateId.set(null);
      this.ratePkr.set(null);
      this.courier.set(c.name);
    }
  }

  closeLabel(): void {
    this.optionsSub?.unsubscribe();
    this.labelParcel.set(null);
  }

  saveLabel(): void {
    const p = this.labelParcel();
    if (!p || !this.canSaveLabel()) return;
    const weight = parseFloat(this.weight());
    this.savingLabel.set(true);
    this.admin
      .labelParcel(p.id, {
        ...(this.rateId() ? { shipping_rate_id: this.rateId() } : { courier_id: this.courierRef()!.id }),
        tracking_number: this.tracking().trim(),
        rate_pkr: this.ratePkr(),
        dimensions: this.dimensions().trim() || null,
        weight_kg: weight > 0 ? weight : null,
      })
      .subscribe({
        next: (res) => {
          this.savingLabel.set(false);
          this.closeLabel();
          this.afterAction(res.message || 'Label saved.');
        },
        error: (err) => {
          this.savingLabel.set(false);
          this.ui.error(err);
        },
      });
  }
}
