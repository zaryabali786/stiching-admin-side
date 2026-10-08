import { DashSize, DashWidget, DashboardData } from '../../../core/services/admin.service';
import { ChartKind, ChartSeries } from '../../../shared/components/chart.component';

export type WidgetCategory = 'Numbers' | 'Charts' | 'Lists';

interface Base {
  type: string;
  title: string;
  description: string;
  category: WidgetCategory;
  icon: string;
  size: DashSize;
}

export interface KpiDef extends Base {
  kind: 'kpi';
  format: 'num' | 'pkr' | 'days' | 'pct';
  value: (d: DashboardData) => number | null;
  sub: (d: DashboardData) => string;
  /** a positive number is good news, unless `lowerIsBetter` */
  change?: (d: DashboardData) => number | null;
  tone?: (d: DashboardData) => 'warn' | 'bad' | '';
  link?: { path: string; query?: Record<string, string> };
}

export interface ChartDef extends Base {
  kind: 'chart';
  chart: ChartKind;
  format?: 'num' | 'pkr';
  data: (d: DashboardData) => { labels: string[]; series: ChartSeries[] };
}

export interface ListDef extends Base {
  kind: 'list';
  list: 'needs_action' | 'recent_orders';
}

export type WidgetDef = KpiDef | ChartDef | ListDef;

const k = (d: DashboardData, key: string) => (d.kpis[key] as number | null) ?? 0;
const pts = (rows: { label: string; value: number }[]) => ({ labels: rows.map((r) => r.label), series: [{ name: 'Value', values: rows.map((r) => r.value) }] });

export const WIDGETS: WidgetDef[] = [
  // ───────── Numbers ─────────
  { kind: 'kpi', type: 'kpi_orders', title: 'Orders', description: 'Orders placed in the period', category: 'Numbers', icon: 'cube-outline', size: 's', format: 'num',
    value: (d) => k(d, 'orders'), sub: (d) => `${k(d, 'international')} international`, change: (d) => d.kpis.ordersChangePct, link: { path: '/admin/orders' } },
  { kind: 'kpi', type: 'kpi_revenue', title: 'Revenue', description: 'Paid invoices in the period', category: 'Numbers', icon: 'cash-outline', size: 's', format: 'pkr',
    value: (d) => k(d, 'revenue'), sub: (d) => `${k(d, 'paidInvoices')} paid invoices`, change: (d) => d.kpis.revenueChangePct, link: { path: '/admin/invoices' } },
  { kind: 'kpi', type: 'kpi_margin', title: 'Margin', description: 'Revenue minus partner payouts', category: 'Numbers', icon: 'trending-up-outline', size: 's', format: 'pkr',
    value: (d) => k(d, 'margin'), sub: (d) => `${k(d, 'marginPct')}% of revenue`, link: { path: '/admin/reports' } },
  { kind: 'kpi', type: 'kpi_payout', title: 'Partner payouts', description: 'What partners are owed for paid invoices', category: 'Numbers', icon: 'wallet-outline', size: 's', format: 'pkr',
    value: (d) => k(d, 'payout'), sub: () => 'for paid invoices', link: { path: '/admin/reports' } },
  { kind: 'kpi', type: 'kpi_aov', title: 'Average order value', description: 'Revenue per paid invoice', category: 'Numbers', icon: 'pricetag-outline', size: 's', format: 'pkr',
    value: (d) => k(d, 'avgOrderValue'), sub: () => 'per paid invoice' },
  { kind: 'kpi', type: 'kpi_new_customers', title: 'New customers', description: 'Sign-ups in the period', category: 'Numbers', icon: 'person-add-outline', size: 's', format: 'num',
    value: (d) => k(d, 'newCustomers'), sub: () => 'joined in this period', link: { path: '/admin/customers' } },
  { kind: 'kpi', type: 'kpi_active_customers', title: 'Active customers', description: 'Customers who ordered in the period', category: 'Numbers', icon: 'people-outline', size: 's', format: 'num',
    value: (d) => k(d, 'activeCustomers'), sub: () => 'placed an order', link: { path: '/admin/customers' } },
  { kind: 'kpi', type: 'kpi_delivered', title: 'Delivered', description: 'Orders delivered in the period', category: 'Numbers', icon: 'checkmark-done-outline', size: 's', format: 'num',
    value: (d) => k(d, 'delivered'), sub: (d) => `${k(d, 'cancelled')} cancelled`, link: { path: '/admin/orders', query: { group: 'shipped' } } },
  { kind: 'kpi', type: 'kpi_in_production', title: 'In production', description: 'Orders at the partner right now', category: 'Numbers', icon: 'construct-outline', size: 's', format: 'num',
    value: (d) => k(d, 'inProduction'), sub: () => 'being stitched', link: { path: '/admin/orders', query: { group: 'production' } } },
  { kind: 'kpi', type: 'kpi_waiting_invoice', title: 'Waiting for invoice', description: 'Packed orders that need an invoice', category: 'Numbers', icon: 'document-text-outline', size: 's', format: 'num',
    value: (d) => k(d, 'waitingForInvoice'), sub: (d) => (k(d, 'waitingForInvoice') ? 'Packed: build the invoice' : 'Nothing waiting'), tone: (d) => (k(d, 'waitingForInvoice') ? 'warn' : ''), link: { path: '/admin/invoices' } },
  { kind: 'kpi', type: 'kpi_awaiting_payment', title: 'Awaiting payment', description: 'Issued invoices not yet paid', category: 'Numbers', icon: 'card-outline', size: 's', format: 'pkr',
    value: (d) => k(d, 'awaitingPaymentPkr'), sub: (d) => `${k(d, 'awaitingPayment')} orders`, link: { path: '/admin/invoices', query: { tab: 'issued' } } },
  { kind: 'kpi', type: 'kpi_delayed', title: 'Delayed', description: 'Orders past their due date', category: 'Numbers', icon: 'time-outline', size: 's', format: 'num',
    value: (d) => k(d, 'delayed'), sub: (d) => (k(d, 'delayed') ? 'Past their due date' : 'Everything on schedule'), tone: (d) => (k(d, 'delayed') ? 'bad' : ''), link: { path: '/admin/orders' } },
  { kind: 'kpi', type: 'kpi_issues', title: 'Open issues', description: 'Orders with a reported problem', category: 'Numbers', icon: 'alert-circle-outline', size: 's', format: 'num',
    value: (d) => k(d, 'openIssues'), sub: (d) => (k(d, 'openIssues') ? 'Contact the customers' : 'No problems reported'), tone: (d) => (k(d, 'openIssues') ? 'bad' : ''), link: { path: '/admin/orders', query: { group: 'issues' } } },
  { kind: 'kpi', type: 'kpi_turnaround', title: 'Average turnaround', description: 'Days from order to shipping', category: 'Numbers', icon: 'speedometer-outline', size: 's', format: 'days',
    value: (d) => d.kpis['avgTurnaroundDays'] ?? null, sub: () => 'order to shipped' },
  { kind: 'kpi', type: 'kpi_international', title: 'International orders', description: 'Orders shipping outside Pakistan', category: 'Numbers', icon: 'earth-outline', size: 's', format: 'num',
    value: (d) => k(d, 'international'), sub: (d) => `${k(d, 'orders') - k(d, 'international')} within Pakistan` },

  // ───────── Charts ─────────
  { kind: 'chart', type: 'chart_orders_trend', title: 'Orders over time', description: 'New orders through the period', category: 'Charts', icon: 'analytics-outline', size: 'm', chart: 'area',
    data: (d) => ({ labels: d.ordersTrend.map((p) => p.label), series: [{ name: 'Orders', values: d.ordersTrend.map((p) => p.value) }] }) },
  { kind: 'chart', type: 'chart_revenue_trend', title: 'Revenue over time', description: 'Paid invoices through the period', category: 'Charts', icon: 'stats-chart-outline', size: 'm', chart: 'area', format: 'pkr',
    data: (d) => ({ labels: d.revenueTrend.map((p) => p.label), series: [{ name: 'Revenue', values: d.revenueTrend.map((p) => p.value) }] }) },
  { kind: 'chart', type: 'chart_orders_month', title: 'Orders per month', description: 'International vs Pakistan, last 6 months', category: 'Charts', icon: 'bar-chart-outline', size: 'm', chart: 'bar',
    data: (d) => ({ labels: d.ordersPerMonth.map((m) => m.month), series: [{ name: 'International', values: d.ordersPerMonth.map((m) => m.international) }, { name: 'Pakistan', values: d.ordersPerMonth.map((m) => m.pakistan) }] }) },
  { kind: 'chart', type: 'chart_signups', title: 'New customers per month', description: 'Sign-ups over the last 6 months', category: 'Charts', icon: 'person-add-outline', size: 'm', chart: 'bar',
    data: (d) => ({ labels: d.signupsPerMonth.map((p) => p.label), series: [{ name: 'New customers', values: d.signupsPerMonth.map((p) => p.value) }] }) },
  { kind: 'chart', type: 'chart_status', title: 'Orders by stage', description: 'Where open orders are right now', category: 'Charts', icon: 'list-outline', size: 'm', chart: 'hbar',
    data: (d) => ({ labels: d.ordersByStatus.map((s) => s.label), series: [{ name: 'Orders', values: d.ordersByStatus.map((s) => s.value) }] }) },
  { kind: 'chart', type: 'chart_status_mix', title: 'Order status mix', description: 'Share of orders by status in the period', category: 'Charts', icon: 'pie-chart-outline', size: 'm', chart: 'donut',
    data: (d) => pts(d.statusMix) },
  { kind: 'chart', type: 'chart_brands', title: 'Top brands', description: 'Brands customers order from most', category: 'Charts', icon: 'storefront-outline', size: 'm', chart: 'hbar',
    data: (d) => pts(d.topBrands) },
  { kind: 'chart', type: 'chart_countries', title: 'Where orders ship', description: 'Top destination countries', category: 'Charts', icon: 'globe-outline', size: 'm', chart: 'hbar',
    data: (d) => pts(d.topCountries) },
  { kind: 'chart', type: 'chart_charges', title: 'Revenue by charge type', description: 'Stitching, shipping, duties and more', category: 'Charts', icon: 'color-filter-outline', size: 'm', chart: 'donut', format: 'pkr',
    data: (d) => pts(d.chargeTypes) },
  { kind: 'chart', type: 'chart_partner_load', title: 'Partner workload', description: 'Open orders at each partner', category: 'Charts', icon: 'business-outline', size: 'm', chart: 'hbar',
    data: (d) => ({ labels: d.partnerLoad.map((p) => p.name), series: [{ name: 'Open orders', values: d.partnerLoad.map((p) => p.value) }] }) },

  // ───────── Lists ─────────
  { kind: 'list', type: 'list_needs_action', title: 'Needs your action', description: 'Invoices to issue, parcels to receive, issues and delays', category: 'Lists', icon: 'flash-outline', size: 'm', list: 'needs_action' },
  { kind: 'list', type: 'list_recent_orders', title: 'Recent orders', description: 'The latest orders placed', category: 'Lists', icon: 'time-outline', size: 'm', list: 'recent_orders' },
];

export const WIDGET_MAP = new Map(WIDGETS.map((w) => [w.type, w]));

const w = (type: string, size?: DashSize): DashWidget => ({ id: `${type}_${Math.random().toString(36).slice(2, 7)}`, type, size: size ?? WIDGET_MAP.get(type)?.size ?? 'm' });

export const newWidget = w;

/** What a dashboard looks like before the admin changes it. */
export const defaultLayout = (): DashWidget[] => [
  w('kpi_orders'), w('kpi_revenue'), w('kpi_awaiting_payment'), w('kpi_delayed'),
  w('chart_orders_trend'), w('chart_revenue_trend'),
  w('list_needs_action'), w('chart_status'),
  w('chart_orders_month'), w('chart_countries'),
  w('kpi_margin'), w('kpi_active_customers'), w('kpi_in_production'), w('kpi_turnaround'),
  w('list_recent_orders', 'xl'),
];

export const SIZE_LABEL: Record<DashSize, string> = { s: 'S', m: 'M', l: 'L', xl: 'Full' };
