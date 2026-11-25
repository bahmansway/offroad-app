import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { cars, images, postComments, postLikes, postPhotos, posts, postSaves, spots, users } from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { makeLimiter } from '../lib/limits.js';
import { imageUrl, MAX_UPLOAD_BYTES, processImage, saveImage } from '../lib/images.js';
import { eitherBlocked, isForeignKeyViolation } from '../lib/users.js';
import { cursorId, decodeCursor, encodeCursor, followsSql } from '../lib/follows.js';
import {
  MAX_CAPTION,
  MAX_COMMENT,
  MAX_POST_PHOTOS,
  feedPage,
  hydratePosts,
  listPosts,
  noBlockSql,
  pageLimit,
} from '../lib/posts.js';

type PostRow = typeof posts.$inferSelect;

const caption = z.string().trim().max(MAX_CAPTION);
const createSchema = z
  .object({
    caption: caption.default(''),
    carId: z.uuid().nullable().optional(),
    spotId: z.uuid().nullable().optional(),
  })
  .strict();
const patchSchema = z
  .object({
    caption: caption.optional(),
    carId: z.uuid().nullable().optional(),
    spotId: z.uuid().nullable().optional(),
  })
  .strict();
const commentSchema = z.object({ text: z.string().trim().min(1).max(MAX_COMMENT) }).strict();
const pageQuery = z.object({
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** Photo slot from the path: 0..5. */
function photoIndex(params: unknown) {
  const v = (params as Record<string, unknown>)?.index;
  if (typeof v !== 'string' || !/^\d$/.test(v) || Number(v) >= MAX_POST_PHOTOS) {
    throw badRequest(`index: must be 0-${MAX_POST_PHOTOS - 1}`);
  }
  return Number(v);
}

export async function postRoutes(app: FastifyInstance) {
  const db = app.db;
  const rl = app.config.rateLimits;
  const createLimit = makeLimiter(app, { max: rl.posts, timeWindow: '24 hours', key: (req) => `post:${req.userId}` });
  const photoLimit = makeLimiter(app, { max: rl.postPhotos, timeWindow: '24 hours', key: (req) => `postphoto:${req.userId}` });
  const editLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `postedit:${req.userId}` });
  const reactLimit = makeLimiter(app, { max: 300, timeWindow: '1 hour', key: (req) => `react:${req.userId}` });
  const commentLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `comment:${req.userId}` });

  const one = async (viewer: string | null, id: string) => (await hydratePosts(db, viewer, [id]))[0];

  /**
   * A post the viewer may see: published and no block either way with the author; a draft only for its
   * author. Anything else is 404 (hidden, not "forbidden").
   */
  const visible = async (viewer: string | null, id: string): Promise<PostRow> => {
    const [p] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!p) throw notFound('Post not found');
    if (!p.publishedAt && p.authorId !== viewer) throw notFound('Post not found');
    if (viewer && viewer !== p.authorId && (await eitherBlocked(db, viewer, p.authorId))) throw notFound('Post not found');
    return p;
  };
  /** My own post (403 for someone else's, 404 for a draft that isn't mine). */
  const own = async (tx: Db | Tx, me: string, id: string, lock = false): Promise<PostRow> => {
    const q = tx.select().from(posts).where(eq(posts.id, id)).limit(1);
    const [p] = lock ? await q.for('update') : await q;
    if (!p || (!p.publishedAt && p.authorId !== me)) throw notFound('Post not found');
    if (p.authorId !== me) throw forbidden('You can only change your own posts');
    return p;
  };

  /** carId must be my own car, spotId any existing spot. */
  const checkRefs = async (me: string, b: { carId?: string | null; spotId?: string | null }) => {
    if (b.carId) {
      const [c] = await db.select({ ownerId: cars.ownerId }).from(cars).where(eq(cars.id, b.carId)).limit(1);
      if (!c) throw notFound('Car not found');
      if (c.ownerId !== me) throw forbidden('You can only tag your own car');
    }
    if (b.spotId) {
      const [s] = await db.select({ id: spots.id }).from(spots).where(eq(spots.id, b.spotId)).limit(1);
      if (!s) throw notFound('Spot not found');
    }
  };
  const refsGone = (err: unknown) => {
    if (isForeignKeyViolation(err)) return notFound('Car or spot not found');
    return err;
  };

  // ---- create (draft) -> upload photos -> publish ----
  app.post('/posts', { preHandler: [app.authenticate, createLimit] }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    const me = req.userId!;
    await checkRefs(me, b);
    let row: { id: string };
    try {
      [row] = await db
        .insert(posts)
        .values({ authorId: me, caption: b.caption, carId: b.carId ?? null, spotId: b.spotId ?? null })
        .returning({ id: posts.id });
    } catch (err) {
      throw refsGone(err);
    }
    return reply.status(201).send(await one(me, row.id));
  });

  app.put(
    '/posts/:id/photos/:index',
    { bodyLimit: MAX_UPLOAD_BYTES, preHandler: [app.authenticate, photoLimit] },
    async (req) => {
      const id = idParam(req.params);
      const idx = photoIndex(req.params);
      const me = req.userId!;
      const p0 = await own(db, me, id);
      if (p0.publishedAt) throw conflict('Photos can only be added before the post is shared');
      const processed = await processImage(req.body, 'post'); // EXIF/GPS stripped, max 1440 px
      await db.transaction(async (tx) => {
        // one upload at a time per user: the storage quota can't be beaten by parallel uploads
        await tx.execute(sql`select id from users where id = ${me} for update`);
        const p = await own(tx, me, id, true);
        if (p.publishedAt) throw conflict('Photos can only be added before the post is shared');
        const [old] = await tx
          .select({ imageId: postPhotos.imageId })
          .from(postPhotos)
          .where(and(eq(postPhotos.postId, id), eq(postPhotos.idx, idx)));
        const imageId = await saveImage(tx, me, 'post', processed, old?.imageId ?? null, id);
        if (old) await tx.delete(images).where(eq(images.id, old.imageId)); // cascades to the old slot row
        await tx.insert(postPhotos).values({ postId: id, idx, imageId });
      });
      return one(me, id);
    },
  );

  app.delete('/posts/:id/photos/:index', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const idx = photoIndex(req.params);
    const me = req.userId!;
    await db.transaction(async (tx) => {
      const p = await own(tx, me, id, true);
      if (p.publishedAt) throw conflict('Photos can only be changed before the post is shared');
      const [ph] = await tx
        .select({ imageId: postPhotos.imageId })
        .from(postPhotos)
        .where(and(eq(postPhotos.postId, id), eq(postPhotos.idx, idx)));
      if (ph) await tx.delete(images).where(eq(images.id, ph.imageId));
    });
    return reply.status(204).send();
  });

  app.post('/posts/:id/publish', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const fresh = await db.transaction(async (tx) => {
      const p = await own(tx, me, id, true);
      if (p.publishedAt) return false; // already shared: same answer again
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(postPhotos).where(eq(postPhotos.postId, id));
      if (n.n < 1) throw conflict('Add at least one photo first');
      // createdAt = the moment it was shared (lists sort by it)
      await tx
        .update(posts)
        .set({ publishedAt: sql`now()`, createdAt: sql`date_trunc('milliseconds', now())` })
        .where(eq(posts.id, id));
      return true;
    });
    if (fresh) app.leaderboard.clear();
    return one(me, id);
  });

  // ---- read / edit / delete ----
  app.get('/posts/:id', async (req) => {
    const id = idParam(req.params);
    await visible(req.userId, id);
    return one(req.userId, id);
  });

  app.patch('/posts/:id', { preHandler: [app.authenticate, editLimit] }, async (req) => {
    const id = idParam(req.params);
    const b = parse(patchSchema, req.body);
    const me = req.userId!;
    const p = await own(db, me, id);
    await checkRefs(me, b);
    const set: Partial<typeof posts.$inferInsert> = {};
    if (b.caption !== undefined && b.caption !== p.caption) set.caption = b.caption;
    if (b.carId !== undefined && b.carId !== p.carId) set.carId = b.carId;
    if (b.spotId !== undefined && b.spotId !== p.spotId) set.spotId = b.spotId;
    if (Object.keys(set).length) {
      if (p.publishedAt) set.editedAt = new Date();
      try {
        await db.update(posts).set(set).where(and(eq(posts.id, id), eq(posts.authorId, me)));
      } catch (err) {
        throw refsGone(err);
      }
    }
    return one(me, id);
  });

  app.delete('/posts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const p = await own(db, me, id);
    // photos (images.post_id), likes, saves and comments go with it
    await db.delete(posts).where(and(eq(posts.id, id), eq(posts.authorId, me)));
    if (p.publishedAt) app.leaderboard.clear();
    return reply.status(204).send();
  });

  // ---- likes / saves ----
  const publishedVisible = async (req: FastifyRequest) => {
    const id = idParam(req.params);
    const p = await visible(req.userId, id);
    if (!p.publishedAt) throw notFound('Post not found');
    return p;
  };
  const likeState = async (me: string, id: string) => {
    const p = await one(me, id);
    return { likeCount: p.likeCount, likedByMe: p.likedByMe };
  };

  app.post('/posts/:id/like', { preHandler: [app.authenticate, reactLimit] }, async (req) => {
    const p = await publishedVisible(req);
    const me = req.userId!;
    const added = await db.insert(postLikes).values({ postId: p.id, userId: me }).onConflictDoNothing().returning();
    if (added.length && p.authorId !== me) {
      const [u] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, me));
      if (u) app.notify.postLiked(p.authorId, p.id, u);
    }
    return likeState(me, p.id);
  });

  app.delete('/posts/:id/like', { preHandler: [app.authenticate, reactLimit] }, async (req) => {
    const p = await publishedVisible(req);
    await db.delete(postLikes).where(and(eq(postLikes.postId, p.id), eq(postLikes.userId, req.userId!)));
    return likeState(req.userId!, p.id);
  });

  app.post('/posts/:id/save', { preHandler: [app.authenticate, reactLimit] }, async (req) => {
    const p = await publishedVisible(req);
    await db.insert(postSaves).values({ postId: p.id, userId: req.userId! }).onConflictDoNothing();
    return { savedByMe: true };
  });

  app.delete('/posts/:id/save', { preHandler: [app.authenticate, reactLimit] }, async (req) => {
    const p = await publishedVisible(req);
    await db.delete(postSaves).where(and(eq(postSaves.postId, p.id), eq(postSaves.userId, req.userId!)));
    return { savedByMe: false };
  });

  // Who liked it (newest first), without anyone blocked either way.
  app.get('/posts/:id/likes', async (req) => {
    const p = await publishedVisible(req);
    const q = parse(pageQuery, req.query);
    const viewer = req.userId;
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const r = await db.execute<{ id: string; display_name: string; avatar_image_id: string | null; created_at: Date | string; is_following: boolean }>(sql`
      select u.id, u.display_name, u.avatar_image_id, l.created_at,
        ${viewer ? followsSql(viewer, sql.raw('u.id')) : sql`false`} as is_following
      from post_likes l join users u on u.id = l.user_id
      where l.post_id = ${p.id} and ${noBlockSql(viewer, 'l.user_id')}
        ${cur ? sql`and (l.created_at, l.user_id) < (${cur.at}::timestamptz, ${cursorId(cur.key)}::uuid)` : sql``}
      order by l.created_at desc, l.user_id desc
      limit ${limit + 1}`);
    const rows = r.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((x) => ({
        user: { id: x.id, displayName: x.display_name, avatarUrl: imageUrl(x.avatar_image_id) },
        isFollowing: !!x.is_following,
        likedAt: new Date(x.created_at).toISOString(),
      })),
      nextCursor: r.rows.length > limit && last ? encodeCursor(new Date(last.created_at), last.id) : null,
    };
  });

  // ---- comments (oldest first) ----
  app.get('/posts/:id/comments', async (req) => {
    const p = await publishedVisible(req);
    const q = parse(pageQuery, req.query);
    const viewer = req.userId;
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const r = await db.execute<{ id: string; author_id: string; text: string; created_at: Date | string; display_name: string; avatar_image_id: string | null }>(sql`
      select c.id, c.author_id, c.text, c.created_at, u.display_name, u.avatar_image_id
      from post_comments c join users u on u.id = c.author_id
      where c.post_id = ${p.id} and ${noBlockSql(viewer, 'c.author_id')}
        ${cur ? sql`and (c.created_at, c.id) > (${cur.at}::timestamptz, ${cursorId(cur.key)}::uuid)` : sql``}
      order by c.created_at asc, c.id asc
      limit ${limit + 1}`);
    const rows = r.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((c) => ({
        id: c.id,
        postId: p.id,
        author: { id: c.author_id, displayName: c.display_name, avatarUrl: imageUrl(c.avatar_image_id) },
        text: c.text,
        createdAt: new Date(c.created_at).toISOString(),
        canDelete: !!viewer && (viewer === c.author_id || viewer === p.authorId),
      })),
      nextCursor: r.rows.length > limit && last ? encodeCursor(new Date(last.created_at), last.id) : null,
    };
  });

  app.post('/posts/:id/comments', { preHandler: [app.authenticate, commentLimit] }, async (req, reply) => {
    const p = await publishedVisible(req);
    const b = parse(commentSchema, req.body);
    const me = req.userId!;
    let c: typeof postComments.$inferSelect;
    try {
      [c] = await db.insert(postComments).values({ postId: p.id, authorId: me, text: b.text }).returning();
    } catch (err) {
      if (isForeignKeyViolation(err)) throw notFound('Post not found'); // deleted meanwhile
      throw err;
    }
    const [u] = await db.select({ id: users.id, displayName: users.displayName, avatarImageId: users.avatarImageId }).from(users).where(eq(users.id, me));
    if (p.authorId !== me && u) app.notify.postCommented(p.authorId, p.id, c.id, c.text, u);
    return reply.status(201).send({
      id: c.id,
      postId: p.id,
      author: { id: me, displayName: u?.displayName ?? '', avatarUrl: imageUrl(u?.avatarImageId) },
      text: c.text,
      createdAt: c.createdAt.toISOString(),
      canDelete: true,
    });
  });

  // The comment's author or the post's author.
  app.delete('/comments/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const [c] = await db
      .select({ authorId: postComments.authorId, postAuthor: posts.authorId })
      .from(postComments)
      .innerJoin(posts, eq(posts.id, postComments.postId))
      .where(eq(postComments.id, id))
      .limit(1);
    if (!c) throw notFound('Comment not found');
    if (c.authorId !== me && c.postAuthor !== me) throw forbidden('You can only delete your own comments or comments on your posts');
    await db.delete(postComments).where(eq(postComments.id, id));
    return reply.status(204).send();
  });

  // ---- lists ----
  app.get('/feed', { preHandler: app.authenticate }, async (req) => {
    const q = parse(pageQuery, req.query);
    return feedPage(db, req.userId!, q);
  });

  app.get('/users/:id/posts', async (req) => {
    const id = idParam(req.params);
    const q = parse(pageQuery, req.query);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw notFound('User not found');
    return listPosts(db, req.userId, sql`p.author_id = ${id}`, q);
  });

  app.get('/spots/:id/posts', async (req) => {
    const id = idParam(req.params);
    const q = parse(pageQuery, req.query);
    const [s] = await db.select({ id: spots.id }).from(spots).where(eq(spots.id, id)).limit(1);
    if (!s) throw notFound('Spot not found');
    return listPosts(db, req.userId, sql`p.spot_id = ${id}`, q);
  });

  app.get('/cars/:id/posts', async (req) => {
    const id = idParam(req.params);
    const q = parse(pageQuery, req.query);
    const [c] = await db.select({ id: cars.id }).from(cars).where(eq(cars.id, id)).limit(1);
    if (!c) throw notFound('Car not found');
    return listPosts(db, req.userId, sql`p.car_id = ${id}`, q);
  });

  // Saved posts, most recently saved first (cursor = save time + post id).
  app.get('/me/saved', { preHandler: app.authenticate }, async (req) => {
    const q = parse(pageQuery, req.query);
    const me = req.userId!;
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const r = await db.execute<{ id: string; saved_at: Date | string }>(sql`
      select p.id, sv.created_at as saved_at from post_saves sv join posts p on p.id = sv.post_id
      where sv.user_id = ${me} and p.published_at is not null and ${noBlockSql(me, 'p.author_id')}
        ${cur ? sql`and (sv.created_at, sv.post_id) < (${cur.at}::timestamptz, ${cursorId(cur.key)}::uuid)` : sql``}
      order by sv.created_at desc, sv.post_id desc
      limit ${limit + 1}`);
    const rows = r.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: await hydratePosts(db, me, rows.map((x) => x.id)),
      nextCursor: r.rows.length > limit && last ? encodeCursor(new Date(last.saved_at), last.id) : null,
    };
  });
}

