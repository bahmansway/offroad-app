import type { Message } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Edited-field names the server may send in `event.edited` → key under `system.fields`. */
const FIELDS = ['title', 'description', 'startsAt', 'endsAt', 'spot', 'spotId', 'meetingPoint', 'maxCars', 'minDifficulty', 'requirements', 'visibility'];

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function isSystem(m: Pick<Message, 'type' | 'systemKey'>): boolean {
  return m.type === 'system' || (!!m.systemKey && m.type !== 'user');
}

export function isDeleted(m: Pick<Message, 'deletedAt'>): boolean {
  return !!m.deletedAt;
}

/**
 * Text for a system message in the user's language. Unknown keys fall back to the English `text`
 * the server stores, so a newer server never shows a raw key.
 */
export function systemText(m: Pick<Message, 'systemKey' | 'systemParams' | 'text'>, t: T): string {
  const p = (m.systemParams ?? {}) as Record<string, unknown>;
  const name = str(p.displayName).trim() || t('system.someone');
  switch (m.systemKey) {
    case 'event.joined':
    case 'event.waitlisted':
    case 'event.left':
    case 'event.promoted':
    case 'event.removed':
      return t(`system.${m.systemKey.slice(6)}`, { name });
    case 'event.cancelled': {
      const reason = str(p.reason).trim();
      return reason ? t('system.cancelledReason', { reason }) : t('system.cancelled');
    }
    case 'event.edited': {
      const fields = Array.isArray(p.fields) ? p.fields.map(str).filter((f) => FIELDS.includes(f)) : [];
      // spot and spotId are the same thing for people
      const names = [...new Set(fields.map((f) => t(`system.fields.${f === 'spotId' ? 'spot' : f}`)))];
      return names.length ? t('system.editedFields', { fields: names.join(', ') }) : t('system.edited');
    }
    default:
      return m.text || t('system.unknown');
  }
}

/** One-line text for any message: system text, "Message deleted", or the message itself. */
export function messageText(m: Pick<Message, 'type' | 'systemKey' | 'systemParams' | 'text' | 'deletedAt'>, t: T): string {
  if (isDeleted(m)) return t('chat.deleted');
  if (isSystem(m)) return systemText(m, t);
  return m.text;
}
