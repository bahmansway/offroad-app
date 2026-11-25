import {
  addPhotos, appendPage, applyLike, captionIsLong, carouselIndex, followButtonState, isDoubleTap, movePhoto, mutualFollows,
  patchPost, photoCounter, removePost, replaceWithFirstPage, setRowFollowing, shareUrl, shouldLoadMore, showPhotoDots,
  timeAgo, uploadProgress, applyFollowState, followErrorKey,
} from '../postsLogic';
import { navApps, navUrl, parseNavPref } from '../navigateLogic';
import { clampHeight, computeSnaps, filterPopoverMaxHeight, isSheetDrag, sheetLink, snapAfterDrag, snapAfterLink } from '../sheetLogic';
import { applyPinDiff, diffPins, isEmptyDiff, pinsGeoJson, toPinPoint, type PinPoint } from '../mapData';
import { parseMapMessage } from '../../components/map/shared';
import { safeJson, PIN_LAYERS_JS } from '../../components/map/pinLayers';
import { routeForNotification } from '../notificationLogic';
import { translate } from '../i18n';
import type { FollowListItem, Post, PublicUser } from '../types';

const post = (id: string, extra: Partial<Post> = {}): Post => ({
  id, author: { id: 'u1', displayName: 'A', avatarUrl: null, clan: null }, photos: [], caption: '', car: null, spot: null,
  likeCount: 0, commentCount: 0, likedByMe: false, savedByMe: false, status: 'published', createdAt: '2026-11-20T10:00:00Z', editedAt: null, ...extra,
});

describe('feed paging and merging', () => {
  it('appends a page and skips posts already in the list', () => {
    const a = [post('1'), post('2')];
    const out = appendPage(a, [post('2'), post('3'), post('3')]);
    expect(out.map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(appendPage(a, [])).toEqual(a);
  });
  it('refresh replaces the list with the first page (no duplicates)', () => {
    expect(replaceWithFirstPage([post('9'), post('9'), post('8')]).map((p) => p.id)).toEqual(['9', '8']);
  });
  it('asks for more only with a cursor and nothing loading or failed', () => {
    expect(shouldLoadMore({ cursor: 'c', loading: false, error: false })).toBe(true);
    expect(shouldLoadMore({ cursor: null, loading: false, error: false })).toBe(false);
    expect(shouldLoadMore({ cursor: 'c', loading: true, error: false })).toBe(false);
    expect(shouldLoadMore({ cursor: 'c', loading: false, error: true })).toBe(false);
  });
  it('patches and removes one post by id', () => {
    const l = [post('1'), post('2')];
    expect(patchPost(l, '2', { savedByMe: true })[1].savedByMe).toBe(true);
    expect(patchPost(l, 'x', { savedByMe: true })).toBe(l);
    expect(removePost(l, '1').map((p) => p.id)).toEqual(['2']);
  });
  it('optimistic like never goes below 0 and is idempotent', () => {
    expect(applyLike({ likeCount: 3, likedByMe: false }, true)).toEqual({ likeCount: 4, likedByMe: true });
    expect(applyLike({ likeCount: 4, likedByMe: true }, true)).toEqual({ likeCount: 4, likedByMe: true });
    expect(applyLike({ likeCount: 0, likedByMe: true }, false)).toEqual({ likeCount: 0, likedByMe: false });
  });
});

describe('photo carousel', () => {
  it('index follows the swipe and stays in range', () => {
    expect(carouselIndex(0, 358, 3)).toBe(0);
    expect(carouselIndex(358, 358, 3)).toBe(1);
    expect(carouselIndex(540, 358, 3)).toBe(2);
    expect(carouselIndex(5000, 358, 3)).toBe(2);
    expect(carouselIndex(-40, 358, 3)).toBe(0);
    expect(carouselIndex(300, 0, 3)).toBe(0);
    expect(carouselIndex(358, 358, 1)).toBe(0);
  });
  it('dots and counter only for more than one photo', () => {
    expect(showPhotoDots(1)).toBe(false);
    expect(showPhotoDots(3)).toBe(true);
    expect(photoCounter(0, 3)).toBe('1/3');
    expect(photoCounter(7, 3)).toBe('3/3');
  });
  it('detects a double tap', () => {
    expect(isDoubleTap(null, { at: 100, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap({ at: 100, x: 10, y: 10 }, { at: 300, x: 20, y: 15 })).toBe(true);
    expect(isDoubleTap({ at: 100, x: 10, y: 10 }, { at: 500, x: 10, y: 10 })).toBe(false);
    expect(isDoubleTap({ at: 100, x: 10, y: 10 }, { at: 200, x: 200, y: 10 })).toBe(false);
  });
  it('long captions get "more"', () => {
    expect(captionIsLong('short')).toBe(false);
    expect(captionIsLong('x'.repeat(120))).toBe(true);
    expect(captionIsLong('a\nb\nc')).toBe(true);
  });
});

describe('create post helpers', () => {
  it('reorders photos (first = cover) and caps at 6', () => {
    expect(movePhoto(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(movePhoto(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(addPhotos(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'])).toHaveLength(6);
  });
  it('progress counts the photos and the publish step', () => {
    expect(uploadProgress(0, 3, false)).toBe(0);
    expect(uploadProgress(3, 3, false)).toBe(0.75);
    expect(uploadProgress(3, 3, true)).toBe(1);
  });
  it('builds share links', () => {
    expect(shareUrl('post', 'ab-1', 'https://x.app/')).toBe('https://x.app/p/ab-1');
    expect(shareUrl('spot', '5', 'https://x.app')).toBe('https://x.app/spot/5');
    expect(shareUrl('event', 'e/1', 'https://x.app')).toBe('https://x.app/event/e%2F1');
  });
  it('time ago in both languages', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    const en = (k: string, p?: Record<string, string | number>) => translate('en', k, p);
    const az = (k: string, p?: Record<string, string | number>) => translate('az', k, p);
    expect(timeAgo('2026-11-25T11:59:40Z', en, now)).toBe('just now');
    expect(timeAgo('2026-11-25T11:55:00Z', en, now)).toBe('5 min ago');
    expect(timeAgo('2026-11-25T09:00:00Z', az, now)).toBe('3 saat əvvəl');
    expect(timeAgo('2026-11-24T11:00:00Z', en, now)).toBe('1 day ago');
    expect(timeAgo('2026-11-01T11:00:00Z', en, now)).toBe('01.11.2026');
  });
});

describe('follow button', () => {
  it('picks the right state', () => {
    expect(followButtonState({ id: 'me' }, 'me')).toEqual({ kind: 'hidden' });
    expect(followButtonState({ id: 'x', isMe: true }, 'me')).toEqual({ kind: 'hidden' });
    expect(followButtonState({ id: 'x' }, null)).toEqual({ kind: 'login' });
    expect(followButtonState({ id: 'x', isBlocked: true }, 'me')).toEqual({ kind: 'blocked' });
    expect(followButtonState({ id: 'x', isFollowing: true }, 'me')).toEqual({ kind: 'following' });
    expect(followButtonState({ id: 'x', followsMe: true }, 'me')).toEqual({ kind: 'followBack' });
    expect(followButtonState({ id: 'x' }, 'me')).toEqual({ kind: 'follow' });
  });
  it('applies the server answer and flips list rows', () => {
    const u = { id: 'x', displayName: 'X', createdAt: '', cars: [], spotCount: 0, followerCount: 1 } as PublicUser;
    expect(applyFollowState(u, { isFollowing: true, followsMe: false, followerCount: 2, followingCount: 0 })).toMatchObject({ isFollowing: true, followerCount: 2 });
    const row = (id: string, f: boolean, m: boolean): FollowListItem => ({ user: { id, displayName: id, avatarUrl: null, city: null }, isFollowing: f, followsMe: m, isMe: false, since: '' });
    expect(setRowFollowing([row('a', false, false)], 'a', true)[0].isFollowing).toBe(true);
    expect(mutualFollows([row('a', true, true), row('b', true, false)]).map((r) => r.user.id)).toEqual(['a']);
  });
  it('maps follow errors', () => {
    expect(followErrorKey(403)).toBe('follow.errors.blocked');
    expect(followErrorKey(409)).toBe('follow.errors.limit');
    expect(followErrorKey(500)).toBe('errors.generic');
  });
});

describe('navigate chooser', () => {
  it('builds the right URL per app', () => {
    expect(navUrl('waze', 40.912345678, 49.0712)).toBe('https://waze.com/ul?ll=40.912346,49.0712&navigate=yes');
    expect(navUrl('google', 40.9, 49.07)).toBe('https://www.google.com/maps/dir/?api=1&destination=40.9,49.07');
    expect(navUrl('apple', 40.9, 49.07)).toBe('http://maps.apple.com/?daddr=40.9,49.07');
    expect(navUrl('waze', NaN, 49)).toBeNull();
    expect(navUrl('google', 95, 49)).toBeNull();
  });
  it('offers Apple Maps on iOS only', () => {
    expect(navApps('ios')).toEqual(['waze', 'google', 'apple']);
    expect(navApps('android')).toEqual(['waze', 'google']);
    expect(navApps('web')).toEqual(['waze', 'google']);
  });
  it('remembered choice must still be offered on this platform', () => {
    expect(parseNavPref('waze', 'android')).toBe('waze');
    expect(parseNavPref('apple', 'android')).toBeNull();
    expect(parseNavPref('apple', 'ios')).toBe('apple');
    expect(parseNavPref('', 'ios')).toBeNull();
    expect(parseNavPref('javascript:x', 'web')).toBeNull();
  });
});

describe('Explore sheet snaps', () => {
  const s = computeSnaps(844, 120, 190);
  it('collapsed is 120 px above the tab bar, and collapsed < half < full', () => {
    expect(s.collapsed).toBe(240);
    expect(s.collapsed).toBeLessThan(s.half);
    expect(s.half).toBeLessThan(s.full);
    expect(s.full).toBe(844 - 190);
  });
  it('drag ends on the nearest snap, a flick goes one step', () => {
    expect(snapAfterDrag(s.collapsed + 30, 0, s)).toBe('collapsed');
    expect(snapAfterDrag(s.half - 20, 0, s)).toBe('half');
    expect(snapAfterDrag(s.collapsed + 30, -1.2, s)).toBe('half');
    expect(snapAfterDrag(s.half + 10, -1.2, s)).toBe('full');
    expect(snapAfterDrag(s.full, -1.2, s)).toBe('full');
    expect(snapAfterDrag(s.half - 10, 1.2, s)).toBe('collapsed');
    expect(snapAfterDrag(s.collapsed, 1.2, s)).toBe('collapsed');
  });
  it('clamps, recognises drags and keeps the link in step with the snap', () => {
    expect(clampHeight(10, s)).toBe(s.collapsed);
    expect(clampHeight(5000, s)).toBe(s.full);
    expect(isSheetDrag(1, 3)).toBe(false);
    expect(isSheetDrag(2, 12)).toBe(true);
    expect(isSheetDrag(30, 12)).toBe(false);
    expect(sheetLink('collapsed')).toBe('more');
    expect(sheetLink('half')).toBe('more');
    expect(sheetLink('full')).toBe('less');
    expect(snapAfterLink('collapsed')).toBe('half');
    expect(snapAfterLink('half')).toBe('full');
    expect(snapAfterLink('full')).toBe('collapsed');
  });
  it('filter popover always ends above the sheet', () => {
    const top = 120;
    const h = filterPopoverMaxHeight({ screenH: 844, popoverTop: top, sheetHeight: s.collapsed });
    expect(top + h).toBeLessThanOrEqual(844 - s.collapsed);
    expect(filterPopoverMaxHeight({ screenH: 300, popoverTop: 200, sheetHeight: 200 })).toBe(0);
  });
});

describe('map pin data', () => {
  const sp = (id: string, extra: object = {}) => ({ id, lat: 40, lng: 49, type: 'trail' as const, difficulty: 2, ...extra });
  it('sends only what changed', () => {
    const first = diffPins(new Map(), [sp('a'), sp('b')]);
    expect(first.diff.add.map((p) => p.id)).toEqual(['a', 'b']);
    const same = diffPins(first.next, [sp('a'), sp('b')]);
    expect(isEmptyDiff(same.diff)).toBe(true);
    const changed = diffPins(first.next, [sp('a', { difficulty: 4 }), sp('c')]);
    expect(changed.diff.update.map((p) => p.id)).toEqual(['a']);
    expect(changed.diff.add.map((p) => p.id)).toEqual(['c']);
    expect(changed.diff.remove).toEqual(['b']);
  });
  it('drops broken coordinates and odd levels', () => {
    expect(toPinPoint(sp('x', { lat: NaN }))).toBeNull();
    expect(toPinPoint(sp('x', { lng: 200 }))).toBeNull();
    expect(toPinPoint(sp('x', { difficulty: 9 }))!.l).toBe(0);
    expect(toPinPoint({ id: 'c', lat: 1, lng: 2, type: 'camp', difficulty: 3 })).toMatchObject({ k: 'camp', l: 0 });
  });
  it('500 pins: a filter change sends a small diff, and the store rebuilds the same GeoJSON', () => {
    const many = Array.from({ length: 500 }, (_, i) => sp(String(i), { lat: 40 + i / 1000, difficulty: (i % 5) + 1 }));
    const a = diffPins(new Map(), many);
    const filtered = many.filter((s) => s.difficulty <= 4);
    const b = diffPins(a.next, filtered);
    expect(b.diff.add).toHaveLength(0);
    expect(b.diff.remove).toHaveLength(100);
    const store = applyPinDiff(applyPinDiff(new Map<string, PinPoint>(), a.diff), b.diff);
    expect(pinsGeoJson(store).features).toHaveLength(400);
  });
  it('map page code is plain data-driven JS and injected JSON is script-safe', () => {
    expect(PIN_LAYERS_JS.startsWith('function(map, cfg)')).toBe(true);
    expect(PIN_LAYERS_JS).toContain("cluster: true");
    expect(PIN_LAYERS_JS).not.toMatch(/innerHTML|eval\(/);
    expect(safeJson({ id: '</script><b>' })).not.toContain('<');
    expect(JSON.parse(safeJson({ id: '</script>' }))).toEqual({ id: '</script>' });
  });
  it('accepts debounced region messages only with sane numbers', () => {
    expect(parseMapMessage('{"type":"region","lat":40,"lng":49,"zoom":8}')).toEqual({ type: 'region', lat: 40, lng: 49, zoom: 8 });
    expect(parseMapMessage('{"type":"region","lat":40,"lng":49,"zoom":99}')).toBeNull();
    expect(parseMapMessage('{"type":"region","lat":"40","lng":49,"zoom":8}')).toBeNull();
  });
});

describe('v6 notification taps', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('likes and comments open the post, follows open the profile', () => {
    expect(routeForNotification({ type: 'post_like', postId: id })).toBe(`/post/${id}`);
    expect(routeForNotification({ type: 'post_comment', postId: id, commentId: id })).toBe(`/post/${id}`);
    expect(routeForNotification({ type: 'follow', userId: id })).toBe(`/user/${id}`);
    expect(routeForNotification({ type: 'follow', userId: 'x' })).toBeNull();
  });
});

import { isThisWeekend, pickTrips, readFeedCache, startsSuggested, writeFeedCache, clearFeedCache } from '../homeLogic';
import type { EventSummary } from '../types';

describe('Home trips row and feed cache', () => {
  // Wednesday 25 Nov 2026, 12:00 Baku
  const now = new Date('2026-11-25T08:00:00Z');
  const ev = (id: string, startsAt: string, extra: Partial<EventSummary> = {}) =>
    ({ id, startsAt, status: 'scheduled', visibility: 'public', myStatus: null, title: id } as EventSummary & typeof extra) as EventSummary;
  it('knows this weekend in Baku time', () => {
    expect(isThisWeekend('2026-11-28T06:00:00Z', now)).toBe(true); // Sat
    expect(isThisWeekend('2026-11-29T15:00:00Z', now)).toBe(true); // Sun
    expect(isThisWeekend('2026-11-29T21:00:00Z', now)).toBe(false); // Mon 01:00 Baku
    expect(isThisWeekend('2026-11-26T06:00:00Z', now)).toBe(false); // Thu
  });
  it('next trip first, then weekend trips, at most 3', () => {
    const mine = [{ ...ev('m', '2026-11-27T05:00:00Z'), myStatus: 'going' as const }];
    const up = [ev('m', '2026-11-27T05:00:00Z'), ev('w1', '2026-11-28T05:00:00Z'), ev('w2', '2026-11-29T05:00:00Z'), ev('w3', '2026-11-29T06:00:00Z'), ev('later', '2026-12-05T05:00:00Z')];
    const r = pickTrips(mine, up, now);
    expect(r.map((x) => `${x.kind}:${x.event.id}`)).toEqual(['next:m', 'weekend:w1', 'weekend:w2']);
  });
  it('falls back to the next upcoming trips and skips cancelled / clan-only ones', () => {
    const up = [ev('c', '2026-12-01T05:00:00Z', {}), { ...ev('x', '2026-12-02T05:00:00Z'), status: 'cancelled' as const }, { ...ev('k', '2026-12-02T05:00:00Z'), visibility: 'clan' as const }];
    expect(pickTrips([], up, now).map((x) => `${x.kind}:${x.event.id}`)).toEqual(['soon:c']);
  });
  it('marks where suggested posts start', () => {
    const items = [{ suggested: false }, { suggested: true }, { suggested: true }];
    expect(startsSuggested(items, 0)).toBe(false);
    expect(startsSuggested(items, 1)).toBe(true);
    expect(startsSuggested(items, 2)).toBe(false);
  });
  it('keeps the first page per account only', () => {
    clearFeedCache();
    writeFeedCache('u1', [post('1')], 'c1');
    expect(readFeedCache('u1')?.items.map((p) => p.id)).toEqual(['1']);
    expect(readFeedCache('u2')).toBeNull();
    expect(readFeedCache(null)).toBeNull();
    clearFeedCache();
    expect(readFeedCache('u1')).toBeNull();
  });
});

import { activeFilterCount, tapLevel } from '../spotFilters';

describe('difficulty range taps', () => {
  it('moves the range the way the tiles show it', () => {
    expect(tapLevel([1, 5], 3)).toEqual([3, 3]);
    expect(tapLevel([3, 3], 1)).toEqual([1, 3]);
    expect(tapLevel([1, 3], 5)).toEqual([1, 5]);
    expect(tapLevel([2, 4], 2)).toEqual([3, 4]);
    expect(tapLevel([2, 4], 4)).toEqual([2, 3]);
    expect(tapLevel([1, 4], 2)).toEqual([1, 2]);
    expect(tapLevel([3, 3], 3)).toEqual([1, 5]);
    expect(activeFilterCount([1, 5])).toBe(0);
    expect(activeFilterCount([1, 3])).toBe(1);
  });
});
