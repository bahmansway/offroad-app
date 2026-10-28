import React, { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Hero } from '../../components/Hero';
import { Body, Button, Card, ErrorState, Eyebrow, FormError, H1, IconButton, LevelPips, Loading, Muted, Stars, Tag } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync, useRefocus } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { distanceFromBaku, formatDistance, formatRating, levelColor, sameId, tintFor } from '../../lib/format';
import { colors, fonts } from '../../lib/theme';

export default function SpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, d, lang } = useI18n();
  const { user } = useAuth();
  const { data: spot, setData, error, loading, reload } = useAsync(() => api.spot(id), [id, user?.id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rating, setRating] = useState(false);

  // refresh after coming back from the edit screen
  useRefocus(reload);

  if (loading && !spot) return <Loading />;
  if (error || !spot) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Hero tint={colors.surface} kind="hills" height={120} fallback="/" /><ErrorState message={errorMessage(error, t)} onRetry={reload} /></View>;

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

  const ratedText = spot.ratingCount > 0
    ? t('spot.ratedBy', { avg: formatRating(spot.ratingAvg), count: spot.ratingCount })
    : t('spot.notRated');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Hero
        tint={tintFor(spot.id)}
        kind="hills"
        height={200}
        fallback="/"
        right={isOwner ? (
          <>
            <IconButton icon="edit" label={t('common.edit')} onPress={() => router.push(`/spot/edit/${spot.id}`)} />
            <IconButton icon="trash" label={t('common.delete')} onPress={remove} color={colors.danger} />
          </>
        ) : null}
      />
      <View style={styles.body}>
        <View style={{ gap: 6 }}>
          <H1>{spot.name}</H1>
          <Muted>
            {spot.type === 'trail' ? t('spot.trail') : t('spot.camp')}
            {' · '}
            <Text
              accessibilityRole="link"
              onPress={() => router.push(`/user/${spot.owner.id}`)}
              style={{ color: colors.accent }}
            >
              {t('spot.sharedBy', { name: spot.owner.displayName })}
            </Text>
            {' · '}
            {t('spot.fromBaku', { km: formatDistance(km, lang) })}
          </Muted>
        </View>

        <View style={styles.cards}>
          <Card style={{ flex: 1, gap: 6, padding: 12 }}>
            <Eyebrow>{t('spot.difficulty')}</Eyebrow>
            {spot.type === 'trail' && spot.difficulty ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.bigNum, { color: levelColor(spot.difficulty) }]}>{spot.difficulty}</Text>
                  <LevelPips level={spot.difficulty} size="lg" />
                </View>
                <Body style={{ fontSize: 13 }}>
                  {d.levels.names[spot.difficulty - 1]} · {d.levels.explain[spot.difficulty - 1]}
                </Body>
              </>
            ) : (
              <Body style={{ fontSize: 13 }}>{t('spot.noDifficulty')}</Body>
            )}
          </Card>
          <Card style={{ flex: 1, gap: 6, padding: 12 }}>
            <Eyebrow>{t('spot.bestSeason')}</Eyebrow>
            <Text style={styles.season}>{spot.season || t('spot.anySeason')}</Text>
          </Card>
        </View>

        <View style={styles.tags}>
          {spot.tags.map((tag) => <Tag key={tag} label={tag} />)}
          <Tag label={ratedText} />
        </View>

        <View style={{ gap: 6 }}>
          <Eyebrow>{t('spot.description')}</Eyebrow>
          <Body style={{ lineHeight: 22 }}>{spot.description || t('spot.noDescription')}</Body>
        </View>

        <Card style={styles.rateRow}>
          <Text style={styles.rateTitle}>{t('spot.rateTitle')}</Text>
          <Stars
            value={spot.myRating ?? 0}
            onChange={rate}
            disabled={rating}
            labelFor={(n) => t('spot.rateStar', { n, count: n })}
            label={t('spot.starsLabel')}
          />
        </Card>
        <FormError message={actionError} />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={t('spot.navigate')} icon="pin" variant="secondary" style={{ flex: 1 }} onPress={navigate} />
          {!isOwner ? (
            <Button
              title={t('spot.report')}
              icon="flag"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push(user ? { pathname: '/report', params: { targetType: 'spot', targetId: String(spot.id) } } : '/login')}
            />
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
  cards: { flexDirection: 'row', gap: 10 },
  bigNum: { fontFamily: fonts.head, fontSize: 28 },
  season: { fontFamily: fonts.head, fontSize: 22, color: colors.text },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', paddingVertical: 8, paddingHorizontal: 12 },
  rateTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
});
