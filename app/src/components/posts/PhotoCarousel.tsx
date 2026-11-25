import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, Pressable, ScrollView, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Icon } from '../ui/Icon';
import { Txt } from '../ui/Text';
import { useReduceMotion } from '../ui/Motifs';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/themeContext';
import { photoUri } from '../Rows';
import { carouselIndex, DOUBLE_TAP_MS, isDoubleTap, photoCounter, showPhotoDots } from '../../lib/postsLogic';
import type { PostPhoto } from '../../lib/types';

/**
 * Square (1:1) swipeable photos. Double tap = like (big heart pops, unless Reduce Motion); a single tap calls
 * `onTap` after the double-tap window (feed: open the post). "1/3" counter top-right only for several photos.
 * Dots are drawn by the parent (in the action row) from `onIndexChange`.
 */
export function PhotoCarousel({ photos, size, onDoubleTap, onTap, onIndexChange, label }: {
  photos: PostPhoto[]; size: number; onDoubleTap?: () => void; onTap?: () => void;
  onIndexChange?: (i: number) => void; label: string;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  const last = useRef<{ at: number; x: number; y: number } | null>(null);
  const single = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heart = useRef(new Animated.Value(0)).current;
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => () => { if (single.current) clearTimeout(single.current); }, []);

  const count = photos.length;
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = carouselIndex(e.nativeEvent.contentOffset.x, size, count);
    if (i !== index) {
      setIndex(i);
      onIndexChange?.(i);
    }
  }
  function pop() {
    if (reduceMotion) return;
    heart.setValue(0);
    Animated.sequence([
      Animated.spring(heart, { toValue: 1, useNativeDriver: Platform.OS !== 'web', friction: 5 }),
      Animated.timing(heart, { toValue: 0, duration: 220, delay: 280, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  }
  function press(e: GestureResponderEvent) {
    const now = { at: Date.now(), x: e.nativeEvent.pageX ?? 0, y: e.nativeEvent.pageY ?? 0 };
    if (isDoubleTap(last.current, now)) {
      last.current = null;
      if (single.current) { clearTimeout(single.current); single.current = null; }
      pop();
      onDoubleTap?.();
      return;
    }
    last.current = now;
    if (onTap) {
      if (single.current) clearTimeout(single.current);
      single.current = setTimeout(() => { single.current = null; onTap(); }, DOUBLE_TAP_MS);
    }
  }
  function go(i: number) {
    const n = Math.max(0, Math.min(count - 1, i));
    scroller.current?.scrollTo({ x: n * size, animated: true });
    setIndex(n);
    onIndexChange?.(n);
  }

  if (!count || !(size > 0)) return <View style={{ width: '100%', aspectRatio: 1, backgroundColor: c.fill }} />;
  return (
    <View style={{ width: size, height: size }}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={onScroll}
        scrollEnabled={count > 1}
        accessibilityLabel={label}
      >
        {photos.map((p, i) => (
          <Pressable
            key={`${p.url}-${i}`}
            onPress={press}
            accessibilityRole="image"
            accessibilityLabel={t('post.photo', { n: i + 1, count })}
            accessibilityHint={onDoubleTap ? t('post.photoHint') : undefined}
            accessibilityActions={onDoubleTap ? [{ name: 'activate' }, { name: 'magicTap' }] : undefined}
            onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'magicTap') onDoubleTap?.(); else onTap?.(); }}
            style={{ width: size, height: size, backgroundColor: c.fill }}
          >
            <Image source={{ uri: photoUri(p.url) ?? undefined }} style={{ width: size, height: size }} resizeMode="cover" accessible={false} />
          </Pressable>
        ))}
      </ScrollView>
      {showPhotoDots(count) ? (
        <View pointerEvents="none" style={{ position: 'absolute', right: 12, top: 12, height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center' }}>
          <Txt variant="caption" color="#FFFFFF" style={{ fontWeight: '600' }} accessibilityElementsHidden importantForAccessibility="no">{photoCounter(index, count)}</Txt>
        </View>
      ) : null}
      {/* mouse users on the web cannot swipe: small arrows */}
      {Platform.OS === 'web' && count > 1 ? (
        <>
          {index > 0 ? <Arrow side="left" onPress={() => go(index - 1)} label={t('post.photo', { n: index, count })} /> : null}
          {index < count - 1 ? <Arrow side="right" onPress={() => go(index + 1)} label={t('post.photo', { n: index + 2, count })} /> : null}
        </>
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: heart, transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}
      >
        <Icon name="heartFill" size={96} color="#FFFFFF" svgOnly />
      </Animated.View>
    </View>
  );
}

function Arrow({ side, onPress, label }: { side: 'left' | 'right'; onPress: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [{ position: 'absolute', top: '50%', marginTop: -18, [side]: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
    >
      <Icon name={side === 'left' ? 'back' : 'chevron'} size={18} color="#FFFFFF" strokeWidth={2.6} svgOnly />
    </Pressable>
  );
}

/** Dots under the photo (in the action row): orange = shown photo. Only for several photos. */
export function PhotoDots({ index, count }: { index: number; count: number }) {
  const { c } = useTheme();
  if (!showPhotoDots(count)) return null;
  return (
    <View pointerEvents="none" style={{ flexDirection: 'row', gap: 5 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === index ? c.tint : c.label3 }} />
      ))}
    </View>
  );
}
