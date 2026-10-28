import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { images } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { AppError, badRequest, conflict } from './errors.js';

// One image at a time per process: keeps memory low on the small Railway instance.
sharp.concurrency(1);

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Total stored (re-encoded) image bytes per user. */
export const USER_IMAGE_QUOTA_BYTES = 20 * 1024 * 1024;
/** Content types accepted for upload bodies. The real type is always sniffed from the bytes. */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream'];

export type ImageKind = 'avatar' | 'car' | 'clan';
const MAX_SIDE: Record<ImageKind, number> = { avatar: 512, car: 1024, clan: 512 };

export const imageUrl = (id: string | null | undefined) => (id ? `/api/images/${id}` : null);

/** Detect JPEG / PNG / WebP from magic bytes. Anything else -> null. */
export function sniffImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const notAnImage = () => new AppError(415, 'VALIDATION', 'Only JPEG, PNG or WebP images are allowed');

/**
 * Re-encode an uploaded image to JPEG: applies EXIF rotation, then drops all metadata (EXIF, GPS, ICC,
 * XMP) because sharp only keeps metadata when asked to. Max side depends on the kind.
 */
export async function processImage(input: unknown, kind: ImageKind) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw badRequest('Send the image bytes as the request body');
  if (input.length > MAX_UPLOAD_BYTES) throw new AppError(413, 'VALIDATION', 'Image is larger than 2 MB');
  const sniffed = sniffImageType(input);
  if (!sniffed) throw notAnImage();
  try {
    const img = sharp(input, { failOn: 'error', limitInputPixels: 24_000_000, pages: 1 });
    const meta = await img.metadata();
    if (meta.format !== sniffed) throw notAnImage();
    const max = MAX_SIDE[kind];
    const { data, info } = await img
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(415, 'VALIDATION', 'The image could not be read');
  }
}

/**
 * Process and save an image. `replacing` is the image id this upload will replace (its bytes don't
 * count against the quota).
 */
export async function storeImage(db: Db, ownerId: string, kind: ImageKind, body: unknown, replacing?: string | null) {
  const p = await processImage(body, kind);
  const [used] = await db
    .select({ n: sql<number>`coalesce(sum(${images.bytes}), 0)::int` })
    .from(images)
    .where(replacing ? sql`${images.ownerId} = ${ownerId} and ${images.id} <> ${replacing}` : eq(images.ownerId, ownerId));
  if (used.n + p.data.length > USER_IMAGE_QUOTA_BYTES) {
    throw conflict('Photo storage limit reached (20 MB). Remove some photos first.');
  }
  const [row] = await db
    .insert(images)
    .values({ ownerId, kind, width: p.width, height: p.height, bytes: p.data.length, data: p.data })
    .returning({ id: images.id });
  return row.id;
}

export async function deleteImage(db: Db, id: string | null | undefined) {
  if (id) await db.delete(images).where(eq(images.id, id));
}
