import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';
import { ApiService } from './api.service';
import { PartnerAdminService, PermissionModule } from './partner-admin.service';

/** Which portal's roles: the partner's own, or the admin portal's. */
export type RolesPortal = 'partner' | 'admin';

export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  /** `<module>.<action>` (admin portal: `<module>.view|edit|delete`). */
  permissions: string[];
  user_count: number;
  /** The built-in Owner role: it cannot be changed or removed. */
  locked?: boolean;
  updated_at?: string;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

/** One tick in the role editor. */
export interface RoleAction {
  /** The permission id, e.g. 'production.assign'. */
  id: string;
  label: string;
  description?: string;
  /** view = opens the page, detail = one button, full = everything in the module. */
  kind: 'view' | 'detail' | 'basic' | 'full';
}

/** One module in the role editor: its page and the actions inside it. */
export interface RoleModule {
  id: string;
  label: string;
  description: string;
  actions: RoleAction[];
}

export interface RolesBundle {
  roles: RoleRecord[];
  modules: RoleModule[];
}

interface AdminRoles {
  roles: RoleRecord[];
  modules: { id: string; label: string; description: string }[];
  actions: { id: string; label: string; description: string }[];
}

/** The partner catalogue as the editor shows it: View first, each detailed action, then "everything in this module". */
export const partnerRoleModules = (catalogue: PermissionModule[]): RoleModule[] =>
  catalogue.map((m) => {
    const detail = m.detail ?? [];
    const actions: RoleAction[] = [{ id: `${m.id}.view`, label: 'Open the page and view', kind: 'view' }];
    for (const d of detail) actions.push({ id: `${m.id}.${d.id}`, label: d.label, description: d.description, kind: 'detail' });
    if (m.actions.includes('create')) actions.push({ id: `${m.id}.create`, label: 'Create', kind: 'basic' });
    if (m.actions.includes('update')) {
      actions.push(
        detail.length
          ? { id: `${m.id}.update`, label: 'Full control (every action above)', kind: 'full' }
          : { id: `${m.id}.update`, label: m.id === 'users' ? 'Edit, reset password, switch off' : 'Make changes', kind: 'basic' },
      );
    }
    return { id: m.id, label: m.label, description: m.description, actions };
  });

@Injectable({ providedIn: 'root' })
export class RolesApiService {
  private api = inject(ApiService);
  private partners = inject(PartnerAdminService);

  private base(portal: RolesPortal): string {
    return portal === 'admin' ? '/admin/roles' : '/partner/roles';
  }

  /** The roles and the catalogue to build them from. */
  load(portal: RolesPortal): Observable<RolesBundle> {
    if (portal === 'admin') {
      return this.api.get<AdminRoles>('/admin/roles').pipe(
        map((d) => ({
          roles: d.roles,
          modules: d.modules.map((m) => ({
            ...m,
            actions: d.actions.map((a): RoleAction => ({ id: `${m.id}.${a.id}`, label: a.label, description: a.description, kind: a.id === 'view' ? 'view' : 'detail' })),
          })),
        })),
      );
    }
    return forkJoin({ roles: this.api.get<RoleRecord[]>('/partner/roles'), access: this.partners.getAccess() }).pipe(
      map(({ roles, access }) => ({ roles, modules: partnerRoleModules(access.modules) })),
    );
  }

  /** Just the roles (for the user form). */
  list(portal: RolesPortal): Observable<RoleRecord[]> {
    return portal === 'admin' ? this.api.get<AdminRoles>('/admin/roles').pipe(map((d) => d.roles)) : this.api.get<RoleRecord[]>('/partner/roles');
  }

  create(portal: RolesPortal, body: RoleInput): Observable<RoleRecord> {
    return this.api.post<RoleRecord>(this.base(portal), body);
  }

  update(portal: RolesPortal, id: string, body: Partial<RoleInput>): Observable<RoleRecord> {
    return this.api.patch<RoleRecord>(`${this.base(portal)}/${encodeURIComponent(id)}`, body);
  }

  remove(portal: RolesPortal, id: string): Observable<unknown> {
    return this.api.delete<unknown>(`${this.base(portal)}/${encodeURIComponent(id)}`);
  }
}
