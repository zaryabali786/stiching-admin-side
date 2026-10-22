import { BrandOrderState, CommissionStatus, FulfillmentStatus, ShopOrderStatus, ShopPaymentStatus } from '../../../core/services/shop-admin.service';

type Tone = '' | 'green' | 'amber' | 'red' | 'gold' | 'blue';

/** 1234.5, "USD" -> "USD 1,234.50" (the order's own currency: the Shop is not always in PKR). */
export function money(value: number | string | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${currency ? currency + ' ' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function priceRange(min: number | null, max: number | null, currency: string | null): string {
  if (min === null || min === undefined) return '—';
  return max !== null && max !== undefined && max !== min ? `${money(min, currency)} – ${money(max, null)}` : money(min, currency);
}

export const ORDER_STATUSES: { value: ShopOrderStatus; label: string }[] = [
  { value: 'pending_payment', label: 'Awaiting payment' },
  { value: 'payment_failed', label: 'Payment failed' },
  { value: 'processing', label: 'Processing' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'partially_dispatched', label: 'Partly dispatched' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function orderTone(s: ShopOrderStatus): Tone {
  switch (s) {
    case 'delivered':
    case 'confirmed':
      return 'green';
    case 'dispatched':
    case 'partially_dispatched':
      return 'blue';
    case 'attention':
    case 'payment_failed':
    case 'cancelled':
      return 'red';
    case 'pending_payment':
    case 'processing':
      return 'amber';
    default:
      return '';
  }
}

export function paymentTone(s: ShopPaymentStatus): Tone {
  return s === 'paid' ? 'green' : s === 'failed' ? 'red' : s === 'unpaid' ? 'amber' : 'gold';
}

export function paymentLabel(s: ShopPaymentStatus): string {
  return { unpaid: 'Unpaid', paid: 'Paid', failed: 'Payment failed', refunded: 'Refunded', partially_refunded: 'Partly refunded' }[s] ?? s;
}

export function brandStateTone(s: BrandOrderState): Tone {
  return s === 'created' ? 'green' : s === 'failed' ? 'red' : s === 'cancelled' ? '' : 'amber';
}

export function brandStateLabel(s: BrandOrderState): string {
  return { pending: 'Waiting to be sent to the brand', creating: 'Sending to the brand…', created: 'Created in the brand\'s store', failed: 'Could not be created', cancelled: 'Cancelled' }[s] ?? s;
}

/** Only a verified delivery is called delivered; anything else says what was last confirmed and that delivery is not verified. */
export function fulfilmentLabel(status: FulfillmentStatus, verified: boolean): string {
  if (status === 'delivered' && verified) return 'Delivered (verified)';
  const base = { unfulfilled: 'Not dispatched yet', partial: 'Partly dispatched', dispatched: 'Dispatched', delivered: 'Marked delivered' }[status] ?? status;
  return status === 'unfulfilled' ? base : `${base} · delivery not verified`;
}

export const COMMISSION_LABELS: Record<CommissionStatus, string> = {
  estimated: 'Estimated',
  pending: 'Pending',
  settled: 'Settled',
  reversed: 'Reversed',
  disputed: 'Disputed',
};

export function commissionTone(s: CommissionStatus): Tone {
  return s === 'settled' ? 'green' : s === 'pending' ? 'amber' : s === 'disputed' || s === 'reversed' ? 'red' : '';
}

export function commissionTerms(model: string, rate: number, fixed: number, currency?: string | null): string {
  return model === 'fixed' ? `${money(fixed, currency)} per order` : `${Number(rate)}%`;
}

/** Save a downloaded file (an authenticated blob) under a name. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
