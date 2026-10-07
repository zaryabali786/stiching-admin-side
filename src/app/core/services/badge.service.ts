import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, interval, of, startWith, switchMap, tap } from 'rxjs';
import { ApiService } from './api.service';

export interface AdminBadges {
  invoices: number;
  warehouse: number;
  orders: number;
  /** conversations with unread customer messages */
  messages?: number;
}

export interface PartnerBadges {
  receiving: number;
  qualityCheck: number;
  warehouse: number;
  /** conversations with unread customer messages */
  messages?: number;
}

/**
 * Sidebar counters. Each layout starts/stops polling for its own portal;
 * pages call `refresh()` after an action that changes a count.
 */
@Injectable({ providedIn: 'root' })
export class BadgeService {
  private api = inject(ApiService);

  readonly admin = signal<AdminBadges | null>(null);
  readonly partner = signal<PartnerBadges | null>(null);

  private sub?: Subscription;
  private portal: 'admin' | 'partner' | null = null;

  start(portal: 'admin' | 'partner'): void {
    this.stop();
    this.portal = portal;
    this.sub = interval(60_000)
      .pipe(
        startWith(0),
        switchMap(() => this.fetch())
      )
      .subscribe();
  }

  stop(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.portal = null;
  }

  refresh(): void {
    this.fetch().subscribe();
  }

  private fetch(): Observable<unknown> {
    if (this.portal === 'admin') {
      return this.api.get<AdminBadges>('/admin/badges').pipe(
        tap((b) => this.admin.set(b)),
        catchError(() => of(null))
      );
    }
    if (this.portal === 'partner') {
      return this.api.get<PartnerBadges>('/partner/badges').pipe(
        tap((b) => this.partner.set(b)),
        catchError(() => of(null))
      );
    }
    return of(null);
  }
}
