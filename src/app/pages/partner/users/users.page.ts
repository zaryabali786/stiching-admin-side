import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiErrorMessage } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { ActivePartnerService } from '../../../core/services/active-partner.service';
import { PartnerAccess, PartnerAdminService, PartnerUsersApi } from '../../../core/services/partner-admin.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PartnerUsersPanelComponent } from '../../../shared/components/partner-users-panel/partner-users-panel.component';

/** The partner's own users: each person gets their own login and only the access the partner gives them. */
@Component({
  selector: 'app-partner-users',
  standalone: true,
  imports: [EmptyStateComponent, PartnerUsersPanelComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">{{ auth.partner()?.name || 'People' }}</span>
          <h1 [class.urdu]="lang.isUrdu()">{{ lang.t('Users', 'صارفین') }}</h1>
          <p class="subtitle" [class.urdu]="lang.isUrdu()">
            {{ lang.t('Each person gets their own login and only the access you give them. Switch someone off when they leave.', 'ہر شخص کا اپنا لاگ اِن ہوتا ہے اور اسے صرف وہی رسائی ملتی ہے جو آپ دیں۔ کوئی چھوڑ جائے تو اسے بند کر دیں۔') }}
          </p>
        </div>
        @if (access() && canCreate()) {
          <div class="actions">
            <button type="button" class="btn btn-primary" (click)="panel()?.openNew()">
              <span [class.urdu]="lang.isUrdu()">+ {{ lang.t('Add user', 'صارف شامل کریں') }}</span>
            </button>
          </div>
        }
      </header>

      @if (auth.isAdmin() && !active.partnerId()) {
        <div class="card"><app-empty-state title="Choose a partner" message="Pick a partner in the selector at the top of the page to manage its users, or open Admin, Partners, and choose the partner's Users tab." /></div>
      } @else if (error() && !access()) {
        <div class="card"><app-empty-state kind="error" [message]="error()" (retry)="load()" /></div>
      } @else if (loading() && !access()) {
        <div class="card"><span class="skeleton" style="height: 38px; width: 40%"></span><span class="skeleton" style="height: 220px; margin-top: 14px"></span></div>
      } @else if (access(); as a) {
        <app-partner-users-panel
          [api]="api"
          [modules]="a.modules"
          [ceiling]="a.delegable"
          [canCreate]="canCreate()"
          [canUpdate]="canUpdate()"
          [showAddButton]="false" />
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
  /** A partner user manages their own partner; an admin manages the partner chosen in the top-bar selector. */
  get api(): PartnerUsersApi {
    const id = this.active.partnerId();
    return this.auth.isAdmin() && id ? { kind: 'admin', partnerId: id } : { kind: 'partner' };
  }
  readonly panel = viewChild(PartnerUsersPanelComponent);

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
    // an admin gets the partner's modules as the ceiling; a partner user gets what they may hand out
    const source = this.auth.isAdmin() && partnerId
      ? this.svc.getPartner(partnerId).pipe(map((d): PartnerAccess => ({
          role: 'admin', partner_id: d.partner.id, partner: { id: d.partner.id, name: d.partner.name, status: d.partner.status },
          partner_role: null, permissions: [], modules: d.modules, delegable: d.partner.permissions,
        })))
      : this.svc.getAccess();
    source
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (a) => {
          this.access.set(a);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(apiErrorMessage(err, 'Could not load your access.'));
        },
      });
  }
}
