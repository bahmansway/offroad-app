import {
  applyConversationUpdate, badgeText, buildRows, dayLabel, dropPending, isLocal, markReadLocal, mergeLatestPage,
  mergeMessages, newClientId, oldestId, pendingMessage, previewText, setStatus, sortConversations, totalUnread,
  type ChatItem,
} from '../chatLogic';
import type { Conversation, Message } from '../types';

const me = { id: 'u1', displayName: 'Me', avatarUrl: null };
const other = { id: 'u2', displayName: 'Rauf', avatarUrl: null };

function msg(id: string, at: string, sender = other, clientId: string | null = null, text = `t-${id}`): Message {
  return { id, conversationId: 'c1', sender, text, createdAt: at, clientId };
}

function conv(id: string, p: Partial<Conversation> = {}): Conversation {
  return {
    id, type: 'dm', title: id, avatarUrl: null, clanId: null, otherUser: null, lastMessage: null,
    unreadCount: 0, updatedAt: '2026-10-28T10:00:00.000Z', ...p,
  };
}

describe('mergeMessages', () => {
  it('dedupes the same message delivered by socket, poll and page', () => {
    const a = msg('m1', '2026-10-28T10:00:00.000Z');
    const b = msg('m2', '2026-10-28T10:01:00.000Z');
    let items: ChatItem[] = mergeMessages([], [a]);
    items = mergeMessages(items, [a, b]); // poll
    items = mergeMessages(items, [b]); // socket
    expect(items.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('sorts by time even when an older page arrives later', () => {
    const items = mergeMessages([msg('m3', '2026-10-28T10:03:00.000Z')], [msg('m1', '2026-10-28T10:01:00.000Z'), msg('m2', '2026-10-28T10:02:00.000Z')]);
    expect(items.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('replaces the optimistic message by clientId (POST answer)', () => {
    const p = pendingMessage({ conversationId: 'c1', text: 'hi', clientId: 'cid1', me });
    expect(isLocal(p)).toBe(true);
    const server = msg('m9', '2026-10-28T10:05:00.000Z', me, 'cid1', 'hi');
    const items = mergeMessages([p], [server]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('m9');
    expect(items[0].status).toBeUndefined();
  });

  it('replaces the optimistic message when the socket echo comes before the POST answer, and the late answer adds nothing', () => {
    const p = pendingMessage({ conversationId: 'c1', text: 'hi', clientId: 'cid1', me });
    const server = msg('m9', '2026-10-28T10:05:00.000Z', me, 'cid1', 'hi');
    let items = mergeMessages([p], [server]); // socket first
    items = mergeMessages(items, [server]); // then POST 201 (or 200 on a retry)
    expect(items.map((m) => m.id)).toEqual(['m9']);
  });

  it('does not match another sender who used the same clientId', () => {
    const p = pendingMessage({ conversationId: 'c1', text: 'hi', clientId: 'same', me });
    const theirs = msg('m5', '2026-10-28T10:00:00.000Z', other, 'same');
    const items = mergeMessages([p], [theirs]);
    expect(items.map((m) => m.id)).toEqual(['m5', 'local:same']);
  });

  it('keeps pending/failed messages at the bottom in send order', () => {
    const p1 = pendingMessage({ conversationId: 'c1', text: 'a', clientId: 'a', me, now: new Date('2026-10-28T09:00:00Z') });
    const p2 = pendingMessage({ conversationId: 'c1', text: 'b', clientId: 'b', me, now: new Date('2026-10-28T09:00:01Z') });
    const items = mergeMessages([p1, p2], [msg('m1', '2026-10-28T10:00:00.000Z')]);
    expect(items.map((m) => m.id)).toEqual(['m1', 'local:a', 'local:b']);
  });

  it('failed → retry → confirmed', () => {
    const p = pendingMessage({ conversationId: 'c1', text: 'hi', clientId: 'x', me });
    let items: ChatItem[] = setStatus([p], 'x', 'failed');
    expect(items[0].status).toBe('failed');
    items = setStatus(items, 'x', 'sending');
    expect(items[0].status).toBe('sending');
    items = mergeMessages(items, [msg('m1', '2026-10-28T10:00:00.000Z', me, 'x', 'hi')]);
    expect(items).toEqual([expect.objectContaining({ id: 'm1' })]);
  });

  it('dropPending removes only that optimistic message', () => {
    const a = pendingMessage({ conversationId: 'c1', text: 'a', clientId: 'a', me });
    const b = pendingMessage({ conversationId: 'c1', text: 'b', clientId: 'b', me });
    expect(dropPending([a, b], 'a').map((m) => m.clientId)).toEqual(['b']);
  });

  it('oldestId skips optimistic messages', () => {
    const p = pendingMessage({ conversationId: 'c1', text: 'a', clientId: 'a', me });
    expect(oldestId([p])).toBeUndefined();
    expect(oldestId(mergeMessages([p], [msg('m1', '2026-10-28T10:00:00.000Z')]))).toBe('m1');
  });

  it('newClientId is unique and at most 64 chars', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newClientId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe('mergeLatestPage', () => {
  it('merges an overlapping newest page', () => {
    const cur = mergeMessages([], [msg('m1', '2026-10-28T10:00:00.000Z'), msg('m2', '2026-10-28T10:01:00.000Z')]);
    const out = mergeLatestPage(cur, { items: [msg('m2', '2026-10-28T10:01:00.000Z'), msg('m3', '2026-10-28T10:02:00.000Z')], hasMore: true });
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('starts over when a long offline gap means the page does not touch what we have', () => {
    const p = pendingMessage({ conversationId: 'c1', text: 'x', clientId: 'x', me });
    const cur = mergeMessages([p], [msg('m1', '2026-10-28T10:00:00.000Z')]);
    const out = mergeLatestPage(cur, { items: [msg('m80', '2026-10-28T12:00:00.000Z'), msg('m81', '2026-10-28T12:01:00.000Z')], hasMore: true });
    expect(out.map((m) => m.id)).toEqual(['m80', 'm81', 'local:x']);
  });
});

describe('unread counting', () => {
  const last = msg('m1', '2026-10-28T10:00:00.000Z');
  const base = [conv('a', { unreadCount: 2, lastMessage: last }), conv('b', { unreadCount: 0 })];

  it('totals unread and formats the badge', () => {
    expect(totalUnread(base)).toBe(2);
    expect(totalUnread(null)).toBe(0);
    expect(badgeText(0)).toBeUndefined();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(150)).toBe('99+');
  });

  it('counts a new message from someone else once', () => {
    const u = { id: 'a', lastMessage: msg('m2', '2026-10-28T10:05:00.000Z'), updatedAt: '2026-10-28T10:05:00.000Z' };
    const r1 = applyConversationUpdate(base, u, { myId: 'u1', openId: null });
    expect(r1.known).toBe(true);
    expect(r1.list.find((c) => c.id === 'a')!.unreadCount).toBe(3);
    // same event again (socket + poll) → no double count
    const r2 = applyConversationUpdate(r1.list, u, { myId: 'u1', openId: null });
    expect(r2.list.find((c) => c.id === 'a')!.unreadCount).toBe(3);
  });

  it('does not count my own messages', () => {
    const u = { id: 'b', lastMessage: msg('m3', '2026-10-28T10:06:00.000Z', me), updatedAt: '2026-10-28T10:06:00.000Z' };
    const r = applyConversationUpdate(base, u, { myId: 'u1', openId: null });
    expect(r.list.find((c) => c.id === 'b')!.unreadCount).toBe(0);
    expect(r.list.find((c) => c.id === 'b')!.lastMessage!.id).toBe('m3');
  });

  it('keeps unread at 0 for the chat that is open', () => {
    const u = { id: 'a', lastMessage: msg('m2', '2026-10-28T10:05:00.000Z'), updatedAt: '2026-10-28T10:05:00.000Z' };
    const r = applyConversationUpdate(base, u, { myId: 'u1', openId: 'a' });
    expect(r.list.find((c) => c.id === 'a')!.unreadCount).toBe(0);
  });

  it('ignores an older out-of-order update', () => {
    const list = [conv('a', { unreadCount: 1, lastMessage: msg('m5', '2026-10-28T11:00:00.000Z') })];
    const u = { id: 'a', lastMessage: msg('m4', '2026-10-28T10:59:00.000Z'), updatedAt: '2026-10-28T10:59:00.000Z' };
    const r = applyConversationUpdate(list, u, { myId: 'u1', openId: null });
    expect(r.list[0].unreadCount).toBe(1);
    expect(r.list[0].lastMessage!.id).toBe('m5');
  });

  it('reports unknown conversations so the list reloads', () => {
    const u = { id: 'zzz', lastMessage: msg('m2', '2026-10-28T10:05:00.000Z'), updatedAt: '2026-10-28T10:05:00.000Z' };
    expect(applyConversationUpdate(base, u, { myId: 'u1', openId: null }).known).toBe(false);
  });

  it('markReadLocal zeroes one conversation', () => {
    expect(totalUnread(markReadLocal(base, 'a'))).toBe(0);
  });
});

describe('ordering and rows', () => {
  it('pins the clan chat on top, then newest first', () => {
    const list = sortConversations([
      conv('old', { updatedAt: '2026-10-01T00:00:00Z' }),
      conv('clan', { type: 'clan', updatedAt: '2026-09-01T00:00:00Z' }),
      conv('new', { updatedAt: '2026-10-20T00:00:00Z' }),
    ]);
    expect(list.map((c) => c.id)).toEqual(['clan', 'new', 'old']);
  });

  it('adds one day separator per day and groups runs', () => {
    const items = [
      msg('m1', '2026-10-27T10:00:00'),
      msg('m2', '2026-10-28T10:00:00'),
      msg('m3', '2026-10-28T10:01:00'),
      msg('m4', '2026-10-28T10:02:00', me),
    ];
    const rows = buildRows(items, 'u1');
    expect(rows.map((r) => r.kind)).toEqual(['day', 'msg', 'day', 'msg', 'msg', 'msg']);
    const m2 = rows[3] as Extract<typeof rows[number], { kind: 'msg' }>;
    const m3 = rows[4] as Extract<typeof rows[number], { kind: 'msg' }>;
    const m4 = rows[5] as Extract<typeof rows[number], { kind: 'msg' }>;
    expect([m2.firstOfRun, m2.lastOfRun, m3.firstOfRun, m3.lastOfRun]).toEqual([true, false, false, true]);
    expect(m4.mine).toBe(true);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('labels days', () => {
    const now = new Date('2026-10-28T15:00:00');
    const words = { today: 'Bu gün', yesterday: 'Dünən', months: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'] };
    expect(dayLabel('2026-10-28', now, words)).toBe('Bu gün');
    expect(dayLabel('2026-10-27', now, words)).toBe('Dünən');
    expect(dayLabel('2026-10-02', now, words)).toBe('2 okt');
    expect(dayLabel('2025-01-05', now, words)).toBe('5 yan 2025');
  });

  it('previews: "You:" for mine, sender name in clan chats', () => {
    const c1 = conv('a', { lastMessage: msg('m', '2026-10-28T10:00:00Z', me, null, 'salam') });
    expect(previewText(c1, 'u1', 'Siz')).toBe('Siz: salam');
    const c2 = conv('b', { type: 'clan', lastMessage: msg('m', '2026-10-28T10:00:00Z', other, null, 'hey\nthere') });
    expect(previewText(c2, 'u1', 'Siz')).toBe('Rauf: hey there');
  });
});

describe('row keys', () => {
  it('two senders with the same clientId get different keys; optimistic and confirmed copies share one', () => {
    const p = pendingMessage({ conversationId: 'c1', text: 'hi', clientId: 'same', me });
    const theirs = msg('m5', '2026-10-28T10:00:00.000Z', other, 'same');
    const rows = buildRows(mergeMessages([p], [theirs]), 'u1').filter((r) => r.kind === 'msg');
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    const before = buildRows([p], 'u1').find((r) => r.kind === 'msg')!.key;
    const after = buildRows(mergeMessages([p], [msg('m6', '2026-10-28T10:01:00.000Z', me, 'same', 'hi')]), 'u1').find((r) => r.kind === 'msg')!.key;
    expect(after).toBe(before);
  });
});

describe('v3: system, deleted, muted', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v3 = require('../chatLogic') as typeof import('../chatLogic');
  const sysMsg = (id: string, at: string): Message => ({
    id, conversationId: 'c1', type: 'system', sender: null, text: 'x', createdAt: at, clientId: null, systemKey: 'event.joined', systemParams: { displayName: 'A' },
  });
  it('system messages get their own row and break runs', () => {
    const rows = buildRows([
      msg('m1', '2026-10-28T10:00:00.000Z'),
      sysMsg('s1', '2026-10-28T10:00:30.000Z'),
      msg('m2', '2026-10-28T10:01:00.000Z'),
    ], 'u1');
    expect(rows.map((r) => r.kind)).toEqual(['day', 'msg', 'system', 'msg']);
    const m2 = rows[3] as Extract<typeof rows[number], { kind: 'msg' }>;
    expect(m2.firstOfRun).toBe(true);
  });
  it('mergeMessages copes with system messages (no sender)', () => {
    const items = mergeMessages([], [sysMsg('s1', '2026-10-28T10:00:00.000Z'), msg('m1', '2026-10-28T10:01:00.000Z')]);
    expect(items.map((m) => m.id)).toEqual(['s1', 'm1']);
  });
  it('applyDeleted clears text and unpins', () => {
    const items = mergeMessages([], [msg('m1', '2026-10-28T10:00:00.000Z')]);
    const out = v3.applyDeleted(items, { id: 'm1', deletedAt: '2026-10-28T11:00:00.000Z' });
    expect(out[0].text).toBe('');
    expect(out[0].deletedAt).toBe('2026-10-28T11:00:00.000Z');
    expect(v3.applyDeleted(items, { id: 'nope', deletedAt: 'x' })).toBe(items);
    const pinned = { message: msg('m1', '2026-10-28T10:00:00.000Z'), pinnedBy: 'u1', pinnedAt: null };
    expect(v3.pinnedAfterDelete(pinned, 'm1')).toBeNull();
    expect(v3.pinnedAfterDelete(pinned, 'm2')).toBe(pinned);
  });
  it('muted chats are not counted and show no badge', () => {
    const list = [conv('a', { unreadCount: 3 }), conv('b', { unreadCount: 5, muted: true })];
    expect(totalUnread(list)).toBe(3);
    expect(v3.visibleUnread(list[1])).toBe(0);
    expect(v3.unreadAfterRead(8, list[0])).toBe(5);
    expect(v3.unreadAfterRead(8, list[1])).toBe(8);
    expect(v3.patchConversation(list, 'b', { muted: false })[1].muted).toBe(false);
  });
  it('conversation updates from system messages count as unread', () => {
    const list = [conv('c1', { type: 'event' })];
    const r = applyConversationUpdate(list, { id: 'c1', lastMessage: sysMsg('s9', '2026-10-28T12:00:00.000Z'), updatedAt: '2026-10-28T12:00:00.000Z' }, { myId: 'u1', openId: null });
    expect(r.list[0].unreadCount).toBe(1);
  });
  it('preview renders system/deleted text via the callback and names the sender in event chats', () => {
    const c = conv('c1', { type: 'event', lastMessage: msg('m1', '2026-10-28T10:00:00.000Z', other, null, 'hi') });
    expect(previewText(c, 'u1', 'You')).toBe('Rauf: hi');
    const s = conv('c1', { type: 'event', lastMessage: sysMsg('s1', '2026-10-28T10:00:00.000Z') });
    expect(previewText(s, 'u1', 'You', () => 'A joined the event')).toBe('A joined the event');
  });
  it('deleted last message updates the list preview', () => {
    const list = [conv('c1', { lastMessage: msg('m1', '2026-10-28T10:00:00.000Z') })];
    const out = v3.applyDeletedToList(list, { id: 'm1', conversationId: 'c1', deletedAt: 'x' });
    expect(out[0].lastMessage?.deletedAt).toBe('x');
  });
});
