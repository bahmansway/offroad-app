import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { io } from 'socket.io-client';
import { api, client } from './api';
import { useAuth } from './auth';
import { API_URL } from './config';
import { setSendMessageHandler } from './chatHooks';
import { createRealtimeClient, type IoFactory, type RealtimeClient, type RealtimeStatus } from './realtimeClient';
import {
  applyConversationUpdate, applyDeletedToList, markReadLocal, patchConversation, sortConversations, totalUnread, unreadAfterRead,
} from './chatLogic';
import type {
  Badges, ConversationPinned, Conversation, FriendAccepted, FriendRequest, GroupEvent, Id, Message, MessageDeleted, MyClanInvite,
} from './types';
import { chatBadgeTotal } from './friendsLogic';

type MessageListener = (m: Message) => void;
type PollListener = () => void;

/** Live events other screens can listen to (chat screen, event page, clans list). */
export interface ChatEvents {
  deleted: MessageDeleted;
  pinned: ConversationPinned;
  eventUpdated: { eventId: Id };
  clanInvite: MyClanInvite;
  friendRequest: FriendRequest;
  friendAccepted: FriendAccepted;
  groupUpdated: GroupEvent;
  groupRemoved: GroupEvent;
}
type EventName = keyof ChatEvents;

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
  /** listen to a live event; returns unsubscribe */
  on: <K extends EventName>(name: K, fn: (p: ChatEvents[K]) => void) => () => void;
  /** mute / unmute a conversation (per user); throws on failure */
  setMuted: (id: Id, muted: boolean) => Promise<void>;
  /** change one conversation locally (pinned etc.) */
  patch: (id: Id, p: Partial<Conversation>) => void;
  /** my pending clan invites (Söhbət → Klanlar); null until loaded */
  invites: MyClanInvite[] | null;
  reloadInvites: () => Promise<void>;
  /** fetch the tab badge total again */
  refreshUnread: () => void;
  /** v4: pending incoming friend requests (Profile tab badge) */
  friendRequests: number;
  /** v4: Söhbət tab badge = unread messages + clan invites */
  chatBadge: number;
  /** v4: put a conversation into the list (new DM / group). Pass the `session()` taken before the
   *  request: if the user logged out / switched meanwhile, nothing is added. */
  upsert: (c: Conversation, fromSession?: number) => void;
  /** v4: current login session number (changes on login / logout) */
  session: () => number;
  /** v4: drop a conversation from the list (left / removed from a group) */
  drop: (id: Id) => void;
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
  const loading = useRef<{ session: number; p: Promise<void> } | null>(null);
  /** Bumped on every login/logout: results of requests started in an older session are dropped. */
  const session = useRef(0);
  /** Mirror of `conversations`, so event handlers decide from the current list (not inside an updater). */
  const listRef = useRef<Conversation[] | null>(null);
  /** server badges (GET /me/badges); null until the first answer → local counts are used */
  const [badges, setBadges] = useState<Badges | null>(null);
  /** messages part of the badges, kept as its own setter so the old unread logic stays the same */
  const setServerUnread = useCallback((fn: (n: number | null) => number | null) => {
    setBadges((b) => {
      if (!b) return b;
      const next = fn(b.messages);
      return next == null ? b : { ...b, messages: next };
    });
  }, []);
  const [invites, setInvites] = useState<MyClanInvite[] | null>(null);
  const bus = useRef(new Map<EventName, Set<(p: never) => void>>());
  const emit = useCallback(<K extends EventName>(name: K, p: ChatEvents[K]) => {
    bus.current.get(name)?.forEach((fn) => (fn as (x: ChatEvents[K]) => void)(p));
  }, []);
  const unreadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshUnread = useCallback(() => {
    if (!myIdRef.current) return;
    if (unreadTimer.current) clearTimeout(unreadTimer.current);
    const my = session.current;
    unreadTimer.current = setTimeout(() => {
      unreadTimer.current = null;
      api.badges().then((r) => {
        if (my === session.current && r && typeof r.messages === 'number') setBadges(r);
      }).catch(() => {
        // older server without /me/badges: messages only
        api.unreadTotal().then((r) => {
          if (my === session.current && typeof r?.total === 'number') {
            setBadges((b) => ({ friendRequests: b?.friendRequests ?? 0, clanInvites: b?.clanInvites ?? 0, messages: r.total }));
          }
        }).catch(() => { /* keep the last value */ });
      });
    }, 250);
  }, []);
  const refreshUnreadRef = useRef(refreshUnread);
  refreshUnreadRef.current = refreshUnread;
  const reloadInvites = useCallback(async () => {
    if (!myIdRef.current) return;
    const my = session.current;
    try {
      const r = await api.myClanInvites();
      if (my === session.current) setInvites(r.items);
    } catch { /* keep the old list */ }
  }, []);
  const reloadInvitesRef = useRef(reloadInvites);
  reloadInvitesRef.current = reloadInvites;

  const setList = useCallback((next: Conversation[] | null) => {
    listRef.current = next;
    setConversations(next);
  }, []);

  const reload = useCallback(async () => {
    if (!myIdRef.current) return;
    const my = session.current;
    if (loading.current && loading.current.session === my) return loading.current.p;
    const p = (async () => {
      try {
        const list = await api.conversations();
        if (my !== session.current) return; // logged out / another user meanwhile
        const open = openRef.current;
        // the open chat is being read right now
        setList(sortConversations(open ? markReadLocal(list, open) : list));
        setError(null);
        refreshUnreadRef.current();
      } catch (e) {
        if (my === session.current) setError(e);
      }
    })().finally(() => {
      if (loading.current?.p === p) loading.current = null;
    });
    loading.current = { session: my, p };
    return p;
  }, [setList]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // Start/stop the socket with the session.
  useEffect(() => {
    session.current++;
    loading.current = null;
    setList(null);
    setError(null);
    setBadges(null);
    setInvites(null);
    if (!myId) return;
    const my = session.current;
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
        if (my !== session.current) return;
        const list = listRef.current;
        if (!list) {
          reloadRef.current(); // first load still running or failed
          return;
        }
        const r = applyConversationUpdate(list, u, { myId: myIdRef.current, openId: openRef.current });
        if (r.known) setList(r.list);
        // a new DM or a clan we just joined: fetch the list again
        else reloadRef.current();
        refreshUnreadRef.current();
      },
      onMessageDeleted: (d) => {
        if (my !== session.current) return;
        if (listRef.current) setList(applyDeletedToList(listRef.current, d));
        emit('deleted', d);
        refreshUnreadRef.current();
      },
      onPinned: (p) => {
        if (my !== session.current) return;
        if (listRef.current) setList(patchConversation(listRef.current, p.conversationId, { pinned: p.pinned }));
        emit('pinned', p);
      },
      onEventUpdated: (e) => {
        if (my !== session.current) return;
        emit('eventUpdated', e);
        reloadRef.current(); // joined/left/removed/cancelled change the chat list
      },
      onClanInvite: (i) => {
        if (my !== session.current) return;
        emit('clanInvite', i);
        reloadInvitesRef.current();
        refreshUnreadRef.current();
      },
      onFriendRequest: (r) => {
        if (my !== session.current) return;
        emit('friendRequest', r);
        refreshUnreadRef.current();
      },
      onFriendAccepted: (a) => {
        if (my !== session.current) return;
        emit('friendAccepted', a);
        refreshUnreadRef.current();
      },
      onGroupUpdated: (g) => {
        if (my !== session.current) return;
        emit('groupUpdated', g);
        reloadRef.current(); // name / photo / members changed
      },
      onGroupRemoved: (g) => {
        if (my !== session.current) return;
        if (listRef.current) setList(listRef.current.filter((x) => String(x.id) !== String(g.conversationId)));
        emit('groupRemoved', g);
        refreshUnreadRef.current();
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
    reloadInvitesRef.current();
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
      if (unreadTimer.current) clearTimeout(unreadTimer.current);
    };
  }, [myId, setList, emit, setServerUnread]);

  const setOpen = useCallback((id: Id | null) => {
    openRef.current = id;
    if (id && listRef.current) {
      const conv = listRef.current.find((x) => String(x.id) === String(id));
      setServerUnread((n) => (n == null ? n : unreadAfterRead(n, conv)));
      setList(markReadLocal(listRef.current, id));
    }
  }, [setList, setServerUnread]);

  const markRead = useCallback((id: Id) => {
    if (listRef.current) {
      const conv = listRef.current.find((x) => String(x.id) === String(id));
      setServerUnread((n) => (n == null ? n : unreadAfterRead(n, conv)));
      setList(markReadLocal(listRef.current, id));
    }
    api.markRead(id).then(() => refreshUnreadRef.current()).catch(() => { /* next load fixes the count */ });
  }, [setList, setServerUnread]);

  const upsert = useCallback((conv: Conversation, fromSession?: number) => {
    if (fromSession !== undefined && fromSession !== session.current) return;
    const l = listRef.current;
    if (!l) return;
    const rest = l.filter((c) => String(c.id) !== String(conv.id));
    setList(sortConversations([conv, ...rest]));
  }, [setList]);

  const currentSession = useCallback(() => session.current, []);

  const drop = useCallback((id: Id) => {
    const l = listRef.current;
    if (l) setList(l.filter((c) => String(c.id) !== String(id)));
    refreshUnreadRef.current();
  }, [setList]);

  const on = useCallback(<K extends EventName>(name: K, fn: (p: ChatEvents[K]) => void) => {
    let set = bus.current.get(name);
    if (!set) bus.current.set(name, (set = new Set()));
    set.add(fn as (p: never) => void);
    return () => { set!.delete(fn as (p: never) => void); };
  }, []);

  const patch = useCallback((id: Id, p: Partial<Conversation>) => {
    if (listRef.current) setList(patchConversation(listRef.current, id, p));
  }, [setList]);

  const setMuted = useCallback(async (id: Id, muted: boolean) => {
    const my = session.current;
    const r = muted ? await api.mute(id) : await api.unmute(id);
    if (my !== session.current) return; // logged out / another user meanwhile
    const value = typeof r?.muted === 'boolean' ? r.muted : muted;
    if (listRef.current) setList(patchConversation(listRef.current, id, { muted: value }));
    refreshUnreadRef.current();
  }, [setList]);

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
    const l = listRef.current;
    if (l && !l.some((c) => String(c.id) === String(conv.id))) setList(sortConversations([conv, ...l]));
    router.push(`/chat/${conv.id}`);
  }, [setList]);

  // "Mesaj yaz" on public profiles. Errors (403 blocked etc.) go back to the profile screen.
  useEffect(() => {
    if (!myId) {
      setSendMessageHandler(null);
      return;
    }
    setSendMessageHandler((u) => openDm(u.id));
    return () => setSendMessageHandler(null);
  }, [myId, openDm]);

  const unread = badges?.messages ?? totalUnread(conversations);
  const friendRequests = badges?.friendRequests ?? 0;
  const chatBadge = chatBadgeTotal({ messages: unread, clanInvites: badges?.clanInvites ?? invites?.length ?? 0 });
  const value = useMemo<ChatValue>(
    () => ({
      conversations, error, unread, status, reload, setOpen, markRead, subscribe, onCatchUp, openDm,
      on, setMuted, patch, invites, reloadInvites, refreshUnread, friendRequests, chatBadge, upsert, drop,
      session: currentSession,
    }),
    [conversations, error, unread, status, reload, setOpen, markRead, subscribe, onCatchUp, openDm, on, setMuted, patch, invites, reloadInvites, refreshUnread, friendRequests, chatBadge, upsert, drop, currentSession],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
