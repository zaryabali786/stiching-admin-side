import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, combineLatest, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';
import { LanguageService } from '../../../core/services/language.service';
import { BadgeService } from '../../../core/services/badge.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { JobStage, OverviewRange, PartnerOverview, PartnerService } from '../../../core/services/partner.service';
import { PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';

const RANGES: { value: OverviewRange; en: string; ur: string }[] = [
  { value: 'today', en: 'Today', ur: 'آج' },
  { value: '14days', en: '14 days', ur: '14 دن' },
  { value: '30days', en: '30 days', ur: '30 دن' },
];

const STAGE_LABELS: Record<JobStage, { en: string; ur: string }> = {
  to_assign: { en: 'To assign', ur: 'تفویض باقی' },
  cutting: { en: 'Cutting', ur: 'کٹنگ' },
  stitching: { en: 'Stitching', ur: 'سلائی' },
  qc: { en: 'Quality check', ur: 'کوالٹی چیک' },
  packed: { en: 'In warehouse', ur: 'گودام میں' },
};

@Component({
  selector: 'app-partner-overview',
  standalone: true,
  imports: [RouterLink, PkrPipe, EmptyStateComponent],
  templateUrl: './overview.page.html',
  styleUrls: ['./overview.page.scss'],
})
export class PartnerOverviewPage implements OnInit {
  readonly lang = inject(LanguageService);
  /** Sidebar counters (already polled by the shell) — reused for the "today's work" tiles. */
  readonly badges = inject(BadgeService);
  private partner = inject(PartnerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly ranges = RANGES;
  readonly range = signal<OverviewRange>('14days');
  readonly data = signal<PartnerOverview | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();

  readonly today = (() => {
    const d = new Date();
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
    const month = d.toLocaleDateString('en-GB', { month: 'long' });
    return `${weekday} ${d.getDate()} ${month}`.toUpperCase();
  })();

  readonly finishedTotal = computed(() => (this.data()?.dailyFinished || []).reduce((a, d) => a + d.count, 0));
  readonly stageTotal = computed(() => (this.data()?.workByStage || []).reduce((a, s) => a + s.count, 0));
  readonly outputTotal = computed(() => (this.data()?.tailorOutput || []).reduce((a, t) => a + t.count, 0));
  /** With many bars, label every few days so the axis stays readable. */
  readonly labelEvery = computed(() => {
    const n = this.data()?.dailyFinished.length || 0;
    return n > 20 ? 5 : n > 10 ? 2 : 1;
  });

  ngOnInit(): void {
    const range$ = this.route.queryParamMap.pipe(
      map((q) => {
        const r = q.get('range') as OverviewRange;
        return RANGES.some((x) => x.value === r) ? r : '14days';
      }),
      distinctUntilChanged()
    );

    combineLatest([range$, this.reload$.pipe(startWith(undefined))])
      .pipe(
        tap(([r]) => {
          this.range.set(r);
          this.error.set(null);
          if (!this.data()) this.loading.set(true);
        }),
        switchMap(([r]) =>
          this.partner.overview(r).pipe(
            map((d) => ({ d, err: null as string | null })),
            catchError((e) => of({ d: null, err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ d, err }) => {
        this.loading.set(false);
        if (err) this.error.set(err);
        else this.data.set(d);
      });
  }

  setRange(r: OverviewRange): void {
    if (r === this.range()) return;
    this.router.navigate([], { queryParams: { range: r === '14days' ? null : r }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  retry(): void {
    this.loading.set(true);
    this.reload$.next();
  }

  stageLabel(stage: JobStage): string {
    const l = STAGE_LABELS[stage];
    return l ? this.lang.t(l.en, l.ur) : stage;
  }

  barTitle(d: { date: string; count: number }): string {
    return `${d.date}: ${d.count} finished`;
  }

  /** Team-load tone (DESIGN.md): green < 70 %, amber 70–89 %, red ≥ 90 %. */
  loadTone(pct: number): 'green' | 'amber' | 'red' {
    return pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green';
  }

  loadText(pct: number): string {
    return pct >= 90 ? this.lang.t('nearly full', 'تقریباً بھرا') : pct >= 70 ? this.lang.t('busy', 'مصروف') : this.lang.t('has room', 'گنجائش ہے');
  }

  labelBottom(pct: number): string {
    return `calc(${pct}% + 4px)`;
  }
}
