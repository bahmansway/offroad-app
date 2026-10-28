export const colors = {
  bg: '#14130E',
  surface: '#1F1D16',
  surface2: '#2A2820',
  line: '#3A372C',
  text: '#F2EDE1',
  muted: '#ABA493',
  accent: '#FF8A2A',
  accentHover: '#FFB070',
  onAccent: '#14130E',
  danger: '#F0574A',
  mapBg: '#2A2619',
  camp: '#F2EDE1',
} as const;

/** Difficulty colours, index 0 = level 1. Always shown together with the number. */
export const levelColors = ['#9FD49A', '#E8D36A', '#FF8A2A', '#F0574A', '#C9A0FF'] as const;

export const fonts = {
  body: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semibold: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
  headSemi: 'BarlowCondensed_600SemiBold',
  head: 'BarlowCondensed_700Bold',
} as const;

/** Colour tiles used instead of photos in v1. */
export const tints = ['#7A3B2A', '#5A5446', '#2F4A3A', '#2F3A33', '#4A3B2A', '#3B4A5A'] as const;

export const radius = { sm: 10, md: 12, lg: 14, xl: 16, pill: 999 } as const;

/** Minimum tap target size. */
export const TAP = 44;
