import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { clanMembers, clans, conversationMembers, conversations, eventParticipants, events, spots } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { Push, PushLocale } from './push.js';
import { truncate } from './push.js';
import { eitherBlocked } from './users.js';

type ConvRow = typeof conversations.$inferSelect;
type Who = { id: string; displayName: string };

/**
 * Who gets which phone notification (SPEC-v5 §1). Every function returns at once; the work runs in the
 * background after the caller's database change is committed. Never to the sender. Recipients who
 * blocked the sender are skipped, chats a recipient muted are skipped, settings are applied by `push`.
 */

const T: Record<PushLocale, Record<string, string>> = {
  az: {
    friendRequestTitle: 'Dostluq təklifi',
    friendRequestBody: '{name} sizə dostluq təklifi göndərdi',
    friendAcceptedTitle: 'Yeni dost',
    friendAcceptedBody: '{name} dostluq təklifinizi qəbul etdi',
    clanInviteTitle: 'Klana dəvət',
    clanInviteBody: '{name} sizi «{clan}» klanına dəvət edir',
    clanRequestTitle: 'Klana qoşulmaq istəyi',
    clanRequestBody: '{name} «{clan}» klanına qoşulmaq istəyir',
    promotedBody: 'Yer açıldı: artıq iştirakçılar siyahısındasınız',
    cancelledBody: 'Tədbir ləğv edildi',
    cancelledReasonBody: 'Tədbir ləğv edildi: {reason}',
    editedBody: 'Vaxt və ya yer dəyişdi: {when}',
    editedPlaceBody: 'Vaxt və ya yer dəyişdi: {when} · {place}',
  },
  en: {
    friendRequestTitle: 'Friend request',
    friendRequestBody: '{name} sent you a friend request',
    friendAcceptedTitle: 'New friend',
    friendAcceptedBody: '{name} accepted your friend request',
    clanInviteTitle: 'Clan invite',
    clanInviteBody: '{name} invited you to join "{clan}"',
    clanRequestTitle: 'Clan join request',
    clanRequestBody: '{name} wants to join "{clan}"',
    promotedBody: 'A place opened up: you are now going',
    cancelledBody: 'The event was cancelled',
    cancelledReasonBody: 'The event was cancelled: {reason}',
    editedBody: 'New time or place: {when}',
    editedPlaceBody: 'New time or place: {when} · {place}',
  },
};
export const pushText = (l: PushLocale, key: string, p: Record<string, string> = {}) =>
  (T[l][key] ?? T.en[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? p[k] : m));

/** "22.11 09:00" in Baku time (UTC+4, no daylight saving). */
export function bakuShort(d: Date): string {
  const b = new Date(d.getTime() + 4 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(b.getUTCDate())}.${p(b.getUTCMonth() + 1)} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}

/** Fields whose change is worth a notification (time or place). */
export const EVENT_PUSH_FIELDS = ['startsAt', 'endsAt', 'spotId', 'meetingPoint'];

export function createNotifier(db: Db, push: Push) {
  /** Going + waitlisted people of an event, minus the organizer and anyone who blocked the organizer. */
  const eventAudience = async (eventId: string, organizerId: string) => {
    const rows = await db
      .select({ id: eventParticipants.userId })
      .from(eventParticipants)
      .where(
        and(
          eq(eventParticipants.eventId, eventId),
          inArray(eventParticipants.status, ['going', 'waitlist']),
          ne(eventParticipants.userId, organizerId),
          sql`not exists (select 1 from blocks b where b.blocker_id = ${eventParticipants.userId} and b.blocked_id = ${organizerId})`,
        ),
      );
    return rows.map((r) => r.id);
  };

  const loadEvent = async (eventId: string) => {
    const [e] = await db
      .select({ e: events, spotName: spots.name })
      .from(events)
      .leftJoin(spots, eq(spots.id, events.spotId))
      .where(eq(events.id, eventId));
    return e ?? null;
  };

  return {
    /** New chat message (user messages only; system messages never notify). */
    message(conv: ConvRow, m: { id: string; senderId: string | null; text: string }, sender: Who) {
      if (!m.senderId) return;
      push.background(async () => {
        const rows = await db
          .select({ id: conversationMembers.userId })
          .from(conversationMembers)
          .where(
            and(
              eq(conversationMembers.conversationId, conv.id),
              ne(conversationMembers.userId, sender.id),
              isNull(conversationMembers.mutedAt),
              sql`not exists (select 1 from blocks b where b.blocker_id = ${conversationMembers.userId} and b.blocked_id = ${sender.id})`,
            ),
          );
        if (!rows.length) return;
        let title = sender.displayName;
        if (conv.type === 'group') title = conv.name ?? title;
        else if (conv.type === 'clan' && conv.clanId) {
          const [c] = await db.select({ name: clans.name }).from(clans).where(eq(clans.id, conv.clanId));
          title = c?.name ?? title;
        } else if (conv.type === 'event' && conv.eventId) {
          const [e] = await db.select({ title: events.title }).from(events).where(eq(events.id, conv.eventId));
          title = e?.title ?? title;
        }
        // in a group / clan / event chat the body says who wrote it
        const body = conv.type === 'dm' ? m.text : `${sender.displayName}: ${m.text}`;
        await push.send(
          rows.map((r) => r.id),
          {
            category: 'messages',
            channelId: 'messages',
            text: () => ({ title, body: truncate(body) }),
            data: { type: 'message', conversationId: conv.id },
            coalesceKey: `conv:${conv.id}`,
          },
        );
      });
    },

    friendRequest(toId: string, from: Who) {
      push.background(() =>
        push.send([toId], {
          category: 'friends',
          channelId: 'messages',
          text: (l) => ({ title: pushText(l, 'friendRequestTitle'), body: pushText(l, 'friendRequestBody', { name: from.displayName }) }),
          data: { type: 'friend_request', userId: from.id },
        }),
      );
    },

    /** `toId` sent the request; `by` accepted it. */
    friendAccepted(toId: string, by: Who) {
      push.background(() =>
        push.send([toId], {
          category: 'friends',
          channelId: 'messages',
          text: (l) => ({ title: pushText(l, 'friendAcceptedTitle'), body: pushText(l, 'friendAcceptedBody', { name: by.displayName }) }),
          data: { type: 'friend_accepted', userId: by.id },
        }),
      );
    },

    clanInvite(toId: string, by: Who, clan: { id: string; name: string }, inviteId: string) {
      push.background(() =>
        push.send([toId], {
          category: 'clans',
          channelId: 'messages',
          text: (l) => ({ title: pushText(l, 'clanInviteTitle'), body: pushText(l, 'clanInviteBody', { name: by.displayName, clan: clan.name }) }),
          data: { type: 'clan_invite', clanId: clan.id, inviteId },
        }),
      );
    },

    /** A join request to a request-only clan: tell the leader and the navigators (officers). */
    clanJoinRequest(clan: { id: string; name: string }, from: Who) {
      push.background(async () => {
        const staff = await db
          .select({ id: clanMembers.userId })
          .from(clanMembers)
          .where(and(eq(clanMembers.clanId, clan.id), inArray(clanMembers.role, ['leader', 'officer'])));
        const ids: string[] = [];
        for (const s of staff) {
          if (s.id !== from.id && !(await eitherBlocked(db, s.id, from.id))) ids.push(s.id);
        }
        await push.send(ids, {
          category: 'clans',
          channelId: 'messages',
          text: (l) => ({ title: pushText(l, 'clanRequestTitle'), body: pushText(l, 'clanRequestBody', { name: from.displayName, clan: clan.name }) }),
          data: { type: 'clan_request', clanId: clan.id },
        });
      });
    },

    /** Moved from the waitlist to going. */
    eventPromoted(eventId: string, userIds: string[]) {
      if (!userIds.length) return;
      push.background(async () => {
        const ev = await loadEvent(eventId);
        if (!ev) return;
        await push.send(userIds, {
          category: 'events',
          channelId: 'events',
          text: (l) => ({ title: ev.e.title, body: pushText(l, 'promotedBody') }),
          data: { type: 'event', eventId },
        });
      });
    },

    eventCancelled(eventId: string) {
      push.background(async () => {
        const ev = await loadEvent(eventId);
        if (!ev) return;
        const reason = ev.e.cancelReason;
        await push.send(await eventAudience(eventId, ev.e.organizerId), {
          category: 'events',
          channelId: 'events',
          text: (l) => ({
            title: ev.e.title,
            body: reason ? pushText(l, 'cancelledReasonBody', { reason }) : pushText(l, 'cancelledBody'),
          }),
          data: { type: 'event', eventId },
        });
      });
    },

    /** The organizer changed the time or the place (`fields` = the changed field names). */
    eventEdited(eventId: string, fields: string[]) {
      if (!fields.some((f) => EVENT_PUSH_FIELDS.includes(f))) return;
      push.background(async () => {
        const ev = await loadEvent(eventId);
        if (!ev) return;
        const when = bakuShort(ev.e.startsAt);
        const place = ev.spotName ?? (ev.e.meetingLabel || '');
        await push.send(await eventAudience(eventId, ev.e.organizerId), {
          category: 'events',
          channelId: 'events',
          text: (l) => ({
            title: ev.e.title,
            body: place ? pushText(l, 'editedPlaceBody', { when, place }) : pushText(l, 'editedBody', { when }),
          }),
          data: { type: 'event', eventId },
        });
      });
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
