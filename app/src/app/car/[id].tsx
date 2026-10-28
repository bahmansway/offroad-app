import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Hero } from '../../components/Hero';
import { carTitle } from '../../components/CarRow';
import { Body, Button, Card, ErrorState, FormError, H1, H2, IconButton, Loading, Muted, Stars } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync, useRefocus } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { formatRating, formatTotals, modPriceDisplay, sameId, sumVisiblePrices, tintFor } from '../../lib/format';
import { colors, fonts, radius } from '../../lib/theme';
import type { Mod } from '../../lib/types';

export default function CarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, d, lang } = useI18n();
  const { user } = useAuth();
  const { data: car, setData, error, loading, reload } = useAsync(() => api.car(id), [id, user?.id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rating, setRating] = useState(false);

  useRefocus(reload);

  if (loading && !car) return <Loading />;
  if (error || !car) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Hero tint={colors.surface} kind="car" height={120} fallback="/garage" /><ErrorState message={errorMessage(error, t)} onRetry={reload} /></View>;

  const isOwner = sameId(user?.id, car.owner.id);

  async function rate(n: number) {
    if (!user) return router.push('/login');
    setRating(true);
    setActionError(null);
    try {
      const r = await api.rateCar(car!.id, n);
      setData({ ...car!, ...r });
    } catch (e) {
      setActionError(errorMessage(e, t));
    } finally {
      setRating(false);
    }
  }

  async function removeCar() {
    if (!(await confirmAsync(t('garage.deleteCarConfirm'), t('common.delete'), t('common.cancel')))) return;
    try {
      await api.deleteCar(car!.id);
      router.replace('/garage');
    } catch (e) {
      setActionError(errorMessage(e, t));
    }
  }

  function openMod(mod?: Mod) {
    router.push({ pathname: '/car/mod', params: mod ? { carId: String(car!.id), modId: String(mod.id) } : { carId: String(car!.id) } });
  }

  const meta = [String(car.year), car.engine].filter(Boolean).join(' · ');
  // The owner sees every price, so their "total" includes hidden ones too.
  const ownerTotal = isOwner ? formatTotals(sumVisiblePrices(car.mods), lang) : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Hero
        tint={tintFor(car.id)}
        kind="car"
        height={180}
        fallback="/garage"
        right={isOwner ? (
          <>
            <IconButton icon="edit" label={t('garage.editCar')} onPress={() => router.push(`/car/edit/${car.id}`)} />
            <IconButton icon="trash" label={t('common.delete')} onPress={removeCar} color={colors.danger} />
          </>
        ) : (
          <IconButton
            icon="flag"
            label={t('spot.report')}
            onPress={() => router.push(user ? { pathname: '/report', params: { targetType: 'car', targetId: String(car.id) } } : '/login')}
          />
        )}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <H1 style={{ fontSize: 28 }}>{carTitle(car)}</H1>
            <Muted>
              {meta}
              {' · '}
              <Text accessibilityRole="link" onPress={() => router.push(`/user/${car.owner.id}`)} style={{ color: colors.accent }}>
                {car.owner.displayName}
              </Text>
            </Muted>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }} accessible accessibilityLabel={`★ ${formatRating(car.ratingAvg)}, ${t('garage.ratings', { count: car.ratingCount })}`}>
            <Text style={styles.ratingBig}>{formatRating(car.ratingAvg)}</Text>
            <Muted style={{ fontSize: 12 }}>{t('garage.ratings', { count: car.ratingCount })}</Muted>
          </View>
        </View>

        {car.description ? <Body style={{ lineHeight: 22 }}>{car.description}</Body> : null}

        {isOwner ? (
          <Muted style={{ fontSize: 13 }}>{t('garage.ownCarNoRate')}</Muted>
        ) : (
          <Card style={styles.rateRow}>
            <Text style={styles.rateTitle}>{t('garage.rateTitle')}</Text>
            <Stars value={car.myRating ?? 0} onChange={rate} disabled={rating} labelFor={(n) => t('spot.rateStar', { n, count: n })}
            label={t('spot.starsLabel')} />
          </Card>
        )}
        <FormError message={actionError} />

        <View style={styles.modsHead}>
          <H2>{t('garage.modifications')}</H2>
          <Muted style={{ fontSize: 13 }}>{t('garage.modsCount', { count: car.mods.length })}</Muted>
        </View>

        <View style={styles.modsBox}>
          {car.mods.length === 0 ? <Muted style={{ padding: 12 }}>{t('garage.noMods')}</Muted> : null}
          {car.mods.map((m) => {
            const p = modPriceDisplay(m, lang);
            const priceText = p.kind === 'price' ? p.text : p.kind === 'private' ? t('garage.private') : t('garage.noPrice');
            const content = (
              <>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={styles.modName}>{m.name}</Text>
                  <Text style={styles.modCat}>{d.mod.categories[m.category as keyof typeof d.mod.categories] ?? m.category}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={[styles.price, p.kind !== 'price' && { color: colors.muted }]}>{priceText}</Text>
                  {p.kind === 'price' && p.hiddenFromOthers ? (
                    <View style={styles.hiddenRow}>
                      <Icon name="eyeOff" size={12} color={colors.muted} />
                      <Text style={styles.hiddenText}>{t('garage.hiddenFromOthers')}</Text>
                    </View>
                  ) : null}
                </View>
                {isOwner ? <Icon name="chevron" size={16} color={colors.muted} /> : null}
              </>
            );
            return isOwner ? (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={`${t('mod.editMod', { name: m.name })}, ${priceText}`}
                onPress={() => openMod(m)}
                style={({ pressed }) => [styles.modRow, pressed && { backgroundColor: colors.surface2 }]}
              >
                {content}
              </Pressable>
            ) : (
              <View key={m.id} style={styles.modRow} accessible accessibilityLabel={`${m.name}, ${priceText}`}>{content}</View>
            );
          })}
          <View style={styles.totalRow}>
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Text style={styles.totalLabel}>{t('garage.totalSpend')}</Text>
              {car.hiddenPriceCount > 0 ? (
                <Text style={styles.hiddenText}>{t('garage.hiddenCount', { count: car.hiddenPriceCount })}</Text>
              ) : null}
            </View>
            <Text style={styles.totalValue}>{formatTotals(car.totalPublicSpend, lang)}</Text>
          </View>
          {isOwner && car.hiddenPriceCount > 0 && ownerTotal ? (
            <View style={[styles.totalRow, { paddingTop: 0 }]}>
              <Text style={styles.hiddenText}>{t('garage.totalAll')}</Text>
              <Text style={[styles.price, { color: colors.muted }]}>{ownerTotal}</Text>
            </View>
          ) : null}
        </View>

        {isOwner ? <Button title={t('garage.addMod')} variant="dashed" onPress={() => openMod()} /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  ratingBig: { fontFamily: fonts.head, fontSize: 28, color: colors.accent },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', paddingVertical: 8, paddingHorizontal: 12 },
  rateTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  modsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  modsBox: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.surface2 },
  modName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  modCat: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  price: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  hiddenRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hiddenText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12, backgroundColor: colors.surface2 },
  totalLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  totalValue: { fontFamily: fonts.head, fontSize: 22, color: colors.accent, flexShrink: 1, textAlign: 'right' },
});
