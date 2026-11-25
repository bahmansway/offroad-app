import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { FloatingTabBar } from '../../components/ui/TabBar';
import { useTheme } from '../../lib/themeContext';
import { useI18n } from '../../lib/i18n';
import { useChat } from '../../lib/chat';
import { badgeText } from '../../lib/chatLogic';

/** v6 tab order: Ana səhifə · Kəşf et · Söhbət (raised centre) · Qaraj · Profil. Events live under Home and Explore. */
export default function TabsLayout() {
  const { t } = useI18n();
  const { c } = useTheme();
  const { chatBadge, newFollowers } = useChat();
  const badge = badgeText(chatBadge);
  const profileBadge = badgeText(newFollowers);
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="explore" options={{ title: t('tabs.explore') }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('tabs.chat'),
          tabBarBadge: badge,
          tabBarAccessibilityLabel: badge ? `${t('tabs.chat')}, ${t('chat.unread', { count: chatBadge })}` : t('tabs.chat'),
        }}
      />
      <Tabs.Screen name="garage" options={{ title: t('tabs.garage') }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarBadge: profileBadge,
          tabBarAccessibilityLabel: profileBadge
            ? `${t('tabs.profile')}, ${t('tabs.newFollowers', { count: newFollowers })}`
            : t('tabs.profile'),
        }}
      />
    </Tabs>
  );
}
