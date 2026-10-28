import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { eq } from 'drizzle-orm';
import { conversationMembers } from '../db/schema.js';

export const convRoom = (id: string) => `conv:${id}`;
export const userRoom = (id: string) => `user:${id}`;

export interface Realtime {
  io: Server;
  /** Emit to everyone in a conversation room, except sockets of the given users (e.g. who blocked the sender). */
  toConversation(conversationId: string, event: string, payload: unknown, exceptUserIds?: string[]): void;
  toUser(userId: string, event: string, payload: unknown): void;
  /** Keep already-connected sockets in sync after membership changes. */
  addMember(userId: string, conversationId: string): void;
  removeMember(userId: string, conversationId: string): void;
}

/**
 * Socket.IO on the same HTTP server as Fastify (path /socket.io). Clients authenticate with the access
 * token: `io(url, { auth: { token } })` (or an `Authorization: Bearer` header). Each socket joins its
 * user room and one room per conversation it belongs to. The server only pushes; messages are sent via
 * REST (POST /api/conversations/:id/messages) so validation, blocks and rate limits live in one place.
 */
export function createRealtime(app: FastifyInstance): Realtime {
  const io = new Server(app.server, {
    path: '/socket.io',
    serveClient: false,
    // Same CORS rule as the API: same-origin web build and native apps need none.
    cors: app.config.corsOrigin ? { origin: app.config.corsOrigin, credentials: false } : undefined,
    maxHttpBufferSize: 16 * 1024, // clients don't send payloads; keep it small
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    try {
      const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      const header = socket.handshake.headers.authorization;
      const token =
        typeof fromAuth === 'string'
          ? fromAuth.replace(/^Bearer /, '')
          : typeof header === 'string' && header.startsWith('Bearer ')
            ? header.slice(7)
            : null;
      if (!token) return next(new Error('UNAUTHORIZED'));
      const payload = app.jwt.verify<{ sub: string; typ: string; exp?: number }>(token);
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') return next(new Error('UNAUTHORIZED'));
      socket.data.userId = payload.sub;
      socket.data.exp = payload.exp;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId: string = socket.data.userId;
    // Drop the socket when the access token expires; the client reconnects with a fresh token.
    if (typeof socket.data.exp === 'number') {
      const ms = socket.data.exp * 1000 - Date.now();
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, ms));
      timer.unref();
      socket.on('disconnect', () => clearTimeout(timer));
    }
    try {
      const rows = await app.db
        .select({ id: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(eq(conversationMembers.userId, userId));
      socket.join([userRoom(userId), ...rows.map((r) => convRoom(r.id))]);
      socket.emit('ready', { userId });
    } catch (err) {
      app.log.error({ err }, 'socket join failed');
      socket.disconnect(true);
    }
  });

  return {
    io,
    toConversation(conversationId, event, payload, exceptUserIds = []) {
      let target = io.to(convRoom(conversationId));
      if (exceptUserIds.length) target = target.except(exceptUserIds.map(userRoom));
      target.emit(event, payload);
    },
    toUser(userId, event, payload) {
      io.to(userRoom(userId)).emit(event, payload);
    },
    addMember(userId, conversationId) {
      io.in(userRoom(userId)).socketsJoin(convRoom(conversationId));
    },
    removeMember(userId, conversationId) {
      io.in(userRoom(userId)).socketsLeave(convRoom(conversationId));
    },
  };
}
