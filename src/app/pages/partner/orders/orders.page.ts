import { Component, DestroyRef, HostListener, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { PartnerOrderDetail, PartnerOrderRow, PartnerService } from '../../../core/services/partner.service';
import { DayPipe, PkrPipe } from '../../../shared/pipes';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

/** Every order of this partner: server-side search and paging. */
@Component({
  selector: 'app-partner-orders',
  standalone: true,
  imports: [DayPipe, PkrPipe, BrandLogoComponent, EmptyStateComponent, PaginationComponent, SearchInputComponent, StatusBadgeComponent],
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
})
export class PartnerOrdersPage implements OnInit {
  private partner = inject(PartnerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly search = signal('');
  readonly rows = signal<PartnerOrderRow[]>([]);
  readonly meta = signal<PageMeta | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();

  // ───────── side panel: one order, without leaving the list ─────────
  readonly openId = signal<string | null>(null);
  readonly detail = signal<PartnerOrderDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);

  openOrder(row: PartnerOrderRow): void {
    this.openId.set(row.id);
    this.detail.set(null);
    this.loadDetail(row.id);
  }

  loadDetail(id: string): void {
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.partner.orderDetail(id).subscribe({
      next: (d) => {
        if (this.openId() !== id) return;
        this.detail.set(d);
        this.detailLoading.set(false);
      },
      error: (e) => {
        if (this.openId() !== id) return;
        this.detailError.set(apiErrorMessage(e));
        this.detailLoading.set(false);
      },
    });
  }

  @HostListener('document:keydown.escape')
  closeOrder(): void {
    this.openId.set(null);
  }

  addressText(d: { address: string | null; city: string | null; country: string | null }): string {
    return [d.address, d.city, d.country].filter((x) => !!x && x.trim()).join(', ');
  }

  /** "Length 40 · Chest 38" from a size chart's measurements. */
  measureText(m: Record<string, unknown> | undefined): string {
    return Object.entries(m || {})
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())} ${v}`)
      .join(' · ');
  }

  ngOnInit(): void {
    combineLatest([this.route.queryParamMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        map(([q]) => ({ search: (q.get('search') || '').trim(), page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1) })),
        tap((s) => {
          this.search.set(s.search);
          this.error.set(null);
          this.loading.set(true);
        }),
        switchMap((s) =>
          this.partner.allOrders({ search: s.search, page: s.page, limit: 10 }).pipe(
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
        this.rows.set(r.items);
        this.meta.set(r.meta);
      });
  }

  private go(params: Record<string, string | number | null>): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
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
}
