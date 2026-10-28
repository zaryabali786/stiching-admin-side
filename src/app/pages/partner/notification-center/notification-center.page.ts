import { Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationCenterComponent } from '../../../shared/components/notification-center/notification-center.component';

/** Partner > Notification Center: notify your own staff (never clients, other partners or another partner's staff). */
@Component({
  selector: 'app-partner-notification-center-page',
  standalone: true,
  imports: [NotificationCenterComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">{{ auth.partner()?.name || 'Notifications' }}</span>
          <h1>Notification Center</h1>
          <p class="subtitle">Send web and push notifications to your own staff, now or at a time you choose.</p>
        </div>
      </header>
      <app-notification-center portal="partner" />
    </div>
  `,
})
export class PartnerNotificationCenterPage {
  readonly auth = inject(AuthService);
}
