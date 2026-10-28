import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingBack } from './ui/Screen';

/** Photo header (or a simple illustration when there is no photo) with floating glass buttons. */
export function Hero({ kind, height, fallback, right, photoUri, overlay }: {
  kind: 'hills' | 'car'; height: number; fallback: string; right?: React.ReactNode; photoUri?: string | null;
  /** element in the bottom-right corner (e.g. photo count) */
  overlay?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ height: height + insets.top, overflow: 'hidden', backgroundColor: kind === 'hills' ? '#E9B48F' : '#C9D4DA' }}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
      ) : (
        <Svg width="100%" height="100%" viewBox="0 0 390 300" preserveAspectRatio="xMidYMax slice" style={StyleSheet.absoluteFill} accessible={false}>
          {kind === 'hills' ? (
            <>
              <Rect width={390} height={300} fill="#E9B48F" />
              <Path d="M0 190 L80 120 L140 160 L210 80 L290 150 L340 110 L390 150 L390 300 L0 300 Z" fill="#B65A3C" />
              <Path d="M0 230 L100 190 L190 220 L270 180 L390 220 L390 300 L0 300 Z" fill="#8E3F27" />
              <Path d="M0 270 C120 250 240 290 390 260 L390 300 L0 300 Z" fill="#6E2F1D" />
            </>
          ) : (
            <>
              <Rect width={390} height={300} fill="#C9D4DA" />
              <Path d="M0 210 L90 160 L170 190 L260 140 L390 180 L390 300 L0 300 Z" fill="#A7A08E" />
              <Path d="M0 255 C130 240 260 265 390 248 L390 300 L0 300 Z" fill="#8A7F68" />
              <Path d="M110 230 L120 198 L150 182 L250 182 L272 202 L292 208 L292 230 Z" fill="#3B3F44" />
              <Path d="M156 188 L176 188 L176 202 L148 202 Z M184 188 L240 188 L256 202 L184 202 Z" fill="#9FB3BF" />
              <Circle cx={144} cy={232} r={15} fill="#1D1F22" />
              <Circle cx={258} cy={232} r={15} fill="#1D1F22" />
              <Circle cx={144} cy={232} r={6} fill="#6B6F75" />
              <Circle cx={258} cy={232} r={6} fill="#6B6F75" />
            </>
          )}
        </Svg>
      )}
      <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 12, flexDirection: 'row', justifyContent: 'space-between' }}>
        <FloatingBack fallback={fallback} />
        <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View>
      </View>
      {overlay ? <View style={{ position: 'absolute', right: 16, bottom: 14 }}>{overlay}</View> : null}
    </View>
  );
}
