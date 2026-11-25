import React, { useCallback, useState } from 'react';
import { Linking, Modal, Platform, Pressable, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './ui/Icon';
import { Txt } from './ui/Text';
import { PillButton } from './ui/Button';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';
import { HAIRLINE, radius, TAP } from '../lib/theme';
import { loadSetting, saveSetting } from '../lib/settingsStore';
import { NAV_APP_NAMES, NAV_PREF_KEY, navApps, navUrl, parseNavPref, type NavApp } from '../lib/navigateLogic';

const LAST_KEY = 'navLast';
const ICON: Record<NavApp, IconName> = { waze: 'navigate', google: 'map', apple: 'pin' };

export interface NavTarget { lat: number; lng: number; name: string }

async function openApp(app: NavApp, target: NavTarget): Promise<boolean> {
  const url = navUrl(app, target.lat, target.lng);
  if (!url) return false;
  try {
    if (Platform.OS === 'web') {
      // new tab, never replace the app
      const w = typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener,noreferrer') : null;
      return w !== undefined;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * "Yol göstər": `const nav = useNavigate(); nav.open({lat, lng, name})` + render `nav.sheet`.
 * Opens the remembered app straight away ("Həmişə bununla aç"), otherwise shows the chooser
 * (Waze, Google Maps, Apple Maps on iPhone). No brand logos.
 */
export function useNavigate() {
  const [target, setTarget] = useState<NavTarget | null>(null);
  const [last, setLast] = useState<NavApp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async (t: NavTarget) => {
    setError(null);
    const pref = parseNavPref(await loadSetting(NAV_PREF_KEY), Platform.OS);
    if (pref && (await openApp(pref, t))) return;
    setLast(parseNavPref(await loadSetting(LAST_KEY), Platform.OS));
    setTarget(t);
  }, []);
  const sheet = (
    <NavigateSheet target={target} last={last} error={error} setError={setError} onClose={() => setTarget(null)} />
  );
  return { open, sheet };
}

function NavigateSheet({ target, last, error, setError, onClose }: {
  target: NavTarget | null; last: NavApp | null; error: string | null; setError: (e: string | null) => void; onClose: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [always, setAlways] = useState(false);
  const apps = navApps(Platform.OS);
  async function pick(app: NavApp) {
    if (!target) return;
    saveSetting(LAST_KEY, app);
    if (always) await saveSetting(NAV_PREF_KEY, app);
    if (await openApp(app, target)) onClose();
    else setError(t('nav.openFailed', { app: NAV_APP_NAMES[app] }));
  }
  const coords = target ? `${target.lat.toFixed(3)}, ${target.lng.toFixed(3)}` : '';
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          {...({ tabIndex: -1 } as object)}
        />
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={{ width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: c.bg, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 + insets.bottom }}
        >
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.grabber, alignSelf: 'center' }} />
          <Txt variant="title2" accessibilityRole="header" style={{ marginTop: 16, marginHorizontal: 4 }}>{t('nav.title')}</Txt>
          <Txt variant="subhead" tone="label2" numberOfLines={1} style={{ marginTop: 2, marginHorizontal: 4 }}>{target ? `${target.name} · ${coords}` : ''}</Txt>
          <View style={{ marginTop: 16, backgroundColor: c.card, borderRadius: radius.card, overflow: 'hidden' }} accessibilityLabel={t('nav.appsLabel')}>
            {apps.map((app, i) => (
              <Pressable
                key={app}
                accessibilityRole="link"
                accessibilityLabel={`${NAV_APP_NAMES[app]}${last === app ? `, ${t('nav.lastChoice')}` : ''}`}
                accessibilityHint={t('nav.opens', { app: NAV_APP_NAMES[app] })}
                onPress={() => pick(app)}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingLeft: 16 }, pressed && { backgroundColor: c.fill }]}
              >
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={ICON[app]} size={22} color={c.label} />
                </View>
                <View style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', paddingRight: 16, borderBottomWidth: i < apps.length - 1 ? HAIRLINE : 0, borderBottomColor: c.separator }}>
                  <View style={{ flex: 1 }}>
                    <Txt>{NAV_APP_NAMES[app]}</Txt>
                    {last === app ? <Txt variant="footnote" tone="label2">{t('nav.lastChoice')}</Txt> : null}
                  </View>
                  <Icon name="external" size={18} color={c.label2} strokeWidth={2.2} />
                </View>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: always }}
            accessibilityLabel={t('nav.always')}
            onPress={() => setAlways((v) => !v)}
            style={{ marginTop: 16, backgroundColor: c.card, borderRadius: radius.card, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}
          >
            <Txt>{t('nav.always')}</Txt>
            <Switch
              value={always}
              onValueChange={setAlways}
              trackColor={{ true: c.tint, false: c.fill2 }}
              thumbColor="#FFFFFF"
              {...({ activeThumbColor: '#FFFFFF' } as object)}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
          <Txt variant="footnote" tone="label2" style={{ marginTop: 8, marginHorizontal: 16 }}>{t('nav.alwaysHint')}</Txt>
          {error ? <Txt variant="footnote" tone="destructive" role="alert" style={{ marginTop: 8, marginHorizontal: 16 }}>{error}</Txt> : null}
          <PillButton title={t('common.cancel')} variant="gray" size="medium" onPress={onClose} style={{ marginTop: 16, minHeight: Math.max(TAP, 50) }} />
        </View>
      </View>
    </Modal>
  );
}
