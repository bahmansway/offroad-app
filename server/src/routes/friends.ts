import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { follows, friendRequests, friendships, users } from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { makeLimiter } from '../lib/limits.js';
import { eitherBlocked, userRef, userRefCols } from '../lib/users.js';
import {
  FRIEND_REQUEST_COOLDOWN_MS,
  MAX_FRIENDS,
  MAX_PENDING_OUTGOING,
  areFriends,
  friendCount,
  likePattern,
  notBlockedSql,
  lockPair,
} from '../lib/friends.js';
import { badgeCounts } from '../lib/badges.js';
import { addFollows, cutFollows } from '../lib/follows.js';

type ReqRow = typeof friendRequests.$inferSelect;

const requestSchema = z.object({ userId: z.uuid() }).strict();
const dirQuery = z.object({ dir: z.enum(['in', 'out']).default('in') });
const listQuery = z.object({ q: z.string().trim().max(40).optional() });

async function refOf(db: Db | Tx, id: string) {
  const [u] = await db.select(userRefCols).from(users).where(eq(users.id, id));
  return u ? userRef(u) : null;
}

async function toRequest(db: Db | Tx, r: ReqRow) {
  return { id: r.id, from: await refOf(db, r.fromId), to: await refOf(db, r.toId), createdAt: r.createdAt.toISOString() };
}

async function makeFriends(tx: Tx, a: string, b: string) {
  if ((await friendCount(tx, a)) >= MAX_FRIENDS || (await friendCount(tx, b)) >= MAX_FRIENDS) {
    throw conflict(`At most ${MAX_FRIENDS} friends`);
  }
  await tx
    .insert(friendships)
    .values([
      { userId: a, friendId: b },
      { userId: b, friendId: a },
    ])
    .onConflictDoNothing();
  // v6: friends = mutual follows (the friends endpoints are deprecated but keep both in sync)
  await addFollows(tx, [
    { follower: a, followee: b },
    { follower: b, followee: a },
  ]);
}

export async function friendRoutes(app: FastifyInstance) {
  const db = app.db;
  const requestLimit = makeLimiter(app, {
    max: app.config.rateLimits.friendRequests,
    timeWindow: '1 hour',
    key: (req) => `friendreq:${req.userId}`,
  });

  const notifyAccepted = async (a: string, b: string) => {
    const [ra, rb] = [await refOf(db, a), await refOf(db, b)];
    app.realtime.toUser(a, 'friend:accepted', { user: rb });
    app.realtime.toUser(b, 'friend:accepted', { user: ra });
  };

  // Send a request. If they already asked me, this accepts theirs instead.
  app.post('/friends/requests', { preHandler: [app.authenticate, requestLimit] }, async (req, reply) => {
    const { userId } = parse(requestSchema, req.body);
    const me = req.userId!;
    if (userId === me) throw badRequest('You cannot send a friend request to yourself');
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw notFound('User not found');
    if (await eitherBlocked(db, me, userId)) throw forbidden('You cannot send a friend request to this user');
    const result = await db.transaction(async (tx) => {
      await lockPair(tx, me, userId);
      // re-check under the lock: a block may have landed after the first check
      if (await eitherBlocked(tx, me, userId)) throw forbidden('You cannot send a friend request to this user');
      if (await areFriends(tx, me, userId)) throw conflict('You are already friends');
      const [incoming] = await tx
        .select()
        .from(friendRequests)
        .where(and(eq(friendRequests.fromId, userId), eq(friendRequests.toId, me), isNull(friendRequests.declinedAt)));
      if (incoming) {
        await makeFriends(tx, me, userId);
        await tx.delete(friendRequests).where(eq(friendRequests.id, incoming.id));
        return { accepted: true as const, request: null };
      }
      const [mine] = await tx
        .select()
        .from(friendRequests)
        .where(and(eq(friendRequests.fromId, me), eq(friendRequests.toId, userId)));
      if (mine && !mine.declinedAt) throw conflict('You already sent a friend request to this user');
      if (mine?.declinedAt) {
        if (Date.now() - mine.declinedAt.getTime() < FRIEND_REQUEST_COOLDOWN_MS) {
          throw conflict('This user declined your request recently; try again in 24 hours');
        }
        await tx.delete(friendRequests).where(eq(friendRequests.id, mine.id));
      }
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(friendRequests)
        .where(and(eq(friendRequests.fromId, me), isNull(friendRequests.declinedAt)));
      if (n.n >= MAX_PENDING_OUTGOING) throw conflict(`At most ${MAX_PENDING_OUTGOING} pending friend requests`);
      if ((await friendCount(tx, me)) >= MAX_FRIENDS) throw conflict(`At most ${MAX_FRIENDS} friends`);
      const [row] = await tx.insert(friendRequests).values({ fromId: me, toId: userId }).returning();
      // v6: a friend request is a follow from the requester
      await addFollows(tx, [{ follower: me, followee: userId }]);
      return { accepted: false as const, request: row };
    });
    const user = await refOf(db, userId);
    if (result.accepted) {
      await notifyAccepted(me, userId);
      // they had asked me first: tell them I accepted
      const meRef = await refOf(db, me);
      if (meRef) app.notify.friendAccepted(userId, meRef);
      return reply.status(200).send({ status: 'friends', request: null, user });
    }
    const payload = await toRequest(db, result.request);
    app.realtime.toUser(userId, 'friend:request', payload);
    if (payload.from) app.notify.friendRequest(userId, payload.from);
    return reply.status(201).send({ status: 'pending', request: payload, user });
  });

  app.get('/friends/requests', { preHandler: app.authenticate }, async (req) => {
    const { dir } = parse(dirQuery, req.query);
    const me = req.userId!;
    const other = dir === 'in' ? friendRequests.fromId : friendRequests.toId;
    const rows = await db
      .select({ r: friendRequests, ...userRefCols })
      .from(friendRequests)
      .innerJoin(users, eq(users.id, other))
      .where(
        and(
          eq(dir === 'in' ? friendRequests.toId : friendRequests.fromId, me),
          isNull(friendRequests.declinedAt),
          notBlockedSql(me, other),
        ),
      )
      .orderBy(desc(friendRequests.createdAt))
      .limit(200);
    const meRef = await refOf(db, me);
    return {
      items: rows.map((r) => ({
        id: r.r.id,
        from: dir === 'in' ? userRef(r) : meRef,
        to: dir === 'in' ? meRef : userRef(r),
        createdAt: r.r.createdAt.toISOString(),
      })),
    };
  });

  /** My pending incoming request (404 otherwise). */
  const incoming = async (tx: Tx | Db, id: string, me: string) => {
    const [r] = await tx
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.id, id), eq(friendRequests.toId, me), isNull(friendRequests.declinedAt)))
      .limit(1);
    if (!r) throw notFound('Friend request not found');
    return r;
  };

  app.post('/friends/requests/:id/accept', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const r0 = await incoming(db, id, me);
    if (await eitherBlocked(db, me, r0.fromId)) throw forbidden('You cannot accept this request');
    await db.transaction(async (tx) => {
      await lockPair(tx, me, r0.fromId);
      const r = await incoming(tx, id, me); // cancelled (or removed by a block) meanwhile -> 404
      if (await eitherBlocked(tx, me, r.fromId)) throw forbidden('You cannot accept this request');
      await makeFriends(tx, me, r.fromId);
      await tx.delete(friendRequests).where(eq(friendRequests.id, id));
      // a crossing request of mine (if any) is no longer needed
      await tx.delete(friendRequests).where(and(eq(friendRequests.fromId, me), eq(friendRequests.toId, r.fromId)));
    });
    await notifyAccepted(me, r0.fromId);
    const meRef = await refOf(db, me);
    if (meRef) app.notify.friendAccepted(r0.fromId, meRef);
    return { status: 'friends', user: await refOf(db, r0.fromId) };
  });

  app.post('/friends/requests/:id/decline', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const me = req.userId!;
    await incoming(db, id, me);
    // kept for the 24 h cooldown; hidden from both lists
    await db
      .update(friendRequests)
      .set({ declinedAt: new Date() })
      .where(and(eq(friendRequests.id, id), eq(friendRequests.toId, me), isNull(friendRequests.declinedAt)));
    return reply.status(204).send();
  });

  // Cancel my own outgoing request.
  app.delete('/friends/requests/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const del = await db
      .delete(friendRequests)
      .where(and(eq(friendRequests.id, id), eq(friendRequests.fromId, req.userId!), isNull(friendRequests.declinedAt)))
      .returning({ id: friendRequests.id, toId: friendRequests.toId });
    if (!del.length) throw notFound('Friend request not found');
    // v6: cancelling the request also takes back the follow it created
    await db.delete(follows).where(and(eq(follows.followerId, req.userId!), eq(follows.followeeId, del[0].toId)));
    return reply.status(204).send();
  });

  app.get('/friends', { preHandler: app.authenticate }, async (req) => {
    const q = parse(listQuery, req.query);
    const me = req.userId!;
    const rows = await db
      .select({ ...userRefCols, since: friendships.createdAt })
      .from(friendships)
      .innerJoin(users, eq(users.id, friendships.friendId))
      .where(
        and(
          eq(friendships.userId, me),
          q.q ? ilike(users.displayName, likePattern(q.q)) : undefined,
          notBlockedSql(me, friendships.friendId),
        ),
      )
      .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id))
      .limit(MAX_FRIENDS);
    return { items: rows.map((r) => ({ user: userRef(r), since: r.since.toISOString() })) };
  });

  app.delete('/friends/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const other = idParam(req.params, 'userId');
    const me = req.userId!;
    await db.delete(friendships).where(
      sql`(${friendships.userId} = ${me} and ${friendships.friendId} = ${other}) or (${friendships.userId} = ${other} and ${friendships.friendId} = ${me})`,
    );
    // v6: unfriend (old app) = no longer following each other
    await cutFollows(db, me, other);
    return reply.status(204).send();
  });

  // Tab badges in one call.
  app.get('/me/badges', { preHandler: app.authenticate }, async (req) => badgeCounts(db, req.userId!));
}
