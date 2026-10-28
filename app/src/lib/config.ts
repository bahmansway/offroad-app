import { Platform } from 'react-native';
import Constants from 'expo-constants';

const DEV_PORT = 4000;

/**
 * Where the API lives.
 * 1. EXPO_PUBLIC_API_URL if set (e.g. https://offroad.up.railway.app). REQUIRED for phone store builds.
 * 2. Web production build: same origin — the server serves the web build.
 * 3. Development: http://localhost:4000 on web; on a phone (Expo Go) the dev computer's
 *    LAN address taken from the Expo dev server, port 4000.
 */
export function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  if (Platform.OS === 'web') {
    if (!__DEV__ && typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    return `http://localhost:${DEV_PORT}`;
  }

  if (!__DEV__) {
    // A phone release build has no dev server to point at — this would never reach the API.
    console.error(
      '[offroad] EXPO_PUBLIC_API_URL is not set in this release build. ' +
        'Set it to the https Railway URL before building (see app/.env.example). Falling back to localhost, which will not work.',
    );
  }
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.5:8081"
  const host = hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${DEV_PORT}`;
}

export const API_URL = resolveApiUrl();
