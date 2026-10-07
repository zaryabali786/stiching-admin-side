import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { LanguageService } from '../../../core/services/language.service';
import { EarningRow, EarningsSummary, PartnerService } from '../../../core/services/partner.service';
import { DayPipe, PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

type EarningsFilter = '' | 'paid' | 'issued';

const FILTERS: { value: EarningsFilter; en: string; ur: string }[] = [
  { value: '', en: 'All', ur: 'تمام' },
  { value: 'paid', en: 'Paid', ur: 'ادا شدہ' },
  { value: 'issued', en: 'Pending', ur: 'زیر التوا' },
];

@Component({
  selector: 'app-partner-earnings',
  standalone: true,
  imports: [DayPipe, PkrPipe, EmptyStateComponent, PaginationComponent, SearchInputComponent, StatusBadgeComponent],
  templateUrl: './earnings.page.html',
  styleUrls: ['./earnings.page.scss'],
})
export class PartnerEarningsPage implements OnInit {
  readonly lang = inject(LanguageService);
  private partner = inject(PartnerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly filters = FILTERS;

  // Summary
  readonly summary = signal<EarningsSummary | null>(null);
  readonly summaryLoading = signal(true);
  readonly summaryError = signal<string | null>(null);
  private summaryReload$ = new Subject<void>();
  readonly hasMonthly = computed(() => (this.summary()?.monthly || []).some((m) => m.amount > 0));

  // Invoices
  readonly status = signal<EarningsFilter>('');
  readonly search = signal('');
  readonly rows = signal<EarningRow[]>([]);
  readonly meta = signal<PageMeta | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();

  ngOnInit(): void {
    this.summaryReload$
      .pipe(
        startWith(undefined),
        tap(() => this.summaryError.set(null)),
        switchMap(() =>
          this.partner.earningsSummary().pipe(
            map((s) => ({ s, err: null as string | null })),
            catchError((e) => of({ s: null, err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ s, err }) => {
        this.summaryLoading.set(false);
        if (err || !s) this.summaryError.set(err);
        else this.summary.set(s);
      });

    combineLatest([this.route.queryParamMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        map(([q]) => {
          const st = (q.get('status') || q.get('tab') || '') as EarningsFilter;
          return {
            status: FILTERS.some((f) => f.value === st) ? st : ('' as EarningsFilter),
            search: (q.get('search') || '').trim(),
            page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
          };
        }),
        tap((s) => {
          this.status.set(s.status);
          this.search.set(s.search);
          this.error.set(null);
          this.loading.set(true);
        }),
        switchMap((s) =>
          this.partner.earnings({ status: s.status, search: s.search, page: s.page, limit: 10 }).pipe(
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

  setStatus(s: EarningsFilter): void {
    if (s !== this.status()) this.go({ status: s || null, tab: null, page: null });
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

  retrySummary(): void {
    this.summaryLoading.set(true);
    this.summaryReload$.next();
  }

  statusLabel(s: EarningRow['status']): string {
    return s === 'paid' ? this.lang.t('Paid', 'ادا شدہ') : this.lang.t('Pending payment', 'ادائیگی باقی');
  }

  /** Screen-reader summary of the monthly bar chart. */
  monthsLabel(): string {
    const months = this.summary()?.monthly || [];
    return 'Paid per month: ' + months.map((m) => `${m.month} PKR ${Math.round(m.amount).toLocaleString('en-PK')}`).join(', ');
  }

  compact(amount: number): string {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1000) return `${Math.round(amount / 1000)}k`;
    return String(Math.round(amount));
  }
}
