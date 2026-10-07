/** Conversation shapes. See backend/API.md ("Conversations" and "Real time"). */

export type SenderRole = 'customer' | 'partner_staff' | 'admin';
export type MessageKind = 'text' | 'voice';

export interface MessageAudio {
  mime: string;
  duration: number;
  size: number | null;
  /** Signed link, valid for about an hour (absent while a message is still being sent). */
  url?: string | null;
}

export interface ChatMessage {
  id: string;
  order_id: string;
  sender_id: string;
  sender_role: SenderRole;
  sender_name: string | null;
  kind: MessageKind;
  body: string | null;
  audio: MessageAudio | null;
  client_msg_id: string | null;
  read_at: string | null;
  created_at: string;
  /** The article this message is about; null/absent = the order's General chat. */
  unit_id?: string | null;
}

/** A message as the panel shows it: server messages plus local ones that are still sending or failed. */
export type SendState = 'sending' | 'sent' | 'failed';
export interface UiMessage extends ChatMessage {
  state: SendState;
  /** Set on failure so the bubble can say why. */
  error?: string;
}

export interface AudioRef {
  path: string;
  duration: number;
  mime: string;
  size: number;
}

/** Payload for POST /orders/:id/messages and the `message:send` socket event. */
export type OutgoingMessage =
  | { kind: 'text'; body: string; client_msg_id: string; unit_id?: string }
  | { kind: 'voice'; audio: AudioRef; client_msg_id: string; unit_id?: string };

/** Chat scope: 'general' (the order's own chat) or an article (unit) id. */
export const GENERAL_SCOPE = 'general';
export const scopeOf = (m: { unit_id?: string | null }): string => m.unit_id || GENERAL_SCOPE;

/** One chat of an order (General or one article) with its unread count. */
export interface ConversationScope {
  unit_id: string | null;
  title: string;
  line_no: number | null;
  image_url: string | null;
  unread: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_role: SenderRole | null;
}

/** GET /partner/orders/:id/conversation */
export interface OrderConversation {
  scopes: ConversationScope[];
  unread: number;
}

/**
 * A voice note next to a text note. Right after recording it has the stored reference (`path`) and a playable `url`;
 * a note read back from the API has `{ mime, duration, size, url }` only (no `path`).
 */
export interface VoiceNote {
  path?: string;
  duration: number;
  mime: string;
  size: number | null;
  url?: string | null;
}

/** What to send for a note field: the reference when freshly recorded, otherwise leave the field out (keeps a saved one). */
export function voicePayload(v: VoiceNote | null | undefined): AudioRef | undefined {
  return v?.path ? { path: v.path, duration: v.duration, mime: v.mime, size: v.size ?? 0 } : undefined;
}

export interface VoiceUpload extends AudioRef {
  url: string;
}

export interface MessagesPage {
  items: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** One existing chat of an order in the inbox: General (`unit_id: null`) or one article. */
export interface ConversationChat {
  unit_id: string | null;
  title: string;
  line_no?: number | null;
  unread: number;
  last_message_at?: string | null;
  last_message_preview?: string | null;
}

export interface Conversation {
  order_id: string;
  reference: string;
  brand: string | null;
  status: string;
  status_label: string;
  customer_name: string | null;
  customer_code: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_role: SenderRole | null;
  unread: number;
  /** The chats that have messages (shortcuts under the order row). */
  chats?: ConversationChat[];
}

/** Context for the thread header when the conversation is not (yet) in the inbox list. */
export interface ConversationHeader {
  order_id: string;
  reference: string | null;
  customer_name: string | null;
  customer_code: string | null;
  status: string | null;
  status_label: string | null;
}

// ── Socket.IO ──
export interface ReadPayload {
  orderId: string;
  /** Which chat was read: an article id, or `general: true` for the order's own chat. */
  unitId?: string | null;
  general?: boolean;
  readerRole: SenderRole;
  readAt: string;
  count: number;
}

export interface TypingPayload {
  orderId: string;
  unitId?: string | null;
  userId: string;
  name: string | null;
  role: SenderRole;
  typing: boolean;
}

export interface InboxPayload {
  orderId: string;
}

export interface ServerEvents {
  'message:new': ChatMessage;
  'message:read': ReadPayload;
  typing: TypingPayload;
  'inbox:update': InboxPayload;
  'notification:new': Record<string, never>;
}

export type SendAck = { ok: true; message: ChatMessage; duplicate?: boolean } | { ok: false; error: string; status?: number };
