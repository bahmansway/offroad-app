import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, FlatList, Modal, PanResponder, Platform, Pressable, ScrollView, View, useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SpotMap from '../../components/map/Map';
import type { MapProps } from '../../components/map/shared';
import { SpotCell } from '../../components/Rows';
import { useNavigate } from '../../components/NavigateSheet';
import {
  DifficultySign, EmptyState, ErrorState, GlassView, Icon, IconButton, LoadingState, PillButton, SearchField,
  SegmentedControl, Thumb, Txt,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/themeContext';
import { HAIRLINE, radius, signColors, TAB_BAR, TAP } from '../../lib/theme';
import { BAKU, distanceFromBaku, formatDistance, sameId } from '../../lib/format';
import { activeFilterCount, filterSpots, sortByDistance, tapLevel, type TypeFilter } from '../../lib/spotFilters';
import {
  clampHeight, computeSnaps, filterPopoverMaxHeight, isSheetDrag, sheetLink, snapAfterDrag, snapAfterLink, type Snap,
} from '../../lib/sheetLogic';
import { selectionFeedback, tapFeedback } from '../../lib/haptics';
import type { Spot } from '../../lib/types';

/** The map only re-renders when its own props change (not on sheet / filter / list changes). */
const MemoMap = React.memo(SpotMap as React.ComponentType<MapProps>);

const SEARCH_H = 50;
const ROW_GAP = 12;
const SEG_H = 44;
const NATIVE_DRIVER = Platform.OS !== 'web';

/** "Kəşf et": clustered map, draggable "Yaxınlıqda" sheet (3 snaps), filter popover, pin card with Yol göstər. */
export default function ExploreScreen() {
  const { t, d, lang } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const nav = useNavigate();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [type, setType] = useState<TypeFilter>('all');
  const [range, setRange] = useState<[number, number]>([1, 5]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [cardH, setCardH] = useState(150);
  const seq = useRef(0);
  const region = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(h);
  }, [query]);

  const load = useCallback(async () => {
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
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = useMemo(() => filterSpots(spots, { type, minLevel: range[0], maxLevel: range[1] }), [spots, type, range]);
  const near = useMemo(() => sortByDistance(visible), [visible]);
  const selectedSpot = useMemo(() => (selected ? spots.find((s) => sameId(s.id, selected)) ?? null : null), [spots, selected]);
  useEffect(() => { if (selected && !visible.some((s) => sameId(s.id, selected))) setSelected(null); }, [visible, selected]);

  // ---------- geometry ----------
  const tabBarTop = Math.max(insets.bottom - 10, 0) + TAB_BAR.gap + TAB_BAR.height;
  const topReserve = insets.top + 8 + SEARCH_H + ROW_GAP + SEG_H + ROW_GAP;
  const snaps = useMemo(() => computeSnaps(screenH, tabBarTop, topReserve), [screenH, tabBarTop, topReserve]);
  const [snap, setSnap] = useState<Snap>('collapsed');
  const fullH = snaps.full;
  const offset = useRef(new Animated.Value(fullH - snaps.collapsed)).current; // translateY of the sheet
  const offsetNow = useRef(fullH - snaps.collapsed);
  useEffect(() => {
    const id = offset.addListener(({ value }) => { offsetNow.current = value; });
    return () => offset.removeListener(id);
  }, [offset]);
  const animateTo = useCallback((s: Snap) => {
    setSnap(s);
    Animated.spring(offset, { toValue: fullH - snaps[s], useNativeDriver: NATIVE_DRIVER, bounciness: 0, speed: 16 }).start();
  }, [offset, fullH, snaps]);
  // screen size changed (rotation, web resize): stay on the same snap
  useEffect(() => { offset.setValue(fullH - snaps[snap]); }, [fullH]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- sheet drag (grabber + header row) ----------
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const start = useRef(0);
  const pan = useMemo(() => PanResponder.create({
    // Become the responder on touch-down (bubble phase, so the "Daha çox" link inside still gets its taps). Then the
    // drag keeps working when the finger / mouse leaves the small grabber area.
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => isSheetDrag(g.dx, g.dy),
    onMoveShouldSetPanResponderCapture: (_e, g) => isSheetDrag(g.dx, g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      setFilterOpen(false);
      offset.stopAnimation((v) => { start.current = v; });
      start.current = offsetNow.current;
    },
    onPanResponderMove: (_e, g) => {
      const h = clampHeight(fullH - (start.current + g.dy), snaps);
      offset.setValue(fullH - h);
    },
    onPanResponderRelease: (_e, g) => {
      const h = clampHeight(fullH - (start.current + g.dy), snaps);
      const s = snapAfterDrag(h, g.vy, snaps);
      if (s !== snapRef.current) selectionFeedback();
      animateTo(s);
    },
    onPanResponderTerminate: () => animateTo(snapRef.current),
  }), [offset, fullH, snaps, animateTo]);

  // ---------- pins ----------
  const pinTap = useCallback((id: Spot['id']) => {
    tapFeedback();
    setFilterOpen(false);
    setSelected(String(id));
  }, []);
  const mapPress = useCallback(() => setSelected(null), []);
  const onRegion = useCallback((r: { lat: number; lng: number; zoom: number }) => { region.current = r; }, []);
  const pinLabel = useCallback(
    (sp: Spot) => (sp.type === 'camp' ? t('explore.campPin', { name: sp.name }) : t('explore.spotPin', { name: sp.name, level: sp.difficulty ?? '' })),
    [t],
  );
  const errorInsets = useMemo(() => ({ top: topReserve, bottom: snaps.collapsed, left: 16, right: 76 }), [topReserve, snaps.collapsed]);
  const recenter = () => setCenter((p) => (p && p.lat === BAKU.lat ? { lat: BAKU.lat + 1e-7, lng: BAKU.lng } : { lat: BAKU.lat, lng: BAKU.lng }));
  const filters = activeFilterCount(range);

  function openFilter() {
    if (filterOpen) return setFilterOpen(false);
    setSelected(null);
    if (snap !== 'collapsed') animateTo('collapsed'); // the popover must never sit on top of the sheet
    setFilterOpen(true);
  }

  // buttons sit above the collapsed sheet, or above the pin card
  const sideBottom = selectedSpot ? tabBarTop + 12 + cardH + 12 : snaps.collapsed + 12;
  const sideOpacity = offset.interpolate({ inputRange: [fullH - snaps.half, fullH - snaps.collapsed], outputRange: [0, 1], extrapolate: 'clamp' });
  const link = sheetLink(snap);
  const listPad = fullH - snaps[snap] + tabBarTop + 16;
  const filterTop = insets.top + 8 + SEARCH_H + 14;
  const filterMaxH = filterPopoverMaxHeight({ screenH, popoverTop: filterTop, sheetHeight: snaps.collapsed });
  const maxW = Math.min(640, screenW);

  return (
    <View style={{ flex: 1, backgroundColor: c.mapBg }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <MemoMap
          spots={visible}
          selectedId={selected}
          onSpotPress={pinTap}
          onMapPress={mapPress}
          onRegionChange={onRegion}
          label={t('explore.mapLabel')}
          pinLabel={pinLabel}
          errorInsets={errorInsets}
          center={center}
          zoom={center ? 7 : undefined}
        />
      </View>

      {/* search + filter, then type pills + events */}
      <View pointerEvents="box-none" style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, gap: ROW_GAP, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <SearchField glass value={query} onChangeText={setQuery} placeholder={t('explore.search')} label={t('explore.searchLabel')} style={{ flex: 1, minWidth: 0 }} />
          <FilterButton open={false} count={filters} onPress={openFilter} />
        </View>
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SegmentedControl<TypeFilter>
            glass
            label={t('explore.typeLabel')}
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: t('explore.all') },
              { value: 'trail', label: t('explore.trails'), icon: 'trail', iconColor: c.clay },
              { value: 'camp', label: t('explore.camps'), icon: 'tent', iconColor: c.forest },
            ]}
            style={{ flexShrink: 1 }}
          />
        </View>
      </View>

      {/* locate + add */}
      <Animated.View pointerEvents={selectedSpot || snap === 'collapsed' ? 'box-none' : 'none'} style={{ position: 'absolute', right: 16, bottom: sideBottom, gap: 10, opacity: selectedSpot ? 1 : sideOpacity }}>
        <IconButton icon="events" label={t('explore.eventsA11y')} glass size={48} color={c.sand} onPress={() => router.push('/events')} />
        <IconButton icon="navigate" label={t('explore.recenter')} glass size={48} color={c.label} onPress={recenter} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('explore.addSpot')}
          onPress={() => router.push(user ? '/spot/new' : '/login')}
          style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center', shadowColor: c.tint, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 }, pressed && { opacity: 0.85 }]}
        >
          <Icon name="plus" size={22} color={c.onTint} strokeWidth={2.6} />
        </Pressable>
      </Animated.View>

      {/* "Yaxınlıqda" sheet (hidden while a pin card is open) */}
      {selectedSpot ? null : (
        <Animated.View
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: fullH,
            transform: [{ translateY: offset }],
          }}
        >
          <GlassView borderless style={{ flex: 1, borderTopLeftRadius: radius.sheet - 4, borderTopRightRadius: radius.sheet - 4, backgroundColor: c.sheet }}>
            <View style={{ width: '100%', maxWidth: maxW, alignSelf: 'center', flex: 1 }}>
              {/* drag area: grabber + header row */}
              <View {...pan.panHandlers} style={Platform.OS === 'web' ? ({ cursor: 'grab', touchAction: 'none', userSelect: 'none' } as object) : undefined}>
                {/* plain View (not Pressable): a press responder here would keep the drag from starting */}
                <View
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={t('explore.dragSheet')}
                  accessibilityHint={t('explore.dragSheetHint')}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={(e) => {
                    const i = ['collapsed', 'half', 'full'].indexOf(snap);
                    const next = e.nativeEvent.actionName === 'increment' ? Math.min(2, i + 1) : Math.max(0, i - 1);
                    animateTo((['collapsed', 'half', 'full'] as Snap[])[next]);
                  }}
                  style={{ height: 22, alignItems: 'center', paddingTop: 8 }}
                >
                  <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.grabber }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8, paddingBottom: 6 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="title2" accessibilityRole="header">{t('explore.nearYou')}</Txt>
                    <Txt variant="footnote" tone="label2" numberOfLines={1}>{t('explore.placesFromBaku', { count: near.length })}</Txt>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: snap === 'full' }}
                    onPress={() => animateTo(snapAfterLink(snap))}
                    hitSlop={6}
                    style={({ pressed }) => [{ minHeight: TAP, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.6 }]}
                  >
                    <Txt tone="tint">{link === 'more' ? t('explore.more') : t('explore.less')}</Txt>
                    <View style={{ transform: [{ rotate: link === 'more' ? '-90deg' : '90deg' }] }}>
                      <Icon name="chevron" size={16} color={c.tint} strokeWidth={2.6} svgOnly />
                    </View>
                  </Pressable>
                </View>
              </View>
              {error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : null}
              {!loaded && !error ? <LoadingState inline /> : null}
              {loaded && !error && near.length === 0 ? (
                spots.length === 0 && !debounced ? (
                  <EmptyState illustration="mountain" title={t('explore.emptyNearTitle')} text={t('explore.emptyNearText')} actionLabel={t('explore.addSpot')} onAction={() => router.push(user ? '/spot/new' : '/login')} style={{ paddingVertical: 12 }} />
                ) : <EmptyState icon="explore" title={t('explore.empty')} style={{ paddingVertical: 12 }} contour={false} />
              ) : null}
              <FlatList
                data={near}
                keyExtractor={(s) => String(s.id)}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: listPad }}
                initialNumToRender={8}
                windowSize={5}
                renderItem={({ item, index }) => (
                  <View style={{
                    backgroundColor: c.card, overflow: 'hidden',
                    borderTopLeftRadius: index === 0 ? radius.card : 0, borderTopRightRadius: index === 0 ? radius.card : 0,
                    borderBottomLeftRadius: index === near.length - 1 ? radius.card : 0, borderBottomRightRadius: index === near.length - 1 ? radius.card : 0,
                  }}>
                    <SpotCell spot={item} km={item.km} onPress={() => router.push(`/spot/${item.id}`)} last={index === near.length - 1} />
                  </View>
                )}
              />
            </View>
          </GlassView>
        </Animated.View>
      )}

      {/* pin card: in place of the sheet, 12 px above the tab bar */}
      {selectedSpot ? (
        <PinCard
          spot={selectedSpot}
          bottom={tabBarTop + 12}
          onLayoutHeight={setCardH}
          onClose={() => setSelected(null)}
          onNavigate={() => nav.open({ lat: selectedSpot.lat, lng: selectedSpot.lng, name: selectedSpot.name })}
          kmText={formatDistance(distanceFromBaku(selectedSpot), lang)}
          levelWord={selectedSpot.difficulty ? d.levels.names[selectedSpot.difficulty - 1] : null}
        />
      ) : null}

      {/* filter popover: above sheet + tab bar, 32% scrim, anchored 14 px under the filter button */}
      {/* statusBarTranslucent: on Android the modal then starts at the screen top like the page, so insets.top lines up */}
      <Modal visible={filterOpen} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <View style={{ flex: 1 }}>
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.32)' }}
            onPressIn={() => setFilterOpen(false)}
            onPress={() => setFilterOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t('explore.closeFilter')}
          />
          <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center' }}>
            <View pointerEvents="box-none" style={{ width: '100%', maxWidth: 640, paddingHorizontal: 16, alignItems: 'flex-end' }}>
              <FilterButton open count={filters} onPress={() => setFilterOpen(false)} />
            </View>
          </View>
          <View pointerEvents="box-none" style={{ position: 'absolute', top: filterTop, left: 0, right: 0, alignItems: 'center' }}>
            <View pointerEvents="box-none" style={{ width: '100%', maxWidth: 640, paddingHorizontal: 16, alignItems: 'flex-end' }}>
              <FilterPopover
                range={range}
                onRange={setRange}
                maxHeight={filterMaxH}
                width={Math.min(326, screenW - 32)}
                count={near.length}
                onClose={() => setFilterOpen(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
      {nav.sheet}
    </View>
  );
}

function FilterButton({ open, count, onPress }: { open: boolean; count: number; onPress: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const inner = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? t('explore.filterA11y', { count }) : t('explore.filterA11yNone')}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [{ width: SEARCH_H, height: SEARCH_H, borderRadius: SEARCH_H / 2, alignItems: 'center', justifyContent: 'center' }, open && { backgroundColor: c.ink }, pressed && { opacity: 0.7 }]}
    >
      <Icon name="filter" size={21} color={open ? c.onInk : c.label} strokeWidth={2.2} />
    </Pressable>
  );
  return (
    <View>
      {open ? inner : <GlassView elevated style={{ width: SEARCH_H, height: SEARCH_H, borderRadius: SEARCH_H / 2 }}>{inner}</GlassView>}
      {count ? (
        <View pointerEvents="none" style={{ position: 'absolute', right: -2, top: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: c.tint, borderWidth: 2, borderColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
          <Txt style={{ fontSize: 10, lineHeight: 12, fontWeight: '700' }} color={c.onTint}>{String(count)}</Txt>
        </View>
      ) : null}
    </View>
  );
}

function FilterPopover({ range, onRange, maxHeight, width, count, onClose }: {
  range: [number, number]; onRange: (r: [number, number]) => void; maxHeight: number; width: number; count: number; onClose: () => void;
}) {
  const { c, scheme } = useTheme();
  const { t, d } = useI18n();
  const all = range[0] === 1 && range[1] === 5;
  const rangeText = all ? t('explore.rangeAll') : t('explore.rangeText', { from: range[0], to: range[1], fromWord: d.levels.names[range[0] - 1], toWord: d.levels.names[range[1] - 1] });
  return (
    <View accessibilityViewIsModal style={{ width, maxHeight, borderRadius: 22, backgroundColor: c.card, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 20, shadowOffset: { width: 0, height: 16 }, elevation: 12 }} {...({ role: 'dialog', 'aria-label': t('explore.filter') } as object)}>
      {/* caret pointing at the filter button */}
      <View pointerEvents="none" style={{ position: 'absolute', right: 17, top: -7, width: 16, height: 16, backgroundColor: c.card, transform: [{ rotate: '45deg' }], borderRadius: 3 }} />
      <ScrollView style={{ maxHeight }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }} bounces={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt variant="headline" accessibilityRole="header">{t('explore.filter')}</Txt>
          <Pressable accessibilityRole="button" onPress={() => onRange([1, 5])} disabled={all} style={({ pressed }) => [{ minHeight: TAP, justifyContent: 'center', paddingHorizontal: 4 }, (pressed || all) && { opacity: 0.4 }]}>
            <Txt tone="tint">{t('explore.reset')}</Txt>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, gap: 8 }}>
          <Txt variant="subhead" style={{ fontWeight: '600' }}>{t('explore.difficulty')}</Txt>
          <Txt variant="footnote" tone="label2" numberOfLines={1} style={{ flexShrink: 1 }}>{rangeText}</Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }} accessibilityLabel={t('explore.levelFilterTitle')}>
          {[1, 2, 3, 4, 5].map((n) => {
            const on = !all && n >= range[0] && n <= range[1];
            const sc = signColors(n, scheme)!;
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t(on ? 'explore.levelOn' : 'explore.levelOff', { n, word: d.levels.names[n - 1] })}
                accessibilityHint={t('explore.levelHint')}
                onPress={() => { selectionFeedback(); onRange(tapLevel(range, n)); }}
                style={({ pressed }) => [{
                  flex: 1, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2,
                  backgroundColor: on ? sc.plate : c.fill, borderWidth: on ? 2 : 0, borderColor: c.tint,
                }, pressed && { opacity: 0.75 }]}
              >
                <Txt style={{ fontSize: 20, lineHeight: 24, fontWeight: '800' }} color={on ? sc.num : c.label2}>{String(n)}</Txt>
                <Txt style={{ fontSize: 11, lineHeight: 13, fontWeight: '600' }} color={on ? sc.text : c.label2} numberOfLines={1}>{d.levels.names[n - 1]}</Txt>
              </Pressable>
            );
          })}
        </View>
        <PillButton title={t('explore.showN', { count })} size="medium" onPress={onClose} style={{ marginTop: 16 }} />
      </ScrollView>
    </View>
  );
}

function PinCard({ spot, bottom, onLayoutHeight, onClose, onNavigate, kmText, levelWord }: {
  spot: Spot; bottom: number; onLayoutHeight: (h: number) => void; onClose: () => void; onNavigate: () => void; kmText: string; levelWord: string | null;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const trail = spot.type === 'trail';
  return (
    <View
      onLayout={(e) => onLayoutHeight(Math.round(e.nativeEvent.layout.height))}
      style={{ position: 'absolute', left: 16, right: 16, bottom, alignItems: 'center' }}
      accessibilityLabel={t('explore.pinCard')}
    >
      <View style={{ width: '100%', maxWidth: 608, borderRadius: radius.card, backgroundColor: c.card, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 10, borderWidth: HAIRLINE, borderColor: c.separator }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <Thumb kind={trail ? 'trail' : 'camp'} size={56} rounded={14} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }} accessible accessibilityLabel={[spot.name, trail && spot.difficulty ? `${t('spot.difficulty')} ${spot.difficulty} ${levelWord ?? ''}` : t('spot.camp'), kmText].join(', ')}>
            <Txt variant="headline" numberOfLines={2} accessibilityRole="header">{spot.name}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {trail && spot.difficulty ? <DifficultySign level={spot.difficulty} /> : <Txt variant="subhead" tone="label2">{t('spot.camp')}</Txt>}
              <Txt variant="subhead" tone="label2">{kmText}</Txt>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={{ width: TAP, height: TAP, marginTop: -8, marginRight: -8, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color={c.label2} strokeWidth={3} svgOnly />
            </View>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PillButton title={t('nav.button')} icon="navigate" size="medium" onPress={onNavigate} style={{ flex: 1 }} />
          <PillButton title={t('explore.open')} variant="gray" size="medium" onPress={() => router.push(`/spot/${spot.id}`)} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}
