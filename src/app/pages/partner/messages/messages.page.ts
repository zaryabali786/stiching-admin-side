import { Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subject, debounceTime, distinctUntilChanged, map } from 'rxjs';
import { Conversation, ConversationChat, ConversationHeader, ConversationScope, GENERAL_SCOPE, OrderConversation } from '../../../core/models/chat.models';
import { ApiService, apiErrorMessage } from '../../../core/services/api.service';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import { LanguageService } from '../../../core/services/language.service';
import { TimeAgoPipe } from '../../../shared/pipes';
import { ChatPanelComponent } from '../../../shared/components/chat-panel/chat-panel.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';
import { SKELETON_ROWS, oneOf, setQuery } from '../../admin/admin-list';

const PAGE = 20;
const MAX_SOFT_PAGES = 5;
const FILTERS = ['all', 'unread'] as const;
type InboxFilter = (typeof FILTERS)[number];

/** GET /partner/orders/:id/summary */
interface OrderSummary {
  id: string;
  reference: string;
  customer_name: string | null;
  customer_code: string | null;
  brand: string | null;
  status: string;
  status_label: string;
}

interface InboxMeta {
  unreadConversations?: number;
  hasMore: boolean;
}

/**
 * Inbox + conversation. The same page serves /partner/messages[/:orderId] and /admin/messages[/:orderId].
 * Desktop: list and thread side by side. Phones: the list first, then the thread as its own view.
 */
@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [RouterLink, IonSpinner, TimeAgoPipe, ChatPanelComponent, EmptyStateComponent, SearchInputComponent, StatusBadgeComponent],
  templateUrl: './messages.page.html',
  styleUrls: ['./messages.page.scss'],
})
export class MessagesPage implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private socket = inject(ChatSocketService);
  readonly lang = inject(LanguageService);

  readonly isAdminPortal = this.router.url.startsWith('/admin');
  readonly base = this.isAdminPortal ? '/admin/messages' : '/partner/messages';
  readonly filters = FILTERS;
  readonly skeleton = SKELETON_ROWS.slice(0, 5);

  readonly activeId = signal<string | null>(null);
  readonly filter = signal<InboxFilter>('all');
  readonly search = signal('');

  readonly items = signal<Conversation[]>([]);
  readonly unreadTotal = signal(0);
  readonly hasMore = signal(false);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);

  private loadedPages = 1;
  private reqId = 0;
  readonly refresh$ = new Subject<void>();

  // ── one chat at a time: General (no ?unit=) or ONE article (?unit=) ──
  readonly unitParam = signal<string | null>(null);
  /** Titles of the open order's chats, only used for the "Chat about article" strip when the inbox row does not know it. */
  readonly scopes = signal<ConversationScope[] | null>(null);
  private scopesFor = '';
  readonly activeScope = computed(() => {
    const u = this.unitParam();
    return u && u !== GENERAL_SCOPE ? u : GENERAL_SCOPE;
  });
  readonly activeArticle = computed(() => {
    const u = this.activeScope();
    if (u === GENERAL_SCOPE) return null;
    const fromInbox = this.items().find((x) => x.order_id === this.activeId())?.chats?.find((c) => c.unit_id === u);
    if (fromInbox) return { title: fromInbox.title, line_no: fromInbox.line_no ?? null, image_url: this.scopes()?.find((s) => s.unit_id === u)?.image_url ?? null };
    const s = this.scopes()?.find((x) => x.unit_id === u);
    return s ? { title: s.title, line_no: s.line_no, image_url: s.image_url } : null;
  });
  readonly panelReady = computed(() => !!this.activeId());

  /** Header data for the open conversation: the inbox row, else what we could look up. */
  private looked = signal<ConversationHeader | null>(null);
  private hint = signal<ConversationHeader | null>(null);
  readonly header = computed<ConversationHeader | null>(() => {
    const id = this.activeId();
    if (!id) return null;
    const c = this.items().find((x) => x.order_id === id);
    if (c) return { order_id: id, reference: c.reference, customer_name: c.customer_name, customer_code: c.customer_code, status: c.status, status_label: c.status_label };
    const found = this.looked();
    if (found?.order_id === id) return found;
    const h = this.hint();
    if (h?.order_id === id) return h;
    return { order_id: id, reference: null, customer_name: null, customer_code: null, status: null, status_label: null };
  });

  constructor() {
    // An article chat opened by link that the inbox row does not list yet: fetch the article titles once.
    effect(() => {
      const id = this.activeId();
      const unit = this.activeScope();
      const known = !!this.activeArticle();
      const inboxLoading = this.loading();
      untracked(() => {
        if (id && !inboxLoading && unit !== GENERAL_SCOPE && !known && this.scopesFor !== id) {
          this.scopesFor = id;
          this.loadScopes(id);
        }
      });
    });

    // An order opened by link (no router state) that is not in the inbox yet: ask the server for its header.
    effect(() => {
      const id = this.activeId();
      const loading = this.loading();
      const known = this.items().some((x) => x.order_id === id);
      untracked(() => {
        if (!id || loading || known || this.hint()?.order_id === id || this.looked()?.order_id === id) return;
        this.api.get<OrderSummary>(`/partner/orders/${id}/summary`).subscribe({
          next: (o) => this.looked.set({ order_id: id, reference: o.reference, customer_name: o.customer_name, customer_code: o.customer_code, status: o.status, status_label: o.status_label }),
          error: () => undefined,
        });
      });
    });
  }

  ngOnInit(): void {
    const nav = (this.router.getCurrentNavigation()?.extras.state ?? history.state) as { order?: Partial<ConversationHeader> } | null;

    this.route.paramMap.pipe(map((p) => p.get('orderId')), takeUntilDestroyed(this.destroyRef)).subscribe((id) => {
      this.activeId.set(id);
      this.scopes.set(null);
      this.scopesFor = '';
      const o = nav?.order;
      if (id && o) this.hint.set({ order_id: id, reference: o.reference ?? null, customer_name: o.customer_name ?? null, customer_code: o.customer_code ?? null, status: o.status ?? null, status_label: o.status_label ?? null });
      // opening a thread reads it: refresh the unread counts shortly after
      if (id) setTimeout(() => this.refresh$.next(), 1500);
    });

    this.route.queryParamMap.pipe(map((p) => p.get('unit')), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)).subscribe((u) => this.unitParam.set(u));

    this.route.queryParamMap
      .pipe(
        map((p) => ({ q: p.get('q') || '', f: oneOf(p.get('filter'), FILTERS, 'all') })),
        distinctUntilChanged((a, b) => a.q === b.q && a.f === b.f),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ q, f }) => {
        this.search.set(q);
        this.filter.set(f);
        this.load();
      });

    // Live: a new or read message anywhere updates the list and its chat shortcuts
    this.socket.on('inbox:update').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh$.next());
    this.socket.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh$.next());
    this.refresh$.pipe(debounceTime(600), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load({ soft: true }));
  }

  // ── article titles for the open order ──

  private loadScopes(orderId: string): void {
    this.api.get<OrderConversation>(`/partner/orders/${orderId}/conversation`).subscribe({
      next: (c) => {
        if (orderId === this.activeId()) this.scopes.set(c.scopes || []);
      },
      error: () => undefined,
    });
  }

  /** Where a chat shortcut under an order row leads: that one chat only. */
  chatQuery(chat: ConversationChat): { unit: string | null } {
    return { unit: chat.unit_id };
  }

  isOpenChat(orderId: string, chat: ConversationChat): boolean {
    return orderId === this.activeId() && (chat.unit_id || GENERAL_SCOPE) === this.activeScope();
  }

  chatLabel(chat: ConversationChat): string {
    return chat.unit_id ? chat.title : 'General';
  }

  // ── list loading (server-side search, filter and paging) ──

  load(opts: { append?: boolean; soft?: boolean } = {}): void {
    const token = ++this.reqId;
    const page = opts.append ? this.loadedPages + 1 : 1;
    const limit = opts.soft ? Math.min(this.loadedPages, MAX_SOFT_PAGES) * PAGE : PAGE;
    if (opts.append) this.loadingMore.set(true);
    else if (!opts.soft) {
      this.loading.set(true);
      this.error.set(null);
    }
    this.api
      .list<Conversation, InboxMeta>('/partner/conversations', { search: this.search(), filter: this.filter() === 'unread' ? 'unread' : undefined, page, limit })
      .subscribe({
        next: ({ items, meta }) => {
          if (token !== this.reqId) return;
          if (opts.append) {
            const have = new Set(this.items().map((c) => c.order_id));
            this.items.update((l) => [...l, ...items.filter((c) => !have.has(c.order_id))]);
            this.loadedPages = page;
          } else {
            this.items.set(items);
            this.loadedPages = opts.soft ? Math.min(this.loadedPages, MAX_SOFT_PAGES) : 1;
          }
          this.hasMore.set(!!meta.hasMore);
          if (typeof meta.unreadConversations === 'number') this.unreadTotal.set(meta.unreadConversations);
          this.loading.set(false);
          this.loadingMore.set(false);
        },
        error: (err) => {
          if (token !== this.reqId) return;
          this.loading.set(false);
          this.loadingMore.set(false);
          if (!opts.soft) this.error.set(apiErrorMessage(err, 'Could not load the conversations.'));
        },
      });
  }

  loadMore(): void {
    if (!this.loadingMore() && this.hasMore()) this.load({ append: true });
  }

  setFilter(f: InboxFilter): void {
    setQuery(this.router, this.route, { filter: f === 'all' ? null : f });
  }

  onSearch(q: string): void {
    setQuery(this.router, this.route, { q: q || null });
  }

  // ── presentation helpers ──

  initial(c: { customer_name: string | null }): string {
    return (c.customer_name || '?').trim().charAt(0).toUpperCase();
  }

  isVoice(c: Conversation): boolean {
    return c.last_message_preview === 'Voice message';
  }

  fromStaff(c: Conversation): boolean {
    return c.last_message_role === 'partner_staff' || c.last_message_role === 'admin';
  }

  get orderLink(): { commands: string[]; params: Record<string, string>; label: string } | null {
    const h = this.header();
    if (!h?.reference) return null;
    return this.isAdminPortal
      ? { commands: ['/admin/orders'], params: { ref: h.reference }, label: 'Open order' }
      : { commands: ['/partner/production'], params: { search: h.reference }, label: 'Find job card' };
  }
}
