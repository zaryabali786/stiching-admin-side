import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PortalThemeService } from './core/services/portal-theme.service';
import { PushService } from './core/services/push.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [RouterOutlet],
})
export class AppComponent {
  constructor() {
    // apply the admin's portal theme (sidebar, buttons, page colours) for every portal user
    inject(PortalThemeService).load();
    // registers this device for push notifications while a staff member is signed in
    inject(PushService);
  }
}
