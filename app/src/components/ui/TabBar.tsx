import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useTheme } from '../../lib/themeContext';
import { TAB_BAR, type } from '../../lib/theme';
import { selectionFeedback } from '../../lib/haptics';
import { GlassView } from './Glass';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';

/** The raised centre tab (v6: Söhbət). */
export const CENTER_TAB = 'chat';

/** Icon per route name. Add a line here when you add a tab. */
export const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  explore: 'explore',
  garage: 'garage',
  chat: 'chat',
  profile: 'profile',
};

/**
 * Floating glass tab bar (64 tall pill, 16px sides, 24px above the bottom).
 * Use as `<Tabs tabBar={(p) => <FloatingTabBar {...p} />}>`. Reads `title`,
 * `tabBarAccessibilityLabel` and `tabBarBadge` (number → red dot with count) from screen options.
 */
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 10, 0) + TAB_BAR.gap;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center', paddingHorizontal: TAB_BAR.side }}>
      {/* The glass is a background layer so the raised centre button is not clipped by it. */}
      <View style={{ height: TAB_BAR.height, width: '100%', maxWidth: 520 }}>
        <GlassView elevated intensity={70} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: TAB_BAR.height / 2 }} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }} accessibilityRole="tablist">
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;
            const label = typeof options.title === 'string' ? options.title : route.name;
            const color = focused ? c.tint : c.label;
            const badge = options.tabBarBadge;
            const hasBadge = badge != null && badge !== '';
            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                selectionFeedback();
                navigateToTab(route.key);
              }
            };
            const badgeView = hasBadge ? (
              <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.destructive, alignItems: 'center', justifyContent: 'center' }}>
                <Txt style={[type.tab, { color: '#FFFFFF' }]}>{String(badge)}</Txt>
              </View>
            ) : null;
            const a11y = {
              accessibilityRole: 'tab' as const,
              accessibilityState: { selected: focused },
              accessibilityLabel: options.tabBarAccessibilityLabel ?? label,
              onPress,
              onLongPress: () => emitter.emit({ type: 'tabLongPress', target: route.key }),
            };
            if (route.name === CENTER_TAB) {
              // Söhbət: 52 px circle raised 22 px with a 3 px ring in the page colour; orange when active.
              return (
                <Pressable key={route.key} {...a11y} style={({ pressed }) => [{ flex: 1, height: 56, alignItems: 'center', justifyContent: 'flex-end', gap: 2 }, pressed && !focused && { opacity: 0.7 }]}>
                  <View style={{
                    width: 52, height: 52, marginTop: -22, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: focused ? c.tint : c.ink, borderWidth: 3, borderColor: c.bg,
                    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 6,
                  }}>
                    <Icon name={TAB_ICONS[route.name] ?? 'chat'} size={24} color={focused ? c.onTint : c.onInk} />
                    {hasBadge ? (
                      <View style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.destructive, alignItems: 'center', justifyContent: 'center' }}>
                        <Txt style={[type.tab, { color: '#FFFFFF' }]}>{String(badge)}</Txt>
                      </View>
                    ) : null}
                  </View>
                  <Txt style={[type.tab, { marginBottom: 4 }]} color={color} numberOfLines={1}>{label}</Txt>
                </Pressable>
              );
            }
            return (
              <Pressable
                key={route.key}
                {...a11y}
                style={({ pressed }) => [
                  { flex: 1, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', gap: 2 },
                  focused && { backgroundColor: c.tabActiveBg },
                  pressed && !focused && { opacity: 0.6 },
                ]}
              >
                <View>
                  <Icon name={TAB_ICONS[route.name] ?? 'explore'} size={24} color={color} />
                  {badgeView}
                </View>
                <Txt style={type.tab} color={color} numberOfLines={1}>{label}</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
