import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { distinctUntilChanged, filter, map } from 'rxjs';
import { AdminService, AdminUser, UserRoleFilter } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { UiService } from '../../../core/services/ui.service';
import { Role } from '../../../core/models/api.models';
import { DayPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';

type SettingsTab = 'team' | 'account';
type TeamRole = UserRoleFilter;
const TABS: readonly SettingsTab[] = ['team', 'account'];
const TEAM_ROLES: readonly TeamRole[] = ['staff', 'admin', 'partner_staff', 'customer'];

interface SettingsQuery {
  tab: SettingsTab;
  role: TeamRole;
  search: string;
  page: number;
}

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', partner_staff: 'Partner staff', customer: 'Customer' };

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [RouterLink, IonSpinner, DayPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent],
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
})
export class AdminSettingsPage implements OnInit {
  private admin = inject(AdminService);
  readonly auth = inject(AuthService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly roleFilters: { key: TeamRole; label: string }[] = [
    { key: 'staff', label: 'All staff' },
    { key: 'admin', label: 'Admins' },
    { key: 'partner_staff', label: 'Partner staff' },
    { key: 'customer', label: 'Customers' },
  ];
  /** Only these two can be set here; partner users are managed under Partners. */
  readonly roles: { value: Role; label: string }[] = [
    { value: 'admin', label: 'Admin' },
    { value: 'customer', label: 'Customer' },
  ];

  readonly query = signal<SettingsQuery>({ tab: 'team', role: 'staff', search: '', page: 1 });
  readonly list = new PagedList<AdminUser>();
  readonly busyId = signal<string | null>(null);
  readonly me = computed(() => this.auth.user()?.id ?? null);

  // Account
  readonly fullName = signal('');
  readonly phone = signal('');
  readonly savingProfile = signal(false);
  readonly currentPw = signal('');
  readonly newPw = signal('');
  readonly confirmPw = signal('');
  readonly savingPw = signal(false);
  readonly profileDirty = computed(() => {
    const u = this.auth.user();
    return !!u && (this.fullName().trim() !== (u.full_name || '') || this.phone().trim() !== (u.phone || ''));
  });
  readonly pwError = computed(() => {
    if (!this.newPw()) return null;
    if (this.newPw().length < 8) return 'Use at least 8 characters.';
    if (this.confirmPw() && this.confirmPw() !== this.newPw()) return 'Passwords do not match.';
    return null;
  });
  readonly pwValid = computed(() => !!this.currentPw() && this.newPw().length >= 8 && this.newPw() === this.confirmPw());

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): SettingsQuery => ({
        tab: oneOf(p.get('tab'), TABS, 'team'),
        role: oneOf(p.get('role'), TEAM_ROLES, 'staff'),
        search: p.get('search') || '',
        page: intParam(p, 'page', 1),
      })),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    q$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => this.query.set(q));

    this.list.connect(
      q$.pipe(filter((q) => q.tab !== 'account')),
      (q) => this.admin.listUsers({ role: q.role, search: q.search, page: q.page, limit: 15 }),
      this.destroyRef
    );

    const u = this.auth.user();
    this.fullName.set(u?.full_name || '');
    this.phone.set(u?.phone || '');
  }

  setTab(tab: SettingsTab): void {
    setQuery(this.router, this.route, { tab: tab === 'team' ? null : tab, page: null, search: null, role: null });
  }

  setRole(role: TeamRole): void {
    setQuery(this.router, this.route, { role: role === 'staff' ? null : role, page: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  roleLabel(role: string | null): string {
    return role ? ROLE_LABELS[role as Role] || role : '—';
  }

  // ── Team & roles ──

  async changeRole(user: AdminUser, select: HTMLSelectElement): Promise<void> {
    const role = select.value as 'admin' | 'customer';
    if (role === user.role) return;
    const ok = await this.ui.confirm({
      title: `Make ${user.full_name || user.email} ${this.roleLabel(role).toLowerCase()}?`,
      message:
        role === 'admin'
          ? 'Admins can see all orders, money and settings, and can change other people’s roles.'
          : 'Their admin access is removed. They keep a customer account.',
      confirmText: 'Change role',
      danger: user.role === 'admin' || role === 'customer',
    });
    if (!ok) {
      select.value = user.role;
      return;
    }
    this.busyId.set(user.id);
    this.admin.setUserRole(user.id, role).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.ui.success(res.message || 'Role updated.');
        this.list.reload();
      },
      error: (err) => {
        this.busyId.set(null);
        select.value = user.role;
        this.ui.error(err);
      },
    });
  }

  async toggleActive(user: AdminUser): Promise<void> {
    const activate = !user.is_active;
    const ok = await this.ui.confirm({
      title: `${activate ? 'Activate' : 'Deactivate'} ${user.full_name || user.email}?`,
      message: activate ? 'They can sign in again.' : 'They will be signed out and cannot sign in until reactivated.',
      confirmText: activate ? 'Activate' : 'Deactivate',
      danger: !activate,
    });
    if (!ok) return;
    this.busyId.set(user.id);
    this.admin.setUserActive(user.id, activate).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.list.patch((u) => u.id === user.id, (u) => ({ ...u, is_active: activate }));
        this.ui.success(res.message || (activate ? 'Account activated.' : 'Account deactivated.'));
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  // ── Account ──

  async saveProfile(): Promise<void> {
    if (!this.profileDirty() || this.savingProfile()) return;
    if (!this.fullName().trim()) {
      this.ui.error('Enter your name.');
      return;
    }
    this.savingProfile.set(true);
    try {
      const user = await this.auth.updateProfile({ fullName: this.fullName().trim(), phone: this.phone().trim() });
      this.fullName.set(user.full_name || '');
      this.phone.set(user.phone || '');
      this.ui.success('Profile updated.');
    } catch (err) {
      this.ui.error(err);
    } finally {
      this.savingProfile.set(false);
    }
  }

  async changePassword(): Promise<void> {
    if (!this.pwValid() || this.savingPw()) return;
    this.savingPw.set(true);
    try {
      const message = await this.auth.changePassword(this.currentPw(), this.newPw());
      this.currentPw.set('');
      this.newPw.set('');
      this.confirmPw.set('');
      this.ui.success(message || 'Password changed.');
    } catch (err) {
      this.ui.error(err);
    } finally {
      this.savingPw.set(false);
    }
  }
}
