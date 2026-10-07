import { DestroyRef, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { Observable, Subject, catchError, filter, map, merge, of, switchMap, tap } from 'rxjs';
import { PageMeta, Paged } from '../../core/models/api.models';
import { apiErrorMessage } from '../../core/services/api.service';

/**
 * Server-side paginated list state for admin pages.
 * - `connect(params$, fetch)` loads whenever the params change (stale requests are cancelled via switchMap).
 * - `reload()` refetches the current params without showing skeletons (rows are dimmed instead).
 */
export class PagedList<T, M = Record<string, any>> {
  readonly items = signal<T[]>([]);
  readonly meta = signal<(PageMeta & M) | null>(null);
  /** First load or filter change: show skeleton rows. */
  readonly loading = signal(true);
  /** Background refresh after an action: keep rows, dim them. */
  readonly refreshing = signal(false);
  readonly error = signal<string | null>(null);

  private reload$ = new Subject<void>();
  private last: { value: unknown } | null = null;

  connect<P>(params$: Observable<P>, fetch: (params: P) => Observable<Paged<T, M>>, destroyRef: DestroyRef): void {
    const fresh$ = params$.pipe(
      tap((p) => (this.last = { value: p })),
      map((p) => ({ p, soft: false }))
    );
    const soft$ = this.reload$.pipe(
      filter(() => !!this.last),
      map(() => ({ p: this.last!.value as P, soft: true }))
    );

    merge(fresh$, soft$)
      .pipe(
        tap(({ soft }) => {
          this.error.set(null);
          if (soft) this.refreshing.set(true);
          else this.loading.set(true);
        }),
        switchMap(({ p }) =>
          fetch(p).pipe(
            map((res) => ({ res, err: null as unknown })),
            catchError((err) => of({ res: null, err }))
          )
        ),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(({ res, err }) => {
        this.loading.set(false);
        this.refreshing.set(false);
        if (res) {
          this.items.set(res.items);
          this.meta.set(res.meta);
        } else {
          this.items.set([]);
          this.meta.set(null);
          this.error.set(apiErrorMessage(err, 'Could not load this list.'));
        }
      });
  }

  reload(): void {
    this.reload$.next();
  }

  /** Replace one row locally (e.g. after a PATCH) without refetching. */
  patch(predicate: (row: T) => boolean, update: (row: T) => T): void {
    this.items.update((rows) => rows.map((r) => (predicate(r) ? update(r) : r)));
  }
}

/** Merge query params into the URL without adding history entries. `null` removes a param. */
export function setQuery(router: Router, route: ActivatedRoute, params: Record<string, string | number | null | undefined>): void {
  router.navigate([], { relativeTo: route, queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
}

export function intParam(map: ParamMap, key: string, fallback: number, allowed?: number[]): number {
  const n = parseInt(map.get(key) || '', 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (allowed && !allowed.includes(n)) return fallback;
  return n;
}

export function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const PAGE_SIZES = [15, 30, 50];

/** Skeleton row placeholders for tables. */
export const SKELETON_ROWS = [1, 2, 3, 4, 5, 6];
