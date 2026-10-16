import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivePartnerService } from '../../../core/services/active-partner.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { RolesManagerComponent } from '../../../shared/components/roles-manager/roles-manager.component';

/** Partner > Roles and permissions: named sets of permissions, one tick per button, given to users. */
@Component({
  selector: 'app-partner-roles-page',
  standalone: true,
  imports: [RouterLink, EmptyStateComponent, RolesManagerComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">{{ auth.partner()?.name || 'Roles' }}</span>
          <h1 [class.urdu]="lang.isUrdu()">{{ lang.t('Roles and permissions', 'رولز اور اجازتیں') }}</h1>
          <p class="subtitle" [class.urdu]="lang.isUrdu()">
            {{ lang.t('Create roles and choose exactly which buttons each role can use. Then give the roles to your users.', 'رول بنائیں اور طے کریں کہ ہر رول کون سے بٹن استعمال کر سکتا ہے، پھر صارفین کو دیں۔') }}
          </p>
        </div>
        <div class="actions"><a routerLink="/partner/users" class="btn btn-ghost">{{ lang.t('Users', 'صارفین') }}</a></div>
      </header>
      @if (auth.isAdmin() && !active.partnerId()) {
        <div class="card"><app-empty-state title="Choose a partner" message="Pick a partner in the selector at the top of the page to manage its roles." /></div>
      } @else {
        <app-roles-manager portal="partner" />
      }
    </div>
  `,
})
export class PartnerRolesPage {
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  readonly active = inject(ActivePartnerService);
}
