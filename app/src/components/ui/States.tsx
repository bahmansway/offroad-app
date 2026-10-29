import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { useI18n } from '../../lib/i18n';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';
import { PillButton } from './Button';
import { CarSilhouette, Contour, MountainMark } from './Motifs';

/** Loading: the logo mountain pulsing slowly (still with Reduce Motion) + "Yüklənir…".
 *  `inline` = small mountain inside a list, no flex fill. */
export function LoadingState({ inline }: { inline?: boolean }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={inline ? { paddingVertical: 20, alignItems: 'center', gap: 6 } : { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: c.bg }}
      accessible
      accessibilityLabel={t('common.loading')}
      accessibilityRole="progressbar"
    >
      <MountainMark size={inline ? 34 : 72} color={c.tint} pulse />
      {inline ? null : <Txt variant="subhead" tone="label2">{t('common.loadingDots')}</Txt>}
    </View>
  );
}

/** Empty state: an illustration (logo `mountain` or `car` silhouette) or an icon in a soft circle, title,
 *  text, optional action. Draws a faint tint contour behind it (10%). */
export function EmptyState({ icon, illustration, title, text, actionLabel, onAction, style, contour = true }: {
  icon?: IconName; illustration?: 'mountain' | 'car'; title: string; text?: string; actionLabel?: string; onAction?: () => void;
  style?: StyleProp<ViewStyle>; contour?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 32, paddingHorizontal: 24, overflow: 'hidden', borderRadius: 26 }, style]}>
      {contour ? <Contour color={c.tint} opacity={0.1} seed={7} width={320} height={260} /> : null}
      {illustration === 'mountain' ? (
        <MountainMark size={64} color={c.tint} style={{ marginBottom: 2 }} />
      ) : illustration === 'car' ? (
        <View style={{ width: 120, height: 64, borderRadius: 16, backgroundColor: c.stone, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 4 }} accessible={false}>
          <Contour color="#FFFFFF" opacity={0.18} seed={4} width={120} height={64} />
          <CarSilhouette width={96} />
        </View>
      ) : icon ? (
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
          <Icon name={icon} size={30} color={c.tintSoftText} />
        </View>
      ) : null}
      <Txt variant="title3" center accessibilityRole="header">{title}</Txt>
      {text ? <Txt variant="subhead" tone="label2" center style={{ maxWidth: 320 }}>{text}</Txt> : null}
      {actionLabel && onAction ? <PillButton title={actionLabel} size="medium" onPress={onAction} style={{ marginTop: 8, minWidth: 180 }} /> : null}
    </View>
  );
}

/**
 * Centred card for a map that could not load (DESIGN-PASS P4): wifi icon, title, one line, grey "Try again".
 * Sits on a faint contour texture and covers the map area, so it never hides under floating buttons.
 * `compact` for small maps (event meeting point).
 */
export function MapErrorCard({ onRetry, compact, style }: { onRetry?: () => void; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: c.mapBg }, style]}>
      <Contour color={c.label2} opacity={0.25} seed={8} width={300} height={300} />
      <View
        role="alert"
        style={{
          width: '100%', maxWidth: 320, backgroundColor: c.card, borderRadius: 20, padding: compact ? 12 : 18, gap: compact ? 4 : 8, alignItems: 'center',
          shadowColor: c.shadow, shadowOpacity: c.shadowOpacity * 0.8, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3,
        }}
      >
        {compact ? null : <Icon name="wifi" size={28} color={c.label2} />}
        <Txt variant="headline" center>{t('map.errorTitle')}</Txt>
        <Txt variant="footnote" tone="label2" center>{t('map.errorText')}</Txt>
        {onRetry ? <PillButton title={t('map.retry')} variant="gray" size="small" onPress={onRetry} style={{ marginTop: 4, minWidth: 150 }} /> : null}
      </View>
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
