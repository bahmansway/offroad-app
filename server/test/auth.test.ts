import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, register, resetDb } from './helpers.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
});
afterAll(async () => app.close());

describe('auth', () => {
  it('health', async () => {
    const r = await app.inject({ url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it('register -> me -> logout -> login; wrong password rejected', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'Driver@Example.com', password: 'supersecret', displayName: 'Driver' },
    });
    expect(reg.statusCode).toBe(201);
    const b = reg.json();
    expect(b.accessToken).toBeTypeOf('string');
    expect(b.refreshToken).toBeTypeOf('string');
    expect(Object.keys(b.user).sort()).toEqual(['createdAt', 'displayName', 'email', 'id']);
    expect(b.user.email).toBe('driver@example.com');
    expect(JSON.stringify(b)).not.toContain('password');

    const me = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${b.accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual(b.user);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken: b.refreshToken } });
    expect(out.statusCode).toBe(204);
    const afterLogout = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: b.refreshToken } });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json().error.code).toBe('UNAUTHORIZED');

    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'driver@example.com', password: 'wrongpass' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });

    const noUser = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.com', password: 'whatever1' } });
    expect(noUser.statusCode).toBe(401);

    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'DRIVER@example.com', password: 'supersecret' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.id).toBe(b.user.id);
  });

  it('duplicate email -> 409 CONFLICT', async () => {
    const p = { email: 'dup@example.com', password: 'supersecret', displayName: 'Dup' };
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: p })).statusCode).toBe(201);
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...p, email: 'DUP@example.com' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('CONFLICT');
  });

  it('register validation errors', async () => {
    const cases = [
      { email: 'not-an-email', password: 'supersecret', displayName: 'Ok name' },
      { email: 'a@b.com', password: 'short', displayName: 'Ok name' },
      { email: 'a@b.com', password: 'x'.repeat(129), displayName: 'Ok name' },
      { email: 'a@b.com', password: 'supersecret', displayName: 'A' },
      { email: 'a@b.com', password: 'supersecret', displayName: 'x'.repeat(41) },
      {},
    ];
    for (const payload of cases) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
    const badJson = await app.inject({
      method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: '{bad',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.code).toBe('VALIDATION');
  });

  it('refresh rotates; old token revoked; reuse kills the session family', async () => {
    const u = await register(app);
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: u.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json();
    expect(Object.keys(t1).sort()).toEqual(['accessToken', 'refreshToken']);
    expect(t1.refreshToken).not.toBe(u.refreshToken);
    const me = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${t1.accessToken}` } });
    expect(me.statusCode).toBe(200);

    // old token no longer works
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: u.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    // ... and reuse revoked the newest one too
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: t1.refreshToken } });
    expect(r2.statusCode).toBe(401);
  });

  it('protected routes need a valid token', async () => {
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
    const r = await app.inject({ url: '/api/me', headers: { authorization: 'Bearer garbage' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
    const forged = app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', typ: 'access' });
    expect((await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${forged}` } })).statusCode).toBe(401);
    const expired = app.jwt.sign({ sub: '00000000-0000-0000-0000-000000000000', typ: 'access' }, { expiresIn: -10 } as any);
    expect((await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${expired}` } })).statusCode).toBe(401);
  });

  it('access token lasts 15 minutes', async () => {
    const u = await register(app);
    const decoded = app.jwt.decode<{ iat: number; exp: number }>(u.accessToken)!;
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  it('unknown api route -> 404 JSON', async () => {
    const r = await app.inject({ url: '/api/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });
});

describe('rate limit', () => {
  const login = (a: FastifyInstance, email: string, extra: Record<string, unknown> = {}) =>
    a.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'nopenope' }, ...extra });

  it('spoofed X-Forwarded-For does not bypass the login limit', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN: '5' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 8; i++) {
        // a client connecting directly from a public IP, sending a different spoofed XFF every time
        const r = await login(limited, 'victim@example.com', {
          remoteAddress: '203.0.113.50',
          headers: { 'x-forwarded-for': i % 2 ? `198.51.100.${i}` : `10.0.0.${i}, 198.51.100.${i}` },
        });
        codes.push(r.statusCode);
      }
      // Public peer is not a trusted proxy: the socket address is the client; XFF is ignored entirely.
      expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(codes.slice(5)).toEqual([429, 429, 429]);
      const last = await login(limited, 'victim@example.com', { remoteAddress: '203.0.113.50', headers: { 'x-forwarded-for': '198.51.100.77' } });
      expect(last.json()).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String) } });
      const ra = Number(last.headers['retry-after']);
      expect(ra).toBeGreaterThan(0);
      expect(ra).toBeLessThanOrEqual(15 * 60);
    } finally {
      await limited.close();
    }
  });

  it('behind one proxy hop: client = hop the proxy added; spoofed left entries ignored', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN: '3' });
    try {
      const viaProxy = (spoof: string, real: string) =>
        login(limited, 'victim@example.com', { remoteAddress: '100.64.0.1', headers: { 'x-forwarded-for': `${spoof}, ${real}` } });
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await viaProxy(`10.9.9.${i}`, '198.51.100.1')).statusCode);
      expect(codes).toEqual([401, 401, 401, 429, 429]);
      // a genuinely different client (different hop added by the proxy) has its own bucket
      expect((await viaProxy('10.9.9.9', '198.51.100.2')).statusCode).toBe(401);
    } finally {
      await limited.close();
    }
  });

  it('login limit is per IP + email: other users on the same IP are not locked out', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN: '3', RATE_LIMIT_LOGIN_PER_IP: '6' });
    try {
      for (let i = 0; i < 4; i++) await login(limited, 'Bad@Example.com');
      expect((await login(limited, 'bad@example.com')).statusCode).toBe(429); // case-insensitive key
      expect((await login(limited, 'someone-else@example.com')).statusCode).toBe(401);
      // ...but the per-IP cap still stops one IP from spraying many emails
      const r = await login(limited, 'third@example.com');
      expect(r.statusCode).toBe(429);
      expect(r.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('refresh and register have their own limits', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN: '1', RATE_LIMIT_LOGIN_PER_IP: '1', RATE_LIMIT_REGISTER: '2', RATE_LIMIT_REFRESH: '3' });
    try {
      const u = await register(limited);
      let token = u.refreshToken;
      // login limit exhausted...
      await login(limited, 'a@b.com');
      expect((await login(limited, 'a@b.com')).statusCode).toBe(429);
      // ...refresh still works, up to its own limit
      for (let i = 0; i < 3; i++) {
        const r = await limited.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: token } });
        expect(r.statusCode).toBe(200);
        token = r.json().refreshToken;
      }
      const rr = await limited.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: token } });
      expect(rr.statusCode).toBe(429);
      expect(rr.json().error.code).toBe('RATE_LIMITED');
      expect(Number(rr.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(rr.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);
      // register: 1 used above, 1 more allowed, then 429
      await register(limited);
      const r = await limited.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'z@z.com', password: 'supersecret', displayName: 'Zed' } });
      expect(r.statusCode).toBe(429);
      expect(r.json().error.code).toBe('RATE_LIMITED');
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);
    } finally {
      await limited.close();
    }
  });

  it('default limits: login 10, register 20, refresh 60, create 30', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x', JWT_SECRET: 'y'.repeat(40) });
    expect(c.rateLimits).toEqual({ login: 10, loginPerIp: 100, register: 20, refresh: 60, create: 30 });
  });
});

describe('auth schemas are strict', () => {
  it('unknown fields -> VALIDATION', async () => {
    const cases = [
      ['/api/auth/register', { email: 'strict@example.com', password: 'supersecret', displayName: 'Strict', isAdmin: true }],
      ['/api/auth/login', { email: 'strict@example.com', password: 'supersecret', extra: 1 }],
      ['/api/auth/refresh', { refreshToken: 'x'.repeat(20), userId: 'abc' }],
      ['/api/auth/logout', { refreshToken: 'x'.repeat(20), all: true }],
    ] as const;
    for (const [url, payload] of cases) {
      const r = await app.inject({ method: 'POST', url, payload });
      expect(r.statusCode, url).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
  });

  it('passwords are hashed with argon2id m=19456,t=2,p=1', async () => {
    const u = await register(app);
    const { rows } = await Function.prototype.call.call((app as any).db.$client.query, 
      (app as any).db.$client, 'select password_hash from users where id = $1', [u.user.id]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  });
});

describe('refresh token cleanup', () => {
  it('deletes tokens expired or revoked more than 30 days ago, keeps the rest', async () => {
    const u = await register(app);
    const pool = (app as any).db.$client;
    const day = 24 * 3600 * 1000;
    const ins = (exp: Date, rev: Date | null, h: string) =>
      pool.query('insert into refresh_tokens (user_id, token_hash, expires_at, revoked_at) values ($1,$2,$3,$4)', [u.user.id, h, exp, rev]);
    const now = Date.now();
    await ins(new Date(now - 31 * day), null, 'old-expired');
    await ins(new Date(now + 10 * day), new Date(now - 31 * day), 'old-revoked');
    await ins(new Date(now - 5 * day), null, 'recent-expired');
    await ins(new Date(now + 10 * day), new Date(now - 5 * day), 'recent-revoked');
    const { pruneRefreshTokens } = await import('../src/lib/tokens.js');
    expect(await pruneRefreshTokens((app as any).db)).toBe(2);
    const { rows } = await pool.query("select token_hash from refresh_tokens where token_hash in ('old-expired','old-revoked','recent-expired','recent-revoked') order by 1");
    expect(rows.map((r: any) => r.token_hash)).toEqual(['recent-expired', 'recent-revoked']);
    // the valid session still works
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: u.refreshToken } })).statusCode).toBe(200);
  });

  it('runs on startup', async () => {
    const pool = (app as any).db.$client;
    const u = await register(app);
    await pool.query('insert into refresh_tokens (user_id, token_hash, expires_at) values ($1,$2,$3)', [u.user.id, 'startup-old', new Date(Date.now() - 40 * 864e5)]);
    const second = await makeApp();
    await second.close();
    const { rows } = await pool.query("select 1 from refresh_tokens where token_hash = 'startup-old'");
    expect(rows.length).toBe(0);
  });
});

describe('config', () => {
  it('refuses to start in production without JWT_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET: 'y'.repeat(40) }).port).toBe(4000);
  });

  it('refuses placeholder secrets in production', async () => {
    const { DEV_JWT_SECRET } = await import('../src/config.js');
    for (const JWT_SECRET of [
      'change-me-to-a-long-random-string',
      'CHANGE-ME-please-this-is-long-enough-1234567',
      'xxxxxxxxxxxxxxxxxxxxchangemexxxxxxxxxxxxxxxx',
      DEV_JWT_SECRET,
    ]) {
      expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET }), JWT_SECRET).toThrow(/JWT_SECRET/);
    }
  });
});
