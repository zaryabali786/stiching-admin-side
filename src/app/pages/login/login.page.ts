import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { ApiService, apiErrorMessage } from '../../core/services/api.service';
import { AppleSignInCancelled, GoogleSignInCancelled, isIosApp, isNativeApp, nativeAppleIdToken, nativeGoogleIdToken } from '../../core/services/native-oauth';

const GOOGLE_STATE_KEY = 'v360_google_oauth';

interface PublicConfig {
  google?: { enabled?: boolean; clientId?: string | null; iosClientId?: string | null };
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IonSpinner],
  styleUrls: ['../auth.shared.scss'],
  styles: [`
    .or {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 18px 0;
      color: var(--c-muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--c-line); }
    .btn-google {
      width: 100%;
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      border-radius: 12px;
      border: 1px solid var(--c-line);
      background: #fff;
      color: #3c4043;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, box-shadow 0.15s;
    }
    .btn-google:hover:not(:disabled) { background: #f8f9fa; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
    .btn-google:disabled { opacity: 0.7; cursor: default; }
    .btn-apple { margin-top: 10px; color: #000; }
  `],
  template: `
    <div class="auth">
      <section class="brand-panel">
        <div>
          <span class="eyebrow">[PLATFORM]</span>
          <div class="logo"><span class="logo-mark"><img src="assets/logo.png" alt="Stitch&Ship logo" width="44" height="44" /></span><span>Stitch&Ship</span></div>
        </div>
        <div>
          <h1>Stitching, run <em>end to end</em>.</h1>
          <p class="lead">One place for orders, receiving, production, invoices and dispatch — for the admin team and our stitching partners.</p>
          <ul class="points">
            <li><span class="dot">✓</span> Live production board with job cards</li>
            <li><span class="dot">✓</span> Invoices with partner payouts &amp; margins</li>
            <li><span class="dot">✓</span> Warehouse routing and courier tracking</li>
          </ul>
        </div>
        <div class="foot">Admin &amp; partner portal</div>
      </section>

      <section class="form-side">
        <div class="form-card" [class.login-mode]="mode() === 'login'">
          @if (mode() === 'login') {
            <div class="m-head">
              <span class="m-logo"><img src="assets/logo.png" alt="Stitch&Ship logo" width="52" height="52" /></span>
              <h1>Welcome to Stitch&amp;Ship</h1>
              <p>Staff sign in</p>
            </div>
            <span class="eyebrow">Staff sign in</span>
            <h2>Welcome back</h2>
            <p class="sub">Log in with the account your admin or partner gave you.</p>

            @if (notice()) { <div class="alert info">{{ notice() }}</div> }
            @if (error()) { <div class="alert" role="alert">{{ error() }}</div> }
            @if (googleBusy()) { <div class="alert info" role="status">Signing in with Google…</div> }

            <form (ngSubmit)="login()" novalidate>
              <div class="field">
                <label for="email">Email</label>
                <input id="email" class="input" type="email" name="email" autocomplete="email" [(ngModel)]="email" required placeholder="Enter your email" />
              </div>
              <div class="field">
                <label for="password">Password</label>
                <div class="input-wrap">
                  <input id="password" class="input" [type]="showPassword() ? 'text' : 'password'" name="password" autocomplete="current-password" [(ngModel)]="password" required placeholder="Enter your password" />
                  <button type="button" class="toggle" (click)="showPassword.set(!showPassword())">{{ showPassword() ? 'Hide' : 'Show' }}</button>
                </div>
              </div>
              <div class="row-between">
                <span></span>
                <button type="button" class="link" (click)="mode.set('forgot'); error.set(null)">Forgot password?</button>
              </div>
              <button type="submit" class="btn btn-primary submit" [disabled]="loading()">
                @if (loading()) { <ion-spinner name="crescent" /> } Log in
              </button>
            </form>

            @if (googleEnabled()) {
              <div class="or"><span>or</span></div>
              <button type="button" class="btn-google" (click)="startGoogle()" [disabled]="loading() || googleBusy()">
                @if (googleBusy()) {
                  <ion-spinner name="crescent" />
                } @else {
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                }
                Continue with Google
              </button>
            }

            @if (isIos) {
              @if (!googleEnabled()) { <div class="or"><span>or</span></div> }
              <button type="button" class="btn-google btn-apple" (click)="startApple()" [disabled]="loading() || googleBusy() || appleBusy()">
                @if (appleBusy()) {
                  <ion-spinner name="crescent" />
                } @else {
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
                  </svg>
                }
                Continue with Apple
              </button>
            }

            <p class="switch">Accounts are created by your admin or partner.</p>
          } @else {
            <span class="eyebrow">Reset password</span>
            <h2>Forgot your password?</h2>
            <p class="sub">Enter your email and we'll send you a reset link.</p>

            @if (resetMessage()) { <div class="alert ok">{{ resetMessage() }}</div> }
            @if (error()) { <div class="alert" role="alert">{{ error() }}</div> }

            <form (ngSubmit)="sendReset()" novalidate>
              <div class="field">
                <label for="reset-email">Email</label>
                <input id="reset-email" class="input" type="email" name="resetEmail" [(ngModel)]="email" required placeholder="you@company.com" />
              </div>
              <button type="submit" class="btn btn-primary submit" [disabled]="loading()">
                @if (loading()) { <ion-spinner name="crescent" /> } Send reset link
              </button>
            </form>
            <p class="switch"><button type="button" class="link" (click)="mode.set('login'); error.set(null); resetMessage.set(null)">← Back to log in</button></p>
          }
          @if (privacyUrl) {
            <p class="switch"><a [href]="privacyUrl" target="_blank" rel="noopener">Privacy policy</a></p>
          }
        </div>
      </section>
    </div>
  `,
})
export class LoginPage implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);

  email = '';
  password = '';
  readonly privacyUrl = environment.privacyPolicyUrl;
  readonly mode = signal<'login' | 'forgot'>('login');
  readonly showPassword = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly resetMessage = signal<string | null>(null);
  readonly googleEnabled = signal(false);
  readonly googleBusy = signal(false);
  readonly appleBusy = signal(false);
  readonly isIos = isIosApp();
  private googleClientId: string | null = null;
  private googleIosClientId: string | null = null;
  private googleHandled = false;

  ngOnInit(): void {
    const reason = this.route.snapshot.queryParamMap.get('reason');
    if (reason === 'expired') this.notice.set('Your session expired. Please log in again.');
    if (reason === 'customer') this.error.set('This is a customer account. Please use the customer app to log in.');

    const params = this.route.snapshot.queryParamMap;
    if (!this.googleHandled && (params.get('error') || (params.get('code') && params.get('state')))) {
      this.googleHandled = true;
      void this.finishGoogle(params.get('code'), params.get('state'), params.get('error'));
    }
    void this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    // a slow or dropped answer must not hide the Google button for good: try a few times
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cfg = await firstValueFrom(this.api.get<PublicConfig>('/config'));
        this.googleClientId = cfg?.google?.clientId || null;
        this.googleIosClientId = cfg?.google?.iosClientId || null;
        this.googleEnabled.set(!!cfg?.google?.enabled && !!this.googleClientId);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
    this.googleEnabled.set(false);
  }

  private googleRedirectUri(): string {
    return `${window.location.origin}/login`;
  }

  startGoogle(): void {
    if (!this.googleClientId || this.googleBusy()) return; // a second tap must not start a second sign-in
    this.error.set(null);
    // phone app: the phone's own Google account picker, no browser
    if (isNativeApp()) {
      void this.nativeGoogle(this.googleClientId, this.googleIosClientId);
      return;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    try {
      sessionStorage.setItem(GOOGLE_STATE_KEY, JSON.stringify({ state }));
    } catch {
      this.error.set('Google sign-in is not available in this browser.');
      return;
    }
    const q = new URLSearchParams({
      client_id: this.googleClientId,
      redirect_uri: this.googleRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${q.toString().replace(/\+/g, '%20')}`;
    window.location.href = url;
  }

  async startApple(): Promise<void> {
    if (this.appleBusy()) return; // a second tap must not start a second sign-in
    this.error.set(null);
    this.notice.set(null);
    this.appleBusy.set(true);
    try {
      const { idToken, name } = await nativeAppleIdToken();
      const user = await this.auth.appleLoginWithIdToken(idToken, name);
      if (user.role === 'customer') {
        this.auth.logout({ redirect: false });
        this.error.set('This is a customer account. Please use the customer app to log in.');
        return;
      }
      await this.router.navigateByUrl(this.auth.homeUrl());
    } catch (err) {
      if (!(err instanceof AppleSignInCancelled)) this.error.set(apiErrorMessage(err, 'Apple sign-in failed. Please try again.'));
    } finally {
      this.appleBusy.set(false);
    }
  }

  private async nativeGoogle(clientId: string, iosClientId: string | null): Promise<void> {
    this.googleBusy.set(true);
    this.notice.set(null);
    try {
      const idToken = await nativeGoogleIdToken(clientId, iosClientId);
      const user = await this.auth.googleLoginWithIdToken(idToken);
      if (user.role === 'customer') {
        this.auth.logout({ redirect: false });
        this.error.set('This is a customer account. Please use the customer app to log in.');
        return;
      }
      await this.router.navigateByUrl(this.auth.homeUrl());
    } catch (err) {
      if (!(err instanceof GoogleSignInCancelled)) this.error.set(apiErrorMessage(err, 'Google sign-in failed. Please try again.'));
    } finally {
      this.googleBusy.set(false);
    }
  }

  private async finishGoogle(code: string | null, state: string | null, oauthError: string | null): Promise<void> {
    let saved: { state?: string } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(GOOGLE_STATE_KEY) || 'null');
      sessionStorage.removeItem(GOOGLE_STATE_KEY);
    } catch {
      saved = null;
    }
    // Remove the single-use code / state from the address bar before doing anything else.
    history.replaceState(history.state, '', location.pathname);

    if (oauthError) {
      this.error.set('Google sign-in was cancelled.');
      return;
    }
    if (!code || !state || !saved?.state || saved.state !== state) {
      this.error.set('Google sign-in could not be verified. Please try again.');
      return;
    }

    this.googleBusy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const user = await this.auth.googleLogin(code, this.googleRedirectUri());
      if (user.role === 'customer') {
        this.auth.logout({ redirect: false });
        this.error.set('This is a customer account. Please use the customer app to log in.');
        return;
      }
      await this.router.navigateByUrl(this.auth.homeUrl());
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Google sign-in failed. Please try again.'));
    } finally {
      this.googleBusy.set(false);
    }
  }

  async login(): Promise<void> {
    if (!this.email.trim() || !this.password) {
      this.error.set('Enter your email and password.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const user = await this.auth.login(this.email, this.password);
      if (user.role === 'customer') {
        this.auth.logout({ redirect: false });
        this.error.set('This is a customer account. Please use the customer app to log in.');
        return;
      }
      await this.router.navigateByUrl(this.auth.homeUrl());
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Login failed. Please check your details.'));
    } finally {
      this.loading.set(false);
    }
  }

  async sendReset(): Promise<void> {
    if (!this.email.trim()) {
      this.error.set('Enter your email address.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.resetMessage.set(await this.auth.forgotPassword(this.email.trim()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
