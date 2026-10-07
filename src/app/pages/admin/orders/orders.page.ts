import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { AdminOrderRow, AdminService, OrderCounts, OrderGroup, PartnerOption } from '../../../core/services/admin.service';
import { DayPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';
import { PAGE_SIZES, PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';
import { OrderDrawerComponent } from './order-drawer.component';

const GROUPS: readonly OrderGroup[] = ['all', 'awaiting_parcel', 'production', 'invoice', 'payment', 'warehouse', 'shipped', 'issues', 'cancelled'];
const SORTS = ['created_at', 'reference', 'customer_name', 'due_date', 'status'] as const;
type SortKey = (typeof SORTS)[number];

interface OrderQuery {
  group: OrderGroup;
  partner: string;
  search: string;
  page: number;
  limit: number;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [DayPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent, StatusBadgeComponent, OrderDrawerComponent],
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
})
export class AdminOrdersPage implements OnInit {
  private admin = inject(AdminService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  /** tone: 'attn' = needs our action (amber count), 'bad' = problem (red count). */
  readonly groups: { key: OrderGroup; label: string; tone?: 'attn' | 'bad' }[] = [
    { key: 'all', label: 'All' },
    { key: 'issues', label: 'Issues', tone: 'bad' },
    { key: 'invoice', label: 'To invoice', tone: 'attn' },
    { key: 'awaiting_parcel', label: 'Awaiting parcel' },
    { key: 'production', label: 'In production' },
    { key: 'payment', label: 'Awaiting payment' },
    { key: 'warehouse', label: 'To dispatch' },
    { key: 'shipped', label: 'Shipped' },
  ];
  readonly pageSizes = PAGE_SIZES;
  readonly skeleton = SKELETON_ROWS;

  readonly list = new PagedList<AdminOrderRow, { counts?: OrderCounts }>();
  readonly query = signal<OrderQuery>({ group: 'all', partner: '', search: '', page: 1, limit: 15, sort: 'created_at', dir: 'desc' });
  readonly openRef = signal<string | null>(null);
  readonly partners = signal<PartnerOption[]>([]);

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): OrderQuery => ({
        group: oneOf(p.get('group'), GROUPS, 'all'),
        partner: p.get('partner_id') || '',
        search: p.get('search') || '',
        page: intParam(p, 'page', 1),
        limit: intParam(p, 'limit', 15, PAGE_SIZES),
        sort: oneOf(p.get('sort'), SORTS, 'created_at'),
        dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
      })),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        const { partner, ...rest } = q;
        return this.admin.listOrders({ ...rest, partner_id: partner });
      },
      this.destroyRef
    );

    this.admin.listPartnerOptions().subscribe({ next: (list) => this.partners.set(list), error: () => undefined });

    this.route.queryParamMap
      .pipe(map((p) => p.get('ref')?.trim() || null), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((ref) => this.openRef.set(ref));
  }

  count(key: OrderGroup): number | null {
    const c = this.list.meta()?.counts;
    return c && c[key] !== undefined ? c[key]! : null;
  }

  groupLabel(): string {
    const g = this.groups.find((x) => x.key === this.query().group);
    return g ? g.label.toLowerCase() : 'all';
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    const q = this.query();
    return q.sort !== key ? 'none' : q.dir === 'asc' ? 'ascending' : 'descending';
  }

  clearFilters(): void {
    setQuery(this.router, this.route, { group: null, partner_id: null, search: null, page: null });
  }

  setPartner(id: string): void {
    setQuery(this.router, this.route, { partner_id: id || null, page: null });
  }

  setGroup(group: OrderGroup): void {
    setQuery(this.router, this.route, { group: group === 'all' ? null : group, page: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  setLimit(value: string): void {
    const n = parseInt(value, 10);
    setQuery(this.router, this.route, { limit: n === 15 ? null : n, page: null });
  }

  sortBy(key: SortKey): void {
    const q = this.query();
    const dir = q.sort === key ? (q.dir === 'asc' ? 'desc' : 'asc') : key === 'created_at' ? 'desc' : 'asc';
    setQuery(this.router, this.route, { sort: key === 'created_at' && dir === 'desc' ? null : key, dir: key === 'created_at' && dir === 'desc' ? null : dir, page: null });
  }

  sortIcon(key: SortKey): string {
    const q = this.query();
    if (q.sort !== key) return '↕';
    return q.dir === 'asc' ? '↑' : '↓';
  }

  open(row: AdminOrderRow): void {
    setQuery(this.router, this.route, { ref: row.reference });
  }

  closeDrawer(): void {
    setQuery(this.router, this.route, { ref: null });
  }

  isOverdue(row: AdminOrderRow): boolean {
    if (!row.due_date || ['shipped', 'delivered', 'cancelled'].includes(row.status)) return false;
    return row.due_date < new Date().toISOString().slice(0, 10);
  }
}
