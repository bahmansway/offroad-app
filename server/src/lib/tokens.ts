import crypto from 'node:crypto';
import { lt, or } from 'drizzle-orm';
import { refreshTokens } from '../db/schema.js';
import type { Db } from '../db/index.js';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function newRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Delete refresh tokens that expired or were revoked more than 30 days ago. Returns rows removed. */
export async function pruneRefreshTokens(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const removed = await db
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, cutoff), lt(refreshTokens.revokedAt, cutoff)))
    .returning({ id: refreshTokens.id });
  return removed.length;
}
