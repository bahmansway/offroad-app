import {
  BAKU, distanceKm, formatDistance, formatNumber, formatPrice, formatTotals, isValidLevel, isValidPrice,
  levelColor, levelPips, modPriceDisplay, parsePriceInput, sumVisiblePrices,
} from '../format';
import { filterSpots, sortByDistance } from '../spotFilters';
import { translate } from '../i18n';
import en from '../../locales/en';
import az from '../../locales/az';
import type { Spot } from '../types';

describe('difficulty helpers', () => {
  it('maps levels 1–5 to the spec colours', () => {
    expect([1, 2, 3, 4, 5].map(levelColor)).toEqual(['#9FD49A', '#E8D36A', '#FF8A2A', '#F0574A', '#C9A0FF']);
  });
  it('falls back for missing / bad levels', () => {
    expect(levelColor(null)).toBe('#ABA493');
    expect(levelColor(0)).toBe('#ABA493');
    expect(levelColor(2.5)).toBe('#ABA493');
    expect(isValidLevel(6)).toBe(false);
  });
  it('fills pips up to the level', () => {
    expect(levelPips(2)).toEqual(['#E8D36A', '#E8D36A', '#3A372C', '#3A372C', '#3A372C']);
    expect(levelPips(null).every((c) => c === '#3A372C')).toBe(true);
  });
});

describe('price formatting', () => {
  it('formats numbers per language', () => {
    expect(formatNumber(6830, 'en')).toBe('6,830');
    expect(formatNumber(6830, 'az')).toBe('6 830');
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.50');
    expect(formatNumber(1234567.5, 'az')).toBe('1 234 567,50');
    expect(formatNumber(0, 'en')).toBe('0');
  });
  it('formats price with currency', () => {
    expect(formatPrice(1850, 'AZN', 'en')).toBe('1,850 AZN');
    expect(formatPrice(380, 'USD', 'az')).toBe('380 USD');
  });
  it('shows "private" when the server hid the price', () => {
    expect(modPriceDisplay({ price: null, currency: 'AZN', pricePublic: false })).toEqual({ kind: 'private' });
    expect(modPriceDisplay({ price: null, currency: 'AZN', pricePublic: true })).toEqual({ kind: 'none' });
    expect(modPriceDisplay({ price: 1400, currency: 'AZN', pricePublic: true }, 'en')).toEqual({
      kind: 'price', text: '1,400 AZN', hiddenFromOthers: false,
    });
    // owner view of a hidden price
    expect(modPriceDisplay({ price: 900, currency: 'EUR', pricePublic: false }, 'en')).toEqual({
      kind: 'price', text: '900 EUR', hiddenFromOthers: true,
    });
  });
  it('formats multi-currency totals, skipping zeros', () => {
    expect(formatTotals({ AZN: 6830, USD: 0, EUR: 200 }, 'en')).toBe('6,830 AZN · 200 EUR');
    expect(formatTotals({ AZN: 0, USD: 0, EUR: 0 }, 'en')).toBe('0 AZN');
    expect(formatTotals(undefined, 'en')).toBe('0 AZN');
  });
  it('sums visible prices by currency', () => {
    expect(sumVisiblePrices([
      { price: 1850, currency: 'AZN' }, { price: null, currency: 'AZN' }, { price: 100, currency: 'USD' }, { price: 50, currency: 'AZN' },
    ])).toEqual({ AZN: 1900, USD: 100, EUR: 0 });
  });
  it('parses typed prices in both styles', () => {
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('1850')).toBe(1850);
    expect(parsePriceInput('1 850')).toBe(1850);
    expect(parsePriceInput('1,850')).toBe(1850);
    expect(parsePriceInput('1,850.50')).toBe(1850.5);
    expect(parsePriceInput('1 850,5')).toBe(1850.5);
    expect(parsePriceInput('12,34')).toBe(12.34);
    expect(parsePriceInput('abc')).toBeNaN();
    expect(parsePriceInput('-5')).toBeNaN();
  });
  it('validates price range', () => {
    expect(isValidPrice(null)).toBe(true);
    expect(isValidPrice(0)).toBe(true);
    expect(isValidPrice(10_000_000)).toBe(true);
    expect(isValidPrice(10_000_001)).toBe(false);
    expect(isValidPrice(NaN)).toBe(false);
  });
});

describe('distance + spot filters', () => {
  const spot = (id: string, type: 'trail' | 'camp', difficulty: number | null, lat: number, lng: number): Spot => ({
    id, type, difficulty, lat, lng, name: id, description: '', season: null, tags: [], ratingAvg: null, ratingCount: 0,
    owner: { id: 'u', displayName: 'U' }, createdAt: '',
  });
  const spots = [
    spot('far-trail', 'trail', 4, 41.2, 47.2),
    spot('near-trail', 'trail', 2, 40.5, 49.9),
    spot('camp', 'camp', null, 40.9, 48.9),
  ];

  it('measures distance from Baku', () => {
    expect(distanceKm(BAKU.lat, BAKU.lng, BAKU.lat, BAKU.lng)).toBe(0);
    // Baku → Ganja is roughly 300–330 km in a straight line
    const ganja = distanceKm(BAKU.lat, BAKU.lng, 40.6828, 46.3606);
    expect(ganja).toBeGreaterThan(290);
    expect(ganja).toBeLessThan(330);
    expect(formatDistance(104.4, 'en')).toBe('104 km');
    expect(formatDistance(0.3, 'en')).toBe('<1 km');
  });
  it('filters by type and level; camps ignore the level range', () => {
    expect(filterSpots(spots, { type: 'all', minLevel: 1, maxLevel: 3 }).map((s) => s.id)).toEqual(['near-trail', 'camp']);
    expect(filterSpots(spots, { type: 'trail', minLevel: 3, maxLevel: 5 }).map((s) => s.id)).toEqual(['far-trail']);
    expect(filterSpots(spots, { type: 'camp', minLevel: 5, maxLevel: 5 }).map((s) => s.id)).toEqual(['camp']);
  });
  it('sorts nearest first', () => {
    expect(sortByDistance(spots).map((s) => s.id)).toEqual(['near-trail', 'camp', 'far-trail']);
  });
});

describe('translations', () => {
  function keys(o: unknown, prefix = ''): string[] {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return [prefix];
    return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  }
  it('az and en have the same keys', () => {
    expect(keys(az).sort()).toEqual(keys(en).sort());
  });
  it('level arrays have 5 entries', () => {
    for (const d of [az, en]) {
      expect(d.levels.names).toHaveLength(5);
      expect(d.levels.explain).toHaveLength(5);
    }
  });
  it('interpolates and picks the singular form', () => {
    expect(translate('en', 'garage.modsCount', { count: 1 })).toBe('1 mod');
    expect(translate('en', 'garage.modsCount', { count: 5 })).toBe('5 mods');
    expect(translate('az', 'garage.hiddenCount', { count: 2 })).toBe('2 gizli');
    expect(translate('en', 'missing.key')).toBe('missing.key');
  });
});
