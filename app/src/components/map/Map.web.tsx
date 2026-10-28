import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BAKU_CENTER, DEFAULT_ZOOM, buildPins, mapStyleUrl, pinCss, type MapProps } from './shared';
import { palettes, type } from '../../lib/theme';
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
  const cb = useRef(props);
  cb.current = props;
  const [failed, setFailed] = useState(false);
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
    // Zoom buttons only on wide screens; on phones they would sit under the floating search bar.
    if (container.clientWidth >= 700) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.on('click', (e) => {
      const p = e.lngLat.wrap();
      cb.current.onMapPress?.(p.lat, p.lng);
    });
    map.on('error', (e) => {
      // Only a style/tile network failure before load counts as "map failed"
      if (!map.isStyleLoaded() && (e as { error?: { status?: number } }).error) setFailed(true);
    });
    map.on('load', () => setFailed(false));
    mapRef.current = map;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light/dark switch: swap the tile style and pin colours without rebuilding the map.
  useEffect(() => {
    injectCss(scheme);
    if (mapRef.current && styleShown.current !== scheme) {
      styleShown.current = scheme;
      mapRef.current.setStyle(mapStyleUrl(scheme));
    }
  }, [scheme]);

  // Recentre when asked (e.g. spot detail)
  useEffect(() => {
    if (props.center && mapRef.current) {
      mapRef.current.jumpTo({ center: [props.center.lng, props.center.lat], ...(props.zoom != null ? { zoom: props.zoom } : {}) });
    }
  }, [props.center?.lat, props.center?.lng, props.zoom]);

  // Draw pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = buildPins(props, props.label).map((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = p.kind === 'picked' ? 'or-pin or-pin--picked' : 'or-pin';
      el.setAttribute('aria-label', p.label);
      el.innerHTML = p.html;
      if (p.kind === 'picked') {
        el.tabIndex = -1;
        el.setAttribute('aria-hidden', 'true');
      } else {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          cb.current.onSpotPress?.(p.id);
        });
      }
      return new maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat([p.lng, p.lat]).addTo(map);
    });
  }, [props.spots, props.picked?.lat, props.picked?.lng, props.pinLabel]);

  return (
    <View style={[styles.wrap, { backgroundColor: pal.mapBg }]} accessibilityRole="none" aria-label={props.label} role="region">
      <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
      {failed && props.failedText ? (
        <View style={styles.failed} pointerEvents="none">
          <Text style={[styles.failedText, { color: pal.label }]}>{props.failedText}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden' },
  failed: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24 },
  failedText: { ...type.subhead, textAlign: 'center' },
});
