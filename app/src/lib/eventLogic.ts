import type { EventDetail, EventInput, EventParticipant, EventSummary, Id } from './types';
import { sameId } from './format';

/**
 * Pure event helpers (no React, no network) so they can be unit-tested:
 * what the event page / list card should show, waitlist position, date formatting, form checks.
 */

export const EVENT_LIMITS = {
  titleMin: 3,
  titleMax: 80,
  descriptionMax: 2000,
  maxCarsMin: 2,
  maxCarsMax: 100,
  requirementsMax: 8,
  requirementMax: 24,
  labelMax: 80,
  reasonMax: 300,
  seatsMax: 6,
  /** the server allows up to one year ahead and at most 7 days long */
  yearMs: 365 * 24 * 60 * 60 * 1000,
  lengthMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/** Suggested requirement chips in the form (the user can also type their own). */
export const REQUIREMENT_SUGGESTIONS = ['4WD', 'Low range', 'AT tyres', 'Winch', 'Lift', 'Lockers', 'Radio', 'Recovery kit', 'Snorkel', 'Tent'];

type Ev = Pick<EventSummary, 'status' | 'startsAt' | 'myStatus' | 'carCount' | 'maxCars' | 'isFull' | 'waitlistCount'>;

/** cancelled / finished come from the server; "started" = scheduled but the start time has passed. */
export type EventPhase = 'upcoming' | 'started' | 'cancelled' | 'finished';

export function eventPhase(e: Pick<EventSummary, 'status' | 'startsAt'>, now: Date = new Date()): EventPhase {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.status === 'finished') return 'finished';
  return Date.parse(e.startsAt) <= now.getTime() ? 'started' : 'upcoming';
}

/** Free car places (never negative). */
export function placesLeft(e: Pick<EventSummary, 'carCount' | 'maxCars'>): number {
  return Math.max(0, e.maxCars - e.carCount);
}

export function isEventFull(e: Pick<EventSummary, 'carCount' | 'maxCars' | 'isFull'>): boolean {
  return !!e.isFull || e.carCount >= e.maxCars;
}

/**
 * What the main button area on the event page shows.
 * - login: logged out, event still open → "Log in to join"
 * - join / joinWaitlist: I can join (waitlist when full)
 * - organizer / going / waitlist: I am in
 * - closed: cancelled or finished (for everyone), or already started and I'm not in
 */
export type JoinState = 'login' | 'join' | 'joinWaitlist' | 'organizer' | 'going' | 'waitlist' | 'closed';

export function joinState(e: Ev, loggedIn: boolean, now: Date = new Date()): JoinState {
  const phase = eventPhase(e, now);
  // cancelled / finished: everyone sees the "closed" card (participants also get the read-only chat)
  if (phase === 'cancelled' || phase === 'finished') return 'closed';
  if (e.myStatus === 'organizer') return 'organizer';
  if (e.myStatus === 'going') return 'going';
  if (e.myStatus === 'waitlist') return 'waitlist';
  if (phase !== 'upcoming') return 'closed';
  if (!loggedIn) return 'login';
  return isEventFull(e) ? 'joinWaitlist' : 'join';
}

/** Can I leave? Organizers cancel instead; nobody leaves a finished/cancelled event. */
export function canLeave(e: Ev, now: Date = new Date()): boolean {
  const p = eventPhase(e, now);
  return (e.myStatus === 'going' || e.myStatus === 'waitlist') && (p === 'upcoming' || p === 'started');
}

/** Organizer can remove people until the event is over (server: 409 after cancel/finish). */
export function canRemoveParticipants(e: Pick<EventSummary, 'status' | 'myStatus'>): boolean {
  return e.myStatus === 'organizer' && e.status === 'scheduled';
}

export function canCancel(e: Pick<EventSummary, 'status' | 'myStatus'>): boolean {
  return e.myStatus === 'organizer' && e.status === 'scheduled';
}

/**
 * The one badge on a list card (translation key under `events.status`), most important first:
 * cancelled, finished, started, then my own status, then "full". null = nothing to show.
 */
export type CardBadge = 'cancelled' | 'finished' | 'started' | 'organizer' | 'going' | 'waitlist' | 'full';

export function cardBadge(e: Ev, now: Date = new Date()): CardBadge | null {
  const p = eventPhase(e, now);
  if (p === 'cancelled' || p === 'finished') return p;
  if (e.myStatus) return e.myStatus;
  if (p === 'started') return 'started';
  if (isEventFull(e)) return 'full';
  return null;
}

/** Badge tone: grey for "over", tint otherwise. */
export function badgeTone(b: CardBadge): 'tint' | 'gray' {
  return b === 'cancelled' || b === 'finished' || b === 'started' || b === 'full' ? 'gray' : 'tint';
}

/** My place in the waitlist queue (1 = next), or null when I'm not waiting. Participants come in queue order. */
export function waitlistPosition(items: Pick<EventParticipant, 'user' | 'status'>[], myId: Id | null | undefined): number | null {
  const queue = items.filter((p) => p.status === 'waitlist');
  const i = queue.findIndex((p) => sameId(p.user.id, myId));
  return i < 0 ? null : i + 1;
}

/** Split for the page: organizer + going first, waitlist after. */
export function splitParticipants<T extends Pick<EventParticipant, 'status'>>(items: T[]): { going: T[]; waitlist: T[] } {
  return { going: items.filter((p) => p.status === 'going'), waitlist: items.filter((p) => p.status === 'waitlist') };
}

/** Where the event is: spot name, else the meeting point label, else null (the screen says "Meeting point"). */
export function placeName(e: Pick<EventSummary, 'spot' | 'meetingPoint'>): string | null {
  if (e.spot?.name) return e.spot.name;
  const l = e.meetingPoint?.label?.trim();
  return l ? l : null;
}

/** Coordinates to show on the mini-map / open in maps. */
export function eventLocation(e: Pick<EventSummary, 'spot' | 'meetingPoint'>): { lat: number; lng: number } | null {
  const s = e.spot;
  if (s && typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng };
  if (e.meetingPoint) return { lat: e.meetingPoint.lat, lng: e.meetingPoint.lng };
  return null;
}

/** Difficulty to show: the event's minimum level, else the spot's level. */
export function eventLevel(e: Pick<EventSummary, 'minDifficulty' | 'spot'>): number | null {
  return e.minDifficulty ?? e.spot?.difficulty ?? null;
}

// ---------- dates (always Baku time) ----------
//
// Events happen in Azerbaijan, so times are entered and shown in Baku time (Asia/Baku, UTC+4, no
// daylight saving since 2016) whatever zone the phone or browser is in. The server gets plain ISO (UTC).

export const BAKU_TZ = 'Asia/Baku';
export const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

export interface BakuParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

/** Wall-clock parts of a moment in Baku. `month` is 0–11, `weekday` 0 = Sunday. */
export function bakuParts(d: Date): BakuParts {
  const b = new Date(d.getTime() + BAKU_OFFSET_MS);
  return {
    year: b.getUTCFullYear(), month: b.getUTCMonth(), day: b.getUTCDate(),
    hour: b.getUTCHours(), minute: b.getUTCMinutes(), weekday: b.getUTCDay(),
  };
}

/** The moment when Baku clocks show this date/time. `month` is 0–11. */
export function fromBakuParts(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - BAKU_OFFSET_MS);
}

/** "09:05" in Baku. */
export function bakuTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const p = bakuParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Is this device already on Baku time? Then no "Baku time" label is needed.
 * `zone`/`offsetMin` are for tests; by default the device's own values are used.
 */
export function deviceOnBakuTime(zone?: string | null, offsetMin?: number): boolean {
  let z = zone;
  if (z === undefined) {
    try { z = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { z = null; }
  }
  if (z) return z === BAKU_TZ;
  return (offsetMin ?? new Date().getTimezoneOffset()) === -240;
}

/** Date block on cards: "02" + "NOV" (month short name from the dictionary), Baku date. */
export function dateBlock(iso: string, monthsShort: string[]): { day: string; month: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '–', month: '' };
  const p = bakuParts(d);
  return { day: pad(p.day), month: monthsShort[p.month] ?? '' };
}

/** "Sat, 2 November · 09:00" or "… · 09:00 – 18:00" / "… – Sun, 3 November · 18:00" (Baku time). */
export function formatEventWhen(
  startIso: string,
  endIso: string | null | undefined,
  words: { weekdays: string[]; months: string[] },
): string {
  const s = new Date(startIso);
  if (Number.isNaN(s.getTime())) return '';
  const day = (p: BakuParts) => `${words.weekdays[p.weekday] ?? ''}, ${p.day} ${words.months[p.month] ?? ''}`;
  const time = (p: BakuParts) => `${pad(p.hour)}:${pad(p.minute)}`;
  const sp = bakuParts(s);
  let out = `${day(sp)} · ${time(sp)}`;
  if (endIso) {
    const e = new Date(endIso);
    if (!Number.isNaN(e.getTime())) {
      const ep = bakuParts(e);
      const same = ep.year === sp.year && ep.month === sp.month && ep.day === sp.day;
      out += same ? ` – ${time(ep)}` : ` – ${day(ep)} · ${time(ep)}`;
    }
  }
  return out;
}

/** Adds " (Baku time)" when the device is in another zone. */
export function withZoneLabel(text: string, label: string, onBaku: boolean = deviceOnBakuTime()): string {
  return onBaku || !text ? text : `${text} (${label})`;
}

/** Value for <input type="datetime-local"> showing Baku wall-clock time: "2026-11-02T09:00". */
export function toBakuInputValue(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = bakuParts(d);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parse a datetime-local value as Baku time. Empty / bad → null. */
export function fromBakuInputValue(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec((v ?? '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return fromBakuParts(y, mo - 1, d, h, mi);
}

/**
 * Android picks date and time in two dialogs (both shown in Baku time): keep the Baku date of the
 * first answer and the Baku hour/minute of the second.
 */
export function combineBakuDateTime(datePart: Date, timePart: Date): Date {
  const d = bakuParts(datePart);
  const t = bakuParts(timePart);
  return fromBakuParts(d.year, d.month, d.day, t.hour, t.minute);
}

/** Default start for a new event: next Saturday 09:00 Baku time, at least a day ahead. */
export function defaultStart(now: Date = new Date()): Date {
  const p = bakuParts(now);
  for (let i = 1; i <= 14; i++) {
    const c = fromBakuParts(p.year, p.month, p.day + i, 9, 0);
    if (bakuParts(c).weekday === 6 && c.getTime() - now.getTime() >= 24 * 60 * 60 * 1000) return c;
  }
  return fromBakuParts(p.year, p.month, p.day + 7, 9, 0);
}

// ---------- form ----------

export interface EventFormState {
  title: string;
  description: string;
  startsAt: Date | null;
  endsAt: Date | null;
  spotId: Id | null;
  meetingPoint: { lat: number; lng: number; label: string } | null;
  maxCars: string;
  minDifficulty: number | null;
  requirements: string[];
  visibility: 'public' | 'clan';
}

/** Translation keys under `events.form` for each invalid field. */
export type EventFormErrors = Partial<Record<'title' | 'description' | 'startsAt' | 'endsAt' | 'place' | 'maxCars' | 'label', string>>;

export function validateEventForm(f: EventFormState, now: Date = new Date(), opts: { minCars?: number } = {}): EventFormErrors {
  const e: EventFormErrors = {};
  const title = f.title.trim();
  if (title.length < EVENT_LIMITS.titleMin || title.length > EVENT_LIMITS.titleMax) e.title = 'titleInvalid';
  if (f.description.trim().length > EVENT_LIMITS.descriptionMax) e.description = 'descriptionTooLong';
  if (!f.startsAt) e.startsAt = 'startRequired';
  else if (f.startsAt.getTime() <= now.getTime()) e.startsAt = 'startPast';
  else if (f.startsAt.getTime() > now.getTime() + EVENT_LIMITS.yearMs) e.startsAt = 'startTooFar';
  if (f.endsAt && f.startsAt) {
    if (f.endsAt.getTime() <= f.startsAt.getTime()) e.endsAt = 'endBeforeStart';
    else if (f.endsAt.getTime() - f.startsAt.getTime() > EVENT_LIMITS.lengthMs) e.endsAt = 'endTooLong';
  }
  if (!f.spotId && !f.meetingPoint) e.place = 'placeRequired';
  if (f.meetingPoint && f.meetingPoint.label.trim().length > EVENT_LIMITS.labelMax) e.label = 'labelTooLong';
  const n = Number(f.maxCars);
  const min = Math.max(EVENT_LIMITS.maxCarsMin, opts.minCars ?? 0);
  if (!/^\d+$/.test(f.maxCars.trim()) || !Number.isInteger(n) || n < EVENT_LIMITS.maxCarsMin || n > EVENT_LIMITS.maxCarsMax) e.maxCars = 'maxCarsInvalid';
  else if (n < min) e.maxCars = 'maxCarsBelowGoing';
  return e;
}

/** Body for POST/PATCH (without carId/seats). */
export function eventPayload(f: EventFormState): EventInput {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    startsAt: f.startsAt!.toISOString(),
    endsAt: f.endsAt ? f.endsAt.toISOString() : null,
    spotId: f.spotId ?? null,
    meetingPoint: f.spotId
      ? null
      : f.meetingPoint
        ? { lat: round6(f.meetingPoint.lat), lng: round6(f.meetingPoint.lng), label: f.meetingPoint.label.trim() }
        : null,
    maxCars: Number(f.maxCars),
    minDifficulty: f.minDifficulty,
    requirements: f.requirements,
    visibility: f.visibility,
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Form state from an existing event (edit screen). */
export function formFromEvent(e: EventDetail): EventFormState {
  return {
    title: e.title,
    description: e.description ?? '',
    startsAt: new Date(e.startsAt),
    endsAt: e.endsAt ? new Date(e.endsAt) : null,
    spotId: e.spot?.id ?? null,
    meetingPoint: e.spot ? null : e.meetingPoint ? { ...e.meetingPoint } : null,
    maxCars: String(e.maxCars),
    minDifficulty: e.minDifficulty,
    requirements: [...e.requirements],
    visibility: e.visibility,
  };
}

/** Add a requirement chip: trimmed, ≤24 chars, no duplicates (case-insensitive), at most 8. */
export function addRequirement(list: string[], raw: string): string[] {
  const tag = raw.trim().replace(/\s+/g, ' ').slice(0, EVENT_LIMITS.requirementMax);
  if (!tag || list.length >= EVENT_LIMITS.requirementsMax) return list;
  if (list.some((x) => x.toLowerCase() === tag.toLowerCase())) return list;
  return [...list, tag];
}

export function toggleRequirement(list: string[], tag: string): string[] {
  return list.some((x) => x.toLowerCase() === tag.toLowerCase())
    ? list.filter((x) => x.toLowerCase() !== tag.toLowerCase())
    : addRequirement(list, tag);
}

/** Maps a server 409 sentence on create/edit/join to a translation key under `events.errors` (null = generic). */
export function eventConflictKey(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes('per day')) return 'dailyLimit';
  if (m.includes('upcoming events')) return 'upcomingLimit';
  if (m.includes('join a clan')) return 'needClan';
  if (m.includes("can't be lower") || m.includes('cars are already going')) return 'maxCarsBelowGoing';
  if (m.includes('already started')) return 'started';
  if (m.includes('after it started')) return 'started';
  if (m.includes('cancelled')) return 'cancelled';
  if (m.includes('finished') || m.includes('is over')) return 'over';
  if (m.includes('already joined')) return 'alreadyJoined';
  return null;
}
