import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PortalThemeService } from './core/services/portal-theme.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [RouterOutlet],
})
export class AppComponent {
  constructor() {
    // apply the admin's portal theme (sidebar, buttons, page colours) for every portal user
    inject(PortalThemeService).load();
  }
}
