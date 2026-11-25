import { and, eq, inArray } from 'drizzle-orm';
import { notificationSettings, pushTokens } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { AppConfig } from '../config.js';
import { appBadges } from './badges.js';

/**
 * Phone notifications through the Expo push service (free; https://docs.expo.dev/push-notifications/sending-notifications/).
 *
 * - Fire-and-forget: routes call `background()` after their database work is committed and never wait for it.
 * - Batches of at most 100 notifications per request (Expo's limit).
 * - Respects the user's notification settings and coalesces chat notifications (1 per chat per person per 30 s).
 * - `DeviceNotRegistered` (app removed, permission revoked) in a ticket or a later receipt deletes that token.
 * - Logs only counts, HTTP statuses and Expo error codes: never tokens, never message text.
 */

export type PushCategory = 'messages' | 'friends' | 'clans' | 'events' | 'social';
/** Android notification channels created by the app. */
export type PushChannel = 'messages' | 'events';
export type PushLocale = 'az' | 'en';

export interface Notice {
  /** Which setting switch controls it. */
  category: PushCategory;
  channelId: PushChannel;
  /** Title and body in the phone's language. */
  text: (locale: PushLocale) => { title: string; body: string };
  /** Sent to the app as `notification.request.content.data` (tap routing). */
  data: Record<string, string>;
  /** At most one notification per recipient per key within the coalesce window. */
  coalesceKey?: string;
  /** Window for this key (ms); default = the chat window (30 s). */
  coalesceMs?: number;
}

interface Log {
  warn: (obj: object, msg: string) => void;
  info?: (obj: object, msg: string) => void;
}

export interface PushOptions {
  db: Db;
  config: AppConfig['push'];
  log: Log;
  fetch?: typeof fetch;
}

export const PUSH_BATCH = 100;
const RECEIPT_BATCH = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Receipts Expo has not produced yet are asked for again, but not forever. */
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const BODY_MAX = 120;

/** Expo push token as returned by getExpoPushTokenAsync: ExponentPushToken[...] (ExpoPushToken[...] is the newer spelling). */
export const PUSH_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]$/;

/** Cut to `max` characters (whole characters, so emoji are never split), adding "…" when cut. */
export function truncate(s: string, max = BODY_MAX): string {
  const chars = Array.from(s.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

export function createPush(o: PushOptions) {
  const doFetch = o.fetch ?? fetch;
  const { db, config, log } = o;
  const pending = new Set<Promise<void>>();
  /** "userId|key" -> when the last chat notification went out */
  const lastSent = new Map<string, { at: number; window: number }>();
  /** ticket id -> token + when it was queued */
  const receipts = new Map<string, { token: string; at: number }>();
  let receiptTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const headers = () => {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (config.accessToken) h.authorization = `Bearer ${config.accessToken}`;
    return h;
  };

  async function post(path: string, body: unknown) {
    return doFetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function forgetToken(token: string) {
    await db.delete(pushTokens).where(eq(pushTokens.token, token));
  }

  /** Users (of `ids`) who did not switch this category off. */
  async function allowed(ids: string[], category: PushCategory) {
    if (!ids.length) return ids;
    const col = notificationSettings[category];
    const off = await db
      .select({ id: notificationSettings.userId })
      .from(notificationSettings)
      .where(and(inArray(notificationSettings.userId, ids), eq(col, false)));
    const offSet = new Set(off.map((r) => r.id));
    return ids.filter((id) => !offSet.has(id));
  }

  /** Synchronous check-and-mark, so two messages at the same moment can't both pass. */
  function coalesce(ids: string[], key: string, windowMs: number) {
    const now = Date.now();
    if (lastSent.size > 10_000) {
      for (const [k, v] of lastSent) if (now - v.at >= v.window) lastSent.delete(k);
    }
    return ids.filter((id) => {
      const k = `${id}|${key}`;
      const v = lastSent.get(k);
      if (v !== undefined && now - v.at < windowMs) return false;
      lastSent.set(k, { at: now, window: windowMs });
      return true;
    });
  }

  function scheduleReceipts() {
    if (receiptTimer || closed || !receipts.size) return;
    receiptTimer = setTimeout(() => {
      receiptTimer = null;
      background(() => checkReceipts());
    }, config.receiptDelayMs);
    receiptTimer.unref?.();
  }

  type Ticket = { status?: string; id?: string; details?: { error?: string } };

  async function sendBatch(msgs: { to: string }[]) {
    let res: Response;
    try {
      res = await post('/--/api/v2/push/send', msgs);
    } catch (err) {
      log.warn({ count: msgs.length, error: (err as Error)?.name ?? 'Error' }, 'push: send request failed');
      return;
    }
    let json = null as { data?: Ticket[]; errors?: { code?: string }[] } | null;
    try {
      json = (await res.json()) as { data?: Ticket[]; errors?: { code?: string }[] } | null;
    } catch {
      /* not JSON */
    }
    if (!res.ok || !json || !Array.isArray(json.data)) {
      const codes = (json?.errors ?? []).map((e: { code?: string }) => e?.code).filter(Boolean);
      log.warn({ count: msgs.length, status: res.status, codes }, 'push: send rejected');
      return;
    }
    const failed: Record<string, number> = {};
    const now = Date.now();
    for (let i = 0; i < json.data.length && i < msgs.length; i++) {
      const t: Ticket | undefined = json.data[i];
      if (t?.status === 'ok' && typeof t.id === 'string') {
        receipts.set(t.id, { token: msgs[i].to, at: now });
      } else if (t?.status === 'error') {
        const code = t.details?.error ?? 'unknown';
        failed[code] = (failed[code] ?? 0) + 1;
        if (code === 'DeviceNotRegistered') await forgetToken(msgs[i].to);
      }
    }
    if (Object.keys(failed).length) log.warn({ failed }, 'push: some notifications were not accepted');
    scheduleReceipts();
  }

  /**
   * Send one notice to these users' phones. Settings and coalescing are applied here; the caller has
   * already left out the sender, blocks and mutes. Await only from background work.
   */
  async function send(userIds: string[], n: Notice) {
    let ids = [...new Set(userIds.filter(Boolean))];
    ids = await allowed(ids, n.category);
    if (n.coalesceKey) ids = coalesce(ids, n.coalesceKey, n.coalesceMs ?? config.coalesceMs);
    if (!ids.length) return;
    const tokens = await db
      .select({ userId: pushTokens.userId, token: pushTokens.token, platform: pushTokens.platform, locale: pushTokens.locale })
      .from(pushTokens)
      .where(inArray(pushTokens.userId, ids));
    if (!tokens.length) return;
    // one query for every recipient's app icon number
    const badges = await appBadges(db, tokens.map((t) => t.userId)).catch(() => new Map<string, number>());
    const texts = new Map<PushLocale, { title: string; body: string }>();
    const textFor = (l: PushLocale) => {
      let v = texts.get(l);
      if (!v) texts.set(l, (v = n.text(l)));
      return v;
    };
    const msgs = tokens.map((t) => {
      const { title, body } = textFor(t.locale);
      const badge = badges.get(t.userId);
      return {
        to: t.token,
        title: truncate(title, 80),
        body: truncate(body),
        data: n.data,
        sound: 'default' as const,
        channelId: n.channelId,
        priority: 'high' as const,
        ...(badge !== undefined ? { badge } : {}),
      };
    });
    for (let i = 0; i < msgs.length; i += PUSH_BATCH) await sendBatch(msgs.slice(i, i + PUSH_BATCH));
  }

  /** Ask Expo how the sent notifications went; delete tokens of uninstalled apps. */
  async function checkReceipts() {
    if (!receipts.size) return;
    const ids = [...receipts.keys()];
    for (let i = 0; i < ids.length; i += RECEIPT_BATCH) {
      const chunk = ids.slice(i, i + RECEIPT_BATCH);
      let json = null as { data?: Record<string, Ticket> } | null;
      try {
        const res = await post('/--/api/v2/push/getReceipts', { ids: chunk });
        json = res.ok ? ((await res.json()) as { data?: Record<string, Ticket> } | null) : null;
        if (!res.ok) log.warn({ count: chunk.length, status: res.status }, 'push: receipts request rejected');
      } catch (err) {
        log.warn({ count: chunk.length, error: (err as Error)?.name ?? 'Error' }, 'push: receipts request failed');
      }
      if (!json?.data) continue;
      const failed: Record<string, number> = {};
      const now = Date.now();
      for (const id of chunk) {
        const entry = receipts.get(id);
        const r: Ticket | undefined = json.data[id];
        if (!entry) continue;
        if (!r) {
          // not ready yet: ask again next time, unless it is very old
          if (now - entry.at > RECEIPT_MAX_AGE_MS) receipts.delete(id);
          continue;
        }
        receipts.delete(id);
        if (r.status === 'error') {
          const code = r.details?.error ?? 'unknown';
          failed[code] = (failed[code] ?? 0) + 1;
          if (code === 'DeviceNotRegistered') await forgetToken(entry.token);
        }
      }
      if (Object.keys(failed).length) log.warn({ failed }, 'push: some notifications were not delivered');
    }
    scheduleReceipts();
  }

  /** Run push work without making anyone wait for it. Errors are logged (no tokens, no text). */
  function background(fn: () => Promise<void>) {
    if (closed) return;
    const p = (async () => {
      try {
        await fn();
      } catch (err) {
        log.warn({ error: (err as Error)?.name ?? 'Error' }, 'push: background work failed');
      }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
  }

  return {
    background,
    send,
    checkReceipts,
    /** Resolves when all queued push work is done (tests, shutdown). */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
    /** Pending receipt ids (tests). */
    receiptCount: () => receipts.size,
    /** Stop timers and wait (at most 5 s) for work in flight. */
    async close() {
      closed = true;
      if (receiptTimer) clearTimeout(receiptTimer);
      receiptTimer = null;
      await Promise.race([
        (async () => {
          while (pending.size) await Promise.all([...pending]);
        })(),
        new Promise((r) => setTimeout(r, 5000).unref?.()),
      ]);
    },
  };
}

export type Push = ReturnType<typeof createPush>;
