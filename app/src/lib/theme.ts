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
  // ---- YOLCHU terrain tones (DESIGN-PASS P2). Category colour only: never buttons, links or the selected tab.
  /** trails */
  clay: string; claySoft: string; clayText: string;
  /** camps, "open" status */
  forest: string; forestSoft: string; forestText: string;
  /** events, waitlist */
  sand: string; sandSoft: string; sandText: string;
  /** cars, clans, mods */
  stone: string; stoneSoft: string; stoneText: string;
  /** level-1 sign plate and the "later" month strip of a date block */
  paper: string; paperText: string;
  /** strongest plate (levels 4–5, map clusters) */
  ink: string; onInk: string;
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
    clay: '#B65A3C', claySoft: '#F6E4DC', clayText: '#8A3E24',
    forest: '#4F6B4A', forestSoft: '#E3EBDF', forestText: '#3B5237',
    sand: '#9A7B4F', sandSoft: '#F3EADB', sandText: '#6B5330',
    stone: '#6E685D', stoneSoft: '#ECEAE5', stoneText: '#504B42',
    paper: '#E7DCC8', paperText: '#5A4628',
    ink: '#1C1C1E', onInk: '#FFFFFF',
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
    clay: '#C46A4A', claySoft: '#3A2620', clayText: '#F0A487',
    forest: '#5E7F58', forestSoft: '#1F2A1D', forestText: '#A9C9A0',
    sand: '#A88A5C', sandSoft: '#2E2618', sandText: '#E3CFA8',
    stone: '#7A7468', stoneSoft: '#26241F', stoneText: '#CFC8BA',
    paper: '#4A3E2C', paperText: '#E3CFA8',
    ink: '#FFFFFF', onInk: '#000000',
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

/** @deprecated random seed colours; use terrain tones by type (`terrain()` / `thumbTone()`). Kept for old imports. */
export const tints = ['#B65A3C', '#8C8577', '#4F6B4A', '#5B6B7A', '#9A7B4F', '#6E5A7E'] as const;

// ---------- terrain tones ----------
export type TerrainTone = 'clay' | 'forest' | 'sand' | 'stone';
export const TERRAIN_TONES: TerrainTone[] = ['clay', 'forest', 'sand', 'stone'];

/** Solid / soft / text colours of a terrain tone. Soft + text is used for chips, solid + white for tiles. */
export function terrain(c: Palette, tone: TerrainTone): { solid: string; soft: string; text: string } {
  return { solid: c[tone], soft: c[`${tone}Soft`], text: c[`${tone}Text`] };
}

/** What a thumb/tile shows. The tone comes from the type, never from the id. */
export type ThumbKind = 'trail' | 'camp' | 'car' | 'event' | 'clan' | 'mod';
export function thumbTone(kind: ThumbKind): TerrainTone {
  return kind === 'trail' ? 'clay' : kind === 'camp' ? 'forest' : kind === 'event' ? 'sand' : 'stone';
}

// ---------- trail-sign difficulty (DESIGN-PASS P1) ----------
export interface SignColors {
  plate: string;
  /** text of the word */
  text: string;
  /** colour of the number */
  num: string;
  /** background of the number square */
  numBg: string;
  /** inner ring (level 5 only) */
  ring: string | null;
}

/** Plate colours for levels 1–5: the plate gets darker (lighter in dark mode) as the level goes up.
 *  Number + word are always shown, so colour is never the only signal. Invalid level → null. */
export function signColors(level: number | null | undefined, scheme: Scheme): SignColors | null {
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 5) return null;
  const c = palettes[scheme];
  const light = scheme === 'light';
  switch (level) {
    case 1: return { plate: c.paper, text: c.paperText, num: c.paperText, numBg: 'rgba(255,255,255,0.6)', ring: null };
    case 2: return { plate: c.tintSoft, text: c.tintSoftText, num: c.tintSoftText, numBg: light ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.08)', ring: null };
    case 3: return { plate: c.tint, text: c.onTint, num: c.onTint, numBg: light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)', ring: null };
    case 4: return { plate: c.ink, text: c.onInk, num: c.onInk, numBg: light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)', ring: null };
    default: return { plate: c.ink, text: c.onInk, num: light ? '#FF8A3D' : '#C2410C', numBg: light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)', ring: c.tint };
  }
}

/** WCAG contrast ratio of two opaque #RRGGBB colours (used by tests to keep text ≥ 4.5:1). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------- type ----------
const isIOS = Platform.OS === 'ios';
type Weight = '400' | '500' | '600' | '700' | '800';
const INTER: Record<Weight, string> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
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
