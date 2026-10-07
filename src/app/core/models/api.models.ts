/** Shapes shared across the admin & partner portals. See backend/API.md for the full contract. */

export type Role = 'customer' | 'partner_staff' | 'admin';

export interface ApiEnvelope<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  meta?: PageMeta & Record<string, any>;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Paged<T, M = Record<string, any>> {
  items: T[];
  meta: PageMeta & M;
}

/** The partner a staff login belongs to (null for admins and customers). */
export interface PartnerRef {
  id: string;
  name: string;
  status: 'active' | 'inactive';
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  role: Role;
  customer_code: string | null;
  is_active: boolean;
  created_at: string;
  /** Hierarchy (computed by the server; the app only displays it, every request is re-checked server side). */
  partner_id: string | null;
  partner: PartnerRef | null;
  partner_role: 'owner' | 'member' | null;
  /** EFFECTIVE permissions, e.g. 'production.view'. Admins hold all of them. */
  permissions: string[];
  job_title: string | null;
  staff_type?: 'master' | 'tailor' | 'staff' | null;
  /** A temporary password was set for this login: the person must choose their own before anything else. */
  must_change_password: boolean;
}

export interface AuthTokens {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export interface AppNotification {
  id: string;
  type: 'order' | 'update' | 'alert' | 'approval' | 'invoice' | 'logistics' | string;
  title: string;
  body: string | null;
  link: string | null;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
}

export type OrderStatus =
  | 'submitted' | 'received' | 'assigned' | 'cutting' | 'stitching' | 'qc_passed' | 'customer_approval'
  | 'packed' | 'invoice_issued' | 'awaiting_payment' | 'paid' | 'at_admin_warehouse' | 'partner_dispatch'
  | 'shipped' | 'delivered' | 'cancelled';

export type ListParams = Record<string, string | number | boolean | null | undefined>;
