import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Spot } from '../lib/types';
import { colors, fonts, radius } from '../lib/theme';
import { formatDistance, tintFor } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { Icon } from './Icon';
import { LevelPips } from './ui';

export function SpotRow({ spot, km, onPress }: { spot: Spot; km?: number; onPress: () => void }) {
  const { t, d, lang } = useI18n();
  const parts: string[] = [];
  if (spot.type === 'trail' && spot.difficulty) {
    parts.push(t('levels.label', { n: spot.difficulty }), d.levels.names[spot.difficulty - 1]);
  } else {
    parts.push(t('spot.camp'));
    if (spot.tags.length) parts.push(spot.tags.slice(0, 2).join(', '));
  }
  if (km !== undefined) parts.push(formatDistance(km, lang));
  const meta = parts.join(' · ');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${spot.name}, ${meta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.tile, { backgroundColor: tintFor(spot.id) }]}>
        {spot.type === 'camp' ? <Icon name="tent" size={22} color={colors.text} /> : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>{spot.name}</Text>
        <View style={styles.metaRow}>
          {spot.type === 'trail' ? <LevelPips level={spot.difficulty} /> : null}
          <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        </View>
      </View>
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  tile: { width: 56, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
});
