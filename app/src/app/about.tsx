import React from 'react';
import { Linking, Platform, View } from 'react-native';
import { Cell, IconTile, Section, SheetScreen, Txt, goBack, useTheme } from '../components/ui';
import { Wordmark } from '../components/Brand';
import { useI18n } from '../lib/i18n';
import { CAR_LIST_SOURCE_URL, MIT_GLOBAL_CAR_MODELS } from '../lib/licences';
import type { AppearancePref } from '../lib/theme';

/** Profile → Appearance + About & licences (MIT notice for the car list). */
export default function AboutScreen() {
  const { t } = useI18n();
  const { c, pref, setPref } = useTheme();
  const opts: { v: AppearancePref; label: string }[] = [
    { v: 'auto', label: t('profile.appearanceAuto') },
    { v: 'light', label: t('profile.appearanceLight') },
    { v: 'dark', label: t('profile.appearanceDark') },
  ];
  return (
    <SheetScreen title={t('profile.aboutTitle')} cancelLabel={t('common.done')} onBack={() => goBack('/profile')} contentStyle={{ paddingHorizontal: 16 }}>
      <Section header={t('profile.appearance')}>
        {opts.map((o) => (
          <Cell key={o.v} title={o.label} checked={pref === o.v} accessibilityRole="radio" onPress={() => setPref(o.v)} />
        ))}
      </Section>

      <Section>
        <View style={{ padding: 16, gap: 8 }}>
          <Wordmark height={30} />
          <Txt variant="subhead" tone="label2">{t('profile.aboutText')}</Txt>
        </View>
      </Section>

      <Section header={t('profile.licencesHeader')} footer={t('profile.mapLicence')}>
        <Cell
          title={t('profile.carListLicence')}
          subtitle={t('profile.carListSource')}
          left={<IconTile icon="doc" bg={c.gray} />}
          onPress={() => Linking.openURL(CAR_LIST_SOURCE_URL)}
          accessibilityRole="link"
        />
        <View style={{ padding: 16 }}>
          <Txt
            variant="caption"
            tone="label2"
            selectable
            style={{ fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' }), fontWeight: '400' }}
          >
            {MIT_GLOBAL_CAR_MODELS}
          </Txt>
        </View>
      </Section>
    </SheetScreen>
  );
}
