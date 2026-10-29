import { translate } from '../i18n';
import { isSystem, messageText, systemText } from '../systemMessages';
import en from '../../locales/en';
import az from '../../locales/az';
import type { Message } from '../types';

const tEn = (k: string, p?: Record<string, string | number>) => translate('en', k, p);
const tAz = (k: string, p?: Record<string, string | number>) => translate('az', k, p);

function sys(systemKey: string, systemParams: Record<string, unknown> | null, text = 'fallback'): Message {
  return { id: 'm', conversationId: 'c', type: 'system', sender: null, text, createdAt: '2026-10-29T10:00:00Z', clientId: null, systemKey, systemParams, deletedAt: null };
}

describe('system messages', () => {
  it('renders every server key in English and Azerbaijani', () => {
    const p = { userId: 'u', displayName: 'Rauf' };
    expect(systemText(sys('event.joined', p), tEn)).toBe('Rauf joined the event');
    expect(systemText(sys('event.waitlisted', p), tEn)).toBe('Rauf joined the waitlist');
    expect(systemText(sys('event.left', p), tEn)).toBe('Rauf left the event');
    expect(systemText(sys('event.promoted', p), tEn)).toBe('Rauf moved from the waitlist to going');
    expect(systemText(sys('event.removed', p), tEn)).toBe('Rauf was removed by the organizer');
    expect(systemText(sys('event.promoted', p), tAz)).toBe('Rauf gözləmədən gedənlərə keçdi');
    expect(systemText(sys('event.joined', p), tAz)).toBe('Rauf tədbirə qoşuldu');
  });
  it('cancelled with and without a reason', () => {
    expect(systemText(sys('event.cancelled', { reason: 'Snow on the pass' }), tEn)).toBe('The event was cancelled: Snow on the pass');
    expect(systemText(sys('event.cancelled', { reason: null }), tEn)).toBe('The event was cancelled');
    expect(systemText(sys('event.cancelled', { reason: 'Qar' }), tAz)).toBe('Tədbir ləğv edildi: Qar');
  });
  it('edited lists the translated fields (spot and spotId count once)', () => {
    expect(systemText(sys('event.edited', { fields: ['startsAt', 'maxCars'] }), tEn)).toBe('The organizer changed: start time, max cars');
    expect(systemText(sys('event.edited', { fields: ['spotId'] }), tAz)).toBe('Təşkilatçı dəyişdi: məkan');
    expect(systemText(sys('event.edited', { fields: ['bogus'] }), tEn)).toBe('The organizer updated the event');
    expect(systemText(sys('event.edited', null), tEn)).toBe('The organizer updated the event');
  });
  it('missing name and unknown keys never show a raw key', () => {
    expect(systemText(sys('event.joined', {}), tEn)).toBe('Someone joined the event');
    expect(systemText(sys('event.future', {}, 'Server fallback'), tEn)).toBe('Server fallback');
    expect(systemText(sys('event.future', {}, ''), tAz)).toBe('Tədbir yeniliyi');
  });
  it('messageText: deleted placeholder, system text, normal text', () => {
    const user: Message = { id: 'u', conversationId: 'c', type: 'user', sender: { id: 'a', displayName: 'A', avatarUrl: null }, text: 'Salam', createdAt: '2026-10-29T10:00:00Z', clientId: null };
    expect(messageText(user, tEn)).toBe('Salam');
    expect(messageText({ ...user, text: '', deletedAt: '2026-10-29T11:00:00Z' }, tEn)).toBe('Message deleted');
    expect(messageText({ ...user, text: '', deletedAt: '2026-10-29T11:00:00Z' }, tAz)).toBe('Mesaj silindi');
    expect(messageText(sys('event.left', { displayName: 'Ali' }), tEn)).toBe('Ali left the event');
    expect(isSystem(user)).toBe(false);
    // v2 messages without `type` are user messages
    expect(isSystem({ systemKey: null })).toBe(false);
  });
  it('az and en have the same event/system/chat/clan keys', () => {
    const keys = (o: unknown, pre = ''): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]);
    for (const section of ['events', 'system', 'chat', 'clan'] as const) {
      expect(keys(az[section]).sort()).toEqual(keys(en[section]).sort());
    }
    expect(en.events.weekdays).toHaveLength(7);
    expect(az.events.monthsShort).toHaveLength(12);
    expect(en.appName).toBe('YOLCHU');
    expect(az.appName).toBe('YOLCHU');
  });
});
