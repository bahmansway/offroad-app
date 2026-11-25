import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BAKU_CENTER, DEFAULT_ZOOM, buildPins, mapStyleUrl, pinCss, type MapProps } from './shared';
import { PIN_LAYERS_JS, pinPalette, type PinPalette } from './pinLayers';
import { diffPins, isEmptyDiff, type PinDiff, type PinPoint } from '../../lib/mapData';

interface PinApi { hit: (p: unknown) => boolean; diff: (d: PinDiff) => void; select: (id: string | null) => void; palette: (p: PinPalette) => void }
/** Same layer code as the phone map (one source of truth, see pinLayers.ts). */
// eslint-disable-next-line no-new-func
const makePinLayers = new Function(`return (${PIN_LAYERS_JS});`)() as (map: maplibregl.Map, cfg: object) => PinApi;
import { palettes } from '../../lib/theme';
import { MapErrorCard } from '../ui/States';
import { useTheme } from '../../lib/themeContext';

function injectCss(scheme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('or-pin-css') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'or-pin-css';
    document.head.appendChild(el);
  }
  el.textContent = pinCss(scheme);
}

export default function SpotMap(props: MapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pinApi = useRef<PinApi | null>(null);
  const shown = useRef(new Map<string, PinPoint>());
  const [mapGen, setMapGen] = useState(0);
  const cb = useRef(props);
  cb.current = props;
  const [failed, setFailed] = useState(false);
  /** bumping this rebuilds the map ("Try again" on the error card) */
  const [attempt, setAttempt] = useState(0);
  const { scheme: themeScheme } = useTheme();
  const scheme = props.scheme ?? themeScheme;
  const pal = palettes[scheme];
  const styleShown = useRef(scheme);

  useImperativeHandle(props.ref, () => ({
    getCenter: async () => {
      const c = mapRef.current?.getCenter().wrap();
      return c ? { lat: c.lat, lng: c.lng } : null;
    },
  }), []);

  useEffect(() => {
    injectCss(scheme);
    const container = holder.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: mapStyleUrl(scheme),
      center: props.center ? [props.center.lng, props.center.lat] : BAKU_CENTER,
      zoom: props.zoom ?? DEFAULT_ZOOM,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    const pins = makePinLayers(map, {
      pal: pinPalette(scheme),
      onPin: (id: string) => cb.current.onSpotPress?.(id),
      onRegion: (lat: number, lng: number, zoom: number) => cb.current.onRegionChange?.({ lat, lng, zoom }),
    });
    pinApi.current = pins;
    shown.current = new Map();
    // Zoom buttons only on wide screens; on phones they would sit under the floating search bar.
    if (container.clientWidth >= 700) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.on('click', (e) => {
      if (pins.hit(e.point)) return;
      const p = e.lngLat.wrap();
      cb.current.onMapPress?.(p.lat, p.lng);
    });
    // Once the map has loaded, later style errors (e.g. a light/dark setStyle on a flaky network) must not
    // cover a working map with the error card: only a map that never loaded counts as failed.
    let loadedOnce = false;
    map.on('error', (e) => {
      if (!loadedOnce && !map.isStyleLoaded() && (e as { error?: { status?: number } }).error) setFailed(true);
    });
    map.on('load', () => { loadedOnce = true; setFailed(false); });
    mapRef.current = map;
    setMapGen((g) => g + 1);
    // Attribution links: open in a new tab, never replace the app.
    const onLink = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (a) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    };
    container.addEventListener('click', onLink, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.resize()) : null;
    ro?.observe(container);
    return () => {
      ro?.disconnect();
      container.removeEventListener('click', onLink, true);
      map.remove();
      mapRef.current = null;
      pinApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Light/dark switch: swap the tile style and pin colours without rebuilding the map.
  useEffect(() => {
    injectCss(scheme);
    if (mapRef.current && styleShown.current !== scheme) {
      styleShown.current = scheme;
      mapRef.current.setStyle(mapStyleUrl(scheme));
      pinApi.current?.palette(pinPalette(scheme));
    }
  }, [scheme]);

  // Recentre when asked (e.g. spot detail)
  useEffect(() => {
    if (props.center && mapRef.current) {
      mapRef.current.jumpTo({ center: [props.center.lng, props.center.lat], ...(props.zoom != null ? { zoom: props.zoom } : {}) });
    }
  }, [props.center?.lat, props.center?.lng, props.zoom]);

  // Spot pins: only what changed goes into the map source.
  useEffect(() => {
    if (!pinApi.current) return;
    const { diff, next } = diffPins(shown.current, props.spots);
    shown.current = next;
    if (!isEmptyDiff(diff)) pinApi.current.diff(diff);
  }, [props.spots, mapGen]);

  useEffect(() => {
    pinApi.current?.select(props.selectedId ?? null);
  }, [props.selectedId, mapGen]);

  // The "picked" pin (new spot / meeting point) is the only DOM marker left.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = buildPins({ spots: [], picked: props.picked, pinLabel: props.pinLabel }, props.label).map((p) => {
      const el = document.createElement('div');
      el.className = p.className;
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = p.html;
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
    });
  }, [props.picked?.lat, props.picked?.lng, mapGen]);

  return (
    <View style={[styles.wrap, { backgroundColor: pal.mapBg }]} accessibilityRole="none" aria-label={props.label} role="region">
      <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
      {failed ? (
        <MapErrorCard
          style={[StyleSheet.absoluteFill, props.errorInsets ? {
            paddingTop: props.errorInsets.top, paddingBottom: props.errorInsets.bottom,
            paddingLeft: props.errorInsets.left, paddingRight: props.errorInsets.right,
          } : null]}
          compact={props.errorCompact}
          onRetry={props.errorCompact ? undefined : () => { setFailed(false); styleShown.current = scheme; setAttempt((a) => a + 1); }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden' },
});
