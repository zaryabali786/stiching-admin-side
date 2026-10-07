import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { distinctUntilChanged, map } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { PartnerAdminService, PartnerCreateInput, PartnerListRow, PermissionModule } from '../../../core/services/partner-admin.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PermissionMatrixComponent } from '../../../shared/components/permission-matrix/permission-matrix.component';
import { TempPasswordDialogComponent } from '../../../shared/components/partner-users-panel/temp-password-dialog.component';
import { PagedList, intParam, oneOf, setQuery } from '../admin-list';
import { PartnerDetailComponent } from './partner-detail.component';

type StatusFilter = 'all' | 'active' | 'inactive';
const STATUSES: readonly StatusFilter[] = ['all', 'active', 'inactive'];
const PAGE_LIMIT = 24;
const PASSWORD_MIN = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ListQuery {
  status: StatusFilter;
  search: string;
  page: number;
}

interface NewPartnerForm {
  name: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  password: string;
}

interface Credential {
  name: string;
  email: string;
  password: string;
}

/** Admin: all partners, with a drawer per partner (figures, modules, users) and "New partner". */
@Component({
  selector: 'app-admin-partners',
  standalone: true,
  imports: [IonSpinner, EmptyStateComponent, PaginationComponent, SearchInputComponent, PermissionMatrixComponent, TempPasswordDialogComponent, PartnerDetailComponent],
  templateUrl: './partners.page.html',
  styleUrls: ['./partners.page.scss'],
})
export class AdminPartnersPage implements OnInit {
  private svc = inject(PartnerAdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly statuses = STATUSES;
  readonly passwordMin = PASSWORD_MIN;
  readonly skeleton = [1, 2, 3, 4, 5, 6];

  readonly list = new PagedList<PartnerListRow, { modules: PermissionModule[] }>();
  readonly query = signal<ListQuery>({ status: 'all', search: '', page: 1 });
  /** The partner whose drawer is open (kept in the URL as ?partner=). */
  readonly openId = signal<string | null>(null);

  /** Used only when the list has not delivered the catalogue (e.g. it failed to load). */
  private readonly fetchedModules = signal<PermissionModule[]>([]);
  readonly modules = computed(() => this.list.meta()?.modules ?? this.fetchedModules());
  readonly opening = signal(false);

  // new partner modal
  readonly form = signal<NewPartnerForm | null>(null);
  readonly formPerms = signal<string[]>([]);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly showPassword = signal(false);
  readonly credential = signal<Credential | null>(null);

  readonly nameError = computed(() => {
    const n = this.form()?.name.trim() ?? '';
    return n.length < 2 ? 'Enter the partner name (at least 2 characters).' : n.length > 100 ? 'Keep the name under 100 characters.' : '';
  });
  readonly ownerNameError = computed(() => (this.form()?.owner_name.trim() ? '' : 'Enter the owner’s full name.'));
  readonly emailError = computed(() => {
    const e = this.form()?.owner_email.trim() ?? '';
    if (!e) return 'Enter the owner’s email: the partner signs in with it.';
    return EMAIL.test(e) ? '' : 'Enter a valid email address.';
  });
  readonly passwordError = computed(() => {
    const p = this.form()?.password ?? '';
    return !p || p.length >= PASSWORD_MIN ? '' : `Use at least ${PASSWORD_MIN} characters, or leave it empty.`;
  });
  readonly modulesError = computed(() => (this.formPerms().length ? '' : 'Enable at least one module.'));

  ngOnInit(): void {
    const params$ = this.route.queryParamMap.pipe(
      map((p) => ({
        q: { status: oneOf(p.get('status'), STATUSES, 'all'), search: p.get('search') || '', page: intParam(p, 'page', 1) } as ListQuery,
        open: p.get('partner'),
      }))
    );
    // the drawer follows ?partner= without reloading the list
    params$.pipe(map((p) => p.open), takeUntilDestroyed(this.destroyRef)).subscribe((id) => this.openId.set(id));
    this.list.connect(
      params$.pipe(
        map((p) => p.q),
        distinctUntilChanged((a, b) => a.status === b.status && a.search === b.search && a.page === b.page)
      ),
      (q) => {
        this.query.set(q);
        return this.svc.listPartners({ status: q.status === 'all' ? null : q.status, search: q.search, page: q.page, limit: PAGE_LIMIT });
      },
      this.destroyRef
    );
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && !this.credential() && this.form() && !this.saving()) this.closeForm();
  }

  statusLabel(s: StatusFilter): string {
    return s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Switched off';
  }

  setStatus(status: StatusFilter): void {
    setQuery(this.router, this.route, { status: status === 'all' ? null : status, page: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  open(p: PartnerListRow): void {
    setQuery(this.router, this.route, { partner: p.id });
  }

  closeDetail(): void {
    setQuery(this.router, this.route, { partner: null });
  }

  /** "6 of 10 modules": a module counts when the partner has at least one of its permissions. */
  moduleCount(p: PartnerListRow): number {
    const perms = p.permissions || [];
    return this.modules().filter((m) => perms.some((x) => x.startsWith(`${m.id}.`))).length;
  }

  // ── new partner ──

  openNew(): void {
    if (this.modules().length) return this.showNew();
    if (this.opening()) return;
    this.opening.set(true);
    this.svc.getPermissionCatalogue().subscribe({
      next: (m) => {
        this.opening.set(false);
        this.fetchedModules.set(m);
        this.showNew();
      },
      error: (err) => {
        this.opening.set(false);
        this.ui.error(err, 'Could not load the module list.');
      },
    });
  }

  private showNew(): void {
    this.formError.set(null);
    this.showErrors.set(false);
    this.showPassword.set(false);
    // every module ticked by default
    this.formPerms.set(this.modules().flatMap((m) => m.actions.map((a) => `${m.id}.${a}`)));
    this.form.set({ name: '', owner_name: '', owner_email: '', owner_phone: '', password: '' });
    setTimeout(() => document.getElementById('npName')?.focus());
  }

  closeForm(): void {
    this.form.set(null);
  }

  patchForm(patch: Partial<NewPartnerForm>): void {
    this.formError.set(null);
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    this.showErrors.set(true);
    if (this.nameError() || this.ownerNameError() || this.emailError() || this.passwordError() || this.modulesError()) return;
    const body: PartnerCreateInput = {
      name: f.name.trim(),
      permissions: this.formPerms(),
      owner: { email: f.owner_email.trim(), full_name: f.owner_name.trim() },
    };
    if (f.owner_phone.trim()) body.owner.phone = f.owner_phone.trim();
    if (f.password) body.owner.password = f.password;
    this.saving.set(true);
    this.formError.set(null);
    this.svc.createPartner(body).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.form.set(null);
        this.credential.set({ name: res.owner.full_name || res.partner.name, email: res.owner.email, password: res.temporaryPassword });
        this.ui.success(`${res.partner.name} created.`);
        this.list.reload();
      },
      error: (err) => {
        this.saving.set(false);
        // 409 duplicate name / email etc.: keep the form open and explain next to it
        this.formError.set(apiErrorMessage(err));
      },
    });
  }

  closeCredential(): void {
    this.credential.set(null);
  }
}
