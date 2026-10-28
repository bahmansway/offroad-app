import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/themeContext';
import { Txt } from './ui/Text';

/** Thin bar shown when a saved session could not be confirmed because the server is unreachable. */
export function OfflineBanner() {
  const { offline, retry } = useAuth();
  const { t } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: insets.top + 6, paddingBottom: 6, backgroundColor: c.tintSoft }}
      accessibilityLiveRegion="polite"
      role="alert"
    >
      <Txt variant="footnote" color={c.tintSoftText} style={{ flex: 1 }}>{t('errors.offline')}</Txt>
      <Pressable accessibilityRole="button" onPress={retry} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }} hitSlop={6}>
        <Txt variant="subhead" color={c.tintSoftText} style={{ fontWeight: '600' }}>{t('common.retry')}</Txt>
      </Pressable>
    </View>
  );
}
