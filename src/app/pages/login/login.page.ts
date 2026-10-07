import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ApiService, apiErrorMessage } from '../../core/services/api.service';

const GOOGLE_STATE_KEY = 'v360_google_oauth';

interface PublicConfig {
  google?: { enabled?: boolean; clientId?: string | null };
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
  `],
  template: `
    <div class="auth">
      <section class="brand-panel">
        <div>
          <span class="eyebrow">[PLATFORM]</span>
          <div class="logo">V360</div>
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
        <div class="form-card">
          @if (mode() === 'login') {
            <span class="eyebrow">Staff sign in</span>
            <h2>Welcome back</h2>
            <p class="sub">Log in with the account your admin or partner gave you.</p>

            @if (notice()) { <div class="alert info">{{ notice() }}</div> }
            @if (error()) { <div class="alert" role="alert">{{ error() }}</div> }
            @if (googleBusy()) { <div class="alert info" role="status">Signing in with Google…</div> }

            <form (ngSubmit)="login()" novalidate>
              <div class="field">
                <label for="email">Email</label>
                <input id="email" class="input" type="email" name="email" autocomplete="email" [(ngModel)]="email" required placeholder="you@company.com" />
              </div>
              <div class="field">
                <label for="password">Password</label>
                <div class="input-wrap">
                  <input id="password" class="input" [type]="showPassword() ? 'text' : 'password'" name="password" autocomplete="current-password" [(ngModel)]="password" required placeholder="Your password" />
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
  readonly mode = signal<'login' | 'forgot'>('login');
  readonly showPassword = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly resetMessage = signal<string | null>(null);
  readonly googleEnabled = signal(false);
  readonly googleBusy = signal(false);
  private googleClientId: string | null = null;
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
    try {
      const cfg = await firstValueFrom(this.api.get<PublicConfig>('/config'));
      this.googleClientId = cfg?.google?.clientId || null;
      this.googleEnabled.set(!!cfg?.google?.enabled && !!this.googleClientId);
    } catch {
      this.googleEnabled.set(false);
    }
  }

  private googleRedirectUri(): string {
    return `${window.location.origin}/login`;
  }

  startGoogle(): void {
    if (!this.googleClientId) return;
    this.error.set(null);
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
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${q.toString().replace(/\+/g, '%20')}`;
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
    void this.router.navigate([], { replaceUrl: true, queryParams: {} });

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
