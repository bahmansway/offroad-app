import React from 'react';
import { router } from 'expo-router';
import { EmptyState, NavScreen } from '../components/ui';
import { useI18n } from '../lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <NavScreen>
      <EmptyState icon="explore" title={t('common.notFound')} actionLabel={t('tabs.explore')} onAction={() => router.replace('/')} />
    </NavScreen>
  );
}
