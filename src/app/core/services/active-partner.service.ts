import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { PartnerAdminService, PartnerListRow } from './partner-admin.service';

const STORAGE_KEY = 'v360_active_partner';

/**
 * Admin partner switcher. While an admin has a partner selected, every API call carries `X-Partner-Id` (see the auth
 * interceptor) and the server limits orders, invoices, warehouse, reports, users and teams to that partner. Choosing
 * "All partners" removes the header. The server ignores the header for anyone who is not an admin.
 */
@Injectable({ providedIn: 'root' })
export class ActivePartnerService {
  private auth = inject(AuthService);
  private partnersApi = inject(PartnerAdminService);
  private router = inject(Router);

  readonly partners = signal<PartnerListRow[]>([]);
  private readonly selected = signal<string | null>(read());

  /** The partner id sent to the server: only ever set for an admin. */
  readonly partnerId = computed(() => (this.auth.isAdmin() ? this.selected() : null));
  readonly partner = computed(() => this.partners().find((p) => p.id === this.partnerId()) ?? null);

  /** Load the partners an admin can switch between (and drop a selection that no longer exists). */
  load(): void {
    if (!this.auth.isAdmin()) return;
    this.partnersApi.listPartners({ limit: 100 }).subscribe({
      next: (res) => {
        this.partners.set(res.items);
        const id = this.selected();
        if (id && !res.items.some((p) => p.id === id)) this.set(null, false);
      },
      error: () => undefined,
    });
  }

  /** Switch partner (or null for all) and reload the page the admin is on so nothing from the old partner stays on screen. */
  select(id: string | null): void {
    if (id === this.selected()) return;
    this.set(id, true);
  }

  private set(id: string | null, reload: boolean): void {
    this.selected.set(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (!reload) return;
    const url = this.router.url;
    void this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => this.router.navigateByUrl(url));
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
