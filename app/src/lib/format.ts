import { levelColors, colors, tints } from './theme';

export type Lang = 'az' | 'en';
export type Currency = 'AZN' | 'USD' | 'EUR';
export const CURRENCIES: Currency[] = ['AZN', 'USD', 'EUR'];
export const LEVELS = [1, 2, 3, 4, 5] as const;

/** Baku city centre — the reference point for "Near you" distances. */
export const BAKU = { lat: 40.4093, lng: 49.8671 } as const;

export function isValidLevel(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Colour for a difficulty level (1–5). Falls back to the muted colour. */
export function levelColor(level: number | null | undefined): string {
  return isValidLevel(level) ? levelColors[level - 1] : colors.muted;
}

/** Five pip colours: filled up to `level` in the level colour, rest in the line colour. */
export function levelPips(level: number | null | undefined): string[] {
  const c = levelColor(level);
  return [1, 2, 3, 4, 5].map((i) => (isValidLevel(level) && i <= level ? c : colors.line));
}

/** Formats a number with locale-appropriate separators.
 *  en: 6,830.5   az: 6 830,5  (Azerbaijani uses a space for thousands and a comma for decimals). */
export function formatNumber(value: number, lang: Lang = 'az'): string {
  if (!Number.isFinite(value)) return '';
  const negative = value < 0;
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 100) / 100;
  const int = Math.floor(rounded);
  const frac = Math.round((rounded - int) * 100);
  const groupSep = lang === 'az' ? ' ' : ',';
  const decSep = lang === 'az' ? ',' : '.';
  const grouped = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  const decimals = frac > 0 ? decSep + String(frac).padStart(2, '0') : '';
  return (negative ? '-' : '') + grouped + decimals;
}

export function formatPrice(amount: number, currency: Currency | string, lang: Lang = 'az'): string {
  return `${formatNumber(amount, lang)} ${currency}`;
}

export type PriceDisplay =
  | { kind: 'price'; text: string; hiddenFromOthers: boolean }
  | { kind: 'private' }
  | { kind: 'none' };

/** How to show a mod's price. The server sends price=null to non-owners when pricePublic is false. */
export function modPriceDisplay(
  mod: { price: number | null; currency: string; pricePublic: boolean },
  lang: Lang = 'az',
): PriceDisplay {
  if (mod.price === null || mod.price === undefined) {
    return mod.pricePublic ? { kind: 'none' } : { kind: 'private' };
  }
  return { kind: 'price', text: formatPrice(mod.price, mod.currency, lang), hiddenFromOthers: !mod.pricePublic };
}

/** "6,830 AZN · 200 USD" — skips zero currencies. Returns "0 AZN" when everything is zero. */
export function formatTotals(totals: Partial<Record<string, number>> | null | undefined, lang: Lang = 'az'): string {
  const parts = CURRENCIES.filter((c) => (totals?.[c] ?? 0) > 0).map((c) => formatPrice(totals![c]!, c, lang));
  return parts.length ? parts.join(' · ') : formatPrice(0, 'AZN', lang);
}

/** Sums all prices the current viewer can see, grouped by currency. */
export function sumVisiblePrices(mods: { price: number | null; currency: string }[]): Record<Currency, number> {
  const out: Record<Currency, number> = { AZN: 0, USD: 0, EUR: 0 };
  for (const m of mods) {
    if (m.price != null && (CURRENCIES as string[]).includes(m.currency)) out[m.currency as Currency] += m.price;
  }
  return out;
}

/** Parses a price typed by a user ("1 850,50", "1,850.50", "1850"). Empty → null, invalid → NaN. */
export function parsePriceInput(raw: string): number | null {
  const s = raw.trim().replace(/[\s ]/g, '');
  if (s === '') return null;
  let normalized = s;
  if (s.includes(',') && s.includes('.')) {
    normalized = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    // single comma followed by 1–2 digits → decimal comma, otherwise thousands separator
    normalized = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Number(normalized);
}

export function isValidPrice(n: number | null): boolean {
  return n === null || (Number.isFinite(n) && n >= 0 && n <= 10_000_000);
}

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function distanceFromBaku(p: { lat: number; lng: number }): number {
  return distanceKm(BAKU.lat, BAKU.lng, p.lat, p.lng);
}

export function formatDistance(km: number, lang: Lang = 'az'): string {
  if (km < 1) return '<1 km';
  return `${formatNumber(Math.round(km), lang)} km`;
}

/** dd.mm.yyyy — common in Azerbaijan and unambiguous in English too. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatRating(avg: number | null | undefined): string {
  return avg == null || !Number.isFinite(avg) ? '–' : avg.toFixed(1);
}

/** Stable colour tile for an id (photos come in v2). */
export function tintFor(id: string | number): string {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return tints[h % tints.length];
}

export function sameId(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return a != null && b != null && String(a) === String(b);
}
