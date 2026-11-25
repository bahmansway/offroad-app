import type { Spot, SpotType } from './types';
import { distanceFromBaku } from './format';

export type TypeFilter = 'all' | SpotType;

export interface SpotFilter {
  type: TypeFilter;
  minLevel: number;
  maxLevel: number;
}

/** Client-side filter: trails must be within the level range; camps have no level and pass when type is "all" or "camp". */
export function filterSpots(spots: Spot[], f: SpotFilter): Spot[] {
  return spots.filter((s) => {
    if (f.type !== 'all' && s.type !== f.type) return false;
    if (s.type === 'trail') {
      const lvl = s.difficulty ?? 0;
      return lvl >= f.minLevel && lvl <= f.maxLevel;
    }
    return true;
  });
}

/** Nearest to Baku centre first. */
export function sortByDistance(spots: Spot[]): (Spot & { km: number })[] {
  return spots.map((s) => ({ ...s, km: distanceFromBaku(s) })).sort((a, b) => a.km - b.km);
}

/** v6 filter popover: tapping a level tile changes the difficulty range.
 *  All levels → just that level; outside the range → stretch to it; an end of the range → pull that end in;
 *  inside → make it the new top; the only selected level again → back to all levels. */
export function tapLevel(range: [number, number], n: number): [number, number] {
  const [lo, hi] = range;
  if (lo === 1 && hi === 5) return [n, n];
  if (n < lo) return [n, hi];
  if (n > hi) return [lo, n];
  if (lo === hi) return [1, 5];
  if (n === lo) return [lo + 1, hi];
  if (n === hi) return [lo, hi - 1];
  return [lo, n];
}

/** Number of filters that are on (for the orange badge on the filter button). */
export function activeFilterCount(range: [number, number]): number {
  return range[0] !== 1 || range[1] !== 5 ? 1 : 0;
}
