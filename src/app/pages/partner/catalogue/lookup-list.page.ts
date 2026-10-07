import { CanDirective } from '../../../shared/can.directive';
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { distinctUntilChanged, map } from 'rxjs';
import { CatalogueService, LookupInput, LookupKind, LookupRow, StatusFilter } from '../../../core/services/catalogue.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';
import { PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../../admin/admin-list';

const STATUSES: readonly StatusFilter[] = ['all', 'active', 'inactive'];
const PAGE_LIMIT = 20;
const NAME_MAX = 120;

interface LookupQuery {
  status: StatusFilter;
  search: string;
  page: number;
}

interface LookupForm {
  id: string | null;
  name: string;
  active: boolean;
  requires_tracking: boolean;
}

/** Wording per list, so one component serves both Brands and Couriers. */
const COPY: Record<LookupKind, { title: string; one: string; subtitle: string; empty: string; searchHint: string }> = {
  brands: {
    title: 'Brands',
    one: 'brand',
    subtitle: 'The brands customers can pick when they place an order. Switch a brand off to hide it from the order form.',
    empty: 'Add the brands your customers buy from. They choose one on the order form.',
    searchHint: 'Search brands…',
  },
  couriers: {
    title: 'Couriers',
    one: 'courier',
    subtitle: 'The couriers customers use to send parcels to you. Choose whether customers must enter a tracking number for each one.',
    empty: 'Add the couriers that deliver parcels to you. Customers choose one on the order form.',
    searchHint: 'Search couriers…',
  },
};

/**
 * One server-paginated list page for Brands and Couriers (route data `kind` decides which).
 */
@Component({
  selector: 'app-partner-lookup-list',
  standalone: true,
  imports: [CanDirective, IonSpinner, DayPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent, StatusBadgeComponent],
  templateUrl: './lookup-list.page.html',
  styleUrls: ['./lookup-list.page.scss'],
})
export class PartnerLookupListPage implements OnInit {
  private catalogue = inject(CatalogueService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly kind: LookupKind = this.route.snapshot.data['kind'] === 'couriers' ? 'couriers' : 'brands';
  readonly copy = COPY[this.kind];
  readonly isCourier = this.kind === 'couriers';
  readonly statuses = STATUSES;
  readonly nameMax = NAME_MAX;
  readonly skeleton = SKELETON_ROWS;

  readonly list = new PagedList<LookupRow>();
  readonly query = signal<LookupQuery>({ status: 'all', search: '', page: 1 });
  readonly busyId = signal<string | null>(null);

  readonly form = signal<LookupForm | null>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly nameError = computed(() => {
    const f = this.form();
    if (!f) return '';
    const n = f.name.trim();
    if (!n) return `Enter the ${this.copy.one} name.`;
    if (n.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
    return '';
  });

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): LookupQuery => ({
        status: oneOf(p.get('status'), STATUSES, 'all'),
        search: p.get('search') || '',
        page: intParam(p, 'page', 1),
      })),
      distinctUntilChanged((a, b) => a.status === b.status && a.search === b.search && a.page === b.page)
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        return this.catalogue.listLookup(this.kind, { status: q.status, search: q.search, page: q.page, limit: PAGE_LIMIT, sort: 'name', dir: 'asc' });
      },
      this.destroyRef
    );
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && this.form() && !this.saving()) this.closeForm();
  }

  statusLabel(s: string): string {
    return s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Inactive';
  }

  setStatus(status: StatusFilter): void {
    setQuery(this.router, this.route, { status: status === 'all' ? null : status, page: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  openNew(): void {
    this.formError.set(null);
    this.showErrors.set(false);
    this.form.set({ id: null, name: '', active: true, requires_tracking: true });
  }

  openEdit(r: LookupRow): void {
    this.formError.set(null);
    this.showErrors.set(false);
    this.form.set({ id: r.id, name: r.name, active: r.status === 'active', requires_tracking: r.requires_tracking !== false });
  }

  closeForm(): void {
    this.form.set(null);
  }

  patchForm(patch: Partial<LookupForm>): void {
    this.formError.set(null);
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    this.showErrors.set(true);
    if (this.nameError()) return;
    const body: LookupInput = { name: f.name.trim(), status: f.active ? 'active' : 'inactive' };
    if (this.isCourier) body.requires_tracking = f.requires_tracking;
    this.saving.set(true);
    this.formError.set(null);
    const req = f.id ? this.catalogue.updateLookup(this.kind, f.id, body) : this.catalogue.createLookup(this.kind, body);
    req.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.form.set(null);
        this.ui.success(res.message || 'Saved.');
        this.list.reload();
      },
      error: (err) => {
        this.saving.set(false);
        // 409 duplicate etc.: keep the modal open and explain next to the form
        this.formError.set(apiErrorMessage(err));
      },
    });
  }

  toggleStatus(r: LookupRow): void {
    const next = r.status === 'active' ? 'inactive' : 'active';
    this.busyId.set(r.id);
    this.catalogue.updateLookup(this.kind, r.id, { status: next }).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.list.patch((x) => x.id === r.id, (x) => ({ ...x, status: res.data?.status ?? next }));
        this.ui.success(next === 'active' ? `${r.name} is active again.` : `${r.name} is hidden from the order form.`);
        if (this.query().status !== 'all') this.list.reload();
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  async remove(r: LookupRow): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete “${r.name}”?`,
      message: `If orders already use this ${this.copy.one} it is switched off instead, so past orders stay intact.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.busyId.set(r.id);
    this.catalogue.deleteLookup(this.kind, r.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        const fallback = res.deactivated ? `${r.name} is used by orders, so it was switched off.` : `${r.name} deleted.`;
        if (res.deactivated) this.ui.info(res.message || fallback);
        else this.ui.success(res.message || fallback);
        this.list.reload();
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }
}
