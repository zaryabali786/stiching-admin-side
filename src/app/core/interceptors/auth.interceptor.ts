import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ActivePartnerService } from '../services/active-partner.service';
import { AuthService } from '../services/auth.service';

const PUBLIC_AUTH = /\/auth\/(login|register|refresh|forgot-password)$/;

const withToken = (req: HttpRequest<unknown>, token: string | null, partnerId: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}`, ...(partnerId && { 'X-Partner-Id': partnerId }) } }) : req;

/**
 * Attaches the Bearer token to API calls. On a 401 it refreshes the session once
 * (shared between concurrent requests) and retries; if that fails the user is logged out.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl) || PUBLIC_AUTH.test(req.url) || req.url.endsWith('/auth/logout')) {
    return next(req);
  }

  const auth = inject(AuthService);
  const router = inject(Router);
  const partnerId = inject(ActivePartnerService).partnerId();
  return next(withToken(req, auth.accessToken(), partnerId)).pipe(
    catchError((err: unknown) => {
      // the server refuses staff pages until a temporary password has been replaced
      if (err instanceof HttpErrorResponse && err.status === 403 && err.error?.code === 'PASSWORD_CHANGE_REQUIRED') {
        void auth.loadMe().catch(() => undefined).finally(() => router.navigate(['/change-password']));
        return throwError(() => err);
      }
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      if (!auth.refreshToken()) {
        auth.logout({ reason: 'expired' });
        return throwError(() => err);
      }
      return auth.refreshTokens().pipe(
        switchMap((tokens) => next(withToken(req, tokens.accessToken, partnerId))),
        catchError((refreshErr) => {
          auth.logout({ reason: 'expired' });
          return throwError(() => refreshErr);
        })
      );
    })
  );
};
