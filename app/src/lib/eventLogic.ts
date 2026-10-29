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
 * - closed: cancelled, finished or already started and I'm not in
 */
export type JoinState = 'login' | 'join' | 'joinWaitlist' | 'organizer' | 'going' | 'waitlist' | 'closed';

export function joinState(e: Ev, loggedIn: boolean, now: Date = new Date()): JoinState {
  if (e.myStatus === 'organizer') return 'organizer';
  if (e.myStatus === 'going') return 'going';
  if (e.myStatus === 'waitlist') return 'waitlist';
  if (eventPhase(e, now) !== 'upcoming') return 'closed';
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

// ---------- dates ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** Date block on cards: "02" + "NOV" (month short name from the dictionary). */
export function dateBlock(iso: string, monthsShort: string[]): { day: string; month: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '–', month: '' };
  return { day: pad(d.getDate()), month: monthsShort[d.getMonth()] ?? '' };
}

/** "Sat, 2 November · 09:00" or "Sat, 2 November · 09:00 – 18:00" / "… – Sun, 3 November · 18:00". */
export function formatEventWhen(
  startIso: string,
  endIso: string | null | undefined,
  words: { weekdays: string[]; months: string[] },
): string {
  const s = new Date(startIso);
  if (Number.isNaN(s.getTime())) return '';
  const day = (d: Date) => `${words.weekdays[d.getDay()] ?? ''}, ${d.getDate()} ${words.months[d.getMonth()] ?? ''}`;
  const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  let out = `${day(s)} · ${time(s)}`;
  if (endIso) {
    const e = new Date(endIso);
    if (!Number.isNaN(e.getTime())) {
      const same = e.getFullYear() === s.getFullYear() && e.getMonth() === s.getMonth() && e.getDate() === s.getDate();
      out += same ? ` – ${time(e)}` : ` – ${day(e)} · ${time(e)}`;
    }
  }
  return out;
}

/** Local value for <input type="datetime-local">: "2026-11-02T09:00". */
export function toLocalInputValue(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a datetime-local value as local time. Empty / bad → null. */
export function fromLocalInputValue(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec((v ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Default start for a new event: next Saturday 09:00 (at least a day ahead). */
export function defaultStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  do d.setDate(d.getDate() + 1);
  while (d.getDay() !== 6 || d.getTime() - now.getTime() < 24 * 60 * 60 * 1000);
  return d;
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
