import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { users, refreshTokens } from '../db/schema.js';
import { conflict, parse, unauthorized } from '../lib/errors.js';
import { hashToken, newRefreshToken, REFRESH_TOKEN_TTL_MS } from '../lib/tokens.js';
import type { Db } from '../db/index.js';
import { makeLimiter } from '../lib/limits.js';

// OWASP-recommended argon2id settings (19 MiB, 2 iterations, 1 lane).
const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

const registerSchema = z
  .object({
    email,
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(2).max(40),
  })
  .strict();
const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();
const refreshSchema = z.object({ refreshToken: z.string().min(10).max(200) }).strict();

type UserRow = typeof users.$inferSelect;
export const privateUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  createdAt: u.createdAt.toISOString(),
});

// Used to keep login timing similar when the email does not exist.
let dummyHash: Promise<string> | null = null;

async function issueRefreshToken(db: Db, userId: string) {
  const token = newRefreshToken();
  const [row] = await db
    .insert(refreshTokens)
    .values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) })
    .returning({ id: refreshTokens.id });
  return { token, id: row.id };
}

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;
  const signAccess = (userId: string) => app.jwt.sign({ sub: userId, typ: 'access' }, { expiresIn: '15m' });
  const limits = app.config.rateLimits;
  const perIp = (max: number) => ({ config: { rateLimit: { max, timeWindow: '15 minutes' } } });
  // Login: per IP + email (stops guessing one account) and a looser per-IP cap (stops trying many
  // emails), so many users behind one mobile-carrier IP are not locked out together.
  const loginEmailKey = (req: { ip: string; body: unknown }) => {
    const e = (req.body as { email?: unknown } | null)?.email;
    return `${req.ip}|${typeof e === 'string' ? e.trim().toLowerCase().slice(0, 254) : ''}`;
  };
  const loginPerEmail = makeLimiter(app, { max: limits.login, timeWindow: '15 minutes', key: loginEmailKey });
  const loginPerIp = makeLimiter(app, { max: limits.loginPerIp, timeWindow: '15 minutes', key: (req) => req.ip });

  app.post('/auth/register', perIp(limits.register), async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const passwordHash = await argon2.hash(body.password, ARGON2_OPTS);
    const inserted = await db
      .insert(users)
      .values({ email: body.email, passwordHash, displayName: body.displayName })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) throw conflict('An account with this email already exists');
    const user = inserted[0];
    const rt = await issueRefreshToken(db, user.id);
    return reply.status(201).send({ accessToken: signAccess(user.id), refreshToken: rt.token, user: privateUser(user) });
  });

  app.post('/auth/login', { preHandler: [loginPerIp, loginPerEmail] }, async (req) => {
    const body = parse(loginSchema, req.body);
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${body.email}`).limit(1);
    if (!user) {
      dummyHash ??= argon2.hash('not-a-real-password-xyz', ARGON2_OPTS);
      await argon2.verify(await dummyHash, body.password).catch(() => false);
      throw unauthorized('Wrong email or password');
    }
    const ok = await argon2.verify(user.passwordHash, body.password).catch(() => false);
    if (!ok) throw unauthorized('Wrong email or password');
    const rt = await issueRefreshToken(db, user.id);
    return { accessToken: signAccess(user.id), refreshToken: rt.token, user: privateUser(user) };
  });

  app.post('/auth/refresh', perIp(limits.refresh), async (req) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    const hash = hashToken(refreshToken);
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .for('update')
        .limit(1);
      if (!row) return { ok: false as const };
      if (row.revokedAt) {
        if (row.replacedBy) {
          // Reuse of an already-rotated token: likely stolen -> revoke every session of this user.
          await tx
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
        }
        return { ok: false as const };
      }
      if (row.expiresAt.getTime() <= Date.now()) return { ok: false as const };

      const rt = await issueRefreshToken(tx as unknown as Db, row.userId);
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), replacedBy: rt.id })
        .where(eq(refreshTokens.id, row.id));
      return { ok: true as const, accessToken: signAccess(row.userId), refreshToken: rt.token };
    });
    if (!result.ok) throw unauthorized('Session expired, please log in again');
    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  });

  app.post('/auth/logout', async (req, reply) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, hashToken(refreshToken)), isNull(refreshTokens.revokedAt)));
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!user) throw unauthorized();
    return privateUser(user);
  });
}
