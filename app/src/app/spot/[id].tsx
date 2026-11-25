import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hero } from '../../components/Hero';
import { EventList } from '../../components/EventCard';
import {
  Badge, Card, DifficultyBar, DifficultySign, ErrorState, FactTile, FormError, IconButton, LoadingState, PillButton,
  Section, SectionHeader, StarRating, Txt,
} from '../../components/ui';
import { MoreMenu, type SheetAction } from '../../components/ActionSheet';
import { useNavigate } from '../../components/NavigateSheet';
import { PostStrip } from '../../components/posts/PostGrid';
import { shareLink } from '../../lib/share';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/themeContext';
import { useAsync, useRefocus } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { distanceFromBaku, formatAvg, formatDistance, sameId } from '../../lib/format';

export default function SpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, d, lang } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data: spot, setData, error, loading, reload } = useAsync(() => api.spot(id), [id, user?.id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rating, setRating] = useState(false);
  const nav = useNavigate();
  const [stripKey, setStripKey] = useState(0);

  // refresh after coming back from the edit screen
  useRefocus(() => { reload(); setStripKey((k) => k + 1); });

  if (loading && !spot) return <LoadingState />;
  if (error || !spot) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Hero kind="hills" height={140} fallback="/" />
        <ErrorState message={errorMessage(error, t)} onRetry={reload} />
      </View>
    );
  }

  const isOwner = sameId(user?.id, spot.owner.id);
  const km = distanceFromBaku(spot);

  async function rate(n: number) {
    if (!user) return router.push('/login');
    setActionError(null);
    setRating(true);
    try {
      const r = await api.rateSpot(spot!.id, n);
      setData({ ...spot!, ...r });
    } catch (e) {
      setActionError(errorMessage(e, t));
    } finally {
      setRating(false);
    }
  }

  async function remove() {
    if (!(await confirmAsync(t('spot.deleteConfirm'), t('common.delete'), t('common.cancel'), { destructive: true }))) return;
    try {
      await api.deleteSpot(spot!.id);
      router.replace('/explore');
    } catch (e) {
      setActionError(errorMessage(e, t));
    }
  }

  const navigate = () => nav.open({ lat: spot.lat, lng: spot.lng, name: spot.name });
  async function share() {
    const r = await shareLink('spot', spot!.id, spot!.name);
    if (r === 'copied') setActionError(null);
    if (r === 'failed') setActionError(t('post.shareFailed'));
  }

  const level = spot.type === 'trail' && spot.difficulty ? spot.difficulty : null;
  const avg = formatAvg(spot.ratingAvg, lang);
  const upcoming = spot.upcomingEvents ?? [];
  const isTrail = spot.type === 'trail';
  const report = () => router.push(user ? { pathname: '/report', params: { targetType: 'spot', targetId: String(spot.id) } } : '/login');
  const menu: SheetAction[] = [
    { label: t('spot.shareLink'), onPress: share },
    ...(user ? [{ label: t('home.newPost'), onPress: () => router.push({ pathname: '/post/new', params: { spotId: String(spot.id), spotName: spot.name } }) }] : []),
    ...(isOwner
      ? [{ label: t('common.delete'), destructive: true, onPress: remove }]
      : [{ label: t('spot.report'), destructive: true, onPress: report }]),
  ];
  const createEvent = () => router.push(user ? { pathname: '/event/new', params: { spotId: String(spot.id) } } : '/login');

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <Hero
          kind="hills"
          height={250}
          fallback="/"
          right={
            <>
              {isOwner ? <IconButton icon="edit" glass label={t('common.edit')} onPress={() => router.push(`/spot/edit/${spot.id}`)} /> : null}
              <MoreMenu actions={menu} title={spot.name} />
            </>
          }
        />
        <View style={{ padding: 16, paddingTop: 18, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ gap: 8, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge text={isTrail ? t('spot.trail') : t('spot.camp')} tone={isTrail ? 'clay' : 'forest'} icon={isTrail ? 'trail' : 'tent'} />
              <Txt variant="subhead" tone="label2">{t('spot.fromBaku', { km: formatDistance(km, lang) })}</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <Txt variant="title1" accessibilityRole="header" style={{ flex: 1 }}>{spot.name}</Txt>
              {spot.ratingCount > 0 ? (
                <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`${t('spot.rating')}: ${t('spot.ratingValue', { avg, count: spot.ratingCount })}`}>
                  <Txt variant="title3" style={{ fontWeight: '700' }}>{`★ ${avg}`}</Txt>
                  <Txt variant="footnote" tone="label2">{t('car.votes', { count: spot.ratingCount })}</Txt>
                </View>
              ) : null}
            </View>
            <Txt variant="subhead" tone="tint" accessibilityRole="link" onPress={() => router.push(`/user/${spot.owner.id}`)}>
              {t('spot.sharedBy', { name: spot.owner.displayName })}
            </Txt>
          </View>

          {level ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="footnote" tone="label2">{t('spot.difficulty')}</Txt>
                  <Txt variant="subhead">{d.levels.explain[level - 1]}</Txt>
                </View>
                <DifficultySign level={level} size="large" />
              </View>
              <DifficultyBar level={level} word={d.levels.names[level - 1]} label={t('spot.difficulty')} compact />
            </Card>
          ) : null}

          {spot.season || upcoming.length ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {spot.season ? <FactTile icon="season" label={t('spot.season')} value={spot.season} tone="sand" /> : null}
              {upcoming.length ? <FactTile icon="people" label={t('spot.eventsTile')} value={t('spot.eventsSoon', { count: upcoming.length })} tone="forest" /> : null}
            </View>
          ) : null}

          {spot.tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 }} accessible accessibilityLabel={`${t('spot.tagsLabel')}: ${spot.tags.join(', ')}`}>
              {spot.tags.map((tag) => <Badge key={tag} text={tag} tone="stone" />)}
            </View>
          ) : null}

          {spot.description ? (
            <Section header={t('spot.description')}>
              <View style={{ padding: 16 }}>
                <Txt>{spot.description}</Txt>
              </View>
            </Section>
          ) : null}

          <PostStrip title={t('spot.photos')} load={() => api.spotPosts(spot.id)} reloadKey={`${spot.id}-${stripKey}`} />

          {upcoming.length ? (
            <View style={{ gap: 10 }}>
              <SectionHeader title={t('events.upcomingHere')} />
              <EventList items={upcoming} />
            </View>
          ) : null}

          <Section header={t('spot.rateTitle')}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center' }}>
              <StarRating
                value={spot.myRating ?? 0}
                onChange={rate}
                disabled={rating}
                size={30}
                labelFor={(n) => t('spot.rateStar', { n, count: n })}
                label={t('spot.starsLabel')}
              />
            </View>
          </Section>
          <FormError message={actionError} />
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 24 + insets.bottom, flexDirection: 'row', gap: 10, maxWidth: 608, alignSelf: 'center' }}>
        <PillButton title={t('nav.button')} icon="navigate" onPress={navigate} style={{ flex: 1 }} />
        <PillButton title={t('events.create')} variant="secondary" onPress={createEvent} />
      </View>
      {nav.sheet}
    </View>
  );
}
