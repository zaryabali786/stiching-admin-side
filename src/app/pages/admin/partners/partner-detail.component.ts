import { Component, DestroyRef, afterNextRender, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonSpinner } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { TeamMember } from '../../../core/services/admin.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { PartnerAdminService, PartnerDetail, PartnerUsersApi, PermissionModule } from '../../../core/services/partner-admin.service';
import { UiService } from '../../../core/services/ui.service';
import { PkrPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PartnerUsersPanelComponent } from '../../../shared/components/partner-users-panel/partner-users-panel.component';
import { PermissionMatrixComponent } from '../../../shared/components/permission-matrix/permission-matrix.component';

type Tab = 'overview' | 'profile' | 'modules' | 'users';

const NAME_MIN = 2;
const NAME_MAX = 100;

/**
 * Drawer with everything about one partner: name, status, default, figures and team,
 * the modules it may use, and its users.
 */
@Component({
  selector: 'app-partner-detail',
  standalone: true,
  imports: [IonSpinner, PkrPipe, EmptyStateComponent, PermissionMatrixComponent, PartnerUsersPanelComponent],
  templateUrl: './partner-detail.component.html',
  styleUrls: ['./partner-detail.component.scss'],
})
export class PartnerDetailComponent {
  private svc = inject(PartnerAdminService);
  private ui = inject(UiService);
  private destroyRef = inject(DestroyRef);

  readonly partnerId = input.required<string>();
  /** Fallback catalogue (the detail response carries its own). */
  readonly modulesFallback = input<PermissionModule[]>([]);
  readonly closed = output<void>();
  /** The partner changed (name, status, default, modules, users): the list should refresh. */
  readonly changed = output<void>();

  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');
  private readonly usersPanel = viewChild(PartnerUsersPanelComponent);

  readonly data = signal<PartnerDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly tab = signal<Tab>('overview');
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'profile', label: 'Customer profile' },
    { id: 'modules', label: 'Modules' },
    { id: 'users', label: 'Users' },
  ];

  readonly renaming = signal(false);
  readonly nameDraft = signal('');
  readonly nameBusy = signal(false);
  readonly statusBusy = signal(false);
  readonly defaultBusy = signal(false);

  // customer-facing profile + receiving address
  readonly profileDraft = signal<Record<string, string | boolean>>({});
  readonly profileBusy = signal(false);
  readonly profileError = signal<string | null>(null);
  readonly profileFields: { key: string; label: string; placeholder?: string; hint?: string; wide?: boolean; type?: string }[] = [
    { key: 'short_code', label: 'Short code', placeholder: 'P3', hint: 'Written on the parcel label next to the customer code.' },
    { key: 'city', label: 'City', placeholder: 'Lahore' },
    { key: 'tagline', label: 'One line about this partner', placeholder: 'Bridal and formal stitching, 7-day turnaround', wide: true },
    { key: 'turnaround_days', label: 'Usual turnaround (days)', placeholder: '10', type: 'number' },
  ];
  readonly addressFields: { key: string; label: string; placeholder?: string; wide?: boolean }[] = [
    { key: 'receiving_name', label: 'Name on the parcel', placeholder: 'Ishaal Stitching' },
    { key: 'receiving_phone', label: 'Phone', placeholder: '+92 300 0000000' },
    { key: 'receiving_address', label: 'Street address', placeholder: 'Shop 4, Main Market…', wide: true },
    { key: 'receiving_city', label: 'City', placeholder: 'Lahore' },
  ];
  readonly profileDirty = computed(() => {
    const p = (this.partner() ?? {}) as unknown as Record<string, unknown>;
    const d = this.profileDraft();
    return Object.keys(d).some((k) => (d[k] ?? '') !== (p[k] ?? ''));
  });
  readonly modulesDraft = signal<string[]>([]);
  readonly modulesBusy = signal(false);
  readonly modulesError = signal<string | null>(null);

  readonly partner = computed(() => this.data()?.partner ?? null);
  readonly catalogue = computed(() => this.data()?.modules ?? this.modulesFallback());
  readonly usersApi = computed<PartnerUsersApi>(() => ({ kind: 'admin', partnerId: this.partnerId() }));
  readonly nameError = computed(() => {
    const n = this.nameDraft().trim();
    if (n.length < NAME_MIN) return `Enter a name of at least ${NAME_MIN} characters.`;
    return n.length > NAME_MAX ? `Keep the name under ${NAME_MAX} characters.` : '';
  });

  /** Modules ticked now but not saved yet, and the ones that would be taken away. */
  readonly modulesDirty = computed(() => {
    const saved = this.partner()?.permissions ?? [];
    const draft = this.modulesDraft();
    return saved.length !== draft.length || saved.some((p) => !draft.includes(p));
  });
  /** What saving would take away from the partner (and so from its users), e.g. "Production", "Teams (update)". */
  readonly removedModules = computed(() => {
    const saved = new Set(this.partner()?.permissions ?? []);
    const draft = new Set(this.modulesDraft());
    const out: string[] = [];
    for (const m of this.catalogue()) {
      const lost = m.actions.filter((a) => saved.has(`${m.id}.${a}`) && !draft.has(`${m.id}.${a}`));
      if (!lost.length) continue;
      const whole = !m.actions.some((a) => draft.has(`${m.id}.${a}`));
      out.push(whole ? m.label : `${m.label} (${lost.join(', ')})`);
    }
    return out;
  });

  private sub: Subscription | null = null;

  constructor() {
    effect(() => {
      const id = this.partnerId();
      untracked(() => {
        this.tab.set('overview');
        this.data.set(null);
        this.load(id);
      });
    });
    this.destroyRef.onDestroy(() => this.sub?.unsubscribe());
    // move focus into the drawer when it opens
    afterNextRender(() => this.drawer()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    // a modal or confirm dialog on top handles Escape itself
    if (this.ui.confirmState() || document.querySelector('.modal-backdrop')) return;
    this.closed.emit();
  }

  load(id = this.partnerId(), keepTab = false): void {
    this.sub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.sub = this.svc
      .getPartner(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.applyData(d);
          this.loading.set(false);
          if (!keepTab) this.tab.set('overview');
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(apiErrorMessage(err, 'Could not load this partner.'));
        },
      });
  }

  private applyData(d: PartnerDetail): void {
    this.data.set(d);
    this.modulesDraft.set([...d.partner.permissions]);
    this.resetProfile();
  }

  setTab(t: Tab): void {
    this.tab.set(t);
  }

  onTabKey(ev: KeyboardEvent, index: number): void {
    const delta = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    ev.preventDefault();
    const next = this.tabs[(index + delta + this.tabs.length) % this.tabs.length];
    this.tab.set(next.id);
    setTimeout(() => document.getElementById('pdTab-' + next.id)?.focus());
  }

  // ── name ──

  startRename(): void {
    this.nameDraft.set(this.partner()?.name ?? '');
    this.renaming.set(true);
    setTimeout(() => document.getElementById('pdName')?.focus());
  }

  saveName(): void {
    const p = this.partner();
    if (!p || this.nameBusy() || this.nameError()) return;
    const name = this.nameDraft().trim();
    if (name === p.name) {
      this.renaming.set(false);
      return;
    }
    this.nameBusy.set(true);
    this.svc.updatePartner(p.id, { name }).subscribe({
      next: (rec) => {
        this.nameBusy.set(false);
        this.renaming.set(false);
        this.patchPartner(rec);
        this.ui.success('Partner renamed.');
        this.changed.emit();
      },
      error: (err) => {
        this.nameBusy.set(false);
        this.ui.error(err);
      },
    });
  }

  // ── status / default ──

  async toggleStatus(): Promise<void> {
    const p = this.partner();
    if (!p || this.statusBusy()) return;
    const next = p.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive') {
      const ok = await this.ui.confirm({
        title: `Switch off ${p.name}?`,
        message: 'Orders can no longer be given to this partner. You can switch it on again at any time.',
        confirmText: 'Switch off',
        danger: true,
      });
      if (!ok) return;
    }
    this.statusBusy.set(true);
    this.svc.updatePartner(p.id, { status: next }).subscribe({
      next: (rec) => {
        this.statusBusy.set(false);
        this.patchPartner(rec);
        this.ui.success(next === 'active' ? `${p.name} is active.` : `${p.name} is switched off.`);
        this.changed.emit();
      },
      error: (err) => {
        this.statusBusy.set(false);
        this.ui.error(err);
      },
    });
  }

  async makeDefault(): Promise<void> {
    const p = this.partner();
    if (!p || this.defaultBusy()) return;
    const ok = await this.ui.confirm({
      title: `Make ${p.name} the default partner?`,
      message: 'New customer orders go to the default partner. This replaces the current default; orders already in progress stay where they are.',
      confirmText: 'Make default',
    });
    if (!ok) return;
    this.defaultBusy.set(true);
    this.svc.updatePartner(p.id, { is_default: true }).subscribe({
      next: (rec) => {
        this.defaultBusy.set(false);
        this.patchPartner(rec);
        this.ui.success(`${p.name} is now the default partner.`);
        this.changed.emit();
      },
      error: (err) => {
        this.defaultBusy.set(false);
        this.ui.error(err);
      },
    });
  }

  // ── modules ──

  resetModules(): void {
    this.modulesDraft.set([...(this.partner()?.permissions ?? [])]);
    this.modulesError.set(null);
  }

  setProfile(key: string, value: string | boolean): void {
    this.profileDraft.update((d) => ({ ...d, [key]: value }));
  }

  resetProfile(): void {
    const p = (this.partner() ?? {}) as unknown as Record<string, unknown>;
    const draft: Record<string, string | boolean> = { is_listed: p['is_listed'] !== false };
    for (const f of [...this.profileFields, ...this.addressFields]) draft[f.key] = (p[f.key] as string | number | null | undefined)?.toString() ?? '';
    this.profileDraft.set(draft);
    this.profileError.set(null);
  }

  saveProfile(): void {
    const p = this.partner();
    if (!p || this.profileBusy() || !this.profileDirty()) return;
    const d = this.profileDraft();
    const body: Record<string, unknown> = { ...d, turnaround_days: d['turnaround_days'] === '' ? null : Number(d['turnaround_days']) };
    this.profileBusy.set(true);
    this.profileError.set(null);
    this.svc.updatePartner(p.id, body as never).subscribe({
      next: (rec) => {
        this.profileBusy.set(false);
        this.patchPartner(rec);
        this.resetProfile();
        this.ui.success('Customer profile saved.');
        this.changed.emit();
      },
      error: (err) => {
        this.profileBusy.set(false);
        this.profileError.set(apiErrorMessage(err));
      },
    });
  }

  async saveModules(): Promise<void> {
    const p = this.partner();
    if (!p || this.modulesBusy() || !this.modulesDirty()) return;
    const draft = this.modulesDraft();
    if (!draft.length) {
      this.modulesError.set('Enable at least one module, or switch the partner off instead.');
      return;
    }
    const removed = this.removedModules();
    if (removed.length) {
      const ok = await this.ui.confirm({
        title: 'Remove modules?',
        message: `${removed.join(', ')} will also be taken away from this partner's users, and it does not come back automatically if you enable it again.`,
        confirmText: 'Save and remove',
        danger: true,
      });
      if (!ok) return;
    }
    this.modulesBusy.set(true);
    this.modulesError.set(null);
    this.svc.updatePartner(p.id, { permissions: draft }).subscribe({
      next: (rec) => {
        this.modulesBusy.set(false);
        this.patchPartner(rec);
        this.modulesDraft.set([...rec.permissions]);
        this.usersPanel()?.reload();
        this.ui.success('Modules saved.');
        this.changed.emit();
      },
      error: (err) => {
        this.modulesBusy.set(false);
        this.modulesError.set(apiErrorMessage(err));
      },
    });
  }

  // ── team overview helpers (same rules as the old partner overview) ──

  loadTone(m: Pick<TeamMember, 'load_status'>): string {
    return m.load_status === 'full' ? 'full' : m.load_status === 'busy' ? 'busy' : 'free';
  }

  pctTone(pct: number): string {
    return pct >= 100 ? 'full' : pct >= 70 ? 'busy' : 'free';
  }

  /** Text for a load tone, so colour is never the only signal. */
  toneLabel(tone: string): string {
    return tone === 'full' ? 'full' : tone === 'busy' ? 'busy' : 'free';
  }

  badgeTone(tone: string): string {
    return tone === 'full' ? 'red' : tone === 'busy' ? 'amber' : 'green';
  }

  clamp(pct: number): number {
    return Math.max(0, Math.min(100, pct || 0));
  }

  private patchPartner(rec: PartnerDetail['partner']): void {
    this.data.update((d) => (d ? { ...d, partner: { ...d.partner, ...rec } } : d));
  }
}
