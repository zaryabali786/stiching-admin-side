import { Component } from '@angular/core';
import { NotificationCenterComponent } from '../../../shared/components/notification-center/notification-center.component';

/** Admin > Notification Center: write a notification and send or schedule it to clients, staff or partners. */
@Component({
  selector: 'app-admin-notification-center-page',
  standalone: true,
  imports: [NotificationCenterComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Communication</span>
          <h1>Notification Center</h1>
          <p class="subtitle">Send web and push notifications to clients, staff or partners now, or schedule them for later.</p>
        </div>
      </header>
      <app-notification-center portal="admin" />
    </div>
  `,
})
export class AdminNotificationCenterPage {}
