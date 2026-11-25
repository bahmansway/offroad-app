import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../db/index.js';
import { imageUrl } from './images.js';
import { badRequest } from './errors.js';
import { cursorId, decodeCursor, encodeCursor } from './follows.js';

/** Photos per post, caption length, drafts lifetime. */
export const MAX_POST_PHOTOS = 6;
export const MAX_CAPTION = 1000;
export const MAX_COMMENT = 500;
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFT_CLEANUP_EVERY_MS = 60 * 60 * 1000;
export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 50;
/** Following fewer people than this -> the feed is topped up with suggested posts. */
export const SUGGEST_BELOW_FOLLOWING = 3;

/** SQL: neither `viewer` nor the user in `col` blocked the other. */
export const noBlockSql = (viewer: string | null, col: SQL | string) => {
  if (!viewer) return sql`true`;
  const c = typeof col === 'string' ? sql.raw(col) : col;
  return sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer} and b.blocked_id = ${c}) or (b.blocker_id = ${c} and b.blocked_id = ${viewer}))`;
};

type HydratedRow = {
  id: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  clan_id: string | null;
  clan_name: string | null;
  clan_tag: string | null;
  caption: string;
  car_id: string | null;
  car_make: string | null;
  car_model: string | null;
  car_year: number | null;
  car_photo: string | null;
  spot_id: string | null;
  spot_name: string | null;
  spot_type: 'trail' | 'camp' | null;
  spot_difficulty: number | null;
  spot_lat: number | null;
  spot_lng: number | null;
  published_at: Date | string | null;
  created_at: Date | string;
  edited_at: Date | string | null;
  like_count: number;
  comment_count: number;
  liked: boolean;
  saved: boolean;
  photos: { url: string; width: number; height: number }[] | null;
};

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

function toPost(r: HydratedRow) {
  return {
    id: r.id,
    author: {
      id: r.author_id,
      displayName: r.author_name,
      avatarUrl: imageUrl(r.author_avatar),
      clan: r.clan_id ? { id: r.clan_id, name: r.clan_name!, tag: r.clan_tag! } : null,
    },
    photos: r.photos ?? [],
    caption: r.caption,
    car: r.car_id
      ? { id: r.car_id, make: r.car_make!, model: r.car_model!, year: Number(r.car_year), photoUrl: imageUrl(r.car_photo) }
      : null,
    spot: r.spot_id
      ? { id: r.spot_id, name: r.spot_name!, type: r.spot_type!, difficulty: r.spot_difficulty, lat: r.spot_lat!, lng: r.spot_lng! }
      : null,
    likeCount: Number(r.like_count),
    commentCount: Number(r.comment_count),
    likedByMe: !!r.liked,
    savedByMe: !!r.saved,
    status: (r.published_at ? 'published' : 'draft') as 'published' | 'draft',
    createdAt: iso(r.created_at)!,
    editedAt: iso(r.edited_at),
  };
}
export type Post = ReturnType<typeof toPost> & { suggested?: boolean };

/**
 * Full Post objects for these ids, in the given order. Counts leave out likes / comments by people the
 * viewer blocked or who blocked the viewer. Callers have already applied visibility.
 */
export async function hydratePosts(db: Db | Tx, viewer: string | null, ids: string[]): Promise<Post[]> {
  if (!ids.length) return [];
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const r = await db.execute<HydratedRow>(sql`
    select p.id, p.author_id, u.display_name as author_name, u.avatar_image_id as author_avatar,
      cl.id as clan_id, cl.name as clan_name, cl.tag as clan_tag,
      p.caption, c.id as car_id, c.make as car_make, c.model as car_model, c.year as car_year, c.photo_image_id as car_photo,
      s.id as spot_id, s.name as spot_name, s.type as spot_type, s.difficulty as spot_difficulty, s.lat as spot_lat, s.lng as spot_lng,
      p.published_at, p.created_at, p.edited_at,
      (select count(*)::int from post_likes l where l.post_id = p.id and ${noBlockSql(viewer, 'l.user_id')}) as like_count,
      (select count(*)::int from post_comments pc where pc.post_id = p.id and ${noBlockSql(viewer, 'pc.author_id')}) as comment_count,
      ${viewer ? sql`exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = ${viewer})` : sql`false`} as liked,
      ${viewer ? sql`exists (select 1 from post_saves sv where sv.post_id = p.id and sv.user_id = ${viewer})` : sql`false`} as saved,
      (select json_agg(json_build_object('url', '/api/images/' || i.id, 'width', i.width, 'height', i.height) order by ph.idx)
         from post_photos ph join images i on i.id = ph.image_id where ph.post_id = p.id) as photos
    from posts p
    join users u on u.id = p.author_id
    left join clan_members cm on cm.user_id = p.author_id
    left join clans cl on cl.id = cm.clan_id
    left join cars c on c.id = p.car_id
    left join spots s on s.id = p.spot_id
    where p.id in (${list})`);
  const byId = new Map(r.rows.map((row) => [row.id, toPost(row)]));
  return ids.map((id) => byId.get(id)).filter((p): p is Post => !!p);
}

export const pageLimit = (n: number | undefined) => Math.min(Math.max(n ?? PAGE_DEFAULT, 1), PAGE_MAX);

/**
 * One page of published posts matching `where` (an SQL condition on alias `p`), newest first.
 * Posts by anyone blocked either way are always left out. Cursor = createdAt + id (stable).
 */
export async function listPosts(
  db: Db,
  viewer: string | null,
  where: SQL,
  opts: { cursor?: string; limit?: number },
) {
  const limit = pageLimit(opts.limit);
  const cur = decodeCursor(opts.cursor);
  const after = cur ? sql`and (p.created_at, p.id) < (${cur.at}::timestamptz, ${cursorId(cur.key)}::uuid)` : sql``;
  const r = await db.execute<{ id: string; created_at: Date | string }>(sql`
    select p.id, p.created_at from posts p
    where p.published_at is not null and (${where}) and ${noBlockSql(viewer, 'p.author_id')} ${after}
    order by p.created_at desc, p.id desc
    limit ${limit + 1}`);
  const rows = r.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: await hydratePosts(db, viewer, rows.map((x) => x.id)),
    nextCursor: r.rows.length > limit && last ? encodeCursor(new Date(last.created_at), last.id) : null,
  };
}

/**
 * Home feed: my posts + posts of people I follow, newest first. When I follow fewer than 3 people and
 * that list runs out, the page continues with recent public posts by others (`suggested: true`).
 * Cursor = "f" or "s" phase + createdAt + id.
 */
export async function feedPage(db: Db, me: string, opts: { cursor?: string; limit?: number }) {
  const limit = pageLimit(opts.limit);
  const cur = decodeCursor(opts.cursor);
  let phase: 'f' | 's' = 'f';
  let at: string | null = null;
  let id: string | null = null;
  if (cur) {
    const [ph, rawId] = cur.key.split(':');
    if ((ph !== 'f' && ph !== 's') || !rawId) throw badRequest('cursor: invalid');
    phase = ph;
    at = cur.at;
    id = cursorId(rawId);
  }
  const mine = sql`(p.author_id = ${me} or p.author_id in (select followee_id from follows where follower_id = ${me}))`;
  const page = async (cond: SQL, n: number, a: string | null, i: string | null) =>
    (
      await db.execute<{ id: string; created_at: Date | string }>(sql`
        select p.id, p.created_at from posts p
        where p.published_at is not null and ${cond} and ${noBlockSql(me, 'p.author_id')}
          ${a && i ? sql`and (p.created_at, p.id) < (${a}::timestamptz, ${i}::uuid)` : sql``}
        order by p.created_at desc, p.id desc
        limit ${n}`)
    ).rows;
  const out: { id: string; created_at: Date | string; s: boolean }[] = [];
  let more = false;
  if (phase === 'f') {
    const rows = await page(mine, limit + 1, at, id);
    out.push(...rows.slice(0, limit).map((r) => ({ ...r, s: false })));
    more = rows.length > limit;
    if (!more) {
      phase = 's';
      at = null;
      id = null;
    }
  }
  if (phase === 's' && out.length < limit + 1 && !more) {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from follows where follower_id = ${me}`);
    if (Number(r.rows[0].n) < SUGGEST_BELOW_FOLLOWING) {
      const want = limit - out.length;
      const rows = await page(sql`not ${mine}`, want + 1, at, id);
      out.push(...rows.slice(0, want).map((x) => ({ ...x, s: true })));
      more = rows.length > want;
    }
  }
  const posts = await hydratePosts(db, me, out.map((x) => x.id));
  const suggested = new Set(out.filter((x) => x.s).map((x) => x.id));
  const last = out[out.length - 1];
  return {
    items: posts.map((p) => ({ ...p, suggested: suggested.has(p.id) })),
    nextCursor: more && last ? encodeCursor(new Date(last.created_at), `${suggested.has(last.id) ? 's' : 'f'}:${last.id}`) : null,
  };
}

/** Delete unpublished drafts older than 24 h (their photos go with them). Returns how many. */
export async function cleanupDrafts(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - DRAFT_TTL_MS).toISOString();
  const r = await db.execute(sql`delete from posts where published_at is null and created_at < ${cutoff}::timestamptz`);
  return r.rowCount ?? 0;
}

