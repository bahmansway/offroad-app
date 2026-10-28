import type { Car } from './types';

type T = (k: string, p?: Record<string, string | number>) => string;

/** Up to 4 spec tiles (Power · Engine · Drive · Fuel), only those that are filled in. */
export function specTiles(car: Car, t: T, d: { specs: { fuels: Record<string, string>; transmissions: Record<string, string> } }) {
  const out: { k: string; v: string }[] = [];
  if (car.hp) out.push({ k: t('specs.power'), v: `${car.hp} ${t('specs.hpShort')}` });
  if (car.engine || car.engineL) out.push({ k: t('specs.engine'), v: shortEngine(car) });
  if (car.drive) out.push({ k: t('specs.drive'), v: car.drive });
  if (car.fuel) out.push({ k: t('specs.fuel'), v: d.specs.fuels[car.fuel] ?? car.fuel });
  else if (car.transmission) out.push({ k: t('specs.transmission'), v: d.specs.transmissions[car.transmission] ?? car.transmission });
  return out.slice(0, 4);
}

export function shortEngine(car: Pick<Car, 'engine' | 'engineL'>): string {
  if (car.engine) {
    // "4.0 V6 petrol" → "4.0 V6" (fuel has its own tile)
    const m = car.engine.match(/^(\d+(?:[.,]\d)?\s*(?:L\b)?\s*(?:[VWIL]\d{1,2}|R\d|B\d)?)/i);
    return (m?.[1] ?? car.engine).trim() || car.engine;
  }
  return `${car.engineL} L`;
}
