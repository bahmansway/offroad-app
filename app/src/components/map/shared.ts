import type React from 'react';
import type { Spot } from '../../lib/types';
import { levelColor } from '../../lib/format';
import { colors } from '../../lib/theme';

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const BAKU_CENTER: [number, number] = [49.8671, 40.4093]; // [lng, lat]
export const DEFAULT_ZOOM = 7;
/** maplibre-gl version loaded from the CDN inside the native WebView — keep in step with package.json. */
export const MAPLIBRE_CDN_VERSION = '5.24.0';
/** Subresource-integrity hashes of maplibre-gl@5.24.0 dist files (computed from node_modules, identical to unpkg). */
export const MAPLIBRE_SRI = {
  js: 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp',
  css: 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK',
} as const;

/** Imperative handle: lets a form ask for the current map centre (to place a pin without a precise tap). */
export interface MapHandle {
  getCenter: () => Promise<{ lat: number; lng: number } | null>;
}

export interface MapProps {
  spots: Spot[];
  onSpotPress?: (id: Spot['id']) => void;
  /** Called with the tapped coordinates (used to place a new spot). */
  onMapPress?: (lat: number, lng: number) => void;
  /** Shows an accent "new spot" pin at this place. */
  picked?: { lat: number; lng: number } | null;
  center?: { lat: number; lng: number };
  zoom?: number;
  /** accessible name for the map region */
  label: string;
  /** accessible name for each pin */
  pinLabel: (spot: Spot) => string;
  /** shown if tiles fail to load */
  failedText?: string;
  ref?: React.Ref<MapHandle>;
}

/** Data for one marker, ready to send to the DOM (web) or the WebView (native). */
export interface PinData {
  id: string;
  lat: number;
  lng: number;
  html: string;
  label: string;
  kind: 'spot' | 'picked';
}

const TENT_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${colors.bg}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20 12 4l9 16"/><path d="M9 20l3-6 3 6"/></svg>`;
const PLUS_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${colors.bg}" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** CSS shared by both map implementations. */
export const PIN_CSS = `
.or-pin{width:44px;height:44px;box-sizing:border-box;border-radius:22px 22px 22px 4px;border:2px solid ${colors.bg};
display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;color:${colors.bg};
font:700 18px 'Barlow Condensed','Arial Narrow',sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.45)}
.or-pin:focus-visible{outline:3px solid ${colors.text};outline-offset:2px}
.or-pin--picked{background:${colors.accent};animation:or-pop .18s ease-out}
@keyframes or-pop{from{transform:scale(.6)}to{transform:scale(1)}}
.maplibregl-ctrl-attrib{font:500 11px Barlow,sans-serif}
`;

export function spotPinStyle(spot: Pick<Spot, 'type' | 'difficulty'>): { background: string; inner: string } {
  if (spot.type === 'camp') return { background: colors.camp, inner: TENT_SVG };
  return { background: levelColor(spot.difficulty), inner: escapeHtml(String(spot.difficulty ?? '?')) };
}

export function buildPins(props: Pick<MapProps, 'spots' | 'picked' | 'pinLabel'>, pickedLabel = ''): PinData[] {
  const pins: PinData[] = props.spots
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => {
      const st = spotPinStyle(s);
      return {
        id: String(s.id),
        lat: s.lat,
        lng: s.lng,
        kind: 'spot' as const,
        label: props.pinLabel(s),
        html: `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;border-radius:inherit;background:${st.background}">${st.inner}</span>`,
      };
    });
  if (props.picked) {
    pins.push({
      id: '__picked',
      lat: props.picked.lat,
      lng: props.picked.lng,
      kind: 'picked',
      label: pickedLabel,
      html: PLUS_SVG,
    });
  }
  return pins;
}

/** Messages the native map page may send. Anything else is ignored. */
export type MapMessage =
  | { type: 'ready' | 'loaded' | 'failed' }
  | { type: 'spotPress'; id: string }
  | { type: 'mapPress'; lat: number; lng: number }
  | { type: 'center'; lat: number; lng: number; reqId: number }
  | { type: 'openLink'; url: string };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseMapMessage(data: string): MapMessage | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.type) {
    case 'ready': case 'loaded': case 'failed':
      return { type: m.type };
    case 'spotPress':
      return typeof m.id === 'string' && m.id.length > 0 && m.id.length < 100 ? { type: 'spotPress', id: m.id } : null;
    case 'mapPress':
      return finite(m.lat) && finite(m.lng) && Math.abs(m.lat) <= 90 && Math.abs(m.lng) <= 180
        ? { type: 'mapPress', lat: m.lat, lng: m.lng } : null;
    case 'center':
      return finite(m.lat) && finite(m.lng) && finite(m.reqId) && Math.abs(m.lat) <= 90 && Math.abs(m.lng) <= 180
        ? { type: 'center', lat: m.lat, lng: m.lng, reqId: m.reqId } : null;
    case 'openLink':
      return typeof m.url === 'string' && isAllowedExternalLink(m.url) ? { type: 'openLink', url: m.url } : null;
    default:
      return null;
  }
}

/** Only attribution links may be opened from inside the map. */
export function isAllowedExternalLink(url: string): boolean {
  return /^https:\/\/(www\.)?(openstreetmap\.org|openfreemap\.org|maplibre\.org|openmaptiles\.org)(\/|$)/.test(url);
}
