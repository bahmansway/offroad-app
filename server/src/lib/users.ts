import { and, eq, or } from 'drizzle-orm';
import { blocks, users } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { imageUrl } from './images.js';

type UserRow = typeof users.$inferSelect;

/** Small user reference used in messages, member lists etc. */
export const userRef = (u: { id: string; displayName: string; avatarImageId: string | null }) => ({
  id: u.id,
  displayName: u.displayName,
  avatarUrl: imageUrl(u.avatarImageId),
});

export const userRefCols = { id: users.id, displayName: users.displayName, avatarImageId: users.avatarImageId };

/** The logged-in user's own record (auth responses, GET/PATCH /me). */
export const privateUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  createdAt: u.createdAt.toISOString(),
  avatarUrl: imageUrl(u.avatarImageId),
  bio: u.bio,
  city: u.city,
  currentCarId: u.currentCarId,
});

/** True when either user blocked the other. */
export async function eitherBlocked(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return !!row;
}

function pgCode(err: unknown, code: string, constraint?: string): boolean {
  let e: any = err;
  for (let i = 0; e && i < 3; i++, e = e.cause) {
    if (e.code === code) return !constraint || e.constraint === constraint;
  }
  return false;
}
/** Postgres unique-violation (23505), also when wrapped by drizzle. */
export const isUniqueViolation = (err: unknown, constraint?: string) => pgCode(err, '23505', constraint);
/** Postgres foreign-key violation (23503). */
export const isForeignKeyViolation = (err: unknown) => pgCode(err, '23503');
