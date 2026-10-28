import { ApiError } from './apiClient';

export type SessionState = 'loggedOut' | 'offline';

/**
 * What a failed /me at startup means. A 401 only means "logged out" if the client also dropped the
 * tokens (the refresh token was rejected). If tokens are still stored, the refresh failed for a
 * temporary reason (429 / 5xx / network), so keep the session and show "offline".
 */
export function sessionStateAfterMeError(e: unknown, tokensStillStored: boolean): SessionState {
  if (e instanceof ApiError && e.code === 'UNAUTHORIZED' && !tokensStillStored) return 'loggedOut';
  return tokensStillStored ? 'offline' : 'loggedOut';
}
