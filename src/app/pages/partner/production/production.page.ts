import { AuthService } from '../../../core/services/auth.service';
import { CanDirective } from '../../../shared/can.directive';
import { ApprovalChipComponent } from '../../../shared/components/approval-chip.component';
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  CdkDropListGroup,
  DragStartDelay,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { IonSpinner } from '@ionic/angular';
import { Subject, Subscription, catchError, map, of, switchMap, tap } from 'rxjs';

import {
  BoardColumn,
  BoardFilters,
  Card,
  MasterTeam,
  PRODUCTION_STAGES,
  ProductionService,
  ProductionStage,
  Suggestions,
} from '../../../core/services/production.service';
import { UiService } from '../../../core/services/ui.service';
import { LanguageService } from '../../../core/services/language.service';
import { BadgeService } from '../../../core/services/badge.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { InViewDirective } from './in-view.directive';
import { STAGE_META, cardDisplayLabel, cardDisplayTone, StageMeta, initial, masterLabel, shortDate, swatchBackground } from './production.utils';

interface ColumnState extends BoardColumn {
  loadingMore: boolean;
  loadError: boolean;
}

interface Filters {
  search: string;
  masterId: string | null;
  rush: boolean;
  delayed: boolean;
}

const PAGE_SIZE = 15;

@Component({
  selector: 'app-partner-production',
  standalone: true,
  imports: [CanDirective, 
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    CdkScrollable,
    IonSpinner,
    SearchInputComponent,
    EmptyStateComponent,
    InViewDirective,
    ApprovalChipComponent,
  ],
  templateUrl: './production.page.html',
  styleUrls: ['./production.page.scss'],
})
export class PartnerProductionPage implements OnInit {
  private production = inject(ProductionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private destroyRef = inject(DestroyRef);
  readonly lang = inject(LanguageService);
  private auth = inject(AuthService);
  /** May this person change things here? View-only people see the data but no working buttons (the server re-checks every request). */
  readonly canEdit = computed(() => this.auth.can('production.update'));

  // ───────── Board state ─────────
  readonly columns = signal<ColumnState[]>([]);
  readonly delayedCount = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filters = signal<Filters>({ search: '', masterId: null, rush: false, delayed: false });

  readonly masters = signal<MasterTeam[]>([]);
  readonly suggestion = signal<Suggestions | null>(null);

  /** Cards with a request in flight (drag disabled, buttons spinning). */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  readonly dragging = signal(false);
  /** Dragging cards between columns is switched off for now (set to false to bring it back). */
  readonly dragDisabled = true;

  readonly totalArticles = computed(() => this.columns().reduce((sum, c) => sum + (c.total || 0), 0));
  readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.search || f.masterId || f.rush || f.delayed);
  });
  readonly activeMasterName = computed(() => {
    const id = this.filters().masterId;
    return id ? this.masters().find((m) => m.id === id)?.name ?? null : null;
  });

  readonly todayLabel = formatToday();
  readonly cardLabel = cardDisplayLabel;
  readonly cardTone = cardDisplayTone;
  readonly dragDelay: DragStartDelay = { touch: 220, mouse: 0 };
  readonly stages = PRODUCTION_STAGES;
  readonly skeletonCards = [0, 1, 2];

  /** Re-mounts the search box when the search changes from the URL (e.g. a notification link). */
  readonly searchKey = signal(0);
  private lastSearch = '';

  // ───────── Scan modal ─────────
  readonly scanOpen = signal(false);
  readonly scanCode = signal('');
  readonly scanning = signal(false);
  readonly scanResults = signal<Card[] | null>(null);
  readonly scanMessage = signal<string | null>(null);

  private load$ = new Subject<Filters>();
  private columnSubs = new Map<ProductionStage, Subscription>();
  private dragEndTimer: ReturnType<typeof setTimeout> | null = null;

  readonly masterLabel = masterLabel;
  readonly initial = initial;
  readonly shortDate = shortDate;

  ngOnInit(): void {
    // Whole-board loads: every filter change goes through the URL, stale requests are cancelled.
    this.load$
      .pipe(
        tap(() => {
          this.cancelColumnLoads();
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((f) =>
          this.production.board(toApiFilters(f), PAGE_SIZE).pipe(
            map((board) => ({ board, err: null as unknown })),
            catchError((err) => of({ board: null, err }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ board, err }) => {
        this.loading.set(false);
        if (!board) {
          this.error.set(apiErrorMessage(err));
          return;
        }
        this.delayedCount.set(board.delayedCount || 0);
        this.columns.set(
          PRODUCTION_STAGES.map((stage) => {
            const col = board.columns.find((c) => c.stage === stage);
            return {
              stage,
              label: col?.label ?? STAGE_META[stage].en,
              items: col?.items ?? [],
              total: col?.total ?? 0,
              nextCursor: col?.nextCursor ?? null,
              loadingMore: false,
              loadError: false,
            };
          })
        );
      });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const f = parseFilters(params);
      if (f.search !== this.lastSearch) {
        this.lastSearch = f.search;
        this.searchKey.update((k) => k + 1);
      }
      this.filters.set(f);
      this.load$.next(f);
    });

    this.production
      .teams()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (t) => this.masters.set((t.masters || []).filter((m) => m.is_active !== false)),
        error: () => this.masters.set([]),
      });
    this.loadSuggestion();

    this.destroyRef.onDestroy(() => {
      this.cancelColumnLoads();
      if (this.dragEndTimer) clearTimeout(this.dragEndTimer);
    });
  }

  meta(stage: ProductionStage): StageMeta {
    return STAGE_META[stage];
  }

  swatch(card: Card): string {
    return swatchBackground(card.unit_id || card.id);
  }

  isBusy(id: string): boolean {
    return this.busy().has(id);
  }

  // ───────── Filters (URL is the source of truth) ─────────

  reload(): void {
    this.load$.next(this.filters());
  }

  onSearch(value: string): void {
    this.lastSearch = value;
    this.setQuery({ search: value || null });
  }

  setMaster(id: string | null): void {
    this.setQuery({ master: id });
  }

  toggleRush(): void {
    this.setQuery({ rush: this.filters().rush ? null : 'true' });
  }

  toggleDelayed(): void {
    this.setQuery({ delayed: this.filters().delayed ? null : 'true' });
  }

  clearFilters(): void {
    this.lastSearch = '';
    this.searchKey.update((k) => k + 1);
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  private setQuery(patch: Record<string, string | null>): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ───────── Infinite scroll per column ─────────

  loadMore(stage: ProductionStage): void {
    const col = this.columns().find((c) => c.stage === stage);
    if (!col || !col.nextCursor || col.loadingMore) return;
    this.patchColumn(stage, { loadingMore: true, loadError: false });

    this.columnSubs.get(stage)?.unsubscribe();
    const sub = this.production.column(stage, col.nextCursor, toApiFilters(this.filters()), PAGE_SIZE).subscribe({
      next: (page) => {
        this.columns.update((cols) =>
          cols.map((c) => {
            if (c.stage !== stage) return c;
            const seen = new Set(c.items.map((i) => i.id));
            // Keep the column total from the first page (later pages report "remaining").
            return { ...c, items: [...c.items, ...page.items.filter((i) => !seen.has(i.id))], nextCursor: page.nextCursor, loadingMore: false };
          })
        );
        this.columnSubs.delete(stage);
      },
      error: (err) => {
        this.patchColumn(stage, { loadingMore: false, loadError: true });
        this.columnSubs.delete(stage);
        this.ui.error(err);
      },
    });
    this.columnSubs.set(stage, sub);
  }

  private cancelColumnLoads(): void {
    this.columnSubs.forEach((s) => s.unsubscribe());
    this.columnSubs.clear();
  }

  private patchColumn(stage: ProductionStage, patch: Partial<ColumnState>): void {
    this.columns.update((cols) => cols.map((c) => (c.stage === stage ? { ...c, ...patch } : c)));
  }

  // ───────── Drag & drop ─────────

  onDragStart(): void {
    if (this.dragEndTimer) clearTimeout(this.dragEndTimer);
    this.dragging.set(true);
  }

  onDragEnd(): void {
    // The click that follows a drop must not open the card.
    this.dragEndTimer = setTimeout(() => this.dragging.set(false), 80);
  }

  drop(event: CdkDragDrop<ProductionStage, ProductionStage, Card>): void {
    if (!this.canEdit()) return;
    const from = event.previousContainer.data;
    const to = event.container.data;
    const card = event.item.data;
    if (!card || (from === to && event.previousIndex === event.currentIndex)) return;
    if (this.isBusy(card.id)) return;

    const cols = this.columns();
    const source = cols.find((c) => c.stage === from);
    const target = cols.find((c) => c.stage === to);
    if (!source || !target) return;

    const fromIndex = source.items.findIndex((i) => i.id === card.id);
    if (fromIndex < 0) return;

    // Optimistic update on copies of the arrays.
    const sourceItems = [...source.items];
    let targetItems: Card[];
    if (from === to) {
      moveItemInArray(sourceItems, fromIndex, event.currentIndex);
      targetItems = sourceItems;
    } else {
      targetItems = [...target.items];
      transferArrayItem(sourceItems, targetItems, fromIndex, event.currentIndex);
    }
    const index = targetItems.findIndex((i) => i.id === card.id);
    targetItems[index] = { ...card, stage: to };
    const prevId = targetItems[index - 1]?.id ?? null;
    const nextId = targetItems[index + 1]?.id ?? null;

    this.columns.update((list) =>
      list.map((c) => {
        if (c.stage === from && from === to) return { ...c, items: targetItems };
        if (c.stage === from) return { ...c, items: sourceItems, total: Math.max(0, c.total - 1) };
        if (c.stage === to) return { ...c, items: targetItems, total: c.total + 1 };
        return c;
      })
    );

    this.setBusy(card.id, true);
    this.production.move(card.id, to, prevId, nextId).subscribe({
      next: ({ data, message }) => {
        this.setBusy(card.id, false);
        this.replaceCard(data.card);
        if (from !== to) {
          this.ui.success(message || `Moved to ${STAGE_META[to].en}`);
          this.badges.refresh();
          if (to === 'cutting' || to === 'stitching') this.loadSuggestion();
        }
      },
      error: (err) => {
        this.setBusy(card.id, false);
        this.revertMove(card, from, to, fromIndex);
        this.ui.error(err);
      },
    });
  }

  /** Put the card back where it was before the failed move (other changes made meanwhile are kept). */
  private revertMove(card: Card, from: ProductionStage, to: ProductionStage, fromIndex: number): void {
    this.columns.update((list) =>
      list.map((c) => {
        let items = c.items.filter((i) => i.id !== card.id);
        let total = c.total;
        if (c.stage === from) {
          items = [...items];
          items.splice(Math.min(fromIndex, items.length), 0, card);
          if (from !== to) total += 1;
        } else if (c.stage === to && from !== to) {
          total = Math.max(0, total - 1);
        }
        return items === c.items && total === c.total ? c : { ...c, items, total };
      })
    );
  }

  private replaceCard(updated: Card): void {
    this.columns.update((list) =>
      list.map((c) => {
        const i = c.items.findIndex((x) => x.id === updated.id);
        if (i < 0) return c;
        const items = [...c.items];
        items[i] = updated;
        return { ...c, items };
      })
    );
  }

  private setBusy(id: string, on: boolean): void {
    this.busy.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // ───────── Assign (To assign column) ─────────

  private loadSuggestion(): void {
    this.production
      .suggestions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (s) => this.suggestion.set(s), error: () => this.suggestion.set(null) });
  }

  assign(card: Card, event: Event): void {
    if (!this.canEdit()) return;
    event.stopPropagation();
    if (this.isBusy(card.id)) return;
    this.setBusy(card.id, true);
    this.production.assign(card.id).subscribe({
      next: ({ data, message }) => {
        this.setBusy(card.id, false);
        const updated = data.card;
        const masterFilter = this.filters().masterId;
        this.columns.update((list) =>
          list.map((c) => {
            if (c.stage === 'to_assign') {
              return { ...c, items: c.items.filter((i) => i.id !== card.id), total: Math.max(0, c.total - 1) };
            }
            if (c.stage === updated.stage) {
              if (masterFilter && updated.master_id !== masterFilter) return c;
              // The server appends to the end of the column; only show it if that end is loaded.
              const items = c.nextCursor ? c.items : [...c.items.filter((i) => i.id !== updated.id), updated];
              return { ...c, items, total: c.total + 1 };
            }
            return c;
          })
        );
        this.ui.success(message || 'Assigned');
        this.badges.refresh();
        this.loadSuggestion();
      },
      error: (err) => {
        this.setBusy(card.id, false);
        this.ui.error(err);
      },
    });
  }

  // ───────── Navigation ─────────

  open(card: Card): void {
    if (this.dragging()) return;
    this.router.navigate(['/partner/production/jobs', card.id]);
  }

  // ───────── Scan ─────────

  openScan(): void {
    this.scanOpen.set(true);
    this.scanResults.set(null);
    this.scanMessage.set(null);
    setTimeout(() => (document.getElementById('scan-code') as HTMLInputElement | null)?.select(), 60);
  }

  closeScan(): void {
    this.scanOpen.set(false);
    this.scanning.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.scanOpen()) this.closeScan();
  }

  submitScan(): void {
    // Barcode scanners type fast and may add whitespace / line breaks.
    const code = this.scanCode().replace(/\s+/g, ' ').trim();
    if (!code || this.scanning()) return;
    this.scanCode.set(code);
    this.scanning.set(true);
    this.scanMessage.set(null);
    this.production.scan(code).subscribe({
      next: (cards) => {
        this.scanning.set(false);
        if (cards.length === 1) {
          this.closeScan();
          this.router.navigate(['/partner/production/jobs', cards[0].id]);
          return;
        }
        this.scanResults.set(cards);
        if (!cards.length) this.scanMessage.set(`No job cards found for “${code}”.`);
      },
      error: (err) => {
        this.scanning.set(false);
        this.scanResults.set(null);
        this.scanMessage.set(apiErrorMessage(err));
      },
    });
  }

  openScanned(card: Card): void {
    this.closeScan();
    this.router.navigate(['/partner/production/jobs', card.id]);
  }

  stageLabel(stage: ProductionStage): string {
    const m = STAGE_META[stage];
    return m ? this.lang.t(m.en, m.ur) : stage;
  }
}

function parseFilters(p: ParamMap): Filters {
  return {
    search: (p.get('search') || '').trim(),
    masterId: p.get('master') || null,
    rush: p.get('rush') === 'true',
    delayed: p.get('delayed') === 'true',
  };
}

function toApiFilters(f: Filters): BoardFilters {
  return {
    search: f.search || null,
    masterId: f.masterId,
    priority: f.rush ? 'rush' : null,
    delayed: f.delayed || null,
  };
}

function formatToday(): string {
  const d = new Date();
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${weekday} ${d.getDate()} ${month}`;
}
