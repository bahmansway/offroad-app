export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  corsOrigin: string[] | null;
  production: boolean;
  webDist: string | null;
  rateLimits: {
    login: number; // per IP + email / 15 min
    loginPerIp: number; // per IP / 15 min (stops one IP trying many emails)
    register: number; // per IP / 15 min
    refresh: number; // per IP / 15 min
    create: number; // per user / hour, separately for: spots, cars, mods, clans; photo uploads (avatar, car, logo) share one counter
    messages: number; // per user / minute (chat)
    friendRequests: number; // per user / hour
    posts: number; // v6: posts created per user / 24 h
    postPhotos: number; // v6: post photo uploads per user / 24 h
  };
  logger: boolean;
  push: {
    /** Expo push service base URL (tests point this at a local mock). */
    apiUrl: string;
    /** Optional Expo access token ("enhanced security for push notifications"). Never logged. */
    accessToken: string | null;
    /** At most one message notification per chat per person in this window (ms). */
    coalesceMs: number;
    /** How long after sending the receipts are checked (ms). */
    receiptDelayMs: number;
  };
}

export const DEV_JWT_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? Math.trunc(n) : d;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    if (production) throw new Error('JWT_SECRET is required in production');
    jwtSecret = DEV_JWT_SECRET;
    console.warn('[config] JWT_SECRET not set - using an insecure development secret');
  } else if (production) {
    if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
    if (jwtSecret === DEV_JWT_SECRET || /change-?me/i.test(jwtSecret)) {
      throw new Error('JWT_SECRET is a placeholder - set a real random secret in production');
    }
  }

  const corsOrigin = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  return {
    databaseUrl,
    jwtSecret,
    port: Number(env.PORT) || 4000,
    corsOrigin,
    production,
    webDist: env.WEB_DIST ?? null,
    rateLimits: {
      login: num(env.RATE_LIMIT_LOGIN, 10),
      loginPerIp: num(env.RATE_LIMIT_LOGIN_PER_IP, 100),
      register: num(env.RATE_LIMIT_REGISTER, 20),
      refresh: num(env.RATE_LIMIT_REFRESH, 60),
      create: num(env.RATE_LIMIT_CREATE, 30),
      messages: num(env.RATE_LIMIT_MESSAGES, 30),
      friendRequests: num(env.RATE_LIMIT_FRIEND_REQUESTS, 30),
      posts: num(env.RATE_LIMIT_POSTS, 20),
      postPhotos: num(env.RATE_LIMIT_POST_PHOTOS, 60),
    },
    logger: env.NODE_ENV !== 'test',
    push: {
      apiUrl: (env.EXPO_PUSH_URL || 'https://exp.host').replace(/\/+$/, ''),
      accessToken: env.EXPO_ACCESS_TOKEN || null,
      coalesceMs: num(env.PUSH_COALESCE_MS, 30_000),
      receiptDelayMs: num(env.PUSH_RECEIPT_DELAY_MS, 15 * 60 * 1000),
    },
  };
}
