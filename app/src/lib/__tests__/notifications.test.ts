import {
  collectPages, createTapDeduper, foregroundAction, isExpoGo, isReminderId, planReminderSync, plannedReminders, reminderEventId, reminderId,
  routeForNotification, shouldShowPrePrompt, wantsReminders, type ReminderWords, type ScheduledReminder,
} from '../notificationLogic';
import { translate } from '../i18n';
import type { EventSummary } from '../types';

const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-20T08:00:00.000Z'); // 12:00 in Baku
const EV1 = '11111111-1111-4111-8111-111111111111';
const EV2 = '22222222-2222-4222-8222-222222222222';

const words: ReminderWords = {
  dayBefore: (time, place) => (place ? translate('az', 'notifications.reminderDayBefore', { time, place }) : translate('az', 'notifications.reminderDayBeforeNoPlace', { time })),
  soon: (place) => (place ? translate('az', 'notifications.reminderSoon', { place }) : translate('az', 'notifications.reminderSoonNoPlace')),
};

function ev(p: Partial<EventSummary> = {}): EventSummary {
  return {
    id: EV1, title: 'Xızı səfəri', startsAt: '2026-11-22T05:00:00.000Z', endsAt: null,
    spot: null, meetingPoint: { lat: 40.9, lng: 49.07, label: 'Xızı' }, maxCars: 10, minDifficulty: null, requirements: [],
    visibility: 'public', clan: null, organizer: { id: 'o', displayName: 'Org', avatarUrl: null }, status: 'scheduled',
    participantCount: 1, carCount: 1, waitlistCount: 0, isFull: false, myStatus: 'going', coverUrl: null,
    ...p,
  } as EventSummary;
}
const asScheduled = (ps: ReturnType<typeof plannedReminders>): ScheduledReminder[] =>
  ps.map((p) => ({ id: p.id, fireAt: p.fireAt, title: p.title, body: p.body }));

describe('Expo Go detection and the permission pre-prompt', () => {
  it('detects Expo Go by execution environment or app ownership', () => {
    expect(isExpoGo({ executionEnvironment: 'storeClient' })).toBe(true);
    expect(isExpoGo({ executionEnvironment: 'bare', appOwnership: 'expo' })).toBe(true);
    expect(isExpoGo({ executionEnvironment: 'standalone', appOwnership: null })).toBe(false);
    expect(isExpoGo({ executionEnvironment: 'bare' })).toBe(false);
  });
  it('asks only once, only while undecided, never on the web', () => {
    expect(shouldShowPrePrompt({ platform: 'ios', status: 'undetermined', askedBefore: false })).toBe(true);
    expect(shouldShowPrePrompt({ platform: 'ios', status: 'undetermined', askedBefore: true })).toBe(false);
    expect(shouldShowPrePrompt({ platform: 'android', status: 'granted', askedBefore: false })).toBe(false);
    expect(shouldShowPrePrompt({ platform: 'android', status: 'denied', askedBefore: false })).toBe(false);
    expect(shouldShowPrePrompt({ platform: 'web', status: 'undetermined', askedBefore: false })).toBe(false);
  });
});

describe('tapping a notification', () => {
  it('opens the right screen', () => {
    expect(routeForNotification({ type: 'message', conversationId: EV1 })).toBe(`/chat/${EV1}`);
    expect(routeForNotification({ type: 'friend_request', userId: EV2 })).toBe('/friends?tab=in');
    expect(routeForNotification({ type: 'friend_accepted', userId: EV2 })).toBe('/friends');
    expect(routeForNotification({ type: 'clan_invite', clanId: EV1, inviteId: EV2 })).toBe('/clans');
    expect(routeForNotification({ type: 'clan_request', clanId: EV1 })).toBe(`/clan/${EV1}`);
    expect(routeForNotification({ type: 'event', eventId: EV2 })).toBe(`/event/${EV2}`);
    expect(routeForNotification({ type: 'event', eventId: EV2, reminder: '2h' })).toBe(`/event/${EV2}`);
  });
  it('ignores unknown or broken data', () => {
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification({ type: 'message', conversationId: '../../login' })).toBeNull();
    expect(routeForNotification({ type: 'event', eventId: 42 })).toBeNull();
    expect(routeForNotification({ type: 'weird' })).toBeNull();
  });
  it('foreground: no banner for the chat that is open, banner otherwise', () => {
    expect(foregroundAction({ type: 'message', conversationId: EV1 }, EV1)).toBe('skip');
    expect(foregroundAction({ type: 'message', conversationId: EV1 }, EV2)).toBe('banner');
    expect(foregroundAction({ type: 'message', conversationId: EV1 }, null)).toBe('banner');
    expect(foregroundAction({ type: 'event', eventId: EV1 }, EV1)).toBe('banner');
  });
});

describe('event reminders: what should be scheduled', () => {
  it('organizer and going get 24 h + 2 h reminders, Baku time texts', () => {
    const p = plannedReminders([ev()], { now: NOW, enabled: true, words });
    expect(p.map((x) => x.id)).toEqual([reminderId(EV1, '24h'), reminderId(EV1, '2h')]);
    const start = Date.parse('2026-11-22T05:00:00.000Z');
    expect(p[0].fireAt).toBe(start - 24 * H);
    expect(p[1].fireAt).toBe(start - 2 * H);
    expect(p[0]).toMatchObject({ title: 'Xızı səfəri', body: 'Sabah 09:00 · Xızı' });
    expect(p[1].body).toBe('2 saata başlayır · Xızı');
    expect(p[0].data).toEqual({ type: 'event', eventId: EV1, reminder: '24h' });
    expect(plannedReminders([ev({ myStatus: 'organizer', spot: { id: EV2, name: 'Qobustan', type: 'trail', difficulty: 2, lat: 40, lng: 49 } })], { now: NOW, enabled: true, words })[1].body)
      .toBe('2 saata başlayır · Qobustan');
  });
  it('English texts and no place', () => {
    const en: ReminderWords = {
      dayBefore: (time, place) => translate('en', place ? 'notifications.reminderDayBefore' : 'notifications.reminderDayBeforeNoPlace', { time, place: place ?? '' }),
      soon: (place) => translate('en', place ? 'notifications.reminderSoon' : 'notifications.reminderSoonNoPlace', { place: place ?? '' }),
    };
    const p = plannedReminders([ev({ meetingPoint: { lat: 40, lng: 49, label: '' } })], { now: NOW, enabled: true, words: en });
    expect(p.map((x) => x.body)).toEqual(['Tomorrow 09:00', 'Starts in 2 hours']);
  });
  it('no reminders on the waitlist, when not joined, cancelled, finished, or switched off', () => {
    for (const e of [ev({ myStatus: 'waitlist' }), ev({ myStatus: null }), ev({ status: 'cancelled' }), ev({ status: 'finished' })]) {
      expect(wantsReminders(e)).toBe(false);
      expect(plannedReminders([e], { now: NOW, enabled: true, words })).toEqual([]);
    }
    expect(plannedReminders([ev()], { now: NOW, enabled: false, words })).toEqual([]);
  });
  it('skips reminder times already passed', () => {
    // starts in 10 hours: the 24 h reminder is in the past, the 2 h one is not
    const p = plannedReminders([ev({ startsAt: new Date(NOW + 10 * H).toISOString() })], { now: NOW, enabled: true, words });
    expect(p.map((x) => x.id)).toEqual([reminderId(EV1, '2h')]);
    expect(plannedReminders([ev({ startsAt: new Date(NOW + H).toISOString() })], { now: NOW, enabled: true, words })).toEqual([]);
    expect(plannedReminders([ev({ startsAt: 'nonsense' })], { now: NOW, enabled: true, words })).toEqual([]);
  });
  it('reminder ids carry the event id', () => {
    expect(isReminderId(reminderId(EV1, '2h'))).toBe(true);
    expect(isReminderId('something-else')).toBe(false);
    expect(reminderEventId(reminderId(EV2, '24h'))).toBe(EV2);
  });
});

describe('event reminders: sync', () => {
  const both = [ev(), ev({ id: EV2, title: 'Qobustan', startsAt: '2026-11-25T06:00:00.000Z' })];

  it('joining schedules 2 reminders; nothing to do when already in sync', () => {
    const planned = plannedReminders([ev()], { now: NOW, enabled: true, words });
    const s1 = planReminderSync(planned, []);
    expect(s1.cancel).toEqual([]);
    expect(s1.schedule).toHaveLength(2);
    expect(planReminderSync(planned, asScheduled(planned))).toEqual({ cancel: [], schedule: [] });
  });

  it('leaving (or being removed, or the event cancelled) cancels them', () => {
    const before = asScheduled(plannedReminders(both, { now: NOW, enabled: true, words }));
    const after = plannedReminders([ev({ id: EV2, title: 'Qobustan', startsAt: '2026-11-25T06:00:00.000Z' })], { now: NOW, enabled: true, words });
    const s = planReminderSync(after, before);
    expect(s.cancel.sort()).toEqual([reminderId(EV1, '24h'), reminderId(EV1, '2h')].sort());
    expect(s.schedule).toEqual([]);
    const cancelled = planReminderSync(plannedReminders([ev({ status: 'cancelled' })], { now: NOW, enabled: true, words }), before, EV1);
    expect(cancelled.cancel).toHaveLength(2);
  });

  it('a time change reschedules (cancel + schedule the same ids)', () => {
    const before = asScheduled(plannedReminders([ev()], { now: NOW, enabled: true, words }));
    const moved = plannedReminders([ev({ startsAt: '2026-11-23T05:30:00.000Z' })], { now: NOW, enabled: true, words });
    const s = planReminderSync(moved, before);
    expect(s.cancel.sort()).toEqual(before.map((b) => b.id).sort());
    expect(s.schedule.map((x) => x.fireAt)).toEqual([Date.parse('2026-11-22T05:30:00.000Z'), Date.parse('2026-11-23T03:30:00.000Z')]);
    expect(s.schedule[0].body).toBe('Sabah 09:30 · Xızı');
  });

  it('a text change (place / language) also reschedules', () => {
    const before = asScheduled(plannedReminders([ev()], { now: NOW, enabled: true, words }));
    const s = planReminderSync(plannedReminders([ev({ meetingPoint: { lat: 1, lng: 2, label: 'Quba' } })], { now: NOW, enabled: true, words }), before);
    expect(s.cancel).toHaveLength(2);
    expect(s.schedule.map((x) => x.body)).toEqual(['Sabah 09:00 · Quba', '2 saata başlayır · Quba']);
  });

  it('turning reminders off cancels all of ours and leaves other notifications alone', () => {
    const before: ScheduledReminder[] = [...asScheduled(plannedReminders(both, { now: NOW, enabled: true, words })), { id: 'someone-else', fireAt: NOW + H }];
    const s = planReminderSync([], before);
    expect(s.cancel).toHaveLength(4);
    expect(s.cancel).not.toContain('someone-else');
  });

  it('one-event sync only touches that event', () => {
    const before = asScheduled(plannedReminders(both, { now: NOW, enabled: true, words }));
    const s = planReminderSync([], before, EV1);
    expect(s.cancel.sort()).toEqual([reminderId(EV1, '24h'), reminderId(EV1, '2h')].sort());
    const s2 = planReminderSync(plannedReminders([ev({ myStatus: 'going' })], { now: NOW, enabled: true, words }), [], EV2);
    expect(s2).toEqual({ cancel: [], schedule: [] });
  });

  it('an unreadable scheduled time is replaced', () => {
    const planned = plannedReminders([ev()], { now: NOW, enabled: true, words });
    const s = planReminderSync(planned, [{ ...asScheduled(planned)[0], fireAt: null }, asScheduled(planned)[1]]);
    expect(s.cancel).toEqual([planned[0].id]);
    expect(s.schedule.map((x) => x.id)).toEqual([planned[0].id]);
  });

  it('waitlisted then promoted: reminders appear only after promotion', () => {
    const wait = plannedReminders([ev({ myStatus: 'waitlist' })], { now: NOW, enabled: true, words });
    expect(planReminderSync(wait, [])).toEqual({ cancel: [], schedule: [] });
    const promoted = plannedReminders([ev({ myStatus: 'going' })], { now: NOW, enabled: true, words });
    expect(planReminderSync(promoted, []).schedule).toHaveLength(2);
  });
});

describe('notification strings exist in both languages', () => {
  it.each(['az', 'en'] as const)('%s', (lang) => {
    for (const k of ['title', 'expoGoNote', 'reminders', 'introTitle', 'introAllow', 'introLater', 'channelMessages', 'channelEvents']) {
      expect(translate(lang, `notifications.${k}`)).not.toBe(`notifications.${k}`);
    }
    expect(translate('az', 'notifications.title')).toBe('Bildirişlər');
    expect(translate('az', 'calendar.add')).toBe('Təqvimə əlavə et');
    expect(translate('az', 'calendar.update')).toBe('Təqvimi yenilə');
    expect(translate('az', 'notifications.reminders')).toBe('Tədbir xatırlatmaları');
  });
});

describe('taps and paging (review fixes)', () => {
  it('the launch tap is opened once even if the listener also gets it', () => {
    const first = createTapDeduper(3);
    expect(first('n1|1')).toBe(true);
    expect(first('n1|1')).toBe(false);
    expect(first('n2|2')).toBe(true);
    expect(first(null)).toBe(true);
    for (const id of ['a', 'b', 'c']) first(id);
    expect(first('n1|1')).toBe(true); // forgotten after `max` newer ones
  });
  it('collects every page of my events (no 200 cap) and never loops', async () => {
    const pages: Record<string, { items: number[]; nextCursor: string | null }> = {};
    for (let i = 0; i < 10; i++) pages[i === 0 ? 'start' : `c${i}`] = { items: Array.from({ length: 50 }, (_, k) => i * 50 + k), nextCursor: i < 9 ? `c${i + 1}` : null };
    const seen: (string | null)[] = [];
    const all = await collectPages(async (c) => { seen.push(c); return pages[c ?? 'start']; });
    expect(all).toHaveLength(500);
    expect(seen[0]).toBeNull();
    const loop = await collectPages(async () => ({ items: [1], nextCursor: 'same' }));
    expect(loop).toEqual([1, 1]);
  });
});
