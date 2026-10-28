import React from 'react';
import { router } from 'expo-router';
import { Screen, TopBar } from '../components/Screen';
import { Body, Button } from '../components/ui';
import { useI18n } from '../lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Screen>
      <TopBar />
      <Body>{t('common.notFound')}</Body>
      <Button title={t('tabs.explore')} onPress={() => router.replace('/')} />
    </Screen>
  );
}
