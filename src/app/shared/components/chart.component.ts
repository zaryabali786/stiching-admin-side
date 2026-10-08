import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type ChartKind = 'area' | 'line' | 'bar' | 'hbar' | 'donut';
export interface ChartSeries {
  name: string;
  values: number[];
}

/** Colours for series and slices; the first follows the portal theme's button colour. */
export const CHART_COLORS = ['var(--c-dark-2)', 'var(--c-gold)', 'var(--c-green)', 'var(--c-blue)', 'var(--c-purple)', 'var(--c-amber)', 'var(--c-red)', 'var(--c-faint)'];

export const compact = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n * 100) / 100}`;
};

/**
 * Small dependency-free charts (SVG / CSS): area and line trends, grouped bars, horizontal bars and a donut.
 * Every chart carries a text summary for screen readers.
 */
@Component({
  selector: 'app-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (kind()) {
      @case ('area') { <ng-container *ngTemplateOutlet="trend"></ng-container> }
      @case ('line') { <ng-container *ngTemplateOutlet="trend"></ng-container> }
      @case ('bar') {
        <svg class="svg" viewBox="0 0 320 170" role="img" [attr.aria-label]="summary()">
          @for (g of grid(); track g.y) {
            <line class="grid" x1="30" x2="316" [attr.y1]="g.y" [attr.y2]="g.y" />
            <text class="tick" x="26" [attr.y]="g.y + 3" text-anchor="end">{{ g.label }}</text>
          }
          @for (b of bars(); track $index) {
            <rect class="bar" [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" rx="3" [attr.fill]="b.color"><title>{{ b.title }}</title></rect>
          }
          @for (l of xLabels(); track $index) {
            <text class="tick" [attr.x]="l.x" y="164" text-anchor="middle">{{ l.text }}</text>
          }
        </svg>
        @if (series().length > 1) { <ng-container *ngTemplateOutlet="legend"></ng-container> }
      }
      @case ('hbar') {
        <div class="hbars" role="img" [attr.aria-label]="summary()">
          @for (r of rows(); track r.label) {
            <div class="hrow">
              <span class="hl" [title]="r.label">{{ r.label }}</span>
              <span class="ht"><i [style.width.%]="r.pct" [style.background]="r.color"></i></span>
              <span class="hv">{{ r.text }}</span>
            </div>
          }
        </div>
      }
      @case ('donut') {
        <div class="donut-wrap" role="img" [attr.aria-label]="summary()">
          <svg class="donut" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--c-line)" stroke-width="4.5" />
            @for (s of slices(); track s.label) {
              <circle cx="18" cy="18" r="15.9155" fill="none" stroke-width="4.5" [attr.stroke]="s.color" [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset" transform="rotate(-90 18 18)"><title>{{ s.label }}: {{ s.text }}</title></circle>
            }
            <text x="18" y="19.5" text-anchor="middle" class="donut-total">{{ totalText() }}</text>
          </svg>
          <ul class="dlegend">
            @for (s of slices(); track s.label) {
              <li><i [style.background]="s.color"></i><span class="dl">{{ s.label }}</span><b>{{ s.text }}</b></li>
            }
          </ul>
        </div>
      }
    }

    <ng-template #trend>
      <svg class="svg" viewBox="0 0 320 170" role="img" [attr.aria-label]="summary()">
        <defs>
          <linearGradient [attr.id]="gid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--c-dark-2)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--c-dark-2)" stop-opacity="0" />
          </linearGradient>
        </defs>
        @for (g of grid(); track g.y) {
          <line class="grid" x1="30" x2="316" [attr.y1]="g.y" [attr.y2]="g.y" />
          <text class="tick" x="26" [attr.y]="g.y + 3" text-anchor="end">{{ g.label }}</text>
        }
        @if (kind() === 'area') { <path [attr.d]="areaPath()" [attr.fill]="'url(#' + gid + ')'" /> }
        @for (p of linePaths(); track $index) {
          <path class="line" [attr.d]="p.d" fill="none" [attr.stroke]="p.color" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
        }
        @for (pt of points(); track $index) {
          <circle class="pt" [attr.cx]="pt.x" [attr.cy]="pt.y" r="3" [attr.fill]="pt.color"><title>{{ pt.title }}</title></circle>
        }
        @for (l of xLabels(); track $index) {
          <text class="tick" [attr.x]="l.x" y="164" text-anchor="middle">{{ l.text }}</text>
        }
      </svg>
      @if (series().length > 1) { <ng-container *ngTemplateOutlet="legend"></ng-container> }
    </ng-template>

    <ng-template #legend>
      <div class="legend">
        @for (s of series(); track s.name; let i = $index) { <span><i [style.background]="color(i)"></i>{{ s.name }}</span> }
      </div>
    </ng-template>
  `,
  styles: `
    :host { display: block; }
    .svg { width: 100%; height: auto; display: block; overflow: visible; }
    .grid { stroke: var(--c-line-soft); stroke-width: 1; }
    .tick { font-size: 8.5px; fill: var(--c-faint); }
    .pt { stroke: var(--c-surface); stroke-width: 1.5; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 12px; color: var(--c-muted); span { display: inline-flex; align-items: center; gap: 6px; } i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; } }
    .hbars { display: grid; gap: 9px; }
    .hrow { display: grid; grid-template-columns: minmax(70px, 34%) 1fr auto; gap: 10px; align-items: center; font-size: 12.5px; }
    .hl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-ink-2); }
    .ht { height: 9px; border-radius: 99px; background: var(--c-line-soft); overflow: hidden; i { display: block; height: 100%; border-radius: 99px; transition: width 0.5s ease; } }
    .hv { font-weight: 700; font-variant-numeric: tabular-nums; min-width: 28px; text-align: right; }
    .donut-wrap { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
    .donut { width: 132px; height: 132px; flex: none; }
    .donut-total { font-size: 5.6px; font-weight: 700; fill: var(--c-ink); }
    .dlegend { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; flex: 1; min-width: 140px; font-size: 12.5px; li { display: flex; align-items: center; gap: 8px; } i { width: 10px; height: 10px; border-radius: 3px; flex: none; } .dl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-ink-2); } b { font-variant-numeric: tabular-nums; } }
  `,
  imports: [NgTemplateOutlet],
})
export class ChartComponent {
  readonly kind = input<ChartKind>('area');
  readonly labels = input<string[]>([]);
  readonly series = input<ChartSeries[]>([]);
  /** 'pkr' shortens big money values (12.5k). */
  readonly format = input<'num' | 'pkr'>('num');

  protected readonly gid = `g${Math.random().toString(36).slice(2, 8)}`;
  protected color = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
  private fmt = (n: number) => (this.format() === 'pkr' ? 'PKR ' + compact(n) : compact(n));

  private readonly max = computed(() => {
    const all = this.series().flatMap((s) => s.values);
    const m = Math.max(0, ...all);
    return m <= 0 ? 1 : m;
  });

  protected readonly summary = computed(() => {
    const labels = this.labels();
    return this.series().map((s) => `${s.name}: ` + s.values.map((v, i) => `${labels[i] ?? i + 1} ${this.fmt(v)}`).join(', ')).join('. ');
  });

  /** Horizontal guide lines with their value labels (top, middle, zero). */
  protected readonly grid = computed(() => {
    const m = this.max();
    return [0, 0.5, 1].map((f) => ({ y: 10 + (1 - f) * 134, label: compact(m * f) }));
  });

  private x = (i: number, n: number) => (n <= 1 ? 173 : 34 + (i * 278) / (n - 1));
  private y = (v: number) => 144 - (v / this.max()) * 134;

  protected readonly points = computed(() =>
    this.series().flatMap((s, si) =>
      this.labels().length > 40
        ? []
        : s.values.map((v, i) => ({ x: this.x(i, s.values.length), y: this.y(v), color: this.color(si), title: `${this.labels()[i] ?? ''}: ${this.fmt(v)}` }))
    )
  );

  protected readonly linePaths = computed(() =>
    this.series().map((s, si) => ({ color: this.color(si), d: s.values.map((v, i) => `${i ? 'L' : 'M'}${this.x(i, s.values.length).toFixed(1)} ${this.y(v).toFixed(1)}`).join(' ') }))
  );

  protected readonly areaPath = computed(() => {
    const s = this.series()[0];
    if (!s || !s.values.length) return '';
    const n = s.values.length;
    const line = s.values.map((v, i) => `${i ? 'L' : 'M'}${this.x(i, n).toFixed(1)} ${this.y(v).toFixed(1)}`).join(' ');
    return `${line} L${this.x(n - 1, n).toFixed(1)} 144 L${this.x(0, n).toFixed(1)} 144 Z`;
  });

  /** About six evenly spread labels under the chart. */
  protected readonly xLabels = computed(() => {
    const labels = this.labels();
    const n = labels.length;
    if (!n) return [];
    const step = Math.max(1, Math.ceil(n / 6));
    const isBar = this.kind() === 'bar';
    return labels.map((text, i) => ({ text, i })).filter(({ i }) => i % step === 0 || i === n - 1).map(({ text, i }) => ({ text, x: isBar ? 30 + ((i + 0.5) * 286) / n : this.x(i, n) }));
  });

  protected readonly bars = computed(() => {
    const labels = this.labels();
    const series = this.series();
    const n = labels.length;
    if (!n || !series.length) return [];
    const group = 286 / n;
    const inner = group * 0.7;
    const bw = inner / series.length;
    return series.flatMap((s, si) =>
      s.values.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, (v / this.max()) * 134);
        return { x: 30 + i * group + (group - inner) / 2 + si * bw, y: 144 - h, w: Math.max(1, bw - 1.5), h, color: this.color(si), title: `${s.name}, ${labels[i]}: ${this.fmt(v)}` };
      })
    );
  });

  protected readonly rows = computed(() => {
    const values = this.series()[0]?.values ?? [];
    const labels = this.labels();
    const m = Math.max(1, ...values);
    return values.map((v, i) => ({ label: labels[i] ?? '', pct: Math.round((v / m) * 100), text: this.fmt(v), color: this.color(0) }));
  });

  private readonly total = computed(() => (this.series()[0]?.values ?? []).reduce((a, b) => a + b, 0));
  protected readonly totalText = computed(() => this.fmt(this.total()));

  protected readonly slices = computed(() => {
    const values = this.series()[0]?.values ?? [];
    const labels = this.labels();
    const total = this.total() || 1;
    let acc = 0;
    return values.map((v, i) => {
      const pct = (v / total) * 100;
      const slice = { label: labels[i] ?? '', color: this.color(i), dash: `${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`, offset: (-acc).toFixed(2), text: this.fmt(v) };
      acc += pct;
      return slice;
    });
  });
}

