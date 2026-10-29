import { sql } from 'drizzle-orm';

/** An event with no end time counts as finished this long after it starts. */
export const DEFAULT_EVENT_LENGTH_MS = 24 * 60 * 60 * 1000;
/** Cancelled / finished events keep a read-only chat for this long. */
export const READ_ONLY_CHAT_MS = 7 * 24 * 60 * 60 * 1000;

type EventTimes = { status: 'scheduled' | 'cancelled'; startsAt: Date; endsAt: Date | null; cancelledAt: Date | null };

export const eventEnd = (e: Pick<EventTimes, 'startsAt' | 'endsAt'>) =>
  e.endsAt ?? new Date(e.startsAt.getTime() + DEFAULT_EVENT_LENGTH_MS);

/**
 * Derived state of an event and its chat.
 * - finished: the end time (or start + 24 h) has passed.
 * - readOnly: cancelled or finished -> nobody can post.
 * - chatClosesAt: 7 days after cancel / end; after that the chat is gone (404, hidden from the list).
 */
export function eventState(e: EventTimes, now = new Date()) {
  const end = eventEnd(e);
  const finished = end.getTime() <= now.getTime();
  const started = e.startsAt.getTime() <= now.getTime();
  const closedAt = e.status === 'cancelled' ? (e.cancelledAt ?? now) : finished ? end : null;
  const chatClosesAt = closedAt ? new Date(closedAt.getTime() + READ_ONLY_CHAT_MS) : null;
  return {
    status: e.status === 'cancelled' ? ('cancelled' as const) : finished ? ('finished' as const) : ('scheduled' as const),
    started,
    finished,
    readOnly: closedAt !== null,
    chatClosesAt,
    chatClosed: chatClosesAt !== null && chatClosesAt.getTime() <= now.getTime(),
  };
}

/** SQL: end time of the event aliased/qualified as `e` (a table reference expression). */
export const endSql = (e: string) =>
  sql.raw(`coalesce(${e}.ends_at, ${e}.starts_at + interval '${DEFAULT_EVENT_LENGTH_MS / 1000} seconds')`);
/** SQL: the event's chat is past its read-only window. */
export const chatClosedSql = (e: string) =>
  sql.raw(
    `(case when ${e}.status = 'cancelled' then ${e}.cancelled_at else coalesce(${e}.ends_at, ${e}.starts_at + interval '${DEFAULT_EVENT_LENGTH_MS / 1000} seconds') end) + interval '${READ_ONLY_CHAT_MS / 1000} seconds' <= now()`,
  );
