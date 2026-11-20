import {
  buildIcs, calendarDetails, calendarSignature, calendarState, eventLink, icsDate, icsEscape, icsFileName, icsFold, parseStoredEntry,
  DEFAULT_LENGTH_MS, type CalendarEventSource,
} from '../calendarLogic';

const ID = '11111111-1111-4111-8111-111111111111';
const base: CalendarEventSource = {
  id: ID,
  title: 'Xızı səfəri; qar, dağ',
  description: 'Görüş: 08:30\nYanacaq doldurun, rasiya götürün.',
  startsAt: '2026-11-22T05:00:00.000Z',
  endsAt: null,
  spot: null,
  meetingPoint: { lat: 40.912345678, lng: 49.0712, label: 'Xızı yolu' },
};
const opts = { appUrl: 'https://app.example.com/', meetingPointWord: 'Görüş yeri' };

describe('calendar details', () => {
  it('end = endsAt, or start + 4 h', () => {
    const d = calendarDetails(base, opts);
    expect(d.start.toISOString()).toBe('2026-11-22T05:00:00.000Z');
    expect(d.end.getTime() - d.start.getTime()).toBe(DEFAULT_LENGTH_MS);
    const d2 = calendarDetails({ ...base, endsAt: '2026-11-22T15:00:00.000Z' }, opts);
    expect(d2.end.toISOString()).toBe('2026-11-22T15:00:00.000Z');
    // an end before the start is ignored
    expect(calendarDetails({ ...base, endsAt: '2026-11-22T04:00:00.000Z' }, opts).end.getTime() - d.start.getTime()).toBe(DEFAULT_LENGTH_MS);
  });
  it('location = place + coordinates; spot wins over the meeting point', () => {
    expect(calendarDetails(base, opts).location).toBe('Xızı yolu (40.91235, 49.07120)');
    const withSpot = { ...base, spot: { id: 's', name: 'Qobustan', type: 'trail' as const, difficulty: 2, lat: 40.1, lng: 49.4 } };
    expect(calendarDetails(withSpot, opts).location).toBe('Qobustan (40.10000, 49.40000)');
    expect(calendarDetails({ ...base, meetingPoint: { lat: 1, lng: 2, label: '' } }, opts).location).toBe('Görüş yeri (1.00000, 2.00000)');
  });
  it('notes = short description + app link', () => {
    const d = calendarDetails(base, opts);
    expect(d.url).toBe(`https://app.example.com/event/${ID}`);
    expect(d.notes).toBe(`${base.description}\n\nhttps://app.example.com/event/${ID}`);
    const long = calendarDetails({ ...base, description: 'x'.repeat(500) }, opts).notes;
    expect(long.startsWith('x'.repeat(299) + '…\n\n')).toBe(true);
    expect(calendarDetails({ ...base, description: '' }, opts).notes).toBe(d.url);
    expect(eventLink('https://a.b', 'x y')).toBe('https://a.b/event/x%20y');
  });
});

describe('calendar update detection', () => {
  it('add → added → update after a time or place change', () => {
    expect(calendarState(null, base)).toBe('add');
    const stored = { calendarEventId: 'cal-1', signature: calendarSignature(base) };
    expect(calendarState(stored, base)).toBe('added');
    expect(calendarState(stored, { ...base, title: 'New title' })).toBe('added');
    expect(calendarState(stored, { ...base, startsAt: '2026-11-22T06:00:00.000Z' })).toBe('update');
    expect(calendarState(stored, { ...base, endsAt: '2026-11-22T12:00:00.000Z' })).toBe('update');
    expect(calendarState(stored, { ...base, meetingPoint: { lat: 41, lng: 49, label: 'Quba' } })).toBe('update');
  });
  it('reads the stored entry safely', () => {
    expect(parseStoredEntry(null)).toBeNull();
    expect(parseStoredEntry('not json')).toBeNull();
    expect(parseStoredEntry('{"calendarEventId":5}')).toBeNull();
    expect(parseStoredEntry('{"calendarEventId":"a","signature":"b","x":1}')).toEqual({ calendarEventId: 'a', signature: 'b' });
  });
});

describe('.ics file', () => {
  it('escapes text and formats UTC times', () => {
    expect(icsEscape('a;b,c\\d\ne\r\nf')).toBe('a\\;b\\,c\\\\d\\ne\\nf');
    expect(icsDate(new Date('2026-11-22T05:00:00.000Z'))).toBe('20261122T050000Z');
  });

  it('has the event data with correct UTC times and a 1-day alarm', () => {
    const ics = buildIcs(calendarDetails(base, opts), { uid: `event-${ID}@yolchu`, now: new Date('2026-11-20T10:11:12.000Z') });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    const lines = unfolded.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain(`UID:event-${ID}@yolchu`);
    expect(lines).toContain('DTSTAMP:20261120T101112Z');
    expect(lines).toContain('DTSTART:20261122T050000Z'); // 09:00 in Baku
    expect(lines).toContain('DTEND:20261122T090000Z');
    expect(lines).toContain('SUMMARY:Xızı səfəri\\; qar\\, dağ');
    expect(lines).toContain('LOCATION:Xızı yolu (40.91235\\, 49.07120)');
    expect(lines).toContain(`DESCRIPTION:Görüş: 08:30\\nYanacaq doldurun\\, rasiya götürün.\\n\\nhttps://app.example.com/event/${ID}`);
    expect(lines).toContain('TRIGGER:-P1D');
    expect(lines).toContain('END:VEVENT');
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
  });

  it('folds long lines at 75 bytes without splitting letters', () => {
    const line = 'DESCRIPTION:' + 'ə'.repeat(100);
    const folded = icsFold(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(icsFold('SHORT:x')).toBe('SHORT:x');
  });

  it('safe file names', () => {
    expect(icsFileName('Xızı səfəri — Şamaxı!')).toBe('xizi-seferi-samaxi.ics');
    expect(icsFileName('🚙🚙')).toBe('event.ics');
  });
});
