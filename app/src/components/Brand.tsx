import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import wordmarkLight from '../../assets/brand/logo-wordmark.svg';
import wordmarkDark from '../../assets/brand/logo-wordmark-dark.svg';
import logoMark from '../../assets/brand/logo-mark.svg';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';

/** The brand files are drawn as they are; only <title> and comments are dropped (some SVG parsers choke on them). */
export function cleanSvg(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<title>[\s\S]*?<\/title>/g, '').trim();
}

const WORDMARK_RATIO = 505 / 100;

/** YOLCHU logo + word (assets/brand/logo-wordmark*.svg). Light or dark version follows the theme. */
export function Wordmark({ height = 28, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const { scheme } = useTheme();
  const { t } = useI18n();
  const xml = cleanSvg(scheme === 'dark' ? wordmarkDark : wordmarkLight);
  return (
    <View style={[{ height, width: height * WORDMARK_RATIO }, style]} accessible accessibilityRole="image" accessibilityLabel={t('appName')}>
      <SvgXml xml={xml} width={height * WORDMARK_RATIO} height={height} />
    </View>
  );
}

/** Just the mark (mountains + road), assets/brand/logo-mark.svg. */
export function LogoMark({ size = 64, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const { t } = useI18n();
  return (
    <View style={[{ width: size, height: size }, style]} accessible accessibilityRole="image" accessibilityLabel={t('appName')}>
      <SvgXml xml={cleanSvg(logoMark)} width={size} height={size} />
    </View>
  );
}
