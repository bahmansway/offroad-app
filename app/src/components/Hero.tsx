import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './ui';
import { goBack } from './Screen';
import { useI18n } from '../lib/i18n';

/** Colour header with a simple illustration (real photos arrive in v2). */
export function Hero({ tint, kind, height, fallback, right }: {
  tint: string; kind: 'hills' | 'car'; height: number; fallback: string; right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <View style={{ height: height + insets.top, backgroundColor: tint }}>
      <Svg width="100%" height="100%" viewBox="0 0 390 240" preserveAspectRatio="xMidYMax slice" style={StyleSheet.absoluteFill} accessible={false}>
        {kind === 'hills' ? (
          <>
            <Path d="M0 170 L70 110 L120 140 L190 70 L260 130 L320 95 L390 140 L390 240 L0 240 Z" fill="#000" opacity={0.22} />
            <Path d="M0 200 L90 160 L170 190 L250 150 L390 190 L390 240 L0 240 Z" fill="#000" opacity={0.35} />
          </>
        ) : (
          <>
            <Rect x={0} y={190} width={390} height={50} fill="#000" opacity={0.2} />
            <Path d="M95 180 L110 135 L160 120 L250 120 L280 140 L310 145 L315 180 Z" fill="#C8B98A" />
            <Rect x={160} y={110} width={90} height={8} rx={2} fill="#14130E" />
            <Circle cx={140} cy={185} r={24} fill="#14130E" />
            <Circle cx={275} cy={185} r={24} fill="#14130E" />
            <Circle cx={140} cy={185} r={10} fill="#5A5446" />
            <Circle cx={275} cy={185} r={10} fill="#5A5446" />
          </>
        )}
      </Svg>
      <View style={[styles.bar, { top: insets.top + 16 }]}>
        <IconButton icon="back" label={t('common.back')} onPress={() => goBack(fallback)} />
        <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
});
