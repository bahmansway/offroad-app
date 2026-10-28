import React from 'react';
import { ActivityIndicator, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { TAP } from '../../lib/theme';
import { tapFeedback } from '../../lib/haptics';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';
import { GlassView } from './Glass';

export type PillVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive' | 'glass';

export interface PillButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  /** small second line under the title (e.g. "Saturday · 7/12 cars") */
  subtitle?: string;
  variant?: PillVariant;
  size?: 'large' | 'medium' | 'small';
  icon?: IconName;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const HEIGHT = { large: 56, medium: 48, small: TAP } as const;

/** Rounded pill button. `filled` = main action (tint), `tinted` = soft tint, `gray` = neutral fill,
 *  `plain` = text only, `destructive` = red text on card, `glass` = floating over a map/photo. */
export function PillButton({
  title, subtitle, variant = 'filled', size = 'large', icon, loading, disabled, style, onPress, ...rest
}: PillButtonProps) {
  const { c } = useTheme();
  const fg = {
    filled: c.onTint, tinted: c.tintSoftText, gray: c.label, plain: c.tint, destructive: c.destructive, glass: c.tint,
  }[variant];
  const bg = {
    filled: c.tint, tinted: c.tintSoft, gray: c.fill, plain: 'transparent', destructive: c.card, glass: 'transparent',
  }[variant];
  const h = HEIGHT[size];
  const inner = loading ? <ActivityIndicator color={fg} /> : (
    <View style={{ alignItems: 'center', gap: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Icon name={icon} size={size === 'small' ? 17 : 20} color={fg} strokeWidth={2.4} /> : null}
        <Txt variant={size === 'small' ? 'subhead' : 'headline'} color={fg} style={size === 'small' ? { fontWeight: '600' } : null} numberOfLines={1}>{title}</Txt>
      </View>
      {subtitle ? <Txt variant="caption" color={fg} style={{ opacity: 0.85 }} numberOfLines={1}>{subtitle}</Txt> : null}
    </View>
  );
  const off = !!disabled || !!loading;
  const press = (e: Parameters<NonNullable<PressableProps['onPress']>>[0]) => {
    tapFeedback();
    onPress?.(e);
  };
  if (variant === 'glass') {
    return (
      <GlassView elevated style={[{ height: h, borderRadius: h / 2 }, style]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: off, busy: !!loading }}
          disabled={off}
          onPress={press}
          style={({ pressed }) => [{ flex: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' }, (pressed || off) && { opacity: off ? 0.5 : 0.7 }]}
          {...rest}
        >
          {inner}
        </Pressable>
      </GlassView>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!loading }}
      disabled={off}
      onPress={press}
      style={({ pressed }) => [
        { minHeight: h, borderRadius: h / 2, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: bg },
        off && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
        style,
      ]}
      {...rest}
    >
      {inner}
    </Pressable>
  );
}

/** Round icon-only button (44×44). Always give `label` for screen readers. */
export function IconButton({ icon, label, onPress, color, glass, size = TAP, style, disabled }: {
  icon: IconName; label: string; onPress?: () => void; color?: string; glass?: boolean; size?: number;
  style?: StyleProp<ViewStyle>; disabled?: boolean;
}) {
  const { c } = useTheme();
  const btn = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => { tapFeedback(); onPress?.(); }}
      hitSlop={4}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' },
        !glass && { backgroundColor: c.fill },
        (pressed || disabled) && { opacity: 0.6 },
        !glass && style,
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={color ?? c.label} strokeWidth={2.4} />
    </Pressable>
  );
  if (!glass) return btn;
  return <GlassView elevated style={[{ width: size, height: size, borderRadius: size / 2 }, style]}>{btn}</GlassView>;
}

/** Text link styled in tint (44px tall tap area). */
export function LinkButton({ title, onPress, style, accessibilityLabel }: {
  title: string; onPress: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [{ minHeight: TAP, justifyContent: 'center', paddingHorizontal: 4 }, pressed && { opacity: 0.6 }, style]}
    >
      <Txt tone="tint">{title}</Txt>
    </Pressable>
  );
}
