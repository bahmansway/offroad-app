import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SpotMap from '../../components/map/Map';
import { SpotCell } from '../../components/Rows';
import {
  EmptyState, ErrorState, GlassView, IconButton, LinkButton, LoadingState, PillButton, SearchField, Section,
  SegmentedControl, Txt, useTabBarSpace,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/themeContext';
import { radius } from '../../lib/theme';
import { BAKU } from '../../lib/format';
import { filterSpots, sortByDistance, type TypeFilter } from '../../lib/spotFilters';
import type { Spot } from '../../lib/types';

const NEAR_COUNT = 3;

export default function ExploreScreen() {
  const { t, d } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
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
  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);

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
  const recenter = () => setCenter((p) => (p && p.lat === BAKU.lat ? { lat: BAKU.lat + 1e-7, lng: BAKU.lng } : { lat: BAKU.lat, lng: BAKU.lng }));

  return (
    <View style={{ flex: 1, backgroundColor: c.mapBg }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <SpotMap
          spots={visible}
          onSpotPress={openSpot}
          label={t('explore.mapLabel')}
          pinLabel={pinLabel}
          failedText={t('map.loadFailed')}
          center={center}
          zoom={center ? 7 : undefined}
        />
      </View>

      {/* floating controls */}
      <View pointerEvents="box-none" style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <SearchField glass value={query} onChangeText={setQuery} placeholder={t('explore.search')} label={t('explore.searchLabel')} style={{ flex: 1 }} />
          <View>
            <IconButton icon="filter" label={t('explore.filters')} glass size={50} onPress={() => setLevelOpen((o) => !o)} color={levelActive ? c.tint : c.label} />
            {levelActive ? <View style={{ position: 'absolute', top: 4, right: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: c.tint }} /> : null}
          </View>
        </View>
        <SegmentedControl<TypeFilter>
          glass
          label={t('explore.typeLabel')}
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: t('explore.all') },
            { value: 'trail', label: t('explore.trails') },
            { value: 'camp', label: t('explore.camps') },
          ]}
          style={{ alignSelf: 'center' }}
        />
        {levelOpen ? (
          <GlassView elevated style={{ borderRadius: radius.card, padding: 16, gap: 12 }}>
            <Txt variant="headline">{t('explore.levelFilterTitle')}</Txt>
            {(['minLevel', 'maxLevel'] as const).map((which, idx) => (
              <View key={which} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={t(`explore.${which}`)}>
                <Txt variant="subhead" tone="label2" style={{ width: 84 }}>{t(`explore.${which}`)}</Txt>
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
                      style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.tint : c.fill, opacity: disabled ? 0.35 : 1 }}
                    >
                      <Txt variant="headline" color={on ? c.onTint : c.label}>{n}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <Txt variant="footnote" tone="label2">{t('explore.levelFilterHint')}</Txt>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PillButton title={t('explore.reset')} variant="gray" size="medium" style={{ flex: 1 }} onPress={() => setRange([1, 5])} />
              <PillButton title={t('explore.apply')} size="medium" style={{ flex: 1 }} onPress={() => setLevelOpen(false)} />
            </View>
          </GlassView>
        ) : null}
      </View>

      {/* right-side map buttons */}
      <View pointerEvents="box-none" style={{ position: 'absolute', right: 16, bottom: tabSpace + 296, gap: 12 }}>
        <IconButton icon="navigate" label={t('explore.recenter')} glass size={50} color={c.tint} onPress={recenter} />
        <IconButton icon="plus" label={t('explore.addSpot')} glass size={50} color={c.tint} onPress={() => router.push(user ? '/spot/new' : '/login')} />
      </View>

      {/* bottom sheet */}
      <GlassView
        borderless
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: (showAll ? 460 : 300) + tabSpace,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, backgroundColor: c.sheet,
        }}
      >
        <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', flex: 1 }}>
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.grabber, alignSelf: 'center', marginTop: 8 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6 }}>
            <View>
              <Txt variant="title2" accessibilityRole="header">{t('explore.nearYou')}</Txt>
              <Txt variant="caption" tone="label2">{t('explore.nearYouHint')}</Txt>
            </View>
            {near.length > NEAR_COUNT ? <LinkButton title={showAll ? t('explore.showLess') : t('explore.seeAll')} onPress={() => setShowAll((v) => !v)} /> : null}
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: tabSpace }}>
            {error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : null}
            {!loaded && !error ? <LoadingState inline /> : null}
            {loaded && !error && list.length === 0 ? (
              <EmptyState icon="explore" title={t('explore.empty')} style={{ paddingVertical: 12 }} />
            ) : null}
            {list.length > 0 ? (
              <Section>
                {list.map((sp) => <SpotCell key={sp.id} spot={sp} km={sp.km} onPress={() => openSpot(sp.id)} />)}
              </Section>
            ) : null}
          </ScrollView>
        </View>
      </GlassView>
    </View>
  );
}

