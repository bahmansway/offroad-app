import { buildIcs, calendarDetails, icsFileName, type CalendarEventSource, type StoredCalendarEntry } from './calendarLogic';

export type CalendarResult =
  | { ok: true; action: 'added' | 'updated' | 'downloaded' }
  | { ok: false; reason: 'denied' | 'noCalendar' | 'failed' };

/** Website: an .ics file is downloaded; the user opens it in their calendar app. */
export const calendarMode = 'file' as const;

export async function storedCalendarEntry(_eventId: string): Promise<StoredCalendarEntry | null> {
  return null;
}

export async function addToCalendar(e: CalendarEventSource, o: { appUrl: string; meetingPointWord: string }): Promise<CalendarResult> {
  try {
    const ics = buildIcs(calendarDetails(e, o), { uid: `event-${e.id}@yolchu` });
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = icsFileName(e.title);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, action: 'downloaded' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
