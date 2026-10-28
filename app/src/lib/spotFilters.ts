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
