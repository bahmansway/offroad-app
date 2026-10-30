import { fold } from './friendsLogic';
import { sameId } from './format';
import type { Conversation, SearchResult } from './types';

/** GET /api/search accepts 2–40 characters. */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 40;
export const SEARCH_DEBOUNCE_MS = 300;

/** Trimmed, single-spaced query cut to 40 chars, or null when it is too short to send. */
export function searchQuery(raw: string): string | null {
  const q = raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX).trim();
  return q.length >= SEARCH_MIN ? q : null;
}

/**
 * Stale-response guard: every request takes a ticket; only the newest ticket may write results.
 * Typing "Ra" → "Rau" fires two requests; if "Ra" answers last it is ignored.
 */
export function createStaleGuard() {
  let latest = 0;
  return {
    next(): number {
      latest += 1;
      return latest;
    },
    isLatest(ticket: number): boolean {
      return ticket === latest;
    },
    /** drop everything in flight (query cleared, screen left) */
    cancel(): void {
      latest += 1;
    },
  };
}
export type StaleGuard = ReturnType<typeof createStaleGuard>;

/** My chats from the already-loaded list whose title matches (shown at once, before the server answers). */
export function localConversationMatches(list: Conversation[] | null | undefined, q: string): Conversation[] {
  const needle = fold(q.trim());
  if (!needle) return [];
  return (list ?? []).filter((c) => fold(c.title || '').includes(needle) || fold(c.otherUser?.displayName ?? '').includes(needle)).slice(0, 10);
}

export const EMPTY_RESULT: SearchResult = { users: [], clans: [], conversations: [] };

/**
 * What the search screen shows: the server result (if it has answered for this query) plus local chat
 * matches. Server chats come first in server order, local ones fill in after; no duplicates.
 * Users: friends first (the server already does it; kept stable here).
 */
export function mergeSearch(server: SearchResult | null, local: Conversation[]): SearchResult {
  const s = server ?? EMPTY_RESULT;
  const conversations = [...s.conversations];
  for (const c of local) if (!conversations.some((x) => sameId(x.id, c.id))) conversations.push(c);
  const users = [...s.users.filter((u) => u.isFriend), ...s.users.filter((u) => !u.isFriend)];
  return { users, clans: [...s.clans], conversations: conversations.slice(0, 10) };
}

export function hasResults(r: SearchResult): boolean {
  return r.users.length + r.clans.length + r.conversations.length > 0;
}
