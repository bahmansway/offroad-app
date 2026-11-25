/**
 * "Yol göstər / Navigate" chooser (SPEC-v6 §5): Waze, Google Maps, Apple Maps (iPhone only).
 * Pure helpers so the URLs per platform can be unit-tested.
 */
export type NavApp = 'waze' | 'google' | 'apple';
export type NavPlatform = 'ios' | 'android' | 'web' | string;

/** Saved per device under this settings key ("" = ask every time). */
export const NAV_PREF_KEY = 'navApp';

/** Apps offered on this platform, in order. Apple Maps only on iOS. */
export function navApps(platform: NavPlatform): NavApp[] {
  return platform === 'ios' ? ['waze', 'google', 'apple'] : ['waze', 'google'];
}

const coord = (n: number) => String(Math.round(n * 1e6) / 1e6);
const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Link that starts driving directions to lat,lng. null for broken coordinates. */
export function navUrl(app: NavApp, lat: number, lng: number): string | null {
  if (!valid(lat, lng)) return null;
  const ll = `${coord(lat)},${coord(lng)}`;
  switch (app) {
    case 'waze': return `https://waze.com/ul?ll=${ll}&navigate=yes`;
    case 'google': return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
    case 'apple': return `http://maps.apple.com/?daddr=${ll}`;
    default: return null;
  }
}

/** The remembered app, if it is still offered on this platform. Anything else → ask. */
export function parseNavPref(raw: string | null | undefined, platform: NavPlatform): NavApp | null {
  return raw && (navApps(platform) as string[]).includes(raw) ? (raw as NavApp) : null;
}

export const NAV_APP_NAMES: Record<NavApp, string> = { waze: 'Waze', google: 'Google Maps', apple: 'Apple Maps' };
