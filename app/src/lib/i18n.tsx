import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en, { type Dict } from '../locales/en';
import az from '../locales/az';
import { loadSetting, saveSetting } from './settingsStore';
import type { Lang } from './format';

export const dictionaries: Record<Lang, Dict> = { az, en };
export const DEFAULT_LANG: Lang = 'az';

type Params = Record<string, string | number>;

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dict);
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

/** Translate `key` ("spot.ratedBy"). With params.count === 1 a "<key>_one" variant wins if it exists.
 *  Falls back to English, then to the key itself. */
export function translate(lang: Lang, key: string, params?: Params): string {
  const tryDict = (d: Dict): string | undefined => {
    if (params?.count === 1) {
      const one = lookup(d, `${key}_one`);
      if (typeof one === 'string') return one;
    }
    const v = lookup(d, key);
    return typeof v === 'string' ? v : undefined;
  };
  const s = tryDict(dictionaries[lang]) ?? tryDict(dictionaries.en) ?? key;
  return interpolate(s, params);
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Params) => string;
  /** Typed access to the whole dictionary (for arrays like level names). */
  d: Dict;
}

const I18nContext = createContext<I18nValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (k, p) => translate(DEFAULT_LANG, k, p),
  d: dictionaries[DEFAULT_LANG],
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    loadSetting('lang').then((v) => {
      if (v === 'az' || v === 'en') setLangState(v);
    });
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    saveSetting('lang', l);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (k, p) => translate(lang, k, p), d: dictionaries[lang] }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
