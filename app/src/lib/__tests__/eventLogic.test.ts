import {
  addRequirement, canCancel, canLeave, canRemoveParticipants, cardBadge, dateBlock, defaultStart, eventConflictKey,
  eventLevel, eventLocation, eventPayload, eventPhase, formatEventWhen, fromLocalInputValue, joinState, placeName,
  placesLeft, splitParticipants, toLocalInputValue, toggleRequirement, validateEventForm, waitlistPosition,
  type EventFormState,
} from '../eventLogic';
import type { EventParticipant, EventSummary } from '../types';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const FUTURE = '2026-11-07T09:00:00.000Z';
const PAST = '2026-10-28T09:00:00.000Z';

function ev(p: Partial<EventSummary> = {}): EventSummary {
  return {
    id: 'e1', title: 'Trip', startsAt: FUTURE, endsAt: null, spot: null,
    meetingPoint: { lat: 40.4, lng: 49.8, label: 'Shell' }, maxCars: 3, minDifficulty: null, requirements: [],
    visibility: 'public', clan: null, organizer: { id: 'org', displayName: 'Org', avatarUrl: null }, status: 'scheduled',
    participantCount: 1, carCount: 1, waitlistCount: 0, isFull: false, myStatus: null, coverUrl: null, ...p,
  };
}

function person(id: string, status: 'going' | 'waitlist', isOrganizer = false): EventParticipant {
  return { user: { id, displayName: id, avatarUrl: null }, status, isOrganizer, seats: 0, car: null, joinedAt: PAST };
}

describe('eventPhase', () => {
  it('uses the server status, and "started" for a scheduled event whose start passed', () => {
    expect(eventPhase(ev(), NOW)).toBe('upcoming');
    expect(eventPhase(ev({ startsAt: PAST }), NOW)).toBe('started');
    expect(eventPhase(ev({ status: 'cancelled' }), NOW)).toBe('cancelled');
    expect(eventPhase(ev({ status: 'finished', startsAt: PAST }), NOW)).toBe('finished');
  });
});

describe('joinState (event page button)', () => {
  it('asks to log in when logged out', () => {
    expect(joinState(ev(), false, NOW)).toBe('login');
  });
  it('join while there are places, waitlist when full', () => {
    expect(joinState(ev({ carCount: 2 }), true, NOW)).toBe('join');
    expect(joinState(ev({ carCount: 3, isFull: true }), true, NOW)).toBe('joinWaitlist');
    // even if the server flag lags, carCount >= maxCars means full
    expect(joinState(ev({ carCount: 3, isFull: false }), true, NOW)).toBe('joinWaitlist');
  });
  it('shows my own status first', () => {
    expect(joinState(ev({ myStatus: 'organizer' }), true, NOW)).toBe('organizer');
    expect(joinState(ev({ myStatus: 'going' }), true, NOW)).toBe('going');
    expect(joinState(ev({ myStatus: 'waitlist', isFull: true, carCount: 3 }), true, NOW)).toBe('waitlist');
    expect(joinState(ev({ myStatus: 'going', startsAt: PAST }), true, NOW)).toBe('going');
  });
  it('is closed for outsiders once cancelled, finished or started', () => {
    expect(joinState(ev({ status: 'cancelled' }), true, NOW)).toBe('closed');
    expect(joinState(ev({ status: 'finished' }), false, NOW)).toBe('closed');
    expect(joinState(ev({ startsAt: PAST }), true, NOW)).toBe('closed');
    expect(joinState(ev({ status: 'cancelled', myStatus: 'organizer' }), true, NOW)).toBe('closed');
    expect(joinState(ev({ status: 'finished', myStatus: 'going' }), true, NOW)).toBe('closed');
  });
});

describe('leave / organizer rules', () => {
  it('going and waitlisted people can leave; the organizer cannot; nobody after cancel', () => {
    expect(canLeave(ev({ myStatus: 'going' }), NOW)).toBe(true);
    expect(canLeave(ev({ myStatus: 'waitlist' }), NOW)).toBe(true);
    expect(canLeave(ev({ myStatus: 'organizer' }), NOW)).toBe(false);
    expect(canLeave(ev({ myStatus: null }), NOW)).toBe(false);
    expect(canLeave(ev({ myStatus: 'going', status: 'cancelled' }), NOW)).toBe(false);
    expect(canLeave(ev({ myStatus: 'going', status: 'finished' }), NOW)).toBe(false);
  });
  it('only the organizer of a scheduled event cancels or removes people', () => {
    expect(canCancel(ev({ myStatus: 'organizer' }))).toBe(true);
    expect(canCancel(ev({ myStatus: 'going' }))).toBe(false);
    expect(canCancel(ev({ myStatus: 'organizer', status: 'cancelled' }))).toBe(false);
    expect(canRemoveParticipants(ev({ myStatus: 'organizer' }))).toBe(true);
    expect(canRemoveParticipants(ev({ myStatus: 'organizer', status: 'finished' }))).toBe(false);
  });
});

describe('cardBadge (list card status)', () => {
  it('orders: over > mine > started > full > none', () => {
    expect(cardBadge(ev({ status: 'cancelled', myStatus: 'going' }), NOW)).toBe('cancelled');
    expect(cardBadge(ev({ status: 'finished' }), NOW)).toBe('finished');
    expect(cardBadge(ev({ myStatus: 'waitlist', isFull: true, carCount: 3 }), NOW)).toBe('waitlist');
    expect(cardBadge(ev({ startsAt: PAST }), NOW)).toBe('started');
    expect(cardBadge(ev({ carCount: 3, isFull: true }), NOW)).toBe('full');
    expect(cardBadge(ev(), NOW)).toBeNull();
  });
});

describe('waitlist display', () => {
  const items = [person('org', 'going', true), person('a', 'going'), person('w1', 'waitlist'), person('w2', 'waitlist')];
  it('gives my 1-based place in the queue', () => {
    expect(waitlistPosition(items, 'w1')).toBe(1);
    expect(waitlistPosition(items, 'w2')).toBe(2);
    expect(waitlistPosition(items, 'a')).toBeNull();
    expect(waitlistPosition(items, null)).toBeNull();
  });
  it('after the first waiting person is promoted, the next one is #1', () => {
    const after = [person('org', 'going', true), person('w1', 'going'), person('w2', 'waitlist')];
    expect(waitlistPosition(after, 'w2')).toBe(1);
    expect(splitParticipants(after).going.map((p) => p.user.id)).toEqual(['org', 'w1']);
  });
  it('places left never goes below zero', () => {
    expect(placesLeft(ev({ carCount: 1, maxCars: 3 }))).toBe(2);
    expect(placesLeft(ev({ carCount: 5, maxCars: 3 }))).toBe(0);
  });
});

describe('place, level, location', () => {
  const spot = { id: 's1', name: 'Xınalıq', type: 'trail' as const, difficulty: 3, lat: 41.1, lng: 48.1 };
  it('spot wins over meeting point', () => {
    expect(placeName(ev({ spot }))).toBe('Xınalıq');
    expect(eventLocation(ev({ spot }))).toEqual({ lat: 41.1, lng: 48.1 });
    expect(placeName(ev())).toBe('Shell');
    expect(placeName(ev({ meetingPoint: { lat: 1, lng: 2, label: '  ' } }))).toBeNull();
    expect(eventLocation(ev({ meetingPoint: null }))).toBeNull();
  });
  it('level is the event minimum, else the spot level', () => {
    expect(eventLevel(ev({ minDifficulty: 2, spot }))).toBe(2);
    expect(eventLevel(ev({ spot }))).toBe(3);
    expect(eventLevel(ev())).toBeNull();
  });
});

describe('dates', () => {
  const words = { weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
  it('formats the date block and when line in local time', () => {
    const start = new Date(2026, 10, 7, 9, 0);
    expect(dateBlock(start.toISOString(), ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'])).toEqual({ day: '07', month: 'NOV' });
    expect(formatEventWhen(start.toISOString(), null, words)).toBe('Sat, 7 November · 09:00');
    expect(formatEventWhen(start.toISOString(), new Date(2026, 10, 7, 18, 30).toISOString(), words)).toBe('Sat, 7 November · 09:00 – 18:30');
    expect(formatEventWhen(start.toISOString(), new Date(2026, 10, 8, 12, 0).toISOString(), words)).toBe('Sat, 7 November · 09:00 – Sun, 8 November · 12:00');
  });
  it('round-trips the web datetime-local value', () => {
    const d = new Date(2026, 10, 7, 9, 5);
    expect(toLocalInputValue(d)).toBe('2026-11-07T09:05');
    expect(fromLocalInputValue('2026-11-07T09:05')?.getTime()).toBe(d.getTime());
    expect(fromLocalInputValue('')).toBeNull();
    expect(fromLocalInputValue('nope')).toBeNull();
  });
  it('default start is a Saturday 09:00 at least a day ahead', () => {
    const d = defaultStart(new Date(2026, 9, 30, 20, 0)); // Friday evening
    expect(d.getDay()).toBe(6);
    expect(d.getHours()).toBe(9);
    expect(d.getTime() - new Date(2026, 9, 30, 20, 0).getTime()).toBeGreaterThanOrEqual(24 * 3600 * 1000);
  });
});

describe('event form', () => {
  const base: EventFormState = {
    title: 'Saturday ride', description: '', startsAt: new Date(NOW.getTime() + 86400000), endsAt: null,
    spotId: null, meetingPoint: { lat: 40.4, lng: 49.8, label: 'Shell' }, maxCars: '10', minDifficulty: null,
    requirements: [], visibility: 'public',
  };
  it('accepts a valid form', () => {
    expect(validateEventForm(base, NOW)).toEqual({});
  });
  it('flags each rule', () => {
    expect(validateEventForm({ ...base, title: 'ab' }, NOW).title).toBe('titleInvalid');
    expect(validateEventForm({ ...base, startsAt: new Date(NOW.getTime() - 1000) }, NOW).startsAt).toBe('startPast');
    expect(validateEventForm({ ...base, startsAt: null }, NOW).startsAt).toBe('startRequired');
    expect(validateEventForm({ ...base, startsAt: new Date(NOW.getTime() + 400 * 86400000) }, NOW).startsAt).toBe('startTooFar');
    expect(validateEventForm({ ...base, endsAt: base.startsAt }, NOW).endsAt).toBe('endBeforeStart');
    expect(validateEventForm({ ...base, endsAt: new Date(base.startsAt!.getTime() + 8 * 86400000) }, NOW).endsAt).toBe('endTooLong');
    expect(validateEventForm({ ...base, meetingPoint: null }, NOW).place).toBe('placeRequired');
    expect(validateEventForm({ ...base, maxCars: '1' }, NOW).maxCars).toBe('maxCarsInvalid');
    expect(validateEventForm({ ...base, maxCars: '101' }, NOW).maxCars).toBe('maxCarsInvalid');
    expect(validateEventForm({ ...base, maxCars: '' }, NOW).maxCars).toBe('maxCarsInvalid');
    expect(validateEventForm({ ...base, maxCars: '4' }, NOW, { minCars: 5 }).maxCars).toBe('maxCarsBelowGoing');
  });
  it('payload sends ISO times and drops the meeting point when a spot is chosen', () => {
    const p = eventPayload({ ...base, spotId: 's1', title: '  Ride  ' });
    expect(p.title).toBe('Ride');
    expect(p.spotId).toBe('s1');
    expect(p.meetingPoint).toBeNull();
    expect(p.startsAt).toBe(base.startsAt!.toISOString());
    expect(p.maxCars).toBe(10);
    expect(eventPayload(base).meetingPoint).toEqual({ lat: 40.4, lng: 49.8, label: 'Shell' });
  });
  it('requirement chips: trimmed, unique, at most 8, toggle', () => {
    let r = addRequirement([], '  Winch ');
    r = addRequirement(r, 'winch');
    expect(r).toEqual(['Winch']);
    expect(toggleRequirement(r, 'WINCH')).toEqual([]);
    const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(addRequirement(full, 'i')).toBe(full);
    expect(addRequirement([], 'x'.repeat(30))[0]).toHaveLength(24);
  });
  it('maps server conflict sentences', () => {
    expect(eventConflictKey('You can create at most 10 events per day')).toBe('dailyLimit');
    expect(eventConflictKey('You can organize at most 20 upcoming events')).toBe('upcomingLimit');
    expect(eventConflictKey('Join a clan to create a clan-only event')).toBe('needClan');
    expect(eventConflictKey("3 cars are already going; max cars can't be lower")).toBe('maxCarsBelowGoing');
    expect(eventConflictKey('This event has already started')).toBe('started');
    expect(eventConflictKey('You already joined this event')).toBe('alreadyJoined');
    expect(eventConflictKey('something else')).toBeNull();
  });
});
