import React from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../../lib/themeContext';
import { useI18n } from '../../lib/i18n';
import { radius, TAB_BAR, TAP } from '../../lib/theme';
import { Txt } from './Text';
import { Icon } from './Icon';
import { IconButton } from './Button';

export function goBack(fallback: string = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

/** Bottom padding so content can scroll above the floating tab bar. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR.height + TAB_BAR.gap + Math.max(insets.bottom - 10, 0) + 16;
}

const MAX_W = 640;

/**
 * Tab-root page: large title (34/700) at the top, grouped background, scrolls above the tab bar.
 *   <LargeTitleScreen title="Qaraj" right={<IconButton …/>}>…</LargeTitleScreen>
 */
export function LargeTitleScreen({ title, right, children, onRefresh, refreshing, scroll = true, contentStyle }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
  onRefresh?: () => void; refreshing?: boolean; scroll?: boolean; contentStyle?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, minHeight: 56 }}>
      <Txt variant="largeTitle" accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</Txt>
      {right ? <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View> : null}
    </View>
  );
  const inner = [{ width: '100%' as const, maxWidth: MAX_W, alignSelf: 'center' as const, paddingHorizontal: 16, gap: 20 }, contentStyle];
  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 6 }}>
        <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>{header}</View>
        <View style={[inner, { flex: 1, paddingBottom: bottom }]}>{children}</View>
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: bottom }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.label2} /> : undefined}
    >
      <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>{header}</View>
      <View style={inner}>{children}</View>
    </ScrollView>
  );
}

/**
 * Pushed page with a standard nav bar: back chevron + label, centred title, optional right action.
 * Use for forms and secondary pages. Content scrolls; keyboard-aware.
 */
export function NavScreen({ title, backLabel, right, children, fallback = '/', scroll = true, footer, contentStyle }: {
  title?: string; backLabel?: string; right?: React.ReactNode; children: React.ReactNode; fallback?: string;
  scroll?: boolean; footer?: React.ReactNode; contentStyle?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top }}>
        <NavBar title={title} backLabel={backLabel} right={right} onBack={() => goBack(fallback)} />
      </View>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', padding: 16, paddingBottom: 32 + insets.bottom, gap: 20 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, width: '100%', maxWidth: MAX_W, alignSelf: 'center' }, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 + insets.bottom }}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

/** 52pt nav row: tint "‹ Back" (or "Cancel" text), centred title + subtitle, right slot. */
export function NavBar({ title, subtitle, backLabel, cancelLabel, onBack, right }: {
  title?: string; subtitle?: string; backLabel?: string; cancelLabel?: string; onBack?: () => void; right?: React.ReactNode;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
      <View style={{ flex: 1, flexBasis: 0, alignItems: 'flex-start', minWidth: 0 }}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cancelLabel ?? backLabel ?? t('common.back')}
            onPress={onBack}
            hitSlop={6}
            style={({ pressed }) => [{ minWidth: TAP, height: TAP, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6 }, pressed && { opacity: 0.5 }]}
          >
            {cancelLabel ? null : <Icon name="back" size={22} color={c.tint} strokeWidth={2.6} />}
            <Txt tone="tint" numberOfLines={1}>{cancelLabel ?? backLabel ?? t('common.back')}</Txt>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flex: 2, flexBasis: 0, alignItems: 'center', minWidth: 0 }}>
        {title ? <Txt variant="headline" numberOfLines={1} accessibilityRole="header">{title}</Txt> : null}
        {subtitle ? <Txt variant="footnote" tone="label2" numberOfLines={1}>{subtitle}</Txt> : null}
      </View>
      <View style={{ flex: 1, flexBasis: 0, alignItems: 'flex-end', paddingRight: 8, minWidth: 0 }}>{right}</View>
    </View>
  );
}

/**
 * Modal / sheet page (Add car steps, Report, edit forms). Register the route with
 * `presentation: 'modal'` in the root Stack. Draws grabber + nav row; on web/Android it also draws
 * the rounded 34px sheet over a dimmed page so it looks the same as the iOS page sheet.
 */
export function SheetScreen({ title, subtitle, cancelLabel, backLabel, onBack, right, children, footer, scroll = true, contentStyle }: {
  title?: string; subtitle?: string; cancelLabel?: string; backLabel?: string; onBack: () => void; right?: React.ReactNode;
  children: React.ReactNode; footer?: React.ReactNode; scroll?: boolean; contentStyle?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const native = Platform.OS === 'ios';
  const body = (
    <View style={{ flex: 1, backgroundColor: c.bg, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' }}>
      <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.grabber, alignSelf: 'center', marginTop: 8 }} />
      <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>
        <NavBar title={title} subtitle={subtitle} cancelLabel={cancelLabel} backLabel={backLabel} onBack={onBack} right={right} />
      </View>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', paddingTop: 8, paddingBottom: 24, gap: 18 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : <View style={[{ flex: 1, width: '100%', maxWidth: MAX_W, alignSelf: 'center' }, contentStyle]}>{children}</View>}
      {footer ? <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 + insets.bottom }}>{footer}</View> : null}
    </View>
  );
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: native ? c.bg : c.behind, paddingTop: native ? 0 : insets.top + 10 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  );
}

/** Floating glass back button for pages with a photo/hero on top. */
export function FloatingBack({ fallback = '/' }: { fallback?: string }) {
  const { t } = useI18n();
  return <IconButton icon="back" label={t('common.back')} glass onPress={() => goBack(fallback)} />;
}

/** Plain page section title ("Modifications · 5" + action). */
export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 28 }}>
      <Txt variant="footnote" tone="label2" style={{ textTransform: 'uppercase', letterSpacing: 0.2 }} accessibilityRole="header">{title}</Txt>
      {right}
    </View>
  );
}
