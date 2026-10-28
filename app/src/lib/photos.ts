import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export type PickResult =
  | { ok: true; bytes: Uint8Array; previewUri: string }
  | { ok: false; reason: 'cancelled' | 'denied' | 'failed' | 'tooBig' };

/** Server limit (SPEC-v2 §3). We resize well below it. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Longest side after resize: avatar 512, car photo 1024. */
export function targetSize(w: number, h: number, maxSide: number): { width?: number; height?: number } {
  if (w <= maxSide && h <= maxSide) return {};
  return w >= h ? { width: maxSide } : { height: maxSide };
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, '');
  const bin = typeof atob === 'function' ? atob(clean) : '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Pick one photo from the library, crop (square for avatars), resize on the phone and
 * re-encode as JPEG (this also drops EXIF/GPS; the server strips it again).
 */
export async function pickPhoto(kind: 'avatar' | 'car'): Promise<PickResult> {
  try {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied' };
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [4, 3],
      quality: 1,
      exif: false,
    });
    if (res.canceled || !res.assets?.[0]) return { ok: false, reason: 'cancelled' };
    const a = res.assets[0];
    const maxSide = kind === 'avatar' ? 512 : 1024;
    const ctx = ImageManipulator.manipulate(a.uri);
    const size = targetSize(a.width || maxSide * 2, a.height || maxSide * 2, maxSide);
    if (size.width || size.height) ctx.resize(size);
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
    if (!saved.base64) return { ok: false, reason: 'failed' };
    const bytes = base64ToBytes(saved.base64);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: 'tooBig' };
    return { ok: true, bytes, previewUri: saved.uri };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Server returns relative URLs ("/api/images/…"); make them absolute for <Image>. */
export function absoluteUrl(url: string | null | undefined, base: string): string | null {
  if (!url) return null;
  if (/^(https?:|data:|blob:|file:)/.test(url)) return url;
  return base.replace(/\/+$/, '') + (url.startsWith('/') ? url : `/${url}`);
}
