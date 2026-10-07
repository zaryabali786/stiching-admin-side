import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, finalize, map, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiEnvelope, AuthTokens, Profile, Role } from '../models/api.models';

interface Session {
  user: Profile;
  tokens: AuthTokens;
}

const STORAGE_KEY = 'v360_staff_session';

/**
 * Real authentication against the backend (Supabase Auth behind it).
 * The role always comes from the server profile, never from local input.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = environment.apiUrl;

  private session = signal<Session | null>(readSession());
  private refresh$: Observable<AuthTokens> | null = null;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => !!this.session());
  readonly role = computed<Role | null>(() => this.user()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly canUsePartnerPortal = computed(() => this.role() === 'admin' || this.role() === 'partner_staff');
  readonly permissions = computed(() => new Set(this.user()?.permissions ?? []));
  readonly partner = computed(() => this.user()?.partner ?? null);
  readonly isPartnerOwner = computed(() => this.role() === 'partner_staff' && this.user()?.partner_role === 'owner');
  readonly mustChangePassword = computed(() => !!this.session() && !!this.user()?.must_change_password);
  readonly displayName = computed(() => this.user()?.full_name || this.user()?.email?.split('@')[0] || 'User');
  readonly initials = computed(() =>
    this.displayName()
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  );
  readonly roleLabel = computed(() => {
    const r = this.role();
    if (r === 'admin') return 'Admin';
    if (r === 'partner_staff') return this.isPartnerOwner() ? 'Partner' : this.user()?.job_title || 'Partner user';
    return 'Customer';
  });

  /** May the signed-in person use this? e.g. can('production.update'). Admins can do everything. */
  can(permission: string): boolean {
    return this.isAdmin() || this.permissions().has(permission);
  }

  /** At least one of the permissions. */
  canAny(...permissions: string[]): boolean {
    return this.isAdmin() || permissions.some((p) => this.permissions().has(p));
  }

  accessToken(): string | null {
    return this.session()?.tokens.accessToken ?? null;
  }

  refreshToken(): string | null {
    return this.session()?.tokens.refreshToken ?? null;
  }

  /** Called once at app start: refresh the profile so role changes are picked up. */
  async init(): Promise<void> {
    if (!this.session()) return;
    try {
      await this.loadMe();
    } catch {
      // interceptor already logged out on a hard 401; network errors keep the cached session
    }
  }

  async login(email: string, password: string): Promise<Profile> {
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<Session>>(`${this.api}/auth/login`, { email: email.trim(), password })
    );
    this.store(res.data);
    return res.data.user;
  }

  /** Complete a Google authorization-code sign-in (the code was returned to the login page). */
  async googleLogin(code: string, redirectUri: string): Promise<Profile> {
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<Session>>(`${this.api}/auth/google`, { code, redirectUri, portal: 'staff' })
    );
    this.store(res.data);
    return res.data.user;
  }

  async forgotPassword(email: string): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<null>>(`${this.api}/auth/forgot-password`, { email, portal: 'staff' })
    );
    return res.message;
  }

  async loadMe(): Promise<Profile> {
    const res = await firstValueFrom(this.http.get<ApiEnvelope<{ user: Profile }>>(`${this.api}/auth/me`));
    const current = this.session();
    if (current) this.store({ ...current, user: res.data.user });
    return res.data.user;
  }

  async updateProfile(patch: { fullName?: string; phone?: string; country?: string; city?: string; address?: string }): Promise<Profile> {
    const res = await firstValueFrom(this.http.patch<ApiEnvelope<{ user: Profile }>>(`${this.api}/auth/me`, patch));
    const current = this.session();
    if (current) this.store({ ...current, user: res.data.user });
    return res.data.user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<null>>(`${this.api}/auth/change-password`, { currentPassword, newPassword })
    );
    // the temporary-password flag is cleared on the server; pick that up so the app stops asking
    await this.loadMe();
    return res.message;
  }

  /**
   * Exchange the refresh token for new tokens. Concurrent callers share one request.
   */
  refreshTokens(): Observable<AuthTokens> {
    if (!this.refresh$) {
      this.refresh$ = this.http
        .post<ApiEnvelope<Session>>(`${this.api}/auth/refresh`, { refreshToken: this.refreshToken() })
        .pipe(
          tap((res) => this.store(res.data)),
          map((res) => res.data.tokens),
          finalize(() => (this.refresh$ = null)),
          shareReplay(1)
        );
    }
    return this.refresh$;
  }

  /** Clear the session locally (and best-effort on the server), then go to the login page. */
  logout(options: { redirect?: boolean; reason?: string } = {}): void {
    const token = this.accessToken();
    if (token) {
      this.http
        .post(`${this.api}/auth/logout`, {}, { headers: { Authorization: `Bearer ${token}` } })
        .subscribe({ error: () => undefined });
    }
    this.session.set(null);
    localStorage.removeItem(STORAGE_KEY);
    if (options.redirect !== false) {
      this.router.navigate(['/login'], { queryParams: options.reason ? { reason: options.reason } : {} });
    }
  }

  /** The first page of the partner portal this person is allowed to open. */
  private firstPartnerPage(): string {
    const pages: [string, string][] = [
      ['overview.view', '/partner/overview'],
      ['receiving.view', '/partner/receiving'],
      ['production.view', '/partner/production'],
      ['quality.view', '/partner/quality-check'],
      ['warehouse.view', '/partner/warehouse'],
      ['messages.view', '/partner/messages'],
      ['teams.view', '/partner/teams'],
      ['earnings.view', '/partner/earnings'],
      ['catalogue.view', '/partner/articles'],
      ['users.view', '/partner/users'],
    ];
    return pages.find(([permission]) => this.can(permission))?.[1] ?? '/forbidden';
  }

  /** Where this user should land after logging in. */
  homeUrl(): string {
    if (this.mustChangePassword()) return '/change-password';
    const role = this.role();
    if (role === 'admin') return '/admin/overview';
    if (role === 'partner_staff') return this.firstPartnerPage();
    return '/login';
  }

  private store(session: Session): void {
    this.session.set(session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.tokens?.accessToken && parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}
