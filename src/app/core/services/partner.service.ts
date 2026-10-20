import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AudioRef, VoiceNote } from '../models/chat.models';
import { ApprovalStatus } from '../utils/approval';
import { ApiService } from './api.service';
import { ListParams, OrderStatus, Paged } from '../models/api.models';

/* ══════════════════════════════════════════════════════════════════════════
   Partner portal API (see backend/API.md → "Partner").
   No data lives here — every method is a typed call to /api/partner/*.
   ══════════════════════════════════════════════════════════════════════════ */

// ───────────────────────────── Shared shapes ─────────────────────────────

export interface MediaItem {
  url: string;
  type: 'image' | 'video' | string;
  name?: string;
  path?: string;
}

/** File payload accepted by upload endpoints. */
export interface UploadFile {
  name: string;
  dataUrl: string;
}

export interface Measurements {
  shoulder?: number | null;
  bust?: number | null;
  waist?: number | null;
  hip?: number | null;
  armhole?: number | null;
  sleeve?: number | null;
  shirt_length?: number | null;
  trouser_length?: number | null;
  bottom_opening?: number | null;
  shalwar_gheer?: number | null;
  neck_depth?: number | null;
  [key: string]: number | string | null | undefined;
}

export interface MemberRef {
  id: string;
  name: string;
}

// ───────────────────────────── Overview ─────────────────────────────

export type OverviewRange = 'today' | '14days' | '30days';

export interface PartnerOverview {
  range: OverviewRange;
  inProduction: number;
  dueToday: number;
  rushDueToday: number;
  delayed: number;
  onTimeRate: number | null;
  inWarehouse: number;
  awaitingPayment: number;
  earningsThisMonth: number;
  dailyCapacity: number;
  capacityPct: number | null;
  dailyFinished: { date: string; day: string; count: number; pct: number; isToday: boolean; isPeak: boolean }[];
  workByStage: { stage: JobStage; count: number; pct: number }[];
  teamLoad: { id: string; name: string; pct: number; load_pct: number; assigned: number; capacity: number }[];
  tailorOutput: { id: string; name: string; count: number; pct: number }[];
}

// ───────────────────────────── Receiving ─────────────────────────────

export type ReceivingTab = 'expected' | 'issues' | 'return_requested' | 'ready_return' | 'handed_over' | 'returns' | 'hold' | 'recent';
export type IssueType = 'piece_missing' | 'damaged' | 'wrong_item' | 'other';

export interface ReceivingUnit {
  id: string;
  /** Permanent article code (<order reference>-<n>); also the QR code. */
  code: string | null;
  /** Photos / video of this article taken when it was received. */
  receive_media?: MediaItem[] | null;
  /** Weight of this article in kg, entered in Receiving (the invoice's shipping weight is the total of these). */
  weight_kg?: number | null;
  /** Product picture read from the brand's order email (or the product page). */
  product_image_url?: string | null;
  /** The customer's decision on the received article. */
  review_status?: 'none' | 'pending' | 'approved' | 'rejected';
  review_note?: string | null;
  review_media?: MediaItem[] | null;
  /** none | requested (the customer wants it sent back) | sent_back | resubmitted */
  return_status?: 'none' | 'requested' | 'sent_back' | 'resubmitted' | 'held' | 'returned';
  /** The courier shipment of this returned article (CN, status, tracking events). */
  return_shipment?: ReturnShipmentInfo | null;
  /** The return order of this article once it was sent to the Warehouse (or to the admin). */
  return_order?: { id: string; reference: string; status: string; status_label: string; destination: 'customer' | 'admin' | null } | null;
  held_at?: string | null;
  /** The partner confirmed the corrected article (a hold). */
  hold_received_at?: string | null;
  /** The customer approved the corrected article: the hold is resolved. */
  hold_resolved_at?: string | null;
  /** Where the customer wants the returned article posted to. */
  return_shipping?: { name: string; phone: string; address: string; city: string; country: string } | null;
  /** Where the rejected article goes back to. */
  return_to?: 'brand' | 'customer' | null;
  return_note?: string | null;
  return_courier?: string | null;
  return_tracking?: string | null;
  resubmit_count?: number;
  line_no: number;
  unit_title: string;
  stitching_type: string | null;
  notes: string | null;
  notes_audio?: VoiceNote | null;
  quantity: number;
  status: 'pending' | 'received' | 'issue';
  issue_type: IssueType | null;
  issue_note: string | null;
  issue_audio?: VoiceNote | null;
  issue_media: MediaItem[] | null;
  received_at: string | null;
  design: Record<string, string> | null;
  created_at: string;
}

/** An order waiting for its parcel at ANOTHER partner (a parcel that reached the wrong place). */
export interface ElsewhereOrder {
  id: string;
  reference: string;
  customer_code: string | null;
  customer_name: string | null;
  tracking_number: string | null;
  partner: {
    id: string;
    name: string;
    short_code: string | null;
    city: string | null;
    receiving_name: string | null;
    receiving_address: string | null;
    receiving_city: string | null;
    receiving_phone: string | null;
  } | null;
}

/** One return parcel with the courier: booked (CN) > handed over (loadsheet) > in transit > delivered. */
export interface ReturnShipmentInfo {
  id: string;
  courier_name: string;
  cn_number: string;
  status: 'booked' | 'handed_over' | 'in_transit' | 'delivered';
  status_label: string;
  booking_source: 'manual' | 'api';
  booked_at: string;
  handed_over_at: string | null;
  delivered_at: string | null;
  events: { status: string; note: string | null; source: 'manual' | 'webhook' | 'system'; occurred_at: string }[];
}

export interface ReceivingOrder {
  id: string;
  /** COD orders: whether the customer has paid. */
  cod?: CodSummary;
  /** The group this row shows: the normal order, or its hold / return / resolved articles. */
  group?: 'main' | 'hold' | 'return' | 'resolved';
  /** <reference>, <reference>-HOLD, <reference>-RETURN or <reference>-RESOLVED. */
  group_reference?: string;
  original_reference?: string;
  row_key?: string;
  /** The partner (and address) the customer was told to send the parcel to. */
  partner?: { name: string; short_code: string | null; receiving_name: string | null; receiving_address: string | null; receiving_city: string | null } | null;
  reference: string;
  brand: string | null;
  brand_order_number: string | null;
  tracking_number: string | null;
  status: OrderStatus;
  status_label: string;
  has_issue: boolean;
  customer_name: string | null;
  customer_code: string | null;
  destination_city: string | null;
  destination_country: string | null;
  /** The delivery address and phone the customer gave for this order. */
  destination_address?: string | null;
  destination_phone?: string | null;
  priority: 'normal' | 'rush';
  express_stitching?: boolean;
  express_days?: number | null;
  express_shipping?: boolean;
  express_shipping_days?: number | null;
  due_date: string | null;
  customer_notes: string | null;
  created_at: string;
  received_at: string | null;
  /** 'email' = bought direct from a website (a draft made from the customer's inbox). */
  import_source?: string | null;
  /** Where the order came from: website, customer (their own parcel) or email. */
  order_source?: 'website' | 'customer' | 'email';
  details_completed_at?: string | null;
  /** Photos / video of the whole parcel, shown to the customer. */
  parcel_media?: MediaItem[] | null;
  parcel_received_at?: string | null;
  parcel_review?: 'none' | 'pending' | 'approved';
  units: ReceivingUnit[];
}

export interface Suggestion {
  master: { id: string; name: string; assigned: number; load_pct: number } | null;
  tailor: { id: string; name: string; assigned: number; load_pct: number } | null;
}

export interface ReceivingMeta {
  counts: Record<ReceivingTab, number>;
  suggestion: Suggestion | null;
}

export interface UnmatchedParcel {
  id: string;
  label_text: string | null;
  brand: string | null;
  tracking_number: string | null;
  notes: string | null;
  status: 'open' | 'matched' | 'returned';
  matched_order_id: string | null;
  created_at: string;
}

export interface UnmatchedParcelInput {
  label_text?: string;
  brand?: string;
  tracking_number?: string;
  notes?: string;
}

// ───────────────────────────── Teams ─────────────────────────────

export interface TeamMember {
  id: string;
  name: string;
  /** master / tailor take cutting and stitching; qa, pressing and packing receive their own stage. */
  role: 'master' | 'tailor' | 'qa' | 'pressing' | 'packing';
  master_id: string | null;
  daily_capacity: number;
  is_active: boolean;
  assigned: number;
  load_pct: number;
  load_status: 'free' | 'busy' | 'full';
  /** The person's own login, if they have one. */
  login?: { id: string; email: string; is_active: boolean; staff_type: string | null; permissions: string[]; must_change_password: boolean } | null;
}

export interface MasterTeam extends TeamMember {
  tailors: TeamMember[];
  team_assigned: number;
  team_capacity: number;
  team_load_pct: number;
}

export interface TeamsResponse {
  masters: MasterTeam[];
  unassignedTailors: TeamMember[];
  members: TeamMember[];
}

/** Login created together with a team member (POST /partner/teams/members) or afterwards (POST .../:id/login). */
export interface TeamLoginInput {
  /** Required when creating a login; when editing, leave it out to keep the current one. */
  email?: string;
  password?: string;
  permissions: string[];
}

export interface TeamLoginCredential {
  email: string;
  temporaryPassword: string;
}

export interface TeamMemberInput {
  login?: TeamLoginInput;
  /** The user (added on the Users page) this team member is; null unlinks. */
  user_id?: string | null;
  name?: string;
  role?: 'master' | 'tailor' | 'qa' | 'pressing' | 'packing';
  daily_capacity?: number;
  master_id?: string | null;
  is_active?: boolean;
}

// ───────────────────────────── Job cards (production / QC) ─────────────────────────────

export type JobStage = 'to_assign' | 'cutting' | 'stitching' | 'qc' | 'pressing' | 'packed';

export interface JobCard {
  id: string;
  order_id: string;
  unit_id: string;
  stage: JobStage;
  /** Shown instead of the raw stage once the article has left production (e.g. Shipped). */
  display_status?: string | null;
  display_label?: string | null;
  position: number;
  master_id: string | null;
  tailor_id: string | null;
  master: MemberRef | null;
  tailor: MemberRef | null;
  priority: 'normal' | 'rush';
  due_date: string | null;
  order_reference: string;
  customer_code: string | null;
  unit_title: string;
  qc_passed: boolean;
  qc_notes: string | null;
  qc_notes_audio?: VoiceNote | null;
  /** This ticket's own customer approval (each article is approved on its own). */
  approval_status?: ApprovalStatus;
  approval_photos?: MediaItem[] | null;
  approval_requested_at?: string | null;
  approval_decided_at?: string | null;
  change_request?: string | null;
  change_request_audio?: VoiceNote | null;
  qc_checklist: Record<string, boolean | string> | null;
  cutting_at: string | null;
  stitching_at: string | null;
  qc_at: string | null;
  packed_at: string | null;
  created_at: string;
  comments_count: number;
  is_delayed: boolean;
  days_late: number;
  status: 'on_time' | 'rush' | 'delayed';
  unit: {
    id: string;
    unit_title: string;
    stitching_type: string | null;
    notes: string | null;
    notes_audio?: VoiceNote | null;
    product_link: string | null;
    quantity: number;
    design: Record<string, string> | null;
    reference_images: MediaItem[] | null;
    received_at: string | null;
    size_chart: {
      id: string;
      name: string | null;
      person_name: string | null;
      variation: string | null;
      nearest_size?: string | null;
      measurements: Measurements | null;
      fit_feedback: string | null;
      notes: string | null;
      notes_audio?: VoiceNote | null;
    } | null;
  } | null;
  order: {
    id: string;
    reference: string;
    brand: string | null;
    customer_id: string;
    customer_name: string | null;
    customer_code: string | null;
    destination_country: string | null;
    destination_city: string | null;
    status: OrderStatus;
    priority: 'normal' | 'rush';
    due_date: string | null;
    received_at: string | null;
    paid_at: string | null;
    change_request: string | null;
    change_request_audio?: VoiceNote | null;
    customer_notes: string | null;
    approval_photos: MediaItem[] | null;
    created_at: string;
  } | null;
}

export type QcStatus = 'pending' | 'passed';

export interface QcMeta {
  counts: Record<QcStatus, number>;
}

// ───────────────────────────── Warehouse ─────────────────────────────

export type WarehouseTab = 'to_invoice' | 'awaiting_payment' | 'paid' | 'ready_dispatch' | 'dispatched' | 'delivered' | 'failed_delivery';

/** The courier shipment of a dispatched order: CN, loadsheet, handover, tracking. */
export interface DispatchShipment {
  id: string;
  status: 'needs_label' | 'booked' | 'labelled' | 'handed_to_courier' | 'in_transit' | 'delivered' | 'failed_delivery' | 'returning_to_partner' | 'returned_to_partner' | 'handed_over';
  courier: string | null;
  tracking_number: string | null;
  shipped_from: string;
  booking_source?: 'manual' | 'api';
  booked_at?: string | null;
  handed_at?: string | null;
  delivered_at?: string | null;
  failure_reason?: string | null;
  failed_at?: string | null;
  return_started_at?: string | null;
  returned_at?: string | null;
  proof?: { receiver?: string; note?: string; url?: string } | null;
  loadsheet_id?: string | null;
  events?: { status: string; note: string | null; source: 'manual' | 'webhook' | 'system'; occurred_at: string }[];
}
export type DispatchRoute = 'admin_warehouse' | 'direct_dispatch';
export interface BulkBookResult {
  results: { order_id: string; reference: string; ok: boolean; message: string; cn?: string }[];
  done: number;
  failed: number;
}

export interface WarehouseOrder {
  id: string;
  /** 'return' = the return of one rejected article, handled here like any parcel. */
  order_kind?: 'order' | 'return';
  return_destination?: 'customer' | 'admin' | null;
  return_unit?: { id: string; unit_title: string; code: string | null } | null;
  reference: string;
  brand: string | null;
  status: OrderStatus;
  status_label: string;
  customer_name: string | null;
  customer_code: string | null;
  destination_city: string | null;
  destination_country: string | null;
  destination_address: string | null;
  destination_phone?: string | null;
  shipping_service: 'express' | 'standard' | null;
  weight_kg: number | null;
  partner_route: DispatchRoute | null;
  packed_at: string | null;
  paid_at: string | null;
  created_at: string;
  units_count: number;
  invoice: {
    id: string;
    number: string;
    status: 'draft' | 'issued' | 'paid';
    issued_at: string | null;
    total_pkr: number | null;
    currency: string | null;
    total_foreign: number | null;
    /** Only kind + label: the shipping line is named "<courier> · <zone>" (the item chosen when the invoice was built). */
    lines?: { kind: string; label: string }[];
  } | null;
  transfer: { id: string; code: string; status: TransferStatus } | null;
  shipment: DispatchShipment | null;
}

export interface WarehouseMeta {
  counts: Record<WarehouseTab, number>;
}

export type TransferStatus = 'open' | 'in_transit' | 'received';

export interface Transfer {
  id: string;
  code: string;
  status: TransferStatus;
  dispatched_at: string | null;
  received_at?: string | null;
  created_at: string;
  orders: {
    id: string;
    reference: string;
    customer_name: string | null;
    customer_code: string | null;
    destination_country: string | null;
    weight_kg: number | null;
    status: OrderStatus;
  }[];
}

// ───────────────────────────── Earnings ─────────────────────────────

export interface EarningsSummary {
  thisMonth: number;
  pending: number;
  lastSixMonths: number;
  lifetime: number;
  articlesThisMonth: number;
  monthly: { key: string; month: string; amount: number; pct: number }[];
}

export interface PartnerOrderRow {
  id: string;
  reference: string;
  brand: string | null;
  /** The brand's logo (null when none was uploaded). */
  brand_logo_url?: string | null;
  created_at: string;
  due_date: string | null;
  customer_name: string | null;
  customer_code: string | null;
  order_kind?: 'order' | 'return';
  /** Number of articles. */
  articles: number;
  /** Where the articles are now, e.g. "2 Stitching · 1 Packed". */
  current_status: string;
  /** The order's own status. */
  parent_status: OrderStatus;
  parent_status_label: string;
}

/** One order in the partner's side panel: the workshop's view only (no customer phone / email, no admin or money fields). */
export interface PartnerOrderDetail {
  id: string;
  reference: string;
  order_kind?: 'order' | 'return';
  status: OrderStatus;
  status_label: string;
  created_at: string;
  due_date: string | null;
  brand: { name: string | null; logo_url: string | null; order_number: string | null };
  customer: { name: string | null; code: string | null };
  delivery: { address: string | null; city: string | null; country: string | null };
  notes: string | null;
  express: { stitching: number | null; shipping: number | null; rush: boolean };
  units: {
    id: string;
    code: string | null;
    line_no: number;
    title: string;
    quantity: number;
    image_url: string | null;
    stitching_type: string | null;
    notes: string | null;
    size: { name: string | null; person: string | null; nearest: string | null; measurements: Record<string, unknown> } | null;
    customizations: { type: string | null; name: string | null; image_url: string | null }[];
  }[];
  timeline: { id: string; status: string; label: string; note: string | null; at: string }[];
  /** The partner's own share: earned once the customer paid, pending until then, unavailable until an invoice is issued. */
  earnings: { state: 'earned' | 'pending' | 'unavailable'; amount_pkr: number | null };
}

export interface EarningRow {
  id: string;
  number: string;
  status: 'issued' | 'paid';
  issued_at: string | null;
  paid_at: string | null;
  partner_total_pkr: number;
  order: { id: string; reference: string; customer_name: string | null; customer_code: string | null; units_count: number } | null;
}

// ══════════════════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class PartnerService {
  private api = inject(ApiService);
  private readonly base = '/partner';

  // Overview
  overview(range: OverviewRange): Observable<PartnerOverview> {
    return this.api.get<PartnerOverview>(`${this.base}/overview`, { range });
  }

  // Receiving
  receiving(params: { tab: ReceivingTab; search?: string; page?: number; limit?: number }): Observable<Paged<ReceivingOrder, ReceivingMeta>> {
    return this.api.list<ReceivingOrder, ReceivingMeta>(`${this.base}/receiving`, params as ListParams);
  }

  /** Orders waiting for their parcel at other partners that match what was typed (customer code, reference or tracking). */
  findElsewhere(q: string): Observable<ElsewhereOrder[]> {
    return this.api.get<ElsewhereOrder[]>(`${this.base}/receiving/elsewhere`, { q });
  }

  forwardParcel(orderId: string) {
    return this.api.postWithMessage<{ id: string; reference: string; forwarded_to: string }>(`${this.base}/receiving/orders/${orderId}/forward`);
  }

  receiveUnit(unitId: string, media?: UploadFile[], weightKg?: number | null) {
    const body = { ...(media?.length ? { media } : {}), ...(weightKg ? { weight_kg: weightKg } : {}) };
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/units/${unitId}/receive`, Object.keys(body).length ? body : undefined);
  }

  /** Add or correct one article's weight (kg). */
  setUnitWeight(unitId: string, weightKg: number) {
    return this.api.postWithMessage<{ weight_kg: number; order_weight_kg: number | null }>(`${this.base}/receiving/units/${unitId}/weight`, { weight_kg: weightKg });
  }

  /** The rejected article was sent back to the customer. Receive the corrected one with "Receive parcel". */
  /** Book the courier CN of a returned article (the courier's own consignment number). */
  bookReturnCn(unitId: string, body: { courier_id: string; cn_number?: string; manual?: boolean }) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/units/${unitId}/return/book`, body);
  }

  /** Couriers that can be booked through their API for returns (PostEx), and whether the server has it set up. */
  returnApiCouriers() {
    return this.api.get<{ name: string; configured: boolean; ok: boolean | null; message: string | null }[]>(`${this.base}/receiving/couriers/api`);
  }

  refreshReturnTracking(shipmentId: string) {
    return this.api.postWithMessage<{ applied: number }>(`${this.base}/receiving/returns/${shipmentId}/refresh-tracking`);
  }

  /** Send to Admin or Return Directly to Customer: the returned article enters the Warehouse workflow. */
  routeReturn(unitId: string, destination: 'customer' | 'admin') {
    return this.api.postWithMessage<{ id: string; reference: string; status: string }>(`${this.base}/receiving/units/${unitId}/return/route`, { destination });
  }

  cancelReturnBooking(unitId: string) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/units/${unitId}/return/cancel`);
  }

  /** Make the loadsheet of the selected booked parcels. Nothing is handed over until the file was downloaded and confirmed. */
  createLoadsheet(shipmentIds: string[]) {
    return this.api.postWithMessage<{ id: string; number: string; courier_name: string; count: number }>(`${this.base}/receiving/returns/loadsheet`, { shipment_ids: shipmentIds });
  }

  downloadLoadsheet(id: string) {
    return this.api.getBlob(`${this.base}/receiving/returns/loadsheets/${id}/download`);
  }

  confirmLoadsheetHandover(id: string) {
    return this.api.postWithMessage<{ count: number; number: string }>(`${this.base}/receiving/returns/loadsheets/${id}/handed-over`);
  }

  /** A person enters what the courier's tracking shows (for couriers that do not report to us). */
  updateReturnTracking(shipmentId: string, body: { status: 'in_transit' | 'delivered'; note?: string }) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/returns/${shipmentId}/tracking`, body);
  }

  /** A hold: the corrected article arrived. The customer reviews it; the hold resolves once they approve. */
  receiveCorrected(unitId: string, body: { note?: string; media?: UploadFile[] }) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/units/${unitId}/receive-corrected`, body);
  }

  sendArticleBack(unitId: string, body: { courier?: string; tracking?: string }) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/units/${unitId}/sent-back`, body);
  }

  addParcelMedia(orderId: string, media: UploadFile[]) {
    return this.api.postWithMessage<{ parcel_media: MediaItem[] }>(`${this.base}/receiving/orders/${orderId}/parcel-media`, { media });
  }

  reportIssue(unitId: string, body: { issue_type: IssueType; note?: string; notes_audio?: AudioRef; media?: UploadFile[]; weight_kg?: number }) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/units/${unitId}/issue`, body);
  }

  receiveAll(orderId: string) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/orders/${orderId}/receive-all`);
  }

  unmatched(params: { page?: number; limit?: number; search?: string; status?: 'open' | 'all' } = {}): Observable<Paged<UnmatchedParcel>> {
    return this.api.list<UnmatchedParcel>(`${this.base}/receiving/unmatched`, params as ListParams);
  }

  logUnmatched(body: UnmatchedParcelInput) {
    return this.api.postWithMessage<UnmatchedParcel>(`${this.base}/receiving/unmatched`, body);
  }

  updateUnmatched(id: string, body: { status?: UnmatchedParcel['status']; matched_order_id?: string | null; notes?: string }) {
    return this.api.patch<UnmatchedParcel>(`${this.base}/receiving/unmatched/${id}`, body);
  }

  // Teams
  teams(includeInactive = false): Observable<TeamsResponse> {
    return this.api.get<TeamsResponse>(`${this.base}/teams`, includeInactive ? { includeInactive: true } : undefined);
  }

  addMember(body: TeamMemberInput) {
    return this.api.postWithMessage<TeamMember & { credential?: TeamLoginCredential }>(`${this.base}/teams/members`, body);
  }

  /** Users that can still be linked to a team member (plus the one `memberId` has now). */
  linkableUsers(memberId: string | null): Observable<{ id: string; full_name: string | null; email: string; job_title: string | null }[]> {
    return this.api.get<{ id: string; full_name: string | null; email: string; job_title: string | null }[]>(`${this.base}/teams/users`, memberId ? { member_id: memberId } : undefined);
  }

  addMemberLogin(id: string, body: TeamLoginInput) {
    return this.api.postWithMessage<{ member_id: string; credential: TeamLoginCredential }>(`${this.base}/teams/members/${id}/login`, body);
  }

  updateMember(id: string, body: TeamMemberInput): Observable<TeamMember> {
    return this.api.patch<TeamMember>(`${this.base}/teams/members/${id}`, body);
  }

  removeMember(id: string): Observable<null> {
    return this.api.delete<null>(`${this.base}/teams/members/${id}`);
  }

  // Quality check
  qcQueue(params: { status: QcStatus; search?: string; page?: number; limit?: number }): Observable<Paged<JobCard, QcMeta>> {
    return this.api.list<JobCard, QcMeta>(`${this.base}/qc`, params as ListParams);
  }

  passQc(cardId: string, notes?: string) {
    return this.api.postWithMessage<{ card: JobCard; orderStatus: OrderStatus }>(`${this.base}/qc/cards/${cardId}/pass`, notes ? { notes } : {});
  }

  failQc(cardId: string, notes: string, notesAudio?: AudioRef) {
    return this.api.postWithMessage<{ orderStatus: OrderStatus }>(`${this.base}/qc/cards/${cardId}/fail`, { ...(notes ? { notes } : {}), ...(notesAudio ? { notes_audio: notesAudio } : {}) });
  }

  /** Send (or resend) photos for ONE article; the customer approves or asks for changes on it alone. */
  requestCardApproval(cardId: string, photos: UploadFile[]) {
    return this.api.postWithMessage<{ photos?: MediaItem[] }>(`${this.base}/qc/cards/${cardId}/request-approval`, { photos });
  }

  sendToPressing(orderId: string) {
    return this.api.postWithMessage<{ orderStatus: OrderStatus; moved: number }>(`${this.base}/qc/orders/${orderId}/pressing`, {});
  }

  packOrder(orderId: string) {
    return this.api.postWithMessage<{ orderStatus: OrderStatus }>(`${this.base}/qc/orders/${orderId}/pack`, {});
  }

  // Warehouse
  warehouse(params: { tab: WarehouseTab; search?: string; page?: number; limit?: number }): Observable<Paged<WarehouseOrder, WarehouseMeta>> {
    return this.api.list<WarehouseOrder, WarehouseMeta>(`${this.base}/warehouse`, params as ListParams);
  }

  setWeight(orderId: string, weightKg: number) {
    return this.api.postWithMessage<{ weight_kg: number }>(`${this.base}/warehouse/orders/${orderId}/weight`, { weight_kg: weightKg });
  }

  setRoute(orderId: string, route: DispatchRoute) {
    return this.api.postWithMessage<{ transfer: Transfer } | null>(`${this.base}/warehouse/orders/${orderId}/route`, { route });
  }

  /** Book the courier of a paid parcel: the CN the courier gave (no courier API is connected). */
  bookDispatch(orderId: string, body: { courier_id: string; cn_number?: string; manual?: boolean }) {
    return this.api.postWithMessage<unknown>(`${this.base}/warehouse/orders/${orderId}/book`, body);
  }

  /** Book many paid orders at once: through a courier's API, by hand (CN added later), or send them to the admin warehouse. */
  bulkBook(body: { order_ids: string[]; route: DispatchRoute; mode?: 'api' | 'manual'; courier?: string; courier_id?: string }) {
    return this.api.postWithMessage<BulkBookResult>(`${this.base}/warehouse/dispatch/bulk-book`, body);
  }

  /** Add the CN of a parcel that was booked by hand without one. */
  addDispatchCn(shipmentId: string, cnNumber: string) {
    return this.api.postWithMessage<unknown>(`${this.base}/warehouse/shipments/${shipmentId}/cn`, { cn_number: cnNumber });
  }

  /** The order list for the warehouse team (QR codes, article codes, quantities): a printable page. */
  orderList(orderIds: string[]) {
    return this.api.getBlob(`${this.base}/warehouse/orders/list?order_ids=${orderIds.map(encodeURIComponent).join(',')}`);
  }

  /** What a scanned article QR code (or parcel reference) points to: its order, its dispatch shipment, and whether it can go on a loadsheet / have its CN printed. */
  scanLookupDispatch(code: string) {
    return this.api.get<DispatchScan>(`${this.base}/warehouse/scan-lookup`, { code });
  }

  /** The CN slips of the given parcels: PostEx's own PDF for PostEx parcels, otherwise a printable slip. */
  printCn(shipmentIds: string[]) {
    return this.api.getBlob(`${this.base}/warehouse/cn/print?shipment_ids=${shipmentIds.map(encodeURIComponent).join(',')}`);
  }

  /** Couriers that can be booked through their API, and whether that connection is set up on the server. */
  apiCouriers(check = false) {
    return this.api.get<{ name: string; configured: boolean; ok: boolean | null; message: string | null }[]>(`${this.base}/warehouse/couriers/api`, check ? { check: 'true' } : undefined);
  }

  /** Read the courier's tracking now (PostEx parcels). */
  refreshDispatchTracking(shipmentId: string) {
    return this.api.postWithMessage<{ applied: number }>(`${this.base}/warehouse/shipments/${shipmentId}/refresh-tracking`);
  }

  cancelDispatchBooking(orderId: string) {
    return this.api.postWithMessage<unknown>(`${this.base}/warehouse/orders/${orderId}/book/cancel`);
  }

  createDispatchLoadsheet(shipmentIds: string[]) {
    return this.api.postWithMessage<{ id: string; number: string; courier_name: string; count: number }>(`${this.base}/warehouse/dispatch/loadsheet`, { shipment_ids: shipmentIds });
  }

  downloadDispatchLoadsheet(id: string) {
    return this.api.getBlob(`${this.base}/warehouse/loadsheets/${id}/download`);
  }

  /** The file was saved: the parcels wait for the courier. */
  markLoadsheetDownloaded(id: string) {
    return this.api.postWithMessage<{ count: number; number: string }>(`${this.base}/warehouse/dispatch/loadsheets/${id}/downloaded`);
  }

  /** The courier really took the parcels: they are Dispatched. */
  confirmDispatchHandover(id: string) {
    return this.api.postWithMessage<{ count: number; number: string }>(`${this.base}/warehouse/dispatch/loadsheets/${id}/handed-over`);
  }

  updateDispatchTracking(shipmentId: string, body: { status: 'in_transit' | 'delivered' | 'failed_delivery' | 'returning_to_partner'; note?: string; reason?: string }) {
    return this.api.postWithMessage<unknown>(`${this.base}/warehouse/shipments/${shipmentId}/tracking`, body);
  }

  confirmReturnedParcel(shipmentId: string) {
    return this.api.postWithMessage<unknown>(`${this.base}/warehouse/shipments/${shipmentId}/received-back`);
  }

  transfers(params: { status?: TransferStatus; page?: number; limit?: number; search?: string } = {}): Observable<Paged<Transfer>> {
    return this.api.list<Transfer>(`${this.base}/warehouse/transfers`, params as ListParams);
  }

  dispatchTransfer(transferId: string) {
    return this.api.postWithMessage<null>(`${this.base}/warehouse/transfers/${transferId}/dispatch`);
  }

  // Earnings
  earningsSummary(): Observable<EarningsSummary> {
    return this.api.get<EarningsSummary>(`${this.base}/earnings/summary`);
  }

  orderDetail(id: string): Observable<PartnerOrderDetail> {
    return this.api.get<PartnerOrderDetail>(`${this.base}/orders/${id}`);
  }

  allOrders(params: { search?: string; page?: number; limit?: number }): Observable<Paged<PartnerOrderRow>> {
    return this.api.list<PartnerOrderRow>(`${this.base}/orders`, params as ListParams);
  }

  earnings(params: { status?: 'paid' | 'issued' | ''; search?: string; page?: number; limit?: number }): Observable<Paged<EarningRow>> {
    return this.api.list<EarningRow>(`${this.base}/earnings`, params as ListParams);
  }
}

// ───────────────────────────── File helpers (photos / video) ─────────────────────────────

const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/** Downscale an image to `maxDim` px on the long side and re-encode as JPEG. */
export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<UploadFile> {
  const src = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Could not open ${file.name}.`));
    el.src = src;
  });
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { name: file.name, dataUrl: src };
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { name, dataUrl: canvas.toDataURL('image/jpeg', quality) };
}

/**
 * Turn picked files into upload payloads: images are compressed, short videos are read as-is.
 * Throws an Error with a readable message for unsupported/oversized files.
 */
export async function filesToUploads(files: FileList | File[], opts: { allowVideo?: boolean } = {}): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      out.push(await compressImage(file));
    } else if (opts.allowVideo && file.type.startsWith('video/')) {
      if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is larger than 8 MB. Record a shorter video.`);
      out.push({ name: file.name, dataUrl: await readAsDataUrl(file) });
    } else {
      throw new Error(`${file.name} is not a photo${opts.allowVideo ? ' or video' : ''}.`);
    }
  }
  return out;
}

export const ISSUE_TYPES: { value: IssueType; en: string; ur: string }[] = [
  { value: 'piece_missing', en: 'Piece missing', ur: 'ٹکڑا غائب' },
  { value: 'damaged', en: 'Damaged', ur: 'خراب' },
  { value: 'wrong_item', en: 'Wrong item', ur: 'غلط چیز' },
  { value: 'other', en: 'Other', ur: 'دیگر' },
];

/** Single source of truth lives in core/utils/measurements.ts (grouped labels for the new size form). */
export { MEASUREMENT_LABELS, MEASUREMENT_GROUP_DEFS, groupMeasurements, chartTitle } from '../utils/measurements';

/** The answer of the dispatch scan lookup (Ready for dispatch > Scan for Loadsheet / CN). */
export interface DispatchScan {
  code: string;
  article: { id: string; code: string; title: string | null; line_no: number | null } | null;
  order: { id: string; reference: string; customer_name: string | null; customer_code: string | null; destination_city: string | null; destination_country: string | null; weight_kg: number | null };
  shipment: { id: string; status: string; courier: string | null; courier_id: string | null; tracking_number: string | null; loadsheet_id: string | null } | null;
  can_loadsheet: boolean;
  can_print_cn: boolean;
  reason: string | null;
}

/** The COD state shown on order lists (from the server). */
export interface CodSummary {
  payment_type: 'COD' | 'NON_COD' | null;
  payment_status: 'UNPAID' | 'PENDING' | 'PAID' | null;
  amount: number | null;
  currency: string | null;
  needs_verification: boolean;
  locked: boolean;
}
