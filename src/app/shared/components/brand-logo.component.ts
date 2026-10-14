import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/** A brand's logo in a fixed square. A brand without a logo (or a logo that fails to load) shows its first letter. */
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="bl" [style.width.px]="size()" [style.height.px]="size()" [style.fontSize.px]="size() * 0.42" [attr.title]="name() || null">
      @if (url() && !failed()) {
        <img [src]="url()" [alt]="name() ? name() + ' logo' : ''" loading="lazy" referrerpolicy="no-referrer" (error)="failed.set(true)" />
      } @else {
        <span aria-hidden="true">{{ initial() }}</span>
      }
    </span>
  `,
  styles: `
    :host { display: inline-flex; flex: none; }
    .bl { display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; overflow: hidden; background: var(--c-neutral-soft, #f1efe9); border: 1px solid var(--c-line, #e6e2d8); color: var(--c-muted, #7a7467); font-weight: 700; }
    img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
  `,
})
export class BrandLogoComponent {
  readonly url = input<string | null | undefined>(null);
  readonly name = input<string | null | undefined>(null);
  readonly size = input(36);
  protected readonly failed = signal(false);
  protected readonly initial = computed(() => (this.name() || '?').trim().charAt(0).toUpperCase());
}
