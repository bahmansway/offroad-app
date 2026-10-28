import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config.js';
import { createDb, type Db } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { pruneRefreshTokens } from './lib/tokens.js';
import { AppError, unauthorized } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { spotRoutes } from './routes/spots.js';
import { carRoutes } from './routes/cars.js';
import { otherRoutes } from './routes/other.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    /** preHandler: requires a valid access token. */
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    /** Set when a valid access token was sent (on any route). */
    userId: string | null;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; typ: 'access' };
    user: { sub: string; typ: 'access' };
  }
}

/** loopback, link-local, private (10/8, 172.16/12, 192.168/16, fc00::/7) and carrier-grade NAT. */
export const TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal', '100.64.0.0/10'];

export interface BuildOptions {
  migrate?: boolean;
}

export async function buildApp(config: AppConfig, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logger ? { level: config.production ? 'info' : 'debug' } : false,
    // Only trust X-Forwarded-For when the connection comes from a private-network proxy (Railway's edge
    // reaches the app over its private network). The client IP is then the right-most untrusted
    // X-Forwarded-For entry, i.e. the one the proxy appended; anything the client wrote is further left
    // and ignored. A client connecting directly from a public IP is never trusted, so it can't spoof its
    // IP to dodge per-IP rate limits. (`trustProxy: 1` is not used: in this Fastify version a hop count
    // means "trust nothing", which would put every user behind Railway into one rate-limit bucket.)
    trustProxy: TRUSTED_PROXIES,
    bodyLimit: 256 * 1024,
  });

  const { pool, db } = createDb(config.databaseUrl);
  app.decorate('db', db);
  app.decorate('config', config);
  app.addHook('onClose', async () => {
    await pool.end();
  });
  if (opts.migrate !== false) await runMigrations(db);
  await pruneRefreshTokens(db).catch((err) => app.log.warn({ err }, 'refresh token cleanup failed'));

  // ---- errors: always { error: { code, message } } ----
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      if (err.retryAfterSeconds !== undefined) reply.header('retry-after', String(err.retryAfterSeconds));
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const status: number = err.statusCode ?? 500;
    if (status === 429) {
      if (!reply.hasHeader('retry-after')) reply.header('retry-after', '60');
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } });
    }
    if (status === 401) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } });
    }
    if (status >= 400 && status < 500) {
      // Fastify-level errors: bad JSON, body too large, unsupported media type...
      return reply.status(status).send({ error: { code: 'VALIDATION', message: err.message || 'Bad request' } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  // ---- security plugins ----
  await app.register(helmet, {
    // The Expo web build uses inline scripts/styles and remote map tiles; keep CSP off for v1.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    origin: config.corsOrigin ?? false,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(rateLimit, { global: false });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '15m' } });

  // Optional auth on every request: invalid/expired tokens are only rejected on routes that require auth.
  app.decorateRequest('userId', null);
  app.addHook('onRequest', async (req) => {
    req.userId = null;
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return;
    try {
      const payload = await req.jwtVerify<{ sub: string; typ: string }>();
      if (payload.typ === 'access' && typeof payload.sub === 'string') req.userId = payload.sub;
    } catch {
      /* treated as anonymous; protected routes return 401 */
    }
  });
  app.decorate('authenticate', async (req: FastifyRequest) => {
    if (!req.userId) throw unauthorized();
  });

  // ---- API ----
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(spotRoutes);
      await api.register(carRoutes);
      await api.register(otherRoutes);
      api.setNotFoundHandler((_req, reply) => {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      });
    },
    { prefix: '/api' },
  );

  // ---- Expo web build (SPA) ----
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(config.webDist ?? path.resolve(here, '../../app/dist'));
  const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      index: ['index.html'],
      setHeaders(reply, filePath) {
        const rel = path.relative(webDist, filePath).split(path.sep).join('/');
        // Expo puts content-hashed bundles under _expo/static: safe to cache forever.
        if (rel.startsWith('_expo/static/')) reply.header('cache-control', 'public, max-age=31536000, immutable');
        else if (rel.endsWith('.html')) reply.header('cache-control', 'no-cache');
      },
    });
    // wildcard:false registers only files present at startup; everything else falls through here.
    app.get('/*', (req, reply) => {
      const p = req.url.split('?')[0];
      const lower = p.toLowerCase();
      if (lower === '/api' || lower.startsWith('/api/')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      // Missing asset files must 404, not get index.html: a stale tab asking for an old hashed chunk
      // would otherwise receive HTML as JavaScript and crash to a blank screen.
      const lastSegment = lower.replace(/\/+$/, '').split('/').pop() ?? '';
      if (lower.startsWith('/_expo/') || lower.startsWith('/assets/') || /\.[a-z0-9]{1,8}$/.test(lastSegment)) {
        return reply.status(404).header('cache-control', 'no-store').type('text/plain; charset=utf-8').send('Not found');
      }
      // Expo static export writes e.g. /explore.html for /explore
      const htmlFile = path.join(webDist, p.replace(/\/+$/, '') + '.html');
      if (p !== '/' && htmlFile.startsWith(webDist + path.sep) && fs.existsSync(htmlFile)) {
        return reply.header('cache-control', 'no-cache').sendFile(path.relative(webDist, htmlFile));
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  app.log.info({ webDist, hasWeb }, 'web build');

  return app;
}
