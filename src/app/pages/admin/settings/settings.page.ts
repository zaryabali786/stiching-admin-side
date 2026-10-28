import { Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { distinctUntilChanged, filter, map } from 'rxjs';
import { AdminModule, AdminService, AdminUser, ExpressShippingSetting, ExpressStitchingSetting, PostexSettings, QcApprovalSetting, ShipToAddress, UserRoleFilter } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';
import { Role } from '../../../core/models/api.models';
import { DayPipe } from '../../../shared/pipes';
import { GeoService } from '../../../core/services/geo.service';
import { GeoPickerComponent } from '../../../shared/components/geo-picker.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PAGE_SIZES, PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';

type SettingsTab = 'team' | 'address' | 'express' | 'workflow' | 'postex' | 'account';
type TeamRole = UserRoleFilter;
const TABS: readonly SettingsTab[] = ['team', 'address', 'express', 'workflow', 'postex', 'account'];
const TEAM_ROLES: readonly TeamRole[] = ['staff', 'admin', 'partner_staff', 'customer'];

interface SettingsQuery {
  tab: SettingsTab;
  role: TeamRole;
  search: string;
  page: number;
  limit: number;
}

interface AccessDialog {
  mode: 'create' | 'edit' | 'promote';
  user: AdminUser | null;
  name: string;
  email: string;
  phone: string;
  title: string;
  password: string;
  showPassword: boolean;
  mustChange: boolean;
  full: boolean;
  modules: string[];
  busy: boolean;
  error: string | null;
  /** After creating a user or resetting a password: the one-time password to hand over. */
  done: { email: string; password: string; message: string } | null;
}

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', partner_staff: 'Partner staff', customer: 'Customer' };

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [RouterLink, IonSpinner, DayPipe, GeoPickerComponent, SearchInputComponent, PaginationComponent, EmptyStateComponent],
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
  readonly pageSizes = PAGE_SIZES;
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

  /** User management is for full admins only; a restricted admin lands on the first settings tab. */
  private readonly defaultTab: SettingsTab = this.auth.isFullAdmin() ? 'team' : 'address';
  readonly query = signal<SettingsQuery>({ tab: this.defaultTab, role: 'staff', search: '', page: 1, limit: 15 });
  readonly list = new PagedList<AdminUser>();
  readonly busyId = signal<string | null>(null);

  // ── Ship-to address: where customers send parcels ──
  private readonly geo = inject(GeoService);
  private static readonly EMPTY_SHIP_TO: ShipToAddress = { name: '', company: '', address: '', address2: '', city: '', phone: '', country: '', country_code: '', state: '', province_code: '', zip: '' };
  /** name, street, phone and postal code are plain fields; country, state and city come from the pickers below (their own signals). */
  readonly shipTo = signal<ShipToAddress>({ ...AdminSettingsPage.EMPTY_SHIP_TO });
  readonly stCountry = signal('');
  readonly stState = signal('');
  readonly stCity = signal('');
  readonly stCountryCode = signal('');
  readonly stProvinceCode = signal('');
  private readonly shipToSaved = signal<ShipToAddress>({ ...AdminSettingsPage.EMPTY_SHIP_TO });
  readonly shipToLoaded = signal(false);
  readonly savingShipTo = signal(false);
  /** The whole address as it would be saved. */
  readonly shipToForm = computed<ShipToAddress>(() => ({ ...this.shipTo(), country: this.stCountry(), state: this.stState(), city: this.stCity(), country_code: this.stCountryCode(), province_code: this.stProvinceCode() }));
  readonly shipToDirty = computed(() => JSON.stringify(this.shipToForm()) !== JSON.stringify(this.shipToSaved()));
  readonly codeMissing = computed(() => !!this.stCountry() && !/^[A-Za-z]{2}$/.test(this.stCountryCode()));
  readonly shipToValid = computed(() => !!this.shipTo().address.trim() && !!this.stCity().trim() && !!this.stCountry().trim() && /^[A-Za-z]{2}$/.test(this.stCountryCode().trim()));

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

  // ── Priority stitching: the days are decided here and shown to customers when they create an order ──
  readonly express = signal<ExpressStitchingSetting>({ enabled: true, days: 5, price_pkr: 0 });
  private readonly expressSaved = signal<ExpressStitchingSetting>({ enabled: true, days: 5, price_pkr: 0 });
  readonly expressLoaded = signal(false);
  readonly savingExpress = signal(false);
  readonly expressDirty = computed(() => JSON.stringify(this.express()) !== JSON.stringify(this.expressSaved()));
  readonly expressValid = computed(() => Number.isInteger(this.express().days) && this.express().days >= 1 && this.express().days <= 90 && this.express().price_pkr >= 0);

  // ── Fast shipping: same idea, the days of the delivery (no price) ──
  readonly expressShip = signal<ExpressShippingSetting>({ enabled: true, days: 3 });
  private readonly expressShipSaved = signal<ExpressShippingSetting>({ enabled: true, days: 3 });
  readonly expressShipLoaded = signal(false);
  readonly savingExpressShip = signal(false);
  readonly expressShipDirty = computed(() => JSON.stringify(this.expressShip()) !== JSON.stringify(this.expressShipSaved()));
  readonly expressShipValid = computed(() => Number.isInteger(this.expressShip().days) && this.expressShip().days >= 1 && this.expressShip().days <= 90);

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
        this.ui.success(res.message || 'Fast shipping saved.');
      },
      error: (err) => {
        this.savingExpressShip.set(false);
        this.ui.error(err);
      },
    });
  }

  // Client approval after QC: what the server has saved, and what the admin has chosen but not saved yet
  readonly qcApproval = signal<QcApprovalSetting>({ required: true });
  private readonly qcApprovalSaved = signal<QcApprovalSetting>({ required: true });
  readonly qcApprovalLoaded = signal(false);
  readonly savingQcApproval = signal(false);
  readonly qcApprovalDirty = computed(() => this.qcApproval().required !== this.qcApprovalSaved().required);

  saveQcApproval(): void {
    if (!this.qcApprovalLoaded() || !this.qcApprovalDirty() || this.savingQcApproval()) return;
    this.savingQcApproval.set(true);
    this.admin.setQcApproval(this.qcApproval().required).subscribe({
      next: (res) => {
        this.savingQcApproval.set(false);
        this.qcApproval.set(res.data);
        this.qcApprovalSaved.set(res.data);
        this.ui.success(res.message || 'Saved.');
      },
      error: (err) => {
        this.savingQcApproval.set(false);
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
        this.ui.success(res.message || 'Priority stitching saved.');
      },
      error: (err) => {
        this.savingExpress.set(false);
        this.ui.error(err);
      },
    });
  }

  private applyShipTo(a: ShipToAddress): void {
    const full = { ...AdminSettingsPage.EMPTY_SHIP_TO, ...a };
    this.shipTo.set(full);
    this.stCountry.set(full.country);
    this.stState.set(full.state);
    this.stCity.set(full.city);
    this.stCountryCode.set(full.country_code);
    this.stProvinceCode.set(full.province_code);
    this.shipToSaved.set(full);
  }

  setShipToField(key: keyof ShipToAddress, value: string): void {
    this.shipTo.update((a) => ({ ...a, [key]: value }));
  }

  saveShipTo(): void {
    if (!this.shipToValid() || this.savingShipTo()) return;
    this.savingShipTo.set(true);
    this.admin.setShipTo(this.shipToForm()).subscribe({
      next: (res) => {
        this.savingShipTo.set(false);
        this.applyShipTo(res.data);
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

  constructor() {
    // the codes Shopify needs follow the chosen country and state (a code that cannot be found keeps what was saved)
    effect(() => {
      const country = this.stCountry();
      untracked(() => void this.geo.countryCodeOf(country).then((code) => { if (country === this.stCountry() && code) this.stCountryCode.set(code); }));
    });
    effect(() => {
      const country = this.stCountry();
      const state = this.stState();
      untracked(() => {
        if (!state) {
          this.stProvinceCode.set('');
          return;
        }
        void this.geo.stateCodeOf(country, state).then((code) => { if (state === this.stState() && country === this.stCountry()) this.stProvinceCode.set(code); });
      });
    });
  }

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): SettingsQuery => ({
        tab: this.auth.isFullAdmin() || p.get('tab') !== 'team' ? oneOf(p.get('tab'), TABS, this.defaultTab) : this.defaultTab,
        role: oneOf(p.get('role'), TEAM_ROLES, 'staff'),
        search: p.get('search') || '',
        page: intParam(p, 'page', 1),
        limit: intParam(p, 'limit', 15, PAGE_SIZES),
      })),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    q$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => this.query.set(q));

    this.list.connect(
      q$.pipe(filter((q) => q.tab === 'team' && this.auth.isFullAdmin())),
      (q) => this.admin.listUsers({ role: q.role, search: q.search, page: q.page, limit: q.limit }),
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
    this.admin.getQcApproval().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (q) => {
        this.qcApproval.set(q);
        this.qcApprovalSaved.set(q);
        this.qcApprovalLoaded.set(true);
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
        this.applyShipTo(a);
        this.shipToLoaded.set(true);
      },
      error: (err) => this.ui.error(err),
    });

    const u = this.auth.user();
    this.fullName.set(u?.full_name || '');
    this.phone.set(u?.phone || '');
  }

  setTab(tab: SettingsTab): void {
    setQuery(this.router, this.route, { tab: tab === this.defaultTab ? null : tab, page: null, search: null, role: null });
  }

  setRole(role: TeamRole): void {
    setQuery(this.router, this.route, { role: role === 'staff' ? null : role, page: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  setLimit(value: string): void {
    const n = parseInt(value, 10);
    setQuery(this.router, this.route, { limit: n === 15 ? null : n, page: null });
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
    if (role === 'admin') {
      select.value = user.role;
      this.openPromote(user);
      return;
    }
    const ok = await this.ui.confirm({
      title: `Make ${user.full_name || user.email} a customer?`,
      message: 'Their admin access and modules are removed. They keep a customer account.',
      confirmText: 'Remove admin access',
      danger: true,
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

  // ── Add user / edit access: admin-side logins and the admin modules they may use ──

  readonly moduleList = signal<AdminModule[]>([]);
  readonly dlg = signal<AccessDialog | null>(null);

  private loadModules(): void {
    if (this.moduleList().length) return;
    this.admin.adminModules().subscribe({ next: (m) => this.moduleList.set(m), error: (err) => this.ui.error(err) });
  }

  private blankDialog(mode: AccessDialog['mode']): AccessDialog {
    return { mode, user: null, name: '', email: '', phone: '', title: '', password: '', showPassword: false, mustChange: true, full: false, modules: [], busy: false, error: null, done: null };
  }

  openCreate(): void {
    this.loadModules();
    this.dlg.set(this.blankDialog('create'));
  }

  openEdit(user: AdminUser): void {
    this.loadModules();
    this.dlg.set({ ...this.blankDialog('edit'), user, name: user.full_name || '', email: user.email, title: user.job_title || '', full: user.admin_access === 'full', modules: [...(user.admin_modules ?? [])] });
  }

  /** A customer becomes an admin: choose what they may use first (full admin access is a separate, explicit choice). */
  openPromote(user: AdminUser): void {
    this.loadModules();
    this.dlg.set({ ...this.blankDialog('promote'), user, name: user.full_name || '', email: user.email });
  }

  patchDlg(patch: Partial<AccessDialog>): void {
    this.dlg.update((d) => (d ? { ...d, ...patch, error: null } : d));
  }

  toggleModule(id: string): void {
    this.dlg.update((d) => (d ? { ...d, error: null, modules: d.modules.includes(id) ? d.modules.filter((m) => m !== id) : [...d.modules, id] } : d));
  }

  setAllModules(all: boolean): void {
    this.dlg.update((d) => (d ? { ...d, error: null, modules: all ? this.moduleList().map((m) => m.id) : [] } : d));
  }

  generatePassword(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint32Array(12));
    this.patchDlg({ password: Array.from(bytes, (n) => chars[n % chars.length]).join(''), showPassword: true });
  }

  closeDlg(): void {
    if (!this.dlg()?.busy) this.dlg.set(null);
  }

  /** What is wrong with the form, or null when it can be sent. */
  dlgProblem(d: AccessDialog): string | null {
    if (d.mode === 'create') {
      if (!d.name.trim()) return 'Enter the full name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'Enter a valid email address.';
      if (d.password && d.password.length < 8) return 'The password must be at least 8 characters (or leave it empty to generate one).';
    }
    if (!d.full && !d.modules.length) return 'Choose at least one module, or switch on full admin access.';
    return null;
  }

  submitDlg(): void {
    const d = this.dlg();
    if (!d || d.busy) return;
    const problem = this.dlgProblem(d);
    if (problem) {
      this.patchDlg({ error: problem });
      return;
    }
    const access = d.full ? { full_access: true } : { modules: d.modules };
    const fail = (err: unknown) => this.dlg.update((x) => (x ? { ...x, busy: false, error: apiErrorMessage(err) } : x));
    this.dlg.update((x) => (x ? { ...x, busy: true, error: null } : x));

    if (d.mode === 'create') {
      this.admin.createAdminUser({ full_name: d.name.trim(), email: d.email.trim(), password: d.password || undefined, phone: d.phone.trim() || undefined, job_title: d.title.trim() || undefined, must_change_password: d.mustChange, ...access }).subscribe({
        next: (res) => {
          this.dlg.update((x) => (x ? { ...x, busy: false, done: { email: res.data.user.email, password: res.data.temporaryPassword, message: res.message || 'User created.' } } : x));
          this.list.reload();
        },
        error: fail,
      });
    } else if (d.mode === 'edit' && d.user) {
      this.admin.setAdminUserAccess(d.user.id, { ...access, job_title: d.title.trim() }).subscribe({
        next: (res) => {
          this.dlg.set(null);
          this.ui.success(res.message || 'Access updated.');
          this.list.reload();
        },
        error: fail,
      });
    } else if (d.mode === 'promote' && d.user) {
      const user = d.user;
      this.admin.setUserRole(user.id, 'admin').subscribe({
        next: () =>
          this.admin.setAdminUserAccess(user.id, { ...access, job_title: d.title.trim() || undefined }).subscribe({
            next: () => {
              this.dlg.set(null);
              this.ui.success(`${user.full_name || user.email} is now an admin.`);
              this.list.reload();
            },
            error: fail,
          }),
        error: fail,
      });
    }
  }

  async resetPassword(user: AdminUser): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Reset the password of ${user.full_name || user.email}?`,
      message: 'A new one-time password is made. They must choose their own at the next sign-in.',
      confirmText: 'Reset password',
      danger: true,
    });
    if (!ok) return;
    this.busyId.set(user.id);
    this.admin.resetAdminUserPassword(user.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.dlg.set({ ...this.blankDialog('edit'), user, name: user.full_name || '', email: user.email, done: { email: user.email, password: res.data.temporaryPassword, message: res.message || 'Password reset.' } });
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.ui.success('Copied.');
    } catch {
      this.ui.error('Could not copy. Select the text and copy it by hand.');
    }
  }

  /** Two letters for the avatar of a person. */
  initials(u: AdminUser): string {
    const source = (u.full_name || u.email || '?').trim();
    const parts = source.split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
  }

  moduleLabel(id: string): string {
    return this.moduleList().find((m) => m.id === id)?.label || id;
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
