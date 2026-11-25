import { Platform, Share } from 'react-native';
import { API_URL } from './config';
import { shareUrl, type ShareKind } from './postsLogic';
import type { Id } from './types';

/** Site that serves the web app: this page's origin on web, the API host (it serves the web build) on phones. */
export function siteBase(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return API_URL;
}

/**
 * Share a link to a post / spot / event with the phone's share sheet. On the web: the browser share sheet when
 * there is one, otherwise the link is copied. Returns what happened so the screen can say "Link copied".
 */
export async function shareLink(kind: ShareKind, id: Id, message: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = shareUrl(kind, id, siteBase());
  try {
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: object) => Promise<void> }) : null;
      if (nav?.share) {
        try {
          await nav.share({ title: message, url });
          return 'shared';
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError') return 'shared';
        }
      }
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(url);
        return 'copied';
      }
      return 'failed';
    }
    await Share.share(Platform.OS === 'ios' ? { url, message } : { message: `${message}\n${url}` });
    return 'shared';
  } catch {
    return 'failed';
  }
}
