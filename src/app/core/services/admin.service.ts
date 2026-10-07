import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiService, toParams } from './api.service';
import { VoiceNote } from '../models/chat.models';
import { ApprovalStatus } from '../utils/approval';
import { ApiEnvelope, ListParams, OrderStatus, Paged, Profile } from '../models/api.models';

/* ═══════════════════════════════════════════════════════════════════════════
   Shapes returned by the /admin API (see backend/API.md)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Result of a write that should show the API's own success message. */
export interface ApiResult<T> {
  data: T;
  message: string;
}

// ── Overview ──
export type OverviewPeriod = 'this_week' | 'this_month' | '6_months';

export interface NeedsActionItem {
  id: string;
  code: string;
  title: string;
  subtext: string;
  actionType: 'INVOICE' | 'RECEIVE' | 'OPEN';
  link: string;
  queryParams: Record<string, string> | null;
}

export interface AdminOverview {
  period: OverviewPeriod;
  ordersInPeriod: number;
  internationalOrders: number;
  inProduction: number;
  waitingForInvoice: number;
  awaitingPayment: number;
  awaitingPaymentPkr: number;
  delayedOrders: number;
  ordersPerMonth: { month: string; key: string; international: number; pakistan: number; intlPct: number; pkPct: number }[];
  whereOrdersShip: { country: string; count: number; pct: number }[];
  ordersByStatus: { key: string; status: string; count: number; pct: number }[];
  needsAction: NeedsActionItem[];
}

// ── Orders ──
export type OrderGroup = 'all' | 'awaiting_parcel' | 'production' | 'invoice' | 'payment' | 'warehouse' | 'shipped' | 'issues' | 'cancelled';
export type OrderCounts = Partial<Record<OrderGroup, number>>;

/** The partner an order is made by. */
export interface PartnerChip {
  id: string;
  name: string;
}

export interface AdminOrderRow {
  id: string;
  reference: string;
  partner?: PartnerChip | null;
  brand: string | null;
  status: OrderStatus;
  status_label: string;
  has_issue: boolean;
  priority: 'normal' | 'rush';
  customer_name: string | null;
  customer_code: string | null;
  destination_city: string | null;
  destination_country: string | null;
  due_date: string | null;
  created_at: string;
  units_count: number;
}

export interface PartnerOption {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  is_default?: boolean;
}

export interface MediaRef {
  url: string;
  type?: string;
  name?: string;
}

/** The order's own copy of the customer's size chart (inches). */
export interface UnitSizeChart {
  id: string;
  name: string | null;
  person_name: string | null;
  variation: string | null;
  nearest_size: 'XS' | 'S' | 'M' | 'L' | 'XL' | null;
  measurements: Record<string, number | null> | null;
  notes: string | null;
  notes_audio?: VoiceNote | null;
  fit_feedback?: string | null;
}

/** One chosen article on a piece (type + article are admin-managed data). `customer_price` / `partner_cost` are internal, admins only. */
export interface SelectedArticle {
  article_type_id: string;
  type_name: string;
  article_id: string;
  name: string;
  image_url: string | null;
  customer_price?: number | null;
  partner_cost?: number | null;
}

export interface OrderUnit {
  id: string;
  order_id: string;
  line_no: number;
  unit_title: string;
  stitching_type: string | null;
  size_chart_id: string | null;
  size_chart?: UnitSizeChart | null;
  product_link: string | null;
  unit_price?: number | null;
  currency?: string | null;
  product_image_url?: string | null;
  notes: string | null;
  notes_audio?: VoiceNote | null;
  quantity: number;
  design: Record<string, string | null> | null;
  selected_articles?: SelectedArticle[] | null;
  approval?: UnitApproval | null;
  reference_images: MediaRef[] | null;
  status: 'pending' | 'received' | 'issue';
  issue_type: string | null;
  issue_note: string | null;
  issue_audio?: VoiceNote | null;
  issue_media: MediaRef[] | null;
  received_at: string | null;
}

export interface OrderEvent {
  id: string;
  status: string;
  note: string | null;
  created_at: string;
}

export type InvoiceLineKind = 'stitching' | 'accessory' | 'accessory_stitching' | 'shipping' | 'duties' | 'discount' | 'other';

export interface InvoiceLine {
  id?: string;
  kind: InvoiceLineKind;
  label: string;
  description: string | null;
  quantity: number;
  customer_amount: number;
  partner_amount: number;
  sort_order?: number;
  price_item_id?: string | null;
  unit_id?: string | null;
}

export interface Invoice {
  id: string;
  order_id?: string;
  number: string | null;
  status: 'draft' | 'issued' | 'paid' | 'void';
  currency: string;
  fx_rate: number;
  subtotal_pkr: number;
  discount_pkr: number;
  total_pkr: number;
  total_foreign: number;
  partner_total_pkr: number;
  notes: string | null;
  issued_at: string | null;
  paid_at: string | null;
  created_at?: string;
  lines?: InvoiceLine[];
}

export type ShipmentStatus = 'needs_label' | 'labelled' | 'handed_to_courier' | 'delivered';

export interface Shipment {
  id: string;
  order_id: string;
  shipped_from: 'admin_warehouse' | 'partner';
  status: ShipmentStatus;
  shipping_rate_id?: string | null;
  courier: string | null;
  service: string | null;
  tracking_number: string | null;
  rate_pkr: number | null;
  weight_kg: number | null;
  dimensions: string | null;
  label_printed_at: string | null;
  handed_at: string | null;
  delivered_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount_pkr: number;
  amount_foreign: number | null;
  currency: string;
  method: 'card' | 'bank_transfer' | 'manual';
  provider_ref: string | null;
  status: string;
  created_at: string;
}

/** A piece's own customer approval. */
export interface UnitApproval {
  status: ApprovalStatus;
  photos?: MediaRef[] | null;
  requested_at?: string | null;
  decided_at?: string | null;
  change_request?: string | null;
  change_request_audio?: VoiceNote | null;
}

export interface OrderCard {
  id: string;
  unit_id?: string;
  approval_status?: ApprovalStatus;
  approval_photos?: MediaRef[] | null;
  change_request?: string | null;
  change_request_audio?: VoiceNote | null;
  /** Raw production stage. Stays 'packed' once the article has left production: do not show it as the article's status. */
  stage: string;
  /** What to show for this article: the production stage while it is being made, then the order's own progress (shipped, delivered...). */
  display_status?: string | null;
  display_label?: string | null;
  unit_title: string | null;
  qc_passed: boolean | null;
  due_date: string | null;
  master: { name: string } | null;
  tailor: { name: string } | null;
}

export interface AdminOrderDetail {
  id: string;
  reference: string;
  customer_id: string;
  partner?: PartnerChip | null;
  customer_name: string | null;
  customer_code: string | null;
  brand: string | null;
  brand_order_number: string | null;
  import_source?: 'manual' | 'invoice' | 'link' | 'email';
  brand_order_total?: number | null;
  brand_order_currency?: string | null;
  /** Brand invoice the customer uploaded/forwarded (private; url is short-lived). */
  brand_invoice?: { name: string; type: string; url: string | null } | null;
  tracking_number: string | null;
  brand_id?: string | null;
  brand_ref?: { id: string; name: string } | null;
  courier_id?: string | null;
  courier?: { id: string; name: string; requires_tracking: boolean } | null;
  international_shipping?: boolean | null;
  status: OrderStatus;
  status_label: string;
  has_issue: boolean;
  customer_notes: string | null;
  admin_notes: string | null;
  destination_country: string | null;
  destination_city: string | null;
  destination_address: string | null;
  shipping_service: string | null;
  priority: 'normal' | 'rush';
  due_date: string | null;
  weight_kg: number | null;
  partner_route: string | null;
  change_request: string | null;
  change_request_audio?: VoiceNote | null;
  approval_photos: MediaRef[] | null;
  received_at: string | null;
  packed_at: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null; customer_code: string | null; country: string | null; city: string | null; address: string | null } | null;
  units: OrderUnit[];
  events: OrderEvent[];
  invoice: Invoice | null;
  shipment: Shipment | null;
  payments: Payment[];
  cards: OrderCard[];
  transfer: { id: string; code: string; status: string } | null;
}

export interface OrderUpdate {
  status?: OrderStatus;
  note?: string;
  notifyCustomer?: boolean;
  admin_notes?: string;
  due_date?: string | null;
  priority?: 'normal' | 'rush';
  has_issue?: boolean;
}

// ── Customers & users ──
export interface AdminCustomerRow {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  customer_code: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  created_at: string;
  is_active: boolean;
  total_orders: number;
  active_orders: number;
  total_spent_pkr: number;
  last_order_at: string | null;
}

export interface AdminCustomerDetail extends Profile {
  orders: { id: string; reference: string; brand: string | null; status: OrderStatus; status_label: string; created_at: string; units_count: number }[];
  size_charts: { id: string; name: string; person_name?: string | null; variation?: string | null; nearest_size?: string | null; updated_at: string | null }[];
}

export type UserRoleFilter = 'staff' | 'admin' | 'partner_staff' | 'customer';
export type AdminUser = Pick<Profile, 'id' | 'full_name' | 'email' | 'phone' | 'role' | 'customer_code' | 'is_active' | 'created_at' | 'partner_role' | 'job_title'> & {
  /** Set for partner users (managed under Partners, not here). */
  partner?: PartnerChip | null;
};

// ── Partners ──
export interface TeamMember {
  id: string;
  name: string;
  role: 'master' | 'tailor';
  master_id: string | null;
  daily_capacity: number;
  is_active: boolean;
  assigned: number;
  load_pct: number;
  load_status: 'free' | 'busy' | 'full';
}

export interface MasterTeam extends TeamMember {
  tailors: TeamMember[];
  team_assigned: number;
  team_capacity: number;
  team_load_pct: number;
}

export interface AdminPartners {
  partner: {
    name: string;
    city: string;
    activeMasters: number;
    activeTailors: number;
    dailyCapacity: number;
    currentLoadPct: number;
    inProduction: number;
    payoutThisMonthPkr: number;
    payoutPaidThisMonthPkr: number;
  };
  masters: MasterTeam[];
  unassignedTailors: TeamMember[];
  staff: { id: string; full_name: string | null; email: string; phone: string | null; is_active: boolean; created_at: string }[];
}

// ── Reports ──
export interface AdminReports {
  months: number;
  totals: {
    revenuePkr: number;
    partnerPayoutPkr: number;
    marginPkr: number;
    marginPct: number;
    discountsPkr: number;
    paidInvoices: number;
    orders: number;
    cancelled: number;
    avgTurnaroundDays: number | null;
  };
  monthly: { key: string; month: string; revenue: number; payout: number; margin: number; orders: number; pct: number }[];
  byChargeType: { kind: string; customer: number; partner: number; margin: number }[];
  topBrands: { name: string; count: number }[];
  topCountries: { name: string; count: number }[];
}

// ── Price list ──
export type PriceCategory = 'stitching' | 'accessory' | 'accessory_stitching' | 'finishing' | 'other';

export interface PriceItem {
  id: string;
  category: PriceCategory;
  name: string;
  unit: string;
  partner_cost: number;
  customer_price: number;
  margin?: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type PriceItemInput = Partial<Pick<PriceItem, 'category' | 'name' | 'unit' | 'partner_cost' | 'customer_price' | 'is_active'>>;

// ── Shipping ──
export interface ShippingRate {
  id: string;
  courier: string;
  zone: string;
  countries: string[];
  service: 'express' | 'standard';
  transit_time: string | null;
  max_weight_kg: number;
  base_rate: number;
  per_extra_kg: number;
  ddp_available: boolean;
  ddp_fee: number;
  is_active: boolean;
  created_at?: string;
}

export interface ShippingOption extends ShippingRate {
  price_pkr: number;
  recommended: boolean;
}

export type ShippingRateInput = Partial<Omit<ShippingRate, 'id' | 'created_at' | 'countries'>> & { countries?: string[] | string };

// ── Invoices ──
export type InvoiceTab = 'to_invoice' | 'issued' | 'paid';

export interface InvoiceOrderSummary {
  id: string;
  reference: string;
  brand: string | null;
  status: OrderStatus;
  customer_name: string | null;
  customer_code: string | null;
  destination_city: string | null;
  destination_country: string | null;
  weight_kg: number | null;
  packed_at: string | null;
  units_count: number;
}

export interface InvoiceListRow {
  order: InvoiceOrderSummary | null;
  invoice: Invoice | null;
}

export interface InvoiceListMeta {
  counts?: Record<InvoiceTab, number>;
  outstandingPkr?: number;
}

export interface InvoiceBuilderData {
  order: AdminOrderDetail & { units: (OrderUnit & { created_at?: string })[] };
  invoice: Invoice | null;
  suggestedLines: InvoiceLine[] | null;
  priceItems: PriceItem[];
  shippingOptions: ShippingOption[];
  currency: string;
  suggestedFxRate: number | null;
}

export interface InvoiceDraft {
  currency: string;
  fx_rate: number;
  notes: string | null;
  lines: InvoiceLine[];
}

// ── Warehouse ──
export interface WarehouseSummary {
  transfersInTransit: number;
  parcelsInTransit: number;
  needsLabel: number;
  readyForCourier: number;
  shippedToday: number;
}

export interface Transfer {
  id: string;
  code: string;
  status: 'open' | 'in_transit' | 'received';
  notes: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  created_at: string;
  orders: { id: string; reference: string; customer_name: string | null; customer_code: string | null; destination_city: string | null; destination_country: string | null; weight_kg: number | null; status: OrderStatus }[];
}

export interface Parcel extends Shipment {
  order: {
    id: string;
    reference: string;
    customer_id: string;
    customer_name: string | null;
    customer_code: string | null;
    destination_city: string | null;
    destination_country: string | null;
    destination_address: string | null;
    shipping_service: string | null;
    weight_kg: number | null;
    paid_at: string | null;
    status: OrderStatus;
  } | null;
}

export interface LabelInput {
  /** A shipping rate (its own courier is used), or a courier from the managed list. */
  shipping_rate_id?: string | null;
  courier_id?: string;
  tracking_number: string;
  rate_pkr?: number | null;
  dimensions?: string | null;
  weight_kg?: number | null;
}

export interface PlatformConfig {
  name: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToCity?: string;
  shipToPhone?: string;
  partnerName?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Labels (UI vocabulary, not data)
   ═══════════════════════════════════════════════════════════════════════════ */

export const ORDER_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'submitted', label: 'Submitted · awaiting parcel' },
  { value: 'received', label: 'Parcel received' },
  { value: 'assigned', label: 'Assigned to a team' },
  { value: 'cutting', label: 'Cutting' },
  { value: 'stitching', label: 'Stitching' },
  { value: 'qc_passed', label: 'Quality check passed' },
  { value: 'customer_approval', label: 'Customer approval' },
  { value: 'packed', label: 'Packed' },
  { value: 'invoice_issued', label: 'Invoice issued' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'paid', label: 'Paid' },
  { value: 'at_admin_warehouse', label: 'At dispatch warehouse' },
  { value: 'partner_dispatch', label: 'Dispatching from partner' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * Forward-only order of the statuses. From 'paid' onwards the API refuses to move an order back (409);
 * the order drawer greys those options out. Dispatch from the warehouse or the partner is the same step.
 */
export const ORDER_STATUS_RANK: Record<OrderStatus, number> = {
  submitted: 0, received: 1, assigned: 2, cutting: 3, stitching: 4, qc_passed: 5, customer_approval: 6, packed: 7,
  invoice_issued: 8, awaiting_payment: 9, paid: 10, at_admin_warehouse: 11, partner_dispatch: 11, shipped: 12, delivered: 13,
  cancelled: 99,
};

/** May the admin pick `target` while the order is `current`? Mirrors the server rule so the UI does not offer what it will refuse. */
export function canMoveOrderStatus(current: OrderStatus, target: OrderStatus): boolean {
  if (target === current) return true;
  const paidRank = ORDER_STATUS_RANK.paid;
  if (current === 'cancelled') return false;
  if (target === 'cancelled') return ORDER_STATUS_RANK[current] < ORDER_STATUS_RANK.shipped;
  if (ORDER_STATUS_RANK[current] >= paidRank) return ORDER_STATUS_RANK[target] >= ORDER_STATUS_RANK[current];
  return true;
}

export const LINE_KIND_OPTIONS: { value: InvoiceLineKind; label: string }[] = [
  { value: 'stitching', label: 'Stitching' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'accessory_stitching', label: 'Accessory stitching' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'duties', label: 'Duties' },
  { value: 'discount', label: 'Discount' },
  { value: 'other', label: 'Other' },
];

export const PRICE_CATEGORY_OPTIONS: { value: PriceCategory; label: string }[] = [
  { value: 'stitching', label: 'Stitching' },
  { value: 'accessory', label: 'Accessories' },
  { value: 'accessory_stitching', label: 'Accessory stitching' },
  { value: 'finishing', label: 'Finishing' },
  { value: 'other', label: 'Other' },
];

export const INVOICE_CURRENCIES = ['PKR', 'GBP', 'USD', 'CAD', 'AED', 'SAR', 'AUD', 'EUR'] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   Service
   ═══════════════════════════════════════════════════════════════════════════ */

@Injectable({ providedIn: 'root' })
export class AdminService {
  private api = inject(ApiService);
  private http = inject(HttpClient);

  // ── Overview ──
  getOverview(period: OverviewPeriod): Observable<AdminOverview> {
    return this.api.get<AdminOverview>('/admin/overview', { period });
  }

  getConfig(): Observable<PlatformConfig> {
    return this.api.get<PlatformConfig>('/config');
  }

  // ── Orders ──
  listOrders(params: { group?: OrderGroup; status?: string; partner_id?: string; search?: string; page?: number; limit?: number; sort?: string; dir?: 'asc' | 'desc' }): Observable<Paged<AdminOrderRow, { counts?: OrderCounts }>> {
    return this.api.list<AdminOrderRow, { counts?: OrderCounts }>('/admin/orders', params as ListParams);
  }

  getOrder(id: string): Observable<AdminOrderDetail> {
    return this.api.get<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}`);
  }

  getOrderByRef(reference: string): Observable<AdminOrderDetail> {
    return this.api.get<AdminOrderDetail>(`/admin/orders/by-ref/${encodeURIComponent(reference)}`);
  }

  updateOrder(id: string, patch: OrderUpdate): Observable<ApiResult<AdminOrderDetail>> {
    return this.send<AdminOrderDetail>('PATCH', `/admin/orders/${id}`, patch);
  }

  /** Move an order that has not started production to another partner. */
  assignOrderPartner(id: string, partnerId: string): Observable<ApiResult<unknown>> {
    return this.send<unknown>('POST', `/admin/orders/${id}/partner`, { partner_id: partnerId });
  }

  /** Partners for the order filter and the "assign to partner" picker. */
  listPartnerOptions(): Observable<PartnerOption[]> {
    return this.api.list<PartnerOption>('/admin/partners', { limit: 100 }).pipe(map((r) => r.items));
  }

  resolveUnitIssue(orderId: string, unitId: string, note?: string): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/orders/${orderId}/units/${unitId}/resolve`, note ? { note } : {});
  }

  // ── Customers ──
  listCustomers(params: { search?: string; page?: number; limit?: number; sort?: string; dir?: 'asc' | 'desc' }): Observable<Paged<AdminCustomerRow>> {
    return this.api.list<AdminCustomerRow>('/admin/customers', params as ListParams);
  }

  getCustomer(id: string): Observable<AdminCustomerDetail> {
    return this.api.get<AdminCustomerDetail>(`/admin/customers/${id}`);
  }

  // ── Users & roles ──
  listUsers(params: { role?: UserRoleFilter; search?: string; page?: number; limit?: number }): Observable<Paged<AdminUser>> {
    return this.api.list<AdminUser>('/admin/users', params as ListParams);
  }

  /** Partner users are managed under Partners: only customer / admin can be set here. */
  setUserRole(id: string, role: 'customer' | 'admin'): Observable<ApiResult<Profile>> {
    return this.send<Profile>('PATCH', `/admin/users/${id}/role`, { role });
  }

  setUserActive(id: string, isActive: boolean): Observable<ApiResult<Profile>> {
    return this.send<Profile>('PATCH', `/admin/users/${id}/active`, { is_active: isActive });
  }

  // ── Partners & reports ──
  getPartners(): Observable<AdminPartners> {
    return this.api.get<AdminPartners>('/admin/partners');
  }

  getReports(months: number): Observable<AdminReports> {
    return this.api.get<AdminReports>('/admin/reports', { months });
  }

  // ── Price list ──
  listPriceItems(params: { category?: PriceCategory | ''; active?: boolean; search?: string; page?: number; limit?: number; sort?: string; dir?: 'asc' | 'desc' }): Observable<Paged<PriceItem>> {
    return this.api.list<PriceItem>('/admin/price-items', params as ListParams);
  }

  createPriceItem(body: PriceItemInput): Observable<ApiResult<PriceItem>> {
    return this.send<PriceItem>('POST', '/admin/price-items', body);
  }

  updatePriceItem(id: string, body: PriceItemInput): Observable<ApiResult<PriceItem>> {
    return this.send<PriceItem>('PATCH', `/admin/price-items/${id}`, body);
  }

  deletePriceItem(id: string): Observable<ApiResult<null>> {
    return this.send<null>('DELETE', `/admin/price-items/${id}`);
  }

  // ── Shipping rates ──
  listShippingRates(params: { search?: string; page?: number; limit?: number; active?: boolean; sort?: string; dir?: 'asc' | 'desc' }): Observable<Paged<ShippingRate>> {
    return this.api.list<ShippingRate>('/admin/shipping-rates', params as ListParams);
  }

  createShippingRate(body: ShippingRateInput): Observable<ApiResult<ShippingRate>> {
    return this.send<ShippingRate>('POST', '/admin/shipping-rates', body);
  }

  updateShippingRate(id: string, body: ShippingRateInput): Observable<ApiResult<ShippingRate>> {
    return this.send<ShippingRate>('PATCH', `/admin/shipping-rates/${id}`, body);
  }

  deleteShippingRate(id: string): Observable<ApiResult<null>> {
    return this.send<null>('DELETE', `/admin/shipping-rates/${id}`);
  }

  // ── Invoices ──
  listInvoices(params: { tab?: InvoiceTab; search?: string; page?: number; limit?: number }): Observable<Paged<InvoiceListRow, InvoiceListMeta>> {
    return this.api.list<InvoiceListRow, InvoiceListMeta>('/admin/invoices', params as ListParams);
  }

  getInvoiceBuilder(orderId: string): Observable<InvoiceBuilderData> {
    return this.api.get<InvoiceBuilderData>(`/admin/invoices/builder/${orderId}`);
  }

  saveInvoiceDraft(orderId: string, draft: InvoiceDraft): Observable<ApiResult<Invoice>> {
    return this.send<Invoice>('PUT', `/admin/invoices/builder/${orderId}`, draft);
  }

  issueInvoice(invoiceId: string): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/invoices/${invoiceId}/issue`);
  }

  reopenInvoice(invoiceId: string): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/invoices/${invoiceId}/reopen`);
  }

  markInvoicePaid(invoiceId: string, method: 'bank_transfer' | 'manual', reference: string): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/invoices/${invoiceId}/mark-paid`, { method, reference });
  }

  // ── Warehouse ──
  getWarehouseSummary(): Observable<WarehouseSummary> {
    return this.api.get<WarehouseSummary>('/admin/warehouse/summary');
  }

  listTransfers(params: { status?: 'in_transit' | 'received'; search?: string; page?: number; limit?: number }): Observable<Paged<Transfer>> {
    return this.api.list<Transfer>('/admin/warehouse/transfers', params as ListParams);
  }

  receiveTransfer(id: string): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/warehouse/transfers/${id}/receive`);
  }

  listParcels(params: { status?: ShipmentStatus; search?: string; page?: number; limit?: number }): Observable<Paged<Parcel>> {
    return this.api.list<Parcel>('/admin/warehouse/parcels', params as ListParams);
  }

  getCourierOptions(parcelId: string): Observable<ShippingOption[]> {
    return this.api.get<ShippingOption[]>(`/admin/warehouse/parcels/${parcelId}/courier-options`);
  }

  labelParcel(parcelId: string, body: LabelInput): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/warehouse/parcels/${parcelId}/label`, body);
  }

  markParcelHanded(parcelId: string): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/warehouse/parcels/${parcelId}/handed`);
  }

  markParcelDelivered(parcelId: string): Observable<ApiResult<null>> {
    return this.send<null>('POST', `/admin/warehouse/parcels/${parcelId}/delivered`);
  }

  /** Write request that keeps the envelope's `message` so pages can show it in a toast. */
  private send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, params?: ListParams): Observable<ApiResult<T>> {
    return this.http
      .request<ApiEnvelope<T>>(method, `${this.api.baseUrl}${path}`, { body: method === 'DELETE' ? undefined : body ?? {}, params: toParams(params) })
      .pipe(map((r) => ({ data: r.data, message: r.message })));
  }
}
