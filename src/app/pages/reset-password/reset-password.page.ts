import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';
import { apiErrorMessage } from '../../core/services/api.service';

/** Where the "reset your password" email lands: /reset-password?token=... The token is single use and only the server accepts it. */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, IonSpinner, RouterLink],
  styleUrls: ['../auth.shared.scss'],
  template: `
    <div class="auth">
      <section class="brand-panel">
        <div>
          <span class="eyebrow">[PLATFORM]</span>
          <div class="logo"><span class="logo-mark"><img src="assets/logo.png" alt="Stitch&Ship logo" width="44" height="44" /></span><span>Stitch&Ship</span></div>
        </div>
        <div>
          <h1>A fresh start, <em>securely</em>.</h1>
          <p class="lead">Choose a new password for your admin or partner account.</p>
        </div>
        <div class="foot">Admin &amp; partner portal</div>
      </section>

      <section class="form-side">
        <div class="form-card">
          <span class="eyebrow">Reset password</span>
          <h2>Choose a new password</h2>
          @if (!token()) {
            <div class="alert" role="alert">This reset link is not valid. Ask for a new one from the log in page.</div>
            <p class="switch"><a routerLink="/login">← Back to log in</a></p>
          } @else if (done()) {
            <div class="alert ok" role="status">Your password was changed. You can log in now.</div>
            <a class="btn btn-primary submit" routerLink="/login">Log in</a>
          } @else {
            <p class="sub">Use at least 8 characters.</p>
            @if (error()) { <div class="alert" role="alert">{{ error() }}</div> }
            <form (ngSubmit)="submit()" novalidate>
              <div class="field">
                <label for="np">New password</label>
                <input id="np" class="input" [type]="show() ? 'text' : 'password'" name="password" autocomplete="new-password" [(ngModel)]="password" required />
              </div>
              <div class="field">
                <label for="cp">Confirm password</label>
                <input id="cp" class="input" [type]="show() ? 'text' : 'password'" name="confirm" autocomplete="new-password" [(ngModel)]="confirm" required />
              </div>
              <label class="small"><input type="checkbox" [checked]="show()" (change)="show.set(!show())" /> Show passwords</label>
              <button type="submit" class="btn btn-primary submit" [disabled]="loading()">
                @if (loading()) { <ion-spinner name="crescent" /> } Change password
              </button>
            </form>
          }
        </div>
      </section>
    </div>
  `,
})
export class ResetPasswordPage {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  readonly token = signal(this.route.snapshot.queryParamMap.get('token') || '');
  readonly show = signal(false);
  readonly loading = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);
  password = '';
  confirm = '';

  async submit(): Promise<void> {
    this.error.set(null);
    if (this.password.length < 8) return void this.error.set('Password must be at least 8 characters long.');
    if (this.password !== this.confirm) return void this.error.set('The two passwords are not the same.');
    this.loading.set(true);
    try {
      await this.auth.resetPassword(this.token(), this.password);
      this.done.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
