import { inject } from '@angular/core';
import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { adminGuard, adminModuleGuard, authGuard, guestGuard, partnerGuard, passwordChangeGuard, permissionGuard } from './core/guards/auth.guard';
import { AuthService } from './core/services/auth.service';
import { PortalShellComponent } from './layout/portal-shell.component';

/** Send people to the right place: their portal when signed in, otherwise the login page. */
const homeRedirect = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? auth.homeUrl() : '/login';
};

/** messages and messages/:orderId share one route so the inbox stays mounted while a conversation opens. */
const messagesMatcher = (segments: UrlSegment[]): UrlMatchResult | null =>
  segments[0]?.path === 'messages' && segments.length <= 2
    ? { consumed: segments, posParams: segments[1] ? { orderId: segments[1] } : {} }
    : null;

const messagesRoute = (portal: 'Admin' | 'Partner') => ({
  matcher: messagesMatcher,
  canActivate: [permissionGuard],
  data: { title: 'Messages', permission: 'messages.view', adminModule: 'messages' },
  title: `Messages · ${portal}`,
  loadComponent: () => import('./pages/partner/messages/messages.page').then((m) => m.MessagesPage),
});

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: homeRedirect },

  // ── Auth ──
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Log in · V360',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'reset-password',
    title: 'Choose a new password · V360',
    loadComponent: () => import('./pages/reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'change-password',
    canActivate: [passwordChangeGuard],
    title: 'Choose your password · V360',
    loadComponent: () => import('./pages/change-password/change-password.page').then((m) => m.ChangePasswordPage),
  },
  {
    path: 'forbidden',
    canActivate: [authGuard],
    title: 'No access · V360',
    loadComponent: () => import('./pages/forbidden/forbidden.page').then((m) => m.ForbiddenPage),
  },

  // ── Admin portal (persistent shell; only the page area changes) ──
  {
    path: 'admin',
    component: PortalShellComponent,
    canActivate: [adminGuard],
    canActivateChild: [adminGuard, adminModuleGuard],
    data: { portal: 'admin' },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', data: { adminModule: 'overview', title: 'Overview' }, title: 'Overview · Admin', loadComponent: () => import('./pages/admin/overview/overview.page').then((m) => m.AdminOverviewPage) },
      { path: 'orders', data: { adminModule: 'orders', title: 'Orders' }, title: 'Orders · Admin', loadComponent: () => import('./pages/admin/orders/orders.page').then((m) => m.AdminOrdersPage) },
      { path: 'invoices', data: { adminModule: 'invoices', title: 'Invoices' }, title: 'Invoices · Admin', loadComponent: () => import('./pages/admin/invoices/invoices.page').then((m) => m.AdminInvoicesPage) },
      { path: 'warehouse', data: { adminModule: 'warehouse', title: 'Warehouse' }, title: 'Warehouse · Admin', loadComponent: () => import('./pages/admin/warehouse/warehouse.page').then((m) => m.AdminWarehousePage) },
      { path: 'customers', data: { adminModule: 'customers', title: 'Customers' }, title: 'Customers · Admin', loadComponent: () => import('./pages/admin/customers/customers.page').then((m) => m.AdminCustomersPage) },
      { path: 'partners', data: { adminModule: 'partners', title: 'Partners and teams' }, title: 'Partners · Admin', loadComponent: () => import('./pages/admin/partners/partners.page').then((m) => m.AdminPartnersPage) },
      { path: 'price-list', data: { adminModule: 'price_list', title: 'Price list' }, title: 'Price list · Admin', loadComponent: () => import('./pages/admin/price-list/price-list.page').then((m) => m.AdminPriceListPage) },
      { path: 'shipping', data: { adminModule: 'shipping', title: 'Shipping rates' }, title: 'Shipping rates · Admin', loadComponent: () => import('./pages/admin/shipping/shipping.page').then((m) => m.AdminShippingPage) },
      { path: 'home-layout', data: { adminModule: 'app_builder', title: 'App builder', mode: 'layout' }, title: 'App builder · Admin', loadComponent: () => import('./pages/admin/home-layout/home-layout.page').then((m) => m.AdminHomeLayoutPage) },
      { path: 'appearance', pathMatch: 'full', redirectTo: 'theme' },
      { path: 'theme', data: { adminModule: 'app_builder', title: 'Customize', mode: 'appearance' }, title: 'Customize · Admin', loadComponent: () => import('./pages/admin/home-layout/home-layout.page').then((m) => m.AdminHomeLayoutPage) },
      { path: 'banners', pathMatch: 'full', redirectTo: 'home-layout' },
      { path: 'portal-theme', data: { adminModule: 'portal_theme', title: 'Portal theme' }, title: 'Portal theme · Admin', loadComponent: () => import('./pages/admin/portal-theme/portal-theme.page').then((m) => m.AdminPortalThemePage) },
      { path: 'reports', data: { adminModule: 'reports', title: 'Reports' }, title: 'Reports · Admin', loadComponent: () => import('./pages/admin/reports/reports.page').then((m) => m.AdminReportsPage) },
      messagesRoute('Admin'),
      { path: 'support', data: { adminModule: 'support', title: 'Support chat' }, title: 'Support chat · Admin', loadComponent: () => import('./pages/admin/support/support.page').then((m) => m.AdminSupportPage) },
      { path: 'users', data: { title: 'Users' }, title: 'Users · Admin', loadComponent: () => import('./pages/admin/users/users.page').then((m) => m.AdminUsersPage) },
      { path: 'roles', data: { title: 'Roles and permissions' }, title: 'Roles · Admin', loadComponent: () => import('./pages/admin/roles/roles.page').then((m) => m.AdminRolesPage) },
      { path: 'settings', data: { adminModule: 'settings', title: 'Settings' }, title: 'Settings · Admin', loadComponent: () => import('./pages/admin/settings/settings.page').then((m) => m.AdminSettingsPage) },
      { path: 'shopify', data: { adminModule: 'settings', title: 'Shopify stores' }, title: 'Shopify · Admin', loadComponent: () => import('./pages/admin/shopify/shopify.page').then((m) => m.AdminShopifyPage) },
    ],
  },

  // ── Partner portal ──
  {
    path: 'partner',
    component: PortalShellComponent,
    canActivate: [partnerGuard],
    canActivateChild: [partnerGuard],
    data: { portal: 'partner' },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { canActivate: [permissionGuard], path: 'overview', data: { permission: 'overview.view', title: 'Overview' }, title: 'Overview · Partner', loadComponent: () => import('./pages/partner/overview/overview.page').then((m) => m.PartnerOverviewPage) },
      { canActivate: [permissionGuard], path: 'receiving', data: { permission: 'receiving.view', title: 'Receiving' }, title: 'Receiving · Partner', loadComponent: () => import('./pages/partner/receiving/receiving.page').then((m) => m.PartnerReceivingPage) },
      { canActivate: [permissionGuard], path: 'teams', data: { permission: 'teams.view', title: 'Teams' }, title: 'Teams · Partner', loadComponent: () => import('./pages/partner/teams/teams.page').then((m) => m.PartnerTeamsPage) },
      { canActivate: [permissionGuard], path: 'master-tracking', data: { permission: 'production.view', title: 'Master tracking' }, title: 'Master tracking · Partner', loadComponent: () => import('./pages/partner/master-tracking/master-tracking.page').then((m) => m.MasterTrackingPage) },
      { canActivate: [permissionGuard], path: 'production', data: { permission: 'production.view', title: 'Production' }, title: 'Production · Partner', loadComponent: () => import('./pages/partner/production/production.page').then((m) => m.PartnerProductionPage) },
      { canActivate: [permissionGuard], path: 'production/jobs/:id', data: { permission: 'production.view', title: 'Job card' }, title: 'Job card · Partner', loadComponent: () => import('./pages/partner/job-detail/job-detail.page').then((m) => m.PartnerJobDetailPage) },
      { canActivate: [permissionGuard], path: 'quality-check', data: { permission: 'quality.view', title: 'Quality check' }, title: 'Quality check · Partner', loadComponent: () => import('./pages/partner/quality-check/quality-check.page').then((m) => m.PartnerQualityCheckPage) },
      { canActivate: [permissionGuard], path: 'warehouse', data: { permission: 'warehouse.view', title: 'Warehouse' }, title: 'Warehouse · Partner', loadComponent: () => import('./pages/partner/warehouse/warehouse.page').then((m) => m.PartnerWarehousePage) },
      { canActivate: [permissionGuard], path: 'orders', data: { permission: 'overview.view', title: 'All orders' }, title: 'All orders · Partner', loadComponent: () => import('./pages/partner/orders/orders.page').then((m) => m.PartnerOrdersPage) },
      { canActivate: [permissionGuard], path: 'earnings', data: { permission: 'earnings.view', title: 'Earnings' }, title: 'Earnings · Partner', loadComponent: () => import('./pages/partner/earnings/earnings.page').then((m) => m.PartnerEarningsPage) },
      messagesRoute('Partner'),
      { canActivate: [permissionGuard], path: 'brands', data: { permission: 'catalogue.view', title: 'Brands', kind: 'brands' }, title: 'Brands · Partner', loadComponent: () => import('./pages/partner/catalogue/lookup-list.page').then((m) => m.PartnerLookupListPage) },
      { canActivate: [permissionGuard], path: 'couriers', data: { permission: 'catalogue.view', title: 'Couriers', kind: 'couriers' }, title: 'Couriers · Partner', loadComponent: () => import('./pages/partner/catalogue/lookup-list.page').then((m) => m.PartnerLookupListPage) },
      { canActivate: [permissionGuard], path: 'users', data: { permission: 'users.view', title: 'Users' }, title: 'Users · Partner', loadComponent: () => import('./pages/partner/users/users.page').then((m) => m.PartnerUsersPage) },
      { canActivate: [permissionGuard], path: 'roles', data: { permission: 'users.view', title: 'Roles and permissions' }, title: 'Roles · Partner', loadComponent: () => import('./pages/partner/roles/roles.page').then((m) => m.PartnerRolesPage) },
      { path: 'settings', pathMatch: 'full', redirectTo: 'users' },
      { canActivate: [permissionGuard], path: 'articles', data: { permission: 'catalogue.view', title: 'Articles' }, title: 'Articles · Partner', loadComponent: () => import('./pages/partner/catalogue/articles.page').then((m) => m.PartnerArticlesPage) },
    ],
  },

  { path: '**', redirectTo: homeRedirect },
];
