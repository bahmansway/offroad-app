import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { blocks, clanMembers, clans, conversationMembers, conversations, events, users } from '../db/schema.js';
import { chatClosedSql } from '../lib/eventState.js';
import { parse } from '../lib/errors.js';
import { makeLimiter } from '../lib/limits.js';
import { imageUrl } from '../lib/images.js';
import { likePattern, notBlockedSql } from '../lib/friends.js';
import { userRef } from '../lib/users.js';
import { conversationSummary } from './chat.js';
import type { Period } from '../lib/leaderboard.js';

const searchQuery = z.object({ q: z.string().trim().min(2).max(40) });
const boardQuery = z.object({ period: z.enum(['month', 'all']).default('month') });

export async function searchRoutes(app: FastifyInstance) {
  const db = app.db;
  const searchLimit = makeLimiter(app, {
    max: 60,
    timeWindow: '1 minute',
    key: (req) => (req.userId ? `search:u:${req.userId}` : `search:ip:${req.ip}`),
  });

  // Users (friends first, blocked either way left out), clans, and my own chats.
  app.get('/search', { preHandler: searchLimit }, async (req) => {
    const { q } = parse(searchQuery, req.query);
    const me = req.userId;
    const like = likePattern(q);
    const isFriend = me
      ? sql<boolean>`exists (select 1 from friendships f where f.user_id = ${me} and f.friend_id = ${users.id})`
      : sql<boolean>`false`;
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName, avatarImageId: users.avatarImageId, city: users.city, isFriend })
      .from(users)
      .where(and(ilike(users.displayName, like), me ? ne(users.id, me) : undefined, me ? notBlockedSql(me, users.id) : undefined))
      .orderBy(...(me ? [desc(isFriend)] : []), asc(sql`lower(${users.displayName})`), asc(users.id))
      .limit(10);
    const memberCount = sql<number>`(select count(*)::int from ${clanMembers} m where m.clan_id = ${clans.id})`;
    const clanRows = await db
      .select({ c: clans, n: memberCount })
      .from(clans)
      .where(or(ilike(clans.name, like), ilike(clans.tag, like)))
      .orderBy(desc(memberCount), asc(clans.name))
      .limit(5);
    let convs: Awaited<ReturnType<typeof conversationSummary>>[] = [];
    if (me) {
      // title (group name, clan name, event title) or the name of another member of a DM / group
      const rows = await db
        .select({ c: conversations })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .leftJoin(events, eq(events.id, conversations.eventId))
        .leftJoin(clans, eq(clans.id, conversations.clanId))
        .where(
          and(
            eq(conversationMembers.userId, me),
            or(ne(conversations.type, 'event'), sql`not (${chatClosedSql('events')})`),
            or(
              ilike(conversations.name, like),
              ilike(clans.name, like),
              ilike(events.title, like),
              sql`(${conversations.type} in ('dm','group') and exists (
                select 1 from conversation_members cm2 join users u2 on u2.id = cm2.user_id
                where cm2.conversation_id = ${conversations.id} and cm2.user_id <> ${me} and u2.display_name ilike ${like}
                  and not exists (select 1 from blocks b where b.blocker_id = ${me} and b.blocked_id = u2.id)))`,
            ),
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(10);
      convs = await Promise.all(rows.map((r) => conversationSummary(db, r.c, me)));
    }
    return {
      users: userRows.map((u) => ({ ...userRef(u), city: u.city, isFriend: !!u.isFriend })),
      clans: clanRows.map((r) => ({
        id: r.c.id,
        name: r.c.name,
        tag: r.c.tag,
        logoUrl: imageUrl(r.c.logoImageId),
        city: r.c.city,
        isOpen: r.c.isOpen,
        memberCount: r.n,
      })),
      conversations: convs,
    };
  });

  app.get('/leaderboard', async (req) => {
    const { period } = parse(boardQuery, req.query);
    const me = req.userId;
    const board = await app.leaderboard.get(period as Period);
    let blocked = new Set<string>();
    if (me && board.items.length) {
      const rows = await db
        .select({ a: blocks.blockerId, b: blocks.blockedId })
        .from(blocks)
        .where(or(eq(blocks.blockerId, me), eq(blocks.blockedId, me)));
      blocked = new Set(rows.map((r) => (r.a === me ? r.b : r.a)));
    }
    const mine = me ? board.ranks.get(me) : undefined;
    return {
      period: board.period,
      monthStart: board.monthStart,
      computedAt: board.computedAt,
      items: board.items.map((i) => ({ ...i, blocked: blocked.has(i.user.id) })),
      me: me ? { rank: mine?.rank ?? null, points: mine?.points ?? 0 } : null,
    };
  });
}
