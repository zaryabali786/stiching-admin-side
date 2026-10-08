import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { NotificationService } from '../../core/services/notification.service';
import { AppNotification } from '../../core/models/api.models';
import { TimeAgoPipe } from '../pipes';

const TYPE_ICON: Record<string, string> = {
  order: '◆',
  update: '●',
  alert: '!',
  approval: '✓',
  invoice: '₨',
  logistics: '➜',
};

/** Header bell with unread badge and a dropdown notification panel. */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [TimeAgoPipe],
  template: `
    <button type="button" class="bell" (click)="toggle()" [class.open]="open()" aria-label="Notifications" [attr.aria-expanded]="open()">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>
      @if (notifications.unreadCount() > 0) {
        <span class="count">{{ notifications.unreadCount() > 99 ? '99+' : notifications.unreadCount() }}</span>
      }
    </button>

    @if (open()) {
      <div class="panel" role="dialog" aria-label="Notifications">
        <div class="panel-head">
          <div>
            <h4>Notifications</h4>
            <span class="sub">{{ notifications.unreadCount() }} unread</span>
          </div>
          <div class="head-actions">
            <button type="button" class="link" [class.on]="notifications.onlyUnread()" (click)="notifications.toggleUnreadFilter()">
              {{ notifications.onlyUnread() ? 'Show all' : 'Unread only' }}
            </button>
            @if (notifications.unreadCount() > 0) {
              <button type="button" class="link" (click)="notifications.markAllRead()">Mark all read</button>
            }
          </div>
        </div>

        <div class="list" (scroll)="onScroll($event)">
          @if (notifications.error() && !notifications.items().length) {
            <div class="state">{{ notifications.error() }} <button type="button" class="link" (click)="notifications.load()">Retry</button></div>
          } @else if (!notifications.loading() && !notifications.items().length) {
            <div class="state">
              <div class="state-icon">✓</div>
              You're all caught up.
            </div>
          }

          @for (n of notifications.items(); track n.id) {
            <div class="item" [class.unread]="!n.read_at" (click)="openItem(n)" role="button" tabindex="0" (keydown.enter)="openItem(n)">
              <span class="type" [class]="'type ' + n.type">{{ icon(n.type) }}</span>
              <div class="body">
                <div class="title">{{ n.title }}</div>
                @if (n.body) { <div class="text">{{ n.body }}</div> }
                <div class="time">{{ n.created_at | timeAgo }}</div>
              </div>
              <div class="item-actions">
                @if (!n.read_at) {
                  <button type="button" class="mini" title="Mark as read" (click)="$event.stopPropagation(); notifications.markRead(n)">●</button>
                }
                <button type="button" class="mini" title="Remove" (click)="$event.stopPropagation(); notifications.remove(n)">×</button>
              </div>
            </div>
          }

          @if (notifications.loading()) {
            @for (i of [1, 2, 3]; track i) {
              <div class="item"><span class="skeleton" style="width:30px;height:30px;border-radius:50%"></span><div class="body"><span class="skeleton" style="width:70%"></span><span class="skeleton" style="width:90%;margin-top:6px"></span></div></div>
            }
          } @else if (notifications.hasMore()) {
            <button type="button" class="more" (click)="notifications.loadMore()">Load more</button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; }
    .bell { position: relative; width: 38px; height: 38px; border-radius: 10px; border: 1px solid transparent; background: transparent; color: var(--c-ink-2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background .15s, color .15s; }
    .bell:hover, .bell.open { background: var(--c-bg); color: var(--c-ink); }
    .bell:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    .count { position: absolute; top: 2px; right: 1px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--c-red); color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid var(--c-surface); font-variant-numeric: tabular-nums; }
    .panel { position: absolute; top: calc(100% + 10px); right: 0; width: min(400px, calc(100vw - 24px)); background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 16px; box-shadow: var(--shadow-lg); z-index: 900; overflow: hidden; animation: popIn .18s ease both; }
    /* phones: the panel spans the screen under the top bar instead of hanging off the bell */
    @media (max-width: 700px) { .panel { position: fixed; top: calc(var(--topbar-h, 60px) + 8px); left: 12px; right: 12px; width: auto; max-height: calc(100dvh - var(--topbar-h, 60px) - 24px); display: flex; flex-direction: column; } .panel .list { max-height: none; flex: 1; overflow-y: auto; min-height: 0; } }
    .panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid var(--c-line-soft); }
    h4 { font-family: var(--font-sans); font-size: 15px; font-weight: 600; }
    .sub { font-size: 11.5px; color: var(--c-muted); }
    .head-actions { display: flex; gap: 10px; }
    .link { background: none; border: none; padding: 0; font: inherit; font-size: 12px; font-weight: 600; color: var(--c-green); cursor: pointer; }
    .link.on { color: var(--c-gold-dark); }
    .list { max-height: min(460px, 70vh); overflow-y: auto; }
    .item { display: flex; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--c-line-soft); cursor: pointer; transition: background .12s; position: relative; }
    .item:hover { background: var(--c-bg-soft); }
    .item.unread { background: #FBF8F1; }
    .item.unread::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c-gold); }
    .type { width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; background: var(--c-bg); color: var(--c-ink-2); }
    .type.alert { background: var(--c-red-soft); color: var(--c-red); }
    .type.invoice { background: var(--c-gold-soft); color: var(--c-gold-dark); }
    .type.approval, .type.order { background: var(--c-green-soft); color: var(--c-green); }
    .type.logistics { background: var(--c-blue-soft); color: var(--c-blue); }
    .body { flex: 1; min-width: 0; }
    .title { font-size: 13px; font-weight: 600; color: var(--c-ink); }
    .text { font-size: 12px; color: var(--c-muted); margin-top: 2px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .time { font-size: 11px; color: var(--c-faint); margin-top: 4px; }
    .item-actions { display: flex; flex-direction: column; gap: 2px; opacity: 0; transition: opacity .12s; }
    .item:hover .item-actions { opacity: 1; }
    .mini { background: none; border: none; color: var(--c-faint); cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 4px; }
    .mini:hover { color: var(--c-ink); background: var(--c-line-soft); }
    .state { padding: 34px 16px; text-align: center; color: var(--c-muted); font-size: 13px; }
    .state-icon { width: 38px; height: 38px; margin: 0 auto 8px; border-radius: 50%; background: var(--c-green-soft); color: var(--c-green); display: flex; align-items: center; justify-content: center; }
    .more { width: 100%; padding: 12px; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--c-green); cursor: pointer; }
    .more:hover { background: var(--c-bg-soft); }
  `],
})
export class NotificationBellComponent {
  readonly notifications = inject(NotificationService);
  readonly open = signal(false);
  private host = inject(ElementRef<HTMLElement>);

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) this.notifications.load(true);
  }

  openItem(n: AppNotification): void {
    this.open.set(false);
    this.notifications.open(n);
  }

  icon(type: string): string {
    return TYPE_ICON[type] || '●';
  }

  onScroll(e: Event): void {
    const el = e.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) this.notifications.loadMore();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.open.set(false);
  }
}
