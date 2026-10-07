import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AudioRef, VoiceNote } from '../models/chat.models';
import { ApprovalStatus } from '../utils/approval';
import { ApiService } from './api.service';
import { ApiEnvelope } from '../models/api.models';

/** Production board stages, in flow order. See backend/API.md → "Production board". */
export type ProductionStage = 'to_assign' | 'cutting' | 'stitching' | 'qc' | 'packed';
export const PRODUCTION_STAGES: ProductionStage[] = ['to_assign', 'cutting', 'stitching', 'qc', 'packed'];

export type CardStatus = 'on_time' | 'rush' | 'delayed';
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
  line_no?: number | null;
  unit_title: string;
  stitching_type: string | null;
  notes: string | null;
  notes_audio?: VoiceNote | null;
  product_link: string | null;
  quantity: number | null;
  design: CardDesign | null;
  reference_images: MediaRef[] | null;
  received_at: string | null;
  size_chart: CardSizeChart | null;
}

export interface CardOrder {
  id: string;
  reference: string;
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
