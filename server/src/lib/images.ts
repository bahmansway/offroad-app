import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { images } from '../db/schema.js';
import type { Db, Tx } from '../db/index.js';
import { AppError, badRequest, conflict } from './errors.js';

// One image at a time per process: keeps memory low on the small Railway instance.
sharp.concurrency(1);

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Total stored (re-encoded) image bytes per user, post photos included (v6: 50 MB for now, Railway disk cost). */
export const USER_IMAGE_QUOTA_MB = 50;
export const USER_IMAGE_QUOTA_BYTES = USER_IMAGE_QUOTA_MB * 1024 * 1024;
/** Content types accepted for upload bodies. The real type is always sniffed from the bytes. */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream'];

export type ImageKind = 'avatar' | 'car' | 'clan' | 'event' | 'group' | 'post';
const MAX_SIDE: Record<ImageKind, number> = { avatar: 512, car: 1024, clan: 512, event: 1024, group: 512, post: 1440 };
const QUALITY: Partial<Record<ImageKind, number>> = { post: 80 };

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
      .jpeg({ quality: QUALITY[kind] ?? 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(415, 'VALIDATION', 'The image could not be read');
  }
}

/**
 * Process and save an image for one owner, all in one transaction (resizing happens before it).
 * `current` reads (and should lock) the record whose image is replaced and returns that image id (its
 * bytes don't count against the quota), `apply` points the owner's record at the new image. Returns the new id and the old one,
 * which the caller deletes afterwards.
 */
export async function storeImage(
  db: Db,
  ownerId: string,
  kind: ImageKind,
  body: unknown,
  opts: { current: (tx: Tx) => Promise<string | null>; apply: (tx: Tx, imageId: string) => Promise<void> },
) {
  const processed = await processImage(body, kind);
  return db.transaction(async (tx) => {
    // the record being changed is read (and locked) first, then the owner: same lock order as deletes
    const old = await opts.current(tx);
    const imageId = await saveImage(tx, ownerId, kind, processed, old);
    await opts.apply(tx, imageId);
    return { imageId, old };
  });
}

/**
 * Lock the owner's user row so one user's uploads are checked against the quota one at a time
 * (avatar, car, clan logo, event cover, group photo and post photos at the same moment can't pass the
 * check together). Locking twice in the same transaction is fine. Lock order everywhere: the record
 * (car, post, event, group) first, then the owner.
 */
async function lockOwner(tx: Tx, ownerId: string) {
  // NO KEY UPDATE: serializes uploads of one user but doesn't block inserts that only reference the user
  await tx.execute(sql`select id from users where id = ${ownerId} for no key update`);
}

/**
 * Quota check + insert of an already processed image. Needs a transaction: it takes the owner's lock,
 * which is held until that transaction ends.
 */
export async function saveImage(
  tx: Tx,
  ownerId: string,
  kind: ImageKind,
  p: Awaited<ReturnType<typeof processImage>>,
  replacing?: string | null,
  postId?: string,
) {
  await lockOwner(tx, ownerId);
  const [used] = await tx
    .select({ n: sql<number>`coalesce(sum(${images.bytes}), 0)::bigint` })
    .from(images)
    .where(replacing ? sql`${images.ownerId} = ${ownerId} and ${images.id} <> ${replacing}` : eq(images.ownerId, ownerId));
  if (Number(used.n) + p.data.length > USER_IMAGE_QUOTA_BYTES) {
    throw conflict(`Photo storage limit reached (${USER_IMAGE_QUOTA_MB} MB). Remove some photos first.`);
  }
  const [row] = await tx
    .insert(images)
    .values({ ownerId, kind, postId: postId ?? null, width: p.width, height: p.height, bytes: p.data.length, data: p.data })
    .returning({ id: images.id });
  return row.id;
}

/** Total photo storage: stored (re-encoded) bytes and the table's size on disk, in MB. */
export async function imageStorageMb(db: Db) {
  const r = await db.execute<{ stored: string; disk: string; count: string }>(sql`
    select coalesce(sum(bytes), 0)::bigint as stored, count(*)::bigint as count,
      pg_total_relation_size('images')::bigint as disk from images`);
  const mb = (n: string) => Math.round((Number(n) / 1024 / 1024) * 10) / 10;
  return { storedMb: mb(r.rows[0].stored), diskMb: mb(r.rows[0].disk), count: Number(r.rows[0].count) };
}

export async function deleteImage(db: Db, id: string | null | undefined) {
  if (id) await db.delete(images).where(eq(images.id, id));
}
