import { and, eq, isNull, sql } from 'drizzle-orm';
import { clanInvites } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { incomingRequestCount } from './friends.js';
import { unreadTotal } from '../routes/chat.js';

/** Tab badges: unread messages, pending incoming friend requests, pending clan invites. */
export async function badgeCounts(db: Db, me: string) {
  const [inv] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clanInvites)
    .where(and(eq(clanInvites.userId, me), isNull(clanInvites.declinedAt), sql`${clanInvites.expiresAt} > now()`));
  return {
    messages: await unreadTotal(db, me),
    friendRequests: await incomingRequestCount(db, me),
    clanInvites: inv.n,
  };
}

/** The number on the iOS app icon: the same three counts added up. */
export async function appBadge(db: Db, me: string) {
  const b = await badgeCounts(db, me);
  return b.messages + b.friendRequests + b.clanInvites;
}
