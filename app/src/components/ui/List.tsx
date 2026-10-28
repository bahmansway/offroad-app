import React from 'react';
import { Pressable, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { HAIRLINE, radius, TAP } from '../../lib/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';

/**
 * Inset grouped list (iOS Settings style):
 *   <Section header="Account" footer="…">
 *     <Cell title="Email" value="a@b.az" />
 *     <Cell title="Log out" destructive onPress={…} />
 *   </Section>
 * Separators are drawn automatically between cells (not after the last one).
 */
export function Section({ header, footer, children, style, right }: {
  header?: string; footer?: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
  /** small action at the right of the header (e.g. "Add") */
  right?: React.ReactNode;
}) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {header || right ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 6, minHeight: 28 }}>
          {header ? <Txt variant="footnote" tone="label2" style={{ textTransform: 'uppercase', letterSpacing: 0.2 }} accessibilityRole="header">{header}</Txt> : <View />}
          {right}
        </View>
      ) : null}
      <Card padded={false}>
        {items.map((child, i) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<{ last?: boolean }>, { last: i === items.length - 1 })
            : child,
        )}
      </Card>
      {footer ? <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, paddingTop: 8 }}>{footer}</Txt> : null}
    </View>
  );
}

/** Rounded card (radius 26) on the page background. */
export function Card({ children, style, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { c } = useTheme();
  return <View style={[{ backgroundColor: c.card, borderRadius: radius.card, overflow: 'hidden' }, padded && { padding: 16, gap: 12 }, style]}>{children}</View>;
}

/** Rounded square with an icon (settings rows). `bg` = solid colour + white icon; omit for soft tint. */
export function IconTile({ icon, bg, size = 30 }: { icon: IconName; bg?: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: radius.iconTile, backgroundColor: bg ?? c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={Math.round(size * 0.6)} color={bg ? '#FFFFFF' : c.tintSoftText} />
    </View>
  );
}

export interface CellProps {
  title: string;
  subtitle?: string;
  value?: string;
  /** element on the left (IconTile, Avatar, thumbnail) */
  left?: React.ReactNode;
  /** element on the right instead of value/chevron */
  right?: React.ReactNode;
  onPress?: () => void;
  /** show › (default: true when onPress is set and no `right`) */
  chevron?: boolean;
  checked?: boolean;
  destructive?: boolean;
  /** tint-coloured title (e.g. "Add photo") */
  action?: boolean;
  /** centre the title (e.g. Log out) */
  center?: boolean;
  minHeight?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'radio';
  disabled?: boolean;
  /** set by Section */
  last?: boolean;
}

/** One row of a grouped list. */
export function Cell({
  title, subtitle, value, left, right, onPress, chevron, checked, destructive, action, center, minHeight,
  accessibilityLabel, accessibilityRole, disabled, last,
}: CellProps) {
  const { c } = useTheme();
  const showChevron = chevron ?? (!!onPress && !right && checked === undefined);
  const h = minHeight ?? (subtitle ? 60 : 52);
  const titleColor = destructive ? c.destructive : action ? c.tint : c.label;
  const body = (
    <>
      {left ? <View style={{ marginRight: 14 }}>{left}</View> : null}
      <View style={{
        flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: h, paddingRight: 16, gap: 10,
        borderBottomWidth: last ? 0 : HAIRLINE, borderBottomColor: c.separator,
      }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2, paddingVertical: 8, alignItems: center ? 'center' : 'flex-start' }}>
          <Txt color={titleColor} numberOfLines={2}>{title}</Txt>
          {subtitle ? <Txt variant="subhead" tone="label2" numberOfLines={2}>{subtitle}</Txt> : null}
        </View>
        {value ? <Txt tone="label2" numberOfLines={1} style={{ flexShrink: 1, maxWidth: '55%', textAlign: 'right' }}>{value}</Txt> : null}
        {right}
        {checked ? <Icon name="check" size={20} color={c.tint} strokeWidth={2.8} /> : null}
        {showChevron ? <Icon name="chevron" size={16} color={c.label3} strokeWidth={2.6} /> : null}
      </View>
    </>
  );
  // Default screen-reader label: title, subtitle, value (never the decorative left/right elements).
  const label = accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ');
  const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, paddingLeft: 16, minHeight: Math.max(h, TAP) };
  if (!onPress) {
    return <View style={rowStyle} accessible={!!accessibilityLabel || !!left} accessibilityLabel={label}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={label}
      accessibilityState={checked !== undefined ? { checked, disabled: !!disabled } : { disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: c.fill }, disabled && { opacity: 0.5 }]}
    >
      {body}
    </Pressable>
  );
}

/** Cell with a switch on the right. */
export function SwitchCell({ title, subtitle, value, onValueChange, left, last }: {
  title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void; left?: React.ReactNode; last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Cell
      title={title}
      subtitle={subtitle}
      left={left}
      last={last}
      onPress={() => onValueChange(!value)}
      accessibilityLabel={title}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ true: c.tint, false: c.fill2 }}
          thumbColor="#FFFFFF"
          {...({ activeThumbColor: '#FFFFFF' } as object)}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      }
    />
  );
}
