import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { AdminReview, AdminService, ReviewSummary, ReviewType } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PAGE_SIZES, PagedList, SKELETON_ROWS, intParam, setQuery } from '../admin-list';

interface ReviewsQuery {
  search: string;
  type: ReviewType | '';
  rating: number;
  from: string;
  to: string;
  dir: 'asc' | 'desc';
  page: number;
  limit: number;
}

const STARS = [5, 4, 3, 2, 1] as const;

/** Admin > Customer Reviews: every review customers left after delivery, with the summary, filters and the order behind each one. */
@Component({
  selector: 'app-admin-reviews',
  standalone: true,
  imports: [RouterLink, DecimalPipe, DayPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent],
  templateUrl: './reviews.page.html',
  styleUrls: ['./reviews.page.scss'],
})
export class AdminReviewsPage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly pageSizes = PAGE_SIZES;
  readonly stars = STARS;
  readonly list = new PagedList<AdminReview>();
  readonly query = signal<ReviewsQuery>({ search: '', type: '', rating: 0, from: '', to: '', dir: 'desc', page: 1, limit: 15 });

  readonly summary = signal<ReviewSummary | null>(null);
  readonly summaryError = signal<string | null>(null);
  readonly filtered = computed(() => {
    const q = this.query();
    return !!(q.search || q.type || q.rating || q.from || q.to);
  });

  readonly selected = signal<AdminReview | null>(null);
  readonly detail = signal<AdminReview | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  private open$ = new Subject<string | null>();

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): ReviewsQuery => {
        const type = p.get('type');
        const rating = parseInt(p.get('rating') || '', 10);
        return {
          search: p.get('search') || '',
          type: type === 'national' || type === 'international' ? type : '',
          rating: rating >= 1 && rating <= 5 ? rating : 0,
          from: /^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '') ? p.get('from')! : '',
          to: /^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '') ? p.get('to')! : '',
          dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
          page: intParam(p, 'page', 1),
          limit: intParam(p, 'limit', 15, PAGE_SIZES),
        };
      }),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        this.loadSummary(q);
        return this.admin.listReviews({ search: q.search, type: q.type, rating: q.rating || '', from: q.from, to: q.to, dir: q.dir, page: q.page, limit: q.limit });
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
            ? this.admin.getReview(id).pipe(
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
        else this.detailError.set(apiErrorMessage(res.err, 'Could not load this review.'));
      });
  }

  /** The cards follow the type and date filters (not the star filter, so the distribution always shows every star). */
  private loadSummary(q: ReviewsQuery): void {
    this.admin.getReviewSummary({ type: q.type, from: q.from, to: q.to }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.summaryError.set(null);
      },
      error: (err) => this.summaryError.set(apiErrorMessage(err, 'Could not load the summary.')),
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && this.selected()) this.close();
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  setType(value: string): void {
    setQuery(this.router, this.route, { type: value || null, page: null });
  }

  setRating(value: string): void {
    setQuery(this.router, this.route, { rating: value || null, page: null });
  }

  setFrom(value: string): void {
    setQuery(this.router, this.route, { from: value || null, page: null });
  }

  setTo(value: string): void {
    setQuery(this.router, this.route, { to: value || null, page: null });
  }

  setDir(value: string): void {
    setQuery(this.router, this.route, { dir: value === 'asc' ? 'asc' : null, page: null });
  }

  clearFilters(): void {
    setQuery(this.router, this.route, { search: null, type: null, rating: null, from: null, to: null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  setLimit(value: string): void {
    const n = parseInt(value, 10);
    setQuery(this.router, this.route, { limit: n === 15 ? null : n, page: null });
  }

  /** Width of one bar of the rating distribution. */
  barWidth(count: number): string {
    const total = this.summary()?.total || 0;
    return total ? `${Math.max(2, Math.round((count / total) * 100))}%` : '0%';
  }

  count(star: number): number {
    return this.summary()?.distribution[String(star) as '1'] ?? 0;
  }

  typeLabel(t: ReviewType): string {
    return t === 'national' ? 'National' : 'International';
  }

  open(r: AdminReview): void {
    this.selected.set(r);
    this.open$.next(r.id);
  }

  retryDetail(): void {
    const r = this.selected();
    if (r) this.open$.next(r.id);
  }

  close(): void {
    this.selected.set(null);
    this.open$.next(null);
  }
}
