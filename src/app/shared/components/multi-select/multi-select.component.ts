import { Component, ElementRef, HostListener, computed, inject, input, model, signal } from '@angular/core';

export interface MultiOption {
  id: string;
  label: string;
  /** A short line under the label. */
  hint?: string;
}

let nextId = 1;

/**
 * A dropdown where several options can be ticked. The chosen ones show as chips in the box (with × to remove one).
 * The list opens below the box in the normal flow, so it is never clipped by a dialog.
 *
 *   <app-multi-select [options]="roles" [(value)]="roleIds" placeholder="Choose roles…" />
 */
@Component({
  selector: 'app-multi-select',
  standalone: true,
  template: `
    <div class="ms" [class.open]="open()" [class.disabled]="disabled()">
      <button type="button" class="ms-box" [disabled]="disabled()" [attr.aria-expanded]="open()" [attr.aria-controls]="uid" aria-haspopup="listbox" (click)="toggle()">
        <span class="ms-values">
          @for (o of chosen(); track o.id) {
            <span class="ms-chip">{{ o.label }}<span class="ms-x" role="button" tabindex="0" [attr.aria-label]="'Remove ' + o.label" (click)="remove(o.id, $event)" (keydown.enter)="remove(o.id, $event)">×</span></span>
          } @empty {
            <span class="ms-placeholder">{{ placeholder() }}</span>
          }
        </span>
        <span class="ms-caret" aria-hidden="true">▾</span>
      </button>
      @if (open()) {
        <div class="ms-panel" [id]="uid" role="listbox" aria-multiselectable="true">
          @for (o of options(); track o.id) {
            <label class="ms-opt" [class.on]="isOn(o.id)">
              <input type="checkbox" [checked]="isOn(o.id)" (change)="toggleOne(o.id)" />
              <span class="ms-text"><span class="ms-label">{{ o.label }}</span>@if (o.hint) { <span class="ms-hint">{{ o.hint }}</span> }</span>
            </label>
          } @empty {
            <div class="ms-empty">{{ emptyText() }}</div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ms-box { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border: 1px solid var(--c-line); border-radius: var(--radius, 12px); background: var(--c-surface); font: inherit; text-align: left; cursor: pointer; }
    .ms-box:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    .ms.open .ms-box { border-color: var(--c-dark-2); }
    .ms.disabled .ms-box { opacity: .6; cursor: not-allowed; }
    .ms-values { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; flex: 1; }
    .ms-placeholder { color: var(--c-muted); font-size: 14px; }
    .ms-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px; border-radius: 999px; background: var(--c-bg-soft); border: 1px solid var(--c-line); font-size: 13px; font-weight: 600; }
    .ms-x { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 15px; line-height: 1; color: var(--c-muted); cursor: pointer; }
    .ms-x:hover { background: var(--c-neutral-soft); color: var(--c-ink); }
    .ms-caret { flex: none; color: var(--c-muted); transition: transform .15s; }
    .ms.open .ms-caret { transform: rotate(180deg); }
    .ms-panel { margin-top: 6px; border: 1px solid var(--c-line); border-radius: var(--radius, 12px); background: var(--c-surface); max-height: 240px; overflow: auto; padding: 4px; box-shadow: 0 6px 18px rgba(0, 0, 0, .08); }
    .ms-opt { display: flex; align-items: flex-start; gap: 10px; padding: 9px 10px; border-radius: 8px; cursor: pointer; }
    .ms-opt:hover { background: var(--c-bg-soft); }
    .ms-opt.on { background: var(--c-bg-soft); }
    .ms-opt input { width: 17px; height: 17px; margin-top: 2px; accent-color: var(--c-green); flex: none; }
    .ms-text { display: flex; flex-direction: column; min-width: 0; }
    .ms-label { font-size: 14px; font-weight: 600; }
    .ms-hint { font-size: 12px; color: var(--c-muted); }
    .ms-empty { padding: 12px; font-size: 13px; color: var(--c-muted); }
  `],
})
export class MultiSelectComponent {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly options = input.required<MultiOption[]>();
  readonly value = model<string[]>([]);
  readonly placeholder = input('Choose…');
  readonly emptyText = input('Nothing to choose from.');
  readonly disabled = input(false);

  readonly uid = `ms${nextId++}`;
  readonly open = signal(false);
  readonly chosen = computed(() => {
    const on = new Set(this.value());
    return this.options().filter((o) => on.has(o.id));
  });

  isOn(id: string): boolean {
    return this.value().includes(id);
  }

  toggle(): void {
    if (!this.disabled()) this.open.update((v) => !v);
  }

  toggleOne(id: string): void {
    this.value.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  remove(id: string, event: Event): void {
    event.stopPropagation();
    this.value.update((l) => l.filter((x) => x !== id));
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('keydown.escape', ['$event'])
  onEscape(e: Event): void {
    if (this.open()) {
      e.stopPropagation();
      this.open.set(false);
    }
  }
}
