export async function loadSetting(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(`offroad.${key}`) ?? null;
  } catch {
    return null;
  }
}

export async function saveSetting(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(`offroad.${key}`, value);
  } catch {
    /* ignore */
  }
}
