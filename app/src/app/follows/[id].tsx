import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Avatar, Badge, EmptyState, ErrorState, LoadingState, NavScreen, PillButton, SearchField, SegmentedControl, Txt, useTheme } from '../../components/ui';
import { FollowButton } from '../../components/FollowButton';
import { photoUri } from '../../components/Rows';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { appendPage, setRowFollowing } from '../../lib/postsLogic';
import { sameId } from '../../lib/format';
import { HAIRLINE, radius } from '../../lib/theme';
import type { FollowListItem } from '../../lib/types';

type Tab = 'followers' | 'following';

/** İzləyicilər / İzlənilir of a user, searchable, with follow buttons. Opening my own followers clears the badge. */
export default function FollowsScreen() {
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = String(params.id);
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const chat = useChat();
  const [tab, setTab] = useState<Tab>(params.tab === 'following' ? 'following' : 'followers');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<FollowListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);
  const isMe = sameId(user?.id, id);

  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setError(null);
    setItems(null);
    try {
      const fn = tab === 'followers' ? api.followers : api.following;
      const r = await fn(id, { q: debounced || undefined });
      if (my !== seq.current) return;
      setItems(r.items);
      setCursor(r.nextCursor);
    } catch (e) {
      if (my === seq.current) setError(e);
    }
  }, [id, tab, debounced]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isMe && tab === 'followers') api.followersSeen().then(() => chat.refreshUnread()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMe, tab]);

  async function loadMore() {
    if (!cursor || more) return;
    const my = seq.current;
    setMore(true);
    try {
      const fn = tab === 'followers' ? api.followers : api.following;
      const r = await fn(id, { q: debounced || undefined, cursor });
      if (my !== seq.current) return;
      setItems((cur) => appendPage((cur ?? []).map((x) => ({ ...x, id: x.user.id })), r.items.map((x) => ({ ...x, id: x.user.id }))));
      setCursor(r.nextCursor);
    } catch (e) {
      setNote(errorMessage(e, t));
    } finally {
      setMore(false);
    }
  }

  return (
    <NavScreen title={tab === 'followers' ? t('follow.followers') : t('follow.followingTab')} fallback="/profile">
      <SegmentedControl<Tab>
        label={t('follow.tabsLabel')}
        value={tab}
        onChange={(v) => { setTab(v); setNote(null); }}
        style={{ alignSelf: 'stretch' }}
        options={[{ value: 'followers', label: t('follow.followers') }, { value: 'following', label: t('follow.followingTab') }]}
      />
      <SearchField value={q} onChangeText={setQ} placeholder={t('follow.search')} label={t('follow.search')} />
      {note ? <Txt variant="footnote" tone="destructive" role="alert" center>{note}</Txt> : null}
      {items === null ? (error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : <LoadingState inline />) : items.length === 0 ? (
        debounced ? <Txt variant="subhead" tone="label2" center>{t('follow.noMatch', { q: debounced })}</Txt>
          : <EmptyState icon="people" title={tab === 'followers' ? t('follow.emptyFollowers') : t('follow.emptyFollowing')} actionLabel={isMe ? t('follow.findDrivers') : undefined} onAction={isMe ? () => router.push('/search') : undefined} contour={false} />
      ) : (
        <View style={{ backgroundColor: c.card, borderRadius: radius.card, overflow: 'hidden' }}>
          {items.map((x, i) => {
            const friend = x.isFollowing && x.followsMe;
            return (
              <View key={x.user.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, minHeight: 64 }}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={[x.user.displayName, x.user.city, friend ? t('follow.friend') : x.followsMe && !x.isMe ? t('follow.followsYou') : null].filter(Boolean).join(', ')}
                  onPress={() => router.push(`/user/${x.user.id}`)}
                  style={({ pressed }) => [{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', borderBottomWidth: i < items.length - 1 ? HAIRLINE : 0, borderBottomColor: c.separator }, pressed && { opacity: 0.6 }]}
                >
                  <Avatar uri={photoUri(x.user.avatarUrl)} name={x.user.displayName} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Txt variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{x.user.displayName}</Txt>
                      {friend ? <Badge text={t('follow.friend')} tone="forest" /> : null}
                    </View>
                    {x.user.city ? <Txt variant="footnote" tone="label2" numberOfLines={1}>{x.user.city}</Txt> : null}
                  </View>
                </Pressable>
                <FollowButton
                  user={{ id: x.user.id, displayName: x.user.displayName, isFollowing: x.isFollowing, followsMe: x.followsMe, isMe: x.isMe }}
                  onChange={(s) => setItems((cur) => (cur ? setRowFollowing(cur, x.user.id, s.isFollowing) : cur))}
                  onError={setNote}
                />
              </View>
            );
          })}
        </View>
      )}
      {items && cursor ? <PillButton title={t('events.loadMore')} variant="gray" onPress={loadMore} loading={more} /> : null}
    </NavScreen>
  );
}
