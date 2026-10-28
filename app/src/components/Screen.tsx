import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { H1, IconButton } from './ui';

export function goBack(fallback: string = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

/** Page shell: safe area, dark background, optional scroll, keyboard avoidance, centred max width on web. */
export function Screen({ children, scroll = true, style, padded = true }: {
  children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const inner = [styles.inner, padded && styles.padded, style];
  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {scroll ? (
        <ScrollView contentContainerStyle={[inner, { paddingBottom: 32 + insets.bottom }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[inner, { flex: 1 }]}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

/** Back button + title row used on pushed screens. */
export function TopBar({ title, right, fallback }: { title?: string; right?: React.ReactNode; fallback?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.topBar}>
      <IconButton icon="back" label={t('common.back')} onPress={() => goBack(fallback)} bg={colors.surface} bordered />
      {title ? <H1 style={styles.topTitle}>{title}</H1> : <View style={{ flex: 1 }} />}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 14 },
  padded: { padding: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topTitle: { flex: 1, fontSize: 26 },
});
