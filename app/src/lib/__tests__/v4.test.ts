import { ApiError } from '../apiClient';
import {
  addRequest, applyFriendChange, applyFriendEvent, chatBadgeTotal, filterByName, fold, friendButtonState, friendErrorMessage, removeRequest,
} from '../friendsLogic';
import {
  createStaleGuard, hasResults, localConversationMatches, mergeSearch, searchQuery,
} from '../searchLogic';
import {
  addableFriends, canEditGroup, canRemoveGroupMember, groupErrorMessage, groupMemberActions, groupNameError, GROUP_MAX_PICK,
  nextAdmin, remainingSlots, togglePick,
} from '../groupLogic';
import {
  bakuMonthOf, breakdownParts, formatPoints, meBarState, monthTitle, podiumOrder, POINT_RULES, rankText, splitBoard,
} from '../leaderboardLogic';
import { clanTitleOf, sortClanMembers, titleKey, titleTone } from '../permissions';
import { systemLabelKey, systemText } from '../systemMessages';
import { translate } from '../i18n';
import { pinCss } from '../../components/map/shared';
import { bakuWeekEnd, groupByWeek } from '../eventLogic';
import type { Conversation, ConversationMember, FriendRequest, LeaderboardItem, SearchResult } from '../types';

const tAz = (k: string, p?: Record<string, string | number>) => translate('az', k, p);
const tEn = (k: string, p?: Record<string, string | number>) => translate('en', k, p);
const ref = (id: string, name = id) => ({ id, displayName: name, avatarUrl: null });

describe('friend button state', () => {
  const base = { id: 'u2', friendship: 'none' as const, requestId: null, isBlocked: false };
  it('own profile hides it, logged out asks to log in, blocked hides it', () => {
    expect(friendButtonState(base, 'u2')).toEqual({ kind: 'hidden' });
    expect(friendButtonState(base, null)).toEqual({ kind: 'login' });
    expect(friendButtonState({ ...base, isBlocked: true, friendship: 'friends' }, 'u1')).toEqual({ kind: 'blocked' });
  });
  it('maps none / outgoing / incoming / friends', () => {
    expect(friendButtonState(base, 'u1')).toEqual({ kind: 'add' });
    expect(friendButtonState({ ...base, friendship: 'outgoing', requestId: 'r1' }, 'u1')).toEqual({ kind: 'outgoing', requestId: 'r1' });
    expect(friendButtonState({ ...base, friendship: 'incoming', requestId: 'r2' }, 'u1')).toEqual({ kind: 'incoming', requestId: 'r2' });
    expect(friendButtonState({ ...base, friendship: 'friends' }, 'u1')).toEqual({ kind: 'friends' });
    // old server without the field
    expect(friendButtonState({ id: 'u2' }, 'u1')).toEqual({ kind: 'add' });
  });
  it('applies my actions', () => {
    const u = { id: 'u2', friendship: 'none' as const, requestId: null, friendCount: 3 };
    const req = { id: 'r9', from: ref('u1'), to: ref('u2'), createdAt: '2026-10-01T00:00:00Z' };
    expect(applyFriendChange(u, { type: 'sent', result: { status: 'pending', request: req } })).toMatchObject({ friendship: 'outgoing', requestId: 'r9', friendCount: 3 });
    // they had already asked me: auto-accepted
    expect(applyFriendChange(u, { type: 'sent', result: { status: 'friends', request: null } })).toMatchObject({ friendship: 'friends', friendCount: 4 });
    expect(applyFriendChange({ ...u, friendship: 'incoming', requestId: 'r1' }, { type: 'accepted' })).toMatchObject({ friendship: 'friends', requestId: null, friendCount: 4 });
    expect(applyFriendChange({ ...u, friendship: 'incoming', requestId: 'r1' }, { type: 'declined' })).toMatchObject({ friendship: 'none', requestId: null });
    expect(applyFriendChange({ ...u, friendship: 'outgoing', requestId: 'r1' }, { type: 'cancelled' })).toMatchObject({ friendship: 'none' });
    expect(applyFriendChange({ ...u, friendship: 'friends' }, { type: 'unfriended' })).toMatchObject({ friendship: 'none', friendCount: 2 });
    expect(applyFriendChange({ ...u, friendCount: 0, friendship: 'friends' }, { type: 'unfriended' }).friendCount).toBe(0);
    // accepting twice doesn't count twice
    const f = applyFriendChange(u, { type: 'accepted' });
    expect(applyFriendChange(f, { type: 'accepted' }).friendCount).toBe(4);
  });
  it('applies live events only for this person', () => {
    const u = { id: 'u2', friendship: 'none' as const, requestId: null, friendCount: 0 };
    const fromThem: FriendRequest = { id: 'r5', from: ref('u2'), to: ref('u1'), createdAt: '' };
    const fromOther: FriendRequest = { id: 'r6', from: ref('u3'), to: ref('u1'), createdAt: '' };
    expect(applyFriendEvent(u, { type: 'request', request: fromThem })).toMatchObject({ friendship: 'incoming', requestId: 'r5' });
    expect(applyFriendEvent(u, { type: 'request', request: fromOther })).toBe(u);
    expect(applyFriendEvent({ ...u, friendship: 'outgoing', requestId: 'r1' }, { type: 'accepted', userId: 'u2' })).toMatchObject({ friendship: 'friends', friendCount: 1 });
    expect(applyFriendEvent(u, { type: 'accepted', userId: 'u3' })).toBe(u);
  });
  it('keeps request lists newest first without duplicates', () => {
    const a = { id: 'a', from: ref('x'), to: ref('me'), createdAt: '2026-10-01T00:00:00Z' };
    const b = { id: 'b', from: ref('y'), to: ref('me'), createdAt: '2026-10-02T00:00:00Z' };
    expect(addRequest([a], b).map((r) => r.id)).toEqual(['b', 'a']);
    expect(addRequest([b, a], b).map((r) => r.id)).toEqual(['b', 'a']);
    expect(removeRequest([b, a], 'b').map((r) => r.id)).toEqual(['a']);
  });
  it('filters names ignoring case and dotted/dotless i', () => {
    const list = [{ user: ref('1', 'İlqar') }, { user: ref('2', 'Ilham') }, { user: ref('3', 'Rauf') }];
    expect(filterByName(list, 'il').map((x) => x.user.id)).toEqual(['1', '2']);
    expect(filterByName(list, '  ').length).toBe(3);
    expect(fold('İLQAR')).toBe('ilqar');
  });
  it('Söhbət badge adds messages and clan invites (friend requests go on Profile)', () => {
    expect(chatBadgeTotal({ messages: 3, clanInvites: 2 })).toBe(5);
    expect(chatBadgeTotal(null)).toBe(0);
    expect(chatBadgeTotal({ messages: -1, clanInvites: 1 })).toBe(1);
  });
  it('turns server errors into short sentences', () => {
    const fb = () => 'fallback';
    expect(friendErrorMessage(new ApiError(409, 'CONFLICT', 'This user declined your request recently; try again in 24 hours'), tEn, fb)).toMatch(/24 hours/);
    expect(friendErrorMessage(new ApiError(409, 'CONFLICT', 'You are already friends'), tEn, fb)).toBe(tEn('friends.errors.alreadyFriends'));
    expect(friendErrorMessage(new ApiError(409, 'CONFLICT', 'You already sent a friend request to this user'), tEn, fb)).toBe(tEn('friends.errors.alreadySent'));
    expect(friendErrorMessage(new ApiError(409, 'CONFLICT', 'At most 50 pending friend requests'), tEn, fb)).toBe(tEn('friends.errors.tooManyPending'));
    expect(friendErrorMessage(new ApiError(409, 'CONFLICT', 'At most 1000 friends'), tEn, fb)).toBe(tEn('friends.errors.friendLimit'));
    expect(friendErrorMessage(new ApiError(403, 'FORBIDDEN', 'x'), tAz, fb)).toBe(tAz('friends.errors.blocked'));
    expect(friendErrorMessage(new ApiError(404, 'NOT_FOUND', 'x'), tAz, fb)).toBe(tAz('friends.errors.gone'));
    expect(friendErrorMessage(new Error('x'), tAz, fb)).toBe('fallback');
  });
});

const conv = (id: string, title: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, type: 'dm', title, avatarUrl: null, clanId: null, otherUser: null, lastMessage: null, unreadCount: 0, updatedAt: '', ...extra,
});

describe('search', () => {
  it('sends 2–40 characters only', () => {
    expect(searchQuery('a')).toBeNull();
    expect(searchQuery('  a  ')).toBeNull();
    expect(searchQuery(' Ra ')).toBe('Ra');
    expect(searchQuery('Rauf   Ə')).toBe('Rauf Ə');
    expect(searchQuery('x'.repeat(60))).toHaveLength(40);
  });
  it('stale guard: only the newest request may write', () => {
    const g = createStaleGuard();
    const first = g.next();
    const second = g.next();
    expect(g.isLatest(first)).toBe(false);
    expect(g.isLatest(second)).toBe(true);
    g.cancel();
    expect(g.isLatest(second)).toBe(false);
  });
  it('stale guard drops an older answer that arrives last', async () => {
    const g = createStaleGuard();
    let shown = '';
    const run = (q: string, ms: number) => {
      const ticket = g.next();
      return new Promise<void>((res) => setTimeout(() => { if (g.isLatest(ticket)) shown = q; res(); }, ms));
    };
    await Promise.all([run('Ra', 30), run('Rau', 5)]);
    expect(shown).toBe('Rau');
  });
  it('matches my loaded chats locally (title or other member, ı/i-insensitive)', () => {
    const list = [conv('1', 'İlqar'), conv('2', 'Quba trip', { type: 'group' }), conv('3', 'X', { otherUser: ref('9', 'Ilham') })];
    expect(localConversationMatches(list, 'il').map((c) => c.id)).toEqual(['1', '3']);
    expect(localConversationMatches(null, 'il')).toEqual([]);
  });
  it('merges server + local chats without duplicates, friends first', () => {
    const server: SearchResult = {
      users: [{ ...ref('a', 'Anar'), city: null, isFriend: false }, { ...ref('b', 'Aydın'), city: 'Bakı', isFriend: true }],
      clans: [],
      conversations: [conv('1', 'Anar')],
    };
    const r = mergeSearch(server, [conv('1', 'Anar'), conv('7', 'Anar group', { type: 'group' })]);
    expect(r.users.map((u) => u.id)).toEqual(['b', 'a']);
    expect(r.conversations.map((c) => c.id)).toEqual(['1', '7']);
    // before the server answers, local chats still show
    expect(mergeSearch(null, [conv('7', 'g')]).conversations.map((c) => c.id)).toEqual(['7']);
    expect(hasResults(mergeSearch(null, []))).toBe(false);
  });
});

describe('group permissions', () => {
  const group = conv('g', 'G', { type: 'group', isAdmin: true });
  const notAdmin = { ...group, isAdmin: false };
  it('only the admin edits; admin removes others but not themselves', () => {
    expect(canEditGroup(group)).toBe(true);
    expect(canEditGroup(notAdmin)).toBe(false);
    expect(canEditGroup(conv('d', 'D', { isAdmin: true }))).toBe(false); // a DM is never a group
    expect(canRemoveGroupMember(group, 'u2', 'u1')).toBe(true);
    expect(canRemoveGroupMember(group, 'u1', 'u1')).toBe(false);
    expect(canRemoveGroupMember(notAdmin, 'u2', 'u1')).toBe(false);
    expect(groupMemberActions(group, 'u2', 'u1')).toEqual(['profile', 'remove']);
    expect(groupMemberActions(notAdmin, 'u2', 'u1')).toEqual(['profile']);
    expect(groupMemberActions(group, 'u1', 'u1')).toEqual([]);
  });
  it('checks names and slots', () => {
    expect(groupNameError('  ')).toBe('empty');
    expect(groupNameError('x'.repeat(41))).toBe('tooLong');
    expect(groupNameError(' Quba ')).toBeNull();
    expect(remainingSlots(18)).toBe(2);
    expect(remainingSlots(25)).toBe(0);
    expect(GROUP_MAX_PICK).toBe(19);
  });
  it('picker stops at the cap', () => {
    let s = togglePick([], 'a', 2);
    expect(s).toEqual({ selected: ['a'], full: false });
    s = togglePick(s.selected, 'b', 2);
    expect(s).toEqual({ selected: ['a', 'b'], full: true });
    expect(togglePick(s.selected, 'c', 2)).toEqual({ selected: ['a', 'b'], full: true });
    expect(togglePick(s.selected, 'a', 2)).toEqual({ selected: ['b'], full: false });
  });
  it('only friends not already in the group can be added', () => {
    const friends = [{ user: ref('a') }, { user: ref('b') }];
    const members: ConversationMember[] = [{ user: ref('a'), isAdmin: false, joinedAt: '' }];
    expect(addableFriends(friends, members).map((f) => f.user.id)).toEqual(['b']);
  });
  it('the longest-standing member becomes admin', () => {
    const m = (id: string, at: string, isAdmin = false): ConversationMember => ({ user: ref(id), isAdmin, joinedAt: at });
    const list = [m('admin', '2026-01-01T00:00:00Z', true), m('late', '2026-03-01T00:00:00Z'), m('early', '2026-02-01T00:00:00Z')];
    expect(nextAdmin(list, 'admin')?.user.id).toBe('early');
    expect(nextAdmin([list[0]], 'admin')).toBeNull();
  });
  it('maps group errors', () => {
    const fb = () => 'fb';
    expect(groupErrorMessage(new ApiError(403, 'FORBIDDEN', 'You can only add your friends to a group'), tAz, fb)).toBe(tAz('group.errors.notFriends'));
    expect(groupErrorMessage(new ApiError(403, 'FORBIDDEN', 'Only the group admin can do this'), tAz, fb)).toBe(tAz('group.errors.notAdmin'));
    expect(groupErrorMessage(new ApiError(409, 'CONFLICT', 'A group can have at most 20 members'), tAz, fb)).toBe(tAz('group.errors.full'));
    expect(groupErrorMessage(new ApiError(409, 'CONFLICT', 'They are already in this group'), tAz, fb)).toBe(tAz('group.errors.alreadyIn'));
  });
  it('translates group system messages', () => {
    const msg = (systemKey: string, systemParams: Record<string, unknown>) => ({ systemKey, systemParams, text: 'fallback' });
    expect(systemText(msg('group.created', { name: 'Quba', byDisplayName: 'Rauf' }), tAz)).toBe('Rauf "Quba" qrupunu yaratdı');
    expect(systemText(msg('group.added', { displayName: 'Anar', byDisplayName: 'Rauf' }), tEn)).toBe('Rauf added Anar');
    expect(systemText(msg('group.removed', { displayName: 'Anar', byDisplayName: 'Rauf' }), tEn)).toBe('Rauf removed Anar');
    expect(systemText(msg('group.left', { displayName: 'Anar' }), tAz)).toBe('Anar qrupdan çıxdı');
    expect(systemText(msg('group.admin', { displayName: 'Anar' }), tEn)).toBe('Anar is now the group admin');
    expect(systemText(msg('group.renamed', { name: 'Şahdağ', byDisplayName: 'Rauf' }), tEn)).toBe('Rauf renamed the group to "Şahdağ"');
    expect(systemLabelKey({ systemKey: 'group.left' })).toBe('chat.groupUpdate');
    expect(systemLabelKey({ systemKey: 'event.joined' })).toBe('chat.systemMessage');
  });
});

const item = (rank: number, id = `u${rank}`, points = 100 - rank): LeaderboardItem => ({
  rank, points, blocked: false,
  user: { ...ref(id), currentCar: null, clan: null },
  breakdown: { spots: points, events: 0, attended: 0, cars: 0, ratings: 0 },
});

describe('leaderboard', () => {
  it('splits podium and rows 4–20, podium shown 2-1-3', () => {
    const items = Array.from({ length: 22 }, (_, i) => item(i + 1));
    const { podium, rest } = splitBoard(items);
    expect(podium.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(rest.map((p) => p.rank)).toEqual(Array.from({ length: 17 }, (_, i) => i + 4));
    expect(podiumOrder(podium).map((p) => p.rank)).toEqual([2, 1, 3]);
    expect(podiumOrder([item(1)]).map((p) => p.rank)).toEqual([1]);
    expect(podiumOrder([item(2), item(1)]).map((p) => p.rank)).toEqual([2, 1]);
  });
  it('formats rank and points per language', () => {
    expect(rankText(7)).toBe('#7');
    expect(rankText(null)).toBe('—');
    expect(formatPoints(1250, 'az')).toBe('1\u00a0250');
    expect(formatPoints(1250, 'en')).toBe('1,250');
    expect(tAz('board.yourPlace', { rank: rankText(4), points: formatPoints(35, 'az') })).toBe('Sizin yeriniz: #4 · 35 xal');
  });
  it('"Sizin yeriniz" bar', () => {
    const board = { items: [item(1, 'me')], me: { rank: 1, points: 99 } };
    expect(meBarState(board, 'me')).toEqual({ kind: 'ranked', rank: 1, points: 99, inTop: true });
    expect(meBarState({ items: [], me: { rank: 25, points: 3 } }, 'me')).toEqual({ kind: 'ranked', rank: 25, points: 3, inTop: false });
    expect(meBarState({ items: [], me: { rank: null, points: 0 } }, 'me')).toEqual({ kind: 'none' });
    expect(meBarState({ items: [], me: null }, null)).toEqual({ kind: 'hidden' });
  });
  it('breakdown parts skip zeros', () => {
    expect(breakdownParts({ spots: 10, events: 0, attended: 5, cars: 0, ratings: 1 })).toEqual([
      { key: 'spots', points: 10 }, { key: 'attended', points: 5 }, { key: 'ratings', points: 1 },
    ]);
  });
  it('month title uses the Baku month', () => {
    expect(bakuMonthOf('2026-10-31T20:00:00.000Z')).toEqual({ month: 10, year: 2026 });
    expect(monthTitle('2026-10-31T20:00:00.000Z', ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'])).toBe('Noyabr 2026');
    expect(monthTitle('bad', [])).toBe('');
  });
  it('info sheet uses the final server rules', () => {
    expect(POINT_RULES).toMatchObject({
      spot: 10, spotsPerMonth: 10, spotMinAgeHours: 24, spotReportersToDrop: 2, organized: 15, organizedPerMonth: 4,
      attended: 5, attendedPerMonth: 8, minEventMinutes: 60, minCarsGoing: 2, car: 5, carsCounted: 2, rating: 1, ratingsPerMonth: 20,
    });
    const spot = tAz('board.rules.spot', { points: 10, hours: 24, max: 10, reporters: 2 });
    expect(spot).toMatch(/24 saat/);
    expect(spot).toMatch(/bir gün sonra/);
    expect(tEn('board.rules.eventRule', { minutes: 60, cars: 2 })).toMatch(/60 minutes.*2 cars/);
  });
});

describe('clan driver titles', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  it('derives titles from role and join date when the server did not send one', () => {
    expect(clanTitleOf({ role: 'leader' }, now)).toBe('leader');
    expect(clanTitleOf({ role: 'officer', joinedAt: '2026-10-28T00:00:00Z' }, now)).toBe('navigator');
    expect(clanTitleOf({ role: 'member', joinedAt: '2026-10-20T00:00:00Z' }, now)).toBe('rookie');
    expect(clanTitleOf({ role: 'member', joinedAt: '2026-09-01T00:00:00Z' }, now)).toBe('driver');
    expect(clanTitleOf({ role: 'member', title: 'rookie', joinedAt: '2020-01-01T00:00:00Z' }, now)).toBe('rookie');
  });
  it('has the az / en names and no "officer" wording left', () => {
    expect(['leader', 'navigator', 'driver', 'rookie'].map((x) => tAz(titleKey(x as never)))).toEqual(['Karvan başçısı', 'Bələdçi', 'Sürücü', 'Yeni sürücü']);
    expect(['leader', 'navigator', 'driver', 'rookie'].map((x) => tEn(titleKey(x as never)))).toEqual(['Convoy leader', 'Navigator', 'Driver', 'Rookie']);
    expect(tAz('clan.officer')).toBe('Bələdçi');
    expect(tEn('clan.promote')).toBe('Make navigator');
    const values = (o: unknown): string[] => (typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(values) : []);
    expect(values(require('../../locales/az').default).join('\n')).not.toMatch(/[Zz]abit/);
    expect(values(require('../../locales/en').default).join('\n')).not.toMatch(/[Oo]fficer/);
    expect(titleTone('leader')).toBe('tint');
    expect(titleTone('rookie')).toBe('forest');
  });
  it('sorts by title, then points, then join time', () => {
    const m = (id: string, role: 'leader' | 'officer' | 'member', joinedAt: string, monthPoints: number) => ({ user: ref(id), role, joinedAt, monthPoints });
    const list = [
      m('rookie', 'member', '2026-10-25T00:00:00Z', 50),
      m('driverLow', 'member', '2026-01-01T00:00:00Z', 5),
      m('nav', 'officer', '2026-02-01T00:00:00Z', 0),
      m('driverHigh', 'member', '2026-03-01T00:00:00Z', 30),
      m('lead', 'leader', '2026-01-01T00:00:00Z', 0),
    ];
    expect(sortClanMembers(list, now).map((x) => x.user.id)).toEqual(['lead', 'nav', 'driverHigh', 'driverLow', 'rookie']);
  });
});

describe('design-pass review fixes', () => {
  it('picked pin glyph uses onTint (readable on the dark-mode orange) and respects reduced motion', () => {
    expect(pinCss('dark')).toContain('.or-pin--picked .or-glyph{color:#1A0A00}');
    expect(pinCss('light')).toContain('.or-pin--picked .or-glyph{color:#FFFFFF}');
    expect(pinCss('light')).toMatch(/prefers-reduced-motion: reduce\)\{\.or-pin--picked\{animation:none\}/);
  });
  it('"Bu həftə" is the Baku calendar week (Mon–Sun)', () => {
    expect(tAz('events.thisWeek')).toBe('Bu həftə');
    // Thursday 29 Oct 2026, 12:00 Baku → the week ends Sunday 1 Nov 23:59 Baku (= Sun 19:59 UTC)
    const now = new Date('2026-10-29T08:00:00Z');
    const items = [
      { id: 'sun', startsAt: '2026-11-01T19:00:00Z' }, // Sun 23:00 Baku
      { id: 'mon', startsAt: '2026-11-01T20:30:00Z' }, // Mon 00:30 Baku → next week
      { id: 'tue', startsAt: '2026-11-03T08:00:00Z' }, // within 7 days but next week
    ];
    const g = groupByWeek(items, now);
    expect(g.thisWeek.map((e) => e.id)).toEqual(['sun']);
    expect(g.later.map((e) => e.id)).toEqual(['mon', 'tue']);
    // on a Sunday evening (Baku) the week ends at midnight
    const sunday = new Date('2026-11-01T15:00:00Z'); // Sun 19:00 Baku
    expect(groupByWeek(items, sunday).thisWeek.map((e) => e.id)).toEqual(['sun']);
    expect(bakuWeekEnd(sunday).toISOString()).toBe('2026-11-01T20:00:00.000Z');
  });
});
