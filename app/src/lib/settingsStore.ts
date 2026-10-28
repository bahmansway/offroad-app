import * as SecureStore from 'expo-secure-store';

export async function loadSetting(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(`offroad.${key}`);
  } catch {
    return null;
  }
}

export async function saveSetting(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(`offroad.${key}`, value);
  } catch {
    /* ignore */
  }
}
