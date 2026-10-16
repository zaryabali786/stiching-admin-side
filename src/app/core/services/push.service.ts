import { Injectable, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

const TOKEN_KEY = 'v360_push_token';

/**
 * Push notifications for admin and partner people (Firebase Cloud Messaging): phone app through Capacitor, browser
 * through the web push service worker. The device token belongs to whoever is signed in on it and is removed on
 * sign-out. Who gets which notification is decided by the API: admins get everything, a partner's people only the
 * notifications of their own partner's orders.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private router = inject(Router);
  private api = environment.apiUrl;

  private token: string | null = readToken();
  private nativeListening = false;
  private starting = false;

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated() && this.auth.canUsePartnerPortal()) void this.start();
    });
  }

  /** Sign-out: this device stops getting the user's pushes. Call it while the login is still in place. */
  unregister(): void {
    const token = this.token;
    if (!token) return;
    this.token = null;
    writeToken(null);
    // the next sign-in on this device moves the token to that user anyway, so a failure here is harmless
    this.http.post(`${this.api}/notifications/devices/remove`, { token }).subscribe({ error: () => undefined });
  }

  private async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      if (Capacitor.isNativePlatform()) await this.startNative();
      else await this.startWeb();
    } catch (err) {
      console.warn('[Push] not started:', err);
    } finally {
      this.starting = false;
    }
  }

  private async startNative(): Promise<void> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (!this.nativeListening) {
      this.nativeListening = true;
      await PushNotifications.addListener('registration', (t) => void this.send(t.value, Capacitor.getPlatform()));
      await PushNotifications.addListener('registrationError', (e) => console.warn('[Push] registration error', e));
      await PushNotifications.addListener('pushNotificationActionPerformed', (a) => this.open(a.notification?.data?.link));
    }
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({ id: 'default', name: 'Updates', importance: 4, visibility: 1 }).catch(() => undefined);
    }
    await PushNotifications.register();
  }

  private async startWeb(): Promise<void> {
    const cfg = environment.firebase;
    if (!cfg?.appId || !cfg.vapidKey || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return;
    const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
    if (!(await isSupported())) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return;
    const { vapidKey, ...options } = cfg;
    const app = getApps()[0] ?? initializeApp(options);
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
    if (token) await this.send(token, 'web');
  }

  private async send(token: string, platform: string): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    // sent every time (not only when it changed): it also moves the token to whoever is signed in on this device now
    await firstValueFrom(this.http.post(`${this.api}/notifications/devices`, { token, platform, app: 'admin' }));
    this.token = token;
    writeToken(token);
  }

  /** Tapping a notification opens its page, but only inside the portal. */
  private open(link: unknown): void {
    if (typeof link === 'string' && /^\/(admin|partner)(\/|$|\?)/.test(link)) void this.router.navigateByUrl(link);
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}
