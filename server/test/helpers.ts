import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/offroad_test';

export async function resetDb() {
  const c = new pg.Client({ connectionString: TEST_DB_URL });
  await c.connect();
  await c.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await c.end();
}

export async function makeApp(extraEnv: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    RATE_LIMIT_LOGIN: '1000',
    RATE_LIMIT_LOGIN_PER_IP: '1000',
    RATE_LIMIT_REGISTER: '1000',
    RATE_LIMIT_REFRESH: '1000',
    RATE_LIMIT_CREATE: '1000',
    WEB_DIST: '/nonexistent',
    ...extraEnv,
  });
  return buildApp(config);
}

let n = 0;
export async function register(app: FastifyInstance, name = 'Tester') {
  n++;
  const email = `user${Date.now()}_${n}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'correct-horse-1', displayName: `${name} ${n}` },
  });
  if (res.statusCode !== 201) throw new Error('register failed: ' + res.body);
  const body = res.json();
  return { ...body, email, auth: { authorization: `Bearer ${body.accessToken}` } } as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string; displayName: string; createdAt: string };
    email: string;
    auth: { authorization: string };
  };
}
