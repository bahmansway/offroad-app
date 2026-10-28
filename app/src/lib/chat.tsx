import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { io } from 'socket.io-client';
import { api, client } from './api';
import { useAuth } from './auth';
import { API_URL } from './config';
import { setSendMessageHandler } from './chatHooks';
import { createRealtimeClient, type IoFactory, type RealtimeClient, type RealtimeStatus } from './realtimeClient';
import { applyConversationUpdate, markReadLocal, sortConversations, totalUnread } from './chatLogic';
import type { Conversation, Id, Message } from './types';

type MessageListener = (m: Message) => void;
type PollListener = () => void;

interface ChatValue {
  conversations: Conversation[] | null;
  error: unknown;
  unread: number;
  status: RealtimeStatus;
  reload: () => Promise<void>;
  /** the chat screen tells us which conversation is open (no unread bump for it) */
  setOpen: (id: Id | null) => void;
  markRead: (id: Id) => void;
  /** live messages for one conversation; returns unsubscribe */
  subscribe: (conversationId: Id, fn: MessageListener) => () => void;
  /** fires on each 10 s poll tick while the socket is down, and after a reconnect */
  onCatchUp: (fn: PollListener) => () => void;
  /** open (or create) the DM with this user */
  openDm: (userId: Id) => Promise<void>;
}

const ChatContext = createContext<ChatValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const openRef = useRef<Id | null>(null);
  const myIdRef = useRef<Id | null>(myId);
  myIdRef.current = myId;
  const listeners = useRef(new Map<string, Set<MessageListener>>());
  const catchUps = useRef(new Set<PollListener>());
  const rt = useRef<RealtimeClient | null>(null);
  const loading = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (!myIdRef.current) return;
    if (loading.current) return loading.current;
    const p = (async () => {
      try {
        const list = await api.conversations();
        const open = openRef.current;
        // the open chat is being read right now
        setConversations(sortConversations(open ? markReadLocal(list, open) : list));
        setError(null);
      } catch (e) {
        setError(e);
      }
    })().finally(() => { loading.current = null; });
    loading.current = p;
    return p;
  }, []);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // Start/stop the socket with the session.
  useEffect(() => {
    if (!myId) {
      setConversations(null);
      setError(null);
      return;
    }
    const c = createRealtimeClient({
      url: API_URL,
      io: io as unknown as IoFactory,
      getToken: async () => (await client.getTokens())?.accessToken ?? null,
      refresh: async (stale) => (await client.refresh(stale))?.accessToken ?? null,
      onStatus: setStatus,
      onMessage: (m) => {
        listeners.current.get(String(m.conversationId))?.forEach((fn) => fn(m));
      },
      onConversation: (u) => {
        let unknown = false;
        setConversations((list) => {
          if (!list) return list;
          const r = applyConversationUpdate(list, u, { myId: myIdRef.current, openId: openRef.current });
          if (!r.known) unknown = true;
          return r.list;
        });
        // a new DM or a clan we just joined: fetch the list again
        if (unknown) reloadRef.current();
      },
      onReady: () => {
        reloadRef.current();
        catchUps.current.forEach((fn) => fn());
      },
      onPoll: () => {
        reloadRef.current();
        catchUps.current.forEach((fn) => fn());
      },
    });
    rt.current = c;
    reloadRef.current();
    c.start();

    // reconnect when the app comes back on screen / the browser is online again
    let cleanup: () => void;
    if (Platform.OS === 'web') {
      const h = () => { c.foreground(); reloadRef.current(); };
      const vis = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') h(); };
      if (typeof window !== 'undefined') {
        window.addEventListener('online', h);
        window.addEventListener('focus', h);
        document.addEventListener?.('visibilitychange', vis);
      }
      cleanup = () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', h);
          window.removeEventListener('focus', h);
          document.removeEventListener?.('visibilitychange', vis);
        }
      };
    } else {
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') { c.foreground(); reloadRef.current(); }
      });
      cleanup = () => sub.remove();
    }
    return () => {
      cleanup();
      c.stop();
      rt.current = null;
    };
  }, [myId]);

  const setOpen = useCallback((id: Id | null) => {
    openRef.current = id;
    if (id) setConversations((l) => (l ? markReadLocal(l, id) : l));
  }, []);

  const markRead = useCallback((id: Id) => {
    setConversations((l) => (l ? markReadLocal(l, id) : l));
    api.markRead(id).catch(() => { /* next load fixes the count */ });
  }, []);

  const subscribe = useCallback((conversationId: Id, fn: MessageListener) => {
    const k = String(conversationId);
    let set = listeners.current.get(k);
    if (!set) listeners.current.set(k, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) listeners.current.delete(k);
    };
  }, []);

  const onCatchUp = useCallback((fn: PollListener) => {
    catchUps.current.add(fn);
    return () => { catchUps.current.delete(fn); };
  }, []);

  const openDm = useCallback(async (userId: Id) => {
    const conv = await api.startDm(userId);
    setConversations((l) => (l && !l.some((c) => String(c.id) === String(conv.id)) ? sortConversations([conv, ...l]) : l));
    router.push(`/chat/${conv.id}`);
  }, []);

  // "Mesaj yaz" on public profiles. Errors (403 blocked etc.) go back to the profile screen.
  useEffect(() => {
    if (!myId) {
      setSendMessageHandler(null);
      return;
    }
    setSendMessageHandler((u) => openDm(u.id));
    return () => setSendMessageHandler(null);
  }, [myId, openDm]);

  const unread = totalUnread(conversations);
  const value = useMemo<ChatValue>(
    () => ({ conversations, error, unread, status, reload, setOpen, markRead, subscribe, onCatchUp, openDm }),
    [conversations, error, unread, status, reload, setOpen, markRead, subscribe, onCatchUp, openDm],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
