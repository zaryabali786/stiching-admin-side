import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';
import { apiErrorMessage } from '../../core/services/api.service';

/**
 * Shown right after sign-in when the login was created with a temporary password (by an admin or a partner).
 * The server refuses every staff page until the person has chosen their own password.
 */
@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [FormsModule, IonSpinner],
  styleUrls: ['../auth.shared.scss'],
  styles: [`
    .center { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .box { width: 100%; max-width: 460px; }
    .actions { display: flex; gap: 10px; margin-top: 18px; }
  `],
  template: `
    <div class="center">
      <div class="form-card box">
        <span class="eyebrow">First sign-in</span>
        <h2>Choose your own password</h2>
        <p class="sub">Hello {{ auth.displayName() }}. Your account was set up with a temporary password. Choose a password only you know to continue.</p>

        @if (error()) { <div class="alert" role="alert">{{ error() }}</div> }

        <form (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="current">Temporary password</label>
            <input id="current" class="input" type="password" name="current" autocomplete="current-password" [(ngModel)]="current" required />
          </div>
          <div class="field">
            <label for="next">New password</label>
            <div class="input-wrap">
              <input id="next" class="input" [type]="show() ? 'text' : 'password'" name="next" autocomplete="new-password"
                [ngModel]="next()" (ngModelChange)="next.set($event)" required placeholder="At least 8 characters" />
              <button type="button" class="toggle" (click)="show.set(!show())">{{ show() ? 'Hide' : 'Show' }}</button>
            </div>
            <span class="hint">{{ hint() }}</span>
          </div>
          <div class="field">
            <label for="confirm">Confirm new password</label>
            <input id="confirm" class="input" [type]="show() ? 'text' : 'password'" name="confirm" autocomplete="new-password" [(ngModel)]="confirm" required />
          </div>
          <div class="actions">
            <button type="submit" class="btn btn-primary" [disabled]="loading()">
              @if (loading()) { <ion-spinner name="crescent" /> } Save and continue
            </button>
            <button type="button" class="btn" (click)="auth.logout()">Log out</button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class ChangePasswordPage {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  current = '';
  confirm = '';
  readonly next = signal('');
  readonly show = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly hint = computed(() => (this.next().length >= 8 ? 'Good. Use something you do not use anywhere else.' : 'Use 8 or more characters.'));

  async submit(): Promise<void> {
    this.error.set(null);
    if (!this.current) return this.error.set('Enter the temporary password you were given.');
    if (this.next().length < 8) return this.error.set('The new password must be at least 8 characters.');
    if (this.next() === this.current) return this.error.set('Choose a password different from the temporary one.');
    if (this.next() !== this.confirm) return this.error.set('The two new passwords do not match.');
    this.loading.set(true);
    try {
      await this.auth.changePassword(this.current, this.next());
      await this.router.navigateByUrl(this.auth.homeUrl());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
