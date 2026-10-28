import React from 'react';
import { NavScreen, goBack } from './ui/Screen';
import { EmptyState } from './ui/States';
import { useI18n } from '../lib/i18n';

/** Shown on edit screens when the logged-in user does not own the item. The server would return 403 anyway. */
export function NotOwner({ fallback }: { fallback: string }) {
  const { t } = useI18n();
  return (
    <NavScreen fallback={fallback}>
      <EmptyState icon="lock" title={t('common.notOwner')} actionLabel={t('common.back')} onAction={() => goBack(fallback)} />
    </NavScreen>
  );
}
