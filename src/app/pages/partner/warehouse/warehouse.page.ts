import { AuthService } from '../../../core/services/auth.service';
import { CourierRef, CourierSelectComponent } from '../../../shared/components/courier-select/courier-select.component';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subject, catchError, combineLatest, forkJoin, map, of, startWith, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { LanguageService } from '../../../core/services/language.service';
import { CatalogueService } from '../../../core/services/catalogue.service';
import { DispatchRoute, PartnerService, Transfer, WarehouseMeta, WarehouseOrder, WarehouseTab } from '../../../core/services/partner.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe, HumanizePipe, PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

const TABS: { value: WarehouseTab; en: string; ur: string }[] = [
  { value: 'to_invoice', en: 'Waiting for invoice', ur: 'انوائس کا انتظار' },
  { value: 'awaiting_payment', en: 'Awaiting payment', ur: 'ادائیگی کا انتظار' },
  { value: 'paid', en: 'Paid · choose route', ur: 'ادا شدہ · راستہ چنیں' },
  { value: 'dispatched', en: 'Dispatched', ur: 'روانہ' },
];

const DOMESTIC = ['pakistan', 'pk'];

@Component({
  selector: 'app-partner-warehouse',
  standalone: true,
  imports: [CourierSelectComponent, FormsModule, IonSpinner, DayPipe, HumanizePipe, PkrPipe, EmptyStateComponent, PaginationComponent, SearchInputComponent, StatusBadgeComponent],
  templateUrl: './warehouse.page.html',
  styleUrls: ['./warehouse.page.scss'],
})
export class PartnerWarehousePage implements OnInit {
  readonly lang = inject(LanguageService);
  private auth = inject(AuthService);
  /** May this person change things here? View-only people see the data but no working buttons (the server re-checks every request). */
  readonly canEdit = computed(() => this.auth.can('warehouse.update'));
  private partner = inject(PartnerService);
  private ui = inject(UiService);
  private catalogueApi = inject(CatalogueService);
  private badges = inject(BadgeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

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

  // Ship modal
  readonly shipForm = signal<{ order: WarehouseOrder; courier: CourierRef | null; tracking: string } | null>(null);
  readonly shipSaving = signal(false);

  // Transfers
  readonly transfers = signal<Transfer[]>([]);
  readonly transfersLoading = signal(true);
  readonly transfersError = signal<string | null>(null);
  private transfersReload$ = new Subject<void>();
  readonly openTransfer = computed(() => this.transfers().find((t) => t.status === 'open') ?? null);

  ngOnInit(): void {
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
    return this.canEdit() && ['packed', 'invoice_issued', 'awaiting_payment', 'paid', 'partner_dispatch'].includes(o.status);
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
    if (this.tab() === 'paid' && this.canEdit()) this.select(o);
  }

  confirmRoute(): void {
    const o = this.selected();
    if (!o) return;
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

  // ───────────── Direct dispatch: mark shipped ─────────────

  openShip(o: WarehouseOrder): void {
    this.shipForm.set({ order: o, courier: null, tracking: o.shipment?.tracking_number || '' });
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

  patchShip(patch: { courier?: CourierRef | null; tracking?: string }): void {
    this.shipForm.update((f) => (f ? { ...f, ...patch } : f));
  }

  closeShip(): void {
    if (!this.shipSaving()) this.shipForm.set(null);
  }

  submitShip(): void {
    const f = this.shipForm();
    if (!f) return;
    if (!f.courier || !f.tracking.trim()) {
      this.ui.error('Choose a courier and enter the tracking number.');
      return;
    }
    this.shipSaving.set(true);
    this.partner.shipDirect(f.order.id, { courier_id: f.courier.id, tracking_number: f.tracking.trim() }).subscribe({
      next: (res) => {
        this.shipSaving.set(false);
        this.shipForm.set(null);
        this.ui.success(res.message || 'Marked as shipped.');
        this.refresh();
      },
      error: (e) => {
        this.shipSaving.set(false);
        this.ui.error(e);
      },
    });
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
