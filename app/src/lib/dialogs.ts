import { Alert, Platform } from 'react-native';
import { warningFeedback } from './haptics';

/** Yes/no question for a destructive action (delete, leave, remove). Works on phones and in the browser.
 *  Gives a warning haptic on phones. */
export function confirmAsync(message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  warningFeedback();
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
  }
  return new Promise((resolve) => {
    Alert.alert('', message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
