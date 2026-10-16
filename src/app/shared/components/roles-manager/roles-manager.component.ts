import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonSpinner } from '@ionic/angular';
import { apiErrorMessage } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { RoleModule, RoleRecord, RolesApiService, RolesPortal } from '../../../core/services/roles-api.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../empty-state.component';

interface Draft {
  /** null = a new role. */
  id: string | null;
  name: string;
  description: string;
  permissions: string[];
}

/**
 * Roles and permissions of one portal. Left: the roles; right: the one being edited, as a card per module with one tick per button.
 * A role is a name plus ticks. A user holds one or more roles and gets exactly what they give (see the Users page).
 *
 *   <app-roles-manager portal="partner" />   the partner's roles
 *   <app-roles-manager portal="admin" />     the admin portal's roles
 */
@Component({
  selector: 'app-roles-manager',
  standalone: true,
  imports: [IonSpinner, EmptyStateComponent],
  template: `
    @if (error() && !bundle()) {
      <div class="card"><app-empty-state kind="error" [message]="error()" (retry)="load()" /></div>
    } @else if (!bundle()) {
      <div class="card"><span class="skeleton" style="height: 38px; width: 40%"></span><span class="skeleton" style="height: 260px; margin-top: 14px"></span></div>
    } @else {
      <div class="rm" [class.editing]="!!draft()">
        <!-- ── the roles ── -->
        <aside class="rm-list" aria-label="Roles">
          <div class="rm-list-head">
            <h2>Roles <span class="count">{{ roles().length }}</span></h2>
            @if (canCreate()) { <button type="button" class="btn btn-primary btn-sm" (click)="startNew()">+ New role</button> }
          </div>
          <ul>
            @for (r of roles(); track r.id) {
              <li>
                <button type="button" class="role-item" [class.on]="draft()?.id === r.id" [attr.aria-current]="draft()?.id === r.id ? 'true' : null" (click)="select(r)">
                  <span class="role-name">{{ r.name }} @if (r.locked) { <span class="lock" title="Built in, cannot be changed">🔒</span> }</span>
                  @if (r.description) { <span class="role-desc">{{ r.description }}</span> }
                  <span class="role-meta">
                    <span>{{ r.locked ? 'Every module of the partner' : r.permissions.length + ' permission' + (r.permissions.length === 1 ? '' : 's') }}</span>
                    <span>·</span>
                    <span>{{ r.user_count }} user{{ r.user_count === 1 ? '' : 's' }}</span>
                  </span>
                </button>
              </li>
            } @empty {
              <li class="rm-empty">
                <strong>No roles yet</strong>
                <span>Create a role (for example "Cutting master" or "Warehouse staff") and tick what it may do. Then give it to users.</span>
              </li>
            }
          </ul>
        </aside>

        <!-- ── the editor ── -->
        <section class="rm-editor" aria-label="Role details">
          @if (draft(); as d) {
            <header class="ed-head">
              <button type="button" class="back" (click)="close()" aria-label="Back to roles">‹ Roles</button>
              <div class="ed-title">
                <span class="eyebrow">{{ d.id ? 'Edit role' : 'New role' }}</span>
                <h2>{{ d.name || 'Untitled role' }}</h2>
              </div>
              @if (dirty()) { <span class="dirty">Unsaved changes</span> }
            </header>

            @if (locked()) {
              <div class="note">The Owner role has every module of this partner. It cannot be changed or removed. Change the partner's modules in the admin portal instead.</div>
            } @else {
              <div class="ed-fields">
                <label class="field">
                  <span>Role name</span>
                  <input class="input" maxlength="60" placeholder="e.g. Cutting master" [value]="d.name" (input)="patch({ name: $any($event.target).value })" [disabled]="!canEdit()" />
                </label>
                <label class="field">
                  <span>Description <em>(optional)</em></span>
                  <input class="input" maxlength="200" placeholder="What this role is for" [value]="d.description" (input)="patch({ description: $any($event.target).value })" [disabled]="!canEdit()" />
                </label>
              </div>
            }

            <div class="ed-bar">
              <strong>{{ d.permissions.length }}</strong> <span class="muted">of {{ totalCount() }} selected</span>
              @if (!locked() && canEdit()) {
                <span class="spacer"></span>
                <button type="button" class="link-btn" (click)="setAll(true)">Select all</button>
                <button type="button" class="link-btn" (click)="setAll(false)">Clear</button>
              }
            </div>

            <div class="mods" [class.readonly]="locked() || !canEdit()">
              @for (m of modules(); track m.id) {
                <fieldset class="mod" [disabled]="locked() || !canEdit()">
                  <legend class="sr-only">{{ m.label }}</legend>
                  <div class="mod-head">
                    <div>
                      <strong>{{ m.label }}</strong>
                      <span class="mod-desc">{{ m.description }}</span>
                    </div>
                    <span class="mod-count" [class.some]="moduleCount(m) > 0">{{ moduleCount(m) }}/{{ m.actions.length }}</span>
                  </div>
                  <div class="acts">
                    @for (a of m.actions; track a.id) {
                      <label class="act" [class.full]="a.kind === 'full'" [class.off]="!isAvailable(a.id)" [attr.title]="isAvailable(a.id) ? null : 'You do not have this yourself, so you cannot give it'">
                        <input type="checkbox" [checked]="isOn(a.id)" [disabled]="!isAvailable(a.id)" (change)="toggle(m, a.id, $any($event.target).checked)" />
                        <span class="act-text">
                          <span class="act-label">{{ a.label }}</span>
                          @if (a.description) { <span class="act-desc">{{ a.description }}</span> }
                        </span>
                      </label>
                    }
                  </div>
                </fieldset>
              }
            </div>

            @if (formError()) { <p class="form-error" role="alert">{{ formError() }}</p> }

            @if (!locked() && canEdit()) {
              <footer class="ed-foot">
                @if (d.id && canEdit()) {
                  <button type="button" class="btn btn-ghost danger" (click)="remove()" [disabled]="saving()">Delete role</button>
                }
                <span class="spacer"></span>
                <button type="button" class="btn" (click)="close()" [disabled]="saving()">Cancel</button>
                <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving() || !dirty() || !d.name.trim() || !d.permissions.length">
                  @if (saving()) { <ion-spinner name="crescent" /> }
                  {{ d.id ? 'Save changes' : 'Create role' }}
                </button>
              </footer>
            }
          } @else {
            <div class="rm-hint">
              <h3>Roles and permissions</h3>
              <p>A role is a named set of permissions. Tick exactly the buttons a person needs, then give the role to users on the Users page. A user can hold several roles; they get everything the roles give together, and nothing else.</p>
              <p class="muted">Pick a role on the left to see or change it@if (canCreate()) { , or create a new one }.</p>
            </div>
          }
        </section>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .rm { display: grid; grid-template-columns: minmax(250px, 320px) minmax(0, 1fr); gap: 18px; align-items: start; }
    .rm-list, .rm-editor { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--radius-lg, 16px); }
    .rm-list { padding: 14px; position: sticky; top: 12px; max-height: calc(100vh - 100px); overflow: auto; }
    .rm-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .rm-list-head h2 { margin: 0; font-size: 15px; }
    .count { font-size: 12px; color: var(--c-muted); font-weight: 600; margin-left: 4px; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .role-item { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 3px; padding: 11px 12px; border: 1px solid var(--c-line-soft); border-radius: 12px; background: var(--c-surface); font: inherit; cursor: pointer; }
    .role-item:hover { border-color: var(--c-line); background: var(--c-bg-soft); }
    .role-item.on { border-color: var(--c-dark-2); box-shadow: 0 0 0 1px var(--c-dark-2) inset; background: var(--c-bg-soft); }
    .role-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    .role-name { font-weight: 700; font-size: 14px; }
    .role-desc { font-size: 12.5px; color: var(--c-ink-2); overflow-wrap: anywhere; }
    .role-meta { display: flex; gap: 6px; font-size: 12px; color: var(--c-muted); }
    .rm-empty { display: flex; flex-direction: column; gap: 4px; padding: 14px; border: 1px dashed var(--c-line); border-radius: 12px; font-size: 13px; color: var(--c-muted); }
    .rm-empty strong { color: var(--c-ink); }

    .rm-editor { padding: 0; min-width: 0; }
    .rm-hint { padding: 28px 24px; max-width: 560px; }
    .rm-hint h3 { margin: 0 0 8px; }
    .rm-hint p { margin: 0 0 10px; color: var(--c-ink-2); font-size: 14px; line-height: 1.5; }
    .ed-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px 6px; }
    .ed-title { flex: 1; min-width: 0; }
    .ed-title h2 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
    .eyebrow { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--c-muted); font-weight: 700; }
    .back { display: none; border: 0; background: transparent; font: inherit; font-weight: 600; color: var(--c-ink-2); cursor: pointer; min-height: 40px; padding: 0 6px; }
    .dirty { font-size: 12px; font-weight: 600; color: var(--c-amber); background: var(--c-amber-soft); padding: 3px 10px; border-radius: 999px; }
    .note { margin: 10px 20px; padding: 12px 14px; border-radius: 12px; background: var(--c-bg-soft); font-size: 13.5px; color: var(--c-ink-2); }
    .ed-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 10px 20px 4px; }
    .field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; min-width: 0; }
    .field em { font-weight: 400; color: var(--c-muted); font-style: normal; }
    .ed-bar { display: flex; align-items: center; gap: 8px; padding: 12px 20px 8px; font-size: 13px; }
    .spacer { flex: 1; }
    .muted { color: var(--c-muted); }
    .link-btn { border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 600; color: var(--c-dark-2); cursor: pointer; padding: 6px 4px; text-decoration: underline; text-underline-offset: 3px; }

    .mods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 4px 20px 16px; }
    .mod { border: 1px solid var(--c-line-soft); border-radius: 14px; padding: 12px 14px; margin: 0; min-width: 0; background: var(--c-surface); }
    .mod-head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .mod-head strong { font-size: 14.5px; display: block; }
    .mod-desc { display: block; font-size: 12px; color: var(--c-muted); margin-top: 1px; }
    .mod-count { align-self: flex-start; font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: var(--c-neutral-soft); color: var(--c-neutral); white-space: nowrap; }
    .mod-count.some { background: var(--c-green-soft); color: var(--c-green); }
    .acts { display: flex; flex-direction: column; }
    .act { display: flex; align-items: flex-start; gap: 10px; padding: 8px 4px; border-top: 1px solid var(--c-line-soft); cursor: pointer; min-height: 40px; }
    .act:first-child { border-top: 0; }
    .act input { width: 17px; height: 17px; margin: 2px 0 0; accent-color: var(--c-green); flex: none; }
    .act input:focus-visible { outline: 2px solid var(--c-green); outline-offset: 2px; }
    .act-text { display: flex; flex-direction: column; min-width: 0; }
    .act-label { font-size: 13.5px; font-weight: 600; }
    .act-desc { font-size: 12px; color: var(--c-muted); line-height: 1.35; }
    .act.full { margin-top: 4px; border-top: 1px dashed var(--c-line); background: var(--c-bg-soft); border-radius: 0 0 10px 10px; padding-inline: 8px; }
    .act.off { opacity: .5; cursor: not-allowed; }
    .readonly .act { cursor: default; }

    .form-error { margin: 0 20px 10px; color: var(--c-red); font-size: 13px; }
    .ed-foot { position: sticky; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--c-line-soft); background: var(--c-surface); border-radius: 0 0 16px 16px; }
    .danger { color: var(--c-red); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }

    @media (max-width: 900px) {
      .rm { grid-template-columns: 1fr; }
      .rm-list { position: static; max-height: none; }
      .rm.editing .rm-list { display: none; }
      .rm:not(.editing) .rm-editor { display: none; }
      .back { display: inline-flex; align-items: center; }
      .mods { grid-template-columns: 1fr; }
      .ed-fields { grid-template-columns: 1fr; }
    }
  `],
})
export class RolesManagerComponent implements OnInit {
  private rolesApi = inject(RolesApiService);
  private auth = inject(AuthService);
  private ui = inject(UiService);
  private destroyRef = inject(DestroyRef);

  readonly portal = input<RolesPortal>('partner');

  readonly bundle = signal<{ roles: RoleRecord[]; modules: RoleModule[] } | null>(null);
  readonly error = signal<string | null>(null);
  readonly draft = signal<Draft | null>(null);
  private readonly original = signal<string>('');
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly roles = computed(() => this.bundle()?.roles ?? []);
  readonly modules = computed(() => this.bundle()?.modules ?? []);
  readonly totalCount = computed(() => this.modules().reduce((n, m) => n + m.actions.length, 0));
  readonly locked = computed(() => !!this.roles().find((r) => r.id === this.draft()?.id)?.locked);

  /** Who may create / change roles: the Users permission (partner portal) or a full admin (admin portal). */
  readonly canCreate = computed(() => (this.portal() === 'admin' ? this.auth.isFullAdmin() : this.auth.can('users.create')));
  readonly canEdit = computed(() => {
    const d = this.draft();
    if (!d) return false;
    return this.portal() === 'admin' ? this.auth.isFullAdmin() : d.id ? this.auth.can('users.update') : this.auth.can('users.create');
  });

  readonly dirty = computed(() => {
    const d = this.draft();
    return !!d && JSON.stringify(this.snapshot(d)) !== this.original();
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.rolesApi.load(this.portal()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (b) => {
        this.bundle.set(b);
        const open = this.draft()?.id;
        if (open) {
          const r = b.roles.find((x) => x.id === open);
          if (r) this.open(r);
          else this.draft.set(null);
        }
      },
      error: (e) => this.error.set(apiErrorMessage(e, 'Could not load the roles.')),
    });
  }

  // ── choosing what to edit ──

  private snapshot(d: Draft) {
    return { n: d.name.trim(), d: d.description.trim(), p: [...d.permissions].sort() };
  }

  private open(r: RoleRecord): void {
    const d: Draft = { id: r.id, name: r.name, description: r.description || '', permissions: [...r.permissions] };
    this.draft.set(d);
    this.original.set(JSON.stringify(this.snapshot(d)));
    this.formError.set(null);
  }

  private async confirmLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    return this.ui.confirm({ title: 'Discard your changes?', message: 'This role has changes that are not saved.', confirmText: 'Discard' });
  }

  async select(r: RoleRecord): Promise<void> {
    if (this.draft()?.id === r.id) return;
    if (!(await this.confirmLeave())) return;
    this.open(r);
  }

  async startNew(): Promise<void> {
    if (!(await this.confirmLeave())) return;
    const d: Draft = { id: null, name: '', description: '', permissions: [] };
    this.draft.set(d);
    this.original.set(JSON.stringify(this.snapshot(d)));
    this.formError.set(null);
    setTimeout(() => (document.querySelector('.rm-editor input.input') as HTMLInputElement | null)?.focus());
  }

  async close(): Promise<void> {
    if (!(await this.confirmLeave())) return;
    this.draft.set(null);
  }

  patch(p: Partial<Draft>): void {
    this.formError.set(null);
    this.draft.update((d) => (d ? { ...d, ...p } : d));
  }

  // ── ticks ──

  /** A permission the person editing may hand out: their own (admins and the admin portal: all). */
  isAvailable(id: string): boolean {
    if (this.portal() === 'admin' || this.auth.isAdmin()) return true;
    return this.auth.permissions().has(id);
  }

  isOn(id: string): boolean {
    return !!this.draft()?.permissions.includes(id);
  }

  moduleCount(m: RoleModule): number {
    const on = new Set(this.draft()?.permissions ?? []);
    return m.actions.filter((a) => on.has(a.id)).length;
  }

  toggle(m: RoleModule, id: string, checked: boolean): void {
    const action = m.actions.find((a) => a.id === id);
    if (!action) return;
    const view = m.actions.find((a) => a.kind === 'view')?.id;
    const on = new Set(this.draft()?.permissions ?? []);
    const ids = m.actions.map((a) => a.id);
    if (checked) {
      if (action.kind === 'full') ids.filter((x) => this.isAvailable(x)).forEach((x) => on.add(x));
      else {
        on.add(id);
        if (view) on.add(view); // an action needs the page it is on
      }
    } else if (action.kind === 'view') {
      ids.forEach((x) => on.delete(x)); // no page, nothing to do on it
    } else {
      on.delete(id);
      const full = m.actions.find((a) => a.kind === 'full');
      if (full && action.kind !== 'full') on.delete(full.id); // not "full control" any more
    }
    this.patch({ permissions: [...on] });
  }

  setAll(all: boolean): void {
    this.patch({ permissions: all ? this.modules().flatMap((m) => m.actions.map((a) => a.id)).filter((id) => this.isAvailable(id)) : [] });
  }

  // ── save / delete ──

  save(): void {
    const d = this.draft();
    if (!d || this.saving()) return;
    this.saving.set(true);
    this.formError.set(null);
    const body = { name: d.name.trim(), description: d.description.trim(), permissions: d.permissions };
    const req = d.id ? this.rolesApi.update(this.portal(), d.id, body) : this.rolesApi.create(this.portal(), body);
    req.subscribe({
      next: (role) => {
        this.saving.set(false);
        const holders = d.id ? this.roles().find((r) => r.id === d.id)?.user_count ?? 0 : 0;
        this.ui.success(d.id ? (holders ? `Role saved. ${holders} user${holders === 1 ? '' : 's'} updated.` : 'Role saved.') : `Role "${role.name}" created.`);
        this.draft.set({ id: role.id, name: role.name, description: role.description || '', permissions: [...role.permissions] });
        this.original.set(JSON.stringify(this.snapshot(this.draft()!)));
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.formError.set(apiErrorMessage(e));
      },
    });
  }

  async remove(): Promise<void> {
    const d = this.draft();
    if (!d?.id) return;
    const ok = await this.ui.confirm({ title: `Delete "${d.name}"?`, message: 'The role is removed. This only works when no user holds it.', confirmText: 'Delete role', danger: true });
    if (!ok) return;
    this.saving.set(true);
    this.rolesApi.remove(this.portal(), d.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.ui.success(`Role "${d.name}" deleted.`);
        this.draft.set(null);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.formError.set(apiErrorMessage(e));
      },
    });
  }
}
