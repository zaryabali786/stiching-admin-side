import { AuthService } from '../../../core/services/auth.service';
import { CanDirective } from '../../../shared/can.directive';
import { ApprovalChipComponent } from '../../../shared/components/approval-chip.component';
import { Component, DestroyRef, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Observable, Subject, Subscription, catchError, debounceTime, firstValueFrom, map, of, switchMap, tap } from 'rxjs';

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
import { PartnerService } from '../../../core/services/partner.service';
import { UiService } from '../../../core/services/ui.service';
import { LanguageService } from '../../../core/services/language.service';
import { BadgeService } from '../../../core/services/badge.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { ScanReceiveComponent } from '../../../shared/components/scan-receive/scan-receive.component';
import { QrScannerComponent } from '../../../shared/components/qr-scanner.component';
import { ArticlePrintDialogComponent } from '../../../shared/components/article-print/article-print-dialog.component';
import { ProductionOrdersComponent } from './production-orders.component';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
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
    IonSpinner,
    SearchInputComponent,
    ScanReceiveComponent,
    QrScannerComponent,
    ArticlePrintDialogComponent,
    ProductionOrdersComponent,
    EmptyStateComponent,
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
  /** May this person do the stage's button? Assign needs "Assign", moving on needs "Move", packing needs "Pressing and packing". */
  canAct(stage: ProductionStage): boolean {
    if (stage === 'to_assign') return this.auth.can('production.assign');
    if (stage === 'pressing') return this.auth.can('quality.pack');
    return this.auth.can('production.move');
  }
  readonly canScan = computed(() => this.auth.canAny('production.scan', 'quality.scan'));

  // ───────── Board state ─────────
  readonly columns = signal<ColumnState[]>([]);
  readonly delayedCount = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filters = signal<Filters>({ search: '', masterId: null, rush: false, delayed: false });

  readonly masters = signal<MasterTeam[]>([]);
  readonly suggestion = signal<Suggestions | null>(null);

  /** Cards with a request in flight (their buttons spin). */
  readonly busy = signal<ReadonlySet<string>>(new Set());

  // ───────── Stage tabs, selection, bulk actions ─────────
  /** The stage whose table is open (kept in the URL as ?stage=). */
  readonly activeStage = signal<ProductionStage>('to_assign');
  /** On a phone the tab bar scrolls: the open tab is brought into view (also when the page opens on ?stage=…). */
  private readonly keepTabInView = effect(() => {
    this.activeStage();
    setTimeout(() => document.querySelector('.stage-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }), 60);
  });
  readonly activeColumn = computed(() => this.columns().find((c) => c.stage === this.activeStage()) ?? null);
  /** The articles ticked in the open table. */
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly selectedCards = computed(() => (this.activeColumn()?.items ?? []).filter((c) => this.selected().has(c.id)));
  readonly allSelected = computed(() => {
    const items = this.activeColumn()?.items ?? [];
    return items.length > 0 && items.every((c) => this.selected().has(c.id));
  });
  /** A bulk action running: "Moving 3 of 8…". */
  readonly bulk = signal<{ label: string; done: number; total: number } | null>(null);
  /** The master a bulk "Assign" gives the articles to (null = the least busy master for each one). */
  readonly bulkMaster = signal<string | null>(null);

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
  readonly stages = PRODUCTION_STAGES;
  readonly skeletonCards = [0, 1, 2];

  /** Re-mounts the search box when the search changes from the URL (e.g. a notification link). */
  readonly searchKey = signal(0);
  private lastSearch = '';

  /** The article whose sheet is open for printing (always the one card it was opened from). */
  readonly printCards = signal<Card[] | null>(null);

  openPrint(card: Card, event?: Event): void {
    event?.stopPropagation();
    this.printCards.set([card]);
  }

  /** Print the sheets of every ticked article (one page or label each). */
  printSelected(): void {
    const cards = this.selectedCards();
    if (cards.length) this.printCards.set(cards);
  }

  // ───────── Board / by-order view and the QR receive screen ─────────
  readonly view = signal<'board' | 'orders'>('board');
  readonly receiveOpen = signal(false);
  private socket = inject(ChatSocketService);
  private partnerApi = inject(PartnerService);

  // ───────── Scan modal ─────────
  readonly scanOpen = signal(false);
  readonly scanCode = signal('');
  readonly scanning = signal(false);
  readonly scanResults = signal<Card[] | null>(null);
  readonly scanMessage = signal<string | null>(null);

  private load$ = new Subject<Filters>();
  private columnSubs = new Map<ProductionStage, Subscription>();
  private lastFilterKey = '';

  readonly masterLabel = masterLabel;
  readonly initial = initial;
  readonly shortDate = shortDate;

  ngOnInit(): void {
    // an article was received / approved / moved anywhere: the board follows without a manual refresh
    this.socket
      .on('unit:update')
      .pipe(debounceTime(600), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.view() === 'board' && !this.bulk()) this.reload();
      });
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
        const here = new Set((this.activeColumn()?.items ?? []).map((i) => i.id));
        this.selected.update((sel) => new Set([...sel].filter((id) => here.has(id))));
      });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const stage = params.get('stage') as ProductionStage | null;
      const next = stage && PRODUCTION_STAGES.includes(stage) ? stage : 'to_assign';
      if (next !== this.activeStage()) {
        this.activeStage.set(next);
        this.selected.set(new Set());
      }
      const f = parseFilters(params);
      if (f.search !== this.lastSearch) {
        this.lastSearch = f.search;
        this.searchKey.update((k) => k + 1);
      }
      this.filters.set(f);
      const key = JSON.stringify(f);
      if (key !== this.lastFilterKey) {
        this.lastFilterKey = key;
        this.selected.set(new Set());
        this.load$.next(f);
      }
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
    const stage = this.activeStage();
    this.router.navigate([], { relativeTo: this.route, queryParams: stage === 'to_assign' ? {} : { stage }, replaceUrl: true });
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

  // ───────── Stage tabs ─────────

  columnTotal(stage: ProductionStage): number {
    return this.columns().find((c) => c.stage === stage)?.total ?? 0;
  }

  setStage(stage: ProductionStage): void {
    if (stage === this.activeStage()) return;
    this.setQuery({ stage: stage === 'to_assign' ? null : stage });
  }

  // ───────── Ticking articles ─────────

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggle(id: string): void {
    this.selected.update((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleAll(): void {
    const items = this.activeColumn()?.items ?? [];
    this.selected.set(this.allSelected() ? new Set() : new Set(items.map((c) => c.id)));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  // ───────── What each stage's button does ─────────

  /** The one action of a row: Assign (To assign), or "Send to <next stage>". Packed articles have none. */
  stageAction(stage: ProductionStage): { label: string; short: string } | null {
    switch (stage) {
      case 'to_assign': return { label: 'Assign', short: 'Assign' };
      case 'cutting': return { label: 'Send to stitching', short: 'To stitching' };
      case 'stitching': return { label: 'Send to quality check', short: 'To QC' };
      case 'qc': return { label: 'Move to pressing', short: 'To pressing' };
      case 'pressing': return { label: 'Move to packed', short: 'To packed' };
      default: return null;
    }
  }

  /** Why a row's button cannot be used yet (shown as its tooltip), or '' when it can. */
  actionBlocked(card: Card): string {
    if (card.stage === 'to_assign' && !this.suggestion()?.master) return 'No master available. Add one in Teams.';
    if (card.stage === 'qc' && !card.qc_passed) return 'Pass the quality check first (open the job card).';
    if (card.stage === 'qc' && card.approval_status !== 'approved') return 'The customer has not approved the photos yet.';
    return '';
  }

  /** The request behind the action of a card in its stage. */
  private stageRequest(card: Card, masterId: string | null = null): Observable<{ message?: string; data?: unknown }> | null {
    switch (card.stage) {
      case 'to_assign': return this.production.assign(card.id, masterId);
      case 'cutting': return this.production.move(card.id, 'stitching', null, null);
      case 'stitching': return this.production.move(card.id, 'qc', null, null);
      case 'qc': return this.production.move(card.id, 'pressing', null, null);
      case 'pressing': return this.partnerApi.packOrder(card.order_id);
      default: return null;
    }
  }

  /** One row's button. */
  runRow(card: Card, event?: Event): void {
    event?.stopPropagation();
    if (!this.canAct(card.stage) || this.isBusy(card.id)) return;
    const blocked = this.actionBlocked(card);
    if (blocked) {
      this.ui.error(blocked);
      return;
    }
    const request = this.stageRequest(card);
    if (!request) return;
    this.setBusy(card.id, true);
    request.subscribe({
      next: (res) => {
        this.setBusy(card.id, false);
        this.afterMoves([card], res?.message || `${card.unit_title}: done`, [cardOf(res)]);
      },
      error: (err) => {
        this.setBusy(card.id, false);
        this.ui.error(err);
      },
    });
  }

  /** The bulk button: the stage's action for every ticked article, one after another; the ones that fail are listed and stay ticked. */
  async runBulk(): Promise<void> {
    if (!this.canAct(this.activeStage()) || this.bulk()) return;
    const cards = this.selectedCards();
    const action = this.stageAction(this.activeStage());
    if (!cards.length || !action) return;
    const ok: Card[] = [];
    const updated: Card[] = [];
    const failed: string[] = [];
    // an order is packed once, however many of its articles are ticked
    const packedOrders = new Set<string>();
    this.bulk.set({ label: action.label, done: 0, total: cards.length });
    for (const card of cards) {
      const blocked = this.actionBlocked(card);
      if (blocked) {
        failed.push(`${card.unit_title}: ${blocked}`);
      } else if (card.stage === 'pressing' && packedOrders.has(card.order_id)) {
        ok.push(card);
      } else {
        try {
          const res = await firstValueFrom(this.stageRequest(card, card.stage === 'to_assign' ? this.bulkMaster() : null)!);
          ok.push(card);
          updated.push(cardOf(res));
          if (card.stage === 'pressing') packedOrders.add(card.order_id);
        } catch (err) {
          failed.push(`${card.unit_title}: ${apiErrorMessage(err)}`);
        }
      }
      this.bulk.update((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    this.bulk.set(null);
    this.afterMoves(ok, null, updated);
    this.selected.set(new Set(cards.filter((c) => !ok.includes(c)).map((c) => c.id)));
    if (failed.length) this.ui.error(`${ok.length} done, ${failed.length} not moved:\n${failed.slice(0, 5).join('\n')}${failed.length > 5 ? `\n…and ${failed.length - 5} more` : ''}`);
    else this.ui.success(`${ok.length} article${ok.length === 1 ? '' : 's'}: ${action.label.toLowerCase()} done.`);
  }

  /** Articles that moved leave the open tab at once; the board is then re-read so every tab's count and rows are right. */
  private afterMoves(moved: Card[], message: string | null, updated: Card[] = []): void {
    if (moved.length) {
      const gone = new Set(moved.map((c) => c.id));
      const arrived = updated.filter((u): u is Card => !!u && u.stage !== this.activeStage());
      this.columns.update((list) =>
        list.map((c) => {
          if (c.stage === this.activeStage()) return { ...c, items: c.items.filter((i) => !gone.has(i.id)), total: Math.max(0, c.total - gone.size) };
          // the article already shows in the tab it moved to (the board is re-read right after, so counts stay exact)
          const here = arrived.filter((u) => u.stage === c.stage && !c.items.some((i) => i.id === u.id));
          return here.length && !c.nextCursor ? { ...c, items: [...c.items, ...here], total: c.total + here.length } : c;
        })
      );
      this.selected.update((sel) => new Set([...sel].filter((id) => !gone.has(id))));
    }
    if (message) this.ui.success(message);
    this.badges.refresh();
    this.loadSuggestion();
    this.reload();
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

  // ───────── Navigation ─────────

  open(card: Card): void {
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

  /** The camera read a QR code (an article or an order): search with it. */
  onQr(code: string): void {
    this.scanCode.set(code);
    this.submitScan();
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

/** The updated card in the answer of a move / assign (a pack answer has none). */
function cardOf(res: { data?: unknown } | null | undefined): Card {
  return (res?.data as { card?: Card } | undefined)?.card as Card;
}
