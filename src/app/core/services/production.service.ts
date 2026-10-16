import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AudioRef, VoiceNote } from '../models/chat.models';
import { ApprovalStatus } from '../utils/approval';
import { ApiService } from './api.service';
import { ApiEnvelope } from '../models/api.models';

/** Production board stages, in flow order. See backend/API.md → "Production board". */
export type ProductionStage = 'to_assign' | 'cutting' | 'stitching' | 'qc' | 'pressing' | 'packed';
export const PRODUCTION_STAGES: ProductionStage[] = ['to_assign', 'cutting', 'stitching', 'qc', 'pressing', 'packed'];

export type CardStatus = 'on_time' | 'rush' | 'delayed';

export type ReceivingKind = 'awaiting' | 'received' | 'done' | 'not_ready' | 'assigned';

export interface ReceivingArticle {
  unit_id: string;
  code: string | null;
  line_no: number;
  title: string;
  kind: ReceivingKind;
  reason: string | null;
  stage: ProductionStage | null;
  stage_label: string | null;
  received_by: string | null;
  received_role: string | null;
  received_at: string | null;
  /** Received by the person looking at the screen. */
  mine: boolean;
}

/** One order at one stage: how many articles are received, how many remain, and who received each. */
export interface ReceivingProgress {
  order_id: string;
  reference: string;
  customer_name: string | null;
  customer_code: string | null;
  brand: string | null;
  stage: ProductionStage;
  stage_label: string;
  total: number;
  received: number;
  mine: number;
  remaining: number;
  awaiting: number;
  done: number;
  next_action: string;
  articles: ReceivingArticle[];
}

export interface ReceivingScreen {
  role: string;
  supervisor: boolean;
  stage: ProductionStage | null;
  stageLabel: string | null;
  orders: ReceivingProgress[];
}

export type TeamArticleState = 'pending' | 'with_master' | 'with_tailor' | 'completed';

export interface TrackedArticle {
  unit_id: string;
  code: string | null;
  title: string;
  line_no: number;
  stage: ProductionStage;
  stage_label: string;
  state: TeamArticleState;
  state_label: string;
  master: string | null;
  tailor: string | null;
  tailor_id: string | null;
  received_by: string | null;
  received_at: string | null;
}

/** An order as the master's team sees it: how many articles were picked up and which ones still wait. */
export interface TrackedOrder {
  order_id: string;
  reference: string;
  customer_name: string | null;
  brand: string | null;
  due_date: string | null;
  status: string;
  total: number;
  received: number;
  remaining: number;
  completed: number;
  members: string[];
  remaining_text: string;
  articles: TrackedArticle[];
}

export interface TrackedMember {
  id: string;
  name: string;
  role: string;
  is_master: boolean;
  received: number;
  pending: number;
  completed: number;
}

export interface MasterTracking {
  master: { id: string; name: string } | null;
  members: TrackedMember[];
  orders: TrackedOrder[];
  totals: { orders: number; articles: number; received: number; remaining: number; completed: number };
  /** The masters a manager can switch between (empty for a master or a tailor). */
  masters: { id: string; name: string }[];
  viewer: 'master' | 'tailor' | 'manager';
}

export interface ScanReceiveResult {
  kind: 'article' | 'order' | 'complete';
  card?: Card;
  receipt?: { stage: ProductionStage; role: string; user_name: string | null; received_at: string };
  orderStatus?: string;
  order?: { id: string; reference: string };
  stage?: ProductionStage;
  /** The order's received / remaining numbers after this scan. */
  progress?: ReceivingProgress;
}


export type ArticleState = 'pending_receipt' | 'received' | 'pending_approval' | 'approved' | 'rejected' | 'return_requested' | 'returned' | 'issue' | 'in_production' | 'completed';

export interface ProductionOrderUnit {
  id: string;
  code: string | null;
  line_no: number;
  title: string;
  state: ArticleState;
  state_label: string;
  stage: ProductionStage | null;
  stage_label: string | null;
  card_id: string | null;
  master: string | null;
  tailor: string | null;
  receipts: { stage: ProductionStage; role: string; user_name: string | null; received_at: string }[];
}

export interface ProductionOrderRow {
  id: string;
  reference: string;
  brand: string | null;
  customer_name: string | null;
  customer_code: string | null;
  status: string;
  status_label: string;
  due_date: string | null;
  updated_at: string;
  units: ProductionOrderUnit[];
  progress: { total: number; in_production: number; completed: number; waiting: number };
}
export type Priority = 'normal' | 'rush';

export interface MediaRef {
  url: string;
  type?: 'image' | 'video' | string;
  name?: string;
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
  bottom?: number | null;
  cuff_opening?: number | null;
  front_rise?: number | null;
  back_rise?: number | null;
  waist_relaxed?: number | null;
  trouser_hip?: number | null;
  knee?: number | null;
  thigh?: number | null;
  shalwar_gheer?: number | null;
  neck_depth?: number | null;
  [key: string]: number | string | null | undefined;
}

export interface CardSizeChart {
  id: string;
  name: string | null;
  person_name: string | null;
  variation: string | null;
  nearest_size?: string | null;
  measurements: Measurements | null;
  fit_feedback: string | null;
  notes: string | null;
  notes_audio?: VoiceNote | null;
}

export interface CardDesign {
  neckline?: string | null;
  sleeves?: string | null;
  trouser?: string | null;
  [key: string]: string | null | undefined;
}

export interface CardUnit {
  id: string;
  /** The article's own code (e.g. SA-1080-1): what its QR code carries. */
  code?: string | null;
  line_no?: number | null;
  unit_title: string;
  stitching_type: string | null;
  notes: string | null;
  notes_audio?: VoiceNote | null;
  product_link: string | null;
  /** The product's picture (from the brand's page or the email), when there is one. */
  product_image_url?: string | null;
  quantity: number | null;
  design: CardDesign | null;
  reference_images: MediaRef[] | null;
  received_at: string | null;
  size_chart: CardSizeChart | null;
}

export interface CardOrder {
  id: string;
  reference: string;
  import_source?: 'manual' | 'invoice' | 'link' | 'email';
  brand: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_code: string | null;
  destination_country: string | null;
  destination_city: string | null;
  status: string;
  priority: Priority | null;
  due_date: string | null;
  received_at: string | null;
  paid_at: string | null;
  change_request: string | null;
  change_request_audio?: VoiceNote | null;
  customer_notes: string | null;
  approval_photos: MediaRef[] | null;
  created_at: string;
}

export interface PersonRef {
  id: string;
  name: string;
}

export type QcChecklist = Record<string, boolean>;

export interface Card {
  id: string;
  /** Set by Scan to complete: the current stage is finished and waits for the next person to scan it to receive. */
  stage_done?: { at: string; by_name: string | null } | null;
  order_id: string;
  unit_id: string;
  stage: ProductionStage;
  /** Shown instead of the raw stage once the article has left production (e.g. Shipped). */
  display_status?: string | null;
  display_label?: string | null;
  position: number;
  master_id: string | null;
  tailor_id: string | null;
  master: PersonRef | null;
  tailor: PersonRef | null;
  priority: Priority;
  due_date: string | null;
  order_reference: string;
  customer_code: string | null;
  unit_title: string;
  qc_passed: boolean;
  qc_notes: string | null;
  qc_notes_audio?: VoiceNote | null;
  /** This ticket's own customer approval (each article is approved on its own). */
  approval_status?: ApprovalStatus;
  approval_photos?: MediaRef[] | null;
  approval_requested_at?: string | null;
  approval_decided_at?: string | null;
  change_request?: string | null;
  change_request_audio?: VoiceNote | null;
  qc_checklist: QcChecklist | null;
  cutting_at: string | null;
  stitching_at: string | null;
  qc_at: string | null;
  pressing_at: string | null;
  packed_at: string | null;
  created_at: string;
  comments_count: number;
  is_delayed: boolean;
  days_late: number;
  status: CardStatus;
  unit: CardUnit | null;
  order: CardOrder | null;
}

export interface CardActivity {
  id: string;
  kind: 'comment' | 'activity';
  author_name: string | null;
  body: string;
  notes_audio?: VoiceNote | null;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  status: string;
  note: string | null;
  created_at: string;
}

export interface SiblingCard {
  id: string;
  stage: ProductionStage;
  /** Shown instead of the raw stage once the article has left production (e.g. Shipped). */
  display_status?: string | null;
  display_label?: string | null;

  unit_title: string;
  qc_passed: boolean;
  unit?: { line_no: number | null } | null;
}

export interface QcItem {
  key: string;
  label: string;
}

export interface CardDetail extends Card {
  activity: CardActivity[];
  order_events: OrderEvent[];
  order_cards: SiblingCard[];
  qc_items: QcItem[];
}

export interface BoardColumn {
  stage: ProductionStage;
  label: string;
  items: Card[];
  total: number;
  nextCursor: string | null;
}

export interface Board {
  columns: BoardColumn[];
  delayedCount: number;
}

export interface BoardFilters {
  search?: string | null;
  masterId?: string | null;
  tailorId?: string | null;
  priority?: 'rush' | null;
  delayed?: boolean | null;
}

export interface MoveResult {
  card: Card;
  orderStatus: string;
}

export interface Member {
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

export interface MasterTeam extends Member {
  tailors: Member[];
  team_assigned: number;
  team_capacity: number;
  team_load_pct: number;
}

export interface Teams {
  masters: MasterTeam[];
  unassignedTailors: Member[];
  members: Member[];
}

export interface Suggestion {
  id: string;
  name: string;
  assigned: number;
  load_pct: number;
}

export interface Suggestions {
  master: Suggestion | null;
  tailor: Suggestion | null;
}

export interface CardPatch {
  master_id?: string | null;
  tailor_id?: string | null;
  due_date?: string | null;
  priority?: Priority;
}

export interface UploadFile {
  name: string;
  dataUrl: string;
}

/** Result plus the API's human message (for success toasts). */
export interface WithMessage<T> {
  data: T;
  message: string;
}

/**
 * Production board, job cards and quality check endpoints of the partner portal.
 */
@Injectable({ providedIn: 'root' })
export class ProductionService {
  private api = inject(ApiService);
  private http = inject(HttpClient);
  private readonly base = '/partner/production';

  // ───────── Board ─────────

  board(filters: BoardFilters, limit = 15): Observable<Board> {
    return this.api.get<Board>(`${this.base}/board`, { ...filterParams(filters), limit });
  }

  column(stage: ProductionStage, cursor: string, filters: BoardFilters, limit = 15): Observable<BoardColumn> {
    return this.api.get<BoardColumn>(`${this.base}/columns/${stage}`, { ...filterParams(filters), cursor, limit });
  }

  // ───────── Receiving articles by scanning their QR code ─────────

  /** `code` is what the article's QR holds. The stage is found from the signed-in person, never chosen. */
  scanReceive(code: string) {
    return this.api.postWithMessage<ScanReceiveResult>(`${this.base}/scan-receive`, { code });
  }

  /** The person who holds the article scans it again when their work is finished (it stays in its stage until the next person receives it). */
  scanComplete(code: string) {
    return this.api.postWithMessage<ScanReceiveResult>(`${this.base}/scan-complete`, { code });
  }

  /** The receiving screen: this person's stage and, per order, received / remaining and who received each article. */
  receiving(): Observable<ReceivingScreen> {
    return this.api.get<ReceivingScreen>(`${this.base}/receiving`);
  }

  /** One master and their tailors: every order of the team, what was picked up and what still waits. */
  masterTracking(masterId?: string | null): Observable<MasterTracking> {
    return this.api.get<MasterTracking>(`${this.base}/master-tracking`, { master_id: masterId || null });
  }

  /** Orders as parents, every article under them with where it is and who received it. */
  orders(params: { search?: string; page?: number; limit?: number }) {
    return this.api.list<ProductionOrderRow>(`${this.base}/orders`, params as Record<string, string | number | undefined>);
  }

  scan(code: string): Observable<Card[]> {
    return this.api.get<Card[]>(`${this.base}/scan`, { code });
  }

  suggestions(masterId?: string | null): Observable<Suggestions> {
    return this.api.get<Suggestions>(`${this.base}/suggestions`, { masterId: masterId || null });
  }

  // ───────── Cards ─────────

  card(id: string): Observable<CardDetail> {
    return this.api.get<CardDetail>(`${this.base}/cards/${id}`);
  }

  move(id: string, stage: ProductionStage, prevId: string | null, nextId: string | null): Observable<WithMessage<MoveResult>> {
    return this.withMessage<MoveResult>('PUT', `${this.base}/cards/${id}/move`, { stage, prevId, nextId });
  }

  update(id: string, patch: CardPatch): Observable<WithMessage<Card>> {
    return this.withMessage<Card>('PATCH', `${this.base}/cards/${id}`, patch);
  }

  /** Assign a master (the suggested one when omitted) and move the card into Cutting. */
  assign(id: string, masterId?: string | null): Observable<WithMessage<MoveResult>> {
    return this.api.postWithMessage<MoveResult>(`${this.base}/cards/${id}/assign`, masterId ? { master_id: masterId } : {});
  }

  addComment(id: string, body: string, notesAudio?: AudioRef): Observable<CardActivity> {
    return this.api.post<CardActivity>(`${this.base}/cards/${id}/comments`, { ...(body ? { body } : {}), ...(notesAudio ? { notes_audio: notesAudio } : {}) });
  }

  updateChecklist(id: string, checklist: QcChecklist): Observable<{ qc_checklist: QcChecklist; items: QcItem[] }> {
    return this.api.patch<{ qc_checklist: QcChecklist; items: QcItem[] }>(`${this.base}/cards/${id}/qc-checklist`, { checklist });
  }

  askCustomer(id: string, message: string): Observable<WithMessage<null>> {
    return this.api.postWithMessage<null>(`${this.base}/cards/${id}/ask-customer`, { message });
  }

  // ───────── Quality check ─────────

  passQc(id: string, notes?: string | null): Observable<WithMessage<MoveResult>> {
    return this.api.postWithMessage<MoveResult>(`/partner/qc/cards/${id}/pass`, notes ? { notes } : {});
  }

  failQc(id: string, notes: string, notesAudio?: AudioRef): Observable<WithMessage<{ orderStatus: string }>> {
    return this.api.postWithMessage<{ orderStatus: string }>(`/partner/qc/cards/${id}/fail`, { ...(notes ? { notes } : {}), ...(notesAudio ? { notes_audio: notesAudio } : {}) });
  }

  /** Send (or resend) photos for ONE article; the customer approves or asks for changes on it alone. */
  requestCardApproval(cardId: string, photos: UploadFile[]): Observable<WithMessage<{ photos?: MediaRef[] }>> {
    return this.api.postWithMessage<{ photos?: MediaRef[] }>(`/partner/qc/cards/${cardId}/request-approval`, { photos });
  }

  // ───────── Teams (read only, for pickers / filters) ─────────

  teams(): Observable<Teams> {
    return this.api.get<Teams>('/partner/teams');
  }

  /** PUT/PATCH that keeps the envelope message (ApiService only offers this for POST). */
  private withMessage<T>(method: 'PUT' | 'PATCH', path: string, body: unknown): Observable<WithMessage<T>> {
    return this.http
      .request<ApiEnvelope<T>>(method, `${this.api.baseUrl}${path}`, { body })
      .pipe(map((r) => ({ data: r.data, message: r.message })));
  }
}

/** Board filters → query params (ApiService drops null/empty values). */
function filterParams(f: BoardFilters): Record<string, string | null> {
  return {
    search: f.search?.trim() || null,
    masterId: f.masterId || null,
    tailorId: f.tailorId || null,
    priority: f.priority === 'rush' ? 'rush' : null,
    delayed: f.delayed ? 'true' : null,
  };
}
