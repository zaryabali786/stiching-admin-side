import { Component, computed, input, model } from '@angular/core';
import { PermissionAction, PermissionModule } from '../../../core/services/partner-admin.service';

const ACTIONS: { id: PermissionAction; label: string }[] = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'update', label: 'Update' },
];

let nextId = 1;

/**
 * Module x action checkbox grid used to hand out permissions (`<module>.<action>`).
 *
 *   <app-permission-matrix [modules]="modules()" [available]="ceiling()" [(value)]="permissions" />
 *
 * - `available` (optional): the permission ids that may be ticked; the rest are shown disabled with a tooltip.
 * - Ticking `update` / `create` also ticks `view` (the server does the same); unticking `view` clears the rest of that module.
 */
@Component({
  selector: 'app-permission-matrix',
  standalone: true,
  template: `
    <fieldset class="pm" [disabled]="disabled()">
      <legend class="pm-legend">{{ legend() }}</legend>

      <div class="pm-bar">
        <span class="pm-count" aria-live="polite">{{ selectedCount() }} of {{ totalCount() }} selected</span>
        <span class="pm-shortcuts">
          <button type="button" class="btn btn-sm btn-ghost" [disabled]="disabled() || !totalCount()" (click)="selectAll()">Select all</button>
          <button type="button" class="btn btn-sm btn-ghost" [disabled]="disabled() || !value().length" (click)="selectNone()">Select none</button>
        </span>
      </div>

      <div class="pm-grid" role="presentation">
        <div class="pm-row pm-headings" aria-hidden="true">
          <span>Module</span>
          @for (a of actions; track a.id) { <span class="pm-col">{{ a.label }}</span> }
        </div>

        @for (m of modules(); track m.id) {
          <div class="pm-row" role="group" [attr.aria-labelledby]="uid + '-' + m.id">
            <div class="pm-module">
              <strong [id]="uid + '-' + m.id">{{ m.label }}</strong>
              <span class="pm-desc">{{ m.description }}</span>
            </div>
            @for (a of actions; track a.id) {
              @if (m.actions.includes(a.id)) {
                <label class="pm-cell" [class.off]="!canTick(m, a.id)" [attr.title]="canTick(m, a.id) ? null : unavailableHint()">
                  <input type="checkbox"
                    [checked]="isOn(m.id + '.' + a.id)"
                    [disabled]="disabled() || !canTick(m, a.id)"
                    (change)="toggle(m, a.id, $any($event.target).checked)" />
                  <span>{{ a.label }}</span>
                </label>
              } @else {
                <span class="pm-cell pm-none" aria-hidden="true"></span>
              }
            }
          </div>
        } @empty {
          <p class="pm-empty">No modules to choose from.</p>
        }
      </div>
    </fieldset>
  `,
  styles: [`
    :host { display: block; }
    .pm { border: 1px solid var(--c-line); border-radius: var(--radius); padding: 12px 14px 8px; margin: 0; min-width: 0; background: var(--c-surface); }
    .pm-legend { font-size: 12.5px; font-weight: 600; color: var(--c-ink-2); padding: 0 6px; }
    .pm-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .pm-count { font-size: 12px; color: var(--c-muted); }
    .pm-shortcuts { display: inline-flex; gap: 4px; }

    .pm-row { display: grid; grid-template-columns: minmax(0, 1fr) repeat(3, 84px); align-items: center; gap: 4px 8px; padding: 9px 0; border-top: 1px solid var(--c-line-soft); }
    .pm-headings { border-top: none; padding: 2px 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--c-muted); }
    .pm-col { text-align: left; }
    .pm-module { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pm-module strong { font-size: 13.5px; font-weight: 600; }
    .pm-desc { font-size: 12px; color: var(--c-muted); }

    .pm-cell { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13px; cursor: pointer; }
    .pm-cell input { width: 16px; height: 16px; accent-color: var(--c-green); flex-shrink: 0; margin: 0; }
    .pm-cell input:focus-visible { outline: 2px solid var(--c-green); outline-offset: 2px; }
    .pm-cell.off { color: var(--c-faint); cursor: not-allowed; }
    .pm-cell:not(.off):hover span { color: var(--c-ink); }
    /* the action name only repeats the column heading on desktop, but it is the label on phones */
    .pm-cell span { color: var(--c-ink-2); }
    .pm-cell.off span { color: var(--c-faint); }
    .pm-empty { margin: 10px 0; font-size: 13px; color: var(--c-muted); }

    @media (max-width: 640px) {
      .pm { padding-inline: 12px; }
      .pm-headings { display: none; }
      .pm-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pm-module { grid-column: 1 / -1; }
      .pm-cell { min-height: 40px; }
      .pm-none { display: none; }
    }
    @media (min-width: 641px) {
      /* desktop: the column heading is the visual label; keep the word for screen readers and clicking */
      .pm-cell span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      .pm-cell { padding-left: 26px; position: relative; }
      .pm-cell input { position: absolute; left: 0; }
    }
  `],
})
export class PermissionMatrixComponent {
  /** The module catalogue (`GET /admin/permissions` or `GET /partner/access` -> modules). */
  readonly modules = input.required<PermissionModule[]>();
  /** Permission ids that may be ticked. Omit (null) to allow everything. */
  readonly available = input<readonly string[] | null>(null);
  /** Selected permission ids. */
  readonly value = model<string[]>([]);
  readonly disabled = input(false);
  readonly legend = input('What this login may use');
  readonly unavailableHint = input('Your partner does not have this');

  readonly actions = ACTIONS;
  readonly uid = `pm${nextId++}`;

  private readonly selected = computed(() => new Set(this.value()));
  private readonly allowed = computed(() => {
    const a = this.available();
    return a ? new Set(a) : null;
  });

  /** Every permission id that can be ticked given `available`. */
  private readonly tickable = computed(() => {
    const out: string[] = [];
    for (const m of this.modules()) for (const a of m.actions) if (this.canTick(m, a)) out.push(`${m.id}.${a}`);
    return out;
  });

  readonly totalCount = computed(() => this.tickable().length);
  readonly selectedCount = computed(() => {
    const sel = this.selected();
    return this.tickable().filter((p) => sel.has(p)).length;
  });

  isOn(id: string): boolean {
    return this.selected().has(id);
  }

  isAvailable(id: string): boolean {
    const allowed = this.allowed();
    return !allowed || allowed.has(id);
  }

  /** `update` / `create` need `view` of the same module as well. */
  canTick(m: PermissionModule, action: PermissionAction): boolean {
    if (!this.isAvailable(`${m.id}.${action}`)) return false;
    return action === 'view' || !m.actions.includes('view') || this.isAvailable(`${m.id}.view`);
  }

  toggle(m: PermissionModule, action: PermissionAction, checked: boolean): void {
    const next = new Set(this.value());
    const id = `${m.id}.${action}`;
    if (checked) {
      next.add(id);
      if (action !== 'view' && m.actions.includes('view')) next.add(`${m.id}.view`);
    } else {
      next.delete(id);
      if (action === 'view') for (const a of m.actions) next.delete(`${m.id}.${a}`);
    }
    this.emit(next);
  }

  selectAll(): void {
    this.emit(new Set(this.tickable()));
  }

  selectNone(): void {
    this.emit(new Set());
  }

  /** Emit in catalogue order so the value is stable and easy to compare. */
  private emit(set: Set<string>): void {
    const ordered: string[] = [];
    for (const m of this.modules()) for (const a of m.actions) if (set.has(`${m.id}.${a}`)) ordered.push(`${m.id}.${a}`);
    this.value.set(ordered);
  }
}
