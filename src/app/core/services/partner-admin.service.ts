import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Paged, PartnerRef, Role } from '../models/api.models';
import { ApiService } from './api.service';
import { MasterTeam, TeamMember } from './admin.service';

/**
 * Roles, partners and permissions (migration 0005). See backend/API.md.
 * The server enforces every rule; these methods only carry the data.
 */

export type PermissionAction = 'view' | 'create' | 'update';

/** One row of the permission catalogue; permission ids are `<module id>.<action>`. */
export interface PermissionModule {
  id: string;
  label: string;
  description: string;
  actions: PermissionAction[];
}

/** Which portal's endpoints the users panel talks to. */
export type PartnerUsersApi = { kind: 'partner' } | { kind: 'admin'; partnerId: string };

/** GET /partner/access */
export interface PartnerAccess {
  role: Role;
  partner_id: string | null;
  partner: PartnerRef | null;
  partner_role: 'owner' | 'member' | null;
  /** Effective permissions of the caller. */
  permissions: string[];
  modules: PermissionModule[];
  /** Permissions the caller may hand to a new user. */
  delegable: string[];
}

export interface PartnerOwnerSummary {
  full_name: string | null;
  email: string;
  is_active: boolean;
}

/** A partner row as stored. */
export interface PartnerRecord {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  permissions: string[];
  is_default: boolean;
  created_at: string;
}

/** GET /admin/partners row. */
export interface PartnerListRow extends PartnerRecord {
  owner: PartnerOwnerSummary | null;
  users_count: number;
  active_orders: number;
  in_production: number;
}

/** A partner login (owner or member). */
export interface PartnerUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  job_title: string | null;
  staff_type: StaffType | null;
  partner_id: string;
  partner_role: 'owner' | 'member';
  /** Stored permissions (the server shows the effective list only for the signed-in person). */
  permissions: string[];
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  is_owner: boolean;
  is_me: boolean;
}

/** Create / reset results: the temporary password is returned this once and never again. */
export interface UserCredential {
  user: PartnerUser;
  temporaryPassword: string;
}

export interface PartnerStats {
  activeMasters: number;
  activeTailors: number;
  dailyCapacity: number;
  currentLoadPct: number;
  inProduction: number;
  activeOrders: number;
  payoutThisMonthPkr: number;
  payoutPaidThisMonthPkr: number;
}

/** GET /admin/partners/:id */
export interface PartnerDetail {
  partner: PartnerRecord;
  owner: PartnerUser | null;
  stats: PartnerStats;
  masters: MasterTeam[];
  unassignedTailors: TeamMember[];
  modules: PermissionModule[];
}

export interface PartnerCreateInput {
  name: string;
  permissions: string[];
  is_default?: boolean;
  owner: { email: string; full_name: string; phone?: string; job_title?: string; password?: string };
}

export interface PartnerCreateResult {
  partner: PartnerRecord;
  owner: PartnerUser;
  temporaryPassword: string;
}

export interface PartnerPatch {
  name?: string;
  status?: 'active' | 'inactive';
  permissions?: string[];
  is_default?: true;
}

export interface PartnerListParams {
  search?: string;
  status?: 'active' | 'inactive' | null;
  page?: number;
  limit?: number;
}

export interface UserListParams {
  search?: string;
  page?: number;
  limit?: number;
}

export type StaffType = 'master' | 'tailor' | 'staff';

export interface UserCreateInput {
  email: string;
  staff_type?: StaffType;
  full_name: string;
  phone?: string;
  job_title?: string;
  permissions: string[];
  /** Leave out to let the server generate a temporary password. */
  password?: string;
}

export interface UserPatch {
  staff_type?: StaffType;
  full_name?: string;
  phone?: string;
  job_title?: string;
  permissions?: string[];
  is_active?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PartnerAdminService {
  private api = inject(ApiService);

  // ── Catalogue & own access ──

  /** GET /admin/permissions (admin only). */
  getPermissionCatalogue(): Observable<PermissionModule[]> {
    return this.api.get<{ modules: PermissionModule[] }>('/admin/permissions').pipe(map((d) => d.modules));
  }

  /** GET /partner/access: who the caller is in the hierarchy and what they may hand out. */
  getAccess(): Observable<PartnerAccess> {
    return this.api.get<PartnerAccess>('/partner/access');
  }

  // ── Partners (admin) ──

  listPartners(params: PartnerListParams = {}): Observable<Paged<PartnerListRow, { modules: PermissionModule[] }>> {
    return this.api.list<PartnerListRow, { modules: PermissionModule[] }>('/admin/partners', { limit: 50, ...params });
  }

  getPartner(id: string): Observable<PartnerDetail> {
    return this.api.get<PartnerDetail>(`/admin/partners/${encodeURIComponent(id)}`);
  }

  /** Creates the partner and its owner login; the owner's temporary password comes back once. */
  createPartner(body: PartnerCreateInput): Observable<PartnerCreateResult> {
    return this.api.post<PartnerCreateResult>('/admin/partners', body);
  }

  /** Shrinking `permissions` also removes those modules from the partner's users (server side). */
  updatePartner(id: string, patch: PartnerPatch): Observable<PartnerRecord> {
    return this.api.patch<PartnerRecord>(`/admin/partners/${encodeURIComponent(id)}`, patch);
  }

  // ── A partner's users: same shapes under both bases ──

  listUsers(api: PartnerUsersApi, params: UserListParams = {}): Observable<Paged<PartnerUser>> {
    return this.api.list<PartnerUser>(usersBase(api), { ...params });
  }

  createUser(api: PartnerUsersApi, body: UserCreateInput): Observable<UserCredential> {
    return this.api.post<UserCredential>(usersBase(api), body);
  }

  updateUser(api: PartnerUsersApi, userId: string, patch: UserPatch): Observable<PartnerUser> {
    return this.api.patch<PartnerUser>(`${usersBase(api)}/${encodeURIComponent(userId)}`, patch);
  }

  resetPassword(api: PartnerUsersApi, userId: string): Observable<UserCredential> {
    return this.api.post<UserCredential>(`${usersBase(api)}/${encodeURIComponent(userId)}/reset-password`);
  }

  /** Switches the login off (history stays). */
  deactivateUser(api: PartnerUsersApi, userId: string): Observable<PartnerUser> {
    return this.api.delete<PartnerUser>(`${usersBase(api)}/${encodeURIComponent(userId)}`);
  }
}

function usersBase(api: PartnerUsersApi): string {
  return api.kind === 'admin' ? `/admin/partners/${encodeURIComponent(api.partnerId)}/users` : '/partner/users';
}
