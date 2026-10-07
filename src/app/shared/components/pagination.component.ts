import { Component, computed, input, output } from '@angular/core';
import { PageMeta } from '../../core/models/api.models';

/**
 * Server-side pagination footer.
 * <app-pagination [meta]="meta()" (pageChange)="goTo($event)" />
 */
@Component({
  selector: 'app-pagination',
  standalone: true,
  template: `
    @if (meta(); as m) {
      @if (m.total > 0) {
        <div class="pager">
          <span class="range">Showing <b>{{ from() }}–{{ to() }}</b> of <b>{{ m.total }}</b></span>
          @if (m.totalPages > 1) {
            <div class="pages">
              <button type="button" class="pg" [disabled]="m.page <= 1" (click)="pageChange.emit(m.page - 1)" aria-label="Previous page">‹</button>
              @for (p of pages(); track $index) {
                @if (p === 0) {
                  <span class="dots">…</span>
                } @else {
                  <button type="button" class="pg" [class.active]="p === m.page" (click)="p !== m.page && pageChange.emit(p)">{{ p }}</button>
                }
              }
              <button type="button" class="pg" [disabled]="m.page >= m.totalPages" (click)="pageChange.emit(m.page + 1)" aria-label="Next page">›</button>
            </div>
          }
        </div>
      }
    }
  `,
  styles: [`
    .pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 16px; font-size: 12.5px; color: var(--c-muted); }
    .range b { color: var(--c-ink); font-weight: 600; }
    .pages { display: flex; gap: 4px; align-items: center; }
    .pg { min-width: 32px; height: 32px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--c-line); background: var(--c-surface); font: inherit; font-size: 12.5px; font-weight: 600; color: var(--c-ink); cursor: pointer; }
    .pg:hover:not(:disabled):not(.active) { border-color: var(--c-ink-2); }
    .pg.active { background: var(--c-dark-2); border-color: var(--c-dark-2); color: #fff; cursor: default; }
    .pg:disabled { opacity: .4; cursor: not-allowed; }
    .dots { padding: 0 4px; }
    @media (max-width: 640px) { .pg { min-width: 40px; height: 40px; } }
  `],
})
export class PaginationComponent {
  readonly meta = input<PageMeta | null>(null);
  readonly pageChange = output<number>();

  readonly from = computed(() => {
    const m = this.meta();
    return m && m.total ? (m.page - 1) * m.limit + 1 : 0;
  });
  readonly to = computed(() => {
    const m = this.meta();
    return m ? Math.min(m.page * m.limit, m.total) : 0;
  });

  /** Page numbers with 0 as an ellipsis marker. */
  readonly pages = computed(() => {
    const m = this.meta();
    if (!m) return [];
    const total = m.totalPages;
    const cur = m.page;
    const set = new Set([1, total, cur, cur - 1, cur + 1].filter((p) => p >= 1 && p <= total));
    const sorted = [...set].sort((a, b) => a - b);
    const out: number[] = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) out.push(0);
      out.push(p);
    });
    return out;
  });
}
