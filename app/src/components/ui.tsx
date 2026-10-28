import React from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, TAP } from '../lib/theme';
import { levelColor, levelPips } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { useI18n } from '../lib/i18n';

export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[s.h2, style]}>{children}</Text>;
}
export function Muted({ children, style, numberOfLines }: { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text style={[s.muted, style]} numberOfLines={numberOfLines}>{children}</Text>;
}
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.body, style]}>{children}</Text>;
}
export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={[s.eyebrow, color ? { color } : null]}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dashed' | 'danger';
interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}
export function Button({ title, variant = 'primary', loading, icon, style, disabled, ...rest }: ButtonProps) {
  const fg = variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        variant === 'primary' && s.btnPrimary,
        variant === 'secondary' && s.btnSecondary,
        variant === 'ghost' && s.btnGhost,
        variant === 'dashed' && s.btnDashed,
        variant === 'danger' && s.btnDanger,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={s.row}>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          <Text style={[s.btnText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Square icon button (44×44) — always pass a label. */
export function IconButton({ icon, label, onPress, style, color = colors.text, bg = colors.bg, bordered }: {
  icon: IconName; label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; color?: string; bg?: string; bordered?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [s.iconBtn, { backgroundColor: bg }, bordered && s.bordered, pressed && { opacity: 0.8 }, style]}
    >
      <Icon name={icon} size={20} color={color} strokeWidth={2.2} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, accessibilityLabel }: {
  label: string; selected?: boolean; onPress?: () => void; accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [s.chip, selected ? s.chipOn : s.chipOff, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.chipText, { color: selected ? colors.onAccent : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Tag({ label }: { label: string }) {
  return <View style={s.tag}><Text style={s.tagText}>{label}</Text></View>;
}

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  right?: React.ReactNode;
}
export function TextField({ label, hint, error, right, style, multiline, ...rest }: FieldProps) {
  return (
    <View style={s.field}>
      <Text style={s.label} nativeID={`lbl-${label}`}>{label}</Text>
      <View style={[s.inputWrap, multiline && { height: undefined, minHeight: 96, alignItems: 'flex-start' }, error ? { borderColor: colors.danger } : null]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={colors.muted}
          multiline={multiline}
          style={[s.input, multiline && { paddingVertical: 12, textAlignVertical: 'top', minHeight: 96 }, style]}
          {...rest}
        />
        {right}
      </View>
      {error ? <Text style={s.error} accessibilityLiveRegion="polite" role="alert">{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function SwitchRow({ label, hint, value, onValueChange }: {
  label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={s.switchRow}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.body}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.accent, false: colors.line }}
        thumbColor={colors.text}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

export function Card({ children, style, accent }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; accent?: boolean }) {
  return <View style={[s.card, accent && { borderColor: colors.accent }, style]}>{children}</View>;
}

export function LevelPips({ level, size = 'sm' }: { level: number | null | undefined; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? { width: 8, height: 18, gap: 3 } : { width: 6, height: 12, gap: 2 };
  return (
    <View style={{ flexDirection: 'row', gap: dims.gap }} accessible={false} importantForAccessibility="no-hide-descendants">
      {levelPips(level).map((c, i) => (
        <View key={i} style={{ width: dims.width, height: dims.height, borderRadius: 2, backgroundColor: c }} />
      ))}
    </View>
  );
}

/** Rounded level badge — number on the level colour (colour is never the only signal). */
export function LevelBadge({ level }: { level: number }) {
  return (
    <View style={[s.badge, { backgroundColor: levelColor(level) }]}>
      <Text style={s.badgeText}>{level}</Text>
    </View>
  );
}

export function Stars({ value, onChange, labelFor, disabled, label }: {
  value: number; onChange?: (n: number) => void; labelFor: (n: number) => string; disabled?: boolean; label: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityLabel={labelFor(n)}
          accessibilityState={{ checked: value === n, disabled: !!disabled }}
          disabled={disabled || !onChange}
          onPress={() => onChange?.(n)}
          style={({ pressed }) => [s.star, pressed && { opacity: 0.7 }]}
        >
          <Icon name="star" size={26} color={colors.accent} fill={n <= value ? colors.accent : 'none'} strokeWidth={1.8} />
        </Pressable>
      ))}
    </View>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <View style={s.center} accessibilityLabel={t('common.loading')} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <View style={[s.center, { gap: 12, padding: 24 }]}>
      <Text style={[s.body, { textAlign: 'center' }]} role="alert">{message}</Text>
      {onRetry ? <Button title={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <Text style={[s.error, { fontSize: 14 }]} role="alert" accessibilityLiveRegion="assertive">{message}</Text>;
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string; a11y?: string }[]; value: T | null; onChange: (v: T) => void; label: string;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.a11y ?? o.label}
              onPress={() => onChange(o.value)}
              style={[s.seg, on ? s.chipOn : s.chipOff]}
            >
              <Text style={[s.chipText, { color: on ? colors.onAccent : colors.text }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  h1: { fontFamily: fonts.head, fontSize: 30, letterSpacing: 0.5, color: colors.text },
  h2: { fontFamily: fonts.head, fontSize: 22, letterSpacing: 0.5, color: colors.text },
  body: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  btn: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.accent },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  btnGhost: { backgroundColor: 'transparent' },
  btnDashed: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.muted },
  btnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  btnText: { fontFamily: fonts.bold, fontSize: 16 },
  iconBtn: { width: TAP, height: TAP, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bordered: { borderWidth: 1, borderColor: colors.line },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipText: { fontFamily: fonts.semibold, fontSize: 14 },
  seg: { minHeight: TAP, minWidth: TAP, paddingHorizontal: 14, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tag: { minHeight: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.surface2, justifyContent: 'center' },
  tagText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  field: { gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  input: { flex: 1, alignSelf: 'stretch', color: colors.text, fontFamily: fonts.medium, fontSize: 15, outlineWidth: 0 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 },
  card: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: 8 },
  badge: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.head, fontSize: 18, color: colors.onAccent },
  star: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
});
