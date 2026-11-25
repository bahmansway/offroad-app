import { sameId } from './format';
import type { FollowListItem, FollowState, Id, Post, PublicUser } from './types';

/**
 * v6 posts + follows: pure helpers (no React, no native modules) so the feed paging, the photo carousel
 * and the follow button can be unit-tested. The server decides everything; these only merge and pick.
 */

// ---------- paging ----------

/** Add a page to a list. Items already in the list (same id) are skipped, so a repeated page never doubles. */
export function appendPage<T extends { id: Id }>(list: T[], page: T[]): T[] {
  const have = new Set(list.map((x) => String(x.id)));
  const out = list.slice();
  for (const x of page) {
    const k = String(x.id);
    if (!have.has(k)) {
      have.add(k);
      out.push(x);
    }
  }
  return out;
}

/** Pull to refresh: the fresh first page replaces the list (the cursor starts over). Duplicates inside it are dropped. */
export function replaceWithFirstPage<T extends { id: Id }>(page: T[]): T[] {
  return appendPage([], page);
}

/** True when the list should ask for the next page (near the end, a cursor, nothing loading). */
export function shouldLoadMore(o: { cursor: string | null; loading: boolean; error: boolean }): boolean {
  return !!o.cursor && !o.loading && !o.error;
}

/** Change one post in a list (like, save, edit). Unknown id → same list. */
export function patchPost<T extends Post>(list: T[], id: Id, patch: Partial<Post>): T[] {
  let hit = false;
  const out = list.map((p) => {
    if (!sameId(p.id, id)) return p;
    hit = true;
    return { ...p, ...patch };
  });
  return hit ? out : list;
}

export function removePost<T extends { id: Id }>(list: T[], id: Id): T[] {
  return list.filter((p) => !sameId(p.id, id));
}

/** Optimistic like / unlike: the count never goes below 0 and does not move when nothing changes. */
export function applyLike(p: Pick<Post, 'likeCount' | 'likedByMe'>, liked: boolean): { likeCount: number; likedByMe: boolean } {
  if (p.likedByMe === liked) return { likeCount: p.likeCount, likedByMe: liked };
  return { likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)), likedByMe: liked };
}

// ---------- carousel ----------

/** Index of the photo shown after a swipe (offset in px, page width in px). Always inside 0…count-1. */
export function carouselIndex(offsetX: number, width: number, count: number): number {
  if (count <= 1 || !(width > 0) || !Number.isFinite(offsetX)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / width)));
}

/** Dots and the "1/3" counter only when there is more than one photo. */
export const showPhotoDots = (count: number) => count > 1;
export const photoCounter = (index: number, count: number) => `${Math.min(index, count - 1) + 1}/${count}`;

/** Two taps within 300 ms and 40 px of each other = a double tap (like). */
export const DOUBLE_TAP_MS = 300;
export function isDoubleTap(
  prev: { at: number; x: number; y: number } | null,
  now: { at: number; x: number; y: number },
): boolean {
  if (!prev) return false;
  return now.at - prev.at <= DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) <= 40;
}

/** Caption under a post card: shown in 2 lines with "more" when it is long or has line breaks. */
export function captionIsLong(caption: string): boolean {
  return caption.length > 90 || caption.split('\n').length > 2;
}

// ---------- create post ----------

export const MAX_POST_PHOTOS = 6;
export const MAX_CAPTION = 1000;
export const MAX_COMMENT = 500;
/** Longest side of a post photo after the phone resizes it (the server does the same). */
export const POST_PHOTO_SIDE = 1440;

/** Move a picked photo to another place (cover = index 0). Out of range → same list. */
export function movePhoto<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** Add newly picked photos, keeping at most 6. */
export function addPhotos<T>(list: T[], more: T[], max = MAX_POST_PHOTOS): T[] {
  return [...list, ...more].slice(0, max);
}

/** Overall upload progress 0…1: finished photos + the publish step. */
export function uploadProgress(done: number, total: number, published: boolean): number {
  if (total <= 0) return published ? 1 : 0;
  const steps = total + 1;
  return Math.min(1, (Math.min(done, total) + (published ? 1 : 0)) / steps);
}

// ---------- time ----------

type T = (key: string, params?: Record<string, string | number>) => string;

/** "indicə", "5 dəq", "3 saat", "2 gün", else a date. */
export function timeAgo(iso: string | null | undefined, t: T, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return t('post.time.now');
  const m = Math.floor(s / 60);
  if (m < 60) return t('post.time.minutes', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('post.time.hours', { count: h });
  const days = Math.floor(h / 24);
  if (days < 7) return t('post.time.days', { count: days });
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// ---------- share links ----------

export type ShareKind = 'post' | 'spot' | 'event';

/** Public link that opens the web app: /p/:id, /spot/:id, /event/:id. */
export function shareUrl(kind: ShareKind, id: Id, base: string): string {
  const root = base.replace(/\/+$/, '');
  const path = kind === 'post' ? 'p' : kind;
  return `${root}/${path}/${encodeURIComponent(String(id))}`;
}

// ---------- follows ----------

export type FollowButton =
  | { kind: 'hidden' } // me
  | { kind: 'login' } // logged out: "İzlə" opens login
  | { kind: 'blocked' } // I blocked them: no follow button
  | { kind: 'follow' } // orange "İzlə"
  | { kind: 'followBack' } // orange "Geri izlə" (they follow me, I don't)
  | { kind: 'following' }; // grey "İzləyirsən" (tap = unfollow)

export function followButtonState(
  u: { id: Id; isFollowing?: boolean; followsMe?: boolean; isBlocked?: boolean; isMe?: boolean },
  myId: Id | null | undefined,
): FollowButton {
  if (u.isMe || (myId && sameId(u.id, myId))) return { kind: 'hidden' };
  if (!myId) return { kind: 'login' };
  if (u.isBlocked) return { kind: 'blocked' };
  if (u.isFollowing) return { kind: 'following' };
  return u.followsMe ? { kind: 'followBack' } : { kind: 'follow' };
}

/** Put a follow / unfollow answer into a public profile (counts in the answer are that user's). */
export function applyFollowState(u: PublicUser, s: FollowState): PublicUser {
  return { ...u, isFollowing: s.isFollowing, followsMe: s.followsMe, followerCount: s.followerCount, followingCount: s.followingCount };
}

/** Optimistic flip of one row in a followers / following list. */
export function setRowFollowing(list: FollowListItem[], userId: Id, isFollowing: boolean): FollowListItem[] {
  return list.map((x) => (sameId(x.user.id, userId) ? { ...x, isFollowing } : x));
}

/** "Dost" = we follow each other. From my `following` list, keep those who also follow me. */
export function mutualFollows(following: FollowListItem[]): FollowListItem[] {
  return following.filter((x) => x.isFollowing !== false && x.followsMe && !x.isMe);
}

/** Server error for a follow tap → translation key. */
export function followErrorKey(status: number | undefined): string {
  if (status === 403) return 'follow.errors.blocked';
  if (status === 409) return 'follow.errors.limit';
  if (status === 429) return 'follow.errors.rate';
  return 'errors.generic';
}
