import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiEnvelope, ListParams, PageMeta, Paged } from '../models/api.models';
import { ApiService } from './api.service';

export type CommissionModel = 'percent' | 'fixed';
export type CommissionStatus = 'estimated' | 'pending' | 'settled' | 'reversed' | 'disputed';
export type ShopOrderStatus = 'pending_payment' | 'payment_failed' | 'processing' | 'confirmed' | 'partially_dispatched' | 'dispatched' | 'delivered' | 'cancelled' | 'attention';
export type ShopPaymentStatus = 'unpaid' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type BrandOrderState = 'pending' | 'creating' | 'created' | 'failed' | 'cancelled';
export type FulfillmentStatus = 'unfulfilled' | 'partial' | 'dispatched' | 'delivered';

export interface ShopBrand {
  store_id: string;
  brand_name: string;
  shop_domain: string;
  status: 'pending' | 'active' | 'uninstalled';
  approved: boolean;
  commission_model: CommissionModel;
  commission_rate: number;
  commission_fixed: number;
  shipping_flat: number;
  currency: string | null;
  catalog: { status: 'never' | 'syncing' | 'ok' | 'error'; synced_at: string | null; error: string | null; products: number; hidden: number };
  orders: { status: 'ok' | 'attention' | 'never'; failed: number; last_error: string | null };
  permissions: { products: boolean; orders: boolean; inventory: boolean; missing: string[] };
}

export interface ShopBrandPatch {
  approved?: boolean;
  commission_model?: CommissionModel;
  commission_rate?: number;
  commission_fixed?: number;
  shipping_flat?: number;
}

export interface ShopSyncResult {
  products: number;
  variants: number;
  removed: number;
  error: string | null;
}

export interface ShopProductRow {
  id: string;
  title: string;
  brand: { id: string; name: string };
  image_url: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  in_stock: boolean;
  variants_count: number;
  hidden: boolean;
  shopify_status: string | null;
  synced_at: string | null;
}

export interface ShopTracking {
  company: string | null;
  number: string | null;
  url: string | null;
}

export interface ShopOrderRow {
  id: string;
  reference: string;
  customer: { name: string | null; email: string | null };
  status: ShopOrderStatus;
  status_label: string;
  payment_status: ShopPaymentStatus;
  total: number;
  currency: string;
  brands: string[];
  brand_orders_count: number;
  created_at: string;
}

export interface ShopLineItem {
  title: string;
  variant_title: string | null;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  line_total?: number;
  image_url?: string | null;
}

export interface ShopBrandOrder {
  id: string;
  brand: { id: string; name: string };
  shop_domain: string;
  state: BrandOrderState;
  last_error: string | null;
  shopify_order_id: string | null;
  shopify_order_name: string | null;
  shopify_order_url: string | null;
  financial_status: string | null;
  fulfillment_status: FulfillmentStatus;
  delivery_verified: boolean;
  tracking: ShopTracking[];
  subtotal: number;
  shipping: number;
  total: number;
  commission_model: CommissionModel;
  commission_rate: number;
  commission_fixed: number;
  commission_amount: number;
  brand_payable: number;
  commission_status: CommissionStatus;
  settled_at: string | null;
  items: ShopLineItem[];
}

export interface ShopOrderDetail extends ShopOrderRow {
  address: { name?: string; phone?: string; address1?: string; address2?: string | null; city?: string; province?: string | null; zip?: string | null; country_code?: string } | null;
  items: ShopLineItem[];
  brand_orders: ShopBrandOrder[];
  payment: { status: ShopPaymentStatus; intent_id: string | null; paid_at: string | null; refunded_amount: number };
  timeline: { at: string; text: string }[];
}

export interface CommissionSummary {
  gross: number;
  brand_subtotal: number;
  shipping: number;
  commission_estimated: number;
  commission_pending: number;
  commission_settled: number;
  commission_reversed: number;
  commission_disputed: number;
  brand_payable_pending: number;
  currency: string | null;
}

export interface CommissionRow {
  id: string;
  order_reference: string;
  brand: string;
  created_at: string;
  gross: number;
  subtotal: number;
  shipping: number;
  rate_text: string;
  commission_amount: number;
  brand_payable: number;
  commission_status: CommissionStatus;
  refunded_amount: number;
  settlement_id: string | null;
}

export interface CommissionList {
  summary: CommissionSummary;
  rows: CommissionRow[];
}

export interface ShopSettlement {
  id: string;
  brand: string;
  amount: number;
  currency: string;
  reference: string;
  note: string | null;
  settled_at: string;
  orders_count: number;
}

/** The Ecommerce (Shop) module of the admin portal: brands, catalog, orders, commission and settlements. */
@Injectable({ providedIn: 'root' })
export class ShopAdminService {
  private api = inject(ApiService);
  private http = inject(HttpClient);
  private base = '/admin/shop';

  // brands
  brands(): Observable<ShopBrand[]> {
    return this.api.get<ShopBrand[]>(`${this.base}/brands`);
  }
  patchBrand(storeId: string, patch: ShopBrandPatch): Observable<ShopBrand> {
    return this.api.patch<ShopBrand>(`${this.base}/brands/${storeId}`, patch);
  }
  syncBrand(storeId: string): Observable<ShopSyncResult> {
    return this.api.post<ShopSyncResult>(`${this.base}/brands/${storeId}/sync`);
  }

  // products
  products(params: ListParams): Observable<Paged<ShopProductRow>> {
    return this.api.list<ShopProductRow>(`${this.base}/products`, params);
  }
  setHidden(id: string, hidden: boolean): Observable<ShopProductRow> {
    return this.api.patch<ShopProductRow>(`${this.base}/products/${id}`, { hidden });
  }

  // orders
  orders(params: ListParams): Observable<Paged<ShopOrderRow>> {
    return this.api.list<ShopOrderRow>(`${this.base}/orders`, params);
  }
  order(id: string): Observable<ShopOrderDetail> {
    return this.api.get<ShopOrderDetail>(`${this.base}/orders/${id}`);
  }
  retryBrandOrder(id: string): Observable<ShopBrandOrder> {
    return this.api.post<ShopBrandOrder>(`${this.base}/brand-orders/${id}/retry`);
  }
  syncBrandOrder(id: string): Observable<ShopBrandOrder> {
    return this.api.post<ShopBrandOrder>(`${this.base}/brand-orders/${id}/sync`);
  }
  cancelOrder(id: string, reason?: string): Observable<ShopOrderDetail> {
    return this.api.post<ShopOrderDetail>(`${this.base}/orders/${id}/cancel`, { reason });
  }

  // commission and settlements
  commissions(params: ListParams): Observable<{ data: CommissionList; meta: PageMeta }> {
    return this.http
      .get<ApiEnvelope<CommissionList>>(`${this.api.baseUrl}${this.base}/commissions`, { params: cleanParams(params) })
      .pipe(
        map((r) => ({
          data: r.data,
          meta: (r.meta || { page: 1, limit: 0, total: r.data?.rows?.length ?? 0, totalPages: 1, hasMore: false }) as PageMeta,
        }))
      );
  }
  dispute(brandOrderId: string, disputed: boolean, note?: string): Observable<unknown> {
    return this.api.post(`${this.base}/commissions/dispute`, { brand_order_id: brandOrderId, disputed, note });
  }
  settle(body: { store_id: string; brand_order_ids: string[]; reference: string; note?: string }): Observable<ShopSettlement> {
    return this.api.post<ShopSettlement>(`${this.base}/settlements`, body);
  }
  settlements(params: ListParams): Observable<Paged<ShopSettlement>> {
    return this.api.list<ShopSettlement>(`${this.base}/settlements`, params);
  }
  exportCsv(params: ListParams): Observable<Blob> {
    const qs = new URLSearchParams(cleanParams(params)).toString();
    return this.api.getBlob(`${this.base}/commissions/export.csv${qs ? `?${qs}` : ''}`);
  }
}

function cleanParams(params: ListParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params || {})) if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  return out;
}
