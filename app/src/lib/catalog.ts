// Pure helpers for the Add-car flow (brand → model → year → trim). No React here, so it is unit-tested.
import type { CarInput, CatalogBrand, CatalogModel, Trim } from './types';

/** Accepts `[...]` or `{items:[...]}` (the server may wrap lists). Anything else → []. */
export function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  const items = (v as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

/** Brands most drivers in Azerbaijan pick, in the order shown under "Popular". */
export const POPULAR_BRANDS = [
  'Toyota', 'Nissan', 'Mitsubishi', 'Land Rover', 'Mercedes-Benz', 'Jeep', 'Lada', 'UAZ', 'Lexus', 'Suzuki',
] as const;

/** Lower-case, strip accents and map Azerbaijani/Turkish letters so "şahdag" finds "Şahdağ" and "lada" finds "LADA". */
export function normalizeSearch(s: string): string {
  return s
    .toLocaleLowerCase('en')
    .replace(/ı/g, 'i')
    .replace(/ə/g, 'e')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-_.]+/g, ' ')
    .trim();
}

/** True when every word of `query` starts a word in `name` or appears inside it. */
export function matchesQuery(name: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const n = normalizeSearch(name);
  const compactN = n.replace(/ /g, '');
  return q.split(' ').every((w) => n.includes(w) || compactN.includes(w));
}

const sortAZ = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/**
 * Brand list for step 1. Without a query: popular brands (that exist in the catalog) + all brands A–Z.
 * With a query: one A–Z list of matches, brands whose name starts with the query first.
 */
export function groupBrands(brands: CatalogBrand[], query: string): { popular: CatalogBrand[]; all: CatalogBrand[] } {
  const byName = new Map(brands.map((b) => [normalizeSearch(b.name), b]));
  const q = normalizeSearch(query);
  if (q) {
    const hits = brands.filter((b) => matchesQuery(b.name, q));
    const starts = (b: CatalogBrand) => (normalizeSearch(b.name).startsWith(q) ? 0 : 1);
    hits.sort((a, b) => starts(a) - starts(b) || sortAZ(a.name, b.name));
    return { popular: [], all: hits };
  }
  const popular = POPULAR_BRANDS.map((n) => byName.get(normalizeSearch(n))).filter((b): b is CatalogBrand => !!b);
  return { popular, all: [...brands].sort((a, b) => sortAZ(a.name, b.name)) };
}

/** Step 2: offroad models (with curated trims) first, then the rest; both A–Z and filtered by query. */
export function splitModels(models: CatalogModel[], query: string): { offroad: CatalogModel[]; other: CatalogModel[] } {
  const hits = models.filter((m) => matchesQuery(m.name, query)).sort((a, b) => sortAZ(a.name, b.name));
  return { offroad: hits.filter((m) => m.offroad), other: hits.filter((m) => !m.offroad) };
}

/** Two-letter monogram for the brand circle: "Toyota" → "TY", "Land Rover" → "LR", "UAZ" → "UZ". */
export function brandMonogram(name: string): string {
  const words = name.split(/[\s\-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? '';
  if (!w) return '?';
  const rest = w.slice(1).replace(/[aeiouəıüöAEIOU\W\d]/g, '');
  return (w[0] + (rest[0] ?? w[1] ?? '')).toUpperCase();
}

/** Latest year a car can have (server accepts up to next year). */
export const maxModelYear = (now = new Date()) => now.getFullYear() + 1;
export const MIN_YEAR = 1950;

/**
 * Year pills for step 3. With trims: every year any trim covers (newest first, capped at this year+1).
 * Without trims: the last `fallbackSpan` years, so manual entry is only needed for older cars.
 */
export function yearOptions(trims: Trim[], now = new Date(), fallbackSpan = 30): number[] {
  const max = maxModelYear(now);
  const current = now.getFullYear();
  const set = new Set<number>();
  for (const t of trims) {
    const from = Math.max(MIN_YEAR, t.yearFrom);
    const to = Math.min(max, t.yearTo ?? current);
    for (let y = from; y <= to; y++) set.add(y);
  }
  if (set.size === 0) for (let y = current; y > current - fallbackSpan && y >= MIN_YEAR; y--) set.add(y);
  return [...set].sort((a, b) => b - a);
}

/** Trims sold in `year` (yearTo null = still on sale). Most powerful first within a generation. */
export function trimsForYear(trims: Trim[], year: number | null, now = new Date()): Trim[] {
  if (year == null) return [];
  const current = now.getFullYear();
  return trims
    .filter((t) => t.yearFrom <= year && (t.yearTo ?? current + 1) >= year)
    .sort((a, b) => a.generation.localeCompare(b.generation) || b.hp - a.hp);
}

/** Default selected year: newest year that has trims, else null (user picks). */
export function defaultYear(trims: Trim[], now = new Date()): number | null {
  const ys = trims.length ? yearOptions(trims, now) : [];
  return ys.find((y) => y <= now.getFullYear()) ?? ys[0] ?? null;
}

/** Car body for POST /api/cars from a chosen trim. Specs stay editable later. */
export function carInputFromTrim(brand: string, model: string, year: number, trim: Trim | null): CarInput {
  const base: CarInput = { make: brand.trim().slice(0, 40), model: model.trim().slice(0, 60), year };
  if (!trim) return base;
  return {
    ...base,
    trimId: trim.id,
    engine: trim.engine.slice(0, 40),
    engineL: trim.engineL,
    hp: trim.hp,
    drive: trim.drive,
    transmission: trim.transmission,
    fuel: trim.fuel,
  };
}

/** Unit label for a trim's power: "PS" stays "PS"; "hp" (or missing) uses the translated word. */
export function powerUnitLabel(t: Pick<Trim, 'powerUnit'>, hpWord: string): string {
  return t.powerUnit === 'PS' ? 'PS' : hpWord;
}

/** "177 PS · 4WD · Automatic" — words come from the translation dictionary. */
export function trimSummary(
  t: Pick<Trim, 'hp' | 'drive' | 'transmission' | 'powerUnit'>,
  words: { hp: string; transmission: Record<string, string> },
): string {
  return [`${t.hp} ${powerUnitLabel(t, words.hp)}`, t.drive, words.transmission[t.transmission] ?? t.transmission].join(' · ');
}
