import { Component, DestroyRef, HostListener, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { DatePipe } from '@angular/common';
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
import { RoleRecord, RolesApiService } from '../../../core/services/roles-api.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../empty-state.component';
import { PaginationComponent } from '../pagination.component';
import { SearchInputComponent } from '../search-input.component';
import { PermissionMatrixComponent } from '../permission-matrix/permission-matrix.component';
import { MultiOption, MultiSelectComponent } from '../multi-select/multi-select.component';
import { TempPasswordDialogComponent } from './temp-password-dialog.component';

const PAGE_LIMIT = 20;
const PASSWORD_MIN = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const STAFF_TYPES: { id: StaffType; label: string }[] = [
  { id: 'master', label: 'Master' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'qa', label: 'Quality check (QA)' },
  { id: 'pressing', label: 'Pressing' },
  { id: 'packing', label: 'Packing' },
  { id: 'staff', label: 'Other staff' },
];

/** Starting point only; the real access is whatever the partner saves. */
export const STAFF_PRESETS: Record<StaffType, string[]> = {
  master: ['overview.view', 'production.view', 'production.update', 'quality.view', 'quality.update', 'teams.view'],
  tailor: ['production.view', 'production.update'],
  qa: ['overview.view', 'production.view', 'quality.view', 'quality.update'],
  pressing: ['production.view', 'production.update'],
  packing: ['production.view', 'production.update'],
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
  /** The person is asked for a password of their own at the first sign-in. */
  mustChange: boolean;
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
  imports: [DatePipe, IonSpinner, EmptyStateComponent, PaginationComponent, SearchInputComponent, PermissionMatrixComponent, TempPasswordDialogComponent, MultiSelectComponent],
  templateUrl: './partner-users-panel.component.html',
  styleUrls: ['./partner-users-panel.component.scss'],
})
export class PartnerUsersPanelComponent {
  private svc = inject(PartnerAdminService);
  private rolesApi = inject(RolesApiService);
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
  /** Settings > Users are not team people: no Master / Tailor / QA type to choose and none shown. */
  readonly hideType = input(false);
  /** Show the "Add user" button in the panel's toolbar (the page can host its own and call `openNew()`). */
  readonly showAddButton = input(true);
  /** Access comes from roles (chosen in the form) and the login can be tagged with a team member, instead of ticking permissions one by one. */
  readonly useRoles = input(false);
  /** Something changed (user added / edited / switched): lets a parent refresh its figures. */
  readonly changed = output<void>();

  readonly skeleton = SKELETON_ROWS;
  readonly titles = JOB_TITLE_SUGGESTIONS;
  readonly staffTypes = STAFF_TYPES;
  staffTypeLabel(type: string | null | undefined): string {
    return STAFF_TYPES.find((t) => t.id === type)?.label ?? 'Staff';
  }
  readonly passwordMin = PASSWORD_MIN;

  readonly list = new PagedList<PartnerUser>();
  readonly search = signal('');
  readonly page = signal(1);
  readonly busyId = signal<string | null>(null);

  /** The person whose details are open in the side panel. */
  readonly detailId = signal<string | null>(null);
  readonly openUser = computed(() => this.list.items().find((u) => u.id === this.detailId()) ?? null);

  readonly form = signal<UserForm | null>(null);
  readonly formPerms = signal<string[]>([]);
  readonly roleOptions = signal<RoleRecord[]>([]);
  readonly teamOptions = signal<{ id: string; name: string; role: string }[]>([]);
  readonly formRoleIds = signal<string[]>([]);
  readonly formTeamId = signal('');
  /** The roles were changed in this form (an older user without roles keeps their access until then). */
  readonly rolesTouched = signal(false);
  private readonly roleName = computed(() => new Map(this.roleOptions().map((r) => [r.id, r.name])));
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly showPassword = signal(false);
  readonly credential = signal<Credential | null>(null);

  private readonly ceilingSet = computed(() => new Set(this.ceiling()));
  /** Which partner's users these are. 'pending' until the parent has bound `api` (a required input cannot be read before that). */
  private readonly apiKey = computed(() => {
    let a: PartnerUsersApi;
    try {
      a = this.api();
    } catch {
      return 'pending';
    }
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
      toObservable(computed(() => ({ key: this.apiKey(), search: this.search(), page: this.page() }))).pipe(filter((p) => p.key !== 'pending')),
      () => this.svc.listUsers(this.api(), { search: this.search(), page: this.page(), limit: PAGE_LIMIT }),
      this.destroyRef
    );
    // the role names the table and the side panel show
    effect(() => {
      if (this.useRoles() && this.apiKey() !== 'pending') untracked(() => this.loadRoles());
    });
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
    if (this.ui.confirmState() || this.credential() || this.saving()) return;
    if (this.form()) this.closeForm();
    else if (this.detailId()) this.detailId.set(null);
  }

  openDetail(u: PartnerUser): void {
    this.detailId.set(u.id);
  }

  closeDetail(): void {
    this.detailId.set(null);
  }

  /** Two letters for the round avatar. */
  initials(u: { full_name: string | null; email: string }): string {
    const parts = (u.full_name || u.email || '?').trim().split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
  }

  /** The names of the roles a user holds. */
  rolesOf(u: PartnerUser): string[] {
    return (u.role_ids ?? []).map((id) => this.roleName().get(id)).filter((n): n is string => !!n);
  }

  /** The roles the form can choose from (and a hint when there are none yet). */
  loadRoles(): void {
    this.rolesApi.list('partner').subscribe({ next: (r) => this.roleOptions.set(r.filter((x) => !x.locked)), error: () => this.roleOptions.set([]) });
  }

  private loadTeam(userId: string | null): void {
    this.svc.taggableTeam(userId).subscribe({ next: (t) => this.teamOptions.set(t), error: () => this.teamOptions.set([]) });
  }

  readonly roleChoices = computed<MultiOption[]>(() => this.roleOptions().map((r) => ({ id: r.id, label: r.name, hint: r.description || `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}` })));

  setRoles(ids: string[]): void {
    this.rolesTouched.set(true);
    this.formError.set(null);
    this.formRoleIds.set(ids);
  }

  /** Every module with what the person may do in it: the readable form of their permissions. */
  access(u: PartnerUser): { id: string; label: string; description: string; actions: string[] }[] {
    const perms = new Set(u.is_owner ? this.ceiling() : u.permissions || []);
    return this.modules()
      .filter((m) => !u.is_owner || m.actions.some((a) => perms.has(`${m.id}.${a}`)))
      .map((m) => {
        const base = m.actions.filter((a) => perms.has(`${m.id}.${a}`)).map((a) => (a === 'update' ? (m.detail?.length ? 'Full control' : 'Change') : a === 'create' ? 'Create' : 'View'));
        // with Full control every button is allowed: list single buttons only when it is not ticked
        const detail = perms.has(`${m.id}.update`) ? [] : (m.detail ?? []).filter((d) => perms.has(`${m.id}.${d.id}`)).map((d) => d.label);
        return { id: m.id, label: m.label, description: m.description, actions: [...base, ...detail] };
      });
  }

  /** What the person is, in words: their job title, else the kind of staff. */
  roleLabel(u: PartnerUser): string {
    if (u.is_owner) return 'Owner';
    return u.job_title || (u.staff_type && u.staff_type !== 'staff' ? this.staffTypeLabel(u.staff_type) : 'Staff');
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
    this.formRoleIds.set([]);
    this.formTeamId.set('');
    this.rolesTouched.set(true);
    if (this.useRoles()) { this.loadRoles(); this.loadTeam(null); }
    this.form.set({ id: null, isOwner: false, full_name: '', email: '', phone: '', job_title: '', staff_type: 'staff', password: '', mustChange: true });
    this.focusFirst();
  }

  openEdit(u: PartnerUser): void {
    this.reset();
    // permissions beyond the ceiling cannot be handed out any more, so they are not shown as ticked
    this.formPerms.set((u.permissions || []).filter((p) => this.ceilingSet().has(p)));
    this.formRoleIds.set([...(u.role_ids ?? [])]);
    this.formTeamId.set(u.team_member?.id ?? '');
    this.rolesTouched.set(false);
    if (this.useRoles()) { this.loadRoles(); this.loadTeam(u.id); }
    this.form.set({ id: u.id, isOwner: u.is_owner, full_name: u.full_name || '', email: u.email, phone: u.phone || '', job_title: u.job_title || '', staff_type: u.staff_type || 'staff', password: '', mustChange: true });
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

  /** A strong random password the partner can read out or send. */
  generatePassword(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint32Array(12));
    this.patchForm({ password: Array.from(bytes, (n) => chars[n % chars.length]).join('') });
    this.showPassword.set(true);
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
      };
      if (this.useRoles()) {
        body.role_ids = this.formRoleIds();
        if (this.formTeamId()) body.team_member_id = this.formTeamId();
      } else {
        body.staff_type = f.staff_type;
        body.permissions = this.formPerms();
      }
      if (f.password) body.password = f.password;
      body.must_change_password = f.mustChange;
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
    if (this.useRoles()) {
      if (!f.isOwner) {
        if (this.rolesTouched()) patch.role_ids = this.formRoleIds();
        patch.team_member_id = this.formTeamId() || null;
      }
    } else {
      if (!f.isOwner) patch.staff_type = f.staff_type;
      if (!f.isOwner) patch.permissions = this.formPerms();
    }
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
