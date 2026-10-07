import { Pipe, PipeTransform } from '@angular/core';

/** 12500 → "PKR 12,500" */
@Pipe({ name: 'pkr', standalone: true })
export class PkrPipe implements PipeTransform {
  transform(value: number | string | null | undefined, currency = 'PKR', decimals?: number): string {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    const digits = decimals ?? (currency === 'PKR' ? 0 : 2);
    return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
}

/** ISO date → "5 min ago", "3 h ago", "2 Oct" */
@Pipe({ name: 'timeAgo', standalone: true })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
}

/** ISO date → "16 Oct 2026" (or with time) */
@Pipe({ name: 'day', standalone: true })
export class DayPipe implements PipeTransform {
  transform(value: string | null | undefined, withTime = false): string {
    if (!value) return '—';
    const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return withTime ? `${day}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : day;
  }
}

/**
 * One meaning per colour, everywhere:
 *  ''      neutral — waiting on someone outside our team (customer parcel, draft)
 *  blue    in progress at the partner
 *  amber   needs action from staff or the customer
 *  green   done / money received
 *  purple  in transit / with the courier
 *  red     problem or cancelled
 */
const STATUS_TONES: Record<string, string> = {
  // orders
  submitted: '',
  received: 'blue',
  assigned: 'blue',
  cutting: 'blue',
  stitching: 'blue',
  qc: 'blue',
  qc_passed: 'blue',
  customer_approval: 'amber',
  packed: 'amber',
  invoice_issued: 'amber',
  awaiting_payment: 'amber',
  paid: 'green',
  at_admin_warehouse: 'purple',
  partner_dispatch: 'purple',
  shipped: 'purple',
  delivered: 'green',
  cancelled: 'red',
  // invoices / shipments / transfers / units
  draft: '',
  issued: 'amber',
  needs_label: 'amber',
  labelled: 'blue',
  handed_to_courier: 'purple',
  open: 'amber',
  in_transit: 'purple',
  pending: '',
  issue: 'red',
  // catalogue rows (brands, couriers, articles)
  active: 'green',
  inactive: '',
};

/** Badge colour class for a status value. */
export function statusTone(status: string | null | undefined): string {
  return STATUS_TONES[status || ''] ?? '';
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

@Pipe({ name: 'humanize', standalone: true })
export class HumanizePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return humanize(value);
  }
}
