import { ApiError } from './apiClient';
import { eventConflictKey } from './eventLogic';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Turns any thrown error into a short, translated sentence for the user.
 * - auth:   401 = wrong password, 409 = email taken
 * - create: 429 = hourly limit on new spots/cars/mods
 * - report: 404 = the reported thing was deleted
 * - car:    409 = 20-car limit reached
 * - photo:  409 = 20 MB photo storage full, 413/415 = bad or too big file
 */
export type ErrorContext = 'default' | 'auth' | 'create' | 'report' | 'car' | 'photo';

export function errorMessage(e: unknown, t: T, context: ErrorContext = 'default'): string {
  if (e instanceof ApiError) {
    if (context === 'photo' && e.status === 413) return t('profile.photoTooBig');
    switch (e.code) {
      case 'NETWORK': return /timed out/i.test(e.message) ? t('errors.timeout') : t('errors.network');
      case 'UNAUTHORIZED': return context === 'auth' ? t('errors.unauthorized') : t('errors.sessionExpired');
      case 'FORBIDDEN': return t('errors.forbidden');
      case 'NOT_FOUND': return context === 'report' ? t('errors.targetGone') : t('errors.notFound');
      case 'CONFLICT':
        if (context === 'auth') return t('errors.conflict');
        if (context === 'car') return t('errors.carLimit');
        if (context === 'photo') return t('errors.photoQuota');
        return t('errors.generic');
      case 'RATE_LIMITED': return context === 'create' || context === 'car' ? t('errors.rateLimitedCreate') : t('errors.rateLimited');
      case 'VALIDATION': return context === 'photo' ? t('profile.photoFailed') : t('errors.validation');
      default: return t('errors.generic');
    }
  }
  return t('errors.generic');
}

/** Chat send errors → short sentence. In a clan chat 403 means "not a member any more"; in a DM it means blocked. */
export function chatErrorMessage(e: unknown, t: T, kind: 'dm' | 'clan' | 'event' | null = 'dm'): string {
  if (e instanceof ApiError) {
    if (e.code === 'FORBIDDEN') return kind === 'clan' || kind === 'event' ? t('chat.noAccess') : t('chat.blockedCannotSend');
    if (e.code === 'RATE_LIMITED') return t('chat.rateLimited');
    if (e.code === 'NOT_FOUND') return t('chat.noAccess');
  }
  return errorMessage(e, t);
}

/** Clan action errors. 403/404/409 mean the clan changed under us: the caller reloads it. */
export function clanErrorMessage(e: unknown, t: T, kind: 'save' | 'action' = 'action'): string {
  if (e instanceof ApiError) {
    if (e.code === 'CONFLICT') {
      // Match the server's exact sentences (routes/clans.ts); most specific first.
      const m = e.message;
      if (/remove the other members/i.test(m)) return t('clan.deleteHint');
      if (/clan with this (name|tag) already exists/i.test(m)) return t('clan.nameTaken');
      if (/already in (a|this) clan/i.test(m)) return t('clan.alreadyInClan');
      if (/^hand over leadership first/i.test(m)) return t('clan.leaderLeaveHint');
      if (/clan is full/i.test(m)) return t('clan.full');
      if (/invite has expired/i.test(m)) return t('clan.inviteExpired');
      return t('clan.changed');
    }
    if (e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND') return t('clan.changed');
    if (e.code === 'VALIDATION' && kind === 'save') return t('errors.validation');
  }
  return errorMessage(e, t, kind === 'save' ? 'create' : 'default');
}

/** True for errors after which the clan page should reload itself. */
export function clanShouldReload(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 409);
}

/** Errors when inviting someone to my clan (POST /clans/:id/invites). */
export function inviteErrorMessage(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    const m = e.message;
    if (e.code === 'CONFLICT') {
      if (/pending invite/i.test(m) && /already has/i.test(m)) return t('clan.inviteAlready');
      if (/already in (a|your) clan/i.test(m)) return t('clan.inviteInClan');
      if (/pending invites/i.test(m)) return t('clan.inviteLimit');
      return t('clan.changed');
    }
    if (e.code === 'FORBIDDEN') return /cannot invite/i.test(m) ? t('clan.inviteBlocked') : t('errors.forbidden');
  }
  return errorMessage(e, t);
}

/** Errors when accepting / declining an invite. */
export function acceptInviteErrorMessage(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    if (e.code === 'NOT_FOUND') return t('clan.inviteGone');
    if (e.code === 'CONFLICT') {
      if (/expired/i.test(e.message)) return t('clan.inviteExpired');
      if (/full/i.test(e.message)) return t('clan.full');
      if (/already in a clan/i.test(e.message)) return t('clan.alreadyInClan');
    }
  }
  return errorMessage(e, t);
}

/** Event create / edit / join / leave / cancel errors → short sentence. */
export function eventErrorMessage(e: unknown, t: T, action: 'save' | 'join' | 'other' = 'other'): string {
  if (e instanceof ApiError) {
    if (e.code === 'CONFLICT') {
      const k = eventConflictKey(e.message);
      return k ? t(`events.errors.${k}`) : t('errors.generic');
    }
    if (e.code === 'FORBIDDEN' && action === 'join') {
      if (/removed you/i.test(e.message)) return t('events.errors.removed');
      if (/own cars/i.test(e.message)) return t('events.errors.notYourCar');
      return t('events.errors.forbidden');
    }
    if (e.code === 'NOT_FOUND') return t('events.gone');
  }
  return errorMessage(e, t, action === 'save' ? 'create' : 'default');
}
