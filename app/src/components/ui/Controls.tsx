import React from 'react';
import { Pressable, ScrollView, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { difficultySegments, type, TAP } from '../../lib/theme';
import { tapFeedback } from '../../lib/haptics';
import { Icon } from './Icon';
import { Txt } from './Text';
import { GlassView } from './Glass';
import { useI18n } from '../../lib/i18n';

export interface SegOption<T> { value: T; label: string; a11y?: string }

/**
 * iOS segmented control. `glass` puts it on a frosted pill (over the map).
 * Rendered as a radiogroup for screen readers.
 */
export function SegmentedControl<T extends string | number>({ options, value, onChange, label, glass, style, compact }: {
  options: SegOption<T>[]; value: T | null; onChange: (v: T) => void; label: string;
  glass?: boolean; style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  const { c } = useTheme();
  const h = compact ? 36 : 44;
  const pad = compact ? 2 : 4;
  const items = (
    <View style={{ flexDirection: 'row', padding: pad, gap: 2 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.a11y ?? o.label}
            onPress={() => { if (!on) { tapFeedback(); onChange(o.value); } }}
            hitSlop={{ top: compact ? 4 : 0, bottom: compact ? 4 : 0 }}
            style={[
              { flexGrow: 1, minWidth: compact ? 56 : 44, height: h - pad * 2, paddingHorizontal: compact ? 12 : 16, borderRadius: (h - pad * 2) / 2, alignItems: 'center', justifyContent: 'center' },
              on && { backgroundColor: c.segOn, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
            ]}
          >
            <Txt variant="subhead" style={{ fontWeight: on ? '600' : '500' }} numberOfLines={1}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
  if (glass) return <GlassView elevated style={[{ borderRadius: h / 2 }, style]}>{items}</GlassView>;
  return <View style={[{ borderRadius: h / 2, backgroundColor: c.fill, alignSelf: 'flex-start' }, style]}>{items}</View>;
}

/** Horizontal row of pill choices (e.g. years). Selected = tint. */
export function ChoicePills<T extends string | number>({ options, value, onChange, label, scroll = true }: {
  options: SegOption<T>[]; value: T | null; onChange: (v: T) => void; label: string; scroll?: boolean;
}) {
  const { c } = useTheme();
  const pills = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable
        key={String(o.value)}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={o.a11y ?? o.label}
        onPress={() => { tapFeedback(); onChange(o.value); }}
        style={({ pressed }) => [
          { height: TAP, minWidth: 64, paddingHorizontal: 14, borderRadius: TAP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.tint : c.card },
          pressed && { opacity: 0.75 },
        ]}
      >
        <Txt variant="headline" color={on ? c.onTint : c.label}>{o.label}</Txt>
      </Pressable>
    );
  });
  const group = { accessibilityRole: 'radiogroup' as const, accessibilityLabel: label };
  if (!scroll) return <View {...group} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>{pills}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} {...group}>
      {pills}
    </ScrollView>
  );
}

/** Rounded search field (fill background). `glass` = floating over the map. */
export function SearchField({ value, onChangeText, placeholder, label, glass, style, autoFocus }: {
  value: string; onChangeText: (s: string) => void; placeholder: string; label: string;
  glass?: boolean; style?: StyleProp<ViewStyle>; autoFocus?: boolean;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const h = glass ? 50 : TAP;
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: h, paddingHorizontal: glass ? 18 : 14 }}>
      <Icon name="search" size={glass ? 20 : 18} color={c.label2} strokeWidth={2.4} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.label2}
        accessibilityLabel={label}
        returnKeyType="search"
        autoCorrect={false}
        autoFocus={autoFocus}
        maxLength={80}
        style={[type.body, { flex: 1, color: c.label, alignSelf: 'stretch', outlineWidth: 0 } as object]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.clear')} onPress={() => onChangeText('')} hitSlop={10}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c.label3, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={11} color={c.card} strokeWidth={3} svgOnly />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
  if (glass) return <GlassView elevated style={[{ borderRadius: h / 2 }, style]}>{inner}</GlassView>;
  return <View style={[{ borderRadius: h / 2, backgroundColor: c.fill }, style]}>{inner}</View>;
}

export interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  right?: React.ReactNode;
  /** unit shown after the input, e.g. "hp" */
  suffix?: string;
}

/** Labelled text input in a card (form screens). Shows error under the field. */
export function TextField({ label, hint, error, right, suffix, multiline, style, ...rest }: FieldProps) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{label}</Txt>
      <View style={[
        { flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', minHeight: 52, paddingHorizontal: 16, borderRadius: 26, backgroundColor: c.card, borderWidth: 1, borderColor: error ? c.destructive : 'transparent' },
        multiline && { borderRadius: 20 },
      ]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={c.label3}
          multiline={multiline}
          style={[type.body, { flex: 1, color: c.label, alignSelf: 'stretch', outlineWidth: 0 } as object, multiline && { minHeight: 100, paddingVertical: 14, textAlignVertical: 'top' }, style]}
          {...rest}
        />
        {suffix ? <Txt tone="label2" style={{ marginLeft: 6 }}>{suffix}</Txt> : null}
        {right}
      </View>
      {error ? (
        <Txt variant="footnote" tone="destructive" style={{ paddingHorizontal: 20 }} role="alert" accessibilityLiveRegion="polite">{error}</Txt>
      ) : hint ? <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20 }}>{hint}</Txt> : null}
    </View>
  );
}

/** Difficulty: 5 segments (8px, radius 4, gap 6), filled = tint, always with "n · word". */
export function DifficultyBar({ level, word, label, caption, compact }: {
  level: number | null | undefined; word?: string; label: string; caption?: string; compact?: boolean;
}) {
  const { c } = useTheme();
  const segs = difficultySegments(level);
  return (
    <View style={{ gap: compact ? 6 : 12 }}>
      {!compact ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Txt variant="subhead" tone="label2">{label}</Txt>
          {level ? <Txt variant="headline">{word ? `${level} · ${word}` : String(level)}</Txt> : null}
        </View>
      ) : null}
      <View
        style={{ flexDirection: 'row', gap: 6 }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={level ? `${label}: ${level}/5${word ? `, ${word}` : ''}` : label}
      >
        {segs.map((on, i) => (
          <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: on ? c.tint : c.fill2 }} />
        ))}
      </View>
      {caption ? <Txt variant="subhead" tone="label2">{caption}</Txt> : null}
    </View>
  );
}

/** Soft-tint badge "2 · Orta" used in list rows. */
export function Badge({ text, tone = 'tint' }: { text: string; tone?: 'tint' | 'gray' }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 28, minWidth: 28, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'tint' ? c.tintSoft : c.fill }}>
      <Txt variant="footnote" color={tone === 'tint' ? c.tintSoftText : c.label2} style={{ fontWeight: '700' }} numberOfLines={1}>{text}</Txt>
    </View>
  );
}

/** Star rating. Read-only when `onChange` is missing. `size` 15 for display, 30 for input. */
export function StarRating({ value, onChange, size = 15, label, labelFor, disabled }: {
  value: number; onChange?: (n: number) => void; size?: number; label: string;
  labelFor?: (n: number) => string; disabled?: boolean;
}) {
  const { c } = useTheme();
  const rounded = Math.round(value);
  if (!onChange) {
    return (
      <View style={{ flexDirection: 'row', gap: 1 }} accessible accessibilityRole="image" accessibilityLabel={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Icon key={n} name={n <= rounded ? 'starFill' : 'star'} size={size} color={c.tint} strokeWidth={1.8} />
        ))}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityLabel={labelFor?.(n) ?? String(n)}
          accessibilityState={{ checked: value === n, disabled: !!disabled }}
          disabled={disabled}
          onPress={() => { tapFeedback(); onChange(n); }}
          style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}
        >
          <Icon name={n <= value ? 'starFill' : 'star'} size={size} color={c.tint} strokeWidth={1.8} />
        </Pressable>
      ))}
    </View>
  );
}
