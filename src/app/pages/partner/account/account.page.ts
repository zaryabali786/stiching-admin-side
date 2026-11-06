import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { DayPipe } from '../../../shared/pipes';
import { DeleteAccountDialogComponent } from '../../../shared/components/delete-account-dialog.component';

/** My account: who you are, and (at the bottom) "Delete my account". Open to every signed-in staff member. */
@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [DayPipe, DeleteAccountDialogComponent],
  styles: [`
    .stack { display: grid; gap: 16px; max-width: 640px; }
    .danger-text { color: var(--c-red, #c0392b); }
    .row-end { display: flex; justify-content: flex-end; margin-top: 14px; }
  `],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">{{ auth.partner()?.name || 'Your account' }}</span>
          <h1>My account</h1>
          <p class="subtitle">Your details, and how to delete your account.</p>
        </div>
      </header>

      @if (auth.user(); as u) {
        <div class="stack">
          <section class="card">
            <h3 class="card-title">Your profile</h3>
            <dl class="kv">
              <dt>Name</dt><dd>{{ u.full_name || '—' }}</dd>
              <dt>Email</dt><dd>{{ u.email }}</dd>
              <dt>Phone</dt><dd>{{ u.phone || '—' }}</dd>
              <dt>Role</dt><dd><span class="badge">{{ auth.roleLabel() }}</span></dd>
              @if (auth.partner(); as pt) { <dt>Partner</dt><dd>{{ pt.name }}</dd> }
              @if (u.job_title) { <dt>Job title</dt><dd>{{ u.job_title }}</dd> }
              <dt>Member since</dt><dd>{{ u.created_at | day }}</dd>
            </dl>
          </section>

          <section class="card">
            <h3 class="card-title danger-text">Delete account</h3>
            <p class="muted small">
              Permanently delete your login and personal details (name, email, phone, address, notifications).
              Work records you handled, such as orders and notes, are kept and shown as "Deleted account". This cannot be undone.
              You confirm with your password, or with Apple or Google if you signed in that way.
            </p>
            <div class="row-end">
              <button type="button" class="btn btn-danger" (click)="deleteOpen.set(true)">Delete my account</button>
            </div>
          </section>
        </div>
      }
      @if (deleteOpen()) { <app-delete-account-dialog (closed)="deleteOpen.set(false)" /> }
    </div>
  `,
})
export class AccountPage {
  readonly auth = inject(AuthService);
  readonly deleteOpen = signal(false);
}
