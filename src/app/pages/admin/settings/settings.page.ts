import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { distinctUntilChanged, filter, map } from 'rxjs';
import { AdminService, AdminUser, ExpressShippingSetting, ExpressStitchingSetting, PostexSettings, ShipToAddress, UserRoleFilter } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { UiService } from '../../../core/services/ui.service';
import { Role } from '../../../core/models/api.models';
import { DayPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';

type SettingsTab = 'team' | 'address' | 'express' | 'postex' | 'account';
type TeamRole = UserRoleFilter;
const TABS: readonly SettingsTab[] = ['team', 'address', 'express', 'postex', 'account'];
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

  // ── Ship-to address: where customers send parcels ──
  readonly shipTo = signal<ShipToAddress>({ name: '', address: '', city: '', phone: '' });
  private readonly shipToSaved = signal<ShipToAddress>({ name: '', address: '', city: '', phone: '' });
  readonly shipToLoaded = signal(false);
  readonly savingShipTo = signal(false);
  readonly shipToDirty = computed(() => JSON.stringify(this.shipTo()) !== JSON.stringify(this.shipToSaved()));
  readonly shipToValid = computed(() => !!this.shipTo().address.trim() && !!this.shipTo().city.trim());

  // ── PostEx courier connection: the token is entered here and stays on the server (only its last 4 characters come back) ──
  readonly postex = signal<PostexSettings | null>(null);
  /** The form: the token field is empty unless the admin types a new one. */
  readonly pxForm = signal({ token: '', baseUrl: '', pickupAddressCode: '', storeAddressCode: '', orderType: 'Normal', pollMinutes: 15 });
  readonly showToken = signal(false);
  readonly savingPostex = signal(false);
  readonly testingPostex = signal(false);
  readonly postexTest = signal<{ ok: boolean; message: string } | null>(null);
  /** The addresses of the PostEx account, loaded on request: the codes PostEx really accepts. */
  readonly pxAddresses = signal<{ addressCode: string; type: string; city: string; address: string; contact: string; phone: string }[] | null>(null);
  readonly loadingPxAddresses = signal(false);

  loadPostexAddresses(): void {
    if (this.loadingPxAddresses()) return;
    this.loadingPxAddresses.set(true);
    this.admin.postexAddresses().subscribe({
      next: (list) => {
        this.loadingPxAddresses.set(false);
        this.pxAddresses.set(list);
      },
      error: (err) => {
        this.loadingPxAddresses.set(false);
        this.ui.error(err);
      },
    });
  }

  setPx(patch: Partial<{ token: string; baseUrl: string; pickupAddressCode: string; storeAddressCode: string; orderType: string; pollMinutes: number }>): void {
    this.pxForm.update((f) => ({ ...f, ...patch }));
  }

  private fillPostex(p: PostexSettings): void {
    this.postex.set(p);
    this.pxForm.set({ token: '', baseUrl: p.baseUrl, pickupAddressCode: p.pickupAddressCode, storeAddressCode: p.storeAddressCode, orderType: p.orderType, pollMinutes: p.pollMinutes });
  }

  savePostex(clearToken = false): void {
    if (this.savingPostex()) return;
    const f = this.pxForm();
    this.savingPostex.set(true);
    this.postexTest.set(null);
    this.admin.setPostex({ token: f.token.trim() || undefined, clearToken: clearToken || undefined, baseUrl: f.baseUrl.trim(), pickupAddressCode: f.pickupAddressCode.trim(), storeAddressCode: f.storeAddressCode.trim(), orderType: f.orderType.trim(), pollMinutes: Number(f.pollMinutes) }).subscribe({
      next: (res) => {
        this.savingPostex.set(false);
        this.fillPostex(res.data);
        this.showToken.set(false);
        this.ui.success(res.message || 'PostEx saved.');
      },
      error: (err) => {
        this.savingPostex.set(false);
        this.ui.error(err);
      },
    });
  }

  testPostexConnection(): void {
    if (this.testingPostex()) return;
    this.testingPostex.set(true);
    this.postexTest.set(null);
    this.admin.testPostex().subscribe({
      next: (res) => {
        this.testingPostex.set(false);
        this.postexTest.set({ ok: true, message: res.message || 'PostEx answered. The token works.' });
      },
      error: (err) => {
        this.testingPostex.set(false);
        this.postexTest.set({ ok: false, message: err?.error?.message || err?.message || 'PostEx did not accept the connection.' });
      },
    });
  }

  // ── Express stitching: the days are decided here and shown to customers when they create an order ──
  readonly express = signal<ExpressStitchingSetting>({ enabled: true, days: 5, price_pkr: 0 });
  private readonly expressSaved = signal<ExpressStitchingSetting>({ enabled: true, days: 5, price_pkr: 0 });
  readonly expressLoaded = signal(false);
  readonly savingExpress = signal(false);
  readonly expressDirty = computed(() => JSON.stringify(this.express()) !== JSON.stringify(this.expressSaved()));
  readonly expressValid = computed(() => Number.isInteger(this.express().days) && this.express().days >= 1 && this.express().days <= 90 && this.express().price_pkr >= 0);

  // ── Express shipping: same idea, the days of the delivery ──
  readonly expressShip = signal<ExpressShippingSetting>({ enabled: true, days: 3, price_pkr: 0 });
  private readonly expressShipSaved = signal<ExpressShippingSetting>({ enabled: true, days: 3, price_pkr: 0 });
  readonly expressShipLoaded = signal(false);
  readonly savingExpressShip = signal(false);
  readonly expressShipDirty = computed(() => JSON.stringify(this.expressShip()) !== JSON.stringify(this.expressShipSaved()));
  readonly expressShipValid = computed(() => Number.isInteger(this.expressShip().days) && this.expressShip().days >= 1 && this.expressShip().days <= 90 && this.expressShip().price_pkr >= 0);

  setExpressShip(patch: Partial<ExpressShippingSetting>): void {
    this.expressShip.update((e) => ({ ...e, ...patch }));
  }

  saveExpressShip(): void {
    if (!this.expressShipValid() || this.savingExpressShip()) return;
    this.savingExpressShip.set(true);
    this.admin.setExpressShipping(this.expressShip()).subscribe({
      next: (res) => {
        this.savingExpressShip.set(false);
        this.expressShip.set(res.data);
        this.expressShipSaved.set(res.data);
        this.ui.success(res.message || 'Express shipping saved.');
      },
      error: (err) => {
        this.savingExpressShip.set(false);
        this.ui.error(err);
      },
    });
  }

  setExpress(patch: Partial<ExpressStitchingSetting>): void {
    this.express.update((e) => ({ ...e, ...patch }));
  }

  saveExpress(): void {
    if (!this.expressValid() || this.savingExpress()) return;
    this.savingExpress.set(true);
    this.admin.setExpressStitching(this.express()).subscribe({
      next: (res) => {
        this.savingExpress.set(false);
        this.express.set(res.data);
        this.expressSaved.set(res.data);
        this.ui.success(res.message || 'Express stitching saved.');
      },
      error: (err) => {
        this.savingExpress.set(false);
        this.ui.error(err);
      },
    });
  }

  setShipToField(key: keyof ShipToAddress, value: string): void {
    this.shipTo.update((a) => ({ ...a, [key]: value }));
  }

  saveShipTo(): void {
    if (!this.shipToValid() || this.savingShipTo()) return;
    this.savingShipTo.set(true);
    this.admin.setShipTo(this.shipTo()).subscribe({
      next: (res) => {
        this.savingShipTo.set(false);
        this.shipTo.set(res.data);
        this.shipToSaved.set(res.data);
        this.ui.success(res.message || 'Address saved.');
      },
      error: (err) => {
        this.savingShipTo.set(false);
        this.ui.error(err);
      },
    });
  }

  // ── Orders: who receives a new order ──
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
      q$.pipe(filter((q) => q.tab === 'team')),
      (q) => this.admin.listUsers({ role: q.role, search: q.search, page: q.page, limit: 15 }),
      this.destroyRef
    );

    this.admin.getPostex().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => this.fillPostex(p),
      error: () => undefined,
    });

    this.admin.getExpressShipping().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (e) => {
        this.expressShip.set(e);
        this.expressShipSaved.set(e);
        this.expressShipLoaded.set(true);
      },
      error: (err) => this.ui.error(err),
    });
    this.admin.getExpressStitching().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (e) => {
        this.express.set(e);
        this.expressSaved.set(e);
        this.expressLoaded.set(true);
      },
      error: (err) => this.ui.error(err),
    });

    this.admin.getShipTo().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (a) => {
        this.shipTo.set(a);
        this.shipToSaved.set(a);
        this.shipToLoaded.set(true);
      },
      error: (err) => this.ui.error(err),
    });

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

  /** Promote a partner user (for example someone who signed up with Google) to admin. They leave their partner. */
  async makeAdmin(user: AdminUser): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Make ${user.full_name || user.email} an admin?`,
      message: 'They will be able to see all orders, money and settings, and change other people’s roles. They leave their partner and lose its partner permissions.',
      confirmText: 'Make admin',
      danger: true,
    });
    if (!ok) return;
    this.busyId.set(user.id);
    this.admin.setUserRole(user.id, 'admin').subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.ui.success(res.message || 'Role updated.');
        this.list.reload();
      },
      error: (err) => {
        this.busyId.set(null);
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
