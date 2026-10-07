import { Component, computed, effect, input, signal, untracked } from '@angular/core';

/** Small live microphone level bar. `level` is 0..1. */
@Component({
  selector: 'app-level-meter',
  standalone: true,
  template: `<span class="meter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct()" [class.quiet]="quiet()"><span class="bar" [style.width.%]="pct()"></span></span>`,
  styles: [`
    :host { display: inline-block; }
    .meter { display: block; width: 90px; height: 8px; border-radius: 99px; background: var(--c-line); overflow: hidden; }
    .bar { display: block; height: 100%; border-radius: 99px; background: var(--c-green); transition: width .08s linear; }
    .meter.quiet .bar { background: var(--c-amber); }
    @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
  `],
})
export class LevelMeterComponent {
  readonly level = input(0);
  /** Dim colour while nothing has been heard yet. */
  readonly quiet = input(false);
  /** Speech peaks around 0.1-0.5: stretch so ordinary talking fills most of the bar. */
  readonly pct = computed(() => Math.round(Math.min(1, this.level() * 2.5) * 100));
}

const BAR_COUNT = 32;

/** WhatsApp-style live bars: each new `level` (0..1) sample enters on the right and older ones scroll left. */
@Component({
  selector: 'app-level-bars',
  standalone: true,
  template: `<span class="bars" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="now()" [class.quiet]="quiet()">@for (h of heights(); track $index) { <i [style.height.%]="h"></i> }</span>`,
  styles: [`
    :host { display: block; flex: 1; min-width: 0; }
    .bars { display: flex; align-items: center; justify-content: flex-end; gap: 2px; height: 28px; overflow: hidden; }
    i { display: block; flex: 0 0 3px; min-height: 3px; border-radius: 99px; background: var(--c-dark-2); transition: height .08s linear; }
    .quiet i { background: var(--c-faint); }
    @media (prefers-reduced-motion: reduce) { i { transition: none; } }
  `],
})
export class LevelBarsComponent {
  readonly level = input(0);
  readonly quiet = input(false);
  /** Freeze the bars (maximum length reached). */
  readonly paused = input(false);
  private readonly history = signal<number[]>(Array(BAR_COUNT).fill(0));
  readonly heights = computed(() => this.history().map((v) => Math.max(10, Math.round(v * 100))));
  readonly now = computed(() => Math.round((this.history()[BAR_COUNT - 1] ?? 0) * 100));

  constructor() {
    // The recorder reports a level roughly every 100 ms; each report becomes the newest bar.
    effect(() => {
      const l = this.level();
      if (untracked(() => this.paused())) return;
      const v = Math.min(1, l * 2.5);
      untracked(() => this.history.update((h) => [...h.slice(1), v]));
    });
  }
}
