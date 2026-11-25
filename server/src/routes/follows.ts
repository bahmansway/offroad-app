import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { follows, users } from '../db/schema.js';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { makeLimiter } from '../lib/limits.js';
import { eitherBlocked } from '../lib/users.js';
import { imageUrl } from '../lib/images.js';
import { likePattern, lockPair } from '../lib/friends.js';
import {
  MAX_FOLLOWING,
  decodeCursor,
  encodeCursor,
  cursorId,
  followFields,
  followsSql,
  followedBySql,
  isFollowing,
  markFollowersSeen,
} from '../lib/follows.js';
import { noBlockSql, pageLimit } from '../lib/posts.js';

const listQuery = z
  .object({
    cursor: z.string().max(400).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    q: z.string().trim().max(40).optional(),
  });
const pageQuery = listQuery.omit({ q: true });

const ACTIVITY_KEY_RE = /^(like:[0-9a-f-]{36}:[0-9a-f-]{36}|comment:[0-9a-f-]{36}|follow:[0-9a-f-]{36})$/;

export async function followRoutes(app: FastifyInstance) {
  const db = app.db;
  const followLimit = makeLimiter(app, { max: 100, timeWindow: '1 hour', key: (req) => `follow:${req.userId}` });

  const state = async (me: string, other: string) => {
    const f = await followFields(db, me, other);
    return { isFollowing: f.isFollowing, followsMe: f.followsMe, followerCount: f.followerCount, followingCount: f.followingCount };
  };

  // Follow someone (no approval). Idempotent.
  app.post('/users/:id/follow', { preHandler: [app.authenticate, followLimit] }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    if (id === me) throw badRequest('You cannot follow yourself');
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw notFound('User not found');
    const created = await db.transaction(async (tx) => {
      // same lock as blocks, so a block can't slip in between the check and the insert
      await lockPair(tx, me, id);
      if (await eitherBlocked(tx, me, id)) throw forbidden('You cannot follow this user');
      if (await isFollowing(tx, me, id)) return false;
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, me));
      if (n.n >= MAX_FOLLOWING) throw conflict(`You can follow at most ${MAX_FOLLOWING} people`);
      await tx.insert(follows).values({ followerId: me, followeeId: id }).onConflictDoNothing();
      return true;
    });
    if (created) {
      const [meRow] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, me));
      if (meRow) app.notify.followed(id, meRow);
    }
    return state(me, id);
  });

  app.delete('/users/:id/follow', { preHandler: [app.authenticate, followLimit] }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw notFound('User not found');
    await db.delete(follows).where(and(eq(follows.followerId, me), eq(follows.followeeId, id)));
    return state(me, id);
  });

  /** Followers (dir 'followers') or following (dir 'following') of :id, newest first, searchable. */
  const people = (dir: 'followers' | 'following') => async (req: any) => {
    const id = idParam(req.params);
    const q = parse(listQuery, req.query);
    const viewer: string | null = req.userId;
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw notFound('User not found');
    if (viewer && viewer !== id && (await eitherBlocked(db, viewer, id))) return { items: [], nextCursor: null };
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const other = dir === 'followers' ? sql.raw('f.follower_id') : sql.raw('f.followee_id');
    const self = dir === 'followers' ? sql.raw('f.followee_id') : sql.raw('f.follower_id');
    const r = await db.execute<{
      id: string;
      display_name: string;
      avatar_image_id: string | null;
      city: string | null;
      created_at: Date | string;
      is_following: boolean;
      follows_me: boolean;
    }>(sql`
      select u.id, u.display_name, u.avatar_image_id, u.city, f.created_at,
        ${viewer ? followsSql(viewer, sql.raw('u.id')) : sql`false`} as is_following,
        ${viewer ? followedBySql(viewer, sql.raw('u.id')) : sql`false`} as follows_me
      from follows f join users u on u.id = ${other}
      where ${self} = ${id}
        and ${noBlockSql(viewer, 'u.id')}
        ${q.q ? sql`and u.display_name ilike ${likePattern(q.q)}` : sql``}
        ${cur ? sql`and (f.created_at, ${other}) < (${cur.at}::timestamptz, ${cursorId(cur.key)}::uuid)` : sql``}
      order by f.created_at desc, ${other} desc
      limit ${limit + 1}`);
    const rows = r.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((x) => ({
        user: { id: x.id, displayName: x.display_name, avatarUrl: imageUrl(x.avatar_image_id), city: x.city },
        isFollowing: !!x.is_following,
        followsMe: !!x.follows_me,
        isMe: x.id === viewer,
        since: new Date(x.created_at).toISOString(),
      })),
      nextCursor: r.rows.length > limit && last ? encodeCursor(new Date(last.created_at), last.id) : null,
    };
  };
  app.get('/users/:id/followers', people('followers'));
  app.get('/users/:id/following', people('following'));

  // Badge: "new followers since last viewed" goes back to 0.
  app.post('/me/followers/seen', { preHandler: app.authenticate }, async (req, reply) => {
    await markFollowersSeen(db, req.userId!);
    return reply.status(204).send();
  });

  // Bell: likes and comments on my posts, new followers. Newest first; blocks either way left out.
  app.get('/me/activity', { preHandler: app.authenticate }, async (req) => {
    const q = parse(pageQuery, req.query);
    const me = req.userId!;
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    if (cur && !ACTIVITY_KEY_RE.test(cur.key)) throw badRequest('cursor: invalid');
    const r = await db.execute<{
      type: 'like' | 'comment' | 'follow';
      actor_id: string;
      post_id: string | null;
      comment_id: string | null;
      text: string | null;
      created_at: Date | string;
      k: string;
      display_name: string;
      avatar_image_id: string | null;
      thumb: string | null;
      is_following: boolean;
    }>(sql`
      select a.*, u.display_name, u.avatar_image_id,
        (select ph.image_id from post_photos ph where ph.post_id = a.post_id order by ph.idx limit 1) as thumb,
        ${followsSql(me, sql.raw('a.actor_id'))} as is_following
      from (
        select 'like' as type, l.user_id as actor_id, l.post_id, null::uuid as comment_id, null::text as text, l.created_at,
          'like:' || l.post_id || ':' || l.user_id as k
        from post_likes l join posts p on p.id = l.post_id
        where p.author_id = ${me} and p.published_at is not null and l.user_id <> ${me}
        union all
        select 'comment', c.author_id, c.post_id, c.id, c.text, c.created_at, 'comment:' || c.id
        from post_comments c join posts p on p.id = c.post_id
        where p.author_id = ${me} and p.published_at is not null and c.author_id <> ${me}
        union all
        select 'follow', f.follower_id, null, null, null, f.created_at, 'follow:' || f.follower_id
        from follows f where f.followee_id = ${me}
      ) a
      join users u on u.id = a.actor_id
      where ${noBlockSql(me, 'a.actor_id')}
        ${cur ? sql`and (a.created_at, a.k) < (${cur.at}::timestamptz, ${cur.key})` : sql``}
      order by a.created_at desc, a.k desc
      limit ${limit + 1}`);
    const rows = r.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((x) => ({
        id: x.k,
        type: x.type,
        actor: { id: x.actor_id, displayName: x.display_name, avatarUrl: imageUrl(x.avatar_image_id) },
        post: x.post_id ? { id: x.post_id, photoUrl: imageUrl(x.thumb) } : null,
        comment: x.comment_id ? { id: x.comment_id, text: x.text ?? '' } : null,
        isFollowing: !!x.is_following,
        createdAt: new Date(x.created_at).toISOString(),
      })),
      nextCursor: r.rows.length > limit && last ? encodeCursor(new Date(last.created_at), last.k) : null,
    };
  });
}
