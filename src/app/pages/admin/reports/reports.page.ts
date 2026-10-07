import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, catchError, distinctUntilChanged, map, merge, of, switchMap, tap } from 'rxjs';
import { AdminReports, AdminService } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';
import { HumanizePipe, PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { intParam, setQuery } from '../admin-list';

const MONTH_OPTIONS = [3, 6, 12];

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [DecimalPipe, PkrPipe, HumanizePipe, EmptyStateComponent],
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
})
export class AdminReportsPage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly monthOptions = MONTH_OPTIONS;
  readonly months = signal(6);
  readonly data = signal<AdminReports | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private retry$ = new Subject<void>();

  readonly chartMax = computed(() => Math.max(1, ...(this.data()?.monthly || []).flatMap((m) => [m.revenue, m.payout + Math.max(0, m.margin)])));
  /** Rounded-up axis maximum (1, 2, 2.5 or 5 × 10ⁿ) so tick labels are tidy. */
  readonly niceMax = computed(() => {
    const max = this.chartMax();
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const step = [1, 2, 2.5, 5, 10].find((f) => f * pow >= max) ?? 10;
    return step * pow;
  });
  readonly ticks = computed(() => [0, this.niceMax() / 2, this.niceMax()]);
  readonly chartSummary = computed(() =>
    'Revenue by month. ' + (this.data()?.monthly || []).map((m) => `${m.month}: revenue PKR ${m.revenue.toLocaleString()}, partner payout PKR ${m.payout.toLocaleString()}, margin PKR ${m.margin.toLocaleString()}`).join('; ')
  );
  readonly hasRevenue = computed(() => (this.data()?.monthly || []).some((m) => m.revenue > 0 || m.orders > 0));
  readonly brandMax = computed(() => Math.max(1, ...(this.data()?.topBrands || []).map((b) => b.count)));
  readonly countryMax = computed(() => Math.max(1, ...(this.data()?.topCountries || []).map((b) => b.count)));
  readonly chargeTotals = computed(() =>
    (this.data()?.byChargeType || []).reduce((a, r) => ({ customer: a.customer + r.customer, partner: a.partner + r.partner, margin: a.margin + r.margin }), { customer: 0, partner: 0, margin: 0 })
  );

  ngOnInit(): void {
    const months$ = this.route.queryParamMap.pipe(
      map((p) => intParam(p, 'months', 6, MONTH_OPTIONS)),
      distinctUntilChanged()
    );
    merge(months$, this.retry$.pipe(map(() => this.months())))
      .pipe(
        tap((m) => {
          this.months.set(m);
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((m) =>
          this.admin.getReports(m).pipe(
            map((d) => ({ d, err: null as unknown })),
            catchError((err) => of({ d: null, err }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ d, err }) => {
        this.loading.set(false);
        if (d) this.data.set(d);
        else this.error.set(apiErrorMessage(err, 'Could not load reports.'));
      });
  }

  setMonths(m: number): void {
    if (m !== this.months()) setQuery(this.router, this.route, { months: m === 6 ? null : m });
  }

  retry(): void {
    this.retry$.next();
  }

  h(value: number): number {
    return Math.max(0, Math.min(100, (value / this.niceMax()) * 100));
  }

  positive(n: number): number {
    return Math.max(0, n || 0);
  }

  /** 1 250 000 → "1.25M", 640 000 → "640k" (axis and bar labels). */
  compact(n: number): string {
    const a = Math.abs(n);
    if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${+(n / 1e3).toFixed(0)}k`;
    return String(Math.round(n));
  }

  pct(margin: number, revenue: number): number {
    return revenue > 0 ? Math.round((margin / revenue) * 100) : 0;
  }

  exportCsv(): void {
    const d = this.data();
    if (!d) return;
    const rows: (string | number)[][] = [
      ['Month', 'Key', 'Orders', 'Revenue PKR', 'Partner payout PKR', 'Margin PKR', 'Margin %'],
      ...d.monthly.map((m) => [m.month, m.key, m.orders, m.revenue, m.payout, m.margin, this.pct(m.margin, m.revenue)]),
      ['Total', '', d.totals.orders, d.totals.revenuePkr, d.totals.partnerPayoutPkr, d.totals.marginPkr, d.totals.marginPct],
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${d.monthly[0]?.key || 'start'}-to-${d.monthly[d.monthly.length - 1]?.key || 'end'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.ui.success('CSV downloaded.');
  }
}
