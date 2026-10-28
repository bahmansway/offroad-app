import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Screen, TopBar } from './Screen';
import { Body, Button, Loading } from './ui';


/** Shows a login prompt instead of `children` when nobody is logged in. */
export function RequireAuth({ children, message }: { children: React.ReactNode; message?: string }) {
  const { user, loading, offline, retry } = useAuth();
  const { t } = useI18n();
  if (loading) return <Loading />;
  if (!user && offline) {
    return (
      <Screen>
        <TopBar />
        <View style={{ gap: 14, paddingTop: 24 }}>
          <Body>{t('errors.offline')}</Body>
          <Button title={t('common.retry')} onPress={retry} />
        </View>
      </Screen>
    );
  }
  if (!user) {
    return (
      <Screen>
        <TopBar />
        <View style={{ gap: 14, paddingTop: 24 }}>
          <Body>{message ?? t('common.loginRequired')}</Body>
          <Button title={t('common.login')} onPress={() => router.push('/login')} />
        </View>
      </Screen>
    );
  }
  return <>{children}</>;
}
