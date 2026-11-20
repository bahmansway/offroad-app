import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { isExpoGo, type NotificationData, type PlannedReminder, type ScheduledReminder, isReminderId } from './notificationLogic';

/**
 * Thin wrapper around expo-notifications (iPhone / Android). The web build uses notifyNative.web.ts.
 * Everything here swallows native errors: notifications must never break a screen.
 */

export const supported = true;
export const expoGo = isExpoGo(Constants as { executionEnvironment?: string; appOwnership?: string | null });

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getPermission(): Promise<PermissionStatus | null> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : (p.status as PermissionStatus);
  } catch {
    return null;
  }
}

export async function requestPermission(): Promise<PermissionStatus | null> {
  try {
    const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    return p.granted ? 'granted' : (p.status as PermissionStatus);
  } catch {
    return null;
  }
}

/** Android channels "messages" and "events" (names in the user's language). */
export async function setupChannels(names: { messages: string; events: string }) {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('messages', {
      name: names.messages,
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#C2410C',
    });
    await Notifications.setNotificationChannelAsync('events', {
      name: names.events,
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      lightColor: '#C2410C',
    });
  } catch {
    /* older Android / no support: the default channel is used */
  }
}

/**
 * While the app is open the system banner is never shown: `onForeground` decides whether our own
 * in-app banner appears (not when that chat is already on screen).
 */
export function setForegroundHandler(onForeground: (title: string, body: string, data: NotificationData) => void) {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const c = n.request.content;
      onForeground(c.title ?? '', c.body ?? '', c.data as NotificationData);
      return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: true };
    },
  });
  return () => Notifications.setNotificationHandler(null);
}

/** Taps on notifications (also the one that started the app). */
export interface Tap { id: string; data: NotificationData }
const toTap = (r: Notifications.NotificationResponse): Tap => ({
  id: `${r.notification.request.identifier}|${r.notification.date}`,
  data: r.notification.request.content.data as NotificationData,
});

export function onTap(fn: (tap: Tap) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => fn(toTap(r)));
  return () => sub.remove();
}

export function takeLaunchTap(): Tap | null {
  try {
    const r = Notifications.getLastNotificationResponse();
    if (!r) return null;
    Notifications.clearLastNotificationResponse();
    return toTap(r);
  } catch {
    return null;
  }
}

/** Expo push token, or null in Expo Go, on a simulator, or without permission. */
export async function getPushToken(): Promise<string | null> {
  if (expoGo || !Device.isDevice) return null;
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

export const pushPlatform = (Platform.OS === 'ios' ? 'ios' : 'android') as 'ios' | 'android';

export async function setBadge(n: number) {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, n));
  } catch {
    /* not supported */
  }
}

// ---------- local event reminders ----------

export async function listReminders(): Promise<ScheduledReminder[]> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all
    .filter((r) => isReminderId(r.identifier))
    .map((r) => {
      const fireAt = Number((r.content.data as { fireAt?: unknown } | null)?.fireAt);
      return { id: r.identifier, fireAt: Number.isFinite(fireAt) ? fireAt : null, title: r.content.title, body: r.content.body };
    });
}

export async function cancelReminder(id: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* already gone */
  }
}

export async function scheduleReminder(p: PlannedReminder) {
  await Notifications.scheduleNotificationAsync({
    identifier: p.id,
    content: { title: p.title, body: p.body, data: { ...p.data, fireAt: p.fireAt }, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.fireAt, channelId: 'events' },
  });
}
