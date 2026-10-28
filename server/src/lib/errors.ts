import type { z } from 'zod';

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: ErrorCode,
    message: string,
    /** Sent as the Retry-After header (429 responses). */
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new AppError(400, 'VALIDATION', m);
export const unauthorized = (m = 'Not logged in') => new AppError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'Not allowed') => new AppError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string) => new AppError(409, 'CONFLICT', m);

/** Parse with zod; throw a VALIDATION AppError on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 5)
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    throw badRequest(msg || 'Invalid input');
  }
  return r.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Path ids that are not UUIDs can't exist -> 404. */
export function idParam(params: unknown, name = 'id'): string {
  const v = (params as Record<string, unknown>)?.[name];
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw notFound();
  return v.toLowerCase();
}
