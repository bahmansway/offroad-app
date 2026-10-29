import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../lib/themeContext';
import { type as typeScale } from '../lib/theme';
import { fromLocalInputValue, toLocalInputValue } from '../lib/eventLogic';
import { Txt } from './ui/Text';
import type { DateTimeFieldProps } from './DateTimeField';

/** Web: the browser's own date + time picker (<input type="datetime-local">), styled like a TextField. */
export function DateTimeField({ label, value, onChange, minimumDate, maximumDate, error }: DateTimeFieldProps) {
  const { c, scheme } = useTheme();
  const font = typeScale.body as { fontSize: number; fontFamily?: string; fontWeight?: string };
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{label}</Txt>
      <View style={{ minHeight: 52, paddingHorizontal: 16, borderRadius: 26, backgroundColor: c.card, borderWidth: 1, borderColor: error ? c.destructive : 'transparent', justifyContent: 'center' }}>
        <input
          type="datetime-local"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={toLocalInputValue(value)}
          min={minimumDate ? toLocalInputValue(minimumDate) : undefined}
          max={maximumDate ? toLocalInputValue(maximumDate) : undefined}
          step={300}
          onChange={(ev) => {
            const d = fromLocalInputValue((ev.target as HTMLInputElement).value);
            if (d) onChange(d);
          }}
          style={{
            border: 0, outline: 'none', background: 'transparent', color: c.label, colorScheme: scheme,
            fontSize: font.fontSize, fontFamily: font.fontFamily ?? 'Inter_400Regular, system-ui, sans-serif',
            minHeight: 44, width: '100%', padding: 0,
          }}
        />
      </View>
      {error ? <Txt variant="footnote" tone="destructive" style={{ paddingHorizontal: 20 }} role="alert">{error}</Txt> : null}
    </View>
  );
}
