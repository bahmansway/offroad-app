import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../lib/themeContext';
import { type as typeScale } from '../lib/theme';
import { deviceOnBakuTime, fromBakuInputValue, toBakuInputValue } from '../lib/eventLogic';
import { useI18n } from '../lib/i18n';
import { Txt } from './ui/Text';
import type { DateTimeFieldProps } from './DateTimeField';

/** Web: the browser's own date + time picker (<input type="datetime-local">), styled like a TextField. Values are Baku time. */
export function DateTimeField({ label, value, onChange, minimumDate, maximumDate, error }: DateTimeFieldProps) {
  const { c, scheme } = useTheme();
  const { t } = useI18n();
  const onBaku = deviceOnBakuTime();
  const a11y = onBaku ? label : `${label} (${t('events.bakuTime')})`;
  const font = typeScale.body as { fontSize: number; fontFamily?: string; fontWeight?: string };
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{label}</Txt>
      <View style={{ minHeight: 52, paddingHorizontal: 16, borderRadius: 26, backgroundColor: c.card, borderWidth: 1, borderColor: error ? c.destructive : 'transparent', justifyContent: 'center' }}>
        <input
          type="datetime-local"
          aria-label={a11y}
          aria-invalid={error ? true : undefined}
          value={toBakuInputValue(value)}
          min={minimumDate ? toBakuInputValue(minimumDate) : undefined}
          max={maximumDate ? toBakuInputValue(maximumDate) : undefined}
          step={300}
          onChange={(ev) => {
            const d = fromBakuInputValue((ev.target as HTMLInputElement).value);
            if (d) onChange(d);
          }}
          style={{
            border: 0, outline: 'none', background: 'transparent', color: c.label, colorScheme: scheme,
            fontSize: font.fontSize, fontFamily: font.fontFamily ?? 'Inter_400Regular, system-ui, sans-serif',
            minHeight: 44, width: '100%', padding: 0,
          }}
        />
      </View>
      {error ? <Txt variant="footnote" tone="destructive" style={{ paddingHorizontal: 20 }} role="alert">{error}</Txt>
        : !onBaku ? <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20 }}>{t('events.bakuTime')}</Txt> : null}
    </View>
  );
}
