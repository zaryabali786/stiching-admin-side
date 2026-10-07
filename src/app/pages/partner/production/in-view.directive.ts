import { Directive, ElementRef, OnDestroy, OnInit, inject, input, output } from '@angular/core';

/**
 * Emits `inView` when the host element scrolls into view inside `inViewRoot` (or the viewport).
 * Used as an infinite-scroll sentinel at the end of each board column. The sentinel is re-created
 * after every page load, so a fresh observer re-checks visibility (keeps loading while the column
 * is not yet full).
 */
@Directive({
  selector: '[appInView]',
  standalone: true,
})
export class InViewDirective implements OnInit, OnDestroy {
  readonly inViewRoot = input<HTMLElement | null>(null);
  readonly inViewMargin = input('0px 0px 240px 0px');
  readonly inView = output<void>();

  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer?: IntersectionObserver;

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => this.inView.emit());
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) this.inView.emit();
      },
      { root: this.inViewRoot(), rootMargin: this.inViewMargin(), threshold: 0 }
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
