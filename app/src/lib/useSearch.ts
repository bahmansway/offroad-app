import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { createStaleGuard, localConversationMatches, mergeSearch, SEARCH_DEBOUNCE_MS, searchQuery } from './searchLogic';
import type { Conversation, SearchResult } from './types';

/**
 * Debounced, stale-guarded search for people, clans and my chats.
 * - waits 300 ms after the last keystroke
 * - only the newest request may write results (older answers are dropped)
 * - my already-loaded chats that match show at once, before the server answers
 */
export function useSearch(raw: string, localConversations: Conversation[] | null) {
  const q = searchQuery(raw);
  const [debounced, setDebounced] = useState<string | null>(q);
  const [server, setServer] = useState<{ q: string; result: SearchResult } | null>(null);
  const [error, setError] = useState<{ q: string; e: unknown } | null>(null);
  const [loadingQ, setLoadingQ] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const guard = useRef(createStaleGuard());

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
      if (!guard.current.isLatest(ticket)) return;
      setServer({ q: debounced, result });
      setError(null);
    }).catch((e) => {
      if (guard.current.isLatest(ticket)) setError({ q: debounced, e });
    }).finally(() => {
      if (guard.current.isLatest(ticket)) setLoadingQ(null);
    });
  }, [debounced, attempt]);

  useEffect(() => () => guard.current.cancel(), []);

  const result = useMemo(() => {
    if (!q) return null;
    // only use a server answer for the query on screen
    const s = server && server.q === q ? server.result : null;
    return mergeSearch(s, localConversationMatches(localConversations, q));
  }, [q, server, localConversations]);

  return {
    query: q,
    result,
    answered: !!q && server?.q === q,
    loading: !!q && (loadingQ === q || debounced !== q),
    error: q && error?.q === q ? error.e : null,
    retry: () => setAttempt((n) => n + 1),
  };
}
