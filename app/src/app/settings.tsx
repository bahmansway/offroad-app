import React, { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { Cell, IconTile, NavScreen, Section, SegmentedControl, Txt, useTheme } from '../components/ui';
import { CarCell } from '../components/Rows';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { confirmAsync } from '../lib/dialogs';
import { loadSetting, saveSetting } from '../lib/settingsStore';
import { clearFeedCache } from '../lib/homeLogic';
import { NAV_APP_NAMES, NAV_PREF_KEY, parseNavPref, type NavApp } from '../lib/navigateLogic';
import type { Lang } from '../lib/format';

/** Settings behind the profile gear: language, appearance, notifications, navigation app, current car, about, log out. */
export default function SettingsScreen() {
  const { t, lang, setLang } = useI18n();
  const { c, pref } = useTheme();
  const { user, logout } = useAuth();
  const [navApp, setNavApp] = useState<NavApp | null>(null);

  useFocusEffect(useCallback(() => {
    loadSetting(NAV_PREF_KEY).then((v) => setNavApp(parseNavPref(v, Platform.OS)));
  }, []));

  async function doLogout() {
    if (!(await confirmAsync(t('profile.logoutConfirm'), t('profile.logout'), t('common.cancel')))) return;
    clearFeedCache();
    await logout();
    router.replace('/');
  }

  const appearanceLabel = { auto: t('profile.appearanceAuto'), light: t('profile.appearanceLight'), dark: t('profile.appearanceDark') }[pref];
  const version = Constants.expoConfig?.version ?? '';
  const current = user?.currentCar ?? null;

  return (
    <NavScreen title={t('settings.title')} fallback="/profile">
      <Section header={t('profile.app')}>
        <Cell
          title={t('profile.language')}
          left={<IconTile icon="globe" bg={c.blue} />}
          right={
            <SegmentedControl<Lang>
              compact
              label={t('profile.language')}
              value={lang}
              onChange={setLang}
              options={[{ value: 'az', label: 'AZ', a11y: 'Azərbaycanca' }, { value: 'en', label: 'EN', a11y: 'English' }]}
            />
          }
          minHeight={56}
        />
        <Cell title={t('profile.appearance')} value={appearanceLabel} left={<IconTile icon="moon" bg={c.indigo} />} onPress={() => router.push('/about?section=appearance')} />
        {user ? (
          <Cell title={t('notifications.title')} subtitle={t('notifications.rowSubtitle')} left={<IconTile icon="bell" />} onPress={() => router.push('/notifications')} accessibilityRole="link" />
        ) : null}
        <Cell
          title={t('settings.navApp')}
          value={navApp ? NAV_APP_NAMES[navApp] : t('settings.navAsk')}
          left={<IconTile icon="navigate" bg={c.green} />}
          right={navApp ? <Txt tone="tint">{t('settings.navReset')}</Txt> : undefined}
          onPress={navApp ? () => { saveSetting(NAV_PREF_KEY, ''); setNavApp(null); } : undefined}
          accessibilityLabel={navApp ? `${t('settings.navApp')}: ${NAV_APP_NAMES[navApp]}. ${t('settings.navReset')}` : `${t('settings.navApp')}: ${t('settings.navAsk')}`}
        />
      </Section>
      <Txt variant="footnote" tone="label2" style={{ marginTop: -12, paddingHorizontal: 20 }}>{t('settings.navFooter')}</Txt>

      {user ? (
        <Section header={t('profile.currentCar')} footer={t('profile.currentCarHint')}>
          {current ? (
            <CarCell car={current} onPress={() => router.push('/profile/current-car')} />
          ) : (
            <Cell title={t('profile.chooseCurrentCar')} action left={<IconTile icon="garage" />} onPress={() => router.push('/profile/current-car')} />
          )}
        </Section>
      ) : null}

      {user ? (
        <Section header={t('settings.account')}>
          {user.email ? <Cell title={t('profile.email')} value={user.email} left={<IconTile icon="mail" bg={c.gray} />} /> : null}
          <Cell title={t('settings.points')} left={<IconTile icon="trophy" tone="sand" />} onPress={() => router.push('/leaderboard')} accessibilityRole="link" />
          <Cell title={t('profile.edit')} left={<IconTile icon="edit" />} onPress={() => router.push('/profile/edit')} />
        </Section>
      ) : null}

      <Section>
        <Cell title={t('profile.about')} left={<IconTile icon="info" bg={c.gray} />} onPress={() => router.push('/about')} />
      </Section>

      {user ? (
        <Section>
          <Cell title={t('profile.logout')} destructive center chevron={false} onPress={doLogout} />
        </Section>
      ) : null}
      <Txt variant="footnote" tone="label2" center>{t('common.version', { v: version })}</Txt>
    </NavScreen>
  );
}
