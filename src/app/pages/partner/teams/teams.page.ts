import { CanDirective } from '../../../shared/can.directive';
import { Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Observable, Subject, catchError, map, of, startWith, switchMap, tap } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { LanguageService } from '../../../core/services/language.service';
import { MasterTeam, PartnerService, TeamMember, TeamsResponse } from '../../../core/services/partner.service';
import { AuthService } from '../../../core/services/auth.service';
import { ActivePartnerService } from '../../../core/services/active-partner.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';

type TeamRole = TeamMember['role'];

/** The roles a team person can have, with the production stage each one receives. */
const ROLE_OPTIONS: { value: TeamRole; label: string }[] = [
  { value: 'master', label: 'Master (cutting)' },
  { value: 'tailor', label: 'Tailor (stitching)' },
  { value: 'qa', label: 'Quality check' },
  { value: 'pressing', label: 'Pressing' },
  { value: 'packing', label: 'Packing' },
];
const ROLE_NAMES: Record<TeamRole, string> = { master: 'Master', tailor: 'Tailor', qa: 'Quality check', pressing: 'Pressing', packing: 'Packing' };
const DEFAULT_CAPACITY: Record<TeamRole, number> = { master: 8, tailor: 4, qa: 10, pressing: 10, packing: 10 };

/** "Add master": a master only. "Add QA / pressing / packing": those three. From a master's card: a tailor only. */
const STAGE_ROLES: TeamRole[] = ['qa', 'pressing', 'packing'];
const ALL_ROLES: TeamRole[] = ['master', 'tailor', 'qa', 'pressing', 'packing'];

interface MemberForm {
  id: string | null;
  name: string;
  role: TeamRole;
  /** The roles this form offers. */
  roles: TeamRole[];
  daily_capacity: number | null;
  master_id: string | null;
  /** The user (login) this team member is: chosen from the users already added. '' = none. */
  user_id: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-partner-teams',
  standalone: true,
  imports: [CanDirective, FormsModule, RouterLink, IonSpinner, EmptyStateComponent],
  templateUrl: './teams.page.html',
  styleUrls: ['./teams.page.scss'],
})
export class PartnerTeamsPage implements OnInit {
  /** Shown inside Settings: the page title is left out (the tab already says it). */
  readonly embedded = input(false);
  readonly lang = inject(LanguageService);
  private partner = inject(PartnerService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
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
  private originalUser = '';
  readonly saving = signal(false);

  /** The users a team member can be linked to (added on the Users page first). */
  readonly users = signal<{ id: string; full_name: string | null; email: string; job_title: string | null }[]>([]);

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

  readonly roleOptions = ROLE_OPTIONS;
  /** The roles the open form offers. */
  readonly formRoleOptions = computed(() => {
    const f = this.form();
    return f ? ROLE_OPTIONS.filter((r) => f.roles.includes(r.value)) : ROLE_OPTIONS;
  });
  roleName(role: TeamRole): string {
    return ROLE_NAMES[role];
  }
  /** Quality check, pressing and packing people (masters and tailors have their own team cards). */
  readonly stageStaff = computed(() => (this.data()?.members ?? []).filter((m) => m.role !== 'master' && m.role !== 'tailor'));

  ngOnInit(): void {
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

  /** `masterId` given = added from a master's card: a tailor under that master. Otherwise the roles of the other stages. */
  openAdd(role: TeamRole, masterId: string | null = null): void {
    this.formTouched.set(false);
    this.loadUsers(null);
    this.form.set({
      id: null,
      name: '',
      role,
      roles: role === 'tailor' ? ['tailor'] : role === 'master' ? ['master'] : STAGE_ROLES,
      daily_capacity: DEFAULT_CAPACITY[role],
      master_id: role === 'tailor' ? masterId ?? this.suggestedId() ?? this.activeMasters()[0]?.id ?? null : null,
      user_id: '',
    });
  }

  /** The users that can still be linked (plus the one this member has now). */
  private loadUsers(memberId: string | null): void {
    this.partner.linkableUsers(memberId).subscribe({ next: (u) => this.users.set(u), error: () => this.users.set([]) });
  }

  /** Choosing a user fills in the name when it is still empty. */
  pickUser(id: string): void {
    const u = this.users().find((x) => x.id === id);
    const f = this.form();
    this.patchForm({ user_id: id, ...(u && f && !f.name.trim() ? { name: u.full_name || '' } : {}) });
  }

  setRole(role: TeamRole): void {
    this.patchForm({ role, daily_capacity: DEFAULT_CAPACITY[role] });
  }

  /** Edit form of a member without a user: pick one. */
  addLoginTo(m: TeamMember): void {
    this.openEdit(m);
  }

  openEdit(m: TeamMember): void {
    this.formTouched.set(false);
    this.loadUsers(m.id);
    this.form.set({ id: m.id, name: m.name, role: m.role, roles: ALL_ROLES, daily_capacity: m.daily_capacity, master_id: m.master_id, user_id: m.login?.id ?? '' });
    this.originalUser = m.login?.id ?? '';
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
    if (!f.id && !f.user_id) return 'Choose the user this person signs in with. Add the user first on the Users page if they are not listed.';
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
    this.saving.set(true);
    let req: Observable<string>;
    if (!f.id) {
      req = this.partner.addMember({ ...body, user_id: f.user_id }).pipe(map((r) => r.message || `${body.name} added.`));
    } else {
      // send the user only when it changed (linking, changing or unlinking)
      req = this.partner.updateMember(f.id, f.user_id !== this.originalUser ? { ...body, user_id: f.user_id || null } : body).pipe(map((m) => `${m.name} updated.`));
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
