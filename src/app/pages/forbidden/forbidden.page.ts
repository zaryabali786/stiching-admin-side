import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/** Shown when someone opens a page their account is not allowed to use (typed URL, old bookmark, changed access). */
@Component({
  selector: 'app-forbidden',
  standalone: true,
  imports: [RouterLink],
  styleUrls: ['../auth.shared.scss'],
  styles: [`
    .center { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .box { max-width: 460px; text-align: center; }
    .icon { width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 18px; background: var(--c-gold-soft); color: var(--c-gold-dark); display: flex; align-items: center; justify-content: center; font-size: 26px; }
    .actions { display: flex; gap: 10px; justify-content: center; margin-top: 22px; flex-wrap: wrap; }
  `],
  template: `
    <div class="center">
      <div class="form-card box">
        <div class="icon" aria-hidden="true">🔒</div>
        <span class="eyebrow">No access</span>
        <h2>You cannot open this page</h2>
        <p class="sub">
          Your account does not include this area. If you need it, ask {{ auth.isPartnerOwner() ? 'the admin' : 'your partner owner or the admin' }} to give you access.
        </p>
        <div class="actions">
          @if (home() !== '/forbidden') { <a class="btn btn-primary" [routerLink]="home()">Go to my page</a> }
          <button type="button" class="btn" (click)="auth.logout()">Log out</button>
        </div>
      </div>
    </div>
  `,
})
export class ForbiddenPage {
  readonly auth = inject(AuthService);
  home = () => this.auth.homeUrl();
}
