import React from 'react';
import { ComingSoon } from '../../components/ComingSoon';
import { useI18n } from '../../lib/i18n';

export default function EventsTab() {
  const { t } = useI18n();
  return <ComingSoon title={t('tabs.events')} icon="calendar" />;
}
