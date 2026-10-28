import React from 'react';
import { View } from 'react-native';
import { Screen } from './Screen';
import { Body, H1, Muted } from './ui';
import { Icon, type IconName } from './Icon';
import { colors } from '../lib/theme';
import { useI18n } from '../lib/i18n';

export function ComingSoon({ title, icon }: { title: string; icon: IconName }) {
  const { t } = useI18n();
  return (
    <Screen scroll={false}>
      <H1>{title}</H1>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Icon name={icon} size={48} color={colors.accent} />
        <Body style={{ fontSize: 20 }}>{t('common.comingSoon')}</Body>
        <Muted style={{ textAlign: 'center' }}>{t('common.comingSoonText')}</Muted>
      </View>
    </Screen>
  );
}
