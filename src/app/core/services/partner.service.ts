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

export type ReceivingTab = 'expected' | 'issues' | 'recent';
export type IssueType = 'piece_missing' | 'damaged' | 'wrong_item' | 'other';

export interface ReceivingUnit {
  id: string;
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

export interface ReceivingOrder {
  id: string;
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
  priority: 'normal' | 'rush';
  due_date: string | null;
  customer_notes: string | null;
  created_at: string;
  received_at: string | null;
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
  role: 'master' | 'tailor';
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
  email: string;
  password?: string;
  permissions: string[];
}

export interface TeamLoginCredential {
  email: string;
  temporaryPassword: string;
}

export interface TeamMemberInput {
  login?: TeamLoginInput;
  name?: string;
  role?: 'master' | 'tailor';
  daily_capacity?: number;
  master_id?: string | null;
  is_active?: boolean;
}

// ───────────────────────────── Job cards (production / QC) ─────────────────────────────

export type JobStage = 'to_assign' | 'cutting' | 'stitching' | 'qc' | 'packed';

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

export type WarehouseTab = 'to_invoice' | 'awaiting_payment' | 'paid' | 'dispatched';
export type DispatchRoute = 'admin_warehouse' | 'direct_dispatch';

export interface WarehouseOrder {
  id: string;
  reference: string;
  brand: string | null;
  status: OrderStatus;
  status_label: string;
  customer_name: string | null;
  customer_code: string | null;
  destination_city: string | null;
  destination_country: string | null;
  destination_address: string | null;
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
  shipment: { id: string; status: string; courier: string | null; tracking_number: string | null; shipped_from: string } | null;
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

  receiveUnit(unitId: string) {
    return this.api.postWithMessage<unknown>(`${this.base}/receiving/units/${unitId}/receive`);
  }

  reportIssue(unitId: string, body: { issue_type: IssueType; note?: string; notes_audio?: AudioRef; media?: UploadFile[] }) {
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

  packOrder(orderId: string, weightKg: number) {
    return this.api.postWithMessage<{ orderStatus: OrderStatus }>(`${this.base}/qc/orders/${orderId}/pack`, { weight_kg: weightKg });
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

  shipDirect(orderId: string, body: { courier_id: string; tracking_number: string }) {
    return this.api.postWithMessage<null>(`${this.base}/warehouse/orders/${orderId}/ship`, body);
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
