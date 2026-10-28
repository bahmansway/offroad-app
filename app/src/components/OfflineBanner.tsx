import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { colors, fonts } from '../lib/theme';

/** Thin bar shown when a saved session could not be confirmed because the server is unreachable. */
export function OfflineBanner() {
  const { offline, retry } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]} accessibilityLiveRegion="polite" role="alert">
      <Text style={styles.text}>{t('errors.offline')}</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.btn} hitSlop={6}>
        <Text style={styles.btnText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 6, backgroundColor: colors.surface2, borderBottomWidth: 1, borderColor: colors.line },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  btn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  btnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent },
});
