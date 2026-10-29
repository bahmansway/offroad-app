import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { blocks, conversationMembers, conversations, messages } from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';
import { userRef } from './users.js';

type MessageRow = typeof messages.$inferSelect;
export type Ref = ReturnType<typeof userRef>;

/**
 * Message as sent to the app (REST and socket).
 * - type 'user': text from sender.
 * - type 'system': sender null; the app renders systemKey + systemParams translated; text is an English fallback.
 * - deleted: deletedAt set, text '' (the original is never sent again).
 */
export const toMessage = (m: MessageRow, sender: Ref | null) => ({
  id: m.id,
  conversationId: m.conversationId,
  type: m.type,
  sender: m.type === 'system' ? null : sender,
  text: m.deletedAt ? '' : m.text,
  systemKey: m.systemKey,
  systemParams: m.systemParams ?? null,
  createdAt: m.createdAt.toISOString(),
  clientId: m.clientId,
  deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
});
export type Message = ReturnType<typeof toMessage>;

/** Keys of system messages (translated by the app). */
export const SYSTEM_KEYS = [
  'event.joined',
  'event.waitlisted',
  'event.left',
  'event.promoted',
  'event.removed',
  'event.cancelled',
  'event.edited',
] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

const name = (p: Record<string, unknown>) => String(p.displayName ?? 'Someone');
const fallback: Record<SystemKey, (p: Record<string, any>) => string> = {
  'event.joined': (p) => `${name(p)} joined the event`,
  'event.waitlisted': (p) => `${name(p)} joined the waitlist`,
  'event.left': (p) => `${name(p)} left the event`,
  'event.promoted': (p) => `${name(p)} moved from the waitlist to going`,
  'event.removed': (p) => `${name(p)} was removed by the organizer`,
  'event.cancelled': (p) => (p.reason ? `The event was cancelled: ${p.reason}` : 'The event was cancelled'),
  'event.edited': () => 'The organizer updated the event details',
};

/** Insert a system message (inside a transaction). Call `broadcastMessage` after commit. */
export async function insertSystemMessage(tx: Tx | Db, conversationId: string, key: SystemKey, params: Record<string, unknown>) {
  const [m] = await tx
    .insert(messages)
    .values({
      conversationId,
      senderId: null,
      type: 'system',
      systemKey: key,
      systemParams: params,
      text: fallback[key](params),
      // clock_timestamp (not now()): several system messages in one transaction keep their order
      createdAt: sql`clock_timestamp()`,
    })
    .returning();
  await tx.update(conversations).set({ updatedAt: m.createdAt }).where(eq(conversations.id, conversationId));
  return m;
}

/** Members of a conversation who blocked `userId`. */
export async function blockersInConversation(db: Db | Tx, conversationId: string, userId: string) {
  const rows = await db
    .select({ id: blocks.blockerId })
    .from(blocks)
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.userId, blocks.blockerId), eq(conversationMembers.conversationId, conversationId)),
    )
    .where(eq(blocks.blockedId, userId));
  return rows.map((r) => r.id);
}

/** Push a stored message to the conversation room (message:new + conversation:updated). */
export async function broadcastMessage(app: FastifyInstance, m: MessageRow, sender: Ref | null) {
  const msg = toMessage(m, sender);
  // Members who blocked the sender don't get it.
  const except = m.senderId ? await blockersInConversation(app.db, m.conversationId, m.senderId) : [];
  app.realtime.toConversation(m.conversationId, 'message:new', msg, except);
  app.realtime.toConversation(
    m.conversationId,
    'conversation:updated',
    { id: m.conversationId, lastMessage: msg, updatedAt: m.createdAt.toISOString() },
    except,
  );
  return msg;
}
