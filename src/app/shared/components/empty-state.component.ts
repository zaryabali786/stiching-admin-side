import { Component, input, output } from '@angular/core';

/**
 * Empty / error placeholder.
 * <app-empty-state title="No orders yet" message="…" />
 * <app-empty-state kind="error" [message]="error()" (retry)="load()" />
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  template: `
    <div class="empty" [class.error]="kind() === 'error'">
      <div class="icon">{{ kind() === 'error' ? '!' : icon() }}</div>
      <h4>{{ title() || (kind() === 'error' ? 'Could not load data' : 'Nothing here yet') }}</h4>
      @if (message()) { <p>{{ message() }}</p> }
      @if (kind() === 'error') {
        <button type="button" class="btn btn-sm" (click)="retry.emit()">Try again</button>
      }
      <ng-content />
    </div>
  `,
  styles: [`
    .empty { text-align: center; padding: 42px 20px; color: var(--c-muted); display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .icon { width: 46px; height: 46px; border-radius: 50%; background: var(--c-bg); display: flex; align-items: center; justify-content: center; font-size: 20px; color: var(--c-gold-dark); margin-bottom: 4px; }
    .error .icon { background: var(--c-red-soft); color: var(--c-red); font-weight: 700; }
    h4 { font-family: var(--font-sans); font-size: 17px; font-weight: 600; color: var(--c-ink); }
    p { margin: 0; font-size: 13px; max-width: 420px; }
  `],
})
export class EmptyStateComponent {
  readonly kind = input<'empty' | 'error'>('empty');
  readonly title = input<string>('');
  readonly message = input<string | null>('');
  readonly icon = input<string>('◇');
  readonly retry = output<void>();
}
