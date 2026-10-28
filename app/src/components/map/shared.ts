import type React from 'react';
import type { Spot } from '../../lib/types';
import { mapStyleUrl, palettes, type Scheme } from '../../lib/theme';

export { mapStyleUrl };
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
  /** light/dark map style and pin colours (default light) */
  scheme?: Scheme;
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Pin look from the mockups: round glass pins with the level number; the new-spot pin is solid tint. */
export function pinCss(scheme: Scheme = 'light'): string {
  const c = palettes[scheme];
  return `
.or-pin{width:44px;height:44px;box-sizing:border-box;border-radius:22px;border:0.5px solid ${c.glassBorder};
background:${c.glass};-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);
display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;color:${c.label};
font:700 16px -apple-system,Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,${c.shadowOpacity})}
.or-pin:focus-visible{outline:3px solid ${c.tint};outline-offset:2px}
.or-pin--picked{background:${c.tint};color:${c.onTint};border:3px solid ${c.card};animation:or-pop .18s ease-out}
@keyframes or-pop{from{transform:scale(.6)}to{transform:scale(1)}}
.maplibregl-ctrl-attrib{font:500 11px -apple-system,Inter,sans-serif}
`;
}

/** @deprecated kept for older imports; light pins. */
export const PIN_CSS = pinCss('light');

const TENT_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20 12 5l9 15Z M12 20l-3-5h6Z"/></svg>`;
const PLUS_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

export function spotPinInner(spot: Pick<Spot, 'type' | 'difficulty'>): string {
  if (spot.type === 'camp') return TENT_SVG;
  return escapeHtml(String(spot.difficulty ?? '?'));
}

export function buildPins(props: Pick<MapProps, 'spots' | 'picked' | 'pinLabel'>, pickedLabel = ''): PinData[] {
  const pins: PinData[] = props.spots
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => {
      return {
        id: String(s.id),
        lat: s.lat,
        lng: s.lng,
        kind: 'spot' as const,
        label: props.pinLabel(s),
        html: spotPinInner(s),
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
