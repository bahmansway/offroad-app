import type { ClanRole, ClanTitle, Conversation, Id, MemberRole, Message, PublicUser } from './types';
import { sameId } from './format';

/**
 * Who may do what — mirrors the server rules (SPEC-v3 §3) so the app only shows buttons that work.
 * The server still checks everything; these only decide what to show.
 */

export const DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isStaff(role: ClanRole | undefined | null): boolean {
  return role === 'leader' || role === 'officer';
}

export function isClanMember(role: ClanRole | undefined | null): boolean {
  return role === 'leader' || role === 'officer' || role === 'member';
}

/** What my role in a clan lets me do. */
export function clanPermissions(role: ClanRole | undefined | null) {
  const leader = role === 'leader';
  const staff = isStaff(role);
  return {
    /** see / approve / reject join requests */
    manageRequests: staff,
    /** invite users, see and revoke pending invites */
    invite: staff,
    /** edit, logo, delete, handover, promote/demote */
    edit: leader,
    changeRoles: leader,
    handOver: leader,
    pin: staff,
  };
}

/** Can `me` remove a member with `target` role? Leader removes officers and members; officers only members. */
export function canRemoveMember(me: ClanRole | undefined | null, target: MemberRole, isMe: boolean): boolean {
  if (isMe || target === 'leader') return false;
  if (me === 'leader') return true;
  if (me === 'officer') return target === 'member';
  return false;
}

export type MemberAction = 'profile' | 'promote' | 'demote' | 'makeLeader' | 'remove';

/** Actions in the member sheet, in display order. */
export function memberActions(me: ClanRole | undefined | null, target: MemberRole, isMe: boolean): MemberAction[] {
  const out: MemberAction[] = ['profile'];
  if (isMe) return out;
  if (me === 'leader' && target === 'member') out.push('promote');
  if (me === 'leader' && target === 'officer') out.push('demote');
  if (me === 'leader' && target !== 'leader') out.push('makeLeader');
  if (canRemoveMember(me, target, isMe)) out.push('remove');
  return out;
}

/** Badge label key for a member role ("clan.leader" / "clan.officer"); members get none. */
export function roleBadgeKey(role: MemberRole): string | null {
  return role === 'leader' ? 'clan.leader' : role === 'officer' ? 'clan.officer' : null;
}

// ---------- v4 driver titles ----------
export const ROOKIE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Display title of a clan member. The server sends `title`; when it's missing (older server) it is
 * derived the same way: leader → leader, officer → navigator, member < 30 days → rookie, else driver.
 * Permissions still use `role`.
 */
export function clanTitleOf(
  m: { role: MemberRole | string; title?: ClanTitle | null; joinedAt?: string | null },
  now: Date = new Date(),
): ClanTitle {
  if (m.title === 'leader' || m.title === 'navigator' || m.title === 'driver' || m.title === 'rookie') return m.title;
  if (m.role === 'leader') return 'leader';
  if (m.role === 'officer') return 'navigator';
  const joined = m.joinedAt ? Date.parse(m.joinedAt) : NaN;
  if (!Number.isNaN(joined) && now.getTime() - joined < ROOKIE_DAYS * DAY_MS) return 'rookie';
  return 'driver';
}

/** i18n key: "clan.titles.leader" → Karvan başçısı / Convoy leader … */
export function titleKey(title: ClanTitle): string {
  return `clan.titles.${title}`;
}

/** Badge tone per title: leader in tint, navigator stone, drivers gray, rookies forest (new growth). */
export function titleTone(title: ClanTitle): 'tint' | 'stone' | 'gray' | 'forest' {
  return title === 'leader' ? 'tint' : title === 'navigator' ? 'stone' : title === 'rookie' ? 'forest' : 'gray';
}

const TITLE_ORDER: Record<ClanTitle, number> = { leader: 0, navigator: 1, driver: 2, rookie: 3 };

/** Same order as the server: title, then points this month (high first), then join time. */
export function sortClanMembers<M extends { role: MemberRole; title?: ClanTitle; joinedAt: string; monthPoints?: number }>(
  list: M[], now: Date = new Date(),
): M[] {
  return [...list].sort((a, b) =>
    TITLE_ORDER[clanTitleOf(a, now)] - TITLE_ORDER[clanTitleOf(b, now)]
    || (b.monthPoints ?? 0) - (a.monthPoints ?? 0)
    || Date.parse(a.joinedAt) - Date.parse(b.joinedAt));
}

/**
 * Show "Invite to clan" on someone's profile: I'm leader/officer of a clan, it's not me, they're not
 * in a clan, and neither of us blocked the other (as far as the app knows).
 */
export function canInviteUser(
  myClan: { role: string } | null | undefined,
  target: Pick<PublicUser, 'id' | 'clan' | 'isBlocked'>,
  myId: Id | null | undefined,
): boolean {
  if (!myId || !myClan || sameId(target.id, myId)) return false;
  if (myClan.role !== 'leader' && myClan.role !== 'officer') return false;
  return !target.clan && !target.isBlocked;
}

/** Can I delete this message? Only my own user messages, within 24 h, not already deleted, chat not read-only. */
export function canDeleteMessage(
  m: Pick<Message, 'type' | 'sender' | 'createdAt' | 'deletedAt'> & { status?: string },
  myId: Id | null | undefined,
  opts: { readOnly?: boolean; now?: Date } = {},
): boolean {
  if (opts.readOnly || m.deletedAt || m.status || m.type === 'system' || !m.sender) return false;
  if (!sameId(m.sender.id, myId)) return false;
  const age = (opts.now ?? new Date()).getTime() - Date.parse(m.createdAt);
  return age >= -60_000 && age <= DELETE_WINDOW_MS;
}

/** Can I pin this message here? The server tells us per conversation (`canPin`); deleted/unsent ones never. */
export function canPinMessage(
  conv: Pick<Conversation, 'canPin' | 'readOnly'> | null | undefined,
  m: Pick<Message, 'deletedAt'> & { status?: string; id: Id },
): boolean {
  if (!conv?.canPin || conv.readOnly) return false;
  if (m.deletedAt || m.status || String(m.id).startsWith('local:')) return false;
  return true;
}
