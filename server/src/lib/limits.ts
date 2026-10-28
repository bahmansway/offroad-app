import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

export const rateLimited = (retryAfterSeconds = 60) =>
  new AppError(429, 'RATE_LIMITED', 'Too many attempts, try again later', Math.max(1, Math.ceil(retryAfterSeconds)));

/**
 * A rate limiter usable as a preHandler (runs after the body is parsed, so keys can use body fields
 * or the logged-in user). Each limiter has its own counter store.
 */
export function makeLimiter(
  app: FastifyInstance,
  opts: { max: number; timeWindow: string; key: (req: FastifyRequest) => string },
) {
  const check = app.createRateLimit({ max: opts.max, timeWindow: opts.timeWindow, keyGenerator: opts.key });
  return async (req: FastifyRequest) => {
    const r = await check(req);
    if (!r.isAllowed && r.isExceeded) throw rateLimited(r.ttlInSeconds);
  };
}
