import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingBack } from './ui/Screen';
import { CarSilhouette, Contour, HillsArt } from './ui/Motifs';
import { useTheme } from '../lib/themeContext';

/**
 * Photo header, or (no photo) soft hills / the 4x4 silhouette on stone, both with a faint white contour.
 * Floating glass back button on the left, `right` buttons on the right.
 */
export function Hero({ kind, height, fallback, right, photoUri, overlay, bottomLeft }: {
  kind: 'hills' | 'car'; height: number; fallback: string; right?: React.ReactNode; photoUri?: string | null;
  /** element in the bottom-right corner (e.g. upload spinner) */
  overlay?: React.ReactNode;
  /** element in the bottom-left corner (event date block, "add a photo" chip) */
  bottomLeft?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const bg = kind === 'hills' ? '#E9B48F' : c.stone;
  return (
    <View style={{ height: height + insets.top, overflow: 'hidden', backgroundColor: bg }}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
      ) : kind === 'hills' ? (
        <>
          <HillsArt />
          <Contour color="#FFFFFF" opacity={0.2} seed={2} width={390} height={250} />
        </>
      ) : (
        <>
          <Contour color="#FFFFFF" opacity={0.16} seed={4} width={390} height={220} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: insets.top + Math.max(40, height * 0.25), alignItems: 'center' }} pointerEvents="none">
            <CarSilhouette width={Math.min(210, height * 0.95)} />
          </View>
        </>
      )}
      <View style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 12, flexDirection: 'row', justifyContent: 'space-between' }}>
        <FloatingBack fallback={fallback} />
        <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View>
      </View>
      {bottomLeft ? <View style={{ position: 'absolute', left: 16, bottom: 14 }}>{bottomLeft}</View> : null}
      {overlay ? <View style={{ position: 'absolute', right: 16, bottom: 14 }}>{overlay}</View> : null}
    </View>
  );
}
