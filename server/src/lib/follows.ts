import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { follows, followersSeen, posts } from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';
import { badRequest, conflict } from './errors.js';

/** Most people one user can follow. */
export const MAX_FOLLOWING = 5000;

/** 409 when `follower` doesn't follow `followee` yet and already follows the maximum number of people. */
export async function checkFollowLimit(db: Db | Tx, follower: string, followee: string) {
  if (await isFollowing(db, follower, followee)) return;
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, follower));
  if (n.n >= MAX_FOLLOWING) throw conflict(`You can follow at most ${MAX_FOLLOWING} people`);
}

/** Insert follows (idempotent). Self-follows are ignored. */
export async function addFollows(db: Db | Tx, pairs: { follower: string; followee: string }[]) {
  const rows = pairs.filter((p) => p.follower !== p.followee).map((p) => ({ followerId: p.follower, followeeId: p.followee }));
  if (rows.length) await db.insert(follows).values(rows).onConflictDoNothing();
}

/** Remove follows both ways between two users (blocks, old "unfriend"). */
export async function cutFollows(db: Db | Tx, a: string, b: string) {
  await db
    .delete(follows)
    .where(
      or(
        and(eq(follows.followerId, a), eq(follows.followeeId, b)),
        and(eq(follows.followerId, b), eq(follows.followeeId, a)),
      ),
    );
}

export async function isFollowing(db: Db | Tx, follower: string, followee: string) {
  const [r] = await db
    .select({ x: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, follower), eq(follows.followeeId, followee)))
    .limit(1);
  return !!r;
}

/** Ids among `ids` that do NOT follow each other with `me` ("Dost" = mutual follow). */
export async function notMutual(db: Db | Tx, me: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: follows.followeeId })
    .from(follows)
    .where(
      and(
        eq(follows.followerId, me),
        inArray(follows.followeeId, ids),
        sql`exists (select 1 from follows f2 where f2.follower_id = ${follows.followeeId} and f2.followee_id = ${me})`,
      ),
    );
  const ok = new Set(rows.map((r) => r.id));
  return ids.filter((i) => !ok.has(i));
}

/** SQL boolean: `viewer` follows `col`. */
export const followsSql = (viewer: string, col: unknown) =>
  sql<boolean>`exists (select 1 from follows f where f.follower_id = ${viewer} and f.followee_id = ${col})`;
/** SQL boolean: `col` follows `viewer`. */
export const followedBySql = (viewer: string, col: unknown) =>
  sql<boolean>`exists (select 1 from follows f where f.follower_id = ${col} and f.followee_id = ${viewer})`;

/** Counts + relation shown on the public profile (v6). */
export async function followFields(db: Db, viewer: string | null, other: string) {
  const r = await db.execute<{ followers: number; following: number; posts: number; is_following: boolean; follows_me: boolean }>(sql`
    select
      (select count(*)::int from follows where followee_id = ${other}) as followers,
      (select count(*)::int from follows where follower_id = ${other}) as following,
      (select count(*)::int from ${posts} p where p.author_id = ${other} and p.published_at is not null) as posts,
      ${viewer && viewer !== other ? followsSql(viewer, sql`${other}::uuid`) : sql`false`} as is_following,
      ${viewer && viewer !== other ? followedBySql(viewer, sql`${other}::uuid`) : sql`false`} as follows_me`);
  const row = r.rows[0];
  return {
    followerCount: Number(row.followers),
    followingCount: Number(row.following),
    postCount: Number(row.posts),
    isFollowing: !!row.is_following,
    followsMe: !!row.follows_me,
  };
}

/** Followers since I last opened my followers list, not counting anyone blocked either way. */
export async function newFollowerCount(db: Db | Tx, me: string) {
  const r = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from follows f
    where f.followee_id = ${me}
      and f.created_at > coalesce((select s.seen_at from ${followersSeen} s where s.user_id = ${me}), '-infinity'::timestamptz)
      and not exists (select 1 from blocks b where (b.blocker_id = ${me} and b.blocked_id = f.follower_id) or (b.blocker_id = f.follower_id and b.blocked_id = ${me}))`);
  return Number(r.rows[0].n);
}

export async function markFollowersSeen(db: Db, me: string) {
  await db
    .insert(followersSeen)
    .values({ userId: me, seenAt: new Date() })
    .onConflictDoUpdate({ target: followersSeen.userId, set: { seenAt: new Date() } });
}

// ---------------- cursors (shared by all v6 lists) ----------------

/** Opaque cursor: base64url of "<ISO time>|<key>" (key = an id, or a few ids joined by ':'). */
export const encodeCursor = (at: Date | string, key: string) =>
  Buffer.from(`${typeof at === 'string' ? at : at.toISOString()}|${key}`).toString('base64url');

export function decodeCursor(c: string | undefined): { at: string; key: string } | null {
  if (!c) return null;
  const raw = Buffer.from(c, 'base64url').toString('utf8');
  const i = raw.indexOf('|');
  const at = raw.slice(0, i);
  const key = raw.slice(i + 1);
  if (i < 1 || !key || key.length > 200 || Number.isNaN(Date.parse(at)) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(at)) {
    throw badRequest('cursor: invalid');
  }
  return { at, key };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cursorId(key: string) {
  if (!UUID_RE.test(key)) throw badRequest('cursor: invalid');
  return key.toLowerCase();
}
