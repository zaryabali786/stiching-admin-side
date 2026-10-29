import { Injectable, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';

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
  private notifications = inject(NotificationService);
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
      if (Capacitor.isNativePlatform()) {
        // without google-services.json the Firebase plugin crashes the app, so it stays off until the flag is set
        if (environment.nativePush) await this.startNative();
      }
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
      // app open: the phone shows no tray notification, the in-app alert comes from the live socket event;
      // this only refreshes the bell if the socket was down (no alert here, so nothing is ever shown twice)
      await PushNotifications.addListener('pushNotificationReceived', (n) => {
        this.notifications.alertPush(n.title, n.data);
        this.notifications.refresh();
      });
      await PushNotifications.addListener('pushNotificationActionPerformed', (a) => this.open(a.notification?.data));
    }
    let perm = await PushNotifications.checkPermissions();
    // Ask at most once a week: after a "Don't allow" (or a dismissed dialog) the phone keeps answering "prompt", and asking on every
    // app start is what made the permission box come back each time the app was opened.
    if ((perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') && askedLongAgo()) {
      markAsked();
      perm = await PushNotifications.requestPermissions();
    }
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
    // Firebase rotated this device's token: the old one is dropped so it is not left behind on this account
    const previous = this.token;
    this.token = token;
    writeToken(token);
    if (previous && previous !== token) {
      this.http.post(`${this.api}/notifications/devices/remove`, { token: previous }).subscribe({ error: () => undefined });
    }
  }

  /**
   * Tapping a notification opens its page, but only inside the portal, and only when it was meant for the person who is
   * signed in now (a device that switched accounts ignores the previous account's notifications). The route guards and
   * the API still decide what that person may see.
   */
  private open(data: Record<string, unknown> | undefined): void {
    const link = data?.['link'];
    const forUser = data?.['userId'];
    if (typeof forUser === 'string' && forUser && forUser !== this.auth.user()?.id) return;
    // a notification with a configured destination: the server decides where it leads for this person (and whether they may open it)
    const id = data?.['notificationId'];
    if (data?.['dest'] === '1' && typeof id === 'string' && id && this.auth.isAuthenticated()) return this.notifications.openDestination(id);
    if (typeof link === 'string' && /^\/(admin|partner)(\/|$|\?)/.test(link)) void this.router.navigateByUrl(link);
  }
}

const ASKED_KEY = 'v360_push_token_asked_at';
const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** The notification permission box was not shown in the last week (or never). */
function askedLongAgo(): boolean {
  try {
    const at = Number(localStorage.getItem(ASKED_KEY));
    return !at || Date.now() - at > ASK_AGAIN_AFTER_MS;
  } catch {
    return true;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
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
