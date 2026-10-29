import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../lib/themeContext';
import { TAP } from '../lib/theme';
import { tapFeedback } from '../lib/haptics';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Text';

/** − value + control (44px buttons). Screen readers get it as an adjustable control. */
export function Stepper({ value, onChange, min, max, label, valueText, minusLabel, plusLabel }: {
  value: number; onChange: (n: number) => void; min: number; max: number; label: string; valueText: string;
  minusLabel: string; plusLabel: string;
}) {
  const { c } = useTheme();
  const set = (n: number) => {
    const v = Math.min(max, Math.max(min, n));
    if (v !== value) { tapFeedback(); onChange(v); }
  };
  const btn = (icon: 'minus' | 'plus', l: string, disabled: boolean, fn: () => void) => (
    <Pressable
      onPress={fn}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={l}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        { width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Icon name={icon} size={20} color={c.tint} strokeWidth={2.6} />
    </Pressable>
  );
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
      accessible={false}
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: valueText }}
    >
      {btn('minus', minusLabel, value <= min, () => set(value - 1))}
      <Txt variant="title3" style={{ minWidth: 24, textAlign: 'center' }} accessibilityLiveRegion="polite">{String(value)}</Txt>
      {btn('plus', plusLabel, value >= max, () => set(value + 1))}
    </View>
  );
}
