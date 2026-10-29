import React from 'react';
import { Pressable, ScrollView, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { difficultySegments, font, signColors, terrain, type, TAP, type TerrainTone } from '../../lib/theme';
import { selectionFeedback } from '../../lib/haptics';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';
import { GlassView } from './Glass';
import { useI18n } from '../../lib/i18n';

export interface SegOption<T> {
  value: T; label: string; a11y?: string;
  /** small decorative glyph before the label (e.g. trail in clay, tent in forest) */
  icon?: IconName; iconColor?: string;
}

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
            onPress={() => { if (!on) { selectionFeedback(); onChange(o.value); } }}
            hitSlop={{ top: compact ? 4 : 0, bottom: compact ? 4 : 0 }}
            style={[
              { flexGrow: 1, minWidth: compact ? 56 : 44, height: h - pad * 2, paddingHorizontal: compact ? 12 : 16, borderRadius: (h - pad * 2) / 2, alignItems: 'center', justifyContent: 'center' },
              on && { backgroundColor: c.segOn, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {o.icon ? <Icon name={o.icon} size={16} color={o.iconColor ?? c.label} strokeWidth={2.4} /> : null}
              <Txt variant="subhead" style={{ fontWeight: on ? '600' : '500' }} numberOfLines={1}>{o.label}</Txt>
            </View>
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
        onPress={() => { selectionFeedback(); onChange(o.value); }}
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
          style={[type.body, { flex: 1, color: c.label, alignSelf: 'stretch', outlineWidth: 0, outlineStyle: 'none' } as object, multiline && { minHeight: 100, paddingVertical: 14, textAlignVertical: 'top' }, style]}
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

export type BadgeTone = 'tint' | 'gray' | TerrainTone;

/** Soft capsule ("Hazırkı", "Açıq"). Tones: `tint`, `gray`, or a terrain tone (`clay | forest | sand | stone`,
 *  soft background + text colour). Optional decorative `icon`. Terrain tones are category colour only. */
export function Badge({ text, tone = 'tint', icon }: { text: string; tone?: BadgeTone; icon?: IconName }) {
  const { c } = useTheme();
  const { bg, fg } = tone === 'tint' ? { bg: c.tintSoft, fg: c.tintSoftText }
    : tone === 'gray' ? { bg: c.fill, fg: c.label2 }
      : (() => { const x = terrain(c, tone); return { bg: x.soft, fg: x.text }; })();
  return (
    <View style={{ height: 28, minWidth: 28, paddingHorizontal: 10, borderRadius: 14, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, flexShrink: 1 }}>
      {icon ? <Icon name={icon} size={14} color={fg} strokeWidth={2.4} /> : null}
      <Txt variant="footnote" color={fg} style={font('700')} numberOfLines={1}>{text}</Txt>
    </View>
  );
}

/**
 * Trail-sign difficulty badge (DESIGN-PASS P1): a plate with a number square and the level word.
 * The plate gets darker as the level goes up, and number + word are always shown (never colour only).
 * `size` small 28 (rows) / large 36 (detail pages). `short` uses the short words in tight rows
 * (the screen-reader label keeps the full name). `variant="number"` = just the number plate (pickers).
 */
export function DifficultySign({ level, size = 'small', short, variant = 'full', style }: {
  level: number | null | undefined; size?: 'small' | 'large'; short?: boolean; variant?: 'full' | 'number'; style?: StyleProp<ViewStyle>;
}) {
  const { scheme } = useTheme();
  const { t, d } = useI18n();
  const col = signColors(level, scheme);
  if (!col || !level) return null;
  const h = size === 'large' ? 36 : 28;
  const full = d.levels.names[level - 1];
  const word = short ? d.levels.short[level - 1] : full;
  const ring = col.ring ? { borderWidth: 2, borderColor: col.ring } : null;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${t('spot.difficulty')}: ${level} · ${full}`}
      style={[{
        height: h, borderRadius: 8, backgroundColor: col.plate, flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
        paddingLeft: ring ? 1 : 3, paddingRight: variant === 'number' ? (ring ? 1 : 3) : size === 'large' ? 12 : 9, gap: size === 'large' ? 8 : 6,
      }, ring, style]}
    >
      <View style={{ width: h - 6 - (ring ? 4 : 0), height: h - 6 - (ring ? 4 : 0), borderRadius: 6, backgroundColor: col.numBg, alignItems: 'center', justifyContent: 'center' }}>
        <Txt color={col.num} style={[font('800'), { fontSize: size === 'large' ? 17 : 14, lineHeight: size === 'large' ? 20 : 17 }]}>{level}</Txt>
      </View>
      {variant === 'full' ? (
        <Txt color={col.text} numberOfLines={1} style={[font('700'), { fontSize: size === 'large' ? 15 : 13, lineHeight: size === 'large' ? 20 : 17, flexShrink: 1 }]}>{word}</Txt>
      ) : null}
    </View>
  );
}

/**
 * Small calendar page for events (DESIGN-PASS P5), 60 wide: month strip (20 px, tint when `soon`,
 * paper otherwise, grey when `muted`), day number 26/800, weekday spelled out (11 px).
 * Decorative: put the full date in the parent's accessibility label.
 */
export function DateBlock({ month, day, weekday, soon, muted, width = 60, style }: {
  month: string; day: string; weekday?: string; soon?: boolean; muted?: boolean; width?: number; style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const strip = muted ? { bg: c.fill2, fg: c.label } : soon ? { bg: c.tint, fg: c.onTint } : { bg: c.paper, fg: c.paperText };
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[{ width, borderRadius: 14, overflow: 'hidden', backgroundColor: c.card, borderWidth: 1, borderColor: soon && !muted ? c.tint : c.separator, alignItems: 'center', alignSelf: 'flex-start' }, style]}
    >
      <View style={{ height: 20, alignSelf: 'stretch', backgroundColor: strip.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Txt color={strip.fg} style={[font('800'), { fontSize: 11, lineHeight: 14, letterSpacing: 0.8 }]} numberOfLines={1}>{month}</Txt>
      </View>
      <Txt color={muted ? c.label2 : c.label} style={[font('800'), { fontSize: 26, lineHeight: 30, marginTop: 2 }]}>{day}</Txt>
      {weekday ? (
        <Txt tone="label2" center numberOfLines={2} style={[font('600'), { fontSize: 11, lineHeight: 13, paddingHorizontal: 2, paddingBottom: 6 }]}>{weekday}</Txt>
      ) : <View style={{ height: 6 }} />}
    </View>
  );
}

/** Seats: up to 4 participant dots, "3/6 maşın" and a thin 4 px progress bar. `text` is the visible label. */
export function SeatBar({ count, max, text, style }: { count: number; max: number; text: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const dots = [c.clay, c.forest, c.stone, c.sand].slice(0, Math.max(0, Math.min(count, 4)));
  const pct = max > 0 ? Math.max(0, Math.min(1, count / max)) : 0;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]} accessible accessibilityLabel={text}>
      {dots.length ? (
        <View style={{ flexDirection: 'row' }}>
          {dots.map((bg, i) => (
            <View key={i} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: bg, borderWidth: 2, borderColor: c.card, marginLeft: i ? -8 : 0, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="car" size={11} color="#FFFFFF" strokeWidth={2.4} svgOnly />
            </View>
          ))}
        </View>
      ) : null}
      <Txt variant="footnote" tone="label2" style={font('500')} numberOfLines={1}>{text}</Txt>
      <View style={{ flex: 1, maxWidth: 80, height: 4, borderRadius: 2, backgroundColor: c.fill2, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: 4, backgroundColor: c.tint }} />
      </View>
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
          onPress={() => { selectionFeedback(); onChange(n); }}
          style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}
        >
          <Icon name={n <= value ? 'starFill' : 'star'} size={size} color={c.tint} strokeWidth={1.8} />
        </Pressable>
      ))}
    </View>
  );
}

/** Small fact tile (spot page: Season / Length / Events): terrain-tone icon square, label, value.
 *  Hide the tile when there is no value — never show "Not specified". */
export function FactTile({ icon, label, value, tone = 'stone', style }: {
  icon: IconName; label: string; value: string; tone?: TerrainTone; style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const x = terrain(c, tone);
  return (
    <View style={[{ flex: 1, minWidth: 96, backgroundColor: c.card, borderRadius: 16, padding: 12, gap: 6 }, style]} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: x.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={x.text} />
      </View>
      <Txt variant="footnote" tone="label2" numberOfLines={1}>{label}</Txt>
      <Txt variant="subhead" style={font('600')} numberOfLines={2}>{value}</Txt>
    </View>
  );
}
