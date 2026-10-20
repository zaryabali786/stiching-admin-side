import { bootstrapApplication } from '@angular/platform-browser';
import { inject, provideAppInitializer } from '@angular/core';
import { provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules, withRouterConfig } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideIonicAngular } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { LiveUpdate } from '@capawesome/capacitor-live-update';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { authInterceptor } from './app/core/interceptors/auth.interceptor';
import { AuthService } from './app/core/services/auth.service';

// Live updates: confirm this bundle booted fine, then fetch any newer one in the background.
if (Capacitor.isNativePlatform()) {
  LiveUpdate.ready()
    .then(() => LiveUpdate.sync())
    .catch((err) => console.error('Live update failed', err));
}

bootstrapApplication(AppComponent, {
  providers: [
    // Ionic is used for icons/spinners only; routing uses the plain Angular router so layouts stay mounted.
    provideIonicAngular({ mode: 'md' }),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(
      routes,
      withPreloading(PreloadAllModules),
      withComponentInputBinding(),
      withRouterConfig({ paramsInheritanceStrategy: 'always' })
    ),
    // Refresh the signed-in user's profile (role may have changed) before the first navigation.
    provideAppInitializer(() => inject(AuthService).init()),
  ],
});
