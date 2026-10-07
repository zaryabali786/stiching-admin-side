import { CanDirective } from '../../../shared/can.directive';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { IonSpinner } from '@ionic/angular';
import { Observable, Subject, catchError, map, of, startWith, switchMap, tap } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { LanguageService } from '../../../core/services/language.service';
import { MasterTeam, PartnerService, TeamLoginCredential, TeamMember, TeamsResponse } from '../../../core/services/partner.service';
import { AuthService } from '../../../core/services/auth.service';
import { ActivePartnerService } from '../../../core/services/active-partner.service';
import { PartnerAccess, PartnerAdminService } from '../../../core/services/partner-admin.service';
import { PermissionMatrixComponent } from '../../../shared/components/permission-matrix/permission-matrix.component';
import { TempPasswordDialogComponent } from '../../../shared/components/partner-users-panel/temp-password-dialog.component';
import { STAFF_PRESETS } from '../../../shared/components/partner-users-panel/partner-users-panel.component';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';

interface MemberForm {
  id: string | null;
  name: string;
  role: 'master' | 'tailor';
  daily_capacity: number | null;
  master_id: string | null;
  /** Give this person their own login (email + password + permissions). */
  withLogin: boolean;
  email: string;
  password: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-partner-teams',
  standalone: true,
  imports: [CanDirective, FormsModule, IonSpinner, EmptyStateComponent, PermissionMatrixComponent, TempPasswordDialogComponent],
  templateUrl: './teams.page.html',
  styleUrls: ['./teams.page.scss'],
})
export class PartnerTeamsPage implements OnInit {
  readonly lang = inject(LanguageService);
  private partner = inject(PartnerService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private partnerAdmin = inject(PartnerAdminService);
  private auth = inject(AuthService);
  private activePartner = inject(ActivePartnerService);
  private destroyRef = inject(DestroyRef);

  readonly data = signal<TeamsResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly showInactive = signal(false);
  private reload$ = new Subject<void>();

  readonly busy = signal<Set<string>>(new Set());
  readonly form = signal<MemberForm | null>(null);
  readonly formTouched = signal(false);
  readonly saving = signal(false);

  /** Login for the member being added / edited: permissions ticked, the module catalogue, and what the caller may hand out. */
  readonly formPerms = signal<string[]>([]);
  readonly access = signal<PartnerAccess | null>(null);
  readonly canCreateLogin = computed(() => this.auth.can('users.create'));
  readonly credential = signal<{ name: string; email: string; password: string } | null>(null);
  readonly showPassword = signal(false);

  readonly masters = computed(() => this.data()?.masters ?? []);
  readonly activeMasters = computed(() => this.masters().filter((m) => m.is_active));
  readonly unassigned = computed(() => this.data()?.unassignedTailors ?? []);

  /** Least-loaded active master (same rule the backend uses to auto-assign). */
  readonly suggestedId = computed(() => {
    const list = [...this.activeMasters()].sort(
      (a, b) => a.assigned / Math.max(1, a.daily_capacity) - b.assigned / Math.max(1, b.daily_capacity) || a.name.localeCompare(b.name)
    );
    return list.length > 1 ? list[0].id : null;
  });

  readonly stats = computed(() => {
    const d = this.data();
    if (!d) return null;
    const active = d.members.filter((m) => m.is_active);
    const masters = active.filter((m) => m.role === 'master');
    const tailors = active.filter((m) => m.role === 'tailor');
    const assigned = active.reduce((a, m) => a + m.assigned, 0);
    const capacity = active.reduce((a, m) => a + (m.daily_capacity || 0), 0);
    return {
      masters: masters.length,
      tailors: tailors.length,
      loadPct: capacity ? Math.round((assigned / capacity) * 100) : 0,
      cutting: masters.reduce((a, m) => a + m.assigned, 0),
      stitching: tailors.reduce((a, m) => a + m.assigned, 0),
      tailorCapacity: tailors.reduce((a, m) => a + (m.daily_capacity || 0), 0),
      free: tailors.filter((t) => t.load_status === 'free').map((t) => t.name),
    };
  });

  ngOnInit(): void {
    this.loadAccess();
    this.reload$
      .pipe(
        startWith(undefined),
        tap(() => this.error.set(null)),
        switchMap(() =>
          this.partner.teams(this.showInactive()).pipe(
            map((d) => ({ d, err: null as string | null })),
            catchError((e) => of({ d: null, err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ d, err }) => {
        this.loading.set(false);
        if (err || !d) this.error.set(err);
        else this.data.set(d);
      });
  }

  /** What may be handed out to a new login: the caller's own modules, or (admin with a partner selected) the partner's. */
  private loadAccess(): void {
    if (!this.canCreateLogin()) return;
    const partnerId = this.activePartner.partnerId();
    if (this.auth.isAdmin()) {
      if (!partnerId) return;
      this.partnerAdmin.getPartner(partnerId).subscribe({
        next: (d) => this.access.set({
          role: 'admin', partner_id: d.partner.id, partner: { id: d.partner.id, name: d.partner.name, status: d.partner.status },
          partner_role: null, permissions: [], modules: d.modules, delegable: d.partner.permissions,
        }),
        error: () => undefined,
      });
      return;
    }
    this.partnerAdmin.getAccess().subscribe({ next: (a) => this.access.set(a), error: () => undefined });
  }

  retry(): void {
    this.loading.set(true);
    this.reload$.next();
  }

  toggleInactive(on: boolean): void {
    this.showInactive.set(on);
    this.reload$.next();
  }

  // ───────────── Display helpers ─────────────

  initial(name: string): string {
    return (name || '?').trim().replace(/^master\s+/i, '').charAt(0).toUpperCase() || '?';
  }

  /** DESIGN.md load colours: green < 70 %, amber 70–89 %, red ≥ 90 % (always shown with text too). */
  loadTone(pct: number): string {
    return pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green';
  }

  loadWord(pct: number): string {
    return pct >= 90 ? this.lang.t('nearly full', 'تقریباً بھرا') : pct >= 70 ? this.lang.t('busy', 'مصروف') : this.lang.t('has room', 'گنجائش ہے');
  }

  statusLabel(m: TeamMember): string {
    if (!m.is_active) return this.lang.t('Removed', 'ہٹا دیا');
    return m.load_status === 'full' ? this.lang.t('Full', 'مکمل') : m.load_status === 'busy' ? this.lang.t('Busy', 'مصروف') : this.lang.t('Free', 'فارغ');
  }

  statusTone(m: TeamMember): string {
    if (!m.is_active) return '';
    // Same colour as the person's load bar, so badge and bar never disagree.
    return m.load_status === 'full' ? 'red' : this.loadTone(m.load_pct);
  }

  activeTailors(team: MasterTeam): number {
    return team.tailors.filter((t) => t.is_active).length;
  }

  isBusy(key: string): boolean {
    return this.busy().has(key);
  }

  private setBusy(key: string, on: boolean): void {
    this.busy.update((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }

  // ───────────── Add / edit ─────────────

  openAdd(role: 'master' | 'tailor', masterId: string | null = null): void {
    this.formTouched.set(false);
    this.form.set({
      id: null,
      name: '',
      role,
      daily_capacity: role === 'master' ? 8 : 4,
      master_id: role === 'tailor' ? masterId ?? this.suggestedId() ?? this.activeMasters()[0]?.id ?? null : null,
      withLogin: this.canCreateLogin() && !!this.access(),
      email: '',
      password: '',
    });
    this.presetFor(role);
  }

  /** Master / tailor start from their usual modules (only those the partner has); the partner can tick or untick any. */
  private presetFor(role: 'master' | 'tailor'): void {
    const have = new Set(this.access()?.delegable ?? []);
    this.formPerms.set(STAFF_PRESETS[role].filter((p) => have.has(p)));
  }

  setRole(role: 'master' | 'tailor'): void {
    this.patchForm({ role });
    if (!this.form()?.id) this.presetFor(role);
  }

  /** Edit form of a member without a login: offer to create one. */
  addLoginTo(m: TeamMember): void {
    this.openEdit(m);
    this.patchForm({ withLogin: true });
    this.presetFor(m.role);
  }

  openEdit(m: TeamMember): void {
    this.formTouched.set(false);
    this.form.set({ id: m.id, name: m.name, role: m.role, daily_capacity: m.daily_capacity, master_id: m.master_id, withLogin: false, email: '', password: '' });
    this.formPerms.set([]);
  }

  patchForm(patch: Partial<MemberForm>): void {
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  closeForm(): void {
    if (!this.saving()) this.form.set(null);
  }

  formError(f: MemberForm): string | null {
    if (!f.name.trim()) return 'Enter a name.';
    const cap = Number(f.daily_capacity);
    if (!(cap >= 1 && cap <= 100)) return 'Daily capacity must be between 1 and 100 articles.';
    if (f.role === 'tailor' && !f.master_id) return 'Choose which master this tailor works under.';
    if (f.withLogin) {
      if (!EMAIL.test(f.email.trim())) return 'Enter a valid email: they sign in with it.';
      if (f.password && f.password.length < 8) return 'The password needs at least 8 characters, or leave it empty to generate one.';
    }
    return null;
  }

  save(): void {
    const f = this.form();
    if (!f) return;
    this.formTouched.set(true);
    const err = this.formError(f);
    if (err) return;
    const body = {
      name: f.name.trim(),
      role: f.role,
      daily_capacity: Math.round(Number(f.daily_capacity)),
      master_id: f.role === 'tailor' ? f.master_id : null,
    };
    const login = f.withLogin ? { email: f.email.trim(), password: f.password || undefined, permissions: this.formPerms() } : undefined;
    this.saving.set(true);
    const shown = (c: TeamLoginCredential | undefined) => {
      if (c) this.credential.set({ name: body.name, email: c.email, password: c.temporaryPassword });
    };
    let req: Observable<string>;
    if (!f.id) {
      req = this.partner.addMember({ ...body, login }).pipe(map((r) => { shown(r.data.credential); return r.message || `${body.name} added.`; }));
    } else if (login) {
      // save the changes, then create the login
      const id = f.id;
      req = this.partner.updateMember(id, body).pipe(
        switchMap(() => this.partner.addMemberLogin(id, login)),
        map((r) => { shown(r.data.credential); return r.message; })
      );
    } else {
      req = this.partner.updateMember(f.id, body).pipe(map((m) => `${m.name} updated.`));
    }
    req.subscribe({
      next: (msg) => {
        this.saving.set(false);
        this.form.set(null);
        this.ui.success(msg);
        this.reload$.next();
        this.badges.refresh();
      },
      error: (e) => {
        this.saving.set(false);
        this.ui.error(e);
      },
    });
  }

  // ───────────── Remove / restore ─────────────

  async remove(m: TeamMember): Promise<void> {
    const tailors = m.role === 'master' ? this.masters().find((x) => x.id === m.id)?.tailors.filter((t) => t.is_active).length ?? 0 : 0;
    const ok = await this.ui.confirm({
      title: `Remove ${m.name}?`,
      message:
        (m.role === 'master' && tailors
          ? `${tailors} tailor${tailors === 1 ? '' : 's'} in this team will need a new master. `
          : '') + 'They will no longer get new work. Their history is kept.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const key = `m:${m.id}`;
    this.setBusy(key, true);
    this.partner.removeMember(m.id).subscribe({
      next: () => {
        this.setBusy(key, false);
        this.ui.success(`${m.name} removed from active teams.`);
        this.reload$.next();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  restore(m: TeamMember): void {
    const key = `m:${m.id}`;
    this.setBusy(key, true);
    this.partner.updateMember(m.id, { is_active: true }).subscribe({
      next: () => {
        this.setBusy(key, false);
        this.ui.success(`${m.name} is active again.`);
        this.reload$.next();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }
}
