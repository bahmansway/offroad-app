import { and, eq, isNull, sql } from 'drizzle-orm';
import { chatClosedSql } from './eventState.js';
import { clanInvites } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { incomingRequestCount } from './friends.js';
import { newFollowerCount } from './follows.js';
import { unreadTotal } from '../routes/chat.js';

/**
 * Tab badges: unread messages, pending clan invites, new followers since last viewed (v6). `friendRequests`
 * (pending incoming, deprecated) stays for older app versions.
 */
export async function badgeCounts(db: Db, me: string) {
  const [inv] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clanInvites)
    .where(and(eq(clanInvites.userId, me), isNull(clanInvites.declinedAt), sql`${clanInvites.expiresAt} > now()`));
  return {
    messages: await unreadTotal(db, me),
    friendRequests: await incomingRequestCount(db, me),
    clanInvites: inv.n,
    newFollowers: await newFollowerCount(db, me),
  };
}

/**
 * App icon numbers for many users in ONE query (push sending). Same rules as `badgeCounts`:
 * unread (not muted, not deleted, not my own, sender not blocked by me, event chat not closed)
 * + new followers since last viewed (no block either way; v6, replaces friend requests) + pending, unexpired clan invites.
 */
export async function appBadges(db: Db, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(userIds)];
  if (!ids.length) return out;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const r = await db.execute<{ user_id: string; n: number }>(sql`
    with u(id) as (select unnest(array[${list}]))
    select u.id as user_id, (
      (select count(*) from messages m
         join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = u.id
         join conversations c on c.id = m.conversation_id
         left join events on events.id = c.event_id
        where cm.muted_at is null
          and m.deleted_at is null
          and (m.sender_id is null or m.sender_id <> u.id)
          and (m.sender_id is null or m.sender_id not in (select blocked_id from blocks where blocker_id = u.id))
          and m.created_at > cm.last_read_at
          and (c.type <> 'event' or not (${chatClosedSql('events')})))
      + (select count(*) from follows f
          where f.followee_id = u.id
            and f.created_at > coalesce((select s.seen_at from followers_seen s where s.user_id = u.id), '-infinity'::timestamptz)
            and not exists (select 1 from blocks b where (b.blocker_id = u.id and b.blocked_id = f.follower_id) or (b.blocker_id = f.follower_id and b.blocked_id = u.id)))
      + (select count(*) from clan_invites ci where ci.user_id = u.id and ci.declined_at is null and ci.expires_at > now())
    )::int as n
    from u`);
  for (const row of r.rows) out.set(row.user_id, Number(row.n));
  return out;
}
