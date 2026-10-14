import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, OnInit, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { ApiService } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { UiService } from '../../../core/services/ui.service';
import { TimeAgoPipe } from '../../../shared/pipes';

interface Conversation {
  customer_id: string;
  customer_name: string | null;
  email: string | null;
  customer_code: string | null;
  unread: number;
  last_body: string;
  last_role: 'customer' | 'admin';
  last_at: string;
}

interface SupportMsg {
  id: string;
  customer_id: string;
  sender_role: 'customer' | 'admin';
  body: string;
  client_msg_id?: string | null;
  read_at: string | null;
  created_at: string;
}

interface Customer {
  id: string;
  full_name: string | null;
  email: string | null;
  customer_code: string | null;
}

/** General chat with customers (not about any order): conversations on the left, the open thread on the right. */
@Component({
  selector: 'app-admin-support',
  standalone: true,
  imports: [FormsModule, DatePipe, IonSpinner, TimeAgoPipe],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Customers</span>
          <h1>Support chat</h1>
          <p class="subtitle">General messages from customers, not about a particular order.</p>
        </div>
      </header>

      <div class="layout" [class.open]="!!current()">
        <section class="card list-col" aria-label="Conversations">
          <input class="input" type="search" placeholder="Search name, email or code…" aria-label="Search conversations" [ngModel]="search()" (ngModelChange)="onSearch($event)" />
          @if (loading()) {
            <div class="center"><ion-spinner name="crescent"></ion-spinner></div>
          } @else if (!conversations().length) {
            <p class="muted none">No customer has written yet.</p>
          } @else {
            <ul class="convs">
              @for (c of conversations(); track c.customer_id) {
                <li>
                  <button type="button" class="conv" [class.active]="c.customer_id === currentId()" (click)="select(c.customer_id)">
                    <span class="avatar" aria-hidden="true">{{ (c.customer_name || c.email || '?').charAt(0).toUpperCase() }}</span>
                    <span class="txt">
                      <span class="top"><strong>{{ c.customer_name || c.email }}</strong><time>{{ c.last_at | timeAgo }}</time></span>
                      <span class="prev">{{ c.last_role === 'admin' ? 'You: ' : '' }}{{ c.last_body }}</span>
                    </span>
                    @if (c.unread > 0) { <span class="unread">{{ c.unread }}</span> }
                  </button>
                </li>
              }
            </ul>
          }
        </section>

        <section class="card thread-col" aria-label="Conversation">
          @if (current(); as cu) {
            <div class="thread-head">
              <button type="button" class="back" (click)="select(null)" aria-label="Back to conversations">‹</button>
              <div>
                <strong>{{ cu.full_name || cu.email }}</strong>
                <span class="muted small">{{ cu.customer_code }}@if (cu.email) { · {{ cu.email }} }</span>
              </div>
            </div>
            <div class="msgs" #msgsEl role="log" aria-live="polite">
              @if (threadLoading()) {
                <div class="center"><ion-spinner name="crescent"></ion-spinner></div>
              }
              @for (m of messages(); track m.id) {
                <div class="row" [class.mine]="m.sender_role === 'admin'">
                  <div class="bubble">
                    <span class="body">{{ m.body }}</span>
                    <span class="meta">{{ m.created_at | date: 'MMM d, h:mm a' }}@if (m.sender_role === 'admin' && m.read_at) { · seen }</span>
                  </div>
                </div>
              }
            </div>
            <form class="composer" (ngSubmit)="send()">
              <textarea class="textarea" rows="2" maxlength="4000" placeholder="Write a reply…" aria-label="Reply" name="reply" [ngModel]="text()" (ngModelChange)="text.set($event)" (keydown.enter)="onEnter($any($event))"></textarea>
              <button type="submit" class="btn btn-primary" [disabled]="!text().trim() || sending()">
                @if (sending()) { <ion-spinner name="crescent" /> } Send
              </button>
            </form>
          } @else {
            <div class="center muted">Choose a conversation to read and reply.</div>
          }
        </section>
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 340px 1fr; gap: 16px; min-height: 60vh; }
    .list-col, .thread-col { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
    .thread-col { height: 70vh; }
    .convs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
    .conv { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px; text-align: left; border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-surface); cursor: pointer; font: inherit; color: inherit; }
    .conv.active, .conv:hover { border-color: var(--c-brand); }
    .avatar { flex: none; width: 38px; height: 38px; border-radius: 50%; background: var(--c-brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .top { display: flex; justify-content: space-between; gap: 8px; time { font-size: 11px; color: var(--c-muted); flex: none; } strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .prev { font-size: 13px; color: var(--c-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .unread { flex: none; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: var(--c-danger, #c63d2a); color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .thread-head { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--c-line); div { display: flex; flex-direction: column; } }
    .back { display: none; border: 0; background: transparent; font-size: 28px; line-height: 1; cursor: pointer; }
    .msgs { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px; }
    .row { display: flex; }
    .row.mine { justify-content: flex-end; }
    .bubble { max-width: 70%; padding: 9px 12px; border-radius: 14px; background: var(--c-surface-3, #eee); display: flex; flex-direction: column; gap: 3px; }
    .mine .bubble { background: var(--c-brand); color: #fff; }
    .body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; }
    .meta { font-size: 11px; opacity: 0.7; align-self: flex-end; }
    .composer { display: flex; gap: 10px; align-items: flex-end; border-top: 1px solid var(--c-line); padding-top: 10px; textarea { flex: 1; resize: none; } }
    .center { margin: auto; padding: 24px; text-align: center; }
    .none { padding: 12px; }
    @media (max-width: 800px) {
      .layout { grid-template-columns: 1fr; }
      .layout.open .list-col { display: none; }
      .layout:not(.open) .thread-col { display: none; }
      .back { display: block; }
    }
  `,
})
export class AdminSupportPage implements OnInit {
  private api = inject(ApiService);
  private socket = inject(ChatSocketService);
  private badges = inject(BadgeService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly conversations = signal<Conversation[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  readonly currentId = signal<string | null>(null);
  readonly current = signal<Customer | null>(null);
  readonly messages = signal<SupportMsg[]>([]);
  readonly threadLoading = signal(false);
  readonly text = signal('');
  readonly sending = signal(false);
  private msgsEl = viewChild<ElementRef<HTMLElement>>('msgsEl');
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      this.messages();
      untracked(() => setTimeout(() => {
        const el = this.msgsEl()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }));
    });
  }

  ngOnInit(): void {
    this.loadList();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const id = q.get('customer');
      if (id !== this.currentId()) this.open(id);
    });
    this.socket.on('support:new' as never).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((m: unknown) => this.onLive(m as SupportMsg));
    this.socket.on('support:read' as never).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e: unknown) => {
      const ev = e as { customerId: string; readerRole: string; readAt: string };
      if (ev.customerId === this.currentId() && ev.readerRole === 'customer') {
        this.messages.update((l) => l.map((m) => (m.sender_role === 'admin' && !m.read_at ? { ...m, read_at: ev.readAt } : m)));
      }
    });
    this.socket.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.loadList(true);
      const id = this.currentId();
      if (id) this.open(id, true);
    });
  }

  private loadList(silent = false): void {
    if (!silent) this.loading.set(true);
    this.api.get<{ conversations: Conversation[] }>('/admin/support/conversations', { search: this.search() || undefined }).subscribe({
      next: (r) => {
        this.conversations.set(r.conversations);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.ui.error(e);
      },
    });
  }

  onSearch(text: string): void {
    this.search.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadList(true), 300);
  }

  select(id: string | null): void {
    void this.router.navigate([], { queryParams: { customer: id }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private open(id: string | null, silent = false): void {
    this.currentId.set(id);
    if (!id) {
      this.current.set(null);
      this.messages.set([]);
      return;
    }
    if (!silent) this.threadLoading.set(true);
    this.api.get<{ customer: Customer; messages: SupportMsg[] }>(`/admin/support/${id}/messages`, { limit: 100 }).subscribe({
      next: (r) => {
        if (this.currentId() !== id) return;
        this.current.set(r.customer);
        this.messages.set(r.messages);
        this.threadLoading.set(false);
        this.markRead(id);
      },
      error: (e) => {
        this.threadLoading.set(false);
        this.ui.error(e);
      },
    });
  }

  private markRead(id: string): void {
    this.api.post(`/admin/support/${id}/read`).subscribe({
      next: () => {
        this.conversations.update((l) => l.map((c) => (c.customer_id === id ? { ...c, unread: 0 } : c)));
        this.badges.refresh();
      },
      error: () => undefined,
    });
  }

  private onLive(m: SupportMsg): void {
    if (m.customer_id === this.currentId()) {
      this.messages.update((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      if (m.sender_role === 'customer') this.markRead(m.customer_id);
    }
    this.loadList(true);
  }

  onEnter(e: KeyboardEvent): void {
    if (e.shiftKey) return;
    e.preventDefault();
    this.send();
  }

  send(): void {
    const id = this.currentId();
    const body = this.text().trim();
    if (!id || !body || this.sending()) return;
    this.sending.set(true);
    this.api.post<{ message: SupportMsg }>(`/admin/support/${id}/messages`, { body, client_msg_id: crypto.randomUUID() }).subscribe({
      next: ({ message }) => {
        this.sending.set(false);
        this.text.set('');
        this.messages.update((l) => (l.some((x) => x.id === message.id) ? l : [...l, message]));
        this.loadList(true);
      },
      error: (e) => {
        this.sending.set(false);
        this.ui.error(e);
      },
    });
  }
}
