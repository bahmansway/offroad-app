import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Light tap feedback (tabs, segmented controls, stars). Silent on web and if unsupported. */
export function tapFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function successFeedback() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
