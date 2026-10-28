import React from 'react';
import { Screen, TopBar, goBack } from './Screen';
import { Body, Button } from './ui';
import { useI18n } from '../lib/i18n';

/** Shown on edit screens when the logged-in user does not own the item. The server would return 403 anyway. */
export function NotOwner({ fallback }: { fallback: string }) {
  const { t } = useI18n();
  return (
    <Screen>
      <TopBar fallback={fallback} />
      <Body>{t('common.notOwner')}</Body>
      <Button title={t('common.back')} variant="secondary" onPress={() => goBack(fallback)} />
    </Screen>
  );
}
