import { ApiError } from './apiClient';
import { sameId } from './format';
import type { Badges, FriendRequest, Friendship, FriendRequestResult, Id, PublicUser } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Friends: pure helpers (no React) so the button states and list updates can be unit-tested.
 * The server decides everything; these only pick what to show.
 */

export type FriendButton =
  | { kind: 'hidden' } // my own profile
  | { kind: 'login' } // logged out: "Dost əlavə et" opens login
  | { kind: 'blocked' } // I blocked them: no friend button
  | { kind: 'add' } // "Dost əlavə et"
  | { kind: 'outgoing'; requestId: Id | null } // "Sorğu göndərildi" (tap = cancel)
  | { kind: 'incoming'; requestId: Id | null } // "Qəbul et" · "Rədd et"
  | { kind: 'friends' }; // "Dostsunuz" (unfriend in the ··· menu)

type FriendFields = Pick<PublicUser, 'id' | 'friendship' | 'requestId' | 'isBlocked'>;

/** Which friend button a public profile shows. */
export function friendButtonState(u: FriendFields, myId: Id | null | undefined): FriendButton {
  if (myId && sameId(u.id, myId)) return { kind: 'hidden' };
  if (!myId) return { kind: 'login' };
  if (u.isBlocked) return { kind: 'blocked' };
  switch (u.friendship) {
    case 'friends': return { kind: 'friends' };
    case 'outgoing': return { kind: 'outgoing', requestId: u.requestId ?? null };
    case 'incoming': return { kind: 'incoming', requestId: u.requestId ?? null };
    default: return { kind: 'add' };
  }
}

export type FriendChange =
  | { type: 'sent'; result: Pick<FriendRequestResult, 'status' | 'request'> }
  | { type: 'accepted' }
  | { type: 'declined' }
  | { type: 'cancelled' }
  | { type: 'unfriended' };

type Patchable = Pick<PublicUser, 'friendship' | 'requestId' | 'friendCount'>;

function becomeFriends<U extends Patchable>(u: U): U {
  if (u.friendship === 'friends') return u;
  return { ...u, friendship: 'friends', requestId: null, friendCount: (u.friendCount ?? 0) + 1 };
}

/** The profile after one of my friend actions succeeded. */
export function applyFriendChange<U extends Patchable>(u: U, change: FriendChange): U {
  switch (change.type) {
    case 'sent':
      if (change.result.status === 'friends') return becomeFriends(u);
      return { ...u, friendship: 'outgoing', requestId: change.result.request?.id ?? null };
    case 'accepted':
      return becomeFriends(u);
    case 'declined':
    case 'cancelled':
      return { ...u, friendship: 'none', requestId: null };
    case 'unfriended':
      if (u.friendship !== 'friends') return { ...u, friendship: 'none', requestId: null };
      return { ...u, friendship: 'none', requestId: null, friendCount: Math.max(0, (u.friendCount ?? 0) - 1) };
  }
}

/** A live socket event about this profile's person (`friend:request` from them, `friend:accepted` with them). */
export function applyFriendEvent<U extends Patchable & { id: Id }>(
  u: U,
  e: { type: 'request'; request: FriendRequest } | { type: 'accepted'; userId: Id },
): U {
  if (e.type === 'request') {
    if (!sameId(e.request.from.id, u.id) || u.friendship === 'friends') return u;
    return { ...u, friendship: 'incoming' as Friendship, requestId: e.request.id };
  }
  return sameId(e.userId, u.id) ? becomeFriends(u) : u;
}

/** Newest first, no duplicates. */
export function addRequest(list: FriendRequest[], r: FriendRequest): FriendRequest[] {
  const rest = list.filter((x) => !sameId(x.id, r.id));
  return [r, ...rest].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function removeRequest(list: FriendRequest[], id: Id): FriendRequest[] {
  return list.filter((x) => !sameId(x.id, id));
}

/** Local friend-list filter (the list is loaded whole; up to 1000). Case- and ı/i-insensitive. */
export function filterByName<X extends { user: { displayName: string } }>(list: X[], q: string): X[] {
  const needle = fold(q.trim());
  if (!needle) return list;
  return list.filter((x) => fold(x.user.displayName).includes(needle));
}

/** Lowercase + fold Azerbaijani/Turkish dotted/dotless i, so "ilqar" finds "İlqar" and "Ilqar". */
export function fold(s: string): string {
  return s.toLowerCase().replace(/̇/g, '').replace(/ı/g, 'i').normalize('NFC');
}

/** Söhbət tab badge: unread messages + clan invites. */
export function chatBadgeTotal(b: Pick<Badges, 'messages' | 'clanInvites'> | null | undefined): number {
  if (!b) return 0;
  return Math.max(0, b.messages || 0) + Math.max(0, b.clanInvites || 0);
}

/** Friend action errors → short sentence. Match the server's sentences (routes/friends.ts). */
export function friendErrorMessage(e: unknown, t: T, fallback: (e: unknown) => string): string {
  if (e instanceof ApiError) {
    const m = e.message;
    if (e.code === 'CONFLICT') {
      if (/declined your request recently/i.test(m)) return t('friends.errors.cooldown');
      if (/already friends/i.test(m)) return t('friends.errors.alreadyFriends');
      if (/already sent/i.test(m)) return t('friends.errors.alreadySent');
      if (/pending friend requests/i.test(m)) return t('friends.errors.tooManyPending');
      if (/friends/i.test(m)) return t('friends.errors.friendLimit');
      return t('friends.errors.changed');
    }
    if (e.code === 'FORBIDDEN') return t('friends.errors.blocked');
    if (e.code === 'NOT_FOUND') return t('friends.errors.gone');
    if (e.code === 'RATE_LIMITED') return t('friends.errors.rateLimited');
  }
  return fallback(e);
}
