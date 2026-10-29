import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hero } from '../../components/Hero';
import { carTitle, photoUri } from '../../components/Rows';
import {
  Card, Cell, ErrorState, FormError, GlassView, Icon, IconButton, IconTile, LinkButton, LoadingState, PillButton, Section,
  SectionHeader, StarRating, Txt,
} from '../../components/ui';
import { MoreMenu, type SheetAction } from '../../components/ActionSheet';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/themeContext';
import { useAsync, useRefocus } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { carTotalDisplay, formatAvg, modPriceDisplay, sameId } from '../../lib/format';
import { pickPhoto } from '../../lib/photos';
import { HAIRLINE } from '../../lib/theme';
import type { Mod } from '../../lib/types';
import { specTiles } from '../../lib/carSpecs';

export default function CarScreen() {
  const { id, notice } = useLocalSearchParams<{ id: string; notice?: string }>();
  const { t, d, lang } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data: car, setData, error, loading, reload } = useAsync(() => api.car(id), [id, user?.id]);
  const [actionError, setActionError] = useState<string | null>(notice === 'photo' ? t('addCar.photoAfter') : null);
  const [rating, setRating] = useState(false);
  const [uploading, setUploading] = useState(false);

  useRefocus(reload);

  if (loading && !car) return <LoadingState />;
  if (error || !car) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Hero kind="car" height={140} fallback="/garage" />
        <ErrorState message={errorMessage(error, t)} onRetry={reload} />
      </View>
    );
  }

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

  async function changePhoto() {
    setActionError(null);
    const res = await pickPhoto('car');
    if (!res.ok) {
      if (res.reason !== 'cancelled') setActionError(t(res.reason === 'denied' ? 'profile.photoDenied' : res.reason === 'tooBig' ? 'profile.photoTooBig' : 'profile.photoFailed'));
      return;
    }
    setUploading(true);
    try {
      const r = await api.uploadCarPhoto(car!.id, res.bytes);
      setData({ ...car!, photoUrl: r.photoUrl });
    } catch (e) {
      setActionError(errorMessage(e, t, 'photo'));
    } finally {
      setUploading(false);
    }
  }

  function openMod(mod?: Mod) {
    router.push({ pathname: '/car/mod', params: mod ? { carId: String(car!.id), modId: String(mod.id) } : { carId: String(car!.id) } });
  }

  const specs = specTiles(car, t, d);
  const owner = car.owner.displayName;
  // Owner: real total (all prices) + what others see. Others: only the public total (never private prices).
  const money = carTotalDisplay(car, isOwner, lang);
  const avg = formatAvg(car.ratingAvg, lang);
  const report = () => router.push(user ? { pathname: '/report', params: { targetType: 'car', targetId: String(car.id) } } : '/login');
  const menu: SheetAction[] = isOwner
    ? [{ label: t('garage.deleteCar'), destructive: true, onPress: removeCar }]
    : [{ label: t('spot.report'), destructive: true, onPress: report }];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
      <Hero
        kind="car"
        height={220}
        fallback="/garage"
        photoUri={photoUri(car.photoUrl)}
        right={
          <>
            {isOwner ? (
              <GlassView elevated style={{ height: 44, borderRadius: 22, flexDirection: 'row' }}>
                {car.photoUrl ? <IconButton icon="camera" label={t('addCar.changePhoto')} onPress={changePhoto} style={{ backgroundColor: 'transparent', width: 48 }} /> : null}
                <IconButton icon="edit" label={t('garage.editCar')} onPress={() => router.push(`/car/edit/${car.id}`)} style={{ backgroundColor: 'transparent', width: 48 }} />
              </GlassView>
            ) : null}
            <MoreMenu actions={menu} title={carTitle(car)} />
          </>
        }
        bottomLeft={isOwner && !car.photoUrl && !uploading ? (
          <PillButton title={t('addCar.addPhoto')} icon="camera" variant="secondary" size="small" onPress={changePhoto} />
        ) : null}
        overlay={uploading ? <ActivityIndicator color="#FFFFFF" /> : null}
      />
      <View style={{ padding: 16, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, paddingHorizontal: 4 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt variant="title1" accessibilityRole="header">{carTitle(car)}</Txt>
            <Txt variant="subhead" tone="label2">
              {car.year} ·{' '}
              <Txt variant="subhead" tone="tint" accessibilityRole="link" onPress={() => router.push(`/user/${car.owner.id}`)}>{owner}</Txt>
            </Txt>
          </View>
          {car.ratingCount ? (
            <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={t('garage.votes', { avg, count: car.ratingCount })}>
              <Txt variant="title3" style={{ fontWeight: '700' }}>{`★ ${avg}`}</Txt>
              <Txt variant="footnote" tone="label2">{t('car.votes', { count: car.ratingCount })}</Txt>
            </View>
          ) : null}
        </View>

        {specs.length ? (
          <Card padded={false} style={{ flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 6 }}>
            {specs.map((s, i) => (
              <View
                key={s.k}
                style={{ flex: 1, alignItems: 'center', gap: 2, borderRightWidth: i === specs.length - 1 ? 0 : HAIRLINE, borderRightColor: c.separator, paddingHorizontal: 2 }}
                accessible
                accessibilityLabel={`${s.k}: ${s.v}`}
              >
                <Txt variant="caption" tone="label2" numberOfLines={1}>{s.k}</Txt>
                <Txt variant="headline" style={{ fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>{s.v}</Txt>
              </View>
            ))}
          </Card>
        ) : isOwner ? (
          <Card><Txt variant="subhead" tone="label2">{t('addCar.specsManual')}</Txt></Card>
        ) : null}

        {car.description ? <Card><Txt>{car.description}</Txt></Card> : null}

        <View style={{ gap: 6 }}>
          <SectionHeader
            title={`${t('garage.modifications')} · ${car.mods.length}`}
            right={isOwner ? <LinkButton title={`+ ${t('garage.addModShort')}`} onPress={() => openMod()} accessibilityLabel={t('garage.addModShort')} /> : undefined}
          />
          <Card padded={false}>
            {car.mods.length === 0 ? <Txt tone="label2" style={{ padding: 16 }}>{t('garage.noMods')}</Txt> : null}
            {car.mods.map((m) => {
              const p = modPriceDisplay(m, lang);
              const ownerOnly = p.kind === 'price' && p.hiddenFromOthers;
              const priceText = p.kind === 'price' ? p.text : p.kind === 'private' ? t('garage.private') : t('garage.noPrice');
              const cat = d.mod.categories[m.category as keyof typeof d.mod.categories] ?? m.category;
              const priceA11y = ownerOnly ? `${priceText}, ${t('car.onlyYou')}` : priceText;
              return (
                <Cell
                  key={m.id}
                  title={m.name}
                  subtitle={cat}
                  left={<IconTile icon="wrench" bg={undefined} tone="stone" />}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 2, maxWidth: 150 }}>
                      <Txt variant="subhead" style={{ fontWeight: '600' }} color={p.kind === 'price' ? c.label : c.label2} numberOfLines={1}>{priceText}</Txt>
                      {ownerOnly || p.kind === 'private' ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          <Icon name="lock" size={11} color={c.label2} strokeWidth={2.4} />
                          {ownerOnly ? <Txt variant="caption" tone="label2">{t('car.onlyYou')}</Txt> : null}
                        </View>
                      ) : null}
                    </View>
                  }
                  onPress={isOwner ? () => openMod(m) : undefined}
                  chevron={isOwner}
                  accessibilityLabel={isOwner ? `${t('mod.editMod', { name: m.name })}, ${priceA11y}` : `${m.name}, ${cat}, ${priceA11y}`}
                  minHeight={60}
                />
              );
            })}
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56, backgroundColor: c.tintSoft }}
              accessible
              accessibilityLabel={[`${t('garage.totalShort')}: ${money.total}`, money.othersSee ? t('car.othersSee', { amount: money.othersSee }) : null].filter(Boolean).join('. ')}
            >
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Txt variant="headline" color={c.tintSoftText}>{t('garage.totalShort')}</Txt>
                {money.othersSee ? <Txt variant="footnote" color={c.tintSoftText}>{t('car.othersSee', { amount: money.othersSee })}</Txt> : null}
              </View>
              <Txt variant="title3" color={c.tintSoftText} style={{ fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{money.total}</Txt>
            </View>
          </Card>
        </View>

        {isOwner ? null : (
          <Section header={t('garage.rateTitle')}>
            <View style={{ alignItems: 'center', paddingVertical: 4 }}>
              <StarRating value={car.myRating ?? 0} onChange={rate} disabled={rating} size={30}
                labelFor={(n) => t('spot.rateStar', { n, count: n })} label={t('spot.starsLabel')} />
            </View>
          </Section>
        )}
        <FormError message={actionError} />
      </View>
    </ScrollView>
  );
}
