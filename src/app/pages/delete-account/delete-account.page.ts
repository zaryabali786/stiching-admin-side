import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ApiService, apiErrorMessage } from '../../core/services/api.service';
import { AppleSignInCancelled, GoogleSignInCancelled, isIosApp, isNativeApp, nativeAppleIdToken, nativeGoogleIdToken } from '../../core/services/native-oauth';

interface PublicConfig {
  google?: { enabled?: boolean; clientId?: string | null; iosClientId?: string | null };
}

/** "Delete my account" for every staff account (admin and partner). Reached from the user menu. */
@Component({
  selector: 'app-delete-account',
  standalone: true,
  imports: [FormsModule, RouterLink, IonSpinner],
  styleUrls: ['../auth.shared.scss'],
  styles: [`
    .center { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .box { max-width: 480px; width: 100%; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .alt { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
    .alt .btn { width: 100%; }
    .err { color: var(--c-red); font-size: 14px; margin: 12px 0 0; }
  `],
  template: `
    <div class="center">
      <div class="form-card box">
        <span class="eyebrow">Your account</span>
        <h2>Delete my account</h2>
        <p class="sub">
          This permanently removes your login and personal details (name, email, phone, address, notifications).
          Work records such as orders and notes you handled are kept, shown as "Deleted account". This cannot be undone.
        </p>
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
        <form (submit)="$event.preventDefault(); withPassword()">
          <div class="field">
            <label for="del-confirm">Type DELETE to confirm</label>
            <input id="del-confirm" class="input" autocomplete="off" autocapitalize="characters" [ngModel]="word()" (ngModelChange)="word.set($event)" name="word" />
          </div>
          <div class="field">
            <label for="del-pw">Your password</label>
            <input id="del-pw" class="input" type="password" autocomplete="current-password" [ngModel]="password()" (ngModelChange)="password.set($event)" name="pw" />
          </div>
          <div class="actions">
            <a class="btn" [routerLink]="auth.homeUrl()">Cancel</a>
            <button type="submit" class="btn btn-danger" [disabled]="busy() || !confirmed() || !password()">
              @if (busy()) { <ion-spinner name="crescent" /> } Delete my account
            </button>
          </div>
        </form>
        @if (native) {
          <div class="alt">
            <p class="sub">No password? Confirm with the account you signed in with.</p>
            @if (ios) { <button type="button" class="btn" (click)="withApple()" [disabled]="busy() || !confirmed()">Confirm with Apple</button> }
            <button type="button" class="btn" (click)="withGoogle()" [disabled]="busy() || !confirmed()">Confirm with Google</button>
            @if (!confirmed()) { <p class="sub">Type DELETE above to enable these buttons.</p> }
          </div>
        }
      </div>
    </div>
  `,
})
export class DeleteAccountPage implements OnInit {
  readonly auth = inject(AuthService);
  private api = inject(ApiService);

  readonly native = isNativeApp();
  readonly ios = isIosApp();
  word = signal('');
  password = signal('');
  busy = signal(false);
  error = signal<string | null>(null);
  confirmed = computed(() => this.word().trim().toUpperCase() === 'DELETE');
  private googleClientId: string | null = null;
  private googleIosClientId: string | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const cfg = await firstValueFrom(this.api.get<PublicConfig>('/config'));
      this.googleClientId = cfg?.google?.clientId || null;
      this.googleIosClientId = cfg?.google?.iosClientId || null;
    } catch {
      /* Google confirmation just stays unavailable */
    }
  }

  private async run(proof: { password?: string; idToken?: string; provider?: 'apple' | 'google'; name?: string }): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.deleteAccount(proof);
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Your account could not be deleted. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  async withPassword(): Promise<void> {
    if (!this.confirmed() || !this.password() || this.busy()) return;
    await this.run({ password: this.password() });
  }

  async withApple(): Promise<void> {
    if (!this.confirmed() || this.busy()) return;
    try {
      const { idToken, name } = await nativeAppleIdToken();
      await this.run({ idToken, provider: 'apple', name });
    } catch (err) {
      if (!(err instanceof AppleSignInCancelled)) this.error.set(apiErrorMessage(err, 'Apple confirmation failed.'));
    }
  }

  async withGoogle(): Promise<void> {
    if (!this.confirmed() || this.busy()) return;
    if (!this.googleClientId) {
      this.error.set('Google confirmation is not available right now.');
      return;
    }
    try {
      const idToken = await nativeGoogleIdToken(this.googleClientId, this.googleIosClientId);
      await this.run({ idToken, provider: 'google' });
    } catch (err) {
      if (!(err instanceof GoogleSignInCancelled)) this.error.set(apiErrorMessage(err, 'Google confirmation failed.'));
    }
  }
}
