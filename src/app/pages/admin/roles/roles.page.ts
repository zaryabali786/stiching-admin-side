import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RolesManagerComponent } from '../../../shared/components/roles-manager/roles-manager.component';

/** Admin > Roles and permissions: what each role may view, create / edit and delete in every module of the admin portal. */
@Component({
  selector: 'app-admin-roles-page',
  standalone: true,
  imports: [RouterLink, RolesManagerComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Admin portal</span>
          <h1>Roles and permissions</h1>
          <p class="subtitle">Create roles and choose, for every module, whether the role may view, create and edit, or delete. Then give the roles to admin users.</p>
        </div>
        <div class="actions"><a routerLink="/admin/users" class="btn btn-ghost">Users</a></div>
      </header>
      <app-roles-manager portal="admin" />
    </div>
  `,
})
export class AdminRolesPage {}
