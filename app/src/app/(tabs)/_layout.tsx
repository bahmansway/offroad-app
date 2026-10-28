import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../components/Icon';
import { colors, fonts } from '../../lib/theme';
import { useI18n } from '../../lib/i18n';

function tabIcon(name: IconName) {
  return ({ color }: { color: unknown }) => <Icon name={name} size={22} color={String(color)} />;
}

export default function TabsLayout() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const soon = ` (${t('common.comingSoon')})`;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.line,
          borderTopWidth: 1,
          height: 64 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarItemStyle: { minHeight: 48 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.explore'), tabBarIcon: tabIcon('compass') }} />
      <Tabs.Screen
        name="events"
        options={{ title: t('tabs.events'), tabBarIcon: tabIcon('calendar'), tabBarAccessibilityLabel: t('tabs.events') + soon }}
      />
      <Tabs.Screen name="garage" options={{ title: t('tabs.garage'), tabBarIcon: tabIcon('car') }} />
      <Tabs.Screen
        name="chat"
        options={{ title: t('tabs.chat'), tabBarIcon: tabIcon('chat'), tabBarAccessibilityLabel: t('tabs.chat') + soon }}
      />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}
