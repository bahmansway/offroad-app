import type { Spot } from './types';

/**
 * Map pins as GeoJSON points (SPEC-v6 §5 performance). The map keeps its own copy of the points inside the
 * WebView / map source; React only sends what changed (added, changed, removed), never the whole list again.
 */
export interface PinPoint {
  /** spot id (string) */
  id: string;
  lat: number;
  lng: number;
  /** 'trail' | 'camp' */
  k: 'trail' | 'camp';
  /** trail level 1–5, 0 = none (camps) */
  l: number;
}

export interface PinDiff {
  add: PinPoint[];
  update: PinPoint[];
  remove: string[];
}

export function toPinPoint(s: Pick<Spot, 'id' | 'lat' | 'lng' | 'type' | 'difficulty'>): PinPoint | null {
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || Math.abs(s.lat) > 90 || Math.abs(s.lng) > 180) return null;
  const level = s.type === 'trail' && Number.isInteger(s.difficulty) && s.difficulty! >= 1 && s.difficulty! <= 5 ? s.difficulty! : 0;
  return { id: String(s.id), lat: s.lat, lng: s.lng, k: s.type === 'camp' ? 'camp' : 'trail', l: level };
}

const sig = (p: PinPoint) => `${p.lat},${p.lng},${p.k},${p.l}`;

/** What changed between the points on the map (`prev`, id → point) and the spots to show now. */
export function diffPins(prev: Map<string, PinPoint>, spots: Pick<Spot, 'id' | 'lat' | 'lng' | 'type' | 'difficulty'>[]): {
  diff: PinDiff; next: Map<string, PinPoint>;
} {
  const next = new Map<string, PinPoint>();
  for (const s of spots) {
    const p = toPinPoint(s);
    if (p) next.set(p.id, p);
  }
  const add: PinPoint[] = [];
  const update: PinPoint[] = [];
  const remove: string[] = [];
  next.forEach((p, id) => {
    const old = prev.get(id);
    if (!old) add.push(p);
    else if (sig(old) !== sig(p)) update.push(p);
  });
  prev.forEach((_p, id) => {
    if (!next.has(id)) remove.push(id);
  });
  return { diff: { add, update, remove }, next };
}

export const isEmptyDiff = (d: PinDiff) => !d.add.length && !d.update.length && !d.remove.length;

/** Apply a diff to a point store (used inside the map page and by the web map). */
export function applyPinDiff(store: Map<string, PinPoint>, d: PinDiff): Map<string, PinPoint> {
  d.remove.forEach((id) => store.delete(id));
  d.add.forEach((p) => store.set(p.id, p));
  d.update.forEach((p) => store.set(p.id, p));
  return store;
}

/** GeoJSON for the clustered source. `sel` marks the selected pin (drawn orange, never clustered away). */
export function pinsGeoJson(store: Map<string, PinPoint>) {
  const features: object[] = [];
  store.forEach((p) => {
    features.push({ type: 'Feature', id: p.id, properties: { id: p.id, k: p.k, l: p.l }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
  });
  return { type: 'FeatureCollection', features };
}
