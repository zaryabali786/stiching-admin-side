import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, Injector, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonSpinner } from '@ionic/angular';
import { Observable } from 'rxjs';
import { ChatMessage, GENERAL_SCOPE, OutgoingMessage, SendAck, UiMessage, VoiceUpload, AudioRef, scopeOf } from '../../../core/models/chat.models';
import { ApiService, apiErrorMessage } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { BadgeService } from '../../../core/services/badge.service';
import { ChatSocketService } from '../../../core/services/chat-socket.service';
import {
  MAX_TEXT, MAX_VOICE_SECONDS, MIN_VOICE_SECONDS, buildRows, formatClock, markSeen, mergePage, optimisticText, optimisticVoice, setState, uuid,
} from './chat.logic';
import { Recording, SILENCE_MESSAGE, SILENCE_PEAK, VoiceError, VoiceRecorder, blobToDataUrl, isSilent, voiceSupported } from './voice-recorder';
import { LevelBarsComponent } from './level-meter.component';
import { VoicePlayerComponent } from './voice-player.component';

const PAGE_SIZE = 30;
const FALLBACK_POLL_MS = 15_000;
const TYPING_IDLE_MS = 2000;
const TYPING_SHOW_MS = 5000;
const AUDIO_RELOAD_COOLDOWN_MS = 5 * 60_000;

interface VoiceDraft {
  blob: Blob;
  duration: number;
  mime: string;
  uploaded?: AudioRef;
  /** The chat it was recorded in ('general' or an article id). */
  scope: string;
}

/** Show the "no sound" hint only after this much continuous recording with the level never above the silence threshold. */
const SILENCE_WARN_SECONDS = 4;

type RecState = 'idle' | 'starting' | 'recording' | 'sending';

/**
 * One order's conversation: history with cursor paging, live updates over Socket.IO (REST when the
 * socket is down), optimistic sending with retry, typing, "Seen", and voice notes.
 */
@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [DatePipe, IonSpinner, VoicePlayerComponent, LevelBarsComponent],
  templateUrl: './chat-panel.component.html',
  styleUrls: ['./chat-panel.component.scss'],
})
export class ChatPanelComponent implements OnDestroy {
  readonly orderId = input.required<string>();
  /** Which chat of the order: 'general' or an article (unit) id. */
  readonly unitId = input<string>(GENERAL_SCOPE);
  /** Emitted when unread counts may have changed (messages read, a message arrived for another chat). */
  readonly activity = output<void>();

  private api = inject(ApiService);
  private auth = inject(AuthService);
  private badges = inject(BadgeService);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  readonly socket = inject(ChatSocketService);

  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  // ── history ──
  readonly messages = signal<UiMessage[]>([]);
  readonly loading = signal(true);
  readonly loadingOlder = signal(false);
  readonly hasMore = signal(false);
  readonly error = signal<string | null>(null);
  private nextCursor: string | null = null;

  // ── view state ──
  readonly draft = signal('');
  readonly typingName = signal<string | null>(null);
  readonly newBelow = signal(0);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private atBottom = true;

  // ── voice ──
  readonly voiceOk = voiceSupported();
  readonly rec = signal<RecState>('idle');
  readonly recSeconds = signal(0);
  readonly recLimitHit = signal(false);
  readonly recError = signal<string | null>(null);
  /** True when the last recording was silent: offer "Record again". */
  readonly recSilent = signal(false);
  readonly recLevel = signal(0);
  readonly recHeard = signal(false);
  readonly warnNoSound = computed(() => this.rec() === 'recording' && this.recSeconds() >= SILENCE_WARN_SECONDS && !this.recHeard() && this.recMetered());
  private recMetered = signal(false);
  private recorder: VoiceRecorder | null = null;
  private recTimer: ReturnType<typeof setInterval> | null = null;
  private voiceDrafts = new Map<string, VoiceDraft>();
  private objectUrls: string[] = [];

  readonly maxText = MAX_TEXT;
  readonly maxVoice = MAX_VOICE_SECONDS;
  readonly clock = formatClock;
  readonly me = computed(() => this.auth.user());
  readonly rows = computed(() => buildRows(this.messages(), (m) => this.isMine(m)));
  readonly overLimit = computed(() => this.draft().length > MAX_TEXT);
  /** Reading is `messages.view`; writing needs `messages.update` (the server checks too). */
  readonly canReply = computed(() => this.auth.can('messages.update'));
  readonly canSend = computed(() => !!this.draft().trim() && !this.overLimit());

  /** Connection banner: null while everything is live. */
  readonly banner = computed(() => {
    if (!this.online()) return 'You are offline. Messages will be sent when your connection returns.';
    if (this.socket.connected()) return null;
    return this.socket.failed()
      ? 'Live updates are unavailable. Messages still send, and new ones appear every few seconds. Reconnecting…'
      : 'Connecting to live updates…';
  });

  private currentId = '';
  private currentScope: string = GENERAL_SCOPE;
  private joinedId = '';
  private typingSent = false;
  private typingIdle: ReturnType<typeof setTimeout> | null = null;
  private typingShow: ReturnType<typeof setTimeout> | null = null;
  private readTimer: ReturnType<typeof setTimeout> | null = null;
  private audioReloadAt = 0;

  constructor() {
    effect(() => {
      const id = this.orderId();
      const scope = this.unitId() || GENERAL_SCOPE;
      untracked(() => this.open(id, scope));
    });

    this.socket.on('message:new').pipe(takeUntilDestroyed()).subscribe((m) => this.onIncoming(m));
    this.socket.on('message:read').pipe(takeUntilDestroyed()).subscribe((p) => {
      // only the customer reading matters for staff messages
      if (p.orderId !== this.currentId || p.readerRole !== 'customer') return;
      // only when it is about the open chat (an event without a scope applies to everything)
      const about = p.general ? GENERAL_SCOPE : p.unitId || null;
      if (!about || about === this.currentScope) this.messages.update((l) => markSeen(l, (m) => this.isMine(m), p.readAt));
    });
    this.socket.on('typing').pipe(takeUntilDestroyed()).subscribe((p) => {
      if (p.orderId !== this.currentId || p.userId === this.me()?.id) return;
      if (p.unitId !== undefined && (p.unitId || GENERAL_SCOPE) !== this.currentScope) return; // typing in another chat
      if (this.typingShow) clearTimeout(this.typingShow);
      this.typingName.set(p.typing ? p.name || 'The customer' : null);
      if (p.typing) this.typingShow = setTimeout(() => this.typingName.set(null), TYPING_SHOW_MS);
    });
    // catch up on whatever happened while the socket was down
    this.socket.reconnected$.pipe(takeUntilDestroyed()).subscribe(() => {
      void this.reloadLatest();
      this.scheduleRead();
    });

    const poll = setInterval(() => {
      if (!this.socket.connected() && !this.loading() && this.currentId) void this.reloadLatest();
    }, FALLBACK_POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(poll));
  }

  ngOnDestroy(): void {
    this.close();
    for (const u of this.objectUrls) URL.revokeObjectURL(u);
  }

  isMine(m: UiMessage): boolean {
    return m.sender_id === this.me()?.id;
  }

  roleLabel(m: ChatMessage): string {
    return m.sender_role === 'customer' ? 'Customer' : m.sender_role === 'admin' ? 'Admin' : 'Partner';
  }

  // ═════════ opening / closing a conversation ═════════

  /** Same order, different chat: keep the room and reset only this chat's state. */
  private open(id: string, scope: string): void {
    if (id !== this.currentId) this.close();
    else {
      this.stopTyping();
      this.cancelRecording();
      if (this.readTimer) clearTimeout(this.readTimer);
      this.typingName.set(null);
    }
    this.currentId = id;
    this.currentScope = scope;
    this.messages.set([]);
    this.hasMore.set(false);
    this.nextCursor = null;
    this.error.set(null);
    this.loading.set(true);
    this.newBelow.set(0);
    this.draft.set('');
    this.atBottom = true;
    this.audioReloadAt = 0;
    if (this.joinedId !== id) {
      void this.socket.join(id);
      this.joinedId = id;
    }
    this.api.list<ChatMessage, { hasMore: boolean; nextCursor: string | null }>(`/partner/orders/${id}/messages`, { limit: PAGE_SIZE, unit_id: scope }).subscribe({
      next: ({ items, meta }) => {
        if (this.stale(id, scope)) return;
        this.messages.update((l) => mergePage(l, items));
        this.hasMore.set(!!meta.hasMore);
        this.nextCursor = meta.nextCursor ?? null;
        this.loading.set(false);
        this.scrollToBottom();
        this.scheduleRead();
      },
      error: (err) => {
        if (this.stale(id, scope)) return;
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, 'Could not load this conversation.'));
      },
    });
  }

  private close(): void {
    if (this.currentId) {
      this.stopTyping();
      this.socket.leave(this.currentId);
      this.joinedId = '';
    }
    this.cancelRecording();
    if (this.readTimer) clearTimeout(this.readTimer);
    this.typingName.set(null);
    this.currentId = '';
  }

  retryLoad(): void {
    this.open(this.currentId, this.currentScope);
  }

  /** True when the open conversation or chat is no longer the one a response was requested for. */
  private stale(id: string, scope: string): boolean {
    return id !== this.currentId || scope !== this.currentScope;
  }

  private here(id: string, scope: string): boolean {
    return !this.stale(id, scope);
  }

  /** Scope value to send: omit for General. */
  private unitParam(): string | undefined {
    return this.currentScope === GENERAL_SCOPE ? undefined : this.currentScope;
  }

  /** Re-fetch the newest page and merge it (new messages, fresh signed audio links) without losing scroll or pending bubbles. */
  private async reloadLatest(): Promise<void> {
    const id = this.currentId;
    const scope = this.currentScope;
    try {
      const { items } = await this.firstValue(this.api.list<ChatMessage>(`/partner/orders/${id}/messages`, { limit: PAGE_SIZE, unit_id: scope }));
      if (this.stale(id, scope)) return;
      this.messages.update((l) => mergePage(l, items));
      if (this.atBottom) this.scrollToBottom();
      this.scheduleRead();
    } catch {
      /* the next poll or reconnect tries again */
    }
  }

  private firstValue<T>(obs: Observable<T>): Promise<T> {
    return new Promise((resolve, reject) => obs.subscribe({ next: resolve, error: reject }));
  }

  loadOlder(): void {
    const id = this.currentId;
    const scope = this.currentScope;
    if (this.loadingOlder() || !this.hasMore() || !this.nextCursor) return;
    const el = this.scroller()?.nativeElement;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    this.loadingOlder.set(true);
    this.api.list<ChatMessage, { hasMore: boolean; nextCursor: string | null }>(`/partner/orders/${id}/messages`, { limit: PAGE_SIZE, before: this.nextCursor, unit_id: scope }).subscribe({
      next: ({ items, meta }) => {
        if (this.stale(id, scope)) return;
        this.messages.update((l) => mergePage(l, items));
        this.hasMore.set(!!meta.hasMore);
        this.nextCursor = meta.nextCursor ?? null;
        this.loadingOlder.set(false);
        // keep what the user was reading in place
        afterNextRender(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
        }, { injector: this.injector });
      },
      error: () => {
        this.loadingOlder.set(false);
      },
    });
  }

  // ═════════ scrolling ═════════

  onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (this.atBottom) this.newBelow.set(0);
    if (el.scrollTop < 40 && this.hasMore() && !this.loadingOlder() && !this.loading()) this.loadOlder();
  }

  scrollToBottom(): void {
    this.newBelow.set(0);
    afterNextRender(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.atBottom = true;
    }, { injector: this.injector });
  }

  // ═════════ incoming ═════════

  private onIncoming(m: ChatMessage): void {
    if (m.order_id !== this.currentId) return;
    // a message for another chat of this order only bumps its badge (the page refreshes the picker)
    if (scopeOf(m) !== this.currentScope) {
      this.activity.emit();
      return;
    }
    const known = this.messages().some((x) => x.id === m.id);
    this.messages.update((l) => mergePage(l, [m]));
    if (this.typingName() && m.sender_id !== this.me()?.id) this.typingName.set(null);
    if (known) return;
    if (m.sender_id === this.me()?.id) {
      this.scrollToBottom();
      return;
    }
    if (this.atBottom) this.scrollToBottom();
    else this.newBelow.update((n) => n + 1);
    this.scheduleRead();
  }

  /** The customer's unread messages count as read once the panel is visible and focused. */
  @HostListener('window:focus')
  @HostListener('document:visibilitychange')
  scheduleRead(): void {
    if (this.readTimer) clearTimeout(this.readTimer);
    this.readTimer = setTimeout(() => this.markRead(), 400);
  }

  private markRead(): void {
    const id = this.currentId;
    const scope = this.currentScope;
    if (!id || typeof document === 'undefined' || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    if (!this.messages().some((m) => m.sender_role === 'customer' && !m.read_at && m.state === 'sent')) return;
    this.api.post<{ updated: number }>(`/partner/orders/${id}/messages/read`, { unit_id: scope }).subscribe({
      next: () => {
        if (this.stale(id, scope)) return;
        this.activity.emit();
        const now = new Date().toISOString();
        this.messages.update((l) => l.map((m) => (m.sender_role === 'customer' && !m.read_at ? { ...m, read_at: now } : m)));
        this.badges.refresh();
      },
      error: () => undefined,
    });
  }

  @HostListener('window:online')
  @HostListener('window:offline')
  onNetwork(): void {
    this.online.set(navigator.onLine);
    if (navigator.onLine) void this.reloadLatest();
  }

  // ═════════ composing text ═════════

  onInput(el: HTMLTextAreaElement): void {
    this.draft.set(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    if (el.value.trim() && !this.typingSent) {
      this.typingSent = true;
      this.socket.setTyping(this.currentId, true, this.unitParam());
    }
    if (this.typingIdle) clearTimeout(this.typingIdle);
    this.typingIdle = setTimeout(() => this.stopTyping(), TYPING_IDLE_MS);
  }

  onEnter(e: Event): void {
    const ev = e as KeyboardEvent;
    if (ev.shiftKey || ev.isComposing) return; // Shift+Enter inserts a newline
    ev.preventDefault();
    this.send();
  }

  private stopTyping(): void {
    if (this.typingIdle) clearTimeout(this.typingIdle);
    if (this.typingSent && this.currentId) this.socket.setTyping(this.currentId, false, this.unitParam());
    this.typingSent = false;
  }

  send(): void {
    if (!this.canReply()) return;
    const body = this.draft().trim();
    const user = this.me();
    if (!body || body.length > MAX_TEXT || !user || !this.currentId) return;
    const cid = uuid();
    const sender = { id: user.id, role: this.auth.role() === 'admin' ? ('admin' as const) : ('partner_staff' as const), name: user.full_name };
    this.messages.update((l) => [...l, optimisticText(this.currentId, sender, body, cid, this.unitParam() ?? null)]);
    this.draft.set('');
    const box = this.composer()?.nativeElement;
    if (box) box.style.height = 'auto';
    this.stopTyping();
    this.scrollToBottom();
    void this.deliver(this.currentId, { kind: 'text', body, client_msg_id: cid, unit_id: this.unitParam() });
  }

  retry(m: UiMessage): void {
    if (!m.client_msg_id) return;
    this.messages.update((l) => setState(l, m.client_msg_id!, 'sending'));
    if (m.kind === 'voice') void this.deliverVoice(this.currentId, m.client_msg_id);
    else void this.deliver(this.currentId, { kind: 'text', body: m.body || '', client_msg_id: m.client_msg_id, unit_id: this.unitParam() });
  }

  discard(m: UiMessage): void {
    this.messages.update((l) => l.filter((x) => x.id !== m.id));
    if (m.client_msg_id) this.voiceDrafts.delete(m.client_msg_id);
  }

  /** Socket first; when it is down or does not answer, the REST endpoint (the same client_msg_id keeps retries safe). */
  private async deliver(orderId: string, out: OutgoingMessage): Promise<boolean> {
    const cid = out.client_msg_id;
    const scope = out.unit_id || GENERAL_SCOPE;
    try {
      let ack: SendAck;
      if (this.socket.connected()) {
        try {
          ack = await this.socket.sendMessage(orderId, out);
        } catch {
          ack = await this.restSend(orderId, out);
        }
      } else {
        ack = await this.restSend(orderId, out);
      }
      if (!ack.ok) throw new Error(ack.error);
      if (this.here(orderId, scope)) this.messages.update((l) => mergePage(l, [ack.message]));
      return true;
    } catch (err) {
      if (this.here(orderId, scope)) {
        this.messages.update((l) => setState(l, cid, 'failed', apiErrorMessage(err, 'Not sent.')));
        if (this.atBottom) this.scrollToBottom(); // keep the Retry row in view
      }
      return false;
    }
  }

  private async restSend(orderId: string, out: OutgoingMessage): Promise<SendAck> {
    const message = await this.firstValue(this.api.post<ChatMessage>(`/partner/orders/${orderId}/messages`, out));
    return { ok: true, message };
  }

  // ═════════ voice ═════════

  async startRecording(): Promise<void> {
    if (!this.canReply()) return;
    if (this.rec() !== 'idle') return;
    this.recError.set(null);
    this.recSilent.set(false);
    this.recLimitHit.set(false);
    this.recHeard.set(false);
    this.rec.set('starting');
    const recorder = new VoiceRecorder();
    try {
      await recorder.start();
    } catch (err) {
      this.rec.set('idle');
      this.recError.set(err instanceof VoiceError ? err.message : 'Could not start recording.');
      return;
    }
    this.recorder = recorder;
    this.recSeconds.set(0);
    this.rec.set('recording');
    this.recMetered.set(recorder.metered);
    const startedAt = Date.now();
    this.recTimer = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      this.recLevel.set(recorder.level);
      if (recorder.peak >= SILENCE_PEAK) this.recHeard.set(true);
      if (s >= MAX_VOICE_SECONDS) {
        this.recSeconds.set(MAX_VOICE_SECONDS);
        this.stopTimer();
        this.recLimitHit.set(true);
        void recorder.finish().catch(() => undefined); // finalise now; Send uses the same result
      } else {
        this.recSeconds.set(s);
      }
    }, 100);
  }

  cancelRecording(): void {
    this.stopTimer();
    this.recorder?.cancel();
    this.recorder = null;
    this.recLimitHit.set(false);
    this.recLevel.set(0);
    this.rec.set('idle');
  }

  async sendRecording(): Promise<void> {
    const recorder = this.recorder;
    const user = this.me();
    if (!recorder || !user || this.rec() !== 'recording') return;
    this.stopTimer();
    this.rec.set('sending');
    let clip: Recording;
    try {
      clip = await recorder.finish();
    } catch (err) {
      this.recorder = null;
      this.rec.set('idle');
      this.recError.set(err instanceof VoiceError ? err.message : 'The recording failed. Please try again.');
      return;
    }
    this.recorder = null;
    this.rec.set('idle');
    this.recLimitHit.set(false);
    if (isSilent(clip)) {
      // nothing was heard: do not upload or send
      this.recSilent.set(true);
      this.recError.set(SILENCE_MESSAGE);
      return;
    }
    if (clip.duration < MIN_VOICE_SECONDS) {
      this.recError.set('That was too short. Hold on a little longer, then press Send.');
      return;
    }
    const duration = Math.min(clip.duration, MAX_VOICE_SECONDS);
    const cid = uuid();
    const url = URL.createObjectURL(clip.blob);
    this.objectUrls.push(url);
    const sender = { id: user.id, role: this.auth.role() === 'admin' ? ('admin' as const) : ('partner_staff' as const), name: user.full_name };
    this.voiceDrafts.set(cid, { blob: clip.blob, duration, mime: clip.mime, scope: this.currentScope });
    this.messages.update((l) => [...l, optimisticVoice(this.currentId, sender, { mime: clip.mime, duration, size: clip.blob.size, url }, cid, this.unitParam() ?? null)]);
    this.scrollToBottom();
    void this.deliverVoice(this.currentId, cid);
  }

  /** Upload once over HTTP (never through the socket), then send the reference as a message. */
  private async deliverVoice(orderId: string, cid: string): Promise<void> {
    const d = this.voiceDrafts.get(cid);
    if (!d) return;
    try {
      if (!d.uploaded) {
        const dataUrl = await blobToDataUrl(d.blob);
        const up = await this.firstValue(this.api.post<VoiceUpload>(`/partner/orders/${orderId}/messages/voice-upload`, { audio: { dataUrl, duration: d.duration } }));
        d.uploaded = { path: up.path, duration: up.duration, mime: up.mime, size: up.size };
      }
    } catch (err) {
      if (this.here(orderId, d.scope)) {
        this.messages.update((l) => setState(l, cid, 'failed', apiErrorMessage(err, 'The recording could not be uploaded.')));
        if (this.atBottom) this.scrollToBottom();
      }
      return;
    }
    if (await this.deliver(orderId, { kind: 'voice', audio: d.uploaded, client_msg_id: cid, unit_id: d.scope === GENERAL_SCOPE ? undefined : d.scope })) this.voiceDrafts.delete(cid);
  }

  /** A signed audio link failed (they last an hour): refresh them by reloading the newest page, at most every 5 minutes. */
  onAudioFailed(): void {
    if (Date.now() - this.audioReloadAt < AUDIO_RELOAD_COOLDOWN_MS) return;
    this.audioReloadAt = Date.now();
    void this.reloadLatest();
  }

  private stopTimer(): void {
    if (this.recTimer) clearInterval(this.recTimer);
    this.recTimer = null;
  }

  trackRow(_: number, r: { key: string }): string {
    return r.key;
  }
}
