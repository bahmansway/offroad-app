import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from './api';
import { MAX_UPLOAD_BYTES, targetSize } from './photos';
import { MAX_POST_PHOTOS, POST_PHOTO_SIDE } from './postsLogic';
import type { Id, Post, PostInput } from './types';

/** A photo picked for a new post (not uploaded yet). */
export interface PickedPhoto { key: string; uri: string; width: number; height: number }

let keySeq = 0;
const toPicked = (a: ImagePicker.ImagePickerAsset): PickedPhoto => ({ key: `p${++keySeq}-${Date.now()}`, uri: a.uri, width: a.width, height: a.height });

export type PickOutcome = { ok: true; photos: PickedPhoto[] } | { ok: false; reason: 'cancelled' | 'denied' | 'failed' };

/** Gallery, several at once (up to what is left of 6), in the order they were tapped. */
export async function pickFromGallery(have: number): Promise<PickOutcome> {
  const left = Math.max(0, MAX_POST_PHOTOS - have);
  if (!left) return { ok: false, reason: 'cancelled' };
  try {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied' };
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: left,
      orderedSelection: true,
      quality: 1,
      exif: false,
    });
    if (r.canceled || !r.assets?.length) return { ok: false, reason: 'cancelled' };
    return { ok: true, photos: r.assets.slice(0, left).map(toPicked) };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export async function takePhoto(): Promise<PickOutcome> {
  try {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied' };
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (r.canceled || !r.assets?.length) return { ok: false, reason: 'cancelled' };
    return { ok: true, photos: [toPicked(r.assets[0])] };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, '');
  const bin = typeof atob === 'function' ? atob(clean) : '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Resize on the phone to 1440 px long side and re-encode as JPEG (drops EXIF/GPS; the server strips it again). */
export async function preparePostPhoto(p: PickedPhoto): Promise<Uint8Array> {
  for (const compress of [0.8, 0.65, 0.5]) {
    const ctx = ImageManipulator.manipulate(p.uri);
    const size = targetSize(p.width || POST_PHOTO_SIDE * 2, p.height || POST_PHOTO_SIDE * 2, POST_PHOTO_SIDE);
    if (size.width || size.height) ctx.resize(size);
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
    if (!saved.base64) throw new Error('encode failed');
    const bytes = base64ToBytes(saved.base64);
    if (bytes.byteLength <= MAX_UPLOAD_BYTES) return bytes;
  }
  throw new Error('too big');
}

/**
 * Upload state kept by the screen, so "Try again" continues where it stopped: the draft is made once,
 * photos already sent are not sent again, then publish. Drafts the server never sees published are
 * deleted by it after 24 h.
 */
export interface UploadState { draftId: Id | null; sent: string[]; post: Post | null }
export const freshUpload = (): UploadState => ({ draftId: null, sent: [], post: null });

export async function uploadPost(
  st: UploadState,
  input: PostInput,
  photos: PickedPhoto[],
  onProgress: (done: number, total: number, stage: 'photos' | 'publish') => void,
): Promise<Post> {
  if (!st.draftId) {
    const d = await api.createPost(input);
    st.draftId = d.id;
  } else {
    // caption / car / spot may have changed after a failed try
    await api.updatePost(st.draftId, input).catch(() => {});
  }
  // A photo's place in the post = its index; re-sending the same index replaces it.
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const tag = `${i}:${p.key}`;
    onProgress(st.sent.length, photos.length, 'photos');
    if (st.sent.includes(tag)) continue;
    const bytes = await preparePostPhoto(p);
    await api.uploadPostPhoto(st.draftId, i, bytes);
    st.sent = [...st.sent.filter((s) => !s.startsWith(`${i}:`)), tag];
  }
  // photos removed after a failed try: clear the indexes that are no longer used
  for (const s of st.sent.filter((x) => Number(x.split(':')[0]) >= photos.length)) {
    await api.deletePostPhoto(st.draftId, Number(s.split(':')[0])).catch(() => {});
    st.sent = st.sent.filter((x) => x !== s);
  }
  onProgress(photos.length, photos.length, 'publish');
  const post = await api.publishPost(st.draftId);
  st.post = post;
  return post;
}
