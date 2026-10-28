import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../lib/themeContext';
import { HAIRLINE } from '../../lib/theme';

export interface GlassViewProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  /** blur strength 1–100 (iOS); default 60 ≈ 24px */
  intensity?: number;
  /** drop shadow under the glass (floating controls) */
  elevated?: boolean;
  /** hide the 0.5px light border */
  borderless?: boolean;
}

/**
 * Frosted "glass" surface from the design tokens.
 * - iOS: expo-blur BlurView (system material) + token border.
 * - Web: CSS backdrop-filter blur(24px) saturate(180%) + token tint.
 * - Android: no real-time blur in Expo Go, so a near-opaque token colour.
 * Put `borderRadius` in `style`; children are laid out normally.
 */
export function GlassView({ style, intensity = 60, elevated, borderless, children, ...rest }: GlassViewProps) {
  const { c, scheme } = useTheme();
  const flat = StyleSheet.flatten(style) ?? {};
  const base: ViewStyle = {
    overflow: 'hidden',
    borderWidth: borderless ? 0 : HAIRLINE,
    borderColor: c.glassBorder,
  };
  const shadow: ViewStyle | null = elevated
    ? Platform.select<ViewStyle>({
        web: { boxShadow: `0 8px 28px rgba(0,0,0,${c.shadowOpacity})` } as ViewStyle,
        default: { shadowColor: c.shadow, shadowOpacity: c.shadowOpacity, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
      })
    : null;

  if (Platform.OS === 'ios') {
    // Shadows are clipped by overflow:hidden, so the shadow lives on an outer wrapper.
    const { borderRadius } = flat;
    const blur = (
      <BlurView
        intensity={intensity}
        tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={[base, elevated ? omitOuter(flat) : style]}
        {...rest}
      >
        {children}
      </BlurView>
    );
    if (!elevated) return blur;
    return <View style={[shadow, { borderRadius }, pickOuter(flat)]}>{blur}</View>;
  }

  if (Platform.OS === 'web') {
    const webGlass = {
      backgroundColor: c.glass,
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    } as unknown as ViewStyle;
    return <View style={[base, webGlass, shadow, style]} {...rest}>{children}</View>;
  }

  return <View style={[base, { backgroundColor: c.glassSolid }, shadow, style]} {...rest}>{children}</View>;
}

const OUTER_KEYS = [
  'position', 'top', 'left', 'right', 'bottom', 'alignSelf', 'flex', 'margin', 'marginTop', 'marginBottom',
  'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'zIndex', 'width',
] as const;

/** Position props must sit on the outer shadow wrapper on iOS. */
function pickOuter(s: ViewStyle): ViewStyle {
  const out: Record<string, unknown> = {};
  for (const k of OUTER_KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as ViewStyle;
}

function omitOuter(s: ViewStyle): ViewStyle {
  const out: Record<string, unknown> = { ...s };
  for (const k of OUTER_KEYS) delete out[k];
  if (s.width !== undefined) out.width = '100%';
  return out as ViewStyle;
}
