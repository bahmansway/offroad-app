import { Platform } from 'react-native';
import { bakuParts, bakuWeekEnd } from './eventLogic';
import { sameId } from './format';
import type { EventSummary, Id, Post } from './types';

/**
 * Home "Səfərlər" row: my next trip (going / organizer) first, then 2–3 public trips this weekend
 * (Saturday or Sunday of this Baku week); with none this weekend, the next upcoming ones ("Yaxında").
 */
export type TripKind = 'next' | 'weekend' | 'soon';
export interface TripCard { kind: TripKind; event: EventSummary }

const live = (e: EventSummary, now: Date) => e.status === 'scheduled' && new Date(e.startsAt).getTime() > now.getTime();

export function isThisWeekend(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime() || d.getTime() >= bakuWeekEnd(now).getTime()) return false;
  const wd = bakuParts(d).weekday;
  return wd === 6 || wd === 0;
}

export function pickTrips(mine: EventSummary[], upcoming: EventSummary[], now: Date = new Date(), max = 3): TripCard[] {
  const byStart = (a: EventSummary, b: EventSummary) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  const next = mine
    .filter((e) => live(e, now) && (e.myStatus === 'going' || e.myStatus === 'organizer'))
    .sort(byStart)[0];
  const out: TripCard[] = next ? [{ kind: 'next', event: next }] : [];
  const rest = upcoming.filter((e) => live(e, now) && e.visibility === 'public' && !(next && sameId(e.id, next.id))).sort(byStart);
  const weekend = rest.filter((e) => isThisWeekend(e.startsAt, now));
  const pool: TripCard[] = weekend.length
    ? weekend.map((event) => ({ kind: 'weekend' as const, event }))
    : rest.map((event) => ({ kind: 'soon' as const, event }));
  return [...out, ...pool].slice(0, max);
}

/** Where a run of "suggested" posts starts in the feed (a small header goes above it). */
export function startsSuggested(items: Pick<Post, 'suggested'>[], i: number): boolean {
  return !!items[i]?.suggested && (i === 0 || !items[i - 1]?.suggested);
}

// ---------- cached first page ----------

/**
 * The first feed page is kept per account, so Home shows it at once (switching tabs, reopening the app on the web)
 * while the fresh page loads. Memory on phones; also localStorage on the web. Never shown for another account.
 */
interface Cached { userId: Id; items: Post[]; cursor: string | null; at: number }
let memory: Cached | null = null;
/** Bumped by clearFeedCache (logout / lost session): a feed request that started before must not write. */
let cacheGen = 0;
export const feedCacheGen = () => cacheGen;
const KEY = 'offroad.feed1';

export function readFeedCache(userId: Id | null | undefined): Cached | null {
  if (!userId) return null;
  if (memory && sameId(memory.userId, userId)) return memory;
  if (Platform.OS === 'web') {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      const v = raw ? (JSON.parse(raw) as Cached) : null;
      if (v && sameId(v.userId, userId) && Array.isArray(v.items)) return (memory = v);
    } catch { /* ignore */ }
  }
  return null;
}

export function writeFeedCache(userId: Id, items: Post[], cursor: string | null, gen: number = cacheGen) {
  if (gen !== cacheGen) return; // logged out (or session lost) while this page was loading
  memory = { userId, items: items.slice(0, 20), cursor, at: Date.now() };
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(memory)); } catch { /* ignore */ }
  }
}

export function clearFeedCache() {
  cacheGen++;
  memory = null;
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ }
  }
}

// ---------- "Sürücüləri izlə" suggestions ----------

export interface Suggestion { id: Id; displayName: string; avatarUrl: string | null; why: string; isFollowing: boolean }
type Person = { id: Id; displayName: string; avatarUrl: string | null };

/**
 * Clan mates first, then this month's most active drivers. Never me, never anyone I follow already,
 * never anyone blocked either way (people I blocked, leaderboard rows marked `blocked`). At most `max`.
 */
export function pickSuggestions(o: {
  myId: Id;
  clanMates: { user: Person; why: string }[];
  board: { user: Person; blocked: boolean; why: string }[];
  followingIds: Id[];
  blockedIds: Id[];
  max?: number;
}): Suggestion[] {
  const skip = new Set([String(o.myId), ...o.followingIds.map(String), ...o.blockedIds.map(String)]);
  const out: Suggestion[] = [];
  const add = (u: Person, why: string) => {
    const k = String(u.id);
    if (skip.has(k)) return;
    skip.add(k);
    out.push({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, why, isFollowing: false });
  };
  o.clanMates.forEach((x) => add(x.user, x.why));
  o.board.filter((x) => !x.blocked).forEach((x) => add(x.user, x.why));
  return out.slice(0, o.max ?? 6);
}
