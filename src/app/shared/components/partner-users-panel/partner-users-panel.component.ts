import { Component, DestroyRef, HostListener, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { IonSpinner } from '@ionic/angular';
import { PagedList, SKELETON_ROWS } from '../../../pages/admin/admin-list';
import { apiErrorMessage } from '../../../core/services/api.service';
import {
  PartnerAdminService,
  PartnerUser,
  PartnerUsersApi,
  PermissionModule,
  StaffType,
  UserCreateInput,
  UserPatch,
} from '../../../core/services/partner-admin.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../empty-state.component';
import { PaginationComponent } from '../pagination.component';
import { SearchInputComponent } from '../search-input.component';
import { PermissionMatrixComponent } from '../permission-matrix/permission-matrix.component';
import { TempPasswordDialogComponent } from './temp-password-dialog.component';

const PAGE_LIMIT = 20;
const PASSWORD_MIN = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const STAFF_TYPES: { id: StaffType; label: string }[] = [
  { id: 'master', label: 'Master' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'staff', label: 'Other staff' },
];

/** Starting point only; the real access is whatever the partner saves. */
export const STAFF_PRESETS: Record<StaffType, string[]> = {
  master: ['overview.view', 'production.view', 'production.update', 'quality.view', 'quality.update', 'teams.view'],
  tailor: ['production.view'],
  staff: [],
};

export const JOB_TITLE_SUGGESTIONS = ['Master Tailor', 'Tailor', 'Quality Checker', 'Warehouse Staff', 'Receiving Staff', 'Manager'];

interface UserForm {
  id: string | null;
  isOwner: boolean;
  full_name: string;
  email: string;
  phone: string;
  job_title: string;
  staff_type: StaffType;
  password: string;
}

interface Credential {
  title: string;
  name: string | null;
  email: string;
  password: string;
}

/**
 * A partner's users: searchable, paginated table with add / edit / reset password / switch off.
 * Used by the partner portal (`{ kind: 'partner' }`) and by the admin partner drawer (`{ kind: 'admin', partnerId }`).
 * The server decides what is allowed; the flags here only decide what is offered.
 */
@Component({
  selector: 'app-partner-users-panel',
  standalone: true,
  imports: [IonSpinner, EmptyStateComponent, PaginationComponent, SearchInputComponent, PermissionMatrixComponent, TempPasswordDialogComponent],
  templateUrl: './partner-users-panel.component.html',
  styleUrls: ['./partner-users-panel.component.scss'],
})
export class PartnerUsersPanelComponent {
  private svc = inject(PartnerAdminService);
  private ui = inject(UiService);
  private destroyRef = inject(DestroyRef);

  /** Which endpoints to use. */
  readonly api = input.required<PartnerUsersApi>();
  /** The module catalogue (labels for the access summary and the permission matrix). */
  readonly modules = input.required<PermissionModule[]>();
  /** Permissions that may be handed out (partner portal: `delegable`; admin: the partner's permissions). */
  readonly ceiling = input<readonly string[]>([]);
  readonly canCreate = input(false);
  readonly canUpdate = input(false);
  /** Show the "Add user" button in the panel's toolbar (the page can host its own and call `openNew()`). */
  readonly showAddButton = input(true);
  /** Something changed (user added / edited / switched): lets a parent refresh its figures. */
  readonly changed = output<void>();

  readonly skeleton = SKELETON_ROWS;
  readonly titles = JOB_TITLE_SUGGESTIONS;
  readonly staffTypes = STAFF_TYPES;
  readonly passwordMin = PASSWORD_MIN;

  readonly list = new PagedList<PartnerUser>();
  readonly search = signal('');
  readonly page = signal(1);
  readonly busyId = signal<string | null>(null);

  readonly form = signal<UserForm | null>(null);
  readonly formPerms = signal<string[]>([]);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly showPassword = signal(false);
  readonly credential = signal<Credential | null>(null);

  private readonly ceilingSet = computed(() => new Set(this.ceiling()));
  private readonly apiKey = computed(() => {
    const a = this.api();
    return a.kind === 'admin' ? `admin:${a.partnerId}` : 'partner';
  });

  readonly nameError = computed(() => (this.form()?.full_name.trim() ? '' : 'Enter their full name.'));
  readonly emailError = computed(() => {
    const f = this.form();
    if (!f || f.id) return '';
    const e = f.email.trim();
    if (!e) return 'Enter their email: they sign in with it.';
    return EMAIL.test(e) ? '' : 'Enter a valid email address.';
  });
  readonly passwordError = computed(() => {
    const f = this.form();
    if (!f || f.id || !f.password) return '';
    return f.password.length >= PASSWORD_MIN ? '' : `Use at least ${PASSWORD_MIN} characters, or leave it empty.`;
  });

  constructor() {
    this.list.connect(
      toObservable(computed(() => ({ key: this.apiKey(), search: this.search(), page: this.page() }))),
      () => this.svc.listUsers(this.api(), { search: this.search(), page: this.page(), limit: PAGE_LIMIT }),
      this.destroyRef
    );
    // another partner (or the other portal): start from the first page again
    let seen = this.apiKey();
    effect(() => {
      const k = this.apiKey();
      untracked(() => {
        if (k === seen) return;
        seen = k;
        this.search.set('');
        this.page.set(1);
      });
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && !this.credential() && this.form() && !this.saving()) this.closeForm();
  }

  // ── list ──

  onSearch(text: string): void {
    this.search.set(text);
    this.page.set(1);
  }

  goTo(page: number): void {
    this.page.set(Math.max(1, page));
  }

  reload(): void {
    this.list.reload();
  }

  /** Short access summary such as "Production, Quality check +2". */
  summary(u: PartnerUser): string {
    if (u.is_owner) return 'Everything the partner has';
    const labels = this.moduleLabels(u);
    if (!labels.length) return 'No access';
    return labels.length <= 2 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  }

  /** Full access list for the tooltip: "Production: view, update". */
  detail(u: PartnerUser): string {
    if (u.is_owner) return 'The owner always has every module of the partner.';
    const perms = new Set(u.permissions || []);
    const parts = this.modules()
      .map((m) => {
        const acts = m.actions.filter((a) => perms.has(`${m.id}.${a}`));
        return acts.length ? `${m.label}: ${acts.join(', ')}` : '';
      })
      .filter(Boolean);
    return parts.length ? parts.join('\n') : 'No access';
  }

  private moduleLabels(u: PartnerUser): string[] {
    const perms = u.permissions || [];
    return this.modules()
      .filter((m) => perms.some((p) => p.startsWith(`${m.id}.`)))
      .map((m) => m.label);
  }

  /** The owner row is admin-only; nobody changes themselves; in the partner portal nobody manages someone with more access. */
  canManage(u: PartnerUser): boolean {
    if (!this.canUpdate() || u.is_me) return false;
    if (this.api().kind === 'admin') return true;
    if (u.is_owner) return false;
    return !(u.permissions || []).some((p) => !this.ceilingSet().has(p));
  }

  /** Why a row has no actions (shown as small text), or '' when none is needed. */
  lockedReason(u: PartnerUser): string {
    if (!this.canUpdate() || u.is_me) return '';
    if (this.api().kind === 'admin') return '';
    if (u.is_owner) return 'Only the admin can change the owner';
    return this.canManage(u) ? '' : 'Has more access than you';
  }

  // ── add / edit ──

  openNew(): void {
    if (!this.canCreate()) return;
    this.reset();
    this.formPerms.set([]);
    this.form.set({ id: null, isOwner: false, full_name: '', email: '', phone: '', job_title: '', staff_type: 'staff', password: '' });
    this.focusFirst();
  }

  openEdit(u: PartnerUser): void {
    this.reset();
    // permissions beyond the ceiling cannot be handed out any more, so they are not shown as ticked
    this.formPerms.set((u.permissions || []).filter((p) => this.ceilingSet().has(p)));
    this.form.set({ id: u.id, isOwner: u.is_owner, full_name: u.full_name || '', email: u.email, phone: u.phone || '', job_title: u.job_title || '', staff_type: u.staff_type || 'staff', password: '' });
    this.focusFirst();
  }

  closeForm(): void {
    this.form.set(null);
  }

  /** Picking Master or Tailor for a new login starts from that role's usual modules (only those the partner has); the partner can still tick any other. */
  pickType(type: StaffType): void {
    this.patchForm({ staff_type: type });
    if (this.form()?.id) return;
    const preset = STAFF_PRESETS[type].filter((p) => this.ceilingSet().has(p));
    this.formPerms.set(preset);
  }

  patchForm(patch: Partial<UserForm>): void {
    this.formError.set(null);
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    this.showErrors.set(true);
    if (this.nameError() || this.emailError() || this.passwordError()) return;
    this.saving.set(true);
    this.formError.set(null);

    if (!f.id) {
      const body: UserCreateInput = {
        email: f.email.trim(),
        full_name: f.full_name.trim(),
        phone: f.phone.trim() || undefined,
        job_title: f.job_title.trim() || undefined,
        staff_type: f.staff_type,
        permissions: this.formPerms(),
      };
      if (f.password) body.password = f.password;
      this.svc.createUser(this.api(), body).subscribe({
        next: (res) => {
          this.saving.set(false);
          this.form.set(null);
          this.credential.set({ title: 'Login created', name: res.user.full_name, email: res.user.email, password: res.temporaryPassword });
          this.list.reload();
          this.changed.emit();
        },
        error: (err) => this.fail(err),
      });
      return;
    }

    const patch: UserPatch = { full_name: f.full_name.trim(), phone: f.phone.trim(), job_title: f.job_title.trim() };
    if (!f.isOwner) patch.staff_type = f.staff_type;
    if (!f.isOwner) patch.permissions = this.formPerms();
    this.svc.updateUser(this.api(), f.id, patch).subscribe({
      next: (u) => {
        this.saving.set(false);
        this.form.set(null);
        this.ui.success(`${u.full_name || 'User'} updated.`);
        this.list.reload();
        this.changed.emit();
      },
      error: (err) => this.fail(err),
    });
  }

  // ── row actions ──

  async resetPassword(u: PartnerUser): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Reset password for ${u.full_name || u.email}?`,
      message: 'A new temporary password is created and the old one stops working at once. You will see it once, and they must choose their own when they sign in.',
      confirmText: 'Reset password',
    });
    if (!ok) return;
    this.busyId.set(u.id);
    this.svc.resetPassword(this.api(), u.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.credential.set({ title: 'New temporary password', name: res.user.full_name, email: res.user.email, password: res.temporaryPassword });
        this.list.reload();
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  async switchOff(u: PartnerUser): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Switch off ${u.full_name || u.email}?`,
      message: 'They can no longer sign in or use the portal. Their history stays and you can switch them on again later.',
      confirmText: 'Switch off',
      danger: true,
    });
    if (!ok) return;
    this.busyId.set(u.id);
    this.svc.deactivateUser(this.api(), u.id).subscribe({
      next: () => this.done(`${u.full_name || u.email} can no longer sign in.`),
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  switchOn(u: PartnerUser): void {
    this.busyId.set(u.id);
    this.svc.updateUser(this.api(), u.id, { is_active: true }).subscribe({
      next: () => this.done(`${u.full_name || u.email} can sign in again.`),
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  closeCredential(): void {
    this.credential.set(null);
  }

  private done(message: string): void {
    this.busyId.set(null);
    this.ui.success(message);
    this.list.reload();
    this.changed.emit();
  }

  private fail(err: unknown): void {
    this.saving.set(false);
    // 403 / 409 / 400: keep the form open and explain next to it
    this.formError.set(apiErrorMessage(err));
  }

  private reset(): void {
    this.formError.set(null);
    this.showErrors.set(false);
    this.showPassword.set(false);
  }

  private focusFirst(): void {
    setTimeout(() => document.getElementById('puName')?.focus());
  }
}
