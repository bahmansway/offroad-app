import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Cell, EmptyState, ErrorState, Icon, IconTile, LoadingState, NavBar, PillButton, Section, Txt, goBack, useTabBarSpace, useTheme } from './ui';
import { MoreMenu, type SheetAction } from './ActionSheet';
import { FollowButton } from './FollowButton';
import { PostGrid } from './posts/PostGrid';
import { CarCell, photoUri } from './Rows';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useChat } from '../lib/chat';
import { useI18n } from '../lib/i18n';
import { errorMessage, chatErrorMessage, inviteErrorMessage } from '../lib/errors';
import { confirmAsync } from '../lib/dialogs';
import { pickPhoto } from '../lib/photos';
import { getSendMessageHandler } from '../lib/chatHooks';
import { canInviteUser, clanTitleOf, titleKey } from '../lib/permissions';
import { appendPage, applyFollowState, patchPost, removePost } from '../lib/postsLogic';
import { formatPoints, rankText } from '../lib/leaderboardLogic';
import { formatNumber, sameId } from '../lib/format';
import { successFeedback } from '../lib/haptics';
import { HAIRLINE, TAP } from '../lib/theme';
import type { CarSummary, Id, Post, PublicUser } from '../lib/types';

type Tab = 'posts' | 'garage' | 'saved';

/**
 * v6 profile (own tab and /user/:id). Header: avatar + counts (Paylaşımlar · İzləyicilər · İzlənilir), name,
 * city + clan chip, bio, points chip, buttons; then Paylaşımlar (3-column grid) · Qaraj · Saxlanılanlar (own only).
 * `tabRoot` = the Profil tab (no back button, gear for settings).
 */
export function ProfileView({ userId, tabRoot }: { userId: Id; tabRoot?: boolean }) {
  const { t, lang } = useI18n();
  const { c } = useTheme();
  const { user: me, updateUser } = useAuth();
  const chat = useChat();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width: winW } = useWindowDimensions();
  const width = Math.min(winW, 640);
  const isMe = sameId(me?.id, userId);
  const [u, setU] = useState<PublicUser | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [postsCursor, setPostsCursor] = useState<string | null>(null);
  const [saved, setSaved] = useState<Post[] | null>(null);
  const [savedCursor, setSavedCursor] = useState<string | null>(null);
  const [cars, setCars] = useState<CarSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [rank, setRank] = useState<{ rank: number | null; points: number } | null | undefined>(undefined);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [dmBusy, setDmBusy] = useState(false);
  const [myClan, setMyClan] = useState<PublicUser['clan'] | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setError(null);
    try {
      const [usr, p, cs] = await Promise.all([api.user(userId), api.userPosts(userId), api.cars(userId).catch(() => ({ items: [] as CarSummary[] }))]);
      if (my !== seq.current) return;
      setU(usr);
      setPosts(p.items);
      setPostsCursor(p.nextCursor);
      setCars(cs.items);
      if (isMe) {
        api.savedPosts().then((s) => { if (my === seq.current) { setSaved(s.items); setSavedCursor(s.nextCursor); } }).catch(() => setSaved([]));
      }
      api.leaderboard('month').then((b) => {
        if (my !== seq.current) return;
        if (isMe) setRank(b.me ?? null);
        else {
          const row = b.items.find((i) => sameId(i.user.id, userId));
          setRank(row ? { rank: row.rank, points: row.points } : null);
        }
      }).catch(() => setRank(undefined));
      if (me && !isMe) api.user(me.id).then((x) => setMyClan(x.clan ?? null)).catch(() => {});
    } catch (e) {
      if (my === seq.current) setError(e);
    }
  }, [userId, isMe, me]);

  useFocusEffect(useCallback(() => { load(); if (isMe) chat.refreshUnread(); }, [load, isMe]));  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTab('posts'); setU(null); setPosts(null); setSaved(null); setCars(null); }, [userId]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function loadMore() {
    const cursor = tab === 'posts' ? postsCursor : tab === 'saved' ? savedCursor : null;
    if (!cursor || more) return;
    setMore(true);
    try {
      if (tab === 'posts') {
        const r = await api.userPosts(userId, cursor);
        setPosts((cur) => appendPage(cur ?? [], r.items));
        setPostsCursor(r.nextCursor);
      } else {
        const r = await api.savedPosts(cursor);
        setSaved((cur) => appendPage(cur ?? [], r.items));
        setSavedCursor(r.nextCursor);
      }
    } catch { /* stays; scrolling again retries */ } finally {
      setMore(false);
    }
  }
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y > contentSize.height - 400) loadMore();
  };

  async function changeAvatar() {
    const res = await pickPhoto('avatar');
    if (!res.ok) {
      if (res.reason !== 'cancelled') setNote({ text: t(res.reason === 'denied' ? 'profile.photoDenied' : res.reason === 'tooBig' ? 'profile.photoTooBig' : 'profile.photoFailed'), error: true });
      return;
    }
    setAvatarBusy(true);
    try {
      const r = await api.uploadAvatar(res.bytes);
      updateUser({ avatarUrl: r.avatarUrl });
      setU((cur) => (cur ? { ...cur, avatarUrl: r.avatarUrl } : cur));
    } catch (e) {
      setNote({ text: errorMessage(e, t, 'photo'), error: true });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function message() {
    if (!me) return router.push('/login');
    const h = getSendMessageHandler();
    if (!h || !u) return;
    setDmBusy(true);
    try { await h(u); } catch (e) { setNote({ text: chatErrorMessage(e, t), error: true }); } finally { setDmBusy(false); }
  }

  async function toggleBlock() {
    if (!me) return router.push('/login');
    if (!u) return;
    const blocking = !u.isBlocked;
    if (blocking && !(await confirmAsync(t('profile.blockConfirm', { name: u.displayName }), t('profile.block'), t('common.cancel'), { destructive: true }))) return;
    try {
      if (blocking) await api.block(u.id); else await api.unblock(u.id);
      setNote({ text: blocking ? t('profile.blocked') : t('profile.unblocked'), error: false });
      chat.reload();
      load();
    } catch (e) {
      setNote({ text: errorMessage(e, t), error: true });
    }
  }

  async function invite() {
    if (!myClan || !u) return;
    try {
      await api.inviteToClan(myClan.id, u.id);
      successFeedback();
      setNote({ text: t('clan.inviteSent', { name: u.displayName }), error: false });
    } catch (e) {
      setNote({ text: inviteErrorMessage(e, t), error: true });
    }
  }

  const back = tabRoot ? undefined : () => goBack('/');
  const navRight = !u ? null : isMe ? (
    tabRoot ? (
      <Pressable accessibilityRole="link" accessibilityLabel={t('profile.settings')} onPress={() => router.push('/settings')} style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
        <Icon name="gear" size={24} color={c.label} />
      </Pressable>
    ) : null
  ) : (
    <MoreMenu
      glass={false}
      title={u.displayName}
      label={t('profile.moreA11y')}
      actions={[
        ...(canInviteUser(myClan ?? null, u, me?.id) ? [{ label: t('clan.inviteToClan'), onPress: invite }] : []),
        { label: u.isBlocked ? t('profile.unblock') : t('profile.block'), destructive: !u.isBlocked, onPress: toggleBlock },
        { label: t('profile.report'), destructive: true, onPress: () => router.push(me ? { pathname: '/report', params: { targetType: 'user', targetId: String(u.id) } } : '/login') },
      ] as SheetAction[]}
    />
  );
  const nav = (
    <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
      <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <NavBar title={isMe ? t('tabs.profile') : u?.displayName} onBack={back} right={navRight} />
      </View>
    </View>
  );

  if (!u) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {nav}
        {error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : <LoadingState inline />}
      </View>
    );
  }

  const counts: { key: string; n: number; label: string; onPress: () => void }[] = [
    { key: 'posts', n: u.postCount ?? posts?.length ?? 0, label: t('follow.posts'), onPress: () => setTab('posts') },
    { key: 'followers', n: u.followerCount ?? 0, label: t('follow.followers'), onPress: () => router.push({ pathname: '/follows/[id]', params: { id: String(u.id), tab: 'followers' } }) },
    { key: 'following', n: u.followingCount ?? 0, label: t('follow.followingTab'), onPress: () => router.push({ pathname: '/follows/[id]', params: { id: String(u.id), tab: 'following' } }) },
  ];
  const clanText = u.clan ? `${u.clan.name}${u.clan.role === 'leader' || u.clan.role === 'officer' ? ` · ${t(titleKey(clanTitleOf(u.clan)))}` : ''}` : null;
  const tabs: { key: Tab; label: string; icon: 'grid' | 'garage' | 'bookmark' }[] = [
    { key: 'posts', label: t('profile.tabPosts'), icon: 'grid' },
    { key: 'garage', label: t('profile.tabGarage'), icon: 'garage' },
    ...(isMe ? [{ key: 'saved' as const, label: t('profile.tabSaved'), icon: 'bookmark' as const }] : []),
  ];
  const hidden = !!u.isBlocked;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {nav}
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={200}
        contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: tabRoot ? tabSpace : 32 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.tint} colors={[c.tint]} progressBackgroundColor={c.card} />}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }} accessibilityLabel={t('profile.profileInfo')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable
              disabled={!isMe || avatarBusy}
              accessibilityRole={isMe ? 'button' : 'image'}
              accessibilityLabel={isMe ? (u.avatarUrl ? t('profile.changePhoto') : t('profile.addPhoto')) : u.displayName}
              onPress={changeAvatar}
            >
              <Avatar uri={photoUri(u.avatarUrl)} name={u.displayName} size={84} />
              {isMe ? (
                <View style={{ position: 'absolute', right: 0, bottom: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: c.tint, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  {avatarBusy ? <ActivityIndicator size="small" color={c.onTint} /> : <Icon name="camera" size={13} color={c.onTint} strokeWidth={2.4} />}
                </View>
              ) : null}
            </Pressable>
            <View style={{ flex: 1, flexDirection: 'row' }}>
              {counts.map((x) => (
                <Pressable
                  key={x.key}
                  accessibilityRole={x.key === 'posts' ? 'button' : 'link'}
                  accessibilityLabel={t('follow.countA11y', { count: formatNumber(x.n, lang), label: x.label })}
                  onPress={x.onPress}
                  style={({ pressed }) => [{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}
                >
                  <Txt variant="title3" style={{ fontWeight: '700' }}>{formatNumber(x.n, lang)}</Txt>
                  <Txt variant="footnote" tone="label2" numberOfLines={1}>{x.label}</Txt>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Txt variant="title3" style={{ fontWeight: '700', letterSpacing: -0.2 }} accessibilityRole="header">{u.displayName}</Txt>
            {!isMe && u.followsMe ? (
              <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: c.fill, justifyContent: 'center' }}>
                <Txt variant="caption" tone="label2" style={{ fontWeight: '600' }}>{t('follow.followsYou')}</Txt>
              </View>
            ) : null}
          </View>
          {u.city || u.clan ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {u.city ? <Txt variant="subhead" tone="label2">{u.city}</Txt> : null}
              {u.clan ? (
                <Pressable accessibilityRole="link" accessibilityLabel={`${t('clan.clanHeader')}: ${clanText}`} onPress={() => router.push(`/clan/${u.clan!.id}`)} hitSlop={10}
                  style={({ pressed }) => [{ height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: c.stoneSoft, justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
                  <Txt variant="footnote" color={c.stoneText} style={{ fontWeight: '600' }} numberOfLines={1}>{clanText}</Txt>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {u.bio ? <Txt variant="subhead" style={{ marginTop: 6 }}>{u.bio}</Txt> : null}
          {rank !== undefined ? (
            <Pressable accessibilityRole="link" onPress={() => router.push('/leaderboard')} hitSlop={7}
              style={({ pressed }) => [{ marginTop: 10, alignSelf: 'flex-start', height: 30, paddingLeft: 10, paddingRight: 12, borderRadius: 15, backgroundColor: c.tintSoft, flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.7 }]}>
              <Icon name="trophy" size={16} color={c.tintSoftText} strokeWidth={2.2} />
              <Txt variant="footnote" color={c.tintSoftText} style={{ fontWeight: '600' }}>
                {rank?.rank ? t('profile.pointsChip', { points: formatPoints(rank.points, lang), rank: rankText(rank.rank) }) : t('profile.pointsNone')}
              </Txt>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            {isMe ? (
              <PillButton title={t('profile.editProfile')} variant="gray" size="small" onPress={() => router.push('/profile/edit')} style={{ flex: 1 }} />
            ) : (
              <>
                {u.isBlocked ? null : (
                  <FollowButton
                    size="large"
                    user={u}
                    onChange={(s) => setU((cur) => (cur ? ('followerCount' in s && s.followerCount !== undefined ? applyFollowState(cur, s as never) : { ...cur, isFollowing: s.isFollowing }) : cur))}
                    onError={(m) => setNote({ text: m, error: true })}
                  />
                )}
                <PillButton title={t('profile.sendMessage')} variant="gray" size="small" onPress={message} loading={dmBusy} disabled={!!u.isBlocked} style={{ flex: 1 }} />
              </>
            )}
          </View>
          {note ? <Txt variant="footnote" tone={note.error ? 'destructive' : 'label2'} role={note.error ? 'alert' : undefined} accessibilityLiveRegion="polite" center style={{ marginTop: 8 }}>{note.text}</Txt> : null}
          {u.isBlocked && !note ? <Txt variant="footnote" tone="label2" center style={{ marginTop: 8 }}>{t('profile.blocked')}</Txt> : null}
        </View>

        {/* Paylaşımlar · Qaraj · Saxlanılanlar */}
        <View accessibilityRole="tablist" accessibilityLabel={t('profile.sectionsLabel')} style={{ flexDirection: 'row', marginTop: 14, borderBottomWidth: HAIRLINE, borderBottomColor: c.separator }}>
          {tabs.map((x) => {
            const on = x.key === tab;
            return (
              <Pressable
                key={x.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={x.label}
                onPress={() => setTab(x.key)}
                style={{ flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 2, borderBottomColor: on ? c.tint : 'transparent' }}
              >
                <Icon name={x.icon} size={18} color={on ? c.label : c.label2} />
                <Txt variant="subhead" color={on ? c.label : c.label2} style={{ fontWeight: '600' }} numberOfLines={1}>{x.label}</Txt>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: 2 }}>
          {hidden ? null : tab === 'posts' ? (
            posts === null ? <LoadingState inline /> : posts.length === 0 ? (
              isMe
                ? <EmptyState icon="camera" title={t('profile.noPostsOwn')} text={t('profile.noPostsOwnText')} actionLabel={t('home.newPost')} onAction={() => router.push('/post/new')} contour={false} />
                : <EmptyState icon="photo" title={t('profile.noPosts')} contour={false} />
            ) : (
              <PostGrid
                posts={posts}
                width={width}
                onPatch={(id, p) => setPosts((cur) => (cur ? patchPost(cur, id, p) : cur))}
                onRemoved={(id) => { setPosts((cur) => (cur ? removePost(cur, id) : cur)); setU((cur) => (cur ? { ...cur, postCount: Math.max(0, (cur.postCount ?? 1) - 1) } : cur)); }}
              />
            )
          ) : tab === 'saved' ? (
            saved === null ? <LoadingState inline /> : saved.length === 0 ? (
              <EmptyState icon="bookmark" title={t('profile.noSaved')} text={t('profile.noSavedText')} contour={false} />
            ) : (
              <PostGrid
                posts={saved}
                width={width}
                onPatch={(id, p) => setSaved((cur) => (cur ? patchPost(cur, id, p) : cur))}
                onRemoved={(id) => setSaved((cur) => (cur ? removePost(cur, id) : cur))}
              />
            )
          ) : (
            <View style={{ padding: 16 }}>
              {cars === null ? <LoadingState inline /> : (
                <Section>
                  {cars.length === 0 ? (
                    isMe ? <Cell title={t('garage.addCar')} action left={<IconTile icon="plus" />} onPress={() => router.push('/car/add')} />
                      : <Cell title={t('profile.noGarage')} />
                  ) : null}
                  {cars.map((car) => (
                    <CarCell key={car.id} car={car} onPress={() => router.push(`/car/${car.id}`)} badge={sameId(u.currentCar?.id, car.id) ? t('profile.currentCar') : undefined} />
                  ))}
                  {isMe && cars.length ? <Cell title={t('garage.addCar')} action left={<IconTile icon="plus" />} onPress={() => router.push('/car/add')} /> : null}
                </Section>
              )}
            </View>
          )}
          {more ? <ActivityIndicator color={c.label2} style={{ paddingVertical: 16 }} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}
