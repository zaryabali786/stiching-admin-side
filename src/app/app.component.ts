import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PortalThemeService } from './core/services/portal-theme.service';
import { NotificationsOffComponent } from './shared/components/notifications-off.component';
import { PushService } from './core/services/push.service';
import { installGalleryPermissionPrompt } from './core/services/native-permissions';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [RouterOutlet, NotificationsOffComponent],
})
export class AppComponent {
  constructor() {
    // phone app: the gallery is asked the first time a photo or video is picked
    installGalleryPermissionPrompt();
    // apply the admin's portal theme (sidebar, buttons, page colours) for every portal user
    inject(PortalThemeService).load();
    // registers this device for push notifications while a staff member is signed in
    inject(PushService);
  }
}
