import { canDeleteMessage, canInviteUser, canPinMessage, canRemoveMember, clanPermissions, memberActions, roleBadgeKey } from '../permissions';

describe('clan permissions', () => {
  it('leader does everything; officers manage requests, invites and pins; members nothing', () => {
    expect(clanPermissions('leader')).toEqual({ manageRequests: true, invite: true, edit: true, changeRoles: true, handOver: true, pin: true });
    expect(clanPermissions('officer')).toEqual({ manageRequests: true, invite: true, edit: false, changeRoles: false, handOver: false, pin: true });
    expect(clanPermissions('member').manageRequests).toBe(false);
    expect(clanPermissions('pending').invite).toBe(false);
    expect(clanPermissions(null).pin).toBe(false);
  });
  it('officers remove members only; leader removes officers too; nobody removes the leader or themselves', () => {
    expect(canRemoveMember('officer', 'member', false)).toBe(true);
    expect(canRemoveMember('officer', 'officer', false)).toBe(false);
    expect(canRemoveMember('officer', 'leader', false)).toBe(false);
    expect(canRemoveMember('leader', 'officer', false)).toBe(true);
    expect(canRemoveMember('leader', 'leader', true)).toBe(false);
    expect(canRemoveMember('member', 'member', false)).toBe(false);
  });
  it('member sheet actions per role', () => {
    expect(memberActions('leader', 'member', false)).toEqual(['profile', 'promote', 'makeLeader', 'remove']);
    expect(memberActions('leader', 'officer', false)).toEqual(['profile', 'demote', 'makeLeader', 'remove']);
    expect(memberActions('officer', 'member', false)).toEqual(['profile', 'remove']);
    expect(memberActions('officer', 'officer', false)).toEqual(['profile']);
    expect(memberActions('officer', 'leader', false)).toEqual(['profile']);
    expect(memberActions('member', 'member', false)).toEqual(['profile']);
    expect(memberActions('leader', 'leader', true)).toEqual(['profile']);
  });
  it('role badges', () => {
    expect(roleBadgeKey('leader')).toBe('clan.leader');
    expect(roleBadgeKey('officer')).toBe('clan.officer');
    expect(roleBadgeKey('member')).toBeNull();
  });
});

describe('invite button on a profile', () => {
  const target = { id: 'u2', clan: null, isBlocked: false };
  it('shows for leader/officer when the target is clanless and not blocked', () => {
    expect(canInviteUser({ role: 'leader' }, target, 'u1')).toBe(true);
    expect(canInviteUser({ role: 'officer' }, target, 'u1')).toBe(true);
  });
  it('hides otherwise', () => {
    expect(canInviteUser({ role: 'member' }, target, 'u1')).toBe(false);
    expect(canInviteUser(null, target, 'u1')).toBe(false);
    expect(canInviteUser({ role: 'leader' }, { ...target, id: 'u1' }, 'u1')).toBe(false);
    expect(canInviteUser({ role: 'leader' }, { ...target, clan: { id: 'c', name: 'X', tag: 'X', logoUrl: null, role: 'member' } }, 'u1')).toBe(false);
    expect(canInviteUser({ role: 'leader' }, { ...target, isBlocked: true }, 'u1')).toBe(false);
    expect(canInviteUser({ role: 'leader' }, target, null)).toBe(false);
  });
});

describe('message delete / pin', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const mine = { type: 'user' as const, sender: { id: 'u1', displayName: 'Me', avatarUrl: null }, createdAt: '2026-10-29T11:00:00Z', deletedAt: null };
  it('own user messages within 24 h only', () => {
    expect(canDeleteMessage(mine, 'u1', { now })).toBe(true);
    expect(canDeleteMessage({ ...mine, createdAt: '2026-10-28T11:59:00Z' }, 'u1', { now })).toBe(false);
    expect(canDeleteMessage(mine, 'u2', { now })).toBe(false);
    expect(canDeleteMessage({ ...mine, deletedAt: '2026-10-29T11:30:00Z' }, 'u1', { now })).toBe(false);
    expect(canDeleteMessage({ ...mine, type: 'system' as const, sender: null }, 'u1', { now })).toBe(false);
    expect(canDeleteMessage(mine, 'u1', { now, readOnly: true })).toBe(false);
    expect(canDeleteMessage({ ...mine, status: 'sending' }, 'u1', { now })).toBe(false);
  });
  it('pin follows the conversation flag and never deleted/unsent messages', () => {
    const m = { id: 'm1', deletedAt: null };
    expect(canPinMessage({ canPin: true, readOnly: false }, m)).toBe(true);
    expect(canPinMessage({ canPin: false }, m)).toBe(false);
    expect(canPinMessage({ canPin: true, readOnly: true }, m)).toBe(false);
    expect(canPinMessage({ canPin: true }, { ...m, deletedAt: 'x' })).toBe(false);
    expect(canPinMessage({ canPin: true }, { id: 'local:abc', deletedAt: null })).toBe(false);
    expect(canPinMessage(null, m)).toBe(false);
  });
});
