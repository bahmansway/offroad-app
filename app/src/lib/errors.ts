import { ApiError } from './apiClient';

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
export function chatErrorMessage(e: unknown, t: T, kind: 'dm' | 'clan' | null = 'dm'): string {
  if (e instanceof ApiError) {
    if (e.code === 'FORBIDDEN') return kind === 'clan' ? t('chat.noAccess') : t('chat.blockedCannotSend');
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
