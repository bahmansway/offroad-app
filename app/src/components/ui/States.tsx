import React from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { useI18n } from '../../lib/i18n';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';
import { PillButton } from './Button';

/** Centred spinner. `inline` = small, no flex fill (inside lists). */
export function LoadingState({ inline }: { inline?: boolean }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={inline ? { paddingVertical: 24, alignItems: 'center' } : { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}
      accessibilityLabel={t('common.loading')}
      accessibilityRole="progressbar"
    >
      <ActivityIndicator color={c.label2} size={inline ? 'small' : 'large'} />
    </View>
  );
}

/** Friendly empty state: icon in a soft circle, title, text, optional action. */
export function EmptyState({ icon, title, text, actionLabel, onAction, style }: {
  icon: IconName; title: string; text?: string; actionLabel?: string; onAction?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 32, paddingHorizontal: 24 }, style]}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Icon name={icon} size={30} color={c.tintSoftText} />
      </View>
      <Txt variant="title3" center accessibilityRole="header">{title}</Txt>
      {text ? <Txt variant="subhead" tone="label2" center style={{ maxWidth: 320 }}>{text}</Txt> : null}
      {actionLabel && onAction ? <PillButton title={actionLabel} size="medium" onPress={onAction} style={{ marginTop: 8, minWidth: 180 }} /> : null}
    </View>
  );
}

/** Error with a retry button. */
export function ErrorState({ message, onRetry, style }: { message: string; onRetry?: () => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }, style]}>
      <Icon name="info" size={30} color={c.label2} />
      <Txt tone="label" center role="alert">{message}</Txt>
      {onRetry ? <PillButton title={t('common.retry')} variant="gray" size="medium" onPress={onRetry} style={{ minWidth: 160 }} /> : null}
    </View>
  );
}

/** Red inline form error (announced). */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <Txt variant="subhead" tone="destructive" center role="alert" accessibilityLiveRegion="assertive">{message}</Txt>;
}
