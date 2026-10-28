import type { PublicUser } from './types';

/**
 * "Mesaj yaz" on a public profile calls this. Until chat exists it is null and the button shows
 * "Messages are coming soon". The chat builder sets it once at start-up, e.g.:
 *   setSendMessageHandler(async (u) => { const c = await api.startDm(u.id); router.push(`/chat/${c.id}`); });
 */
let handler: ((user: PublicUser) => void | Promise<void>) | null = null;

export function setSendMessageHandler(fn: typeof handler) {
  handler = fn;
}

export function getSendMessageHandler() {
  return handler;
}
