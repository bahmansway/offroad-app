import React, { useState } from 'react';
import { View } from 'react-native';
import { Icon, MountainMark, PillButton, SheetScreen, Txt, goBack, useTheme } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { useNotifications } from '../lib/notifications';

/** Short explanation shown once before the system "Allow notifications?" prompt. */
export default function NotificationsIntro() {
  const { t } = useI18n();
  const { c } = useTheme();
  const n = useNotifications();
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    try {
      await n.requestPermission();
    } finally {
      setBusy(false);
      goBack('/');
    }
  }
  async function later() {
    await n.dismissPrePrompt();
    goBack('/');
  }

  return (
    <SheetScreen
      onBack={later}
      cancelLabel={t('notifications.introLater')}
      footer={
        <View style={{ gap: 8, padding: 16 }}>
          <PillButton title={t('notifications.introAllow')} icon="bell" onPress={allow} loading={busy} />
          <PillButton title={t('notifications.introLater')} variant="plain" onPress={later} disabled={busy} />
        </View>
      }
    >
      <View style={{ alignItems: 'center', paddingHorizontal: 28, paddingTop: 24, gap: 16 }}>
        <View
          style={{ width: 88, height: 88, borderRadius: 24, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <MountainMark size={56} color={c.onTint} />
          <View style={{ position: 'absolute', right: -6, top: -6, width: 32, height: 32, borderRadius: 16, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={18} color={c.tint} strokeWidth={2.4} />
          </View>
        </View>
        <Txt variant="title2" center accessibilityRole="header">{t('notifications.introTitle')}</Txt>
        <Txt tone="label2" center>{t('notifications.introText')}</Txt>
        <Txt variant="footnote" tone="label2" center>{t('notifications.introHint')}</Txt>
      </View>
    </SheetScreen>
  );
}
