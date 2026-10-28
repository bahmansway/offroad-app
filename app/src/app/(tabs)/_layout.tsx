import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { FloatingTabBar } from '../../components/ui/TabBar';
import { useTheme } from '../../lib/themeContext';
import { useI18n } from '../../lib/i18n';

export default function TabsLayout() {
  const { t } = useI18n();
  const { c } = useTheme();
  const soon = ` (${t('common.comingSoon')})`;
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.explore') }} />
      <Tabs.Screen name="events" options={{ title: t('tabs.events'), tabBarAccessibilityLabel: t('tabs.events') + soon }} />
      <Tabs.Screen name="garage" options={{ title: t('tabs.garage') }} />
      <Tabs.Screen name="chat" options={{ title: t('tabs.chat') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile') }} />
    </Tabs>
  );
}
