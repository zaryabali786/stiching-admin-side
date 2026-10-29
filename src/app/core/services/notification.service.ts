import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, interval, startWith, switchMap, catchError, of } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { AppNotification, NotificationDestination } from '../models/api.models';
import { UiService } from './ui.service';

const POLL_MS = 30_000;
const PAGE_SIZE = 12;

/**
 * Notification centre for the header bell. Polls the unread count while signed in.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private ui = inject(UiService);

  readonly items = signal<AppNotification[]>([]);
  readonly unreadCount = signal(0);
  readonly loading = signal(false);
  readonly hasMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly onlyUnread = signal(false);
  readonly hasUnread = computed(() => this.unreadCount() > 0);

  private page = 1;
  private poll?: Subscription;

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) this.startPolling();
      else this.stopPolling();
    });
  }

  load(reset = true): void {
    if (reset) this.page = 1;
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list<AppNotification, { unreadCount: number }>('/notifications', { page: this.page, limit: PAGE_SIZE, unread: this.onlyUnread() || null })
      .subscribe({
        next: ({ items, meta }) => {
          this.items.update((cur) => (reset ? items : [...cur, ...items]));
          this.hasMore.set(meta.hasMore);
          this.unreadCount.set(meta.unreadCount ?? this.unreadCount());
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Could not load notifications.');
          this.loading.set(false);
        },
      });
  }

  loadMore(): void {
    if (this.loading() || !this.hasMore()) return;
    this.page += 1;
    this.load(false);
  }

  toggleUnreadFilter(): void {
    this.onlyUnread.update((v) => !v);
    this.load(true);
  }

  markRead(n: AppNotification): void {
    if (n.read_at) return;
    this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    this.unreadCount.update((c) => Math.max(0, c - 1));
    this.api.post<{ unreadCount: number }>(`/notifications/${n.id}/read`).subscribe({
      next: (r) => this.unreadCount.set(r.unreadCount),
      error: () => undefined,
    });
  }

  markAllRead(): void {
    const now = new Date().toISOString();
    this.items.update((list) => list.map((x) => ({ ...x, read_at: x.read_at || now })));
    this.unreadCount.set(0);
    this.api.post('/notifications/read-all').subscribe({ error: () => undefined });
  }

  remove(n: AppNotification): void {
    this.items.update((list) => list.filter((x) => x.id !== n.id));
    if (!n.read_at) this.unreadCount.update((c) => Math.max(0, c - 1));
    this.api.delete(`/notifications/${n.id}`).subscribe({ error: () => undefined });
  }

  /** Mark read and open the notification's link. */
  open(n: AppNotification): void {
    this.markRead(n);
    // a configured destination is resolved by the server for THIS person (permissions, the record itself); without one, the link works as before
    if (n.destination) return this.openDestination(n.id);
    if (!n.link) return;
    this.navigateTo(n.link);
  }

  /** Ask the server where this notification leads for the signed-in person, then go there. A refusal is shown as the server words it. */
  openDestination(id: string): void {
    this.api.get<NotificationDestination>(`/notifications/${encodeURIComponent(id)}/destination`).subscribe({
      next: (r) => {
        if (r.kind === 'internal') this.navigateTo(r.link);
        // outside the app: a new window, with no reference to this app and nothing of the login in the address
        else if (r.kind === 'external') window.open(r.url, '_blank', 'noopener,noreferrer');
      },
      error: (err) => this.ui.error(err, 'This link is no longer available.'),
    });
  }

  private navigateTo(link: string): void {
    const [path, query] = link.split('?');
    const queryParams = Object.fromEntries(new URLSearchParams(query || ''));
    void this.router.navigate([path], { queryParams });
  }

  /**
   * A notification arrived over the websocket: put it at the top of the list right away (when it is not there yet),
   * show a short toast, and let the server confirm the unread count.
   */
  pushLive(n: AppNotification | null | undefined): void {
    if (n?.id) {
      this.items.update((list) => (list.some((x) => x.id === n.id) ? list : [n, ...list]));
      if (!this.alerted.has(n.id)) {
        this.alerted.add(n.id);
        this.ui.info(n.title);
      }
    }
    this.refresh();
  }

  /** ids already announced, so the live event and the push of one notification never raise two toasts */
  private alerted = new Set<string>();

  /**
   * A push arrived while the app is open (the phone shows no tray notification then): announce it once. A "Mobile application"
   * notification has no live event at all, so without this nothing would show.
   */
  alertPush(title: string | undefined, data: Record<string, unknown> | undefined): void {
    const id = typeof data?.['notificationId'] === 'string' ? (data['notificationId'] as string) : '';
    if (id) {
      if (this.alerted.has(id)) return;
      this.alerted.add(id);
    }
    if (title) this.ui.info(title);
  }

  /** The socket says something new arrived: refresh the bell now instead of waiting for the poll. */
  refresh(): void {
    if (!this.auth.isAuthenticated()) return;
    this.api.get<{ unreadCount: number }>('/notifications/unread-count').pipe(catchError(() => of(null))).subscribe((r) => this.applyCount(r));
  }

  private startPolling(): void {
    if (this.poll) return;
    this.poll = interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.api.get<{ unreadCount: number }>('/notifications/unread-count').pipe(catchError(() => of(null))))
      )
      .subscribe((r) => this.applyCount(r));
  }

  private applyCount(r: { unreadCount: number } | null): void {
    if (!r) return;
    const grew = r.unreadCount > this.unreadCount();
    this.unreadCount.set(r.unreadCount);
    if (grew && this.items().length) this.load(true);
  }

  private stopPolling(): void {
    this.poll?.unsubscribe();
    this.poll = undefined;
    this.items.set([]);
    this.unreadCount.set(0);
  }
}
