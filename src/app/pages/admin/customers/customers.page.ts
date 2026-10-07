import { Component, DestroyRef, HostListener, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { AdminCustomerDetail, AdminCustomerRow, AdminService } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { chartTitle } from '../../../core/utils/measurements';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe, PkrPipe, TimeAgoPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';
import { PAGE_SIZES, PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';

const SORTS = ['created_at', 'full_name', 'customer_code', 'country'] as const;
type SortKey = (typeof SORTS)[number];

interface CustomerQuery {
  search: string;
  page: number;
  limit: number;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [RouterLink, DayPipe, PkrPipe, TimeAgoPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent, StatusBadgeComponent],
  templateUrl: './customers.page.html',
  styleUrls: ['./customers.page.scss'],
})
export class AdminCustomersPage implements OnInit {
  readonly chartTitle = chartTitle;

  private admin = inject(AdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly pageSizes = PAGE_SIZES;
  readonly list = new PagedList<AdminCustomerRow>();
  readonly query = signal<CustomerQuery>({ search: '', page: 1, limit: 15, sort: 'created_at', dir: 'desc' });

  // Drawer
  readonly selected = signal<AdminCustomerRow | null>(null);
  readonly detail = signal<AdminCustomerDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  private open$ = new Subject<string | null>();

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): CustomerQuery => ({
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
        return this.admin.listCustomers(q);
      },
      this.destroyRef
    );

    this.open$
      .pipe(
        tap((id) => {
          this.detail.set(null);
          this.detailError.set(null);
          this.detailLoading.set(!!id);
        }),
        switchMap((id) =>
          id
            ? this.admin.getCustomer(id).pipe(
                map((d) => ({ d, err: null as unknown })),
                catchError((err) => of({ d: null, err }))
              )
            : of(null)
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        this.detailLoading.set(false);
        if (!res) return;
        if (res.d) this.detail.set(res.d);
        else this.detailError.set(apiErrorMessage(res.err, 'Could not load this customer.'));
      });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && this.selected()) this.close();
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
    const isDefault = key === 'created_at' && dir === 'desc';
    setQuery(this.router, this.route, { sort: isDefault ? null : key, dir: isDefault ? null : dir, page: null });
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    const q = this.query();
    return q.sort !== key ? 'none' : q.dir === 'asc' ? 'ascending' : 'descending';
  }

  sortIcon(key: SortKey): string {
    const q = this.query();
    return q.sort !== key ? '↕' : q.dir === 'asc' ? '↑' : '↓';
  }

  open(c: AdminCustomerRow): void {
    this.selected.set(c);
    this.open$.next(c.id);
  }

  retryDetail(): void {
    const c = this.selected();
    if (c) this.open$.next(c.id);
  }

  close(): void {
    this.selected.set(null);
    this.open$.next(null);
  }
}
