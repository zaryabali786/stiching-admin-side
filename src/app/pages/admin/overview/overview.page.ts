import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, distinctUntilChanged, map, merge, of, switchMap, tap } from 'rxjs';
import { AdminOverview, AdminService, NeedsActionItem, OverviewPeriod } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { oneOf, setQuery } from '../admin-list';

const PERIODS: readonly OverviewPeriod[] = ['this_week', 'this_month', '6_months'];

@Component({
  selector: 'app-admin-overview',
  standalone: true,
  imports: [RouterLink, PkrPipe, EmptyStateComponent],
  templateUrl: './overview.page.html',
  styleUrls: ['./overview.page.scss'],
})
export class AdminOverviewPage implements OnInit {
  private admin = inject(AdminService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly periods: { value: OverviewPeriod; label: string }[] = [
    { value: 'this_week', label: 'This week' },
    { value: 'this_month', label: 'This month' },
    { value: '6_months', label: '6 months' },
  ];

  readonly period = signal<OverviewPeriod>('this_month');
  readonly data = signal<AdminOverview | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private retry$ = new Subject<void>();

  readonly periodLabel = computed(() => {
    const p = this.period();
    return p === 'this_week' ? 'this week' : p === 'this_month' ? 'this month' : 'last 6 months';
  });

  readonly monthMax = computed(() => Math.max(1, ...(this.data()?.ordersPerMonth || []).map((m) => Math.max(m.international, m.pakistan))));
  readonly hasMonthly = computed(() => (this.data()?.ordersPerMonth || []).some((m) => m.international + m.pakistan > 0));
  readonly hasStatus = computed(() => (this.data()?.ordersByStatus || []).some((s) => s.count > 0));
  /** Screen-reader summary of the monthly chart. */
  readonly monthlySummary = computed(() =>
    'Orders per month. ' + (this.data()?.ordersPerMonth || []).map((m) => `${m.month}: ${m.international} international, ${m.pakistan} Pakistan`).join('; ')
  );

  /** Eyebrow: today's date, e.g. "Monday 5 October". */
  readonly todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  ngOnInit(): void {
    const period$ = this.route.queryParamMap.pipe(
      map((q) => oneOf(q.get('period'), PERIODS, 'this_month')),
      distinctUntilChanged()
    );
    merge(period$, this.retry$.pipe(map(() => this.period())))
      .pipe(
        tap((p) => {
          this.period.set(p);
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((p) =>
          this.admin.getOverview(p).pipe(
            map((d) => ({ d, err: null as unknown })),
            catchError((err) => of({ d: null, err }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ d, err }) => {
        this.loading.set(false);
        if (d) this.data.set(d);
        else this.error.set(apiErrorMessage(err, 'Could not load the overview.'));
      });
  }

  setPeriod(p: OverviewPeriod): void {
    if (p === this.period()) return;
    setQuery(this.router, this.route, { period: p === 'this_month' ? null : p });
  }

  retry(): void {
    this.retry$.next();
  }

  actionLabel(item: NeedsActionItem): string {
    return item.actionType === 'INVOICE' ? 'Issue invoice' : item.actionType === 'RECEIVE' ? 'Receive' : 'Open';
  }

  /** Short tag shown before each needs-action row (text, so colour is never the only signal). */
  actionTag(item: NeedsActionItem): string {
    if (item.actionType === 'INVOICE') return 'Invoice';
    if (item.actionType === 'RECEIVE') return 'Incoming';
    return /delay/i.test(item.subtext) ? 'Delayed' : /issue/i.test(item.subtext) ? 'Issue' : 'Check';
  }

  actionTone(item: NeedsActionItem): string {
    if (item.actionType === 'INVOICE') return 'amber';
    if (item.actionType === 'RECEIVE') return 'purple';
    return 'red';
  }

  /** Stages that wait on the platform team (invoice / payment follow-up). */
  isActionGroup(key: string): boolean {
    return key === 'invoice' || key === 'payment';
  }

  barHeight(value: number): number {
    return Math.round((value / this.monthMax()) * 100);
  }
}
