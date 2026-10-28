import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SpotMap from '../../components/map/Map';
import { SpotRow } from '../../components/SpotRow';
import { Icon } from '../../components/Icon';
import { Button, Chip, ErrorState, H2, Muted, s as ui } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { useI18n } from '../../lib/i18n';
import { colors, fonts, levelColors, radius } from '../../lib/theme';
import { filterSpots, sortByDistance, type TypeFilter } from '../../lib/spotFilters';
import type { Spot } from '../../lib/types';

const NEAR_COUNT = 5;

export default function ExploreScreen() {
  const { t, d } = useI18n();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const [error, setError] = useState<unknown>(null);
  const [type, setType] = useState<TypeFilter>('all');
  const [range, setRange] = useState<[number, number]>([1, 5]);
  const [levelOpen, setLevelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(h);
  }, [query]);

  const load = useCallback(async () => {
    // Only the newest request may update the list (typing fast fires several).
    const id = ++seq.current;
    try {
      const res = await api.spots({ q: debounced || undefined });
      if (id !== seq.current) return;
      setError(null);
      setSpots(res.items);
    } catch (e) {
      if (id === seq.current) setError(e);
    } finally {
      if (id === seq.current) setLoaded(true);
    }
  }, [debounced]);

  // reload whenever the tab gets focus (e.g. after adding or deleting a spot)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = useMemo(() => filterSpots(spots, { type, minLevel: range[0], maxLevel: range[1] }), [spots, type, range]);
  const near = useMemo(() => sortByDistance(visible), [visible]);
  const list = showAll ? near : near.slice(0, NEAR_COUNT);

  const pinLabel = useCallback(
    (sp: Spot) => sp.type === 'camp' ? t('explore.campPin', { name: sp.name }) : t('explore.spotPin', { name: sp.name, level: sp.difficulty ?? '' }),
    [t],
  );
  const openSpot = useCallback((id: Spot['id']) => router.push(`/spot/${id}`), []);
  const levelActive = range[0] !== 1 || range[1] !== 5;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.brand} accessibilityRole="header">{t('appName')}</Text>
        <View style={ui.inputWrap}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('explore.search')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('explore.searchLabel')}
            returnKeyType="search"
            maxLength={80}
            style={[ui.input, { marginLeft: 10 }]}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('explore.all')} selected={type === 'all'} onPress={() => setType('all')} />
          <Chip label={t('explore.trails')} selected={type === 'trail'} onPress={() => setType('trail')} />
          <Chip label={t('explore.camps')} selected={type === 'camp'} onPress={() => setType('camp')} />
          <Chip
            label={t('explore.levelRange', { min: range[0], max: range[1] })}
            accessibilityLabel={`${t('explore.levelFilterTitle')}: ${range[0]}–${range[1]}`}
            selected={levelActive || levelOpen}
            onPress={() => setLevelOpen((o) => !o)}
          />
        </ScrollView>
        {levelOpen ? (
          <View style={styles.levelPanel}>
            <Text style={ui.label}>{t('explore.levelFilterTitle')}</Text>
            {(['minLevel', 'maxLevel'] as const).map((which, idx) => (
              <View key={which} style={styles.levelRow} accessibilityRole="radiogroup" accessibilityLabel={t(`explore.${which}`)}>
                <Text style={[ui.muted, { width: 80 }]}>{t(`explore.${which}`)}</Text>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = range[idx] === n;
                  const disabled = idx === 0 ? n > range[1] : n < range[0];
                  return (
                    <Pressable
                      key={n}
                      accessibilityRole="radio"
                      accessibilityLabel={`${n} — ${d.levels.names[n - 1]}`}
                      accessibilityState={{ checked: on, disabled }}
                      disabled={disabled}
                      onPress={() => setRange((r) => (idx === 0 ? [n, r[1]] : [r[0], n]))}
                      style={[styles.levelBtn, { borderColor: levelColors[n - 1] }, on && { backgroundColor: levelColors[n - 1] }, disabled && { opacity: 0.35 }]}
                    >
                      <Text style={[styles.levelBtnText, { color: on ? colors.onAccent : colors.text }]}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <Muted style={{ fontSize: 13 }}>{t('explore.levelFilterHint')}</Muted>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title={t('explore.reset')} variant="secondary" style={{ flex: 1 }} onPress={() => setRange([1, 5])} />
              <Button title={t('explore.apply')} style={{ flex: 1 }} onPress={() => setLevelOpen(false)} />
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.map}>
        <SpotMap
          spots={visible}
          onSpotPress={openSpot}
          label={t('explore.mapLabel')}
          pinLabel={pinLabel}
          failedText={t('map.loadFailed')}
        />
      </View>

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.sheetHead}>
          <View>
            <H2>{t('explore.nearYou')}</H2>
            <Muted style={{ fontSize: 12 }}>{t('explore.nearYouHint')}</Muted>
          </View>
          {near.length > NEAR_COUNT ? (
            <Pressable accessibilityRole="button" onPress={() => setShowAll((v) => !v)} style={styles.link} hitSlop={8}>
              <Text style={styles.linkText}>{showAll ? t('explore.showLess') : t('explore.seeAll')}</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 90 }}>
          {error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : null}
          {!loaded && !error ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 16 }} accessibilityLabel={t('common.loading')} /> : null}
          {loaded && !error && list.length === 0 ? <Muted style={{ textAlign: 'center', paddingVertical: 16 }}>{t('explore.empty')}</Muted> : null}
          {list.map((sp) => <SpotRow key={sp.id} spot={sp} km={sp.km} onPress={() => openSpot(sp.id)} />)}
        </ScrollView>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('explore.addSpot')}
        onPress={() => router.push(user ? '/spot/new' : '/login')}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
      >
        <Icon name="plus" size={26} color={colors.onAccent} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, gap: 12, backgroundColor: colors.bg, zIndex: 2 },
  brand: { fontFamily: fonts.head, fontSize: 26, letterSpacing: 1, color: colors.text },
  chips: { gap: 8, paddingVertical: 4 },
  levelPanel: { gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  levelBtnText: { fontFamily: fonts.head, fontSize: 18 },
  map: { flex: 1, minHeight: 260 },
  sheet: {
    height: '38%', minHeight: 240, marginTop: -18, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingTop: 10, gap: 10, zIndex: 2,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent },
  fab: {
    position: 'absolute', right: 16, bottom: 20, width: 56, height: 56, borderRadius: 16, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', zIndex: 3, elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
});
