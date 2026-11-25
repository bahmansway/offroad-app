import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Cell, EmptyState, IconTile, LargeTitleScreen, LoadingState, PillButton, Section } from '../../components/ui';
import { ProfileView } from '../../components/ProfileView';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';

/** Profil tab: my v6 profile (posts grid, garage, saved). Settings live behind the gear. */
export default function ProfileTab() {
  const { t } = useI18n();
  const { user, loading, offline, retry } = useAuth();
  if (loading) return <LoadingState />;
  if (user) return <ProfileView userId={user.id} tabRoot />;
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
      <Section>
        <Cell title={t('settings.title')} left={<IconTile icon="gear" />} onPress={() => router.push('/settings')} accessibilityRole="link" />
      </Section>
    </LargeTitleScreen>
  );
}
