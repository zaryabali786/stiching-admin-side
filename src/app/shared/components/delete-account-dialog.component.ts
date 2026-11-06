import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ApiService, apiErrorMessage } from '../../core/services/api.service';
import { AppleSignInCancelled, GoogleSignInCancelled, isIosApp, isNativeApp, nativeAppleIdToken, nativeGoogleIdToken } from '../../core/services/native-oauth';

interface PublicConfig {
  google?: { enabled?: boolean; clientId?: string | null; iosClientId?: string | null };
}

/** The phrase the person types to prove they mean it. */
export const DELETE_PHRASE = 'delete my account';

/** Popup for "Delete my account" (admin and partner staff): type the phrase, prove who you are, then the account is removed. */
@Component({
  selector: 'app-delete-account-dialog',
  standalone: true,
  imports: [FormsModule, IonSpinner],
  styles: [`
    .warn { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: var(--c-red-soft, #fdecea); color: var(--c-red, #c0392b); font-size: 13.5px; line-height: 1.45; }
    .lead { margin: 0 0 14px; font-size: 14px; line-height: 1.5; }
    .err { color: var(--c-red, #c0392b); font-size: 13.5px; margin: 10px 0 0; }
    .alt { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .alt p { margin: 0; font-size: 13px; color: var(--c-muted); }
    .alt .btn { width: 100%; }
    code { font-weight: 700; }
  `],
  template: `
    <div class="modal-backdrop" (click)="!busy() && closed.emit()">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dad-title" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Delete account</span>
            <h3 id="dad-title">Delete my account?</h3>
          </div>
        </div>
        <form class="modal-body" (submit)="$event.preventDefault(); withPassword()">
          <p class="warn">This cannot be undone. Your login and personal details (name, email, phone, address, notifications) are removed permanently.</p>
          <p class="lead">Work records you handled, such as orders and notes, are kept and shown as "Deleted account".</p>
          <div class="field">
            <label for="dad-phrase">To confirm, type <code>{{ phrase }}</code></label>
            <input id="dad-phrase" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" [placeholder]="phrase" [ngModel]="typed()" (ngModelChange)="typed.set($event)" name="typed" />
          </div>
          <div class="field">
            <label for="dad-pw">Your password</label>
            <input id="dad-pw" class="input" type="password" autocomplete="current-password" [ngModel]="password()" (ngModelChange)="password.set($event)" name="pw" />
          </div>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          @if (native) {
            <div class="alt">
              <p>No password? Confirm with the account you signed in with.</p>
              @if (ios) { <button type="button" class="btn" (click)="withApple()" [disabled]="busy() || !confirmed()">Confirm with Apple</button> }
              <button type="button" class="btn" (click)="withGoogle()" [disabled]="busy() || !confirmed()">Confirm with Google</button>
            </div>
          }
        </form>
        <div class="modal-foot">
          <button type="button" class="btn" (click)="closed.emit()" [disabled]="busy()">Cancel</button>
          <button type="button" class="btn btn-danger" (click)="withPassword()" [disabled]="busy() || !confirmed() || !password()">
            @if (busy()) { <ion-spinner name="crescent" /> } Delete my account
          </button>
        </div>
      </div>
    </div>
  `,
})
export class DeleteAccountDialogComponent implements OnInit {
  readonly closed = output<void>();
  private auth = inject(AuthService);
  private api = inject(ApiService);

  readonly phrase = DELETE_PHRASE;
  readonly native = isNativeApp();
  readonly ios = isIosApp();
  typed = signal('');
  password = signal('');
  busy = signal(false);
  error = signal<string | null>(null);
  confirmed = computed(() => this.typed().trim().toLowerCase() === DELETE_PHRASE);
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
    if (this.busy()) return;
    if (!this.confirmed()) {
      this.error.set(`Type "${DELETE_PHRASE}" to confirm.`);
      return;
    }
    if (!this.password()) {
      this.error.set('Enter your password, or confirm with Apple or Google.');
      return;
    }
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
