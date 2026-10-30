import { Alert, Platform } from 'react-native';
import { warningFeedback } from './haptics';

/**
 * Yes/no question. Works on phones and in the browser.
 * `destructive: true` (delete, leave, remove, cancel) gives a warning haptic on phones and a red OK button;
 * plain confirmations (promote, make leader …) stay quiet.
 */
export function confirmAsync(
  message: string, okLabel: string, cancelLabel: string, opts: { destructive?: boolean } = {},
): Promise<boolean> {
  if (opts.destructive) warningFeedback();
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
  }
  return new Promise((resolve) => {
    Alert.alert('', message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
