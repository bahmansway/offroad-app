import { ApiError } from './apiClient';
import { loadSetting, saveSetting } from './settingsStore';

/**
 * "Remove this phone's push token" notes (SPEC-v5 review fix 1).
 *
 * Logout sends the push token with the refresh token. When that call cannot reach the server (offline)
 * or the session was lost (refresh token rejected), a note is kept on the phone and the call is retried
 * on the next app start, so the old account stops getting notifications on this phone.
 */

export interface PendingRemoval {
  refreshToken: string;
  pushToken: string;
}

export const PENDING_KEY = 'notif.pendingRemoval';
export const MAX_PENDING = 5;

/** Add a note (newest first, same push token + refresh token only once, at most `max`). */
export function addPending(list: PendingRemoval[], p: PendingRemoval, max = MAX_PENDING): PendingRemoval[] {
  const rest = list.filter((x) => !(x.pushToken === p.pushToken && x.refreshToken === p.refreshToken));
  return [p, ...rest].slice(0, max);
}

/** Done = the server answered (2xx, or a 4xx that will never succeed). Network trouble / 5xx / 429 = try again later. */
export function removalDone(err: unknown): boolean {
  if (!err) return true;
  if (err instanceof ApiError) return err.status >= 400 && err.status < 500 && err.status !== 429;
  return false;
}

export function parsePending(raw: string | null): PendingRemoval[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x) => x && typeof x.refreshToken === 'string' && typeof x.pushToken === 'string').slice(0, MAX_PENDING)
      : [];
  } catch {
    return [];
  }
}

async function load() {
  return parsePending(await loadSetting(PENDING_KEY));
}
async function save(list: PendingRemoval[]) {
  await saveSetting(PENDING_KEY, list.length ? JSON.stringify(list) : '');
}

export async function rememberRemoval(p: PendingRemoval) {
  await save(addPending(await load(), p));
}

/** One logout call per note; keeps the notes that could not reach the server. */
export async function retryRemovals(logout: (refreshToken: string, pushToken: string) => Promise<unknown>) {
  const list = await load();
  if (!list.length) return;
  const keep: PendingRemoval[] = [];
  for (const p of list) {
    let err: unknown = null;
    try {
      await logout(p.refreshToken, p.pushToken);
    } catch (e) {
      err = e ?? new Error('failed');
    }
    if (!removalDone(err)) keep.push(p);
  }
  // notes added meanwhile (another logout during the retry) are kept too
  const now = await load();
  const added = now.filter((n) => !list.some((o) => o.pushToken === n.pushToken && o.refreshToken === n.refreshToken));
  await save([...added, ...keep].slice(0, MAX_PENDING));
}
