import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gt, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { clanInvites, clanMembers, clanRequests, clans, conversations, events, users } from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { deleteImage, imageUrl, MAX_UPLOAD_BYTES, storeImage } from '../lib/images.js';
import { makeLimiter } from '../lib/limits.js';
import { eitherBlocked, isForeignKeyViolation, isUniqueViolation, userRef, userRefCols } from '../lib/users.js';
import { addConversationMember, removeConversationMembers } from './chat.js';
import { upcomingEvents } from './events.js';

type ClanRow = typeof clans.$inferSelect;
type MemberRole = 'leader' | 'officer' | 'member';
type Role = MemberRole | 'pending' | null;

export const CLAN_MEMBER_CAP = 200;
export const MAX_PENDING_INVITES = 30;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const isStaff = (r: Role) => r === 'leader' || r === 'officer';

const name = z.string().trim().min(3).max(40);
const tag = z
  .string()
  .trim()
  .regex(/^[\p{L}\p{N}]{2,5}$/u, 'Tag must be 2-5 letters or digits')
  .transform((t) => t.toUpperCase());
const nameKey = (n: string) => n.normalize('NFC').toLowerCase();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

const createSchema = z
  .object({
    name,
    tag,
    description: z.string().trim().max(500).default(''),
    city: optText(60),
    isOpen: z.boolean().default(true),
  })
  .strict();
const patchSchema = z
  .object({
    name: name.optional(),
    tag: tag.optional(),
    description: z.string().trim().max(500).optional(),
    city: optText(60),
    isOpen: z.boolean().optional(),
  })
  .strict();
const listQuery = z.object({ q: z.string().trim().max(40).optional() });
const leaderSchema = z.object({ userId: z.uuid() }).strict();
const roleSchema = z.object({ role: z.enum(['officer', 'member']) }).strict();
const inviteSchema = z.object({ userId: z.uuid() }).strict();

const nameTakenError = (err: unknown) => {
  if (isUniqueViolation(err, 'clans_name_key_idx')) return conflict('A clan with this name already exists');
  if (isUniqueViolation(err, 'clans_tag_idx')) return conflict('A clan with this tag already exists');
  if (isUniqueViolation(err, 'clan_members_pkey')) return conflict('You are already in a clan');
  return null;
};

async function myRole(db: Db, clanId: string, userId: string | null): Promise<Role> {
  if (!userId) return null;
  const [m] = await db
    .select({ role: clanMembers.role })
    .from(clanMembers)
    .where(and(eq(clanMembers.userId, userId), eq(clanMembers.clanId, clanId)))
    .limit(1);
  if (m) return m.role;
  const [r] = await db
    .select({ x: clanRequests.userId })
    .from(clanRequests)
    .where(and(eq(clanRequests.clanId, clanId), eq(clanRequests.userId, userId)))
    .limit(1);
  return r ? 'pending' : null;
}

async function clanConversationId(db: Db, clanId: string) {
  const [c] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.clanId, clanId));
  return c?.id ?? null;
}

const memberCountSql = sql<number>`(select count(*)::int from ${clanMembers} m where m.clan_id = ${clans.id})`;

async function toClan(db: Db, c: ClanRow, viewerId: string | null, memberCount?: number) {
  const [leader] = await db.select(userRefCols).from(users).where(eq(users.id, c.leaderId));
  if (memberCount === undefined) {
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(clanMembers).where(eq(clanMembers.clanId, c.id));
    memberCount = n.n;
  }
  const role = await myRole(db, c.id, viewerId);
  return {
    id: c.id,
    name: c.name,
    tag: c.tag,
    description: c.description,
    logoUrl: imageUrl(c.logoImageId),
    city: c.city,
    isOpen: c.isOpen,
    leader: userRef(leader),
    memberCount,
    myRole: role,
    // only members get the chat id
    conversationId: role && role !== 'pending' ? await clanConversationId(db, c.id) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function clanRoutes(app: FastifyInstance) {
  const db = app.db;
  const createLimit = makeLimiter(app, { max: app.config.rateLimits.create, timeWindow: '1 hour', key: (req) => `clan:${req.userId}` });
  const joinLimit = makeLimiter(app, { max: 30, timeWindow: '1 hour', key: (req) => `clanjoin:${req.userId}` });
  const inviteLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `claninvite:${req.userId}` });
  const logoLimit = makeLimiter(app, {
    max: app.config.rateLimits.create,
    timeWindow: '1 hour',
    key: (req) => `photo:${req.userId}`,
  });

  const loadClan = async (id: string) => {
    const [c] = await db.select().from(clans).where(eq(clans.id, id)).limit(1);
    if (!c) throw notFound('Clan not found');
    return c;
  };
  const loadLed = async (id: string, userId: string) => {
    const c = await loadClan(id);
    if (c.leaderId !== userId) throw forbidden('Only the clan leader can do this');
    return c;
  };
  /**
   * Insert a member. The caller's transaction must hold the clan row lock (`lockClan`), so the member cap
   * can't be raced. One clan per user is enforced by the database (user_id primary key) -> 409.
   * Call `joinChat` after the transaction commits.
   */
  const insertMember = async (tx: Tx, clanId: string, userId: string) => {
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(clanMembers).where(eq(clanMembers.clanId, clanId));
    if (n.n >= CLAN_MEMBER_CAP) throw conflict(`This clan is full (${CLAN_MEMBER_CAP} members)`);
    const [already] = await tx.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, userId));
    if (already) throw conflict('This user is already in a clan');
    await tx.insert(clanMembers).values({ userId, clanId, role: 'member' });
    // joined: drop every pending request and invite this user had
    await tx.delete(clanRequests).where(eq(clanRequests.userId, userId));
    await tx.delete(clanInvites).where(eq(clanInvites.userId, userId));
  };
  const joinChat = async (clanId: string, userId: string) => {
    const convId = await clanConversationId(db, clanId);
    if (convId) await addConversationMember(app, db, convId, userId);
  };
  /** Run fn in a transaction that holds the clan row lock. Maps races to 404 / 409. */
  const lockClan = async <T>(clanId: string, fn: (tx: Tx, clan: ClanRow) => Promise<T>) => {
    try {
      return await db.transaction(async (tx) => {
        const [c] = await tx.select().from(clans).where(eq(clans.id, clanId)).for('update').limit(1);
        if (!c) throw notFound('Clan not found');
        return fn(tx, c);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'clan_members_pkey')) throw conflict('This user is already in a clan');
      if (isForeignKeyViolation(err)) throw notFound('Not found'); // user or clan deleted meanwhile
      throw err;
    }
  };
  const roleIn = async (tx: Tx | Db, clanId: string, userId: string) => {
    const [m] = await tx
      .select({ role: clanMembers.role })
      .from(clanMembers)
      .where(and(eq(clanMembers.userId, userId), eq(clanMembers.clanId, clanId)));
    return (m?.role ?? null) as MemberRole | null;
  };
  /** Like asLeader, for actions leader AND officers may do. Passes the caller's role. */
  const asStaff = async <T>(clanId: string, userId: string, fn: (tx: Tx, clan: ClanRow, role: MemberRole) => Promise<T>) =>
    lockClan(clanId, async (tx, c) => {
      const role = await roleIn(tx, clanId, userId);
      if (role !== 'leader' && role !== 'officer') throw forbidden('Only the clan leader or an officer can do this');
      return fn(tx, c, role);
    });
  /**
   * Run `fn` in a transaction holding a row lock on the clan, after checking the caller is still the
   * leader. Serialises leader actions (handover, removal, delete) so two can't interleave.
   */
  const asLeader = async <T>(clanId: string, userId: string, fn: (tx: Tx, clan: ClanRow) => Promise<T>) =>
    db.transaction(async (tx) => {
      const [c] = await tx.select().from(clans).where(eq(clans.id, clanId)).for('update').limit(1);
      if (!c) throw notFound('Clan not found');
      if (c.leaderId !== userId) throw forbidden('Only the clan leader can do this');
      return fn(tx, c);
    });
  /**
   * Remove a member whose role is one of `roles` (never the leader). Returns false when there was no such
   * member row (conditional delete, so a concurrent promotion to leader can't be removed).
   */
  const removeMember = async (clanId: string, userId: string, tx: Tx | Db = db, roles: MemberRole[] = ['member', 'officer']) => {
    const removed = await tx
      .delete(clanMembers)
      .where(and(eq(clanMembers.clanId, clanId), eq(clanMembers.userId, userId), inArray(clanMembers.role, roles)))
      .returning({ userId: clanMembers.userId });
    return removed.length > 0;
  };
  const dropFromChat = async (clanId: string, userId: string) => {
    const convId = await clanConversationId(db, clanId);
    if (convId) await removeConversationMembers(app, db, convId, [userId]);
  };

  app.get('/clans', async (req) => {
    const q = parse(listQuery, req.query);
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null;
    const rows = await db
      .select({ c: clans, n: memberCountSql })
      .from(clans)
      .where(like ? or(ilike(clans.name, like), ilike(clans.tag, like)) : undefined)
      .orderBy(desc(memberCountSql), asc(clans.name))
      .limit(50);
    return { items: await Promise.all(rows.map((r) => toClan(db, r.c, req.userId, r.n))) };
  });

  app.post('/clans', { preHandler: [app.authenticate, createLimit] }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    const me = req.userId!;
    let clan: ClanRow;
    let convId: string;
    try {
      ({ clan, convId } = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(clans)
          .values({ name: b.name, nameKey: nameKey(b.name), tag: b.tag, description: b.description, city: b.city ?? null, isOpen: b.isOpen, leaderId: me })
          .returning();
        await tx.insert(clanMembers).values({ userId: me, clanId: c.id, role: 'leader' });
        await tx.delete(clanRequests).where(eq(clanRequests.userId, me));
        const [conv] = await tx.insert(conversations).values({ type: 'clan', clanId: c.id }).returning({ id: conversations.id });
        return { clan: c, convId: conv.id };
      }));
    } catch (err) {
      throw nameTakenError(err) ?? err;
    }
    await addConversationMember(app, db, convId, me);
    return reply.status(201).send(await toClan(db, clan, me, 1));
  });

  app.get('/clans/:id', async (req) => toClan(db, await loadClan(idParam(req.params)), req.userId));

  app.patch('/clans/:id', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const b = parse(patchSchema, req.body);
    await loadLed(id, req.userId!);
    const set: Record<string, unknown> = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (b.name !== undefined) set.nameKey = nameKey(b.name);
    if (Object.keys(set).length) {
      try {
        await db.update(clans).set(set).where(eq(clans.id, id));
      } catch (err) {
        throw nameTakenError(err) ?? err;
      }
    }
    return toClan(db, await loadClan(id), req.userId);
  });

  app.delete('/clans/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const convId = await clanConversationId(db, id);
    const c = await asLeader(id, req.userId!, async (tx, clan) => {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(clanMembers).where(eq(clanMembers.clanId, id));
      if (n.n > 1) throw conflict('Remove the other members or hand over leadership before deleting the clan');
      await tx.delete(clans).where(eq(clans.id, id)); // cascades members, requests, chat
      return clan;
    });
    if (convId) app.realtime.removeMember(req.userId!, convId);
    await deleteImage(db, c.logoImageId);
    return reply.status(204).send();
  });

  app.put('/clans/:id/logo', { bodyLimit: MAX_UPLOAD_BYTES, preHandler: [app.authenticate, logoLimit] }, async (req) => {
    const id = idParam(req.params);
    const c = await loadLed(id, req.userId!);
    const imageId = await storeImage(db, req.userId!, 'clan', req.body, c.logoImageId);
    await db.update(clans).set({ logoImageId: imageId }).where(eq(clans.id, id));
    await deleteImage(db, c.logoImageId);
    return { logoUrl: imageUrl(imageId) };
  });

  app.delete('/clans/:id/logo', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const c = await loadLed(id, req.userId!);
    await db.update(clans).set({ logoImageId: null }).where(eq(clans.id, id));
    await deleteImage(db, c.logoImageId);
    return reply.status(204).send();
  });

  // Open clan: join right away. Request clan: create a pending request for the leader.
  app.post('/clans/:id/join', { preHandler: [app.authenticate, joinLimit] }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const c = await loadClan(id);
    const [mine] = await db.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, me));
    if (mine) throw conflict(mine.clanId === id ? 'You are already in this clan' : 'You are already in a clan');
    if (c.isOpen) {
      await lockClan(id, (tx) => insertMember(tx, id, me));
      await joinChat(id, me);
    } else await db.insert(clanRequests).values({ clanId: id, userId: me }).onConflictDoNothing();
    return toClan(db, c, me);
  });

  // Members leave; a pending request is cancelled. The leader must hand over (or delete the clan) first.
  app.post('/clans/:id/leave', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const c = await loadClan(id);
    const role = await myRole(db, id, me);
    if (role === 'leader') throw conflict('Hand over leadership first, or delete the clan if you are the only member');
    if (role === 'member' || role === 'officer') {
      // conditional on role member/officer: if they were just made leader, this removes nothing
      if (!(await removeMember(id, me))) {
        // changed meanwhile: promoted to leader, or already removed
        if ((await myRole(db, id, me)) === 'leader') throw conflict('Hand over leadership first, or delete the clan if you are the only member');
        throw notFound('You are not in this clan');
      }
      await dropFromChat(id, me);
    } else if (role === 'pending') {
      await db.delete(clanRequests).where(and(eq(clanRequests.clanId, id), eq(clanRequests.userId, me)));
    } else throw notFound('You are not in this clan');
    return toClan(db, c, me);
  });

  app.get('/clans/:id/members', async (req) => {
    const id = idParam(req.params);
    await loadClan(id);
    const rows = await db
      .select({ ...userRefCols, role: clanMembers.role, joinedAt: clanMembers.joinedAt })
      .from(clanMembers)
      .innerJoin(users, eq(users.id, clanMembers.userId))
      .where(eq(clanMembers.clanId, id))
      .orderBy(sql`case ${clanMembers.role} when 'leader' then 0 when 'officer' then 1 else 2 end`, asc(clanMembers.joinedAt))
      .limit(1000);
    return { items: rows.map((r) => ({ user: userRef(r), role: r.role, joinedAt: r.joinedAt.toISOString() })) };
  });

  const requireStaff = async (clanId: string, userId: string) => {
    await loadClan(clanId);
    if (!isStaff(await roleIn(db, clanId, userId))) throw forbidden('Only the clan leader or an officer can do this');
  };

  app.get('/clans/:id/requests', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    await requireStaff(id, req.userId!);
    const rows = await db
      .select({ ...userRefCols, createdAt: clanRequests.createdAt })
      .from(clanRequests)
      .innerJoin(users, eq(users.id, clanRequests.userId))
      .where(eq(clanRequests.clanId, id))
      .orderBy(asc(clanRequests.createdAt));
    return { items: rows.map((r) => ({ user: userRef(r), createdAt: r.createdAt.toISOString() })) };
  });

  const loadRequest = async (clanId: string, userId: string, tx: Tx | Db = db) => {
    const [r] = await tx
      .select({ x: clanRequests.userId })
      .from(clanRequests)
      .where(and(eq(clanRequests.clanId, clanId), eq(clanRequests.userId, userId)));
    if (!r) throw notFound('Request not found');
  };

  app.post('/clans/:id/requests/:userId/approve', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    try {
      await asStaff(id, req.userId!, async (tx) => {
        await loadRequest(id, userId, tx);
        await insertMember(tx, id, userId);
      });
    } catch (err: any) {
      // they joined another clan meanwhile: the request is stale
      if (err?.statusCode === 409 && /already in a clan/.test(err.message)) {
        await db.delete(clanRequests).where(and(eq(clanRequests.clanId, id), eq(clanRequests.userId, userId)));
      }
      throw err;
    }
    await joinChat(id, userId);
    return reply.status(204).send();
  });

  app.post('/clans/:id/requests/:userId/reject', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    await asStaff(id, req.userId!, async (tx) => {
      await loadRequest(id, userId, tx);
      await tx.delete(clanRequests).where(and(eq(clanRequests.clanId, id), eq(clanRequests.userId, userId)));
    });
    return reply.status(204).send();
  });

  app.delete('/clans/:id/members/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    if (userId === req.userId) {
      const r = await roleIn(db, id, req.userId!);
      if (r === 'leader') throw conflict('The leader cannot remove themselves; hand over leadership first');
      if (r === 'officer') throw conflict('Use leave to leave the clan');
      await requireStaff(id, req.userId!);
    }
    await asStaff(id, req.userId!, async (tx, _c, myRole) => {
      const target = await roleIn(tx, id, userId);
      if (!target) throw notFound('Member not found');
      // officers remove plain members only; the leader can't be removed by anyone
      if (target === 'leader' || (myRole === 'officer' && target === 'officer')) {
        throw forbidden(myRole === 'officer' ? 'Officers can only remove members' : 'The leader cannot be removed');
      }
      if (!(await removeMember(id, userId, tx, myRole === 'leader' ? ['member', 'officer'] : ['member']))) {
        throw notFound('Member not found');
      }
    });
    await dropFromChat(id, userId);
    return reply.status(204).send();
  });

  app.post('/clans/:id/leader', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const { userId } = parse(leaderSchema, req.body);
    const me = req.userId!;
    if (userId === me) {
      await loadLed(id, me);
      throw conflict('You are already the leader');
    }
    await asLeader(id, me, async (tx) => {
      // conditional updates: each must hit exactly one row, otherwise roll everything back
      const promoted = await tx
        .update(clanMembers)
        .set({ role: 'leader' })
        .where(and(eq(clanMembers.clanId, id), eq(clanMembers.userId, userId), inArray(clanMembers.role, ['member', 'officer'])))
        .returning({ u: clanMembers.userId });
      if (promoted.length !== 1) throw notFound('Member not found');
      const demoted = await tx
        .update(clanMembers)
        .set({ role: 'member' })
        .where(and(eq(clanMembers.clanId, id), eq(clanMembers.userId, me), eq(clanMembers.role, 'leader')))
        .returning({ u: clanMembers.userId });
      const moved = await tx
        .update(clans)
        .set({ leaderId: userId })
        .where(and(eq(clans.id, id), eq(clans.leaderId, me)))
        .returning({ id: clans.id });
      if (demoted.length !== 1 || moved.length !== 1) throw conflict('Leadership changed meanwhile, try again');
    });
    return toClan(db, await loadClan(id), req.userId);
  });

  // ---- officers (leader only) ----
  app.post('/clans/:id/members/:userId/role', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    const { role } = parse(roleSchema, req.body);
    if (userId === req.userId) {
      await loadLed(id, req.userId!);
      throw conflict('The leader keeps the leader role; use handover instead');
    }
    await asLeader(id, req.userId!, async (tx) => {
      const updated = await tx
        .update(clanMembers)
        .set({ role })
        .where(and(eq(clanMembers.clanId, id), eq(clanMembers.userId, userId), inArray(clanMembers.role, ['member', 'officer'])))
        .returning({ u: clanMembers.userId });
      if (updated.length !== 1) throw notFound('Member not found');
    });
    return { userId, role };
  });

  // ---- upcoming events of the clan (clan-only ones only for members) ----
  app.get('/clans/:id/events', async (req) => {
    const id = idParam(req.params);
    await loadClan(id);
    return { items: await upcomingEvents(db, eq(events.clanId, id), req.userId, 20) };
  });

  // ---- invites ----
  const pendingInvite = gt(clanInvites.expiresAt, sql`now()`);
  const toInvite = (r: { inv: typeof clanInvites.$inferSelect; clan: ClanRow }) => ({
    id: r.inv.id,
    clan: { id: r.clan.id, name: r.clan.name, tag: r.clan.tag, logoUrl: imageUrl(r.clan.logoImageId) },
    createdAt: r.inv.createdAt.toISOString(),
    expiresAt: r.inv.expiresAt.toISOString(),
  });

  app.post('/clans/:id/invites', { preHandler: [app.authenticate, inviteLimit] }, async (req, reply) => {
    const id = idParam(req.params);
    const { userId } = parse(inviteSchema, req.body);
    const me = req.userId!;
    if (userId === me) throw badRequest('You cannot invite yourself');
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw notFound('User not found');
    const inv = await asStaff(id, me, async (tx) => {
      if (await eitherBlocked(db, me, userId)) throw forbidden('You cannot invite this user');
      const [inClan] = await tx.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, userId));
      if (inClan) throw conflict(inClan.clanId === id ? 'This user is already in your clan' : 'This user is already in a clan');
      // expired invites don't count and can be replaced
      await tx.delete(clanInvites).where(and(eq(clanInvites.clanId, id), lte(clanInvites.expiresAt, sql`now()`)));
      const [dup] = await tx
        .select({ id: clanInvites.id })
        .from(clanInvites)
        .where(and(eq(clanInvites.clanId, id), eq(clanInvites.userId, userId)));
      if (dup) throw conflict('This user already has a pending invite');
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(clanInvites).where(eq(clanInvites.clanId, id));
      if (n.n >= MAX_PENDING_INVITES) throw conflict(`At most ${MAX_PENDING_INVITES} pending invites per clan`);
      const [row] = await tx
        .insert(clanInvites)
        .values({ clanId: id, userId, invitedById: me, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
        .returning();
      return row;
    });
    const [inviter] = await db.select(userRefCols).from(users).where(eq(users.id, me));
    const payload = { ...toInvite({ inv, clan: await loadClan(id) }), invitedBy: userRef(inviter) };
    app.realtime.toUser(userId, 'clan:invite', payload);
    return reply.status(201).send({ ...payload, user: { id: userId } });
  });

  app.get('/clans/:id/invites', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    await requireStaff(id, req.userId!);
    const rows = await db
      .select({ inv: clanInvites, ...userRefCols })
      .from(clanInvites)
      .innerJoin(users, eq(users.id, clanInvites.userId))
      .where(and(eq(clanInvites.clanId, id), pendingInvite))
      .orderBy(desc(clanInvites.createdAt));
    return {
      items: rows.map((r) => ({
        id: r.inv.id,
        user: userRef(r),
        invitedById: r.inv.invitedById,
        createdAt: r.inv.createdAt.toISOString(),
        expiresAt: r.inv.expiresAt.toISOString(),
      })),
    };
  });

  app.delete('/clans/:id/invites/:inviteId', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const inviteId = idParam(req.params, 'inviteId');
    await asStaff(id, req.userId!, async (tx) => {
      const del = await tx
        .delete(clanInvites)
        .where(and(eq(clanInvites.id, inviteId), eq(clanInvites.clanId, id)))
        .returning({ id: clanInvites.id });
      if (!del.length) throw notFound('Invite not found');
    });
    return reply.status(204).send();
  });

  app.get('/me/clan-invites', { preHandler: app.authenticate }, async (req) => {
    const rows = await db
      .select({ inv: clanInvites, clan: clans, ...userRefCols })
      .from(clanInvites)
      .innerJoin(clans, eq(clans.id, clanInvites.clanId))
      .leftJoin(users, eq(users.id, clanInvites.invitedById))
      .where(and(eq(clanInvites.userId, req.userId!), pendingInvite))
      .orderBy(desc(clanInvites.createdAt));
    return {
      items: rows.map((r) => ({
        ...toInvite(r),
        invitedBy: r.id ? userRef({ id: r.id, displayName: r.displayName!, avatarImageId: r.avatarImageId }) : null,
      })),
    };
  });

  /** Load my invite: 404 if missing / not mine; expired -> deleted + 409. */
  const myInvite = async (tx: Tx | Db, inviteId: string, me: string) => {
    const [inv] = await tx
      .select()
      .from(clanInvites)
      .where(and(eq(clanInvites.id, inviteId), eq(clanInvites.userId, me)))
      .limit(1);
    if (!inv) throw notFound('Invite not found');
    return inv;
  };

  app.post('/clan-invites/:id/accept', { preHandler: app.authenticate }, async (req) => {
    const inviteId = idParam(req.params);
    const me = req.userId!;
    const inv = await myInvite(db, inviteId, me);
    if (inv.expiresAt.getTime() <= Date.now()) {
      await db.delete(clanInvites).where(eq(clanInvites.id, inviteId));
      throw conflict('This invite has expired');
    }
    await lockClan(inv.clanId, async (tx) => {
      await myInvite(tx, inviteId, me); // revoked meanwhile -> 404
      await insertMember(tx, inv.clanId, me); // full / already in a clan -> 409 (invite kept)
    });
    await joinChat(inv.clanId, me);
    return toClan(db, await loadClan(inv.clanId), me);
  });

  app.post('/clan-invites/:id/decline', { preHandler: app.authenticate }, async (req, reply) => {
    const inviteId = idParam(req.params);
    const me = req.userId!;
    await myInvite(db, inviteId, me);
    await db.delete(clanInvites).where(and(eq(clanInvites.id, inviteId), eq(clanInvites.userId, me)));
    return reply.status(204).send();
  });
}
