import React from 'react';
import { EmptyState, LargeTitleScreen } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

/** Placeholder until the chat & clans screens land (they replace this file). */
export default function ChatTab() {
  const { t } = useI18n();
  return (
    <LargeTitleScreen title={t('chat.title')} scroll={false} contentStyle={{ justifyContent: 'center' }}>
      <EmptyState icon="chat" title={t('chat.soonTitle')} text={t('chat.soonText')} />
    </LargeTitleScreen>
  );
}
