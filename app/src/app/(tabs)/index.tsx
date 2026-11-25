import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from '../../components/Brand';
import { PostCard } from '../../components/posts/PostCard';
import { ActionSheet } from '../../components/ActionSheet';
import { FollowButton } from '../../components/FollowButton';
import { photoUri } from '../../components/Rows';
import { useEventCardText } from '../../components/EventCard';
import {
  Avatar, Contour, DifficultySign, EmptyState, ErrorState, GlassView, Icon, LoadingState, MountainMark, PillButton, Txt,
  useTabBarSpace,
} from '../../components/ui';
import { api } from '../../lib/api';
import { onBeforeLogout, useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/themeContext';
import { errorMessage } from '../../lib/errors';
import { appendPage, patchPost, removeAuthor, removePost, replaceWithFirstPage, shouldLoadMore } from '../../lib/postsLogic';
import { clearFeedCache, feedCacheGen, pickSuggestions, pickTrips, readFeedCache, startsSuggested, writeFeedCache, type TripCard } from '../../lib/homeLogic';
import { bakuParts, dateBlock, formatEventWhen } from '../../lib/eventLogic';
import { formatPoints } from '../../lib/leaderboardLogic';
import { badgeText } from '../../lib/chatLogic';
import { font, radius, TAB_BAR, TAP } from '../../lib/theme';
import { sameId } from '../../lib/format';
import type { Id, Post } from '../../lib/types';

const HEADER_ROW = 50;

/** v6 "Ana səhifə": trips row + photo feed of people I follow (and suggestions while I follow < 3). */
export default function HomeScreen() {
  const { t } = useI18n();
  const { c } = useTheme();
  const { user, loading: authLoading } = useAuth();
  const chat = useChat();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const userId = user?.id ?? null;
  const cached = readFeedCache(userId);
  const [items, setItems] = useState<Post[] | null>(cached?.items ?? null);
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? null);
  const [error, setError] = useState<unknown>(null);
  const [moreError, setMoreError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [trips, setTrips] = useState<TripCard[]>([]);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const seq = useRef(0);
  /** trips + following count: only answers for the current account may land */
  const sideSeq = useRef(0);

  const loadFirst = useCallback(async () => {
    const my = ++seq.current;
    setError(null);
    setMoreError(false);
    if (!userId) { setItems(null); return; }
    const gen = feedCacheGen();
    try {
      const r = await api.feed();
      if (my !== seq.current) return;
      const list = replaceWithFirstPage(r.items);
      setItems(list);
      setCursor(r.nextCursor);
      writeFeedCache(userId, list, r.nextCursor, gen);
    } catch (e) {
      if (my === seq.current) setError(e);
    }
  }, [userId]);

  const loadTrips = useCallback(async () => {
    const my = sideSeq.current;
    try {
      const [mine, up] = await Promise.all([
        userId ? api.events({ scope: 'mine', limit: 20 }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        api.events({ scope: 'upcoming', limit: 20 }).catch(() => ({ items: [] })),
      ]);
      if (my === sideSeq.current) setTrips(pickTrips(mine.items, up.items));
    } catch { /* the row just stays empty */ }
  }, [userId]);

  // logging out forgets the cached first page
  useEffect(() => onBeforeLogout(async () => clearFeedCache()), []);

  // another account: never show the last one's feed
  useEffect(() => {
    const cc = readFeedCache(userId);
    seq.current++;
    setItems(cc?.items ?? null);
    setCursor(cc?.cursor ?? null);
    sideSeq.current++;
    setTrips([]);
    setFollowingCount(null);
  }, [userId]);

  useFocusEffect(useCallback(() => {
    loadFirst();
    loadTrips();
    if (userId) {
      const my = sideSeq.current;
      api.user(userId).then((u) => { if (my === sideSeq.current) setFollowingCount(u.followingCount ?? null); }).catch(() => {});
      chat.refreshUnread();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFirst, loadTrips, userId]));

  async function refresh() {
    setRefreshing(true);
    await Promise.all([loadFirst(), loadTrips()]);
    setRefreshing(false);
  }

  async function loadMore() {
    if (!shouldLoadMore({ cursor, loading: loadingMore, error: moreError }) || !items) return;
    const my = seq.current;
    setLoadingMore(true);
    try {
      const r = await api.feed(cursor);
      if (my !== seq.current) return;
      setItems((cur) => appendPage(cur ?? [], r.items));
      setCursor(r.nextCursor);
    } catch {
      if (my === seq.current) setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const patch = useCallback((id: Id, p: Partial<Post>) => setItems((cur) => (cur ? patchPost(cur, id, p) : cur)), []);
  const drop = useCallback((id: Id) => setItems((cur) => (cur ? removePost(cur, id) : cur)), []);
  // I blocked an author from a card: all their posts go at once, the cached page is stale, and the feed reloads
  const blocked = useCallback((authorId: Id) => {
    setItems((cur) => (cur ? removeAuthor(cur, authorId) : cur));
    clearFeedCache();
    loadFirst();
  }, [loadFirst]);

  const headerH = insets.top + HEADER_ROW;
  const tabBarTop = Math.max(insets.bottom - 10, 0) + TAB_BAR.gap + TAB_BAR.height;
  const showWelcome = !!user && items !== null && (items.length === 0 || (followingCount !== null && followingCount < 3));
  const bell = badgeText(chat.newFollowers);

  const listHeader = (
    <View style={{ gap: 16, paddingTop: 6 }}>
      {trips.length ? <TripsRow trips={trips} /> : (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16 }}>
          <AllEventsLink />
        </View>
      )}
      {showWelcome ? <Welcome name={user!.displayName} onShare={() => router.push('/post/new')} myId={user!.id} /> : null}
    </View>
  );

  let body: React.ReactNode;
  if (authLoading) body = <LoadingState />;
  else if (!user) {
    body = (
      <ScrollView contentContainerStyle={{ paddingTop: headerH, paddingBottom: tabSpace }}>
        {listHeader}
        <EmptyState illustration="mountain" title={t('home.loginTitle')} text={t('home.loginText')} actionLabel={t('common.login')} onAction={() => router.push('/login')} />
      </ScrollView>
    );
  } else {
    body = (
      <FlatList
        data={items ?? []}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: tabSpace + 72, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        ListHeaderComponent={listHeader}
        renderItem={({ item, index }) => (
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            {startsSuggested(items ?? [], index) ? (
              <View style={{ paddingHorizontal: 4, paddingBottom: 10, gap: 2 }}>
                <Txt variant="footnote" tone="label2" style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: '600' }} accessibilityRole="header">{t('home.suggested')}</Txt>
                <Txt variant="footnote" tone="label2">{t('home.suggestedHint')}</Txt>
              </View>
            ) : null}
            <PostCard post={item} onPatch={(p) => patch(item.id, p)} onRemoved={() => drop(item.id)} onBlocked={blocked} />
          </View>
        )}
        ListEmptyComponent={items === null ? (error ? <ErrorState message={errorMessage(error, t)} onRetry={loadFirst} /> : <LoadingState inline />) : undefined}
        ListFooterComponent={items && items.length ? (
          loadingMore ? <ActivityIndicator color={c.label2} style={{ paddingVertical: 20 }} />
            : moreError ? <ErrorState message={t('home.loadMoreFailed')} onRetry={() => { setMoreError(false); setTimeout(loadMore, 0); }} />
              : !cursor ? <Txt variant="footnote" tone="label2" center style={{ paddingVertical: 20 }}>{t('home.endOfFeed')}</Txt> : undefined
        ) : undefined}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.tint} colors={[c.tint]} progressBackgroundColor={c.card} progressViewOffset={headerH} />}
        removeClippedSubviews={Platform.OS === 'android'}
        windowSize={7}
        initialNumToRender={3}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {body}

      {/* compact header: logo + YOLCHU, search, activity bell */}
      <GlassView borderless style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerH, paddingTop: insets.top, backgroundColor: Platform.OS === 'android' ? c.bg : undefined }}>
        <View style={{ height: HEADER_ROW, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <LogoMark size={30} />
          <Txt style={[font('800'), { fontSize: 20, letterSpacing: 1.5, flex: 1 }]} accessibilityRole="header" accessibilityLabel={t('home.a11yHeader')}>YOLCHU</Txt>
          <HeaderButton icon="search" label={t('home.search')} onPress={() => router.push('/search')} />
          <HeaderButton
            icon="bell"
            label={bell ? t('home.bellNew', { count: chat.newFollowers }) : t('home.bell')}
            badge={bell}
            onPress={() => router.push(user ? '/activity' : '/login')}
          />
        </View>
      </GlassView>

      {/* "+": only on Home, 16 px above the tab bar */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.create')}
        onPress={() => (user ? setCreateOpen(true) : router.push('/login'))}
        style={({ pressed }) => [{
          position: 'absolute', right: 16, bottom: tabBarTop + 16, width: 56, height: 56, borderRadius: 28, backgroundColor: c.tint,
          alignItems: 'center', justifyContent: 'center', shadowColor: c.tint, shadowOpacity: 0.4, shadowRadius: 11, shadowOffset: { width: 0, height: 8 }, elevation: 8,
        }, pressed && { opacity: 0.85 }]}
      >
        <Icon name="plus" size={26} color={c.onTint} strokeWidth={2.6} />
      </Pressable>
      <ActionSheet
        visible={createOpen}
        title={t('home.createTitle')}
        onClose={() => setCreateOpen(false)}
        actions={[
          { label: t('home.newPost'), onPress: () => router.push('/post/new') },
          { label: t('home.shareSpot'), onPress: () => router.push('/spot/new') },
          { label: t('home.createEvent'), onPress: () => router.push('/event/new') },
        ]}
      />
    </View>
  );
}

function HeaderButton({ icon, label, onPress, badge }: { icon: 'search' | 'bell'; label: string; onPress: () => void; badge?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
      <Icon name={icon} size={23} color={c.label} strokeWidth={2.1} />
      {badge ? (
        <View style={{ position: 'absolute', right: 6, top: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: c.destructive, alignItems: 'center', justifyContent: 'center' }}>
          <Txt style={{ fontSize: 10, lineHeight: 12, fontWeight: '700', color: '#FFFFFF' }}>{badge}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

function AllEventsLink() {
  const { t } = useI18n();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push('/events')} hitSlop={6} style={({ pressed }) => [{ minHeight: TAP, justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
      <Txt variant="subhead" tone="tint">{t('home.allEvents')}</Txt>
    </Pressable>
  );
}

function TripsRow({ trips }: { trips: TripCard[] }) {
  const { t } = useI18n();
  return (
    <View accessibilityLabel={t('home.trips')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: TAP }}>
        <Txt variant="footnote" tone="label2" style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: '600' }} accessibilityRole="header">{t('home.trips')}</Txt>
        <AllEventsLink />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 }}>
        {trips.map((x) => <Trip key={`${x.kind}-${x.event.id}`} trip={x} />)}
      </ScrollView>
    </View>
  );
}

function Trip({ trip }: { trip: TripCard }) {
  const { c } = useTheme();
  const { t, d } = useI18n();
  const e = trip.event;
  const x = useEventCardText(e);
  const next = trip.kind === 'next';
  const kicker = next ? t('home.nextTrip') : trip.kind === 'weekend' ? t('home.thisWeekend') : t('home.comingUp');
  const b = dateBlock(e.startsAt, d.events.monthsShort);
  const wd = d.events.weekdaysLong[bakuParts(new Date(e.startsAt)).weekday] ?? '';
  const meta = next ? t('home.meetAt', { time: x.time, cars: x.cars }) : [x.clan, x.cars].filter(Boolean).join(' · ');
  const when = formatEventWhen(e.startsAt, null, { weekdays: d.events.weekdays, months: d.chat.months });
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${t('home.tripA11y', { kicker, title: e.title, date: when })}, ${x.place}, ${x.cars}${x.level ? `, ${t('spot.difficulty')} ${x.level}` : ''}`}
      onPress={() => router.push(`/event/${e.id}`)}
      style={({ pressed }) => [{
        width: 300, minHeight: 112, borderRadius: 20, backgroundColor: c.card, padding: 12, flexDirection: 'row', gap: 12,
        borderWidth: next ? 1.5 : 0, borderColor: c.tint,
      }, pressed && { opacity: 0.85 }]}
    >
      <View style={{ width: 60, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: c.card, borderWidth: 0.5, borderColor: c.separator, alignItems: 'center' }} importantForAccessibility="no-hide-descendants">
        <View style={{ alignSelf: 'stretch', height: 20, backgroundColor: next ? c.tint : c.paper, alignItems: 'center', justifyContent: 'center' }}>
          <Txt style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }} color={next ? c.onTint : c.paperText}>{b.month.toLocaleUpperCase()}</Txt>
        </View>
        <Txt style={[font('800'), { fontSize: 26, lineHeight: 32, marginTop: 4 }]}>{b.day}</Txt>
        <Txt variant="caption" tone="label2" style={{ fontSize: 11 }} numberOfLines={1}>{wd}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }} importantForAccessibility="no-hide-descendants">
        <Txt style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }} color={next ? c.tint : c.label2}>{kicker}</Txt>
        <Txt variant="headline" numberOfLines={1}>{e.title}</Txt>
        <Txt variant="footnote" tone="label2" numberOfLines={1}>{meta}</Txt>
        {x.levelNum ? <DifficultySign level={x.levelNum} style={{ marginTop: 3, alignSelf: 'flex-start' }} /> : null}
      </View>
    </Pressable>
  );
}

/** New user: welcome card + "Sürücüləri izlə" (clan mates first, then this month's most active drivers). */
function Welcome({ name, onShare, myId }: { name: string; onShare: () => void; myId: Id }) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  const [people, setPeople] = useState<{ id: Id; displayName: string; avatarUrl: string | null; why: string; isFollowing: boolean }[] | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [me, board, following, blocks] = await Promise.all([
        api.user(myId).catch(() => null),
        api.leaderboard('month').catch(() => null),
        api.following(myId, { limit: 50 }).catch(() => null),
        api.blocks().catch(() => null),
      ]);
      const mates = me?.clan ? await api.clanMembers(me.clan.id).catch(() => null) : null;
      const out = pickSuggestions({
        myId,
        clanMates: (mates?.items ?? []).slice(0, 10).map((x) => ({ user: x.user, why: t('home.clanMate', { clan: me!.clan!.name }) })),
        board: (board?.items ?? []).map((i) => ({ user: i.user, blocked: i.blocked, why: t('home.activeMonth', { points: formatPoints(i.points, lang) }) })),
        followingIds: (following?.items ?? []).map((f) => f.user.id),
        blockedIds: (blocks?.items ?? []).map((b) => b.id),
      });
      if (live) setPeople(out);
    })();
    return () => { live = false; };
  }, [myId, t, lang]);

  return (
    <View style={{ paddingHorizontal: 16, gap: 0 }}>
      <View style={{ borderRadius: radius.card, backgroundColor: c.card, padding: 20, paddingTop: 22, gap: 6, overflow: 'hidden' }}>
        <Contour color={c.tint} opacity={0.1} seed={5} width={260} height={140} style={{ left: undefined, bottom: undefined, right: -30, top: -10, width: 260, height: 140 }} />
        <MountainMark size={48} color={c.tint} />
        <Txt variant="title2" accessibilityRole="header" style={{ marginTop: 6 }}>{t('home.welcome', { name })}</Txt>
        <Txt variant="subhead" tone="label2">{t('home.emptyText')}</Txt>
        <PillButton title={t('home.shareFirst')} icon="camera" size="medium" onPress={onShare} style={{ marginTop: 12 }} />
      </View>
      {people && people.length ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 18, paddingBottom: 2, minHeight: TAP }}>
            <Txt variant="footnote" tone="label2" style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: '600' }} accessibilityRole="header">{t('home.followDrivers')}</Txt>
            <Pressable accessibilityRole="link" onPress={() => router.push('/leaderboard')} hitSlop={6} style={{ minHeight: TAP, justifyContent: 'center' }}>
              <Txt variant="subhead" tone="tint">{t('home.seeAll')}</Txt>
            </Pressable>
          </View>
          <View style={{ borderRadius: radius.card, backgroundColor: c.card, overflow: 'hidden' }}>
            {people.map((p, i) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, minHeight: 66 }}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${p.displayName}, ${p.why}`}
                  onPress={() => router.push(`/user/${p.id}`)}
                  style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', borderBottomWidth: i < people.length - 1 ? 0.5 : 0, borderBottomColor: c.separator }}
                >
                  <Avatar uri={photoUri(p.avatarUrl)} name={p.displayName} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="headline" numberOfLines={1}>{p.displayName}</Txt>
                    <Txt variant="footnote" tone="label2" numberOfLines={1}>{p.why}</Txt>
                  </View>
                </Pressable>
                <FollowButton user={p} onChange={(s) => setPeople((cur) => cur?.map((x) => (sameId(x.id, p.id) ? { ...x, isFollowing: s.isFollowing } : x)) ?? cur)} />
              </View>
            ))}
          </View>
          <Txt variant="footnote" tone="label2" style={{ marginTop: 8, marginHorizontal: 16 }}>{t('home.suggestHint')}</Txt>
        </>
      ) : null}
    </View>
  );
}
