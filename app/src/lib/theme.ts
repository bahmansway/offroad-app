import { Platform, type TextStyle } from 'react-native';

/**
 * Design tokens from SPEC-v2 "Design tokens". Light is the default; dark follows the phone setting
 * (or the user's choice in Profile → Appearance). Never hard-code colours in screens: use `useTheme().c`.
 */
export type Scheme = 'light' | 'dark';
export type AppearancePref = 'auto' | 'light' | 'dark';

export interface Palette {
  /** page background (grouped background) */
  bg: string;
  /** cards / grouped cells */
  card: string;
  /** behind a sheet (dimmed page) */
  behind: string;
  label: string;
  label2: string;
  /** chevrons, placeholders */
  label3: string;
  separator: string;
  fill: string;
  /** stronger fill (unfilled difficulty segments, pressed cells) */
  fill2: string;
  tint: string;
  onTint: string;
  tintSoft: string;
  tintSoftText: string;
  destructive: string;
  glass: string;
  glassBorder: string;
  /** opaque fallback for glass where blur is not available (Android) */
  glassSolid: string;
  sheet: string;
  grabber: string;
  /** selected thumb of a segmented control */
  segOn: string;
  /** active tab background in the floating tab bar */
  tabActiveBg: string;
  shadow: string;
  shadowOpacity: number;
  mapBg: string;
  /** icon-tile colours for settings rows (iOS style) */
  blue: string;
  indigo: string;
  gray: string;
  green: string;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    bg: '#F2F2F7',
    card: '#FFFFFF',
    behind: '#D1D1D6',
    label: '#000000',
    label2: '#6C6C70',
    label3: 'rgba(60,60,67,0.3)',
    separator: 'rgba(60,60,67,0.18)',
    fill: 'rgba(118,118,128,0.12)',
    fill2: 'rgba(120,120,128,0.2)',
    tint: '#C2410C',
    onTint: '#FFFFFF',
    tintSoft: '#FBEAE0',
    tintSoftText: '#B4380A',
    destructive: '#D70015',
    glass: 'rgba(255,255,255,0.68)',
    glassBorder: 'rgba(255,255,255,0.7)',
    glassSolid: 'rgba(255,255,255,0.94)',
    sheet: 'rgba(242,242,247,0.9)',
    grabber: 'rgba(60,60,67,0.3)',
    segOn: '#FFFFFF',
    tabActiveBg: 'rgba(0,0,0,0.06)',
    shadow: '#000000',
    shadowOpacity: 0.12,
    mapBg: '#EDEAE2',
    blue: '#2F6FDB',
    indigo: '#5E5CE6',
    gray: '#8E8E93',
    green: '#2E9D52',
  },
  dark: {
    bg: '#000000',
    card: '#1C1C1E',
    behind: '#000000',
    label: '#FFFFFF',
    label2: '#AEAEB2',
    label3: 'rgba(235,235,245,0.3)',
    separator: 'rgba(84,84,88,0.65)',
    fill: 'rgba(118,118,128,0.24)',
    fill2: 'rgba(118,118,128,0.36)',
    tint: '#FF8A3D',
    onTint: '#1A0A00',
    tintSoft: '#3A2A20',
    tintSoftText: '#FF8A3D',
    destructive: '#FF6961',
    glass: 'rgba(28,28,30,0.62)',
    glassBorder: 'rgba(255,255,255,0.14)',
    glassSolid: 'rgba(36,36,38,0.96)',
    sheet: 'rgba(18,18,20,0.86)',
    grabber: 'rgba(235,235,245,0.3)',
    segOn: '#636366',
    tabActiveBg: 'rgba(255,255,255,0.12)',
    shadow: '#000000',
    shadowOpacity: 0.45,
    mapBg: '#1E2124',
    blue: '#3D7EEB',
    indigo: '#6E6CF0',
    gray: '#8E8E93',
    green: '#34B05E',
  },
};

/** Which scheme to use for a saved preference and the phone's current setting. */
export function resolveScheme(pref: AppearancePref, system: string | null | undefined): Scheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

export function isAppearancePref(v: unknown): v is AppearancePref {
  return v === 'auto' || v === 'light' || v === 'dark';
}

/** OpenFreeMap styles: "positron" (light) / "dark", per SPEC-v2. */
export function mapStyleUrl(scheme: Scheme): string {
  return scheme === 'dark' ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron';
}

/** Five difficulty segments: true = filled (tint). Invalid level → all empty. */
export function difficultySegments(level: number | null | undefined): boolean[] {
  const ok = typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 5;
  return [1, 2, 3, 4, 5].map((i) => ok && i <= (level as number));
}

/** Earthy colour tiles used when a car/spot has no photo. Readable with white icons in both schemes. */
export const tints = ['#B65A3C', '#8C8577', '#4F6B4A', '#5B6B7A', '#9A7B4F', '#6E5A7E'] as const;

// ---------- type ----------
const isIOS = Platform.OS === 'ios';
type Weight = '400' | '500' | '600' | '700';
const INTER: Record<Weight, string> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
};

/** System font on iOS (SF Pro); Inter on Android and web. */
export function font(weight: Weight): TextStyle {
  return isIOS ? { fontWeight: weight } : { fontFamily: INTER[weight], fontWeight: weight };
}

export const type = {
  largeTitle: { ...font('700'), fontSize: 34, lineHeight: 41, letterSpacing: -0.6 },
  title1: { ...font('700'), fontSize: 30, lineHeight: 34, letterSpacing: -0.5 },
  title2: { ...font('700'), fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  title3: { ...font('600'), fontSize: 20, lineHeight: 25 },
  headline: { ...font('600'), fontSize: 17, lineHeight: 22 },
  body: { ...font('400'), fontSize: 17, lineHeight: 22 },
  callout: { ...font('400'), fontSize: 16, lineHeight: 21 },
  subhead: { ...font('400'), fontSize: 15, lineHeight: 20 },
  footnote: { ...font('400'), fontSize: 13, lineHeight: 18 },
  caption: { ...font('500'), fontSize: 12, lineHeight: 16 },
  tab: { ...font('600'), fontSize: 11, lineHeight: 13 },
} as const;

export type TypeVariant = keyof typeof type;

export const radius = {
  card: 26,
  sheet: 34,
  tabBar: 32,
  pill: 999,
  thumb: 12,
  tile: 16,
  iconTile: 8,
} as const;

/** Minimum tap target size. */
export const TAP = 44;

/** Floating tab bar geometry (64 tall pill, 16px sides, floats above the bottom). */
export const TAB_BAR = { height: 64, side: 16, gap: 24 } as const;

/** Hairline width that is visible on every screen density (0.5 on retina). */
export const HAIRLINE = 0.5;
