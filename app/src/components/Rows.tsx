import React from 'react';
import type { CarSummary, Spot } from '../lib/types';
import { formatDistance, formatRating } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { API_URL } from '../lib/config';
import { absoluteUrl } from '../lib/photos';
import { Cell } from './ui/List';
import { Thumb } from './ui/Avatar';
import { Badge } from './ui/Controls';

export function carTitle(c: { make: string; model: string }) {
  return `${c.make} ${c.model}`.trim();
}

export function photoUri(url: string | null | undefined) {
  return absoluteUrl(url, API_URL);
}

/** Grouped-list row for a spot: thumb, name, "Trail · 104 km", "2 · Orta" badge. Use inside <Section>. */
export function SpotCell({ spot, km, onPress, last }: { spot: Spot; km?: number; onPress: () => void; last?: boolean }) {
  const { t, d, lang } = useI18n();
  const parts = [spot.type === 'trail' ? t('spot.trail') : t('spot.camp')];
  if (km !== undefined) parts.push(formatDistance(km, lang));
  const meta = parts.join(' · ');
  const level = spot.type === 'trail' && spot.difficulty ? `${spot.difficulty} · ${d.levels.names[spot.difficulty - 1]}` : null;
  return (
    <Cell
      title={spot.name}
      subtitle={meta}
      left={<Thumb seed={spot.id} icon={spot.type === 'camp' ? 'tent' : 'explore'} />}
      right={level ? <Badge text={level} /> : null}
      chevron={false}
      onPress={onPress}
      minHeight={64}
      accessibilityRole="link"
      accessibilityLabel={`${spot.name}, ${meta}${level ? `, ${t('spot.difficulty')} ${level}` : ''}`}
      last={last}
    />
  );
}

/** Grouped-list row for a car: photo, "Toyota Land Cruiser", "2018 · 4.0 V6 · owner", ★ rating. */
export function CarCell({ car, onPress, showOwner, last, badge }: {
  car: CarSummary; onPress: () => void; showOwner?: boolean; last?: boolean; badge?: string;
}) {
  const meta = [String(car.year), car.engine, showOwner && car.owner ? car.owner.displayName : null].filter(Boolean).join(' · ');
  const hasRating = (car.ratingCount ?? 0) > 0;
  return (
    <Cell
      title={carTitle(car)}
      subtitle={meta}
      left={<Thumb seed={car.id} uri={photoUri(car.photoUrl)} />}
      value={badge ? undefined : hasRating ? `★ ${formatRating(car.ratingAvg)}` : undefined}
      right={badge ? <Badge text={badge} /> : undefined}
      onPress={onPress}
      chevron
      minHeight={64}
      accessibilityRole="link"
      accessibilityLabel={`${carTitle(car)}, ${meta}${hasRating ? `, ★ ${formatRating(car.ratingAvg)}` : ''}${badge ? `, ${badge}` : ''}`}
      last={last}
    />
  );
}
