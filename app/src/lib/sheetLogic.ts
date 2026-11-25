/**
 * Explore bottom sheet (SPEC-v6 §5 bug fix): three snap points, dragged by the grabber and the header row.
 * Heights are the visible sheet height measured from the bottom of the screen (the sheet runs behind the
 * floating tab bar, so every height includes `tabSpace`).
 */
export type Snap = 'collapsed' | 'half' | 'full';
export const SNAP_ORDER: Snap[] = ['collapsed', 'half', 'full'];
export type Snaps = Record<Snap, number>;

/** Collapsed sheet shows 120 px above the tab bar. */
export const COLLAPSED_ABOVE_TABBAR = 120;

/**
 * Snap heights for a screen. `topReserve` = space kept free at the top for the search row + type pills.
 * Always collapsed < half < full.
 */
export function computeSnaps(screenH: number, tabSpace: number, topReserve: number): Snaps {
  const collapsed = tabSpace + COLLAPSED_ABOVE_TABBAR;
  const full = Math.max(collapsed + 120, screenH - topReserve);
  const half = Math.min(full - 60, Math.max(collapsed + 80, Math.round(screenH * 0.48)));
  return { collapsed, half, full };
}

/** Keep a dragged height between collapsed and full. */
export function clampHeight(h: number, s: Snaps): number {
  return Math.min(s.full, Math.max(s.collapsed, h));
}

/**
 * Where a drag ends. `vy` is the finger speed in px/ms (negative = up, which makes the sheet taller).
 * A quick flick goes to the next snap in its direction from where the finger let go; otherwise the nearest snap wins.
 */
export function snapAfterDrag(height: number, vy: number, s: Snaps): Snap {
  if (vy < -0.5) return SNAP_ORDER.find((k) => s[k] > height + 1) ?? 'full';
  if (vy > 0.5) return [...SNAP_ORDER].reverse().find((k) => s[k] < height - 1) ?? 'collapsed';
  return SNAP_ORDER[nearestIndex(height, s)];
}

function nearestIndex(h: number, s: Snaps): number {
  let best = 0;
  SNAP_ORDER.forEach((k, i) => {
    if (Math.abs(s[k] - h) < Math.abs(s[SNAP_ORDER[best]] - h)) best = i;
  });
  return best;
}

/** The header link follows the snap: "Daha çox" until the sheet is full, then "Daha az". */
export function sheetLink(snap: Snap): 'more' | 'less' {
  return snap === 'full' ? 'less' : 'more';
}

/** Tapping the link: one step up (collapsed → half → full); at full it goes back down to collapsed. */
export function snapAfterLink(snap: Snap): Snap {
  return snap === 'collapsed' ? 'half' : snap === 'half' ? 'full' : 'collapsed';
}

/** A drag counts only once the finger moved a few px vertically (so taps on the header still work). */
export function isSheetDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx);
}

/** Tallest the filter popover may be so it always ends above the sheet's top edge. */
export function filterPopoverMaxHeight(o: { screenH: number; popoverTop: number; sheetHeight: number; gap?: number }): number {
  return Math.max(0, o.screenH - o.sheetHeight - o.popoverTop - (o.gap ?? 12));
}
