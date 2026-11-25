import { ApiError } from './apiClient';
import { sameId } from './format';
import type { Conversation, ConversationMember, Id } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

/** A group has at most 20 members including the creator, so you can pick up to 19 friends. */
export const GROUP_MAX_MEMBERS = 20;
export const GROUP_MAX_PICK = GROUP_MAX_MEMBERS - 1;
export const GROUP_NAME_MAX = 40;

export function isGroup(c: Pick<Conversation, 'type'> | null | undefined): boolean {
  return c?.type === 'group';
}

/** 'empty' | 'tooLong' | null (ok). */
export function groupNameError(name: string): 'empty' | 'tooLong' | null {
  const n = name.trim();
  if (!n) return 'empty';
  if (n.length > GROUP_NAME_MAX) return 'tooLong';
  return null;
}

/** Rename, photo, add and remove members: the group admin only. */
export function canEditGroup(c: Pick<Conversation, 'type' | 'isAdmin'> | null | undefined): boolean {
  return isGroup(c) && !!c!.isAdmin;
}

/** The admin can remove anyone but themselves (they leave instead). */
export function canRemoveGroupMember(
  c: Pick<Conversation, 'type' | 'isAdmin'> | null | undefined, memberId: Id, myId: Id | null | undefined,
): boolean {
  return canEditGroup(c) && !!myId && !sameId(memberId, myId);
}

export type GroupMemberAction = 'profile' | 'remove';

export function groupMemberActions(
  c: Pick<Conversation, 'type' | 'isAdmin'> | null | undefined, memberId: Id, myId: Id | null | undefined,
): GroupMemberAction[] {
  if (myId && sameId(memberId, myId)) return [];
  return canRemoveGroupMember(c, memberId, myId) ? ['profile', 'remove'] : ['profile'];
}

/** Free places left in a group. */
export function remainingSlots(memberCount: number): number {
  return Math.max(0, GROUP_MAX_MEMBERS - Math.max(0, memberCount));
}

/** Tick / untick a friend in a picker; ignores the tick when `max` is reached. */
export function togglePick(selected: Id[], id: Id, max: number): { selected: Id[]; full: boolean } {
  if (selected.some((x) => sameId(x, id))) return { selected: selected.filter((x) => !sameId(x, id)), full: false };
  if (selected.length >= max) return { selected, full: true };
  return { selected: [...selected, id], full: selected.length + 1 >= max };
}

/** Friends who are not in the group yet. */
export function addableFriends<F extends { user: { id: Id } }>(friends: F[], members: Pick<ConversationMember, 'user'>[]): F[] {
  return friends.filter((f) => !members.some((m) => sameId(m.user.id, f.user.id)));
}

/** Who becomes admin when `leavingId` (the admin) leaves: the longest-standing other member. */
export function nextAdmin(members: ConversationMember[], leavingId: Id): ConversationMember | null {
  const rest = members.filter((m) => !sameId(m.user.id, leavingId));
  if (!rest.length) return null;
  return [...rest].sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))[0];
}

/** Group action errors. Match the server's sentences (routes/groups.ts). */
export function groupErrorMessage(e: unknown, t: T, fallback: (e: unknown) => string): string {
  if (e instanceof ApiError) {
    const m = e.message;
    if (e.code === 'FORBIDDEN') {
      if (/only add your friends/i.test(m)) return t('group.errors.notFriends');
      if (/follow you and whom you follow/i.test(m)) return t('group.notMutual');
      if (/admin/i.test(m)) return t('group.errors.notAdmin');
      return t('group.errors.noAccess');
    }
    if (e.code === 'CONFLICT') {
      if (/at most/i.test(m)) return t('group.errors.full');
      if (/already in/i.test(m)) return t('group.errors.alreadyIn');
      return t('group.errors.changed');
    }
    if (e.code === 'NOT_FOUND') return t('group.errors.gone');
    if (e.code === 'RATE_LIMITED') return t('group.errors.rateLimited');
  }
  return fallback(e);
}
