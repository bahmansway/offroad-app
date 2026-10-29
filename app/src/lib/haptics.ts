import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Haptics (DESIGN-PASS P10). Silent on web and if unsupported.
 * - selectionFeedback: segmented controls, tabs, difficulty pick, star tap, category pills
 * - tapFeedback (light impact): map pin tap, pull-to-refresh release, long-press menus
 * - successFeedback: joined event, car saved, spot published, invite accepted
 * - warningFeedback: cancel event, leave clan, delete confirm
 * Never on scrolling, typing or ordinary buttons.
 */
export function selectionFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

/** Light impact. */
export function tapFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function successFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function warningFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
