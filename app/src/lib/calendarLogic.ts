import type { EventDetail } from './types';
import { eventLocation, placeName } from './eventLogic';

/**
 * "Add to calendar" data, shared by the phone (expo-calendar) and the web (.ics download).
 * Pure functions so the .ics text can be unit-tested.
 */

/** No end time: the calendar entry lasts 4 hours. */
export const DEFAULT_LENGTH_MS = 4 * 60 * 60 * 1000;
/** Calendar alarm 1 day before (minutes, negative = before). */
export const ALARM_MINUTES_BEFORE = 24 * 60;
const NOTES_DESCRIPTION_MAX = 300;

export type CalendarEventSource = Pick<EventDetail, 'id' | 'title' | 'description' | 'startsAt' | 'endsAt' | 'spot' | 'meetingPoint'>;

export interface CalendarDetails {
  title: string;
  start: Date;
  end: Date;
  /** place name + coordinates */
  location: string;
  /** short description + link to the event in the app */
  notes: string;
  url: string;
}

/** Link to the event page (the web build is served from the API address). */
export function eventLink(appUrl: string, id: string): string {
  return `${appUrl.replace(/\/+$/, '')}/event/${encodeURIComponent(id)}`;
}

export function calendarDetails(e: CalendarEventSource, o: { appUrl: string; meetingPointWord: string }): CalendarDetails {
  const start = new Date(e.startsAt);
  const endParsed = e.endsAt ? new Date(e.endsAt) : null;
  const end = endParsed && !Number.isNaN(endParsed.getTime()) && endParsed > start ? endParsed : new Date(start.getTime() + DEFAULT_LENGTH_MS);
  const loc = eventLocation(e);
  const name = placeName(e) ?? o.meetingPointWord;
  const location = loc ? `${name} (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})` : name;
  const url = eventLink(o.appUrl, String(e.id));
  const desc = Array.from((e.description ?? '').trim());
  const short = desc.length > NOTES_DESCRIPTION_MAX ? desc.slice(0, NOTES_DESCRIPTION_MAX - 1).join('') + '…' : desc.join('');
  return { title: e.title, start, end, location, notes: short ? `${short}\n\n${url}` : url, url };
}

/** What we compare to know the phone calendar entry is out of date (time or place changed). */
export function calendarSignature(e: CalendarEventSource): string {
  const loc = eventLocation(e);
  return [e.startsAt, e.endsAt ?? '', placeName(e) ?? '', loc ? `${loc.lat},${loc.lng}` : ''].join('|');
}

export interface StoredCalendarEntry {
  /** id of the event in the phone calendar */
  calendarEventId: string;
  signature: string;
}

/** 'add' (not in my calendar yet), 'update' (added, but the time / place changed since), 'added'. */
export function calendarState(stored: StoredCalendarEntry | null, e: CalendarEventSource): 'add' | 'update' | 'added' {
  if (!stored) return 'add';
  return stored.signature === calendarSignature(e) ? 'added' : 'update';
}

export function parseStoredEntry(raw: string | null): StoredCalendarEntry | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredCalendarEntry>;
    return typeof v.calendarEventId === 'string' && typeof v.signature === 'string' ? { calendarEventId: v.calendarEventId, signature: v.signature } : null;
  } catch {
    return null;
  }
}

// ---------- .ics (RFC 5545) ----------

/** Escape a TEXT value: backslash, semicolon, comma, new lines. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** 20261122T050000Z (UTC). */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Fold lines longer than 75 bytes (UTF-8), never splitting a character. */
export function icsFold(line: string): string {
  const enc = (s: string) => new TextEncoder().encode(s).length;
  if (enc(line) <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let limit = 75;
  for (const ch of Array.from(line)) {
    if (enc(cur + ch) > limit) {
      parts.push(cur);
      cur = ch;
      limit = 74; // continuation lines start with a space
    } else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(d: CalendarDetails, o: { uid: string; now?: Date }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YOLCHU//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(o.uid)}`,
    `DTSTAMP:${icsDate(o.now ?? new Date())}`,
    `DTSTART:${icsDate(d.start)}`,
    `DTEND:${icsDate(d.end)}`,
    `SUMMARY:${icsEscape(d.title)}`,
    `LOCATION:${icsEscape(d.location)}`,
    `DESCRIPTION:${icsEscape(d.notes)}`,
    `URL:${d.url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(d.title)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** "xizi-trip.ics" (ASCII only, safe on every system). */
export function icsFileName(title: string): string {
  const map: Record<string, string> = { ə: 'e', Ə: 'e', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u', ğ: 'g', Ğ: 'g', ş: 's', Ş: 's', ç: 'c', Ç: 'c' };
  const slug = Array.from(title)
    .map((ch) => map[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'event'}.ics`;
}
