import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';
import { TAP } from '../lib/theme';
import { BAKU_TZ, combineBakuDateTime, deviceOnBakuTime, formatEventWhen, withZoneLabel } from '../lib/eventLogic';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Text';

export interface DateTimeFieldProps {
  label: string;
  value: Date | null;
  onChange: (d: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  error?: string | null;
}

/**
 * Date + time picker that works in Expo Go. Always Baku time (the pickers get `timeZoneName`),
 * with a "Baku time" note when the phone is in another zone.
 * iOS: the system compact picker (date chip + time chip) in a card row.
 * Android: tap → system date dialog, then the time dialog.
 * Web: see DateTimeField.web.tsx (<input type="datetime-local">).
 */
export function DateTimeField({ label, value, onChange, minimumDate, maximumDate, error }: DateTimeFieldProps) {
  const { c, scheme } = useTheme();
  const { t, d } = useI18n();
  const onBaku = deviceOnBakuTime();
  const shown = value
    ? withZoneLabel(formatEventWhen(value.toISOString(), null, { weekdays: d.events.weekdays, months: d.chat.months }), t('events.bakuTime'), onBaku)
    : t('events.form.pickDate');

  function openAndroid() {
    const start = value ?? minimumDate ?? new Date();
    DateTimePickerAndroid.open({
      mode: 'date',
      value: start,
      minimumDate,
      maximumDate,
      timeZoneName: BAKU_TZ,
      onValueChange: (_e, date) => {
        if (!date) return;
        DateTimePickerAndroid.open({
          mode: 'time',
          is24Hour: true,
          value: date,
          timeZoneName: BAKU_TZ,
          onValueChange: (_e2, time) => {
            if (!time) return;
            onChange(combineBakuDateTime(date, time));
          },
        });
      },
    });
  }

  return (
    <View style={{ gap: 6 }}>
      <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{label}</Txt>
      {Platform.OS === 'ios' ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, borderRadius: 26, backgroundColor: c.card, borderWidth: 1, borderColor: error ? c.destructive : 'transparent', gap: 10 }}
          accessibilityLabel={t('events.form.dateA11y', { label, value: shown })}
        >
          <Icon name="events" size={20} color={c.tint} />
          <View style={{ flex: 1 }} />
          <DateTimePicker
            value={value ?? minimumDate ?? new Date()}
            mode="datetime"
            display="compact"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            minuteInterval={5}
            timeZoneName={BAKU_TZ}
            accentColor={c.tint}
            themeVariant={scheme}
            onValueChange={(_e, date) => { if (date) onChange(date); }}
          />
        </View>
      ) : (
        <Pressable
          onPress={openAndroid}
          accessibilityRole="button"
          accessibilityLabel={t('events.form.dateA11y', { label, value: shown })}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', minHeight: Math.max(52, TAP), paddingHorizontal: 16, borderRadius: 26, backgroundColor: c.card, borderWidth: 1, borderColor: error ? c.destructive : 'transparent', gap: 10 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Icon name="events" size={20} color={c.tint} />
          <Txt style={{ flex: 1 }} tone={value ? 'label' : 'label3'}>{shown}</Txt>
          <Icon name="chevron" size={16} color={c.label3} strokeWidth={2.6} />
        </Pressable>
      )}
      {error ? <Txt variant="footnote" tone="destructive" style={{ paddingHorizontal: 20 }} role="alert">{error}</Txt>
        : !onBaku && Platform.OS === 'ios' ? <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20 }}>{t('events.bakuTime')}</Txt> : null}
    </View>
  );
}
