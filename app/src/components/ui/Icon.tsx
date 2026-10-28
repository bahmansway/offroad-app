import React from 'react';
import { Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SymbolView, type SFSymbol } from 'expo-symbols';

/**
 * One icon set for the whole app. iOS draws the SF Symbol; Android and web draw the SVG path
 * (copied from the approved mockups). Icons are decorative: label the button, not the icon.
 */
const ICONS = {
  back: { sf: 'chevron.left', d: 'm15 5-7 7 7 7' },
  chevron: { sf: 'chevron.right', d: 'm9 6 6 6-6 6' },
  close: { sf: 'xmark', d: 'M6 6l12 12M18 6 6 18' },
  plus: { sf: 'plus', d: 'M12 5v14 M5 12h14' },
  check: { sf: 'checkmark', d: 'm4 12 5 5L20 6' },
  search: { sf: 'magnifyingglass', d: 'M11 18a7 7 0 1 0 0-14a7 7 0 1 0 0 14Z M20 20l-4-4' },
  filter: { sf: 'slider.horizontal.3', d: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 9a2 2 0 1 0 0-4a2 2 0 1 0 0 4Z M8 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4Z' },
  navigate: { sf: 'location.fill', d: 'M21 3 3 10.5l7.5 3 3 7.5Z', filled: true },
  explore: { sf: 'safari', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z M15.5 8.5l-2 5-5 2 2-5Z' },
  events: { sf: 'calendar', d: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z M4 10h16 M8 3v4 M16 3v4' },
  garage: { sf: 'car', d: 'M5 17v-5l2.2-5h9.6l2.2 5v5Z M5 17v2 M19 17v2 M4 12h16 M8 14.5h.01 M16 14.5h.01' },
  chat: { sf: 'bubble.left', d: 'M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' },
  profile: { sf: 'person', d: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8Z M4.5 20a7.5 7.5 0 0 1 15 0' },
  tent: { sf: 'tent', d: 'M3 20 12 5l9 15Z M12 20l-3-5h6Z' },
  star: { sf: 'star', d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z' },
  starFill: { sf: 'star.fill', d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z', filled: true },
  season: { sf: 'sun.max', d: 'M12 4v2 M12 18v2 M4 12h2 M18 12h2 M12 16a4 4 0 1 0 0-8a4 4 0 1 0 0 8Z' },
  tag: { sf: 'tag', d: 'M3 12V4h8l10 10-8 8Z M7.5 8.5h.01' },
  pin: { sf: 'mappin', d: 'M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12Z M12 11.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5Z' },
  user: { sf: 'person.crop.circle', d: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8Z M4.5 20a7.5 7.5 0 0 1 15 0' },
  flag: { sf: 'flag', d: 'M5 21V4 M5 4h12l-2 4 2 4H5' },
  trash: { sf: 'trash', d: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13' },
  edit: { sf: 'pencil', d: 'M4 20h4L19 9l-4-4L4 16v4Z M14 6l4 4' },
  eye: { sf: 'eye', d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6Z' },
  eyeOff: { sf: 'eye.slash', d: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2 M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1' },
  globe: { sf: 'globe', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z M3 12h18 M12 3c2.5 3 2.5 15 0 18 M12 3c-2.5 3-2.5 15 0 18' },
  moon: { sf: 'moon', d: 'M12 3a9 9 0 1 0 9 9a7 7 0 0 1-9-9Z' },
  mail: { sf: 'envelope', d: 'M4 6h16v12H4Z M4 7l8 6 8-6' },
  lock: { sf: 'lock', d: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5Z' },
  block: { sf: 'nosign', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z M5.6 5.6l12.8 12.8' },
  info: { sf: 'info.circle', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z M12 11v6 M12 7.5h.01' },
  doc: { sf: 'doc.text', d: 'M6 3h9l4 4v14H6Z M14 3v5h5 M9 13h7 M9 17h7' },
  logout: { sf: 'rectangle.portrait.and.arrow.right', d: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h11' },
  camera: { sf: 'camera', d: 'M4 7h3l2-3h6l2 3h3v12H4Z M12 16a3 3 0 1 0 0-6a3 3 0 1 0 0 6Z' },
  car: { sf: 'car.side', d: 'M3 16v-3l2-5h14l2 5v3H3Z M7.5 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4Z M16.5 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4Z' },
  wrench: { sf: 'wrench.and.screwdriver', d: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8 6.2 21l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.4-.6-.6-2.4Z' },
  message: { sf: 'paperplane', d: 'M21 3 10 14 M21 3l-7 18-4-7-7-4Z' },
  share: { sf: 'square.and.arrow.up', d: 'M12 3v12 M8 7l4-4 4 4 M6 11H5v9h14v-9h-1' },
  location: { sf: 'mappin.and.ellipse', d: 'M12 17s-5-4.5-5-8.5a5 5 0 0 1 10 0c0 4-5 8.5-5 8.5Z M5 20h14' },
  calendarSmall: { sf: 'calendar', d: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z M4 10h16' },
  sparkle: { sf: 'checkmark.seal', d: 'm4 12 5 5L20 6' },
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  /** Force the SVG version even on iOS (e.g. inside the map WebView parity checks). */
  svgOnly?: boolean;
}

export function SvgIcon({ name, size = 22, color, strokeWidth = 2 }: Omit<IconProps, 'svgOnly'>) {
  const def = ICONS[name] as { d: string; filled?: boolean };
  return (
    <View style={{ width: size, height: size, flexShrink: 0 }} accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={def.d}
        fill={def.filled ? color : 'none'}
        stroke={def.filled ? 'none' : color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
    </View>
  );
}

export function Icon({ name, size = 22, color, strokeWidth = 2, svgOnly }: IconProps) {
  const svg = <SvgIcon name={name} size={size} color={color} strokeWidth={strokeWidth} />;
  if (Platform.OS !== 'ios' || svgOnly) return svg;
  return (
    <SymbolView
      name={ICONS[name].sf as SFSymbol}
      size={size}
      tintColor={color}
      weight={strokeWidth >= 2.4 ? 'semibold' : 'regular'}
      fallback={svg}
      style={{ width: size, height: size }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
