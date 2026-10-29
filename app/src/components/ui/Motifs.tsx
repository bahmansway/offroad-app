import React, { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, G, Mask, Path, Rect } from 'react-native-svg';

/**
 * YOLCHU motifs (DESIGN-PASS P6, P8). All decorative: hidden from screen readers, never take taps.
 */

/** Path data for the contour lines of a w×h box. Pure, so it is easy to test and stable per seed. */
export function contourPaths(w: number, h: number, seed = 0): { lines: string[]; ellipses: { cx: number; cy: number; rx: number; ry: number }[] } {
  const lines: string[] = [];
  for (let i = 0; i < 7; i++) {
    const y = 20 + i * (h / 7) + (seed % 3) * 4;
    const a = 10 + ((i + seed) % 3) * 6;
    const r = (n: number) => Math.round(n * 10) / 10;
    lines.push(`M-20 ${r(y)} C ${r(w * 0.2)} ${r(y - a)}, ${r(w * 0.35)} ${r(y + a)}, ${r(w * 0.55)} ${r(y - a * 0.4)} S ${r(w * 0.85)} ${r(y + a)}, ${w + 20} ${r(y - a * 0.6)}`);
  }
  const cx = w * 0.78, cy = h * 0.32;
  return { lines, ellipses: [{ cx, cy, rx: w * 0.08, ry: h * 0.09 }, { cx, cy, rx: w * 0.15, ry: h * 0.17 }] };
}

/**
 * Topographic contour texture: 7 soft wavy lines + 2 ellipses, 1.2 px stroke. Fills its parent
 * (position absolute). Use ONLY on: no-photo heroes (white 20%), the corner behind large titles
 * (tint 14%), empty states (tint 10%), the map error card background and terrain thumbs (white 18%).
 * Never behind body text or lists.
 */
export function Contour({ color, opacity = 0.14, seed = 0, width = 390, height = 250, style }: {
  color: string; opacity?: number; seed?: number;
  /** drawing size (the SVG is scaled to cover the parent) */
  width?: number; height?: number; style?: StyleProp<ViewStyle>;
}) {
  const { lines, ellipses } = contourPaths(width, height, seed);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" accessible={false}>
        <G fill="none" stroke={color} strokeWidth={1.2} opacity={opacity}>
          {lines.map((d, i) => <Path key={i} d={d} />)}
          {ellipses.map((e, i) => <Ellipse key={`e${i}`} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} />)}
        </G>
      </Svg>
    </View>
  );
}

/** Logo mountain + road (same paths as assets/brand/logo-mark.svg, without the tile). */
export const MOUNTAIN_PATH = 'M2 84C17 77 31 52 41 30Q50 12 59 30C69 52 83 77 98 84Z';
export const ROAD_PATH = 'M17.2 96.2L19.6 94.8L21.9 93.7L24.4 92.7L27 91.7L29.7 90.9L32.4 90.1L35.2 89.4L37.9 88.6L40.5 87.8L43.1 86.8L45.6 85.7L48 84.4L50.2 82.7L52.2 80.4L53.6 77.6L54.2 74.7L54.1 72L53.4 69.6L52.3 67.5L50.9 66L49.5 64.7L48.1 63.8L46.8 63L45.7 62.3L44.8 61.8L44.1 61.3L43.8 61.1L43.7 61.1L43.6 61.4L43.6 61.5L43.6 61.2L44.1 60.2L44.7 59.4L45.5 58.6L46.5 57.8L47.7 57.1L49.1 56.3L50.7 55.6L52.4 54.8L54.3 54.1L56.3 53.3L58.4 52.4L60.6 51.4L62.8 50.3L65 49L67.3 47.5L69.5 45.8L71.6 43.9L68.4 40.1L66.3 41.7L64.3 43.1L62.3 44.2L60.3 45.2L58.2 46.1L56.2 46.8L54.2 47.5L52.2 48.2L50.2 48.8L48.3 49.4L46.4 50.1L44.5 50.8L42.7 51.7L41 52.8L39.4 54.2L37.9 55.8L36.6 57.7L35.8 59.8L35.5 62.1L36 64.4L37 66.2L38.2 67.6L39.4 68.7L40.5 69.7L41.6 70.5L42.5 71.3L43.3 72L43.8 72.5L44 72.9L44 73.1L43.9 73.2L43.8 73.3L43.6 73.9L43.4 74.1L43 74.3L42.2 74.8L40.9 75.3L39.2 75.9L37.2 76.4L34.9 76.9L32.3 77.4L29.5 78L26.5 78.6L23.5 79.3L20.3 80.2L17.1 81.2L13.8 82.4L10.8 83.8Z';

/** Reduce Motion setting (false until known, and on platforms that cannot tell). */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

/** The solo logo mountain with the road cut out. `pulse` = slow opacity pulse (off with Reduce Motion). */
export function MountainMark({ size = 64, color, pulse, style }: { size?: number; color: string; pulse?: boolean; style?: StyleProp<ViewStyle> }) {
  const maskId = `ym${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const reduce = useReduceMotion();
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse || reduce) { op.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.45, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce, op]);
  return (
    <Animated.View style={[{ width: size, height: size, opacity: op }, style]} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
        <Defs>
          <Mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <Rect width={100} height={100} fill="#FFFFFF" />
            <Path d={ROAD_PATH} fill="#000000" />
          </Mask>
        </Defs>
        <Path d={MOUNTAIN_PATH} fill={color} mask={`url(#${maskId})`} />
      </Svg>
    </Animated.View>
  );
}

/** Our own side-view 4x4 line drawing (white on `stone` for cars without a photo). Ratio 200:84. */
export function CarSilhouette({ width = 200, color = '#FFFFFF', opacity = 0.92, strokeWidth }: { width?: number; color?: string; opacity?: number; strokeWidth?: number }) {
  // keep the line about 1.3 px or thicker on small thumbs
  const sw = strokeWidth ?? Math.max(5, Math.round((1.3 * 200) / width));
  const h = Math.round(width * 0.42);
  return (
    <View style={{ width, height: h }} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={h} viewBox="0 0 200 84" accessible={false}>
        <G fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={opacity}>
          <Path d="M14 58V36l12-2 12-20h106l12 20h26l6 6v18" />
          <Path d="M72 14v20 M114 14v20 M26 34h156" />
          <Path d="M36 58h0 M68 58h64 M168 58h4" />
          <Path d="M44 7h96 M56 7v7 M128 7v7" />
          <Path d="M6 32h8v22H6Z" />
          <Path d="M37 62a15 15 0 1 0 30 0a15 15 0 1 0-30 0Z M135 62a15 15 0 1 0 30 0a15 15 0 1 0-30 0Z" strokeLinecap="butt" />
        </G>
      </Svg>
    </View>
  );
}

/** Soft hills for a hero without a photo (spots, events). Fills its parent. */
export function HillsArt() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 390 250" preserveAspectRatio="xMidYMax slice" style={StyleSheet.absoluteFill} accessible={false}>
      <Rect width={390} height={250} fill="#E9B48F" />
      <Path d="M0 150 C60 120 90 70 120 58 Q132 52 144 60 C170 80 190 110 230 122 C260 100 280 90 300 92 C330 100 360 130 390 140 L390 250 L0 250 Z" fill="#B65A3C" />
      <Path d="M0 200 C90 180 180 205 270 186 C320 178 360 190 390 184 L390 250 L0 250 Z" fill="#8E3F27" />
    </Svg>
  );
}
