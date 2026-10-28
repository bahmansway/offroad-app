import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform, StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { isAppearancePref, palettes, resolveScheme, type AppearancePref, type Palette, type Scheme } from './theme';
import { loadSetting, saveSetting } from './settingsStore';

interface ThemeValue {
  scheme: Scheme;
  c: Palette;
  pref: AppearancePref;
  setPref: (p: AppearancePref) => void;
}

const ThemeContext = createContext<ThemeValue>({
  scheme: 'light',
  c: palettes.light,
  pref: 'auto',
  setPref: () => {},
});

function applyNative(p: AppearancePref) {
  // Lets native alerts/pickers follow the in-app choice. Not available on web.
  if (Platform.OS === 'web') return;
  try {
    Appearance.setColorScheme(p === 'auto' ? 'unspecified' : p);
  } catch {
    /* older runtimes */
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<AppearancePref>('auto');
  const system = useColorScheme();
  // When the user forces light/dark on native, useColorScheme reports the forced value; we only
  // trust it for 'auto', which is exactly what resolveScheme does.
  const scheme = resolveScheme(pref, system);

  useEffect(() => {
    loadSetting('appearance').then((v) => {
      if (isAppearancePref(v)) {
        setPrefState(v);
        applyNative(v);
      }
    });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.colorScheme = scheme;
    root.style.backgroundColor = palettes[scheme].bg;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', palettes[scheme].bg);
  }, [scheme]);

  const setPref = useCallback((p: AppearancePref) => {
    setPrefState(p);
    applyNative(p);
    saveSetting('appearance', p);
  }, []);

  const value = useMemo(() => ({ scheme, c: palettes[scheme], pref, setPref }), [scheme, pref, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/**
 * Theme-aware StyleSheet. Define once at module level, call the returned hook in the component:
 *   const useStyles = makeStyles((c) => ({ box: { backgroundColor: c.card } }));
 *   const s = useStyles();
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };
export function makeStyles<T extends NamedStyles<T>>(fn: (c: Palette, scheme: Scheme) => T) {
  const cache: Partial<Record<Scheme, T>> = {};
  return function useStyles(): T {
    const { scheme, c } = useTheme();
    let s = cache[scheme];
    if (!s) {
      s = StyleSheet.create(fn(c, scheme));
      cache[scheme] = s;
    }
    return s;
  };
}
