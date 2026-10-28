import {
  brandMonogram, carInputFromTrim, defaultYear, groupBrands, matchesQuery, normalizeSearch, splitModels, toArray,
  powerUnitLabel, trimSummary, trimsForYear, yearOptions,
} from '../catalog';
import { errorMessage } from '../errors';
import { ApiError } from '../apiClient';
import { translate } from '../i18n';
import type { CatalogBrand, Trim } from '../types';

const NOW = new Date('2026-10-28T12:00:00Z');

const trim = (p: Partial<Trim>): Trim => ({
  id: 'x', brand: 'Toyota', model: 'Land Cruiser Prado', generation: '150', yearFrom: 2009, yearTo: 2023,
  engine: '2.8 D-4D diesel', engineL: 2.8, hp: 177, drive: '4WD', transmission: 'automatic', fuel: 'diesel', ...p,
});

describe('catalog search', () => {
  it('normalises case, accents and Azerbaijani letters', () => {
    expect(normalizeSearch('  Şahdağ ')).toBe('sahdag');
    expect(normalizeSearch('Mercedes-Benz')).toBe('mercedes benz');
    expect(normalizeSearch('Əli')).toBe('eli');
  });
  it('matches every word anywhere, also without spaces', () => {
    expect(matchesQuery('Land Cruiser Prado', 'prado')).toBe(true);
    expect(matchesQuery('Land Cruiser Prado', 'land prado')).toBe(true);
    expect(matchesQuery('Land Cruiser Prado', 'landcruiser')).toBe(true);
    expect(matchesQuery('Hilux', 'prado')).toBe(false);
    expect(matchesQuery('Anything', '   ')).toBe(true);
  });
});

describe('brand list', () => {
  const brands: CatalogBrand[] = [
    { name: 'Volvo', modelCount: 3 }, { name: 'UAZ', modelCount: 4 }, { name: 'Toyota', modelCount: 40 },
    { name: 'Lada', modelCount: 9 }, { name: 'Alfa Romeo', modelCount: 5 }, { name: 'Land Rover', modelCount: 8 },
  ];
  it('shows popular brands in fixed order and all brands A–Z', () => {
    const g = groupBrands(brands, '');
    expect(g.popular.map((b) => b.name)).toEqual(['Toyota', 'Land Rover', 'Lada', 'UAZ']);
    expect(g.all.map((b) => b.name)).toEqual(['Alfa Romeo', 'Lada', 'Land Rover', 'Toyota', 'UAZ', 'Volvo']);
  });
  it('search hides popular and puts prefix matches first', () => {
    const g = groupBrands(brands, 'la');
    expect(g.popular).toEqual([]);
    expect(g.all.map((b) => b.name)).toEqual(['Lada', 'Land Rover']);
    expect(groupBrands(brands, 'ro').all.map((b) => b.name)).toEqual(['Alfa Romeo', 'Land Rover']);
  });
  it('makes brand monograms like the mockup', () => {
    expect(brandMonogram('Toyota')).toBe('TY');
    expect(brandMonogram('Land Rover')).toBe('LR');
    expect(brandMonogram('Mercedes-Benz')).toBe('MB');
    expect(brandMonogram('UAZ')).toBe('UZ');
    expect(brandMonogram('Jeep')).toBe('JP');
  });
});

describe('model list', () => {
  it('splits offroad models first, both sorted and filtered', () => {
    const r = splitModels([
      { name: 'RAV4', offroad: false }, { name: 'Land Cruiser Prado', offroad: true },
      { name: 'Hilux', offroad: true }, { name: 'Corolla', offroad: false },
    ], '');
    expect(r.offroad.map((m) => m.name)).toEqual(['Hilux', 'Land Cruiser Prado']);
    expect(r.other.map((m) => m.name)).toEqual(['Corolla', 'RAV4']);
    expect(splitModels([{ name: 'Hilux', offroad: true }, { name: 'RAV4', offroad: false }], 'rav').offroad).toEqual([]);
  });
});

describe('years and trims', () => {
  const trims = [
    trim({ id: 'p150-28', yearFrom: 2015, yearTo: 2023, hp: 177 }),
    trim({ id: 'p150-40', engine: '4.0 V6 petrol', yearFrom: 2009, yearTo: 2023, hp: 282, fuel: 'petrol' }),
    trim({ id: 'p250', generation: '250', yearFrom: 2024, yearTo: null, hp: 204 }),
  ];
  it('lists every covered year, newest first, ongoing trims up to this year', () => {
    const ys = yearOptions(trims, NOW);
    expect(ys[0]).toBe(2026);
    expect(ys[ys.length - 1]).toBe(2009);
    expect(new Set(ys).size).toBe(ys.length);
  });
  it('falls back to recent years when there are no trims', () => {
    const ys = yearOptions([], NOW, 5);
    expect(ys).toEqual([2026, 2025, 2024, 2023, 2022]);
  });
  it('never offers a year the server would reject', () => {
    expect(yearOptions([trim({ yearFrom: 1940, yearTo: 1952 })], NOW)).toEqual([1952, 1951, 1950]);
  });
  it('filters trims by year, strongest first', () => {
    expect(trimsForYear(trims, 2018, NOW).map((t) => t.id)).toEqual(['p150-40', 'p150-28']);
    expect(trimsForYear(trims, 2012, NOW).map((t) => t.id)).toEqual(['p150-40']);
    expect(trimsForYear(trims, 2026, NOW).map((t) => t.id)).toEqual(['p250']);
    expect(trimsForYear(trims, null, NOW)).toEqual([]);
  });
  it('defaults to the newest year that is not in the future', () => {
    expect(defaultYear(trims, NOW)).toBe(2026);
    expect(defaultYear([trim({ yearFrom: 2009, yearTo: 2015 })], NOW)).toBe(2015);
    expect(defaultYear([], NOW)).toBeNull();
  });
});

describe('car body from a trim', () => {
  it('copies all spec values (the server does not fill them in)', () => {
    const t = trim({ id: 'p150-40', engine: '4.0 V6 petrol', engineL: 4, hp: 282, fuel: 'petrol' });
    expect(carInputFromTrim('Toyota', 'Land Cruiser Prado', 2018, t)).toEqual({
      make: 'Toyota', model: 'Land Cruiser Prado', year: 2018, trimId: 'p150-40', engine: '4.0 V6 petrol',
      engineL: 4, hp: 282, drive: '4WD', transmission: 'automatic', fuel: 'petrol',
    });
  });
  it('converts PS trims to hp', () => {
    const t = trim({ hp: 286, powerUnit: 'PS' } as never);
    expect(carInputFromTrim('Toyota', 'Land Cruiser', 2016, t).hp).toBe(282);
  });
  it('works without a trim and trims long names to the server limits', () => {
    expect(carInputFromTrim(' Lada ', 'Niva Legend', 2021, null)).toEqual({ make: 'Lada', model: 'Niva Legend', year: 2021 });
    expect(carInputFromTrim('B'.repeat(50), 'M'.repeat(70), 2020, null).make).toHaveLength(40);
  });
  it('summarises a trim with translated words', () => {
    expect(trimSummary(trim({}), { hp: 'hp', transmission: { automatic: 'Avtomat' } })).toBe('177 hp · 4WD · Avtomat');
  });
});

describe('server list shapes', () => {
  it('accepts a bare array or {items}', () => {
    expect(toArray([1, 2])).toEqual([1, 2]);
    expect(toArray({ items: [3] })).toEqual([3]);
    expect(toArray(null)).toEqual([]);
    expect(toArray({ nope: 1 })).toEqual([]);
  });
});

describe('power unit and server limits', () => {
  it('shows PS for metric figures and the hp word otherwise', () => {
    expect(powerUnitLabel({ powerUnit: 'PS' }, 'at gücü')).toBe('PS');
    expect(powerUnitLabel({ powerUnit: 'hp' }, 'hp')).toBe('hp');
    expect(powerUnitLabel({}, 'hp')).toBe('hp');
    expect(trimSummary(trim({ powerUnit: 'PS', hp: 286 }), { hp: 'hp', transmission: {} })).toBe('286 PS · 4WD · automatic');
  });
  it('explains the 20-car cap and the photo quota', () => {
    const t = (k: string, p?: Record<string, string | number>) => translate('en', k, p);
    expect(errorMessage(new ApiError(409, 'CONFLICT', ''), t, 'car')).toMatch(/20 cars/);
    expect(errorMessage(new ApiError(409, 'CONFLICT', ''), t, 'photo')).toMatch(/20 MB/);
    expect(errorMessage(new ApiError(413, 'VALIDATION', ''), t, 'photo')).toMatch(/too large/);
    expect(errorMessage(new ApiError(415, 'VALIDATION', ''), t, 'photo')).toMatch(/could not be uploaded/);
  });
});
