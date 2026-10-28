import React from 'react';
import { ComingSoon } from '../../components/ComingSoon';
import { useI18n } from '../../lib/i18n';

export default function ChatTab() {
  const { t } = useI18n();
  return <ComingSoon title={t('tabs.chat')} icon="chat" />;
}
