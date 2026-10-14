import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  cubeOutline, cashOutline, trendingUpOutline, walletOutline, pricetagOutline, personAddOutline, peopleOutline, checkmarkDoneOutline,
  constructOutline, documentTextOutline, cardOutline, timeOutline, alertCircleOutline, speedometerOutline, earthOutline, analyticsOutline,
  statsChartOutline, barChartOutline, listOutline, pieChartOutline, storefrontOutline, globeOutline, colorFilterOutline, businessOutline,
  flashOutline, addOutline, closeOutline, calendarOutline, chevronDownOutline, reorderTwoOutline, arrowUpOutline, arrowDownOutline, arrowForwardOutline, optionsOutline, refreshOutline, gridOutline,
} from 'ionicons/icons';
import { AdminService, DashSize, DashWidget, DashboardData } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';
import { TimeAgoPipe } from '../../../shared/pipes';
import { ChartComponent, compact } from '../../../shared/components/chart.component';
import { ChartDef, KpiDef, WIDGETS, WIDGET_MAP, WidgetCategory, WidgetDef, defaultLayout, newWidget, SIZE_LABEL } from './dashboard-widgets';

const CACHE_KEY = 'admin-dashboard-layout';

/** Local date as YYYY-MM-DD (what the date inputs and the API use). */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const daysBack = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const QUICK_RANGES: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'Today', range: () => ({ from: iso(new Date()), to: iso(new Date()) }) },
  { label: 'Yesterday', range: () => ({ from: iso(daysBack(1)), to: iso(daysBack(1)) }) },
  { label: 'This week', range: () => { const d = new Date(); const diff = (d.getDay() + 6) % 7; return { from: iso(daysBack(diff)), to: iso(new Date()) }; } },
  { label: 'This month', range: () => { const d = new Date(); return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(d) }; } },
  { label: 'Last month', range: () => { const d = new Date(); return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) }; } },
  { label: 'This year', range: () => { const d = new Date(); return { from: iso(new Date(d.getFullYear(), 0, 1)), to: iso(d) }; } },
];
const DAYS = [7, 30, 90, 180, 365];

@Component({
  selector: 'app-admin-overview',
  standalone: true,
  imports: [RouterLink, TimeAgoPipe, ChartComponent, CdkDropList, CdkDrag, CdkDragHandle, IonIcon, IonSpinner],
  templateUrl: './overview.page.html',
  styleUrls: ['./overview.page.scss'],
})
export class AdminOverviewPage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private destroyRef = inject(DestroyRef);

  readonly periods = DAYS.map((d) => ({ value: d, label: d === 365 ? '1 year' : d === 180 ? '6 months' : `${d} days` }));
  readonly sizes: DashSize[] = ['s', 'm', 'l', 'xl'];
  readonly sizeLabel = SIZE_LABEL;
  readonly categories: WidgetCategory[] = ['Numbers', 'Charts', 'Lists'];
  readonly todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  readonly days = signal(30);
  /** An exact date range chosen in the picker (null = one of the preset periods). */
  readonly custom = signal<{ from: string; to: string } | null>(null);
  readonly rangeOpen = signal(false);
  readonly draftFrom = signal('');
  readonly draftTo = signal('');
  readonly todayIso = iso(new Date());
  readonly quick = QUICK_RANGES;
  readonly draftDays = computed(() => {
    const f = this.draftFrom();
    const t = this.draftTo();
    if (!f || !t || t < f) return 0;
    return Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1;
  });
  readonly rangeValid = computed(() => this.draftDays() > 0 && this.draftDays() <= 366 && this.draftTo() <= this.todayIso);
  readonly data = signal<DashboardData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly widgets = signal<DashWidget[]>(readCache() ?? defaultLayout());
  private savedJson = JSON.stringify(this.widgets());
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly adding = signal(false);
  readonly addTab = signal<WidgetCategory>('Numbers');
  readonly dirty = computed(() => JSON.stringify(this.widgets()) !== this.savedJson);
  readonly gallery = computed(() => WIDGETS.filter((w) => w.category === this.addTab()));

  constructor() {
    addIcons({
      cubeOutline, cashOutline, trendingUpOutline, walletOutline, pricetagOutline, personAddOutline, peopleOutline, checkmarkDoneOutline,
      constructOutline, documentTextOutline, cardOutline, timeOutline, alertCircleOutline, speedometerOutline, earthOutline, analyticsOutline,
      statsChartOutline, barChartOutline, listOutline, pieChartOutline, storefrontOutline, globeOutline, colorFilterOutline, businessOutline,
      flashOutline, addOutline, closeOutline, calendarOutline, chevronDownOutline, reorderTwoOutline, arrowUpOutline, arrowDownOutline, arrowForwardOutline, optionsOutline, refreshOutline, gridOutline,
    });
  }

  ngOnInit(): void {
    this.loadData();
    this.admin
      .getDashboardLayout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          if (r.widgets?.length) this.applyLayout(r.widgets.filter((w) => WIDGET_MAP.has(w.type)));
        },
        error: () => undefined,
      });
  }

  private applyLayout(widgets: DashWidget[]): void {
    this.widgets.set(widgets);
    this.savedJson = JSON.stringify(widgets);
    writeCache(widgets);
  }

  // ───────── data ─────────
  loadData(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admin
      .getDashboard(this.custom() ?? this.days())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(apiErrorMessage(err, 'Could not load the dashboard.'));
          this.loading.set(false);
        },
      });
  }

  setDays(d: number): void {
    if (d === this.days() && !this.custom()) return;
    this.days.set(d);
    this.custom.set(null);
    this.rangeOpen.set(false);
    this.loadData();
  }

  toggleRange(): void {
    if (!this.rangeOpen()) {
      const c = this.custom();
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 29);
      this.draftFrom.set(c?.from ?? iso(start));
      this.draftTo.set(c?.to ?? iso(end));
    }
    this.rangeOpen.set(!this.rangeOpen());
  }

  pickQuick(q: { label: string; range: () => { from: string; to: string } }): void {
    const r = q.range();
    this.draftFrom.set(r.from);
    this.draftTo.set(r.to);
  }

  applyRange(): void {
    if (!this.rangeValid()) return;
    this.custom.set({ from: this.draftFrom(), to: this.draftTo() });
    this.rangeOpen.set(false);
    this.loadData();
  }

  customLabel = computed(() => {
    const c = this.custom();
    return c ? `${shortDate(c.from)} – ${shortDate(c.to)}` : 'Custom range';
  });

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.rangeOpen() && !(e.target as HTMLElement).closest('.range-wrap')) this.rangeOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.rangeOpen.set(false);
  }

  periodText = computed(() => {
    const c = this.custom();
    return c ? `${shortDate(c.from)} to ${shortDate(c.to)}` : this.periods.find((p) => p.value === this.days())?.label ?? '';
  });

  // ───────── widget helpers ─────────
  def(type: string): WidgetDef | undefined {
    return WIDGET_MAP.get(type);
  }

  kpiValue(def: KpiDef, d: DashboardData): string {
    const v = def.value(d);
    if (v === null || v === undefined) return '—';
    if (def.format === 'pkr') return 'PKR ' + (Math.abs(v) >= 100000 ? compact(v) : Math.round(v).toLocaleString('en-US'));
    if (def.format === 'days') return `${v} d`;
    if (def.format === 'pct') return `${v}%`;
    return v.toLocaleString('en-US');
  }

  chart(def: ChartDef, d: DashboardData) {
    return def.data(d);
  }

  hasChartData(def: ChartDef, d: DashboardData): boolean {
    return def.data(d).series.some((s) => s.values.some((v) => v > 0));
  }

  statusLabel(status: string): string {
    return status.replace(/_/g, ' ');
  }

  // ───────── editing ─────────
  startEdit(): void {
    this.editing.set(true);
  }

  drop(e: CdkDragDrop<DashWidget[]>): void {
    if (e.previousIndex === e.currentIndex) return;
    this.widgets.update((list) => {
      const next = [...list];
      moveItemInArray(next, e.previousIndex, e.currentIndex);
      return next;
    });
  }

  setSize(id: string, size: DashSize): void {
    this.widgets.update((list) => list.map((w) => (w.id === id ? { ...w, size } : w)));
  }

  remove(id: string): void {
    this.widgets.update((list) => list.filter((w) => w.id !== id));
  }

  add(def: WidgetDef): void {
    this.widgets.update((list) => [...list, newWidget(def.type)]);
    this.ui.success(`"${def.title}" added at the end of your dashboard.`);
  }

  count(type: string): number {
    return this.widgets().filter((w) => w.type === type).length;
  }

  cancel(): void {
    this.widgets.set(JSON.parse(this.savedJson));
    this.editing.set(false);
    this.adding.set(false);
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.admin.saveDashboardLayout(this.widgets()).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.applyLayout(r.widgets);
        this.editing.set(false);
        this.adding.set(false);
        this.ui.success('Dashboard saved.');
      },
      error: (err) => {
        this.saving.set(false);
        this.ui.error(err);
      },
    });
  }

  async resetLayout(): Promise<void> {
    const ok = await this.ui.confirm({ title: 'Reset your dashboard?', message: 'You go back to the standard set of widgets. Your own arrangement is removed.', confirmText: 'Reset', danger: true });
    if (!ok) return;
    this.admin.resetDashboardLayout().subscribe({
      next: () => {
        const fresh = defaultLayout();
        this.widgets.set(fresh);
        this.savedJson = JSON.stringify(fresh);
        writeCache(null);
        this.editing.set(false);
        this.ui.success('Dashboard reset.');
      },
      error: (err) => this.ui.error(err),
    });
  }
}

function readCache(): DashWidget[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const list = raw ? (JSON.parse(raw) as DashWidget[]) : null;
    return list?.length ? list.filter((w) => WIDGET_MAP.has(w.type)) : null;
  } catch {
    return null;
  }
}

function writeCache(widgets: DashWidget[] | null): void {
  try {
    if (widgets) localStorage.setItem(CACHE_KEY, JSON.stringify(widgets));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
