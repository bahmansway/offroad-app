import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CarSummary } from '../lib/types';
import { colors, fonts, radius } from '../lib/theme';
import { formatRating, tintFor } from '../lib/format';
import { Icon } from './Icon';

export function carTitle(c: { make: string; model: string }) {
  return `${c.make} ${c.model}`.trim();
}

export function CarRow({ car, onPress, showOwner }: { car: CarSummary; onPress: () => void; showOwner?: boolean }) {
  const meta = [String(car.year), car.engine, showOwner && car.owner ? car.owner.displayName : null].filter(Boolean).join(' · ');
  const hasRating = (car.ratingCount ?? 0) > 0;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${carTitle(car)}, ${meta}${hasRating ? `, ★ ${formatRating(car.ratingAvg)}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.tile, { backgroundColor: tintFor(car.id) }]}>
        <Icon name="car" size={24} color={colors.text} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.name} numberOfLines={1}>{carTitle(car)}</Text>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
      </View>
      {hasRating ? (
        <View style={styles.rating}>
          <Icon name="star" size={14} color={colors.accent} fill={colors.accent} />
          <Text style={styles.ratingText}>{formatRating(car.ratingAvg)}</Text>
        </View>
      ) : null}
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  tile: { width: 56, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontFamily: fonts.head, fontSize: 18, color: colors.accent },
});
