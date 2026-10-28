import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { radius, tints } from '../../lib/theme';
import { initials } from '../../lib/format';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';

/** Round avatar: photo if `uri`, otherwise initials on soft tint. */
export function Avatar({ uri, name, size = 44, style }: { uri?: string | null; name: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View
      style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Txt color={c.tintSoftText} style={{ fontSize: Math.round(size * 0.37), lineHeight: Math.round(size * 0.45), fontWeight: '700' }}>{initials(name)}</Txt>
      )}
    </View>
  );
}

/** Rounded photo or colour tile with a placeholder icon (cars, spots). */
export function Thumb({ uri, seed, icon = 'car', size = 46, rounded = radius.thumb, style }: {
  uri?: string | null; seed: string | number; icon?: IconName; size?: number | '100%'; rounded?: number; style?: StyleProp<ViewStyle>;
}) {
  const bg = tints[hashSeed(seed) % tints.length];
  const dim = size === '100%' ? { width: '100%' as const, height: '100%' as const } : { width: size, height: size };
  return (
    <View style={[dim, { borderRadius: rounded, overflow: 'hidden', backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]} accessible={false}>
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <Icon name={icon} size={typeof size === 'number' ? Math.round(size * 0.48) : 40} color="rgba(255,255,255,0.9)" />
      )}
    </View>
  );
}

export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
