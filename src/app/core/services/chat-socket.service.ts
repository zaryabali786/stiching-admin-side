import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject, filter, map } from 'rxjs';
import { Socket, io } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { OutgoingMessage, SendAck, ServerEvents } from '../models/chat.models';
import { AuthService } from './auth.service';
import { BadgeService } from './badge.service';
import { NotificationService } from './notification.service';

const EVENTS: (keyof ServerEvents)[] = ['message:new', 'message:read', 'typing', 'inbox:update', 'notification:new'];
const ACK_TIMEOUT_MS = 8000;

/** Socket.IO lives on the API host (the API url without its /api path). */
export function socketOrigin(apiUrl: string, base: string = typeof location !== 'undefined' ? location.href : 'http://localhost'): string {
  try {
    return new URL(apiUrl, base).origin;
  } catch {
    return apiUrl.replace(/\/api\/?$/, '');
  }
}

/**
 * One shared Socket.IO connection for the whole signed-in session.
 * - Connects when the user signs in, disconnects on logout.
 * - Rooms joined with `join()` are re-joined automatically after a reconnect.
 * - An "unauthorized" rejection refreshes the access token and retries once.
 * - Everything has a REST equivalent, so callers fall back to HTTP while `connected()` is false.
 */
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private auth = inject(AuthService);
  private badges = inject(BadgeService);
  private notifications = inject(NotificationService);

  readonly connected = signal(false);
  /** True once a connection attempt has failed (server unreachable or rejected us). */
  readonly failed = signal(false);

  private socket: Socket | null = null;
  private events$ = new Subject<{ event: keyof ServerEvents; payload: unknown }>();
  private reconnected = new Subject<void>();
  /** Emits after every (re)connect that follows a drop, so open conversations can catch up. */
  readonly reconnected$ = this.reconnected.asObservable();
  private rooms = new Map<string, number>();
  private refreshedOnce = false;
  private everConnected = false;

  constructor() {
    effect(() => {
      const signedIn = this.auth.isAuthenticated();
      untracked(() => (signedIn ? this.connect() : this.disconnect()));
    });

    // Live counters: unread badge and bell refresh without waiting for their polls
    this.on('inbox:update').subscribe(() => this.badges.refresh());
    this.on('notification:new').subscribe(() => this.notifications.refresh());
  }

  /** Typed stream of one server event. */
  on<E extends keyof ServerEvents>(event: E): Observable<ServerEvents[E]> {
    return this.events$.pipe(
      filter((e) => e.event === event),
      map((e) => e.payload as ServerEvents[E])
    );
  }

  /** Join an order's room (counted: panels may overlap). Resolves false when offline; the join is retried on connect. */
  async join(orderId: string): Promise<boolean> {
    this.rooms.set(orderId, (this.rooms.get(orderId) ?? 0) + 1);
    if (!this.socket?.connected) return false;
    const ack = await this.ack<{ ok: boolean; error?: string }>('conversation:join', { orderId });
    return !!ack?.ok;
  }

  leave(orderId: string): void {
    const n = (this.rooms.get(orderId) ?? 0) - 1;
    if (n > 0) {
      this.rooms.set(orderId, n);
      return;
    }
    this.rooms.delete(orderId);
    if (this.socket?.connected) this.socket.emit('conversation:leave', { orderId });
  }

  /** Send a message over the socket. Rejects when offline or on timeout so the caller can use REST. */
  async sendMessage(orderId: string, msg: OutgoingMessage): Promise<SendAck> {
    if (!this.socket?.connected) throw new Error('offline');
    const ack = await this.ack<SendAck>('message:send', { orderId, ...msg });
    if (!ack) throw new Error('timeout');
    return ack;
  }

  /** `unitId`: 'general' or an article id (omit = everything). */
  markRead(orderId: string, unitId?: string): void {
    if (this.socket?.connected) this.socket.emit('message:read', { orderId, ...(unitId ? { unit_id: unitId } : {}) }, () => undefined);
  }

  setTyping(orderId: string, typing: boolean, unitId?: string): void {
    if (this.socket?.connected) this.socket.emit('typing', { orderId, typing, ...(unitId ? { unitId } : {}) });
  }

  // ── connection ──

  private connect(): void {
    if (this.socket) return;
    const socket = io(socketOrigin(environment.apiUrl), {
      // the function form re-reads the token on every (re)connect
      auth: (cb) => cb({ token: this.auth.accessToken() }),
      reconnectionDelayMax: 10_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      const dropped = this.everConnected;
      this.everConnected = true;
      this.refreshedOnce = false;
      this.failed.set(false);
      this.connected.set(true);
      for (const orderId of this.rooms.keys()) socket.emit('conversation:join', { orderId }, () => undefined);
      if (dropped) this.reconnected.next();
    });
    socket.on('disconnect', () => this.connected.set(false));
    socket.on('connect_error', (err) => {
      this.connected.set(false);
      this.failed.set(true);
      if (err?.message === 'unauthorized') this.refreshAndRetry(socket);
    });
    for (const event of EVENTS) socket.on(event, (payload: unknown) => this.events$.next({ event, payload }));
  }

  /** The server rejected our token: get a fresh one and try once more (the client does not retry rejected handshakes itself). */
  private refreshAndRetry(socket: Socket): void {
    if (this.refreshedOnce || !this.auth.refreshToken()) return;
    this.refreshedOnce = true;
    this.auth.refreshTokens().subscribe({
      next: () => socket.connect(),
      error: () => this.auth.logout({ reason: 'expired' }),
    });
  }

  private disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.rooms.clear();
    this.everConnected = false;
    this.connected.set(false);
    this.failed.set(false);
  }

  private ack<T>(event: string, payload: unknown): Promise<T | null> {
    return new Promise((resolve) => {
      const socket = this.socket;
      if (!socket) return resolve(null);
      socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err: Error | null, res: T) => resolve(err ? null : res));
    });
  }
}
