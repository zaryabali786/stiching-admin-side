import { ChatMessage, MessageAudio, UiMessage } from '../../../core/models/chat.models';

/** Pure helpers for the conversation panel (kept free of Angular so they are easy to test). */

export const MAX_TEXT = 4000;
export const MAX_VOICE_SECONDS = 300;
export const MIN_VOICE_SECONDS = 1;

/** RFC 4122 v4 id for `client_msg_id` (the server de-duplicates retries by it). */
export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

export function isLocal(m: UiMessage): boolean {
  return m.state !== 'sent';
}

/** Index of the message that `incoming` is (same server id, or same client_msg_id as one we sent). */
export function findMatch(list: readonly UiMessage[], incoming: Pick<ChatMessage, 'id' | 'client_msg_id'>): number {
  return list.findIndex(
    (m) => m.id === incoming.id || (!!incoming.client_msg_id && !!m.client_msg_id && m.client_msg_id === incoming.client_msg_id)
  );
}

/**
 * Add or replace one server message. A message we already show (by id, or by client_msg_id while it was
 * still sending) is replaced in place; a new one is placed by time among the saved messages, ahead of
 * anything still pending, so our own unsent bubbles stay at the bottom.
 */
export function upsertMessage(list: readonly UiMessage[], incoming: ChatMessage): UiMessage[] {
  const next: UiMessage = { ...incoming, state: 'sent' };
  const at = findMatch(list, incoming);
  if (at >= 0) {
    const copy = list.slice();
    copy[at] = next;
    return copy;
  }
  let insertAt = list.length;
  while (insertAt > 0 && isLocal(list[insertAt - 1])) insertAt--; // skip trailing pending bubbles
  while (insertAt > 0 && list[insertAt - 1].created_at > incoming.created_at) insertAt--;
  const copy = list.slice();
  copy.splice(insertAt, 0, next);
  return copy;
}

/** Merge a fetched page (latest or older) into the list without duplicates; the page wins for shared ids. */
export function mergePage(list: readonly UiMessage[], page: readonly ChatMessage[]): UiMessage[] {
  let out = list.slice();
  for (const m of page) out = upsertMessage(out, m);
  return out;
}

export function optimisticText(orderId: string, sender: { id: string; role: ChatMessage['sender_role']; name: string | null }, body: string, clientMsgId: string, unitId: string | null = null): UiMessage {
  return {
    id: `local:${clientMsgId}`,
    order_id: orderId,
    sender_id: sender.id,
    sender_role: sender.role,
    sender_name: sender.name,
    kind: 'text',
    body,
    audio: null,
    client_msg_id: clientMsgId,
    read_at: null,
    created_at: new Date().toISOString(),
    unit_id: unitId,
    state: 'sending',
  };
}

export function optimisticVoice(orderId: string, sender: { id: string; role: ChatMessage['sender_role']; name: string | null }, audio: MessageAudio, clientMsgId: string, unitId: string | null = null): UiMessage {
  return { ...optimisticText(orderId, sender, '', clientMsgId, unitId), kind: 'voice', body: null, audio };
}

export function setState(list: readonly UiMessage[], clientMsgId: string, state: UiMessage['state'], error?: string): UiMessage[] {
  return list.map((m) => (m.client_msg_id === clientMsgId && m.state !== 'sent' ? { ...m, state, error } : m));
}

/** Staff messages become "seen" when the customer reads the conversation. */
export function markSeen(list: readonly UiMessage[], isMine: (m: UiMessage) => boolean, readAt: string): UiMessage[] {
  return list.map((m) => (isMine(m) && m.state === 'sent' && !m.read_at ? { ...m, read_at: readAt } : m));
}

export type ChatRow =
  | { type: 'day'; key: string; label: string }
  | { type: 'msg'; key: string; m: UiMessage; mine: boolean; showName: boolean; seen: boolean };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** Messages with day separators, sender names on the first bubble of a run, and "Seen" under my last read message. */
export function buildRows(list: readonly UiMessage[], isMine: (m: UiMessage) => boolean, now: Date = new Date()): ChatRow[] {
  const rows: ChatRow[] = [];
  let lastDay = '';
  let prev: UiMessage | null = null;
  let lastSeenId = '';
  for (let i = list.length - 1; i >= 0; i--) {
    if (isMine(list[i]) && list[i].state === 'sent') {
      if (list[i].read_at) lastSeenId = list[i].id;
      break;
    }
  }
  for (const m of list) {
    const k = dayKey(m.created_at);
    if (k !== lastDay) {
      rows.push({ type: 'day', key: `day:${k}`, label: dayLabel(m.created_at, now) });
      lastDay = k;
      prev = null;
    }
    const mine = isMine(m);
    const sameRun = !!prev && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
    rows.push({ type: 'msg', key: m.id, m, mine, showName: !sameRun, seen: m.id === lastSeenId });
    prev = m;
  }
  return rows;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
