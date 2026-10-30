import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { createStaleGuard, localConversationMatches, mergeSearch, SEARCH_DEBOUNCE_MS, searchQuery } from './searchLogic';
import type { Conversation, SearchResult } from './types';

/**
 * Debounced, stale-guarded search for people, clans and my chats.
 * - waits 300 ms after the last keystroke
 * - only the newest request may write results (older answers are dropped)
 * - my already-loaded chats that match show at once, before the server answers
 * - scoped to `userId`: when the user changes, results, errors and requests in flight are dropped
 */
export function useSearch(raw: string, localConversations: Conversation[] | null, userId: string | null) {
  const q = searchQuery(raw);
  const [debounced, setDebounced] = useState<string | null>(q);
  const [server, setServer] = useState<{ q: string; result: SearchResult } | null>(null);
  const [error, setError] = useState<{ q: string; e: unknown } | null>(null);
  const [loadingQ, setLoadingQ] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const guard = useRef(createStaleGuard(userId));
  const [scope, setScopeState] = useState<string | null>(userId);

  // another user (or logged out): forget everything from the previous one and drop requests in flight.
  // Until this runs, `scope !== userId` already hides the old results (see `result` below).
  useEffect(() => {
    if (guard.current.setScope(userId)) {
      setServer(null);
      setError(null);
      setLoadingQ(null);
    }
    setScopeState(userId);
  }, [userId]);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [q]);

  useEffect(() => {
    if (!debounced) {
      guard.current.cancel();
      setLoadingQ(null);
      return;
    }
    const ticket = guard.current.next();
    setLoadingQ(debounced);
    api.search(debounced).then((result) => {
      if (!guard.current.isLatest(ticket) || guard.current.scope !== scope) return;
      setServer({ q: debounced, result });
      setError(null);
    }).catch((e) => {
      if (guard.current.isLatest(ticket) && guard.current.scope === scope) setError({ q: debounced, e });
    }).finally(() => {
      if (guard.current.isLatest(ticket)) setLoadingQ(null);
    });
  }, [debounced, attempt, scope]);

  useEffect(() => () => guard.current.cancel(), []);

  const result = useMemo(() => {
    if (!q) return null;
    // only use a server answer for the query on screen
    const s = server && server.q === q && scope === userId ? server.result : null;
    return mergeSearch(s, localConversationMatches(localConversations, q));
  }, [q, server, localConversations, scope, userId]);

  return {
    query: q,
    result,
    answered: !!q && server?.q === q && scope === userId,
    loading: !!q && (loadingQ === q || debounced !== q),
    error: q && error?.q === q && scope === userId ? error.e : null,
    retry: () => setAttempt((n) => n + 1),
  };
}
