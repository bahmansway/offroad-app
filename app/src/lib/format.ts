import { tints } from './theme';

export type Lang = 'az' | 'en';
export type Currency = 'AZN' | 'USD' | 'EUR';
export const CURRENCIES: Currency[] = ['AZN', 'USD', 'EUR'];
export const LEVELS = [1, 2, 3, 4, 5] as const;

/** Baku city centre — the reference point for "Near you" distances. */
export const BAKU = { lat: 40.4093, lng: 49.8671 } as const;

export function isValidLevel(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
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

/** "Kamran Məmmədov" → "KM", "kamran_4x4" → "KA". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/[\s_.-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toLocaleUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toLocaleUpperCase();
}

export function sameId(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return a != null && b != null && String(a) === String(b);
}

/**
 * Car money line (DESIGN-PASS P3).
 * - Owner: the big number is the REAL total of every price (the server sends the owner all prices),
 *   plus `othersSee` = the public total, only when some price is hidden from others.
 * - Everyone else: only the server's public total; `othersSee` is null. Private prices never reach
 *   non-owners (the server sends price=null), and this never sums mods for them.
 */
export function carTotalDisplay(
  car: { mods: { price: number | null; currency: string; pricePublic: boolean }[]; totalPublicSpend: Partial<Record<string, number>>; hiddenPriceCount: number },
  isOwner: boolean,
  lang: Lang = 'az',
): { total: string; othersSee: string | null } {
  if (!isOwner) return { total: formatTotals(car.totalPublicSpend, lang), othersSee: null };
  const hidden = car.mods.some((m) => m.price != null && !m.pricePublic) || car.hiddenPriceCount > 0;
  return {
    total: formatTotals(sumVisiblePrices(car.mods), lang),
    othersSee: hidden ? formatTotals(car.totalPublicSpend, lang) : null,
  };
}

/** Short date for lists: "bu gün" / "dünən" / "29 okt" (this year) / "29 okt 2025". Device-local day. */
export function formatShortDate(
  iso: string | null | undefined,
  words: { today: string; yesterday: string; monthsShort: string[] },
  lang: Lang = 'az',
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return words.today;
  if (diff === 1) return words.yesterday;
  const mon = (words.monthsShort[d.getMonth()] ?? '').toLocaleLowerCase(lang === 'az' ? 'az' : 'en');
  const base = `${d.getDate()} ${mon}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Average rating with one decimal in the app's number style: "4.0" (en) / "4,0" (az). null → "–". */
export function formatAvg(avg: number | null | undefined, lang: Lang = 'az'): string {
  if (avg == null || !Number.isFinite(avg)) return '–';
  const s = (Math.round(avg * 10) / 10).toFixed(1);
  return lang === 'az' ? s.replace('.', ',') : s;
}
