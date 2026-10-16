import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { AdminService, AdminUser } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { RoleRecord, RolesApiService } from '../../../core/services/roles-api.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { TempPasswordDialogComponent } from '../../../shared/components/partner-users-panel/temp-password-dialog.component';
import { MultiSelectComponent, MultiOption } from '../../../shared/components/multi-select/multi-select.component';
import { PagedList, SKELETON_ROWS } from '../admin-list';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_LIMIT = 20;

interface Form {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  title: string;
  password: string;
  showPassword: boolean;
  mustChange: boolean;
  /** Full admin: every module and user management. Otherwise only what the chosen roles give. */
  full: boolean;
  roleIds: string[];
  /** Roles were changed in this form (an older user keeps their modules until then). */
  touched: boolean;
  /** The user was set up with modules before roles existed. */
  legacy: boolean;
}

/** Admin > Users: the logins of the admin portal. Access comes from roles; "full admin" is the one thing that is not a role. */
@Component({
  selector: 'app-admin-users-page',
  standalone: true,
  imports: [RouterLink, IonSpinner, EmptyStateComponent, PaginationComponent, SearchInputComponent, TempPasswordDialogComponent, MultiSelectComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Admin portal</span>
          <h1>Users</h1>
          <p class="subtitle">People who sign in to the admin portal. Give each one or more roles; a role decides which modules they can view, edit or delete in.</p>
        </div>
        <div class="actions">
          <a routerLink="/admin/roles" class="btn btn-ghost">Roles and permissions</a>
          <button type="button" class="btn btn-primary" (click)="openNew()">+ Add user</button>
        </div>
      </header>

      <div class="toolbar"><app-search-input placeholder="Search name or email…" [value]="search()" (search)="onSearch($event)" /></div>

      <div class="table-card" [class.refreshing]="list.refreshing()">
        @if (list.error()) {
          <app-empty-state kind="error" [message]="list.error()" (retry)="list.reload()" />
        } @else {
          <div class="table-scroll">
            <table class="data-table stack">
              <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
              <tbody>
                @if (list.loading()) {
                  @for (i of skeleton; track i) { <tr>@for (c of [1, 2, 3, 4, 5]; track c) { <td><span class="skeleton"></span></td> }</tr> }
                } @else {
                  @for (u of list.items(); track u.id) {
                    <tr [class.inactive]="!u.is_active">
                      <td class="c-name">
                        <span class="cell-main">{{ u.full_name || '—' }}</span>
                        @if (u.id === me()) { <span class="badge blue tag">You</span> }
                        @if (u.job_title) { <span class="cell-sub">{{ u.job_title }}</span> }
                      </td>
                      <td>{{ u.email }}</td>
                      <td>
                        @if (u.admin_access === 'full') { <span class="badge green">Full admin</span> }
                        @else {
                          @for (n of rolesOf(u); track n) { <span class="badge chip">{{ n }}</span> }
                          @if (!u.role_ids?.length) { <span class="cell-sub">Set before roles: {{ u.admin_modules?.length || 0 }} module{{ (u.admin_modules?.length || 0) === 1 ? '' : 's' }}</span> }
                        }
                      </td>
                      <td><span class="badge dot" [class.green]="u.is_active">{{ u.is_active ? 'Active' : 'Off' }}</span></td>
                      <td class="actions-cell">
                        @if (u.id !== me()) {
                          <button type="button" class="btn btn-sm" [disabled]="busyId() === u.id" (click)="openEdit(u)">Edit</button>
                          <button type="button" class="btn btn-sm btn-ghost" [disabled]="busyId() === u.id" (click)="resetPassword(u)">Reset password</button>
                          <button type="button" class="btn btn-sm btn-ghost" [class.danger]="u.is_active" [disabled]="busyId() === u.id" (click)="toggleActive(u)">{{ u.is_active ? 'Switch off' : 'Switch on' }}</button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr class="empty-row"><td colspan="5"><app-empty-state [title]="search() ? 'No matching users' : 'No admin users yet'" message="Add the people who work with you in the admin portal." /></td></tr>
                  }
                }
              </tbody>
            </table>
          </div>
          <app-pagination [meta]="list.meta()" (pageChange)="page.set($event)" />
        }
      </div>
    </div>

    @if (form(); as f) {
      <div class="modal-backdrop" (click)="!saving() && form.set(null)">
        <form class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="auTitle" novalidate (click)="$event.stopPropagation()" (submit)="$event.preventDefault(); save()">
          <div class="modal-head">
            <div><span class="eyebrow">Users</span><h3 id="auTitle">{{ f.id ? 'Edit user' : 'Add user' }}</h3></div>
            <button type="button" class="close-btn" (click)="form.set(null)" [disabled]="saving()" aria-label="Close">×</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="field"><label for="auName">Full name</label><input id="auName" class="input" autocomplete="off" maxlength="100" [value]="f.name" (input)="patch({ name: $any($event.target).value })" /></div>
              <div class="field"><label for="auEmail">Email (their login)</label><input id="auEmail" class="input" type="email" autocomplete="off" [disabled]="!!f.id" [value]="f.email" (input)="patch({ email: $any($event.target).value })" />@if (f.id) { <span class="hint">The login email cannot be changed.</span> }</div>
              <div class="field"><label for="auPhone">Phone <span class="opt">(optional)</span></label><input id="auPhone" class="input" type="tel" autocomplete="off" [value]="f.phone" (input)="patch({ phone: $any($event.target).value })" /></div>
              <div class="field"><label for="auTitleIn">Job title <span class="opt">(optional)</span></label><input id="auTitleIn" class="input" autocomplete="off" maxlength="60" placeholder="e.g. Order manager" [value]="f.title" (input)="patch({ title: $any($event.target).value })" /></div>
            </div>

            @if (!f.id) {
              <div class="field pw-field">
                <label for="auPw">Password</label>
                <span class="pw-wrap">
                  <input id="auPw" class="input" [type]="f.showPassword ? 'text' : 'password'" autocomplete="new-password" placeholder="Type a password for them, or leave empty to generate one" [value]="f.password" (input)="patch({ password: $any($event.target).value })" />
                  <button type="button" class="btn btn-sm btn-ghost" (click)="patch({ showPassword: !f.showPassword })">{{ f.showPassword ? 'Hide' : 'Show' }}</button>
                </span>
                <span class="hint">At least 8 characters. You see it once after saving, to hand over.</span>
                <label class="check-line"><input type="checkbox" [checked]="f.mustChange" (change)="patch({ mustChange: $any($event.target).checked })" /> They must choose their own password the first time they sign in</label>
              </div>
            }

            <section class="roles-pick">
              <h4>Access</h4>
              <label class="role-opt full" [class.on]="f.full">
                <input type="checkbox" [checked]="f.full" [disabled]="saving()" (change)="patch({ full: $any($event.target).checked })" />
                <span><strong>Full admin</strong><small>Every module, plus creating users and roles. Use it only for people you fully trust.</small></span>
              </label>
              @if (!f.full) {
                @if (f.legacy && !f.touched) { <p class="hint-line">This user's modules were set before roles existed. They stay as they are until you choose a role here.</p> }
                <app-multi-select [options]="roleChoices()" [value]="f.roleIds" (valueChange)="setRoles($event)" [disabled]="saving()" placeholder="Choose one or more roles…" emptyText="There are no roles yet. Create them first on the Roles and permissions page." />
                @if (!roleOptions().length) { <p class="hint-line">Create roles first on the <a class="link" routerLink="/admin/roles">Roles and permissions</a> page.</p> }
              }
            </section>
            @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" [disabled]="saving()" (click)="form.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">@if (saving()) { <ion-spinner name="crescent" /> } {{ f.id ? 'Save changes' : 'Create login' }}</button>
          </div>
        </form>
      </div>
    }

    @if (credential(); as c) {
      <app-temp-password-dialog [title]="c.title" [name]="c.name" [email]="c.email" [password]="c.password" (closed)="credential.set(null)" />
    }
  `,
  styles: [`
    .toolbar { margin-bottom: 14px; }
    .pw-wrap { display: flex; gap: 8px; align-items: center; }
    .pw-wrap .input { flex: 1; min-width: 0; }
    .check-line { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; }
    .roles-pick { margin-top: 16px; }
    .roles-pick h4 { margin: 0 0 8px; font-size: 14px; }
    .role-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
    .role-opt { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 12px; cursor: pointer; background: var(--c-surface); }
    .role-opt.on { border-color: var(--c-dark-2); background: var(--c-bg-soft); box-shadow: 0 0 0 1px var(--c-dark-2) inset; }
    .role-opt input { width: 17px; height: 17px; margin-top: 2px; accent-color: var(--c-green); flex: none; }
    .role-opt span { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .role-opt small { font-size: 12px; color: var(--c-muted); }
    .chip { margin: 0 4px 4px 0; }
    .hint-line { font-size: 12.5px; color: var(--c-muted); margin: 8px 0 0; }
    @media (max-width: 640px) { .role-grid { grid-template-columns: 1fr; } }
  `],
})
export class AdminUsersPage {
  private admin = inject(AdminService);
  private rolesApi = inject(RolesApiService);
  private ui = inject(UiService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly me = computed(() => this.auth.user()?.id ?? null);
  readonly list = new PagedList<AdminUser>();
  readonly search = signal('');
  readonly page = signal(1);
  readonly busyId = signal<string | null>(null);
  readonly form = signal<Form | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly roleOptions = signal<RoleRecord[]>([]);
  readonly credential = signal<{ title: string; name: string | null; email: string; password: string } | null>(null);
  private readonly roleName = computed(() => new Map(this.roleOptions().map((r) => [r.id, r.name])));

  constructor() {
    this.list.connect(
      toObservable(computed(() => ({ search: this.search(), page: this.page() }))),
      (p) => this.admin.listUsers({ role: 'admin', search: p.search, page: p.page, limit: PAGE_LIMIT }),
      this.destroyRef,
    );
    effect(() => untracked(() => this.loadRoles()));
  }

  private loadRoles(): void {
    this.rolesApi.list('admin').subscribe({ next: (r) => this.roleOptions.set(r), error: () => this.roleOptions.set([]) });
  }

  rolesOf(u: AdminUser): string[] {
    return (u.role_ids ?? []).map((id) => this.roleName().get(id)).filter((n): n is string => !!n);
  }

  onSearch(text: string): void {
    this.search.set(text);
    this.page.set(1);
  }

  patch(p: Partial<Form>): void {
    this.error.set(null);
    this.form.update((f) => (f ? { ...f, ...p } : f));
  }

  readonly roleChoices = computed<MultiOption[]>(() => this.roleOptions().map((r) => ({ id: r.id, label: r.name, hint: r.description || `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}` })));

  setRoles(ids: string[]): void {
    this.patch({ roleIds: ids, touched: true });
  }

  openNew(): void {
    this.error.set(null);
    this.loadRoles();
    this.form.set({ id: null, name: '', email: '', phone: '', title: '', password: '', showPassword: false, mustChange: true, full: false, roleIds: [], touched: true, legacy: false });
    setTimeout(() => document.getElementById('auName')?.focus());
  }

  openEdit(u: AdminUser): void {
    this.error.set(null);
    this.loadRoles();
    const legacy = u.admin_access === 'restricted' && !(u.role_ids?.length);
    this.form.set({ id: u.id, name: u.full_name || '', email: u.email, phone: u.phone || '', title: u.job_title || '', password: '', showPassword: false, mustChange: true, full: u.admin_access === 'full', roleIds: [...(u.role_ids ?? [])], touched: false, legacy });
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    if (!f.name.trim()) return void this.error.set('Enter their full name.');
    if (!f.id && !EMAIL.test(f.email.trim())) return void this.error.set('Enter a valid email address.');
    if (!f.id && f.password && f.password.length < 8) return void this.error.set('Use at least 8 characters, or leave the password empty.');
    if (!f.full && f.touched && !f.roleIds.length) return void this.error.set('Choose at least one role, or make them a full admin.');
    this.saving.set(true);
    this.error.set(null);

    if (!f.id) {
      this.admin.createAdminUser({
        full_name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined, job_title: f.title.trim() || undefined,
        password: f.password || undefined, must_change_password: f.mustChange,
        ...(f.full ? { full_access: true } : { role_ids: f.roleIds }),
      }).subscribe({
        next: (res) => {
          this.saving.set(false);
          this.form.set(null);
          this.credential.set({ title: 'Login created', name: res.data.user.full_name, email: res.data.user.email, password: res.data.temporaryPassword });
          this.list.reload();
          this.loadRoles();
        },
        error: (e) => this.fail(e),
      });
      return;
    }
    const body: { full_access?: boolean; role_ids?: string[]; job_title?: string } = { job_title: f.title.trim() };
    if (f.full) body.full_access = true;
    else if (f.touched || f.legacy === false) body.role_ids = f.roleIds;
    this.admin.setAdminUserAccess(f.id, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.set(null);
        this.ui.success('User updated.');
        this.list.reload();
        this.loadRoles();
      },
      error: (e) => this.fail(e),
    });
  }

  private fail(e: unknown): void {
    this.saving.set(false);
    this.error.set(apiErrorMessage(e));
  }

  async resetPassword(u: AdminUser): Promise<void> {
    const ok = await this.ui.confirm({ title: `Reset password for ${u.full_name || u.email}?`, message: 'A new temporary password is created and the old one stops working at once. They must choose their own when they sign in.', confirmText: 'Reset password' });
    if (!ok) return;
    this.busyId.set(u.id);
    this.admin.resetAdminUserPassword(u.id).subscribe({
      next: (res) => { this.busyId.set(null); this.credential.set({ title: 'New temporary password', name: u.full_name, email: u.email, password: res.data.temporaryPassword }); },
      error: (e) => { this.busyId.set(null); this.ui.error(e); },
    });
  }

  async toggleActive(u: AdminUser): Promise<void> {
    if (u.is_active) {
      const ok = await this.ui.confirm({ title: `Switch off ${u.full_name || u.email}?`, message: 'They can no longer sign in. Their history stays and you can switch them on again later.', confirmText: 'Switch off', danger: true });
      if (!ok) return;
    }
    this.busyId.set(u.id);
    this.admin.setUserActive(u.id, !u.is_active).subscribe({
      next: () => { this.busyId.set(null); this.ui.success(u.is_active ? 'User switched off.' : 'User switched on.'); this.list.reload(); },
      error: (e) => { this.busyId.set(null); this.ui.error(e); },
    });
  }
}
