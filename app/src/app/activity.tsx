import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, EmptyState, ErrorState, LoadingState, NavScreen, PillButton, Txt, useTheme } from '../components/ui';
import { RequireAuth } from '../components/RequireAuth';
import { FollowButton } from '../components/FollowButton';
import { photoUri } from '../components/Rows';
import { api } from '../lib/api';
import { useChat } from '../lib/chat';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { appendPage, timeAgo } from '../lib/postsLogic';
import { HAIRLINE, radius } from '../lib/theme';
import { sameId } from '../lib/format';
import type { ActivityItem } from '../lib/types';

/** Bell: likes and comments on my posts, new followers (with "follow back"). Opening it clears the new-follower badge. */
export default function ActivityScreen() {
  return <RequireAuth><Activity /></RequireAuth>;
}

function Activity() {
  const { t } = useI18n();
  const { c } = useTheme();
  const chat = useChat();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setError(null);
    try {
      const r = await api.activity();
      if (my !== seq.current) return;
      setItems(r.items);
      setCursor(r.nextCursor);
    } catch (e) {
      if (my === seq.current) setError(e);
    }
  }, []);

  useEffect(() => {
    load();
    api.followersSeen().then(() => chat.refreshUnread()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function loadMore() {
    if (!cursor || more) return;
    setMore(true);
    try {
      const r = await api.activity(cursor);
      setItems((cur) => appendPage(cur ?? [], r.items));
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
  }

  const text = (a: ActivityItem) => a.type === 'like'
    ? t('activity.liked', { name: a.actor.displayName })
    : a.type === 'comment'
      ? t('activity.commented', { name: a.actor.displayName, text: a.comment?.text ?? '' })
      : t('activity.followed', { name: a.actor.displayName });

  return (
    <NavScreen title={t('activity.title')} fallback="/">
      {items === null ? (error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : <LoadingState inline />) : items.length === 0 ? (
        <EmptyState icon="bell" title={t('activity.empty')} text={t('activity.emptyText')} />
      ) : (
        <View style={{ backgroundColor: c.card, borderRadius: radius.card, overflow: 'hidden' }}>
          {items.map((a, i) => {
            const time = timeAgo(a.createdAt, t);
            const open = () => router.push(a.post ? `/post/${a.post.id}` : `/user/${a.actor.id}`);
            return (
              <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, minHeight: 64 }}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${text(a)}, ${time}`}
                  onPress={open}
                  style={({ pressed }) => [{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', paddingVertical: 10, borderBottomWidth: i < items.length - 1 ? HAIRLINE : 0, borderBottomColor: c.separator }, pressed && { opacity: 0.6 }]}
                >
                  <Avatar uri={photoUri(a.actor.avatarUrl)} name={a.actor.displayName} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="subhead" numberOfLines={3}>{text(a)}</Txt>
                    <Txt variant="footnote" tone="label2">{time}</Txt>
                  </View>
                </Pressable>
                {a.type === 'follow' ? (
                  <FollowButton
                    user={{ id: a.actor.id, displayName: a.actor.displayName, isFollowing: a.isFollowing, followsMe: true }}
                    onChange={(s) => setItems((cur) => cur?.map((x) => (sameId(x.actor.id, a.actor.id) ? { ...x, isFollowing: s.isFollowing } : x)) ?? cur)}
                  />
                ) : a.post?.photoUrl ? (
                  <Image source={{ uri: photoUri(a.post.photoUrl) ?? undefined }} style={{ width: 44, height: 44, borderRadius: 8 }} accessible={false} />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {items && cursor ? <PillButton title={t('events.loadMore')} variant="gray" onPress={loadMore} loading={more} /> : null}
    </NavScreen>
  );
}
