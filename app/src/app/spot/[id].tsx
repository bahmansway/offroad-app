import React, { useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hero } from '../../components/Hero';
import { EventList } from '../../components/EventCard';
import {
  Card, Cell, DifficultyBar, ErrorState, FormError, GlassView, IconButton, IconTile, LoadingState, PillButton,
  Section, StarRating, Txt,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/themeContext';
import { useAsync, useRefocus } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { distanceFromBaku, formatDistance, formatNumber, formatRating, sameId } from '../../lib/format';

export default function SpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, d, lang } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data: spot, setData, error, loading, reload } = useAsync(() => api.spot(id), [id, user?.id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rating, setRating] = useState(false);

  // refresh after coming back from the edit screen
  useRefocus(reload);

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
    if (!(await confirmAsync(t('spot.deleteConfirm'), t('common.delete'), t('common.cancel')))) return;
    try {
      await api.deleteSpot(spot!.id);
      router.replace('/');
    } catch (e) {
      setActionError(errorMessage(e, t));
    }
  }

  function navigate() {
    const { lat, lng } = spot!;
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}`,
      default: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=13/${lat}/${lng}`,
    });
    Linking.openURL(url);
  }

  const level = spot.type === 'trail' && spot.difficulty ? spot.difficulty : null;
  const avg = spot.ratingAvg != null ? formatNumber(Math.round(spot.ratingAvg * 10) / 10, lang) : formatRating(null);
  const ratedText = spot.ratingCount > 0 ? t('spot.ratingValue', { avg, count: spot.ratingCount }) : t('spot.notRated');

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <Hero
          kind="hills"
          height={250}
          fallback="/"
          right={isOwner ? (
            <GlassView elevated style={{ height: 44, borderRadius: 22, flexDirection: 'row' }}>
              <IconButton icon="edit" label={t('common.edit')} onPress={() => router.push(`/spot/edit/${spot.id}`)} style={{ backgroundColor: 'transparent', width: 48 }} />
              <IconButton icon="trash" label={t('common.delete')} onPress={remove} color={c.destructive} style={{ backgroundColor: 'transparent', width: 48 }} />
            </GlassView>
          ) : (
            <IconButton
              icon="flag"
              glass
              label={t('spot.report')}
              onPress={() => router.push(user ? { pathname: '/report', params: { targetType: 'spot', targetId: String(spot.id) } } : '/login')}
            />
          )}
        />
        <View style={{ padding: 16, paddingTop: 20, gap: 20, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ gap: 4, paddingHorizontal: 4 }}>
            <Txt variant="largeTitle" accessibilityRole="header">{spot.name}</Txt>
            <Txt variant="subhead" tone="label2">
              {spot.type === 'trail' ? t('spot.trail') : t('spot.camp')}
              {' · '}
              <Txt variant="subhead" tone="tint" accessibilityRole="link" onPress={() => router.push(`/user/${spot.owner.id}`)}>
                {t('spot.sharedBy', { name: spot.owner.displayName })}
              </Txt>
              {' · '}
              {t('spot.fromBaku', { km: formatDistance(km, lang) })}
            </Txt>
          </View>

          <Card>
            {level ? (
              <DifficultyBar level={level} word={d.levels.names[level - 1]} label={t('spot.difficulty')} caption={d.levels.explain[level - 1]} />
            ) : (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="subhead" tone="label2">{t('spot.difficulty')}</Txt>
                <Txt variant="headline">{t('spot.noDifficulty')}</Txt>
              </View>
            )}
          </Card>

          <Section>
            <Cell title={t('spot.season')} value={spot.season || t('spot.anySeason')} left={<IconTile icon="season" />} minHeight={48} />
            {spot.tags.length ? <Cell title={t('spot.tagsLabel')} value={spot.tags.join(', ')} left={<IconTile icon="tag" />} minHeight={48} /> : null}
            <Cell title={t('spot.rating')} value={ratedText} left={<IconTile icon="star" />} minHeight={48} />
          </Section>

          <Section header={t('spot.description')}>
            <View style={{ padding: 16 }}>
              <Txt>{spot.description || t('spot.noDescription')}</Txt>
            </View>
          </Section>

          <View style={{ gap: 10 }}>
            <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }} accessibilityRole="header">
              {t('events.upcomingHere')}
            </Txt>
            {spot.upcomingEvents?.length ? <EventList items={spot.upcomingEvents} /> : (
              <Txt variant="subhead" tone="label2" style={{ paddingHorizontal: 20 }}>{t('events.noneHere')}</Txt>
            )}
            <PillButton
              title={t('events.createHere')}
              icon="events"
              variant="tinted"
              onPress={() => router.push(user ? { pathname: '/event/new', params: { spotId: String(spot.id) } } : '/login')}
            />
          </View>

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
        <PillButton title={t('spot.navigate')} icon="navigate" onPress={navigate} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
