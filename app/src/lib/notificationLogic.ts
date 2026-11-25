import type { EventSummary, Id } from './types';
import { bakuTime, placeName } from './eventLogic';

/**
 * Pure notification helpers (no React, no native modules) so they can be unit-tested:
 * Expo Go detection, where a tapped notification goes, the foreground banner rule,
 * and the local event-reminder sync (which reminders should exist vs. which are scheduled).
 */

// ---------- Expo Go ----------

/** Remote push does not work in Expo Go (SDK 53+): only reminders do. */
export function isExpoGo(c: { executionEnvironment?: string | null; appOwnership?: string | null }): boolean {
  return c.executionEnvironment === 'storeClient' || c.appOwnership === 'expo';
}

/** Show the short "why notifications" screen before the system prompt: only once, only while undecided. */
export function shouldShowPrePrompt(o: { platform: string; status: string | null; askedBefore: boolean }): boolean {
  return o.platform !== 'web' && o.status === 'undetermined' && !o.askedBefore;
}

// ---------- tap routing ----------

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const okId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);

/** Data the server (and our reminders) put on a notification. */
export type NotificationData = Record<string, unknown> | null | undefined;

/** The screen a notification opens, or null when the data is unknown / broken. */
export function routeForNotification(data: NotificationData): string | null {
  if (!data || typeof data !== 'object') return null;
  switch (data.type) {
    case 'message':
      return okId(data.conversationId) ? `/chat/${data.conversationId}` : null;
    case 'friend_request':
      return '/friends?tab=in';
    case 'friend_accepted':
      return '/friends';
    case 'post_like':
    case 'post_comment':
      return okId(data.postId) ? `/post/${data.postId}` : null;
    case 'follow':
      return okId(data.userId) ? `/user/${data.userId}` : null;
    case 'clan_invite':
      return '/clans';
    case 'clan_request':
      return okId(data.clanId) ? `/clan/${data.clanId}` : '/clans';
    case 'event':
      return okId(data.eventId) ? `/event/${data.eventId}` : null;
    default:
      return null;
  }
}

/** In the foreground: nothing when that chat is already open on screen, otherwise our own in-app banner. */
export function foregroundAction(data: NotificationData, openConversationId: Id | null | undefined): 'skip' | 'banner' {
  if (data && data.type === 'message' && openConversationId != null && String(data.conversationId) === String(openConversationId)) {
    return 'skip';
  }
  return 'banner';
}

/** Android channels (ids must match what the server sends as channelId). */
export const CHANNELS = ['messages', 'events'] as const;
export type ChannelId = (typeof CHANNELS)[number];

// ---------- event reminders ----------

export type ReminderKind = '24h' | '2h';
export const REMINDER_OFFSETS: Record<ReminderKind, number> = { '24h': 24 * 60 * 60 * 1000, '2h': 2 * 60 * 60 * 1000 };
/** Identifier prefix of our scheduled reminders (other scheduled notifications are left alone). */
export const REMINDER_PREFIX = 'yolchu-reminder:';
/** A reminder this close (or already past) is not scheduled. */
const MIN_LEAD_MS = 10 * 1000;

export const reminderId = (eventId: Id, kind: ReminderKind) => `${REMINDER_PREFIX}${eventId}:${kind}`;
export const isReminderId = (id: string) => id.startsWith(REMINDER_PREFIX);
export const reminderEventId = (id: string) => (isReminderId(id) ? id.slice(REMINDER_PREFIX.length).split(':')[0] : null);

export interface PlannedReminder {
  id: string;
  eventId: string;
  kind: ReminderKind;
  fireAt: number;
  title: string;
  body: string;
  data: { type: 'event'; eventId: string; reminder: ReminderKind };
}

export interface ScheduledReminder {
  id: string;
  /** null when the trigger date could not be read */
  fireAt: number | null;
  title?: string | null;
  body?: string | null;
}

export interface ReminderWords {
  /** "Sabah 09:00 · Xızı" — `place` may be null */
  dayBefore: (time: string, place: string | null) => string;
  /** "2 saata başlayır · Xızı" */
  soon: (place: string | null) => string;
}

type ReminderEvent = Pick<EventSummary, 'id' | 'title' | 'startsAt' | 'status' | 'myStatus' | 'spot' | 'meetingPoint'>;

/** I get reminders for scheduled events where I'm the organizer or going (not the waitlist). */
export function wantsReminders(e: Pick<EventSummary, 'status' | 'myStatus'>): boolean {
  return e.status === 'scheduled' && (e.myStatus === 'organizer' || e.myStatus === 'going');
}

/** The reminders that should exist right now: 24 h and 2 h before each start, skipping times already passed. */
export function plannedReminders(events: ReminderEvent[], o: { now: number; enabled: boolean; words: ReminderWords }): PlannedReminder[] {
  if (!o.enabled) return [];
  const out = new Map<string, PlannedReminder>();
  for (const e of events) {
    if (!wantsReminders(e)) continue;
    const start = Date.parse(e.startsAt);
    if (Number.isNaN(start)) continue;
    const place = placeName(e);
    for (const kind of Object.keys(REMINDER_OFFSETS) as ReminderKind[]) {
      const fireAt = start - REMINDER_OFFSETS[kind];
      if (fireAt <= o.now + MIN_LEAD_MS) continue;
      const id = reminderId(String(e.id), kind);
      out.set(id, {
        id,
        eventId: String(e.id),
        kind,
        fireAt,
        title: e.title,
        body: kind === '24h' ? o.words.dayBefore(bakuTime(e.startsAt), place) : o.words.soon(place),
        data: { type: 'event', eventId: String(e.id), reminder: kind },
      });
    }
  }
  return [...out.values()];
}

/**
 * What to change so the scheduled reminders match the planned ones.
 * - `onlyEventId`: just one event (the event page after join / leave), others untouched.
 * A reminder whose time or text changed is cancelled and scheduled again.
 */
export function planReminderSync(
  planned: PlannedReminder[],
  scheduled: ScheduledReminder[],
  onlyEventId?: Id,
): { cancel: string[]; schedule: PlannedReminder[] } {
  const inScope = (id: string) => isReminderId(id) && (onlyEventId == null || reminderEventId(id) === String(onlyEventId));
  const want = new Map(planned.filter((p) => inScope(p.id)).map((p) => [p.id, p]));
  const have = new Map(scheduled.filter((s) => inScope(s.id)).map((s) => [s.id, s]));
  const cancel: string[] = [];
  const schedule: PlannedReminder[] = [];
  for (const [id, s] of have) {
    const p = want.get(id);
    const same = p && s.fireAt != null && Math.abs(s.fireAt - p.fireAt) < 1000 && (s.title ?? '') === p.title && (s.body ?? '') === p.body;
    if (!same) cancel.push(id);
  }
  for (const [id, p] of want) {
    if (!have.has(id) || cancel.includes(id)) schedule.push(p);
  }
  return { cancel, schedule };
}

// ---------- taps ----------

/**
 * The notification that started the app can also reach the tap listener: open it only once.
 * Returns a checker that says true the first time it sees an id (remembers the last `max`).
 */
export function createTapDeduper(max = 20) {
  const seen: string[] = [];
  return (id: string | null | undefined): boolean => {
    if (!id) return true; // no id: can't tell, let it through
    if (seen.includes(id)) return false;
    seen.push(id);
    if (seen.length > max) seen.shift();
    return true;
  };
}

// ---------- paging ----------

/**
 * All items of a cursor-paged list (my events for the reminder sync). Stops when there is no next
 * cursor, or the server repeats a cursor (never loops forever).
 */
export async function collectPages<T>(fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const r = await fetchPage(cursor);
    out.push(...r.items);
    if (!r.nextCursor || seen.has(r.nextCursor)) return out;
    seen.add(r.nextCursor);
    cursor = r.nextCursor;
  }
}
