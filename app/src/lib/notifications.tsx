import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import { api } from './api';
import { onBeforeLogout, setLogoutPushTokenSource, useAuth } from './auth';
import { useChat } from './chat';
import { useI18n } from './i18n';
import { loadSetting, saveSetting } from './settingsStore';
import * as native from './notifyNative';
import {
  collectPages, createTapDeduper, foregroundAction, planReminderSync, plannedReminders, routeForNotification, shouldShowPrePrompt,
  type NotificationData, type ReminderWords,
} from './notificationLogic';
import type { EventSummary, NotificationSettings } from './types';
import { InAppBanner, type BannerData } from '../components/InAppBanner';

/**
 * Phone notifications (SPEC-v5):
 * - asks once (after a short explanation screen), registers the Expo push token outside Expo Go,
 *   removes it on logout;
 * - opens the right screen when a notification is tapped; shows an in-app banner while the app is open;
 * - keeps local event reminders (24 h + 2 h before) in sync with "my" events — these work in Expo Go;
 * - the iOS app badge follows the tab badges while the app is open.
 */

export const PRE_PROMPT_KEY = 'notif.asked';
export const REMINDERS_KEY = 'notif.reminders';
const TOKEN_KEY = 'notif.pushToken';

interface NotificationsValue {
  /** false on the website */
  supported: boolean;
  /** running in the Expo Go test app: reminders only, no remote push */
  expoGo: boolean;
  permission: native.PermissionStatus | null;
  /** after the explanation screen: show the system prompt; true when allowed */
  requestPermission: () => Promise<boolean>;
  /** "Not now" on the explanation screen */
  dismissPrePrompt: () => Promise<void>;
  openSystemSettings: () => void;
  /** server switches; null until loaded */
  settings: NotificationSettings | null;
  settingsError: boolean;
  reloadSettings: () => Promise<void>;
  /** optimistic; throws (and reverts) when the server says no */
  updateSettings: (patch: Partial<NotificationSettings>) => Promise<void>;
  /** "Tədbir xatırlatmaları" (this device only) */
  remindersEnabled: boolean;
  setRemindersEnabled: (v: boolean) => void;
  /** re-sync all reminders with my upcoming events */
  syncReminders: () => Promise<void>;
  /** re-sync the reminders of one event (event page after load / join / leave) */
  syncEventReminders: (e: EventSummary) => Promise<void>;
}

const noop = async () => {};
const NotificationsContext = createContext<NotificationsValue>({
  supported: false, expoGo: false, permission: null, requestPermission: async () => false, dismissPrePrompt: noop,
  openSystemSettings: () => {}, settings: null, settingsError: false, reloadSettings: noop, updateSettings: noop,
  remindersEnabled: false, setRemindersEnabled: () => {}, syncReminders: noop, syncEventReminders: noop,
});

export function useNotifications() {
  return useContext(NotificationsContext);
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const chat = useChat();
  const { t, lang } = useI18n();
  const userId = user?.id ?? null;
  const userRef = useRef(userId);
  userRef.current = userId;
  const openChatId = chat.openId; // stable callback
  const onChatEvent = chat.on; // stable callback

  const [permission, setPermission] = useState<native.PermissionStatus | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [remindersEnabled, setRemindersState] = useState(true);
  const [banner, setBanner] = useState<BannerData | null>(null);
  const tokenRef = useRef<string | null>(null);
  const bannerKey = useRef(0);
  const pendingTap = useRef<string | null>(null);

  // ---- live values for callbacks ----
  const live = useRef({ settings, remindersEnabled, permission, t });
  live.current = { settings, remindersEnabled, permission, t };

  useEffect(() => {
    loadSetting(REMINDERS_KEY).then((v) => { if (v === '0') setRemindersState(false); });
  }, []);

  // ---- open a screen from a tapped notification ----
  const firstTap = useRef(createTapDeduper()).current;
  const go = useCallback((tap: native.Tap) => {
    if (!firstTap(tap.id)) return; // the launch tap can also arrive through the listener
    const route = routeForNotification(tap.data);
    if (!route) return;
    if (!userRef.current) { pendingTap.current = route; return; } // after login / session check
    router.push(route as never);
  }, [firstTap]);

  useEffect(() => {
    if (!native.supported) return;
    const offTap = native.onTap(go);
    const offHandler = native.setForegroundHandler((title, body, data) => {
      if (foregroundAction(data, openChatId()) === 'skip') return;
      bannerKey.current++;
      setBanner({ key: bannerKey.current, title, body, route: routeForNotification(data) });
    });
    const first = native.takeLaunchTap();
    if (first && firstTap(first.id)) {
      const r = routeForNotification(first.data);
      if (r) pendingTap.current = r;
    }
    return () => { offTap(); offHandler(); };
  }, [go, openChatId, firstTap]);

  useEffect(() => {
    if (loading || !userId || !pendingTap.current) return;
    const r = pendingTap.current;
    pendingTap.current = null;
    setTimeout(() => router.push(r as never), 0);
  }, [loading, userId]);

  // ---- Android channels (named in the app language) ----
  useEffect(() => {
    if (!native.supported) return;
    native.setupChannels({ messages: t('notifications.channelMessages'), events: t('notifications.channelEvents') });
  }, [t]);

  // ---- push token ----
  const register = useCallback(async () => {
    if (!native.supported || native.expoGo || !userRef.current) return;
    const token = await native.getPushToken();
    if (!token || !userRef.current) return;
    try {
      await api.registerPushToken({ token, platform: native.pushPlatform, locale: lang });
      tokenRef.current = token;
      saveSetting(TOKEN_KEY, token);
    } catch {
      /* try again next app start */
    }
  }, [lang]);

  // logged in (or app start with a saved session): explanation screen once, then register
  useEffect(() => {
    if (!native.supported || loading || !userId) return;
    let alive = true;
    (async () => {
      const status = await native.getPermission();
      if (!alive) return;
      setPermission(status);
      if (status === 'granted') { register(); return; }
      const asked = (await loadSetting(PRE_PROMPT_KEY)) === '1';
      if (alive && shouldShowPrePrompt({ platform: Platform.OS, status, askedBefore: asked })) {
        setTimeout(() => { if (userRef.current) router.push('/notifications-intro'); }, 600);
      }
    })();
    return () => { alive = false; };
  }, [userId, loading, register]);

  const requestPermission = useCallback(async () => {
    await saveSetting(PRE_PROMPT_KEY, '1');
    const status = await native.requestPermission();
    setPermission(status);
    if (status === 'granted') await register();
    return status === 'granted';
  }, [register]);

  const dismissPrePrompt = useCallback(async () => { await saveSetting(PRE_PROMPT_KEY, '1'); }, []);

  // permission may change in the phone settings while the app is in the background
  useEffect(() => {
    if (!native.supported) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !userRef.current) return;
      native.getPermission().then((p) => {
        const old = live.current.permission;
        setPermission(p);
        if (p === 'granted' && old !== 'granted') register();
      });
    });
    return () => sub.remove();
  }, [register]);

  // ---- server settings ----
  const reloadSettings = useCallback(async () => {
    const forUser = userRef.current;
    if (!forUser) return;
    try {
      const s = await api.notificationSettings();
      if (forUser === userRef.current) { setSettings(s); setSettingsError(false); }
    } catch {
      if (forUser === userRef.current) setSettingsError(true);
    }
  }, []);
  useEffect(() => {
    setSettings(null);
    setSettingsError(false);
    if (userId) reloadSettings();
  }, [userId, reloadSettings]);

  const updateSettings = useCallback(async (patch: Partial<NotificationSettings>) => {
    const before = live.current.settings;
    const forUser = userRef.current;
    if (before) setSettings({ ...before, ...patch });
    try {
      const s = await api.updateNotificationSettings(patch);
      if (forUser === userRef.current) setSettings(s);
    } catch (e) {
      if (forUser === userRef.current) setSettings(before);
      throw e;
    }
  }, []);

  // ---- reminders ----
  const words = useCallback((): ReminderWords => {
    const tt = live.current.t;
    return {
      dayBefore: (time, place) => (place ? tt('notifications.reminderDayBefore', { time, place }) : tt('notifications.reminderDayBeforeNoPlace', { time })),
      soon: (place) => (place ? tt('notifications.reminderSoon', { place }) : tt('notifications.reminderSoonNoPlace')),
    };
  }, []);
  const remindersOn = () => {
    const l = live.current;
    // the server "events" switch also turns reminders off; without permission they could not show anyway
    return !!userRef.current && l.remindersEnabled && l.settings?.events !== false && l.permission === 'granted';
  };
  /** one sync at a time */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((fn: () => Promise<void>) => {
    const p = queue.current.then(fn).catch(() => { /* keep what is scheduled */ });
    queue.current = p;
    return p;
  }, []);

  const apply = async (plan: ReturnType<typeof planReminderSync>) => {
    for (const id of plan.cancel) await native.cancelReminder(id);
    for (const p of plan.schedule) {
      try { await native.scheduleReminder(p); } catch { /* skip this one */ }
    }
  };

  const syncReminders = useCallback(() => enqueue(async () => {
    if (!native.supported) return;
    const forUser = userRef.current;
    // still checking the permission at startup: change nothing yet (avoids cancel + re-add on every launch)
    if (forUser && live.current.permission === null) return;
    let events: EventSummary[] = [];
    if (remindersOn()) {
      // fetch first: a network error must not wipe the scheduled reminders
      // every page of "mine" (organizer / going / waitlist, not finished)
      events = await collectPages((cursor) => api.events({ scope: 'mine', limit: 50, cursor }));
    }
    if (forUser !== userRef.current) return;
    const planned = plannedReminders(events, { now: Date.now(), enabled: remindersOn(), words: words() });
    await apply(planReminderSync(planned, await native.listReminders()));
  }), [enqueue, words]);

  const syncEventReminders = useCallback((e: EventSummary) => enqueue(async () => {
    if (!native.supported || !userRef.current) return;
    const planned = plannedReminders([e], { now: Date.now(), enabled: remindersOn(), words: words() });
    await apply(planReminderSync(planned, await native.listReminders(), e.id));
  }), [enqueue, words]);

  const setRemindersEnabled = useCallback((v: boolean) => {
    setRemindersState(v);
    live.current = { ...live.current, remindersEnabled: v };
    saveSetting(REMINDERS_KEY, v ? '1' : '0');
    syncReminders();
  }, [syncReminders]);

  // sync on login / app start, when settings, permission or language change, and when an event of mine changes
  useEffect(() => {
    if (!native.supported || loading) return;
    syncReminders();
  }, [userId, loading, settings?.events, remindersEnabled, permission, lang, syncReminders]);
  useEffect(() => onChatEvent('eventUpdated', () => { syncReminders(); }), [onChatEvent, syncReminders]);
  useEffect(() => {
    if (!native.supported) return;
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') syncReminders(); });
    return () => sub.remove();
  }, [syncReminders]);

  // ---- logout: forget this phone on the server, drop this user's reminders and badge ----
  useEffect(() => {
    if (!native.supported) return;
    // logout sends this token with the refresh token (POST /auth/logout), also after a lost session
    setLogoutPushTokenSource(async () => tokenRef.current ?? ((await loadSetting(TOKEN_KEY)) || null));
    const off = onBeforeLogout(async () => {
      await Promise.all([
        enqueue(async () => apply(planReminderSync([], await native.listReminders()))),
        native.setBadge(0),
      ]);
      tokenRef.current = null;
      saveSetting(TOKEN_KEY, '');
    });
    return () => { off(); setLogoutPushTokenSource(null); };
  }, [enqueue]);

  // ---- iOS app badge follows the tab badges while the app is open ----
  const total = userId ? chat.chatBadge + chat.friendRequests : 0;
  useEffect(() => {
    if (native.supported && !loading) native.setBadge(total);
  }, [total, loading]);

  const value = useMemo<NotificationsValue>(() => ({
    supported: native.supported,
    expoGo: native.expoGo,
    permission,
    requestPermission,
    dismissPrePrompt,
    openSystemSettings: () => { Linking.openSettings().catch(() => {}); },
    settings,
    settingsError,
    reloadSettings,
    updateSettings,
    remindersEnabled,
    setRemindersEnabled,
    syncReminders,
    syncEventReminders,
  }), [permission, requestPermission, dismissPrePrompt, settings, settingsError, reloadSettings, updateSettings, remindersEnabled, setRemindersEnabled, syncReminders, syncEventReminders]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <InAppBanner
        banner={banner}
        onClose={() => setBanner(null)}
        onPress={(b) => { setBanner(null); if (b.route) router.push(b.route as never); }}
      />
    </NotificationsContext.Provider>
  );
}
