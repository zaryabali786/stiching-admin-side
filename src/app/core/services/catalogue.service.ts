import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { ApiEnvelope, ListParams, Paged } from '../models/api.models';

export type CatalogueStatus = 'active' | 'inactive';
export type StatusFilter = 'all' | CatalogueStatus;
/** Flat lookup lists that share one UI (name + status; couriers add requires_tracking). */
export type LookupKind = 'brands' | 'couriers';

export interface LookupRow {
  id: string;
  name: string;
  status: CatalogueStatus;
  requires_tracking?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface LookupInput {
  name?: string;
  status?: CatalogueStatus;
  requires_tracking?: boolean;
}

export interface ArticleType {
  id: string;
  name: string;
  status: CatalogueStatus;
  sort_order: number;
  articles_count: number;
}

export interface ArticleTypeInput {
  name?: string;
  status?: CatalogueStatus;
  sort_order?: number;
}

/** customer_price, partner_cost and margin are internal: they are never shown to customers. */
export interface Article {
  id: string;
  article_type_id: string;
  name: string;
  image_url: string | null;
  customer_price: number | null;
  partner_cost: number | null;
  /** Read-only: customer_price − partner_cost, null until both are set. */
  margin: number | null;
  status: CatalogueStatus;
  sort_order: number;
  type?: { id: string; name: string } | null;
  created_at: string;
  updated_at?: string;
}

export interface ArticleInput {
  article_type_id?: string;
  name?: string;
  customer_price?: number | null;
  partner_cost?: number | null;
  status?: CatalogueStatus;
  sort_order?: number;
  image_upload?: { name: string; dataUrl: string };
  remove_image?: boolean;
}

export interface ListQuery {
  search?: string;
  status?: StatusFilter;
  page?: number;
  limit?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface WriteResult<T> {
  data: T;
  message: string;
}

export interface DeleteResult {
  deleted: boolean;
  deactivated: boolean;
  message: string;
}

type DeleteEnvelope = ApiEnvelope<{ deleted?: boolean; deactivated?: boolean } | null> & { deleted?: boolean; deactivated?: boolean };

/** Partner/admin catalogue endpoints (brands, couriers, article types, articles). */
@Injectable({ providedIn: 'root' })
export class CatalogueService {
  private api = inject(ApiService);
  private http = inject(HttpClient);

  // ── Brands & couriers (one generic set of calls) ──
  listLookup(kind: LookupKind, q: ListQuery): Observable<Paged<LookupRow>> {
    return this.api.list<LookupRow>(`/partner/${kind}`, this.clean(q));
  }
  createLookup(kind: LookupKind, body: LookupInput): Observable<WriteResult<LookupRow>> {
    return this.send<LookupRow>('POST', `/partner/${kind}`, body);
  }
  updateLookup(kind: LookupKind, id: string, body: LookupInput): Observable<WriteResult<LookupRow>> {
    return this.send<LookupRow>('PATCH', `/partner/${kind}/${id}`, body);
  }
  deleteLookup(kind: LookupKind, id: string): Observable<DeleteResult> {
    return this.remove(`/partner/${kind}/${id}`);
  }

  // ── Article types ──
  listTypes(q: ListQuery): Observable<Paged<ArticleType>> {
    return this.api.list<ArticleType>('/partner/article-types', this.clean(q));
  }
  createType(body: ArticleTypeInput): Observable<WriteResult<ArticleType>> {
    return this.send<ArticleType>('POST', '/partner/article-types', body);
  }
  updateType(id: string, body: ArticleTypeInput): Observable<WriteResult<ArticleType>> {
    return this.send<ArticleType>('PATCH', `/partner/article-types/${id}`, body);
  }
  deleteType(id: string): Observable<DeleteResult> {
    return this.remove(`/partner/article-types/${id}`);
  }

  // ── Articles ──
  listArticles(typeId: string, q: ListQuery): Observable<Paged<Article>> {
    return this.api.list<Article>('/partner/articles', { ...this.clean(q), type_id: typeId });
  }
  createArticle(body: ArticleInput): Observable<WriteResult<Article>> {
    return this.send<Article>('POST', '/partner/articles', body);
  }
  updateArticle(id: string, body: ArticleInput): Observable<WriteResult<Article>> {
    return this.send<Article>('PATCH', `/partner/articles/${id}`, body);
  }
  deleteArticle(id: string): Observable<DeleteResult> {
    return this.remove(`/partner/articles/${id}`);
  }

  /** "all" is the default, so it is not sent. */
  private clean(q: ListQuery): ListParams {
    return { ...q, status: q.status && q.status !== 'all' ? q.status : undefined } as ListParams;
  }

  private send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Observable<WriteResult<T>> {
    return this.http
      .request<ApiEnvelope<T>>(method, `${this.api.baseUrl}${path}`, { body })
      .pipe(map((r) => ({ data: r.data, message: r.message })));
  }

  /** DELETE answers { deleted, deactivated } (read from data, or the envelope itself) plus a message. */
  private remove(path: string): Observable<DeleteResult> {
    return this.http.delete<DeleteEnvelope>(`${this.api.baseUrl}${path}`).pipe(
      map((r) => {
        const deactivated = !!(r.data?.deactivated ?? r.deactivated);
        return { deactivated, deleted: !deactivated, message: r.message };
      })
    );
  }
}
