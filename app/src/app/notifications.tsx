import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { Cell, ErrorState, FormError, IconTile, LoadingState, NavScreen, Section, SwitchCell, useTheme } from '../components/ui';
import { RequireAuth } from '../components/RequireAuth';
import { useI18n } from '../lib/i18n';
import { useNotifications } from '../lib/notifications';
import type { NotificationSettings } from '../lib/types';

type Key = keyof NotificationSettings;

/** Profile → "Bildirişlər": the 4 server switches + event reminders on this phone. */
export default function NotificationSettingsScreen() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}

function Settings() {
  const { t } = useI18n();
  const { c } = useTheme();
  const n = useNotifications();
  const [error, setError] = useState<string | null>(null);
  const s = n.settings;

  async function toggle(key: Key, value: boolean) {
    setError(null);
    try {
      await n.updateSettings({ [key]: value });
    } catch {
      setError(t('notifications.saveFailed'));
    }
  }

  const rows: { key: Key; icon: 'chat' | 'people' | 'invite' | 'events'; hint: string }[] = [
    { key: 'messages', icon: 'chat', hint: t('notifications.messagesHint') },
    { key: 'friends', icon: 'people', hint: t('notifications.friendsHint') },
    { key: 'clans', icon: 'invite', hint: t('notifications.clansHint') },
    { key: 'events', icon: 'events', hint: t('notifications.eventsHint') },
  ];

  const phoneFooter = !n.supported
    ? t('notifications.webNote')
    : n.expoGo
      ? t('notifications.expoGoNote')
      : undefined;

  return (
    <NavScreen title={t('notifications.title')} fallback="/profile">
      <View style={{ gap: 20, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        {n.supported && n.permission === 'denied' ? (
          <Section footer={t('notifications.permissionOff')}>
            <Cell title={t('notifications.openSettings')} action left={<IconTile icon="bellOff" bg={c.gray} />} onPress={n.openSystemSettings} />
          </Section>
        ) : null}
        {n.supported && n.permission === 'undetermined' ? (
          <Section>
            <Cell title={t('notifications.permissionAsk')} action left={<IconTile icon="bell" />} onPress={() => { n.requestPermission(); }} />
          </Section>
        ) : null}

        {s === null ? (
          n.settingsError
            ? <ErrorState message={t('notifications.loadFailed')} onRetry={n.reloadSettings} />
            : <LoadingState inline />
        ) : (
          <Section header={t('notifications.phoneSection')} footer={phoneFooter}>
            {rows.map((r, i) => (
              <SwitchCell
                key={r.key}
                title={t(`notifications.${r.key}`)}
                subtitle={r.hint}
                value={s[r.key]}
                onValueChange={(v) => toggle(r.key, v)}
                left={<IconTile icon={r.icon} />}
                last={i === rows.length - 1}
              />
            ))}
          </Section>
        )}
        <FormError message={error} />

        {/* local reminders exist only in the phone app */}
        {Platform.OS !== 'web' && n.supported ? (
          <Section
            header={t('notifications.remindersSection')}
            footer={s?.events === false ? t('notifications.remindersOffByEvents') : t('notifications.remindersHint')}
          >
            <SwitchCell
              title={t('notifications.reminders')}
              value={n.remindersEnabled && s?.events !== false}
              onValueChange={(v) => n.setRemindersEnabled(v)}
              left={<IconTile icon="clock" tone="sand" />}
              last
            />
          </Section>
        ) : null}
      </View>
    </NavScreen>
  );
}
