import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from '../models/api.models';
import { AuthService } from '../services/auth.service';

/** Any signed-in user. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/**
 * Signed-in user with one of the given roles.
 * Customers are logged out with a message. A login that still has a temporary password must choose its own first.
 */
export const roleGuard = (...roles: Role[]): CanActivateFn => (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  const role = auth.role();
  if (auth.mustChangePassword()) return router.createUrlTree(['/change-password']);
  if (role && roles.includes(role)) return true;
  if (role === 'customer') {
    auth.logout({ redirect: false });
    return router.createUrlTree(['/login'], { queryParams: { reason: 'customer' } });
  }
  // e.g. a partner user opening an admin page
  return router.createUrlTree(['/forbidden']);
};

/**
 * Route data `permission` (one id, or a list where any one is enough): the page is only for people who hold it.
 * Hiding the menu entry is not enough, so a typed-in URL is stopped here (and every API call is checked again on the server).
 */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const wanted = route.data['permission'] as string | string[] | undefined;
  if (!wanted) return true;
  const list = Array.isArray(wanted) ? wanted : [wanted];
  return auth.canAny(...list) ? true : router.createUrlTree(['/forbidden']);
};

export const adminGuard = roleGuard('admin');
export const partnerGuard = roleGuard('partner_staff', 'admin');

/** Login page: send signed-in staff straight to their portal. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated() && auth.role() !== 'customer') return router.createUrlTree([auth.homeUrl()]);
  return true;
};

/** The "choose your own password" screen: only for a signed-in login that still has a temporary password. */
export const passwordChangeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  return auth.mustChangePassword() ? true : router.createUrlTree([auth.homeUrl()]);
};
