import { ApiError } from './apiClient';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Turns any thrown error into a short, translated sentence for the user.
 * - auth:   401 = wrong password, 409 = email taken
 * - create: 429 = hourly limit on new spots/cars/mods
 * - report: 404 = the reported thing was deleted
 */
export type ErrorContext = 'default' | 'auth' | 'create' | 'report';

export function errorMessage(e: unknown, t: T, context: ErrorContext = 'default'): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'NETWORK': return /timed out/i.test(e.message) ? t('errors.timeout') : t('errors.network');
      case 'UNAUTHORIZED': return context === 'auth' ? t('errors.unauthorized') : t('errors.sessionExpired');
      case 'FORBIDDEN': return t('errors.forbidden');
      case 'NOT_FOUND': return context === 'report' ? t('errors.targetGone') : t('errors.notFound');
      case 'CONFLICT': return context === 'auth' ? t('errors.conflict') : t('errors.generic');
      case 'RATE_LIMITED': return context === 'create' ? t('errors.rateLimitedCreate') : t('errors.rateLimited');
      case 'VALIDATION': return t('errors.validation');
      default: return t('errors.generic');
    }
  }
  return t('errors.generic');
}
