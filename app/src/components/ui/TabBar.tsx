import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useTheme } from '../../lib/themeContext';
import { TAB_BAR, type } from '../../lib/theme';
import { tapFeedback } from '../../lib/haptics';
import { GlassView } from './Glass';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';

/** Icon per route name. Add a line here when you add a tab. */
export const TAB_ICONS: Record<string, IconName> = {
  index: 'explore',
  events: 'events',
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
      <GlassView
        elevated
        intensity={70}
        style={{ height: TAB_BAR.height, borderRadius: TAB_BAR.height / 2, width: '100%', maxWidth: 520, paddingHorizontal: 4 }}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} accessibilityRole="tablist">
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;
            const label = typeof options.title === 'string' ? options.title : route.name;
            const color = focused ? c.tint : c.label;
            const badge = options.tabBarBadge;
            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                tapFeedback();
                navigateToTab(route.key);
              }
            };
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                onPress={onPress}
                onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
                style={({ pressed }) => [
                  { flex: 1, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', gap: 2 },
                  focused && { backgroundColor: c.tabActiveBg },
                  pressed && !focused && { opacity: 0.6 },
                ]}
              >
                <View>
                  <Icon name={TAB_ICONS[route.name] ?? 'explore'} size={24} color={color} />
                  {badge != null && badge !== '' ? (
                    <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.destructive, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt style={[type.tab, { color: '#FFFFFF' }]}>{String(badge)}</Txt>
                    </View>
                  ) : null}
                </View>
                <Txt style={type.tab} color={color} numberOfLines={1}>{label}</Txt>
              </Pressable>
            );
          })}
        </View>
      </GlassView>
    </View>
  );
}
