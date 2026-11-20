import type { NotificationData, PlannedReminder, ScheduledReminder } from './notificationLogic';

/** Website: no phone notifications and no local reminders (settings are still saved on the server). */

export const supported = false;
export const expoGo = false;
export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getPermission(): Promise<PermissionStatus | null> { return null; }
export async function requestPermission(): Promise<PermissionStatus | null> { return null; }
export async function setupChannels(_names: { messages: string; events: string }) {}
export function setForegroundHandler(_fn: (title: string, body: string, data: NotificationData) => void) { return () => {}; }
export function onTap(_fn: (data: NotificationData) => void) { return () => {}; }
export function takeLaunchTap(): NotificationData { return null; }
export async function getPushToken(): Promise<string | null> { return null; }
export const pushPlatform = 'android' as 'ios' | 'android';
export async function setBadge(_n: number) {}
export async function listReminders(): Promise<ScheduledReminder[]> { return []; }
export async function cancelReminder(_id: string) {}
export async function scheduleReminder(_p: PlannedReminder) {}
