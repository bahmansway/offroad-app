import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { friendRequests, friendships } from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';

export const MAX_FRIENDS = 1000;
export const MAX_PENDING_OUTGOING = 50;
/** After B declines A's request, A can't request B again for this long. */
export const FRIEND_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type Friendship = 'none' | 'friends' | 'outgoing' | 'incoming';

export async function areFriends(db: Db | Tx, a: string, b: string) {
  const [r] = await db
    .select({ x: friendships.userId })
    .from(friendships)
    .where(and(eq(friendships.userId, a), eq(friendships.friendId, b)))
    .limit(1);
  return !!r;
}

/** Ids among `ids` that are NOT friends of `me`. */
export async function notFriends(db: Db | Tx, me: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: friendships.friendId })
    .from(friendships)
    .where(and(eq(friendships.userId, me), inArray(friendships.friendId, ids)));
  const ok = new Set(rows.map((r) => r.id));
  return ids.filter((i) => !ok.has(i));
}

export async function friendCount(db: Db | Tx, userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(friendships).where(eq(friendships.userId, userId));
  return r.n;
}

export async function mutualFriendCount(db: Db | Tx, a: string, b: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(friendships)
    .where(
      and(
        eq(friendships.userId, a),
        sql`exists (select 1 from friendships f2 where f2.user_id = ${b} and f2.friend_id = ${friendships.friendId})`,
      ),
    );
  return r.n;
}

/** How `viewer` relates to `other`: friends, a pending request either way, or none. */
export async function friendshipState(
  db: Db | Tx,
  viewer: string | null,
  other: string,
): Promise<{ friendship: Friendship; requestId: string | null }> {
  if (!viewer || viewer === other) return { friendship: 'none', requestId: null };
  if (await areFriends(db, viewer, other)) return { friendship: 'friends', requestId: null };
  const [r] = await db
    .select({ id: friendRequests.id, fromId: friendRequests.fromId })
    .from(friendRequests)
    .where(
      and(
        isNull(friendRequests.declinedAt),
        or(
          and(eq(friendRequests.fromId, viewer), eq(friendRequests.toId, other)),
          and(eq(friendRequests.fromId, other), eq(friendRequests.toId, viewer)),
        ),
      ),
    )
    .limit(1);
  if (!r) return { friendship: 'none', requestId: null };
  return { friendship: r.fromId === viewer ? 'outgoing' : 'incoming', requestId: r.id };
}

/** Friendship fields added to the public user profile. */
export async function friendFields(db: Db, viewer: string | null, other: string) {
  const st = await friendshipState(db, viewer, other);
  return {
    friendship: st.friendship,
    requestId: st.requestId,
    friendCount: await friendCount(db, other),
    mutualFriends: viewer && viewer !== other ? await mutualFriendCount(db, viewer, other) : 0,
  };
}

/** Remove a friendship (both rows) and any requests between two users, e.g. when one blocks the other. */
export async function cutTies(db: Db | Tx, a: string, b: string) {
  await db
    .delete(friendships)
    .where(
      or(
        and(eq(friendships.userId, a), eq(friendships.friendId, b)),
        and(eq(friendships.userId, b), eq(friendships.friendId, a)),
      ),
    );
  await db
    .delete(friendRequests)
    .where(
      or(
        and(eq(friendRequests.fromId, a), eq(friendRequests.toId, b)),
        and(eq(friendRequests.fromId, b), eq(friendRequests.toId, a)),
      ),
    );
}

/** Pending incoming requests (badge), not counting users either side blocked. */
export async function incomingRequestCount(db: Db, me: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.toId, me),
        isNull(friendRequests.declinedAt),
        sql`not exists (select 1 from blocks b where (b.blocker_id = ${me} and b.blocked_id = ${friendRequests.fromId}) or (b.blocker_id = ${friendRequests.fromId} and b.blocked_id = ${me}))`,
      ),
    );
  return r.n;
}

/** SQL: neither the viewer nor `col` blocked the other. */
export const notBlockedSql = (viewer: string, col: unknown) =>
  sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer} and b.blocked_id = ${col}) or (b.blocker_id = ${col} and b.blocked_id = ${viewer}))`;

/** Escape a user string for ILIKE. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
