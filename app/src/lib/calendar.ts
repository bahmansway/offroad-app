import { Platform } from 'react-native';
// The new object API of expo-calendar is not in Expo Go yet; the legacy functions are.
import * as Calendar from 'expo-calendar/legacy';
import { loadSetting, saveSetting } from './settingsStore';
import {
  ALARM_MINUTES_BEFORE, calendarDetails, calendarKey, calendarSignature, parseStoredEntry, type CalendarEventSource, type StoredCalendarEntry,
} from './calendarLogic';

export type CalendarResult =
  | { ok: true; action: 'added' | 'updated' | 'downloaded' | 'removed' }
  | { ok: false; reason: 'denied' | 'noCalendar' | 'failed' };

/** Phone: the event goes straight into the default calendar (iOS) or the primary writable one (Android). */
export const calendarMode = 'device' as const;

export async function storedCalendarEntry(userId: string | null, eventId: string): Promise<StoredCalendarEntry | null> {
  return parseStoredEntry(await loadSetting(calendarKey(userId, eventId)));
}

/** Cancelled event: delete it from the phone calendar (already deleted there is fine). */
export async function removeFromCalendar(userId: string | null, eventId: string): Promise<CalendarResult> {
  const stored = await storedCalendarEntry(userId, eventId);
  if (!stored) return { ok: true, action: 'removed' };
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    try {
      await Calendar.deleteEventAsync(stored.calendarEventId);
    } catch {
      /* removed by hand already */
    }
    await saveSetting(calendarKey(userId, eventId), '');
    return { ok: true, action: 'removed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

async function pickCalendarId(): Promise<string | null> {
  if (Platform.OS === 'ios') {
    try {
      const d = await Calendar.getDefaultCalendarAsync();
      if (d?.id && d.allowsModifications !== false) return d.id;
    } catch {
      /* fall through */
    }
  }
  const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = all.filter((c) => c.allowsModifications);
  const primary = writable.find((c) => c.isPrimary) ?? writable.find((c) => c.source?.isLocalAccount === false) ?? writable[0];
  return primary?.id ?? null;
}

export async function addToCalendar(userId: string | null, e: CalendarEventSource, o: { appUrl: string; meetingPointWord: string }): Promise<CalendarResult> {
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    const d = calendarDetails(e, o);
    const details = {
      title: d.title,
      startDate: d.start,
      endDate: d.end,
      location: d.location,
      notes: d.notes,
      url: d.url,
      timeZone: 'Asia/Baku',
      alarms: [{ relativeOffset: -ALARM_MINUTES_BEFORE }],
    };
    const id = String(e.id);
    const key = calendarKey(userId, id);
    const stored = await storedCalendarEntry(userId, id);
    if (stored) {
      try {
        await Calendar.updateEventAsync(stored.calendarEventId, details);
        await saveSetting(key, JSON.stringify({ calendarEventId: stored.calendarEventId, signature: calendarSignature(e) }));
        return { ok: true, action: 'updated' };
      } catch {
        /* deleted from the calendar meanwhile: add it again */
      }
    }
    const calendarId = await pickCalendarId();
    if (!calendarId) return { ok: false, reason: 'noCalendar' };
    const calendarEventId = await Calendar.createEventAsync(calendarId, details);
    await saveSetting(key, JSON.stringify({ calendarEventId, signature: calendarSignature(e) }));
    return { ok: true, action: stored ? 'updated' : 'added' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
