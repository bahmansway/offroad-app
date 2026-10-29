import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  cars,
  clanMembers,
  clans,
  conversationMembers,
  conversations,
  eventParticipants,
  events,
  spots,
  users,
} from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors.js';
import { deleteImage, imageUrl, MAX_UPLOAD_BYTES, storeImage } from '../lib/images.js';
import { makeLimiter } from '../lib/limits.js';
import { eitherBlocked, isForeignKeyViolation, userRef, userRefCols } from '../lib/users.js';
import { broadcastMessage, insertSystemMessage, type SystemKey } from '../lib/messages.js';
import { endSql, eventState } from '../lib/eventState.js';

type EventRow = typeof events.$inferSelect;
type MsgRow = Awaited<ReturnType<typeof insertSystemMessage>>;

export const MAX_EVENTS_PER_DAY = 10;
export const MAX_UPCOMING_ORGANIZED = 20;
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------- validation ----------------

const requirements = z.array(z.string().trim().min(1).max(24)).max(8);
const meetingPoint = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().trim().max(80).default('') })
  .strict();
const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const createSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().max(2000).default(''),
    startsAt: isoDate,
    endsAt: isoDate.nullable().optional(),
    spotId: z.uuid().nullable().optional(),
    meetingPoint: meetingPoint.nullable().optional(),
    maxCars: z.number().int().min(2).max(100),
    minDifficulty: z.number().int().min(1).max(5).nullable().optional(),
    requirements: requirements.default([]),
    visibility: z.enum(['public', 'clan']).default('public'),
    carId: z.uuid(),
    seats: z.number().int().min(0).max(6).default(0),
  })
  .strict();
const patchSchema = z
  .object({
    title: z.string().trim().min(3).max(80).optional(),
    description: z.string().trim().max(2000).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.nullable().optional(),
    spotId: z.uuid().nullable().optional(),
    meetingPoint: meetingPoint.nullable().optional(),
    maxCars: z.number().int().min(2).max(100).optional(),
    minDifficulty: z.number().int().min(1).max(5).nullable().optional(),
    requirements: requirements.optional(),
    visibility: z.enum(['public', 'clan']).optional(),
  })
  .strict();
const joinSchema = z.object({ carId: z.uuid(), seats: z.number().int().min(0).max(6).default(0) }).strict();
const cancelSchema = z
  .object({ reason: z.string().trim().max(300).nullable().optional() })
  .strict();
const listQuery = z.object({
  scope: z.enum(['upcoming', 'mine', 'past']).default('upcoming'),
  clanOnly: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'near must be "lat,lng"')
    .optional()
    .transform((v) => (v ? v.split(',').map(Number) : undefined))
    .refine((v) => !v || (Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180), 'near is out of range'),
  radiusKm: z.coerce.number().min(1).max(1000).default(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

/** Check the time rules against "now" (create, and edits that change times). */
function checkTimes(startsAt: Date, endsAt: Date | null | undefined) {
  const now = Date.now();
  if (startsAt.getTime() <= now) throw badRequest('startsAt: must be in the future');
  if (startsAt.getTime() > now + YEAR_MS) throw badRequest('startsAt: must be within one year');
  if (endsAt) {
    if (endsAt.getTime() <= startsAt.getTime()) throw badRequest('endsAt: must be after startsAt');
    if (endsAt.getTime() - startsAt.getTime() > MAX_LENGTH_MS) throw badRequest('endsAt: at most 7 days after startsAt');
  }
}

// ---------------- visibility ----------------

/**
 * Who can see an event: public events -> everyone. Clan events -> members of the event's clan, the organizer,
 * and anyone currently going / on the waitlist. Everyone else gets 404.
 */
export const visibleSql = (viewerId: string | null): SQL =>
  viewerId
    ? sql`(${events.visibility} = 'public' or ${events.organizerId} = ${viewerId}
        or exists (select 1 from ${clanMembers} cm where cm.user_id = ${viewerId} and cm.clan_id = ${events.clanId})
        or exists (select 1 from ${eventParticipants} ep where ep.event_id = ${events.id} and ep.user_id = ${viewerId} and ep.status in ('going','waitlist')))`
    : sql`(${events.visibility} = 'public')`;

const notFinishedSql = sql`${endSql('events')} > now()`;

// ---------------- shapes ----------------

const summaryFields = (viewerId: string | null) => ({
  e: events,
  orgId: users.id,
  orgName: users.displayName,
  orgAvatar: users.avatarImageId,
  spotName: spots.name,
  spotType: spots.type,
  spotDifficulty: spots.difficulty,
  spotLat: spots.lat,
  spotLng: spots.lng,
  clanName: clans.name,
  clanTag: clans.tag,
  carCount: sql<number>`(select count(*)::int from ${eventParticipants} p where p.event_id = ${events.id} and p.status = 'going')`,
  participantCount: sql<number>`(select coalesce(sum(1 + p.seats), 0)::int from ${eventParticipants} p where p.event_id = ${events.id} and p.status = 'going')`,
  waitlistCount: sql<number>`(select count(*)::int from ${eventParticipants} p where p.event_id = ${events.id} and p.status = 'waitlist')`,
  myStatus: viewerId
    ? sql<string | null>`(select p.status from ${eventParticipants} p where p.event_id = ${events.id} and p.user_id = ${viewerId})`
    : sql<string | null>`null`,
});
type SummaryRow = {
  e: EventRow;
  orgId: string;
  orgName: string;
  orgAvatar: string | null;
  spotName: string | null;
  spotType: 'trail' | 'camp' | null;
  spotDifficulty: number | null;
  spotLat: number | null;
  spotLng: number | null;
  clanName: string | null;
  clanTag: string | null;
  carCount: number;
  participantCount: number;
  waitlistCount: number;
  myStatus: string | null;
};

const baseQuery = (db: Db, viewerId: string | null) =>
  db
    .select(summaryFields(viewerId))
    .from(events)
    .innerJoin(users, eq(users.id, events.organizerId))
    .leftJoin(spots, eq(spots.id, events.spotId))
    .leftJoin(clans, eq(clans.id, events.clanId));

function toSummary(r: SummaryRow, viewerId: string | null) {
  const e = r.e;
  const st = eventState(e);
  const myStatus =
    viewerId && e.organizerId === viewerId
      ? 'organizer'
      : r.myStatus === 'going' || r.myStatus === 'waitlist'
        ? r.myStatus
        : null;
  return {
    id: e.id,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    spot:
      e.spotId && r.spotName !== null
        ? { id: e.spotId, name: r.spotName, type: r.spotType, difficulty: r.spotDifficulty, lat: r.spotLat, lng: r.spotLng }
        : null,
    meetingPoint: e.meetingLat !== null && e.meetingLng !== null ? { lat: e.meetingLat, lng: e.meetingLng, label: e.meetingLabel ?? '' } : null,
    maxCars: e.maxCars,
    minDifficulty: e.minDifficulty,
    requirements: e.requirements,
    visibility: e.visibility,
    clan: e.clanId && r.clanName !== null ? { id: e.clanId, name: r.clanName, tag: r.clanTag } : null,
    organizer: userRef({ id: r.orgId, displayName: r.orgName, avatarImageId: r.orgAvatar }),
    status: st.status,
    participantCount: r.participantCount,
    carCount: r.carCount,
    waitlistCount: r.waitlistCount,
    isFull: r.carCount >= e.maxCars,
    myStatus: myStatus as 'organizer' | 'going' | 'waitlist' | null,
    coverUrl: imageUrl(e.coverImageId),
  };
}
export type EventSummary = ReturnType<typeof toSummary>;

async function conversationIdOf(db: Db, eventId: string) {
  const [c] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.eventId, eventId));
  return c?.id ?? null;
}

/** Full event as `viewerId` sees it. Throws 404 when it doesn't exist or isn't visible. */
export async function loadEvent(db: Db, id: string, viewerId: string | null) {
  const [r] = await baseQuery(db, viewerId)
    .where(and(eq(events.id, id), visibleSql(viewerId)))
    .limit(1);
  if (!r) throw notFound('Event not found');
  const s = toSummary(r as SummaryRow, viewerId);
  const st = eventState(r.e);
  return {
    ...s,
    description: r.e.description,
    cancelReason: r.e.cancelReason,
    cancelledAt: r.e.cancelledAt ? r.e.cancelledAt.toISOString() : null,
    // only participants get the chat; it disappears 7 days after cancel/finish
    conversationId: s.myStatus && !st.chatClosed ? await conversationIdOf(db, id) : null,
    chatReadOnly: st.readOnly,
    canEdit: s.myStatus === 'organizer' && st.status === 'scheduled' && !st.started,
    createdAt: r.e.createdAt.toISOString(),
    updatedAt: r.e.updatedAt.toISOString(),
  };
}

/** Upcoming (not finished, not cancelled) events matching `where`, visible to the viewer. Used by spot + clan pages. */
export async function upcomingEvents(db: Db, where: SQL, viewerId: string | null, limit = 5) {
  const rows = await baseQuery(db, viewerId)
    .where(and(where, visibleSql(viewerId), eq(events.status, 'scheduled'), notFinishedSql))
    .orderBy(asc(events.startsAt), asc(events.id))
    .limit(limit);
  return (rows as SummaryRow[]).map((r) => toSummary(r, viewerId));
}

const encodeCursor = (d: Date, id: string) => Buffer.from(`${d.toISOString()}|${id}`).toString('base64url');
function decodeCursor(c: string) {
  const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
  const d = new Date(iso);
  if (!id || Number.isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('Invalid cursor');
  return { d, id };
}

// ---------------- routes ----------------

export async function eventRoutes(app: FastifyInstance) {
  const db = app.db;
  const photoLimit = makeLimiter(app, {
    max: app.config.rateLimits.create,
    timeWindow: '1 hour',
    key: (req) => `photo:${req.userId}`,
  });
  const joinLimit = makeLimiter(app, { max: 60, timeWindow: '1 hour', key: (req) => `eventjoin:${req.userId}` });

  /** Pushes system messages and membership changes to sockets after the transaction committed. */
  const afterCommit = async (
    eventId: string,
    convId: string | null,
    out: { msgs: MsgRow[]; add: string[]; remove: string[] },
  ) => {
    if (!convId) return;
    for (const u of out.add) app.realtime.addMember(u, convId);
    for (const m of out.msgs) await broadcastMessage(app, m, null);
    app.realtime.toConversation(convId, 'event:updated', { eventId });
    // removed users are told last, then dropped from the room
    for (const u of out.remove) {
      app.realtime.toUser(u, 'event:updated', { eventId });
      app.realtime.removeMember(u, convId);
    }
  };

  /**
   * Lock the event row and run fn. Every change to participants goes through here, so joins, leaves,
   * removals and edits of one event are serialised (no overbooking).
   */
  const withEventLock = async <T>(id: string, fn: (tx: Tx, e: EventRow, convId: string | null) => Promise<T>) =>
    db.transaction(async (tx) => {
      const [e] = await tx.select().from(events).where(eq(events.id, id)).for('update').limit(1);
      if (!e) throw notFound('Event not found');
      const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.eventId, id));
      return fn(tx, e, c?.id ?? null);
    });

  const assertVisible = async (tx: Tx, id: string, viewerId: string) => {
    const [v] = await tx.select({ id: events.id }).from(events).where(and(eq(events.id, id), visibleSql(viewerId)));
    if (!v) throw notFound('Event not found');
  };

  const displayName = async (tx: Tx, userId: string) => {
    const [u] = await tx.select({ n: users.displayName }).from(users).where(eq(users.id, userId));
    return u?.n ?? '';
  };

  const sysMsg = async (tx: Tx, convId: string | null, msgs: MsgRow[], key: SystemKey, params: Record<string, unknown>) => {
    if (convId) msgs.push(await insertSystemMessage(tx, convId, key, params));
  };

  /** Move the first waitlisted people (FIFO) to going while there are free places. */
  const promote = async (tx: Tx, e: EventRow, convId: string | null, msgs: MsgRow[]) => {
    const st = eventState(e);
    if (e.status !== 'scheduled' || st.finished) return;
    const [g] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.status, 'going')));
    const free = e.maxCars - g.n;
    if (free <= 0) return;
    const next = await tx
      .select({ userId: eventParticipants.userId, name: users.displayName })
      .from(eventParticipants)
      .innerJoin(users, eq(users.id, eventParticipants.userId))
      .where(and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.status, 'waitlist')))
      .orderBy(asc(eventParticipants.joinedAt), asc(eventParticipants.userId))
      .limit(free);
    if (!next.length) return;
    await tx
      .update(eventParticipants)
      .set({ status: 'going' })
      .where(and(eq(eventParticipants.eventId, e.id), inArray(eventParticipants.userId, next.map((n) => n.userId))));
    for (const n of next) await sysMsg(tx, convId, msgs, 'event.promoted', { userId: n.userId, displayName: n.name });
  };

  const ownCar = async (tx: Tx | Db, carId: string, userId: string) => {
    const [c] = await tx.select({ ownerId: cars.ownerId }).from(cars).where(eq(cars.id, carId)).limit(1);
    if (!c) throw notFound('Car not found');
    if (c.ownerId !== userId) throw forbidden('You can only join with one of your own cars');
  };

  const checkSpot = async (spotId: string) => {
    const [s] = await db.select({ id: spots.id }).from(spots).where(eq(spots.id, spotId)).limit(1);
    if (!s) throw notFound('Spot not found');
  };

  const myClanId = async (tx: Tx | Db, userId: string) => {
    const [m] = await tx.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, userId));
    return m?.clanId ?? null;
  };

  // ---- list ----
  app.get('/events', async (req) => {
    const q = parse(listQuery, req.query);
    const me = req.userId;
    if (q.scope === 'mine' && !me) throw forbidden('Log in to see your events');
    const conds: SQL[] = [visibleSql(me)];
    const past = q.scope === 'past';
    if (q.scope === 'upcoming') conds.push(eq(events.status, 'scheduled'), notFinishedSql);
    if (q.scope === 'mine') {
      conds.push(
        notFinishedSql,
        sql`(${events.organizerId} = ${me} or exists (select 1 from ${eventParticipants} ep where ep.event_id = ${events.id} and ep.user_id = ${me} and ep.status in ('going','waitlist')))`,
      );
    }
    if (past) conds.push(sql`(${events.status} = 'cancelled' or not (${notFinishedSql}))`);
    if (q.clanOnly) {
      if (!me) return { items: [], nextCursor: null };
      conds.push(
        eq(events.visibility, 'clan'),
        sql`exists (select 1 from ${clanMembers} cm where cm.user_id = ${me} and cm.clan_id = ${events.clanId})`,
      );
    }
    if (q.near) {
      const [lat, lng] = q.near;
      // location = spot, else meeting point; equirectangular distance is plenty for a radius filter
      const la = sql`coalesce(${spots.lat}, ${events.meetingLat})`;
      const ln = sql`coalesce(${spots.lng}, ${events.meetingLng})`;
      conds.push(
        sql`${la} is not null and 6371 * sqrt(power(radians(${la} - ${lat}), 2) + power(radians(${ln} - ${lng}) * cos(radians(${lat})), 2)) <= ${q.radiusKm}`,
      );
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      conds.push(
        past
          ? or(sql`${events.startsAt} < ${c.d.toISOString()}`, and(sql`${events.startsAt} = ${c.d.toISOString()}`, sql`${events.id} < ${c.id}`))!
          : or(sql`${events.startsAt} > ${c.d.toISOString()}`, and(sql`${events.startsAt} = ${c.d.toISOString()}`, sql`${events.id} > ${c.id}`))!,
      );
    }
    const rows = (await baseQuery(db, me)
      .where(and(...conds))
      .orderBy(...(past ? [desc(events.startsAt), desc(events.id)] : [asc(events.startsAt), asc(events.id)]))
      .limit(q.limit + 1)) as SummaryRow[];
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => toSummary(r, me)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.e.startsAt, last.e.id) : null,
    };
  });

  app.get('/events/:id', async (req) => loadEvent(db, idParam(req.params), req.userId));

  // ---- create ----
  app.post('/events', { preHandler: app.authenticate }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    const me = req.userId!;
    checkTimes(b.startsAt, b.endsAt);
    if (!b.spotId && !b.meetingPoint) throw badRequest('Pick a spot or a meeting point');
    if (b.spotId) await checkSpot(b.spotId);
    await ownCar(db, b.carId, me);
    const out = { msgs: [] as MsgRow[], add: [me], remove: [] as string[] };
    let created: { id: string; convId: string };
    try {
      created = await db.transaction(async (tx) => {
        // one creator at a time per user, so the limits below can't be raced
        await tx.select({ id: users.id }).from(users).where(eq(users.id, me)).for('update');
        const [day] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(events)
          .where(and(eq(events.organizerId, me), gt(events.createdAt, sql`now() - interval '24 hours'`)));
        if (day.n >= MAX_EVENTS_PER_DAY) throw conflict(`You can create at most ${MAX_EVENTS_PER_DAY} events per day`);
        const [up] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(events)
          .where(and(eq(events.organizerId, me), eq(events.status, 'scheduled'), notFinishedSql));
        if (up.n >= MAX_UPCOMING_ORGANIZED) {
          throw conflict(`You can organize at most ${MAX_UPCOMING_ORGANIZED} upcoming events`);
        }
        const clanId = await myClanId(tx, me);
        if (b.visibility === 'clan' && !clanId) throw conflict('Join a clan to create a clan-only event');
        const [e] = await tx
          .insert(events)
          .values({
            organizerId: me,
            title: b.title,
            description: b.description,
            startsAt: b.startsAt,
            endsAt: b.endsAt ?? null,
            spotId: b.spotId ?? null,
            meetingLat: b.meetingPoint?.lat ?? null,
            meetingLng: b.meetingPoint?.lng ?? null,
            meetingLabel: b.meetingPoint ? b.meetingPoint.label : null,
            maxCars: b.maxCars,
            minDifficulty: b.minDifficulty ?? null,
            requirements: b.requirements,
            visibility: b.visibility,
            clanId,
          })
          .returning({ id: events.id });
        await tx.insert(eventParticipants).values({ eventId: e.id, userId: me, carId: b.carId, seats: b.seats, status: 'going' });
        const [conv] = await tx.insert(conversations).values({ type: 'event', eventId: e.id }).returning({ id: conversations.id });
        await tx.insert(conversationMembers).values({ conversationId: conv.id, userId: me });
        return { id: e.id, convId: conv.id };
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) throw notFound('Spot or car not found'); // deleted meanwhile
      throw err;
    }
    await afterCommit(created.id, created.convId, out);
    return reply.status(201).send(await loadEvent(db, created.id, me));
  });

  // ---- edit (organizer, before start) ----
  app.patch('/events/:id', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const b = parse(patchSchema, req.body);
    const me = req.userId!;
    if (b.spotId) await checkSpot(b.spotId);
    const out = { msgs: [] as MsgRow[], add: [] as string[], remove: [] as string[] };
    const convId = await withEventLock(id, async (tx, e, convId) => {
      await assertVisible(tx, id, me);
      if (e.organizerId !== me) throw forbidden('Only the organizer can edit this event');
      if (e.status === 'cancelled') throw conflict('This event was cancelled');
      if (e.startsAt.getTime() <= Date.now()) throw conflict('An event cannot be edited after it started');
      const startsAt = b.startsAt ?? e.startsAt;
      const endsAt = b.endsAt !== undefined ? b.endsAt : e.endsAt;
      if (b.startsAt !== undefined || b.endsAt !== undefined) checkTimes(startsAt, endsAt);
      const spotId = b.spotId !== undefined ? b.spotId : e.spotId;
      const mp = b.meetingPoint !== undefined ? b.meetingPoint : e.meetingLat !== null ? { lat: e.meetingLat } : null;
      if (!spotId && !mp) throw badRequest('Pick a spot or a meeting point');
      const set: Partial<typeof events.$inferInsert> = { updatedAt: new Date() };
      if (b.title !== undefined) set.title = b.title;
      if (b.description !== undefined) set.description = b.description;
      if (b.startsAt !== undefined) set.startsAt = b.startsAt;
      if (b.endsAt !== undefined) set.endsAt = b.endsAt;
      if (b.spotId !== undefined) set.spotId = b.spotId;
      if (b.meetingPoint !== undefined) {
        set.meetingLat = b.meetingPoint?.lat ?? null;
        set.meetingLng = b.meetingPoint?.lng ?? null;
        set.meetingLabel = b.meetingPoint ? b.meetingPoint.label : null;
      }
      if (b.minDifficulty !== undefined) set.minDifficulty = b.minDifficulty;
      if (b.requirements !== undefined) set.requirements = b.requirements;
      if (b.visibility !== undefined) {
        set.visibility = b.visibility;
        if (b.visibility === 'clan' && !e.clanId) {
          const clanId = await myClanId(tx, me);
          if (!clanId) throw conflict('Join a clan to make this a clan-only event');
          set.clanId = clanId;
        }
      }
      if (b.maxCars !== undefined) {
        const [g] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(eventParticipants)
          .where(and(eq(eventParticipants.eventId, id), eq(eventParticipants.status, 'going')));
        if (b.maxCars < g.n) throw conflict(`${g.n} cars are already going; max cars can't be lower`);
        set.maxCars = b.maxCars;
      }
      try {
        await tx.update(events).set(set).where(eq(events.id, id));
      } catch (err) {
        if (isForeignKeyViolation(err)) throw notFound('Spot not found');
        throw err;
      }
      const changed = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
      if (changed.length) await sysMsg(tx, convId, out.msgs, 'event.edited', { fields: changed });
      if (b.maxCars !== undefined && b.maxCars > e.maxCars) await promote(tx, { ...e, maxCars: b.maxCars }, convId, out.msgs);
      return convId;
    });
    await afterCommit(id, convId, out);
    return loadEvent(db, id, me);
  });

  // ---- cancel (organizer) ----
  app.post('/events/:id/cancel', { preHandler: app.authenticate }, async (req) => {
    const id = idParam(req.params);
    const b = parse(cancelSchema, req.body);
    const me = req.userId!;
    const out = { msgs: [] as MsgRow[], add: [] as string[], remove: [] as string[] };
    const convId = await withEventLock(id, async (tx, e, convId) => {
      await assertVisible(tx, id, me);
      if (e.organizerId !== me) throw forbidden('Only the organizer can cancel this event');
      if (e.status === 'cancelled') throw conflict('This event is already cancelled');
      if (eventState(e).finished) throw conflict('This event has already finished');
      const reason = b.reason ? b.reason : null;
      await tx
        .update(events)
        .set({ status: 'cancelled', cancelReason: reason, cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(events.id, id));
      await sysMsg(tx, convId, out.msgs, 'event.cancelled', { reason });
      return convId;
    });
    await afterCommit(id, convId, out);
    return loadEvent(db, id, me);
  });

  // ---- join / leave ----
  app.post('/events/:id/join', { preHandler: [app.authenticate, joinLimit] }, async (req) => {
    const id = idParam(req.params);
    const b = parse(joinSchema, req.body);
    const me = req.userId!;
    await ownCar(db, b.carId, me);
    const out = { msgs: [] as MsgRow[], add: [] as string[], remove: [] as string[] };
    let convId: string | null;
    try {
      convId = await withEventLock(id, async (tx, e, convId) => {
        await assertVisible(tx, id, me);
        const st = eventState(e);
        if (e.status === 'cancelled') throw conflict('This event was cancelled');
        if (st.started) throw conflict('This event has already started');
        if (await eitherBlocked(db, me, e.organizerId)) throw forbidden('You cannot join this event');
        const [existing] = await tx
          .select({ status: eventParticipants.status })
          .from(eventParticipants)
          .where(and(eq(eventParticipants.eventId, id), eq(eventParticipants.userId, me)));
        if (existing?.status === 'removed') throw forbidden('The organizer removed you from this event');
        if (existing) throw conflict('You already joined this event');
        const [g] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(eventParticipants)
          .where(and(eq(eventParticipants.eventId, id), eq(eventParticipants.status, 'going')));
        const status = g.n < e.maxCars ? 'going' : 'waitlist';
        await tx.insert(eventParticipants).values({ eventId: id, userId: me, carId: b.carId, seats: b.seats, status });
        if (convId) await tx.insert(conversationMembers).values({ conversationId: convId, userId: me }).onConflictDoNothing();
        out.add.push(me);
        await sysMsg(tx, convId, out.msgs, status === 'going' ? 'event.joined' : 'event.waitlisted', {
          userId: me,
          displayName: await displayName(tx, me),
        });
        return convId;
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) throw notFound('Car not found'); // deleted meanwhile
      throw err;
    }
    await afterCommit(id, convId, out);
    return loadEvent(db, id, me);
  });

  /** Take a participant out (leave or removal), drop them from the chat and promote from the waitlist. */
  const takeOut = async (tx: Tx, e: EventRow, convId: string | null, userId: string, removed: boolean, msgs: MsgRow[]) => {
    const [p] = await tx
      .select({ status: eventParticipants.status })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.userId, userId)));
    if (!p || p.status === 'removed') throw notFound(removed ? 'Participant not found' : 'You are not in this event');
    if (removed) {
      await tx
        .update(eventParticipants)
        .set({ status: 'removed' })
        .where(and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.userId, userId)));
    } else {
      await tx.delete(eventParticipants).where(and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.userId, userId)));
    }
    if (convId) {
      await tx
        .delete(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, convId), eq(conversationMembers.userId, userId)));
    }
    await sysMsg(tx, convId, msgs, removed ? 'event.removed' : 'event.left', {
      userId,
      displayName: await displayName(tx, userId),
    });
    if (p.status === 'going') await promote(tx, e, convId, msgs);
  };

  app.post('/events/:id/leave', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const me = req.userId!;
    const out = { msgs: [] as MsgRow[], add: [] as string[], remove: [me] };
    const convId = await withEventLock(id, async (tx, e, convId) => {
      await assertVisible(tx, id, me);
      if (e.organizerId === me) throw conflict('The organizer cannot leave; cancel the event instead');
      await takeOut(tx, e, convId, me, false, out.msgs);
      return convId;
    });
    await afterCommit(id, convId, out);
    // 204: a clan-only event may now be hidden from the user who left, so reload it with GET if needed
    return reply.status(204).send();
  });

  app.delete('/events/:id/participants/:userId', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const userId = idParam(req.params, 'userId');
    const me = req.userId!;
    const out = { msgs: [] as MsgRow[], add: [] as string[], remove: [userId] };
    const convId = await withEventLock(id, async (tx, e, convId) => {
      await assertVisible(tx, id, me);
      if (e.organizerId !== me) throw forbidden('Only the organizer can remove participants');
      if (userId === me) throw conflict('The organizer cannot remove themselves');
      if (e.status === 'cancelled' || eventState(e).finished) throw conflict('This event is over');
      await takeOut(tx, e, convId, userId, true, out.msgs);
      return convId;
    });
    await afterCommit(id, convId, out);
    return reply.status(204).send();
  });

  app.get('/events/:id/participants', async (req) => {
    const id = idParam(req.params);
    const ev = await loadEvent(db, id, req.userId);
    const rows = await db
      .select({
        ...userRefCols,
        status: eventParticipants.status,
        seats: eventParticipants.seats,
        joinedAt: eventParticipants.joinedAt,
        car: cars,
      })
      .from(eventParticipants)
      .innerJoin(users, eq(users.id, eventParticipants.userId))
      .leftJoin(cars, eq(cars.id, eventParticipants.carId))
      .where(and(eq(eventParticipants.eventId, id), inArray(eventParticipants.status, ['going', 'waitlist'])))
      .orderBy(
        sql`case when ${eventParticipants.userId} = ${ev.organizer.id} then 0 when ${eventParticipants.status} = 'going' then 1 else 2 end`,
        asc(eventParticipants.joinedAt),
        asc(eventParticipants.userId),
      );
    return {
      items: rows.map((r) => ({
        user: userRef(r),
        status: r.status as 'going' | 'waitlist',
        isOrganizer: r.id === ev.organizer.id,
        seats: r.seats,
        car: r.car
          ? { id: r.car.id, make: r.car.make, model: r.car.model, year: r.car.year, photoUrl: imageUrl(r.car.photoImageId) }
          : null,
        joinedAt: r.joinedAt.toISOString(),
      })),
    };
  });

  // ---- cover photo (organizer; same pipeline + quota as other photos) ----
  const loadOrganized = async (id: string, me: string) => {
    const [e] = await db.select().from(events).where(and(eq(events.id, id), visibleSql(me))).limit(1);
    if (!e) throw notFound('Event not found');
    if (e.organizerId !== me) throw forbidden('Only the organizer can change the cover');
    return e;
  };
  app.put('/events/:id/cover', { bodyLimit: MAX_UPLOAD_BYTES, preHandler: [app.authenticate, photoLimit] }, async (req) => {
    const id = idParam(req.params);
    const e = await loadOrganized(id, req.userId!);
    const imageId = await storeImage(db, req.userId!, 'event', req.body, e.coverImageId);
    await db.update(events).set({ coverImageId: imageId }).where(eq(events.id, id));
    await deleteImage(db, e.coverImageId);
    return { coverUrl: imageUrl(imageId) };
  });
  app.delete('/events/:id/cover', { preHandler: app.authenticate }, async (req, reply) => {
    const id = idParam(req.params);
    const e = await loadOrganized(id, req.userId!);
    await db.update(events).set({ coverImageId: null }).where(eq(events.id, id));
    await deleteImage(db, e.coverImageId);
    return reply.status(204).send();
  });
}
