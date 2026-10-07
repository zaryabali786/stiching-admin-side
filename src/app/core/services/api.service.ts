import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiEnvelope, ListParams, Paged } from '../models/api.models';

/**
 * Thin wrapper over HttpClient that unwraps the API envelope `{ success, data, meta }`.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  readonly baseUrl = environment.apiUrl;

  get<T>(path: string, params?: ListParams): Observable<T> {
    return this.http.get<ApiEnvelope<T>>(this.url(path), { params: toParams(params) }).pipe(map((r) => r.data));
  }

  /** GET a paginated list; returns rows plus `meta` (page, total, counts...). */
  list<T, M = Record<string, any>>(path: string, params?: ListParams): Observable<Paged<T, M>> {
    return this.http
      .get<ApiEnvelope<T[]>>(this.url(path), { params: toParams(params) })
      .pipe(map((r) => ({ items: r.data || [], meta: (r.meta || { page: 1, limit: 0, total: 0, totalPages: 1, hasMore: false }) as Paged<T, M>['meta'] })));
  }

  post<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.post<ApiEnvelope<T>>(this.url(path), body).pipe(map((r) => r.data));
  }

  /** POST returning the full envelope (when the success message should be shown). */
  postWithMessage<T>(path: string, body: unknown = {}): Observable<{ data: T; message: string }> {
    return this.http.post<ApiEnvelope<T>>(this.url(path), body).pipe(map((r) => ({ data: r.data, message: r.message })));
  }

  put<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.put<ApiEnvelope<T>>(this.url(path), body).pipe(map((r) => r.data));
  }

  patch<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.patch<ApiEnvelope<T>>(this.url(path), body).pipe(map((r) => r.data));
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<ApiEnvelope<T>>(this.url(path)).pipe(map((r) => r.data));
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

export function toParams(params?: ListParams): HttpParams {
  let p = new HttpParams();
  if (!params) return p;
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    p = p.set(key, String(value));
  }
  return p;
}

/** Human-readable message for any error thrown by the API layer. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Check that the backend is running.';
    return err.error?.message || err.message || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
