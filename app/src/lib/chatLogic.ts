import type { Conversation, ConversationUpdate, Id, Message } from './types';
import { sameId } from './format';

/**
 * Pure chat helpers (no React, no network) so they can be unit-tested:
 * message merge/dedupe, optimistic sends, unread counts, conversation ordering, day separators.
 */

export type SendStatus = 'sending' | 'failed';

/** A message in the chat screen. Optimistic (not yet confirmed) ones have `status` and id `local:<clientId>`. */
export interface ChatItem extends Message {
  status?: SendStatus;
}

export const MAX_MESSAGE = 2000;

let seq = 0;
/** Unique per send attempt; reused when retrying so the server never stores the message twice. */
export function newClientId(now: number = Date.now(), rand: () => number = Math.random): string {
  seq = (seq + 1) % 1_000_000;
  return `c${now.toString(36)}${seq.toString(36)}${Math.floor(rand() * 1e9).toString(36)}`.slice(0, 64);
}

export function localId(clientId: string) {
  return `local:${clientId}`;
}

export function isLocal(m: { id: Id }) {
  return String(m.id).startsWith('local:');
}

/** Optimistic message shown right away while the POST is in flight. */
export function pendingMessage(p: {
  conversationId: Id; text: string; clientId: string; me: { id: Id; displayName: string; avatarUrl?: string | null }; now?: Date;
}): ChatItem {
  return {
    id: localId(p.clientId),
    conversationId: p.conversationId,
    sender: { id: p.me.id, displayName: p.me.displayName, avatarUrl: p.me.avatarUrl ?? null },
    text: p.text,
    createdAt: (p.now ?? new Date()).toISOString(),
    clientId: p.clientId,
    status: 'sending',
  };
}

function byTime(a: Message, b: Message) {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/**
 * Merge server messages into what the screen shows (oldest first).
 * - Dedupes by id (socket + poll + page can all deliver the same message).
 * - A confirmed message replaces the optimistic one with the same clientId (from the same sender).
 * - Confirmed messages are sorted by time; still-pending/failed ones stay at the bottom in send order.
 */
export function mergeMessages(current: ChatItem[], incoming: Message[]): ChatItem[] {
  const confirmed = new Map<string, ChatItem>();
  const pending: ChatItem[] = [];
  for (const m of current) {
    if (isLocal(m)) pending.push(m);
    else confirmed.set(String(m.id), m);
  }
  const confirmedKeys = new Set<string>();
  for (const m of incoming) {
    confirmed.set(String(m.id), { ...m, status: undefined });
  }
  for (const m of confirmed.values()) if (m.clientId) confirmedKeys.add(`${m.sender.id}|${m.clientId}`);
  const stillPending = pending.filter((p) => !(p.clientId && confirmedKeys.has(`${p.sender.id}|${p.clientId}`)));
  const sorted = [...confirmed.values()].sort(byTime);
  // drop the status key so equal objects stay equal
  for (const m of sorted) if (m.status === undefined) delete m.status;
  return [...sorted, ...stillPending];
}

/**
 * Merge the newest page (poll / catch-up after a reconnect). If that page does not touch what we
 * already have and there is more before it, we missed messages in between: start again from this
 * page (older ones load on scroll) instead of showing a hidden gap.
 */
export function mergeLatestPage(current: ChatItem[], page: { items: Message[]; hasMore: boolean }): ChatItem[] {
  const have = current.filter((m) => !isLocal(m));
  if (page.hasMore && have.length && page.items.length) {
    const ids = new Set(have.map((m) => String(m.id)));
    const overlaps = page.items.some((m) => ids.has(String(m.id)));
    const newestHave = have[have.length - 1];
    const allNewer = Date.parse(page.items[0].createdAt) > Date.parse(newestHave.createdAt);
    if (!overlaps && allNewer) return mergeMessages(current.filter(isLocal), page.items);
  }
  return mergeMessages(current, page.items);
}

/** Mark one optimistic message as sending/failed. */
export function setStatus(items: ChatItem[], clientId: string, status: SendStatus): ChatItem[] {
  return items.map((m) => (isLocal(m) && m.clientId === clientId ? { ...m, status } : m));
}

/** Remove an optimistic message (user discarded a failed send). */
export function dropPending(items: ChatItem[], clientId: string): ChatItem[] {
  return items.filter((m) => !(isLocal(m) && m.clientId === clientId));
}

/** Oldest confirmed message id: the `before` cursor for loading older messages. */
export function oldestId(items: ChatItem[]): Id | undefined {
  return items.find((m) => !isLocal(m))?.id;
}

// ---------- conversations & unread ----------

/** Clan chat pinned on top, then newest first. */
export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'clan' ? -1 : 1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function totalUnread(list: Conversation[] | null | undefined): number {
  return (list ?? []).reduce((n, c) => n + Math.max(0, c.unreadCount || 0), 0);
}

/** Tab-bar badge text: undefined when nothing is unread, "99+" for big numbers. */
export function badgeText(n: number): string | undefined {
  if (!n || n < 0) return undefined;
  return n > 99 ? '99+' : String(n);
}

/**
 * Apply a `conversation:updated` event. Unread goes up by one only for a message we have not counted
 * yet, from someone else, in a chat that is not open on screen. Returns `known: false` when the
 * conversation is not in the list (new DM, just joined a clan) so the caller reloads the list.
 */
export function applyConversationUpdate(
  list: Conversation[],
  u: ConversationUpdate,
  opts: { myId: Id | null | undefined; openId: Id | null | undefined },
): { list: Conversation[]; known: boolean } {
  const i = list.findIndex((c) => sameId(c.id, u.id));
  if (i < 0) return { list, known: false };
  const c = list[i];
  const isNew = !c.lastMessage || !sameId(c.lastMessage.id, u.lastMessage.id);
  const fromOther = !sameId(u.lastMessage.sender.id, opts.myId);
  const open = sameId(opts.openId, u.id);
  const newer = !c.lastMessage || Date.parse(u.lastMessage.createdAt) >= Date.parse(c.lastMessage.createdAt);
  const next: Conversation = {
    ...c,
    lastMessage: newer ? u.lastMessage : c.lastMessage,
    updatedAt: newer ? u.updatedAt : c.updatedAt,
    unreadCount: open ? 0 : c.unreadCount + (isNew && fromOther && newer ? 1 : 0),
  };
  const out = [...list];
  out[i] = next;
  return { list: sortConversations(out), known: true };
}

/** Locally zero the unread count of one conversation (opened / marked read). */
export function markReadLocal(list: Conversation[], id: Id): Conversation[] {
  return list.map((c) => (sameId(c.id, id) && c.unreadCount ? { ...c, unreadCount: 0 } : c));
}

// ---------- rows for the chat screen ----------

export type ChatRow =
  | { kind: 'day'; key: string; day: string }
  | { kind: 'msg'; key: string; msg: ChatItem; mine: boolean; firstOfRun: boolean; lastOfRun: boolean };

/** Local calendar day "YYYY-MM-DD". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const RUN_GAP_MS = 5 * 60 * 1000;

/**
 * Oldest-first rows with a day separator before each new day. A "run" is consecutive messages from
 * the same sender within 5 minutes: the name shows on the first, the avatar on the last.
 */
export function buildRows(items: ChatItem[], myId: Id | null | undefined): ChatRow[] {
  const rows: ChatRow[] = [];
  let lastDay = '';
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      rows.push({ kind: 'day', key: `day:${day}`, day });
      lastDay = day;
    }
    const prev = items[i - 1];
    const next = items[i + 1];
    const sameRun = (a?: ChatItem, b?: ChatItem) =>
      !!a && !!b && sameId(a.sender.id, b.sender.id) && dayKey(a.createdAt) === dayKey(b.createdAt)
      && Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) < RUN_GAP_MS;
    rows.push({
      kind: 'msg',
      key: m.clientId && isLocal(m) ? `c:${m.clientId}` : m.clientId ? `c:${m.clientId}` : `m:${m.id}`,
      msg: m,
      mine: sameId(m.sender.id, myId),
      firstOfRun: !sameRun(prev, m),
      lastOfRun: !sameRun(m, next),
    });
  }
  return rows;
}

/** "Today" / "Yesterday" / "28 October 2026" for a day separator. */
export function dayLabel(day: string, now: Date, words: { today: string; yesterday: string; months: string[] }): string {
  const today = dayKey(now.toISOString());
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === today) return words.today;
  if (day === dayKey(y.toISOString())) return words.yesterday;
  const [yy, mm, dd] = day.split('-').map(Number);
  const month = words.months[mm - 1] ?? String(mm);
  return yy === now.getFullYear() ? `${dd} ${month}` : `${dd} ${month} ${yy}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Time in the conversation list: "14:05" today, "Yesterday", else "28.10". */
export function listTime(iso: string, now: Date, yesterday: string): string {
  const day = dayKey(iso);
  if (day === dayKey(now.toISOString())) return formatTime(iso);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === dayKey(y.toISOString())) return yesterday;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** One-line preview: "You: …" for mine, "Rauf: …" in clan chats. */
export function previewText(c: Conversation, myId: Id | null | undefined, youLabel: string): string {
  const m = c.lastMessage;
  if (!m) return '';
  const text = m.text.replace(/\s+/g, ' ').trim();
  if (sameId(m.sender.id, myId)) return `${youLabel}: ${text}`;
  if (c.type === 'clan') return `${m.sender.displayName}: ${text}`;
  return text;
}
