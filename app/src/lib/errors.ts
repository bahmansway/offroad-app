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
