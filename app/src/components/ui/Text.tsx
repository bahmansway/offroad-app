import React from 'react';
import { Text, type TextProps } from 'react-native';
import { useTheme } from '../../lib/themeContext';
import { type, type TypeVariant } from '../../lib/theme';

export type Tone = 'label' | 'label2' | 'label3' | 'tint' | 'destructive' | 'onTint' | 'tintSoftText';

export interface TxtProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  /** raw colour; wins over tone */
  color?: string;
  center?: boolean;
}

/** Themed text. `variant` = iOS type scale (largeTitle … caption), `tone` = semantic colour. */
export function Txt({ variant = 'body', tone = 'label', color, center, style, ...rest }: TxtProps) {
  const { c } = useTheme();
  return <Text style={[type[variant], { color: color ?? c[tone] }, center && { textAlign: 'center' }, style]} {...rest} />;
}

/** Page-level heading (large title). */
export function LargeTitle({ children, style }: { children: React.ReactNode; style?: TextProps['style'] }) {
  return <Txt variant="largeTitle" accessibilityRole="header" style={style}>{children}</Txt>;
}
