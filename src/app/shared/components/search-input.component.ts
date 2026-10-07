import { Component, DestroyRef, OnInit, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

/**
 * Debounced search box. Emits `search` 350 ms after the user stops typing (or immediately on Enter / clear).
 * <app-search-input placeholder="Search orders…" [value]="search()" (search)="onSearch($event)" />
 */
@Component({
  selector: 'app-search-input',
  standalone: true,
  template: `
    <div class="search-box">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.42 1.4-5.39-5.38A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>
      <input
        type="search"
        [placeholder]="placeholder()"
        [value]="text()"
        (input)="onInput($any($event.target).value)"
        (keydown.enter)="emitNow()"
        [attr.aria-label]="placeholder()" />
      @if (text()) {
        <button type="button" class="clear" (click)="clear()" aria-label="Clear search">×</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; flex: 1; min-width: 220px; max-width: 420px; }
    .search-box {
      position: relative; display: flex; align-items: center;
      background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 999px;
      padding: 0 12px; height: 40px; color: var(--c-faint);
      transition: border-color .15s, box-shadow .15s;
    }
    .search-box:focus-within { border-color: var(--c-green); box-shadow: var(--focus-ring); color: var(--c-green); }
    input { flex: 1; border: none; outline: none; background: transparent; font: inherit; font-size: 13px; color: var(--c-ink); padding: 0 8px; min-width: 0; }
    input::-webkit-search-cancel-button { display: none; }
    .clear { border: none; background: var(--c-bg); color: var(--c-muted); width: 22px; height: 22px; border-radius: 50%; cursor: pointer; font-size: 15px; line-height: 1; }
  `],
})
export class SearchInputComponent implements OnInit {
  readonly placeholder = input('Search…');
  readonly value = input('');
  readonly search = output<string>();

  readonly text = signal('');
  private input$ = new Subject<string>();
  private destroyRef = inject(DestroyRef);
  private last = '';

  constructor() {
    // Follow external changes (e.g. a deep link changes ?search= while the page stays open)
    effect(() => {
      const v = this.value() || '';
      untracked(() => {
        if (v !== this.last) {
          this.text.set(v);
          this.last = v;
        }
      });
    });
  }

  ngOnInit(): void {
    this.text.set(this.value() || '');
    this.last = this.text();
    this.input$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.emit(v));
  }

  onInput(v: string): void {
    this.text.set(v);
    this.input$.next(v.trim());
  }

  emitNow(): void {
    this.emit(this.text().trim());
  }

  clear(): void {
    this.text.set('');
    this.emit('');
  }

  private emit(v: string): void {
    if (v === this.last) return;
    this.last = v;
    this.search.emit(v);
  }
}
