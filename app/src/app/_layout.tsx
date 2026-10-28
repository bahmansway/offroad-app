import React from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { I18nProvider } from '../lib/i18n';
import { AuthProvider } from '../lib/auth';
import { ThemeProvider, useTheme } from '../lib/themeContext';
import { palettes } from '../lib/theme';
import { OfflineBanner } from '../components/OfflineBanner';

// iOS uses the system font, so fonts are only loaded on Android and web.
const FONTS = Platform.OS === 'ios' ? {} : { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold };

function AppStack() {
  const { c, scheme } = useTheme();
  // iOS: real page sheet. Elsewhere SheetScreen draws the sheet itself over a dimmed page.
  const sheet = Platform.OS === 'ios'
    ? ({ presentation: 'modal' } as const)
    : ({ presentation: 'transparentModal', animation: 'slide_from_bottom' } as const);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <OfflineBanner />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="report" options={sheet} />
        <Stack.Screen name="car/add" options={sheet} />
        <Stack.Screen name="profile/edit" options={sheet} />
        <Stack.Screen name="profile/current-car" options={sheet} />
        <Stack.Screen name="about" options={sheet} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONTS);
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: palettes.light.bg }} />;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <AppStack />
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
