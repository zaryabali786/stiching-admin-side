import { ChangeDetectionStrategy, Component, ElementRef, HostListener, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Card } from '../../../core/services/production.service';
import { UiService } from '../../../core/services/ui.service';
import { SheetMode, buildArticleSheets } from './article-sheet';

/**
 * Print preview of ONE article (the card it was opened from): an A4 job sheet or a 100 x 150 mm label.
 * The sheet is its own small document shown in a frame, and "Print" prints that frame only, so no menu, button or board is ever printed.
 * "Open in a new tab" is there for phones and tablets whose browsers will not print a frame.
 */
@Component({
  selector: 'app-article-print-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="apd-backdrop" (click)="closed.emit()"></div>
    <section class="apd" role="dialog" aria-modal="true" aria-labelledby="apd-title">
      <header class="apd-head">
        <div class="apd-title">
          <span class="apd-eyebrow">Print</span>
          <h3 id="apd-title">@if (cards().length === 1) { {{ cards()[0].unit_title }} <span class="apd-ref">{{ cards()[0].order_reference }}</span> } @else { {{ cards().length }} article sheets }</h3>
        </div>
        <div class="apd-modes" role="group" aria-label="Paper">
          <button type="button" [class.on]="mode() === 'a4'" [attr.aria-pressed]="mode() === 'a4'" (click)="mode.set('a4')">A4 sheet</button>
          <button type="button" [class.on]="mode() === 'label'" [attr.aria-pressed]="mode() === 'label'" (click)="mode.set('label')">Label 100×150 mm</button>
        </div>
        <button type="button" class="apd-x" (click)="closed.emit()" aria-label="Close">×</button>
      </header>

      <div #stage class="apd-stage">
        <div class="apd-paper" [style.width.px]="paper().w * scale()" [style.height.px]="paper().h * scale()">
          <iframe #frame class="apd-frame" title="Print preview" [srcdoc]="html()" [style.width.px]="paper().w" [style.height.px]="paper().h" [style.transform]="'scale(' + scale() + ')'"></iframe>
        </div>
      </div>

      <footer class="apd-foot">
        <button type="button" class="btn" (click)="openTab()">Open in a new tab</button>
        <button type="button" class="btn btn-primary" (click)="print()">Print</button>
      </footer>
    </section>
  `,
  styles: [`
    :host { display: contents; }
    .apd-backdrop { position: fixed; inset: 0; background: rgba(15, 18, 24, 0.5); z-index: 1100; }
    .apd { position: fixed; inset: 16px; z-index: 1101; display: flex; flex-direction: column; max-width: 980px; margin: 0 auto; background: var(--c-surface, #fff); border-radius: 16px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3); overflow: hidden; }
    .apd-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--c-line-soft, #e5e7eb); }
    .apd-title { flex: 1; min-width: 160px; }
    .apd-eyebrow { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--c-muted, #6b7280); }
    h3 { margin: 0; font-size: 17px; overflow-wrap: anywhere; }
    .apd-ref { margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--c-muted, #6b7280); }
    .apd-modes { display: inline-flex; border: 1px solid var(--c-line, #d1d5db); border-radius: 999px; overflow: hidden; }
    .apd-modes button { border: 0; background: transparent; padding: 8px 14px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--c-muted, #6b7280); min-height: 38px; }
    .apd-modes button.on { background: var(--c-dark-2, #1f2937); color: #fff; }
    .apd-x { border: 0; background: transparent; font-size: 26px; line-height: 1; cursor: pointer; width: 40px; height: 40px; }
    .apd-stage { flex: 1; min-height: 0; overflow: auto; background: #e9e9ee; padding: 14px; display: flex; justify-content: center; align-items: flex-start; }
    .apd-paper { position: relative; flex: none; }
    .apd-frame { position: absolute; left: 0; top: 0; border: 0; background: #fff; transform-origin: top left; box-shadow: 0 2px 14px rgba(0, 0, 0, 0.2); }
    .apd-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--c-line-soft, #e5e7eb); }
    @media (max-width: 640px) {
      .apd { inset: 0; border-radius: 0; }
      .apd-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 10px; }
      .apd-modes { grid-column: 1 / -1; grid-row: 2; width: 100%; } .apd-modes button { flex: 1; }
      .apd-foot .btn { flex: 1; justify-content: center; min-height: 46px; }
    }
  `],
})
export class ArticlePrintDialogComponent {
  private sanitizer = inject(DomSanitizer);
  private ui = inject(UiService);

  /** The articles to print: one (from a row) or several (a bulk selection): every one on its own page or label. */
  readonly cards = input.required<Card[]>();
  readonly closed = output<void>();

  readonly mode = signal<SheetMode>('a4');
  private readonly source = computed(() => buildArticleSheets(this.cards(), this.mode()));
  readonly html = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.source()));

  /** The paper in CSS pixels (96 per inch): A4 = 210 x 297 mm, label = 100 x 150 mm; the preview shrinks it to fit the screen. */
  readonly paper = computed(() => (this.mode() === 'a4' ? { w: 794, h: 1123 } : { w: 378, h: 567 }));
  private readonly stageWidth = signal(900);
  readonly scale = computed(() => Math.min(1, Math.max(0.3, (this.stageWidth() - 28) / this.paper().w)));

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');

  constructor() {
    afterNextRender(() => {
      const el = this.stage().nativeElement;
      this.stageWidth.set(el.clientWidth);
      new ResizeObserver(() => this.stageWidth.set(el.clientWidth)).observe(el);
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.closed.emit();
  }

  /** Print the frame (the sheet only). */
  print(): void {
    const win = this.frame().nativeElement.contentWindow;
    if (!win) {
      this.openTab();
      return;
    }
    try {
      win.focus();
      win.print();
    } catch {
      this.openTab();
    }
  }

  /** The same sheet in its own tab, where any browser (a phone included) can print or save it as PDF. */
  openTab(): void {
    const url = URL.createObjectURL(new Blob([this.source()], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) this.ui.error('Your browser blocked the new tab. Allow pop-ups for this site and try again.');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
