import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { radius, terrain, thumbTone, type ThumbKind } from '../../lib/theme';
import { CarSilhouette, Contour } from './Motifs';
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

const KIND_ICON: Record<ThumbKind, IconName> = { trail: 'trail', camp: 'tent', car: 'car', event: 'events', clan: 'people', mod: 'wrench' };

/**
 * Rounded photo, or a terrain tile when there is no photo. The colour comes from the TYPE, never the id
 * (trail = clay + trail glyph, camp = forest + tent, car = stone + 4x4 silhouette, event = sand, clan/mod = stone),
 * with a faint contour texture. `seed` is no longer used (kept so old calls still compile).
 */
export function Thumb({ uri, kind = 'car', icon, size = 46, rounded = radius.thumb, style }: {
  uri?: string | null; kind?: ThumbKind; seed?: string | number; icon?: IconName; size?: number | '100%'; rounded?: number; style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const bg = terrain(c, thumbTone(kind)).solid;
  const dim = size === '100%' ? { width: '100%' as const, height: '100%' as const } : { width: size, height: size };
  const px = typeof size === 'number' ? size : 80;
  return (
    <View style={[dim, { borderRadius: rounded, overflow: 'hidden', backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <>
          <Contour color="#FFFFFF" opacity={0.18} seed={1} width={px} height={px} />
          {kind === 'car' && !icon
            ? <CarSilhouette width={Math.round(px * 0.78)} />
            : <Icon name={icon ?? KIND_ICON[kind]} size={Math.round(px * 0.48)} color="#FFFFFF" strokeWidth={2.2} />}
        </>
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
