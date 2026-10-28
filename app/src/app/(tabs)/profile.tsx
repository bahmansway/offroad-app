import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { CarCell, photoUri } from '../../components/Rows';
import {
  Avatar, Cell, EmptyState, Icon, FormError, IconTile, LargeTitleScreen, PillButton, Section, SegmentedControl, Txt,
  useTheme,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { confirmAsync } from '../../lib/dialogs';
import { errorMessage } from '../../lib/errors';
import { pickPhoto } from '../../lib/photos';
import { radius } from '../../lib/theme';
import type { Lang } from '../../lib/format';
import type { CarSummary } from '../../lib/types';

export default function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const { c, pref } = useTheme();
  const { user, logout, offline, retry, updateUser, refreshUser } = useAuth();
  const [cars, setCars] = useState<CarSummary[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    if (!user) { setCars(null); return; }
    api.cars(user.id).then((r) => setCars(r.items)).catch(() => setCars([]));
    // Current car may have been edited, re-photographed or deleted elsewhere.
    refreshUser().catch(() => {});
  }, [user?.id]));

  async function doLogout() {
    if (await confirmAsync(t('profile.logoutConfirm'), t('profile.logout'), t('common.cancel'))) await logout();
  }

  async function changeAvatar() {
    setError(null);
    const res = await pickPhoto('avatar');
    if (!res.ok) {
      if (res.reason !== 'cancelled') setError(t(res.reason === 'denied' ? 'profile.photoDenied' : res.reason === 'tooBig' ? 'profile.photoTooBig' : 'profile.photoFailed'));
      return;
    }
    setUploading(true);
    try {
      const r = await api.uploadAvatar(res.bytes);
      updateUser({ avatarUrl: r.avatarUrl });
    } catch (e) {
      setError(errorMessage(e, t, 'photo'));
    } finally {
      setUploading(false);
    }
  }

  const appearanceLabel = { auto: t('profile.appearanceAuto'), light: t('profile.appearanceLight'), dark: t('profile.appearanceDark') }[pref];
  const version = Constants.expoConfig?.version ?? '';

  const settings = (
    <Section header={t('profile.app')}>
      <Cell
        title={t('profile.language')}
        left={<IconTile icon="globe" bg={c.blue} />}
        right={
          <SegmentedControl<Lang>
            compact
            label={t('profile.language')}
            value={lang}
            onChange={setLang}
            options={[{ value: 'az', label: 'AZ', a11y: 'Azərbaycanca' }, { value: 'en', label: 'EN', a11y: 'English' }]}
          />
        }
        minHeight={56}
      />
      <Cell title={t('profile.appearance')} value={appearanceLabel} left={<IconTile icon="moon" bg={c.indigo} />} onPress={() => router.push('/about?section=appearance')} />
      <Cell title={t('profile.about')} left={<IconTile icon="info" bg={c.gray} />} onPress={() => router.push('/about')} />
    </Section>
  );

  if (!user) {
    return (
      <LargeTitleScreen title={t('profile.title')}>
        {offline ? (
          <EmptyState icon="info" title={t('errors.offline')} actionLabel={t('common.retry')} onAction={retry} />
        ) : (
          <View style={{ gap: 12 }}>
            <EmptyState icon="profile" title={t('profile.loginToSee')} />
            <PillButton title={t('common.login')} onPress={() => router.push('/login')} />
            <PillButton title={t('auth.registerTitle')} variant="gray" onPress={() => router.push('/register')} />
          </View>
        )}
        {settings}
        <Txt variant="footnote" tone="label2" center>{t('common.version', { v: version })}</Txt>
      </LargeTitleScreen>
    );
  }

  const current = user.currentCar ?? null;
  const subtitle = [user.city, user.email].filter(Boolean).join(' · ');

  return (
    <LargeTitleScreen title={t('profile.title')}>
      {/* identity card */}
      <View style={{ backgroundColor: c.card, borderRadius: radius.card, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, paddingHorizontal: 16 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={user.avatarUrl ? t('profile.changePhoto') : t('profile.addPhoto')}
          onPress={changeAvatar}
          disabled={uploading}
        >
          <Avatar uri={photoUri(user.avatarUrl)} name={user.displayName} size={60} />
          <View style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: c.tint, borderWidth: 2, borderColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            {uploading ? <ActivityIndicator size="small" color={c.onTint} /> : <Icon name="camera" size={13} color={c.onTint} strokeWidth={2.4} />}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${user.displayName}, ${t('profile.publicProfile')}`}
          onPress={() => router.push(`/user/${user.id}`)}
          style={({ pressed }) => [{ flex: 1, minWidth: 0, gap: 2, flexDirection: 'row', alignItems: 'center' }, pressed && { opacity: 0.6 }]}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt variant="title3" numberOfLines={1}>{user.displayName}</Txt>
            {subtitle ? <Txt variant="subhead" tone="label2" numberOfLines={1}>{subtitle}</Txt> : null}
            {user.bio ? <Txt variant="footnote" tone="label2" numberOfLines={2}>{user.bio}</Txt> : null}
          </View>
        </Pressable>
      </View>
      <FormError message={error} />

      <Section>
        <Cell title={t('profile.edit')} left={<IconTile icon="edit" />} onPress={() => router.push('/profile/edit')} />
      </Section>

      <Section header={t('profile.currentCar')} footer={t('profile.currentCarHint')}>
        {current ? (
          <CarCell car={current} onPress={() => router.push('/profile/current-car')} />
        ) : (
          <Cell title={t('profile.chooseCurrentCar')} action left={<IconTile icon="garage" />} onPress={() => router.push('/profile/current-car')} />
        )}
      </Section>

      <Section
        header={t('profile.myCars')}
        right={<Pressable accessibilityRole="button" onPress={() => router.push('/car/add')} hitSlop={8} style={{ minHeight: 28, justifyContent: 'center' }}><Txt variant="subhead" tone="tint">{t('garage.addModShort')}</Txt></Pressable>}
      >
        {cars === null ? <View style={{ padding: 16 }}><ActivityIndicator color={c.label2} /></View> : null}
        {cars?.length === 0 ? <Cell title={t('garage.addCar')} action left={<IconTile icon="plus" />} onPress={() => router.push('/car/add')} /> : null}
        {cars?.map((car) => <CarCell key={car.id} car={car} onPress={() => router.push(`/car/${car.id}`)} />)}
      </Section>

      {settings}

      <Section header={t('profile.account')}>
        {user.email ? <Cell title={t('profile.email')} value={user.email} left={<IconTile icon="mail" bg={c.gray} />} /> : null}
        <Cell title={t('profile.publicProfile')} left={<IconTile icon="user" bg={c.gray} />} onPress={() => router.push(`/user/${user.id}`)} />
      </Section>

      <Section>
        <Cell title={t('profile.logout')} destructive center chevron={false} onPress={doLogout} />
      </Section>
      <Txt variant="footnote" tone="label2" center>{t('common.version', { v: version })}</Txt>
    </LargeTitleScreen>
  );
}

