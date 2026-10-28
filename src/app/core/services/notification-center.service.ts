import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';

/** Which portal is using the Notification Center: an admin (clients, staff, partners) or a partner (its own staff only). */
export type NotificationPortal = 'admin' | 'partner';
export type NcCategory = 'clients' | 'staff' | 'partners';
export type NcStatus = 'scheduled' | 'processing' | 'sent' | 'partial' | 'failed' | 'cancelled';

export interface NcAbilities {
  create: boolean; send: boolean; schedule: boolean; edit: boolean; cancel: boolean; urgent: boolean; image: boolean; history: boolean; status: boolean;
}

export interface NcOptions {
  abilities: NcAbilities;
  kind: NotificationPortal;
  categories: NcCategory[];
  channels: ('web' | 'push')[];
  staff_types: { id: string; label: string; subordinates: string[] }[];
  partners: { id: string; name: string }[];
  limits: { title: number; body: number; image_mb: number };
}

export interface NcRecipient {
  id: string;
  name: string;
  email: string | null;
  detail: string;
}

export interface NcAudience {
  category: NcCategory;
  mode: 'all' | 'selected' | 'filter';
  ids?: string[];
  partner_ids?: string[];
  staff_types?: string[];
  include_subordinates?: boolean;
}

export interface NcBroadcast {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  priority: 'normal' | 'urgent';
  channels: ('web' | 'push')[];
  category: NcCategory;
  audience: NcAudience;
  status: NcStatus;
  is_scheduled: boolean;
  send_at: string;
  timezone: string | null;
  sent_at: string | null;
  created_at: string;
  creator_name: string | null;
  recipient_count: number;
  web_sent: number;
  web_failed: number;
  push_sent: number;
  push_failed: number;
  push_no_device: number;
  error: string | null;
  deliveries?: { user_id: string; name: string | null; email: string | null; web_status: string | null; push_status: string | null; push_devices: number; error: string | null }[];
}

export interface NcPageMeta {
  page: number; limit: number; total: number; totalPages: number; hasMore: boolean;
}

export interface NcCreateInput {
  title: string;
  body: string;
  priority: 'normal' | 'urgent';
  channels: string[];
  audience: NcAudience;
  schedule?: { at: string; timezone: string } | null;
  image?: { name: string; dataUrl: string } | null;
}

@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  private api = inject(ApiService);

  private base(portal: NotificationPortal): string {
    return portal === 'admin' ? '/admin/notification-center' : '/partner/notification-center';
  }

  options(portal: NotificationPortal): Observable<NcOptions> {
    return this.api.get<NcOptions>(`${this.base(portal)}/options`);
  }

  recipients(portal: NotificationPortal, params: Record<string, string | number | boolean | null | undefined>): Observable<{ items: NcRecipient[]; meta: NcPageMeta }> {
    return this.api.list<NcRecipient, NcPageMeta>(`${this.base(portal)}/recipients`, params).pipe(map((r) => ({ items: r.items, meta: r.meta as unknown as NcPageMeta })));
  }

  list(portal: NotificationPortal, params: Record<string, string | number | boolean | null | undefined>): Observable<{ items: NcBroadcast[]; meta: NcPageMeta }> {
    return this.api.list<NcBroadcast, NcPageMeta>(this.base(portal), params).pipe(map((r) => ({ items: r.items, meta: r.meta as unknown as NcPageMeta })));
  }

  get(portal: NotificationPortal, id: string, params: Record<string, string | number | boolean | null | undefined> = {}): Observable<NcBroadcast> {
    return this.api.get<NcBroadcast>(`${this.base(portal)}/${encodeURIComponent(id)}`, params);
  }

  create(portal: NotificationPortal, body: NcCreateInput): Observable<{ data: { id: string; status: string }; message: string }> {
    return this.api.postWithMessage<{ id: string; status: string }>(this.base(portal), body);
  }

  update(portal: NotificationPortal, id: string, body: Partial<NcCreateInput> & { remove_image?: boolean }): Observable<NcBroadcast> {
    return this.api.patch<NcBroadcast>(`${this.base(portal)}/${encodeURIComponent(id)}`, body);
  }

  cancel(portal: NotificationPortal, id: string): Observable<NcBroadcast> {
    return this.api.post<NcBroadcast>(`${this.base(portal)}/${encodeURIComponent(id)}/cancel`, {});
  }

  retry(portal: NotificationPortal, id: string): Observable<{ id: string; status: string }> {
    return this.api.post<{ id: string; status: string }>(`${this.base(portal)}/${encodeURIComponent(id)}/retry`, {});
  }
}
