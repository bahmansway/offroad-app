import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';
import { HAIRLINE, radius, TAP } from '../lib/theme';
import { Txt } from './ui/Text';

export interface SheetAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

/**
 * iOS-style action sheet (long-press menus, member actions). A plain RN Modal so it works the same
 * on iPhone, Android and web (Alert with buttons does nothing on web).
 */
export function ActionSheet({ visible, title, actions, onClose }: {
  visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Backdrop: a separate full-screen layer BEHIND the sheet, so the sheet's items stay reachable
            with VoiceOver/TalkBack. Screen readers use the Cancel button (or the escape gesture). */}
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          {...({ tabIndex: -1 } as object)}
        />
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={{ width: '100%', maxWidth: 520, alignSelf: 'center', padding: 8, paddingBottom: 8 + insets.bottom, gap: 8 }}
        >
          <View style={{ backgroundColor: c.card, borderRadius: radius.card - 12, overflow: 'hidden' }} accessibilityRole="menu" accessibilityLabel={title}>
            {title ? (
              <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: HAIRLINE, borderBottomColor: c.separator }}>
                <Txt variant="footnote" tone="label2" center numberOfLines={2}>{title}</Txt>
              </View>
            ) : null}
            {actions.map((a, i) => (
              <Pressable
                key={a.label}
                accessibilityRole="menuitem"
                accessibilityLabel={a.label}
                onPress={() => { onClose(); a.onPress(); }}
                style={({ pressed }) => [
                  { minHeight: TAP + 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
                  i < actions.length - 1 && { borderBottomWidth: HAIRLINE, borderBottomColor: c.separator },
                  pressed && { backgroundColor: c.fill },
                ]}
              >
                <Txt color={a.destructive ? c.destructive : c.tint} numberOfLines={1}>{a.label}</Txt>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={onClose}
            style={({ pressed }) => [
              { minHeight: TAP + 12, borderRadius: radius.card - 12, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Txt variant="headline" tone="tint">{t('common.cancel')}</Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
