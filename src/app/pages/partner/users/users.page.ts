import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { ActivePartnerService } from '../../../core/services/active-partner.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { PartnerAccess, PartnerAdminService, PartnerUsersApi } from '../../../core/services/partner-admin.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PartnerUsersPanelComponent } from '../../../shared/components/partner-users-panel/partner-users-panel.component';

/**
 * Partner > Users: the people who sign in to this portal. Their access comes from roles (see Roles and permissions)
 * and a login can be tagged with one team member (a master, tailor...), so that person's scans count for them.
 */
@Component({
  selector: 'app-partner-users-page',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, PartnerUsersPanelComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">{{ auth.partner()?.name || 'Users' }}</span>
          <h1 [class.urdu]="lang.isUrdu()">{{ lang.t('Users', 'صارفین') }}</h1>
          <p class="subtitle" [class.urdu]="lang.isUrdu()">
            {{ lang.t('The people who sign in. Give each person one or more roles, and tag a team member if they work on the floor.', 'لاگ اِن کرنے والے لوگ۔ ہر شخص کو رول دیں اور ضرورت ہو تو ٹیم ممبر سے جوڑیں۔') }}
          </p>
        </div>
        <div class="actions">
          <a routerLink="/partner/roles" class="btn btn-ghost">{{ lang.t('Roles and permissions', 'رولز اور اجازتیں') }}</a>
          @if (access() && canCreate()) {
            <button type="button" class="btn btn-primary" (click)="users()?.openNew()">
              <span [class.urdu]="lang.isUrdu()">+ {{ lang.t('Add user', 'صارف شامل کریں') }}</span>
            </button>
          }
        </div>
      </header>

      @if (auth.isAdmin() && !active.partnerId()) {
        <div class="card"><app-empty-state title="Choose a partner" message="Pick a partner in the selector at the top of the page to manage its users." /></div>
      } @else if (error() && !access()) {
        <div class="card"><app-empty-state kind="error" [message]="error()" (retry)="load()" /></div>
      } @else if (loading() && !access()) {
        <div class="card"><span class="skeleton" style="height: 38px; width: 40%"></span><span class="skeleton" style="height: 220px; margin-top: 14px"></span></div>
      } @else if (access(); as a) {
        <app-partner-users-panel [api]="api" [modules]="a.modules" [ceiling]="a.delegable" [canCreate]="canCreate()" [canUpdate]="canUpdate()" [showAddButton]="false" [hideType]="true" [useRoles]="true" />
      }
    </div>
  `,
})
export class PartnerUsersPage implements OnInit {
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  private svc = inject(PartnerAdminService);
  private destroyRef = inject(DestroyRef);
  readonly active = inject(ActivePartnerService);

  get api(): PartnerUsersApi {
    const id = this.active.partnerId();
    return this.auth.isAdmin() && id ? { kind: 'admin', partnerId: id } : { kind: 'partner' };
  }

  readonly users = viewChild(PartnerUsersPanelComponent);
  readonly access = signal<PartnerAccess | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly canCreate = computed(() => this.auth.can('users.create'));
  readonly canUpdate = computed(() => this.auth.can('users.update'));

  ngOnInit(): void {
    if (!this.auth.isAdmin() || this.active.partnerId()) this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const partnerId = this.active.partnerId();
    const source = this.auth.isAdmin() && partnerId
      ? this.svc.getPartner(partnerId).pipe(map((d): PartnerAccess => ({
          role: 'admin', partner_id: d.partner.id, partner: { id: d.partner.id, name: d.partner.name, status: d.partner.status },
          partner_role: null, permissions: [], modules: d.modules, delegable: d.partner.permissions,
        })))
      : this.svc.getAccess();
    source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (a) => { this.access.set(a); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.error.set(apiErrorMessage(err, 'Could not load your access.')); },
    });
  }
}
