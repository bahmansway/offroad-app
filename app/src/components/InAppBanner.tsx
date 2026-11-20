import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, Icon, IconButton, Txt, useTheme } from './ui';
import { useReduceMotion } from './ui/Motifs';
import { useI18n } from '../lib/i18n';

export interface BannerData {
  key: number;
  title: string;
  body: string;
  /** where a tap goes; null = not tappable */
  route: string | null;
}

/** Shown on top of the app instead of a system notification while the app is open. Hides after 5 s. */
export function InAppBanner({ banner, onPress, onClose }: { banner: BannerData | null; onPress: (b: BannerData) => void; onClose: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const y = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    if (!banner) return;
    AccessibilityInfo.announceForAccessibility?.(t('notifications.bannerA11y', { title: banner.title, body: banner.body }));
    if (reduceMotion) y.setValue(0);
    else Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    const h = setTimeout(onClose, 5000);
    return () => clearTimeout(h);
  }, [banner?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!banner) return null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 8, zIndex: 1000, alignItems: 'center', paddingHorizontal: 12, transform: [{ translateY: y }] }}
    >
      <GlassView elevated style={{ borderRadius: 22, width: '100%', maxWidth: 520 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64 }}>
          <Pressable
            accessibilityRole={banner.route ? 'button' : 'text'}
            accessibilityLabel={t('notifications.bannerA11y', { title: banner.title, body: banner.body })}
            accessibilityHint={banner.route ? t('notifications.bannerHint') : undefined}
            disabled={!banner.route}
            onPress={() => onPress(banner)}
            style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14 }, pressed && { opacity: 0.6 }]}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bell" size={18} color={c.onTint} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="headline" numberOfLines={1}>{banner.title}</Txt>
              {banner.body ? <Txt variant="subhead" tone="label2" numberOfLines={2}>{banner.body}</Txt> : null}
            </View>
          </Pressable>
          <IconButton icon="close" label={t('common.close')} onPress={onClose} style={{ backgroundColor: 'transparent' }} />
        </View>
      </GlassView>
    </Animated.View>
  );
}
