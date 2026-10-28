import React from 'react';
import { EmptyState, LargeTitleScreen } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

export default function EventsTab() {
  const { t } = useI18n();
  return (
    <LargeTitleScreen title={t('tabs.events')} scroll={false} contentStyle={{ justifyContent: 'center' }}>
      <EmptyState icon="events" title={t('common.comingSoon')} text={t('common.comingSoonText')} />
    </LargeTitleScreen>
  );
}
