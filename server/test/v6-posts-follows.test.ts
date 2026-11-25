import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { makeApp, noisePng, register, resetDb, TEST_DB_URL } from './helpers.js';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { cleanupDrafts } from '../src/lib/posts.js';
import { imageStorageMb, USER_IMAGE_QUOTA_BYTES } from '../src/lib/images.js';
import { computeRanking } from '../src/lib/leaderboard.js';
import { removeDemo, DEMO_EMAIL_DOMAIN } from '../src/seedDemo.js';

type U = Awaited<ReturnType<typeof register>>;
type PushMsg = { to: string; title: string; body: string; data: Record<string, string> };

// ---------------- mocked Expo push service ----------------
const pushes: PushMsg[] = [];
const mockServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/--/api/v2/push/send') {
      const body = JSON.parse(raw) as PushMsg[];
      pushes.push(...body);
      return res.end(JSON.stringify({ data: body.map((_, i) => ({ status: 'ok', id: `t${Date.now()}-${i}` })) }));
    }
    res.end(JSON.stringify({ data: {} }));
  });
});

let app: FastifyInstance;
let sql: pg.Client;
const req = (method: string, url: string, user?: U, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: user?.auth, payload: payload as any });
const q = async (text: string, p: unknown[] = []) => (await sql.query(text, p)).rows;
const num = async (text: string, p: unknown[] = []) => Number(Object.values((await q(text, p))[0])[0]);

let tokenN = 0;
async function withToken(u: U) {
  const token = `ExponentPushToken[v6tok${++tokenN}abcdefgh]`;
  expect((await req('POST', '/api/me/push-tokens', u, { token, platform: 'ios', locale: 'en' })).statusCode).toBe(204);
  return token;
}
const pushesTo = (token: string) => pushes.filter((m) => m.to === token);

/** A JPEG with EXIF (incl. a GPS tag) that is bigger than 1440 px. */
async function exifJpeg(w = 2000, h = 1500, color = '#c05020') {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 70 })
    .withExif({ IFD0: { Copyright: 'secret-owner', Artist: 'Home address' }, IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } })
    .toBuffer();
}
let smallJpeg: Buffer;

const putPhoto = (u: U, postId: string, i: number, body = smallJpeg) =>
  app.inject({ method: 'PUT', url: `/api/posts/${postId}/photos/${i}`, headers: { ...u.auth, 'content-type': 'image/jpeg' }, payload: body });

async function makePost(u: U, body: Record<string, unknown> = {}, photos = 1) {
  const c = await req('POST', '/api/posts', u, body);
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id as string;
  for (let i = 0; i < photos; i++) expect((await putPhoto(u, id, i)).statusCode).toBe(200);
  const p = await req('POST', `/api/posts/${id}/publish`, u);
  expect(p.statusCode, p.body).toBe(200);
  return p.json();
}
const follow = (a: U, b: U) => req('POST', `/api/users/${b.user.id}/follow`, a);
const block = (a: U, b: U) => req('POST', `/api/users/${b.user.id}/block`, a);
const feedIds = async (u: U, limit = 50) => (await req('GET', `/api/feed?limit=${limit}`, u)).json().items.map((p: any) => p.id);

// ---------------- v5 database with data -> v6 migration ----------------
const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const OLD = { a: ID(1), b: ID(2), c: ID(3), d: ID(4), e: ID(5), f: ID(6) };

async function seedV5Database() {
  await resetDb();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.cpSync(MIGRATIONS_DIR, tmp, { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(tmp, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: any) => e.idx <= 6);
  fs.writeFileSync(path.join(tmp, 'meta/_journal.json'), JSON.stringify(journal));
  const pool = new pg.Pool({ connectionString: TEST_DB_URL });
  await migrate(drizzle(pool), { migrationsFolder: tmp });
  await pool.query(`
    insert into users (id, email, password_hash, display_name) values
      ('${OLD.a}', 'olda@example.com', 'x', 'Old A'), ('${OLD.b}', 'oldb@example.com', 'x', 'Old B'),
      ('${OLD.c}', 'oldc@example.com', 'x', 'Old C'), ('${OLD.d}', 'oldd@example.com', 'x', 'Old D'),
      ('${OLD.e}', 'olde@example.com', 'x', 'Old E'), ('${OLD.f}', 'oldf@example.com', 'x', 'Old F');
    -- A and B are friends
    insert into friendships (user_id, friend_id, created_at) values
      ('${OLD.a}', '${OLD.b}', '2026-10-01T10:00:00.123456Z'), ('${OLD.b}', '${OLD.a}', '2026-10-01T10:00:00.123456Z');
    -- C asked A (pending), D asked A (declined), E asked F but F blocked E
    insert into friend_requests (from_id, to_id) values ('${OLD.c}', '${OLD.a}');
    insert into friend_requests (from_id, to_id, declined_at) values ('${OLD.d}', '${OLD.a}', now());
    insert into friend_requests (from_id, to_id) values ('${OLD.e}', '${OLD.f}');
    insert into blocks (blocker_id, blocked_id) values ('${OLD.f}', '${OLD.e}');
    insert into notification_settings (user_id, messages) values ('${OLD.a}', false);
    insert into images (owner_id, kind, width, height, bytes, data) values ('${OLD.a}', 'avatar', 1, 1, 1, '\\x00');
  `);
  await pool.end();
  fs.rmSync(tmp, { recursive: true, force: true });
}

beforeAll(async () => {
  await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', () => r()));
  const mockUrl = `http://127.0.0.1:${(mockServer.address() as { port: number }).port}`;
  await seedV5Database();
  app = await makeApp({ EXPO_PUSH_URL: mockUrl, PUSH_RECEIPT_DELAY_MS: '3600000' });
  sql = new pg.Client({ connectionString: TEST_DB_URL });
  await sql.connect();
  smallJpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).jpeg().toBuffer();
});
afterAll(async () => {
  await app?.close();
  await sql?.end();
  await new Promise((r) => mockServer.close(r));
});
beforeEach(() => {
  pushes.length = 0;
});

describe('v6 migration on a v5 database with data', () => {
  it('friends -> mutual follows, pending requests -> one-way follow, declined / blocked skipped', async () => {
    const rows = await q(`select follower_id, followee_id from follows order by follower_id, followee_id`);
    expect(rows).toEqual([
      { follower_id: OLD.a, followee_id: OLD.b },
      { follower_id: OLD.b, followee_id: OLD.a },
      { follower_id: OLD.c, followee_id: OLD.a },
    ]);
    // created_at kept, cut to milliseconds (cursors compare exactly)
    const [f] = await q(`select created_at from follows where follower_id = $1`, [OLD.a]);
    expect(new Date(f.created_at).toISOString()).toBe('2026-10-01T10:00:00.123Z');
    // everyone existing is "seen" now: migrated follows are not new-follower badges
    expect(await num(`select count(*) from followers_seen`)).toBe(6);
    // old data and settings intact; new columns have their defaults
    expect(await q(`select messages, social from notification_settings where user_id = $1`, [OLD.a])).toEqual([{ messages: false, social: true }]);
    expect(await q(`select kind, post_id from images where owner_id = $1`, [OLD.a])).toEqual([{ kind: 'avatar', post_id: null }]);
    expect(await num(`select count(*) from friendships`)).toBe(2);
    expect(await num(`select count(*) from friend_requests`)).toBe(3);
  });

  it('the data step is idempotent (running it again changes nothing)', async () => {
    const file = fs.readFileSync(path.join(MIGRATIONS_DIR, '0007_v6_posts_follows.sql'), 'utf8');
    const dataPart = file.slice(file.indexOf('-- v6 data'));
    for (const stmt of dataPart.split('--> statement-breakpoint')) await sql.query(stmt);
    expect(await num(`select count(*) from follows`)).toBe(3);
    expect(await num(`select count(*) from followers_seen`)).toBe(6);
  });

  it('migrated users see the right follow fields; groups accept the migrated friends', async () => {
    const u = (await req('GET', `/api/users/${OLD.a}`)).json();
    expect(u).toMatchObject({ followerCount: 2, followingCount: 1, postCount: 0, isFollowing: false, followsMe: false });
    // A can make a group with B (mutual follow) but not with C (C follows A only)
    const tokenA = app.jwt.sign({ sub: OLD.a, typ: 'access' });
    const auth = { authorization: `Bearer ${tokenA}` };
    let r = await app.inject({ method: 'POST', url: '/api/conversations/group', headers: auth, payload: { name: 'Old', userIds: [OLD.b] } });
    expect(r.statusCode, r.body).toBe(201);
    r = await app.inject({ method: 'POST', url: '/api/conversations/group', headers: auth, payload: { name: 'Old2', userIds: [OLD.c] } });
    expect(r.statusCode).toBe(403);
  });
});

describe('posts: create, photos, publish (acceptance 1)', () => {
  let author: U, fan: U, stranger: U;
  let carId: string, spotId: string, postId: string;

  beforeAll(async () => {
    author = await register(app, 'Author');
    fan = await register(app, 'Fan');
    stranger = await register(app, 'Stranger');
    carId = (await req('POST', '/api/cars', author, { make: 'Toyota', model: 'Land Cruiser', year: 2015 })).json().id;
    spotId = (await req('POST', '/api/spots', stranger, { type: 'trail', name: 'Xızı yolu', lat: 40.9, lng: 49.07, difficulty: 3 })).json().id;
    expect((await follow(fan, author)).statusCode).toBe(200);
  });

  it('validates create: own car only, existing spot, caption length, strict body', async () => {
    const strangerCar = (await req('POST', '/api/cars', stranger, { make: 'UAZ', model: 'Patriot', year: 2019 })).json().id;
    expect((await req('POST', '/api/posts', undefined, {})).statusCode).toBe(401);
    expect((await req('POST', '/api/posts', author, { carId: strangerCar })).statusCode).toBe(403);
    expect((await req('POST', '/api/posts', author, { spotId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    expect((await req('POST', '/api/posts', author, { caption: 'x'.repeat(1001) })).statusCode).toBe(400);
    expect((await req('POST', '/api/posts', author, { caption: 'ok', extra: 1 })).statusCode).toBe(400);
  });

  it('3 photos + car + spot; EXIF/GPS stripped, max 1440 px, order kept', async () => {
    const c = await req('POST', '/api/posts', author, { caption: '  Xızıda gözəl gün  ', carId, spotId });
    expect(c.statusCode).toBe(201);
    const draft = c.json();
    postId = draft.id;
    expect(draft).toMatchObject({ status: 'draft', photos: [], caption: 'Xızıda gözəl gün', likeCount: 0, commentCount: 0 });
    // drafts are invisible to others
    expect((await req('GET', `/api/posts/${postId}`, fan)).statusCode).toBe(404);
    expect((await req('GET', `/api/posts/${postId}`)).statusCode).toBe(404);
    // can't publish without photos
    expect((await req('POST', `/api/posts/${postId}/publish`, author)).statusCode).toBe(409);
    // only the author uploads; slot 0..5
    expect((await putPhoto(fan, postId, 0)).statusCode).toBe(404);
    expect((await putPhoto(author, postId, 6)).statusCode).toBe(400);
    const big = await exifJpeg(2000, 1500, '#ff0000');
    expect((await sharp(big).metadata()).exif).toBeDefined();
    for (const [i, color] of [[0, '#ff0000'], [2, '#0000ff'], [1, '#00ff00']] as const) {
      const r = await putPhoto(author, postId, i, i === 0 ? big : await exifJpeg(1600, 1200, color));
      expect(r.statusCode, r.body).toBe(200);
    }
    // replacing a slot keeps only the new image
    expect((await putPhoto(author, postId, 2, await exifJpeg(1500, 1500, '#0000ff'))).statusCode).toBe(200);
    expect(await num(`select count(*) from images where post_id = $1`, [postId])).toBe(3);
    const pub = await req('POST', `/api/posts/${postId}/publish`, author);
    expect(pub.statusCode).toBe(200);
    const p = pub.json();
    expect(p.status).toBe('published');
    expect(p.photos).toHaveLength(3);
    expect(p.car).toMatchObject({ id: carId, make: 'Toyota', model: 'Land Cruiser', year: 2015 });
    expect(p.spot).toMatchObject({ id: spotId, name: 'Xızı yolu', type: 'trail', difficulty: 3 });
    expect(p.author).toMatchObject({ id: author.user.id, displayName: author.user.displayName, clan: null });
    expect(p.photos[0]).toEqual({ url: expect.stringMatching(/^\/api\/images\//), width: 1440, height: 1080 });
    expect(p.photos[2]).toMatchObject({ width: 1440, height: 1440 });
    // colours prove the order: slot 0 red, 1 green, 2 blue
    const colours = [];
    for (const ph of p.photos) {
      const img = await app.inject({ url: ph.url });
      expect(img.headers['content-type']).toBe('image/jpeg');
      const meta = await sharp(img.rawPayload).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(img.rawPayload.includes(Buffer.from('secret-owner'))).toBe(false);
      const { dominant } = await sharp(img.rawPayload).stats();
      colours.push([dominant.r > 200, dominant.g > 200, dominant.b > 200]);
    }
    expect(colours).toEqual([[true, false, false], [false, true, false], [false, false, true]]);
    // published: photos are fixed, publish again is harmless
    expect((await putPhoto(author, postId, 3)).statusCode).toBe(409);
    expect((await req('DELETE', `/api/posts/${postId}/photos/0`, author)).statusCode).toBe(409);
    expect((await req('POST', `/api/posts/${postId}/publish`, author)).json().createdAt).toBe(p.createdAt);
  });

  it("appears in followers' feed, the profile grid, the spot and car pages", async () => {
    expect(await feedIds(fan)).toContain(postId);
    expect((await req('GET', '/api/feed', fan)).json().items.find((x: any) => x.id === postId).suggested).toBe(false);
    expect(await feedIds(author)).toContain(postId); // my own
    expect((await req('GET', `/api/users/${author.user.id}/posts`)).json().items.map((x: any) => x.id)).toEqual([postId]);
    expect((await req('GET', `/api/spots/${spotId}/posts`)).json().items.map((x: any) => x.id)).toEqual([postId]);
    expect((await req('GET', `/api/cars/${carId}/posts`)).json().items.map((x: any) => x.id)).toEqual([postId]);
    expect((await req('GET', `/api/users/${author.user.id}`)).json().postCount).toBe(1);
    expect((await req('GET', '/api/feed')).statusCode).toBe(401);
  });

  it('edit caption / car / spot (author only), editedAt set', async () => {
    expect((await req('PATCH', `/api/posts/${postId}`, fan, { caption: 'hack' })).statusCode).toBe(403);
    let r = await req('PATCH', `/api/posts/${postId}`, author, { caption: 'Yeni', spotId: null, carId: null });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ caption: 'Yeni', spot: null, car: null, editedAt: expect.any(String) });
    expect((await req('GET', `/api/spots/${spotId}/posts`)).json().items).toEqual([]);
    r = await req('PATCH', `/api/posts/${postId}`, author, { spotId, carId });
    expect(r.json().spot.id).toBe(spotId);
    expect((await req('PATCH', `/api/posts/${postId}`, author, { carId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
  });

  it('drafts older than 24 h are cleaned up with their photos', async () => {
    const d = (await req('POST', '/api/posts', author, {})).json().id;
    expect((await putPhoto(author, d, 0)).statusCode).toBe(200);
    const fresh = (await req('POST', '/api/posts', author, {})).json().id;
    await sql.query(`update posts set created_at = now() - interval '25 hours' where id = $1`, [d]);
    expect(await cleanupDrafts(app.db)).toBe(1);
    expect(await num(`select count(*) from posts where id = $1`, [d])).toBe(0);
    expect(await num(`select count(*) from images where post_id = $1`, [d])).toBe(0);
    expect(await num(`select count(*) from posts where id = $1`, [fresh])).toBe(1);
    expect(await num(`select count(*) from posts where id = $1`, [postId])).toBe(1); // published never
  });

  it('delete: author only, photos go with it', async () => {
    const p = await makePost(author, {}, 2);
    expect((await req('DELETE', `/api/posts/${p.id}`, fan)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/posts/${p.id}`, author)).statusCode).toBe(204);
    expect((await req('GET', `/api/posts/${p.id}`, author)).statusCode).toBe(404);
    expect(await num(`select count(*) from images where post_id = $1`, [p.id])).toBe(0);
  });
});

describe('likes, comments, saves, push (acceptance 2)', () => {
  let a: U, b: U, c: U, post: any, ta: string;
  beforeAll(async () => {
    a = await register(app, 'Ayan');
    b = await register(app, 'Bəxtiyar');
    c = await register(app, 'Cavid');
    ta = await withToken(a);
    post = await makePost(a, { caption: 'Hello' });
  });

  it('like / unlike, counts, push coalesced to 1 per post per hour', async () => {
    let r = await req('POST', `/api/posts/${post.id}/like`, b);
    expect(r.json()).toEqual({ likeCount: 1, likedByMe: true });
    expect((await req('POST', `/api/posts/${post.id}/like`, b)).json()).toEqual({ likeCount: 1, likedByMe: true }); // idempotent
    expect((await req('POST', `/api/posts/${post.id}/like`, c)).json().likeCount).toBe(2);
    await req('DELETE', `/api/posts/${post.id}/like`, b);
    await req('POST', `/api/posts/${post.id}/like`, b);
    await app.push.idle();
    const likes = pushesTo(ta).filter((m) => m.data.type === 'post_like');
    expect(likes).toHaveLength(1);
    expect(likes[0]).toMatchObject({ title: 'New like', body: `${b.user.displayName} liked your post`, data: { type: 'post_like', postId: post.id } });
    // liking my own post: no push
    pushes.length = 0;
    await req('POST', `/api/posts/${post.id}/like`, a);
    await app.push.idle();
    expect(pushesTo(ta)).toHaveLength(0);
    const g = (await req('GET', `/api/posts/${post.id}`, a)).json();
    expect(g).toMatchObject({ likeCount: 3, likedByMe: true });
    expect((await req('GET', `/api/posts/${post.id}`)).json().likedByMe).toBe(false);
    const likers = (await req('GET', `/api/posts/${post.id}/likes`, a)).json().items;
    expect(likers.map((l: any) => l.user.id).sort()).toEqual([a.user.id, b.user.id, c.user.id].sort());
  });

  it('comments: add, list oldest first, delete by comment author or post author; push', async () => {
    const r1 = await req('POST', `/api/posts/${post.id}/comments`, b, { text: '  Super!  ' });
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ text: 'Super!', author: { id: b.user.id }, canDelete: true });
    const r2 = await req('POST', `/api/posts/${post.id}/comments`, c, { text: 'Harada?' });
    expect((await req('POST', `/api/posts/${post.id}/comments`, c, { text: '' })).statusCode).toBe(400);
    expect((await req('POST', `/api/posts/${post.id}/comments`, c, { text: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await req('POST', `/api/posts/${post.id}/comments`, undefined, { text: 'anon' })).statusCode).toBe(401);
    await app.push.idle();
    const cm = pushesTo(ta).filter((m) => m.data.type === 'post_comment');
    expect(cm).toHaveLength(2);
    expect(cm[0]).toMatchObject({ title: 'New comment', body: `${b.user.displayName}: Super!`, data: { postId: post.id, commentId: r1.json().id } });
    const list = (await req('GET', `/api/posts/${post.id}/comments`, c)).json();
    expect(list.items.map((x: any) => x.text)).toEqual(['Super!', 'Harada?']);
    expect(list.items.map((x: any) => x.canDelete)).toEqual([false, true]);
    expect((await req('GET', `/api/posts/${post.id}`)).json().commentCount).toBe(2);
    expect((await req('DELETE', `/api/comments/${r1.json().id}`, c)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/comments/${r2.json().id}`, a)).statusCode).toBe(204); // post author
    expect((await req('DELETE', `/api/comments/${r1.json().id}`, b)).statusCode).toBe(204); // comment author
    expect((await req('DELETE', `/api/comments/${r1.json().id}`, b)).statusCode).toBe(404);
    expect((await req('GET', `/api/posts/${post.id}`)).json().commentCount).toBe(0);
  });

  it('save / unsave; saved list newest saved first', async () => {
    const p2 = await makePost(c, { caption: 'two' });
    expect((await req('POST', `/api/posts/${post.id}/save`, b)).json()).toEqual({ savedByMe: true });
    expect((await req('POST', `/api/posts/${p2.id}/save`, b)).json()).toEqual({ savedByMe: true });
    let saved = (await req('GET', '/api/me/saved', b)).json();
    expect(saved.items.map((x: any) => x.id)).toEqual([p2.id, post.id]);
    expect(saved.items[0].savedByMe).toBe(true);
    expect((await req('DELETE', `/api/posts/${p2.id}/save`, b)).json()).toEqual({ savedByMe: false });
    saved = (await req('GET', '/api/me/saved', b)).json();
    expect(saved.items.map((x: any) => x.id)).toEqual([post.id]);
    expect((await req('GET', '/api/me/saved')).statusCode).toBe(401);
  });

  it('follow push; social setting off stops like/comment/follow pushes', async () => {
    await follow(b, a);
    await app.push.idle();
    const f = pushesTo(ta).filter((m) => m.data.type === 'follow');
    expect(f).toEqual([expect.objectContaining({ title: 'New follower', body: `${b.user.displayName} started following you`, data: { type: 'follow', userId: b.user.id } })]);
    // unfollow + follow again within the hour: no second push
    await req('DELETE', `/api/users/${a.user.id}/follow`, b);
    await follow(b, a);
    await app.push.idle();
    expect(pushesTo(ta).filter((m) => m.data.type === 'follow')).toHaveLength(1);
    pushes.length = 0;
    expect((await req('PATCH', '/api/me/notification-settings', a, { social: false })).json().social).toBe(false);
    const d = await register(app, 'Dəniz');
    await follow(d, a);
    await req('POST', `/api/posts/${post.id}/comments`, d, { text: 'hi' });
    const p3 = await makePost(a);
    await req('POST', `/api/posts/${p3.id}/like`, d);
    await app.push.idle();
    expect(pushesTo(ta)).toHaveLength(0);
    await req('PATCH', '/api/me/notification-settings', a, { social: true });
  });

  it('activity: likes, comments, new followers; newest first; paged', async () => {
    const act = (await req('GET', '/api/me/activity', a)).json();
    const types = act.items.map((i: any) => i.type);
    expect(types).toContain('like');
    expect(types).toContain('comment');
    expect(types).toContain('follow');
    expect(act.items.every((i: any) => i.actor.id !== a.user.id)).toBe(true); // never my own actions
    const like = act.items.find((i: any) => i.type === 'like');
    expect(like.post).toEqual({ id: expect.any(String), photoUrl: expect.stringMatching(/^\/api\/images\//) });
    const times = act.items.map((i: any) => i.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    // pages of 2 give the same items
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const page: any = (await req('GET', `/api/me/activity?limit=2${cursor ? `&cursor=${cursor}` : ''}`, a)).json();
      all.push(...page.items.map((i: any) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(all).toEqual(act.items.map((i: any) => i.id));
    expect((await req('GET', '/api/me/activity?cursor=garbage', a)).statusCode).toBe(400);
  });

  it('reports accept post and comment', async () => {
    const cm = (await req('POST', `/api/posts/${post.id}/comments`, b, { text: 'spam' })).json();
    let r = await req('POST', '/api/reports', c, { targetType: 'post', targetId: post.id, reason: 'bad' });
    expect(r.statusCode).toBe(201);
    r = await req('POST', '/api/reports', c, { targetType: 'comment', targetId: cm.id, reason: 'spam' });
    expect(r.statusCode).toBe(201);
    r = await req('POST', '/api/reports', c, { targetType: 'post', targetId: '00000000-0000-4000-8000-000000000000', reason: 'x' });
    expect(r.statusCode).toBe(404);
    const draft = (await req('POST', '/api/posts', a, {})).json().id;
    expect((await req('POST', '/api/reports', c, { targetType: 'post', targetId: draft, reason: 'x' })).statusCode).toBe(404);
  });
});

describe('blocks hide everything both ways', () => {
  let author: U, blocker: U, blockedFan: U, viewer: U;
  let post: any, comment: any;
  beforeAll(async () => {
    author = await register(app, 'Owner');
    blocker = await register(app, 'Blocker'); // will block the author
    blockedFan = await register(app, 'BlockedFan'); // the author will block them
    viewer = await register(app, 'Viewer');
    for (const u of [blocker, blockedFan, viewer]) await follow(u, author);
    await follow(author, blockedFan);
    post = await makePost(author, { caption: 'blocks' });
    await req('POST', `/api/posts/${post.id}/like`, blockedFan);
    comment = (await req('POST', `/api/posts/${post.id}/comments`, blockedFan, { text: 'before block' })).json();
    await req('POST', `/api/posts/${post.id}/like`, viewer);
    await req('POST', `/api/posts/${post.id}/save`, blocker);
    expect((await block(blocker, author)).statusCode).toBe(204);
    expect((await block(author, blockedFan)).statusCode).toBe(204);
  });

  it('blocks remove follows both ways and prevent following', async () => {
    expect(await num(`select count(*) from follows where (follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)`, [author.user.id, blockedFan.user.id])).toBe(0);
    expect(await num(`select count(*) from follows where follower_id = $1 and followee_id = $2`, [blocker.user.id, author.user.id])).toBe(0);
    expect((await follow(blocker, author)).statusCode).toBe(403);
    expect((await follow(author, blocker)).statusCode).toBe(403);
    expect((await follow(blockedFan, author)).statusCode).toBe(403);
  });

  it('feed, lists, post page: hidden for both sides', async () => {
    for (const u of [blocker, blockedFan]) {
      expect(await feedIds(u)).not.toContain(post.id);
      expect((await req('GET', `/api/users/${author.user.id}/posts`, u)).json().items).toEqual([]);
      expect((await req('GET', `/api/posts/${post.id}`, u)).statusCode).toBe(404);
      expect((await req('GET', `/api/posts/${post.id}/comments`, u)).statusCode).toBe(404);
      expect((await req('GET', `/api/posts/${post.id}/likes`, u)).statusCode).toBe(404);
      expect((await req('GET', `/api/users/${author.user.id}/followers`, u)).json().items).toEqual([]);
    }
    expect((await req('GET', '/api/me/saved', blocker)).json().items).toEqual([]);
    // and the other way: the author doesn't see their posts either
    const bp = await makePost(blocker);
    expect(await feedIds(author)).not.toContain(bp.id);
    expect((await req('GET', `/api/posts/${bp.id}`, author)).statusCode).toBe(404);
    // a third person still sees everything
    expect((await req('GET', `/api/posts/${post.id}`, viewer)).statusCode).toBe(200);
  });

  it('likes and comments: blocked people can not act, and their old likes / comments are hidden', async () => {
    for (const u of [blocker, blockedFan]) {
      expect((await req('POST', `/api/posts/${post.id}/like`, u)).statusCode).toBe(404);
      expect((await req('POST', `/api/posts/${post.id}/comments`, u, { text: 'x' })).statusCode).toBe(404);
      expect((await req('POST', `/api/posts/${post.id}/save`, u)).statusCode).toBe(404);
    }
    // the author: blockedFan's like and comment are gone from counts, lists and activity
    const asAuthor = (await req('GET', `/api/posts/${post.id}`, author)).json();
    expect(asAuthor).toMatchObject({ likeCount: 1, commentCount: 0 });
    expect((await req('GET', `/api/posts/${post.id}/comments`, author)).json().items).toEqual([]);
    expect((await req('GET', `/api/posts/${post.id}/likes`, author)).json().items.map((l: any) => l.user.id)).toEqual([viewer.user.id]);
    const act = (await req('GET', '/api/me/activity', author)).json().items;
    expect(act.some((i: any) => [blocker.user.id, blockedFan.user.id].includes(i.actor.id))).toBe(false);
    // a viewer with no blocks still sees blockedFan's like + comment
    const asViewer = (await req('GET', `/api/posts/${post.id}`, viewer)).json();
    expect(asViewer).toMatchObject({ likeCount: 2, commentCount: 1 });
    // viewer blocks the commenter: hidden only for the viewer
    await block(viewer, blockedFan);
    expect((await req('GET', `/api/posts/${post.id}/comments`, viewer)).json().items).toEqual([]);
    expect((await req('GET', `/api/posts/${post.id}`, viewer)).json()).toMatchObject({ likeCount: 1, commentCount: 0 });
    expect((await req('POST', '/api/reports', viewer, { targetType: 'comment', targetId: comment.id, reason: 'x' })).statusCode).toBe(404);
  });

  it('search leaves blocked people out', async () => {
    const r = (await req('GET', `/api/search?q=${encodeURIComponent('Owner')}`, blocker)).json();
    expect(r.users.map((u: any) => u.id)).not.toContain(author.user.id);
  });
});

describe('follow system (acceptance 3)', () => {
  it('follow / unfollow, counts on PublicUser, lists with search and flags; badge', async () => {
    const a = await register(app, 'Fərid');
    const b = await register(app, 'Gülnar');
    const c = await register(app, 'Gülşən');
    expect((await follow(a, a)).statusCode).toBe(400);
    expect((await req('POST', `/api/users/00000000-0000-4000-8000-000000000000/follow`, a)).statusCode).toBe(404);
    expect((await req('POST', `/api/users/${b.user.id}/follow`)).statusCode).toBe(401);
    let r = await follow(a, b);
    expect(r.json()).toEqual({ isFollowing: true, followsMe: false, followerCount: 1, followingCount: 0 });
    expect((await follow(a, b)).json().followerCount).toBe(1); // idempotent
    await follow(b, a);
    await follow(c, b);
    let pu = (await req('GET', `/api/users/${b.user.id}`, a)).json();
    expect(pu).toMatchObject({ followerCount: 2, followingCount: 1, postCount: 0, isFollowing: true, followsMe: true });
    expect((await req('GET', `/api/users/${b.user.id}`)).json()).toMatchObject({ isFollowing: false, followsMe: false });
    const followers = (await req('GET', `/api/users/${b.user.id}/followers`, a)).json();
    expect(followers.items.map((i: any) => i.user.id)).toEqual([c.user.id, a.user.id]); // newest first
    expect(followers.items[1]).toMatchObject({ isMe: true });
    expect(followers.items[0]).toMatchObject({ isFollowing: false, followsMe: false });
    const searched = (await req('GET', `/api/users/${b.user.id}/followers?q=${encodeURIComponent('gülş')}`, a)).json();
    expect(searched.items.map((i: any) => i.user.id)).toEqual([c.user.id]);
    expect((await req('GET', `/api/users/${b.user.id}/following`)).json().items.map((i: any) => i.user.id)).toEqual([a.user.id]);
    // badge: new followers since last viewed
    expect((await req('GET', '/api/me/badges', b)).json().newFollowers).toBe(2);
    expect((await req('POST', '/api/me/followers/seen', b)).statusCode).toBe(204);
    expect((await req('GET', '/api/me/badges', b)).json().newFollowers).toBe(0);
    r = await req('DELETE', `/api/users/${b.user.id}/follow`, a);
    expect(r.json()).toEqual({ isFollowing: false, followsMe: true, followerCount: 1, followingCount: 1 });
    pu = (await req('GET', `/api/users/${b.user.id}`, a)).json();
    expect(pu.followerCount).toBe(1);
  });

  it('group adds need a mutual follow; search shows people I follow first', async () => {
    const me = await register(app, 'Zaur');
    const mutual = await register(app, 'Zəfər Mutual');
    const oneWay = await register(app, 'Zəfər OneWay');
    const fan = await register(app, 'Zəfər Fan');
    await follow(me, mutual);
    await follow(mutual, me);
    await follow(me, oneWay);
    await follow(fan, me);
    let g = await req('POST', '/api/conversations/group', me, { name: 'G', userIds: [oneWay.user.id] });
    expect(g.statusCode).toBe(403);
    g = await req('POST', '/api/conversations/group', me, { name: 'G', userIds: [fan.user.id] });
    expect(g.statusCode).toBe(403);
    g = await req('POST', '/api/conversations/group', me, { name: 'G', userIds: [mutual.user.id] });
    expect(g.statusCode).toBe(201);
    const add = await req('POST', `/api/conversations/${g.json().id}/members`, me, { userIds: [oneWay.user.id] });
    expect(add.statusCode).toBe(403);
    const s = (await req('GET', `/api/search?q=${encodeURIComponent('Zəfər')}`, me)).json().users;
    expect(s.slice(0, 2).map((u: any) => u.id).sort()).toEqual([mutual.user.id, oneWay.user.id].sort());
    expect(s[2].id).toBe(fan.user.id);
    expect(s.find((u: any) => u.id === mutual.user.id)).toMatchObject({ isFollowing: true, isFriend: true });
    expect(s.find((u: any) => u.id === oneWay.user.id)).toMatchObject({ isFollowing: true, isFriend: false });
  });

  it('old friends endpoints still work and stay in sync with follows', async () => {
    const a = await register(app, 'OldApp');
    const b = await register(app, 'OldApp');
    const fr = (await req('POST', '/api/friends/requests', a, { userId: b.user.id })).json();
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json()).toMatchObject({ friendship: 'outgoing', isFollowing: true, followsMe: false });
    expect((await req('POST', `/api/friends/requests/${fr.request.id}/accept`, b)).statusCode).toBe(200);
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json()).toMatchObject({ friendship: 'friends', isFollowing: true, followsMe: true });
    expect((await req('GET', '/api/friends', a)).json().items.map((i: any) => i.user.id)).toEqual([b.user.id]);
    expect((await req('DELETE', `/api/friends/${b.user.id}`, a)).statusCode).toBe(204);
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json()).toMatchObject({ friendship: 'none', isFollowing: false, followsMe: false });
    // cancelling a request also takes back its follow
    const fr2 = (await req('POST', '/api/friends/requests', a, { userId: b.user.id })).json();
    expect((await req('DELETE', `/api/friends/requests/${fr2.request.id}`, a)).statusCode).toBe(204);
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json().isFollowing).toBe(false);
  });
});

describe('feed: suggested fallback and stable cursor pagination', () => {
  it('following < 3 people: own + followed first, then suggested (flagged); none when following 3+', async () => {
    const newbie = await register(app, 'Newbie');
    const friend = await register(app, 'Friend');
    const fp = await makePost(friend);
    const mine = await makePost(newbie);
    await follow(newbie, friend);
    const items = (await req('GET', '/api/feed?limit=50', newbie)).json().items;
    expect(items.slice(0, 2).map((p: any) => p.id)).toEqual([mine.id, fp.id]);
    expect(items.slice(0, 2).every((p: any) => p.suggested === false)).toBe(true);
    expect(items.length).toBeGreaterThan(2);
    expect(items.slice(2).every((p: any) => p.suggested === true)).toBe(true);
    // paging across the switch gives the same list, no duplicates
    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page: any = (await req('GET', `/api/feed?limit=3${cursor ? `&cursor=${cursor}` : ''}`, newbie)).json();
      paged.push(...page.items.map((p: any) => p.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(paged).toEqual(items.map((p: any) => p.id));
    // following 3 people: only their posts + mine
    for (let i = 0; i < 2; i++) await follow(newbie, await register(app, 'Quiet'));
    const after = (await req('GET', '/api/feed?limit=50', newbie)).json();
    expect(after.items.map((p: any) => p.id)).toEqual([mine.id, fp.id]);
    expect(after.nextCursor).toBeNull();
  });

  it('pages are stable even when many posts share a timestamp and new posts arrive mid-way', async () => {
    const poster = await register(app, 'Poster');
    const reader = await register(app, 'Reader');
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await makePost(poster)).id);
    // half of them at exactly the same millisecond
    await sql.query(`update posts set created_at = '2026-11-20T08:00:00.000Z' where id = any($1::uuid[])`, [ids.slice(0, 6)]);
    const expected = (await req('GET', `/api/users/${poster.user.id}/posts?limit=50`, reader)).json().items.map((p: any) => p.id);
    expect(expected).toHaveLength(12);
    const seen: string[] = [];
    let cursor: string | null = null;
    let n = 0;
    do {
      const page: any = (await req('GET', `/api/users/${poster.user.id}/posts?limit=5${cursor ? `&cursor=${cursor}` : ''}`, reader)).json();
      seen.push(...page.items.map((p: any) => p.id));
      cursor = page.nextCursor;
      if (n++ === 0) await makePost(poster); // newer post while scrolling: does not shift the pages
    } while (cursor);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(12);
    expect((await req('GET', `/api/users/${poster.user.id}/posts?cursor=bm9wZQ`, reader)).statusCode).toBe(400);
    expect((await req('GET', `/api/users/${poster.user.id}/posts?limit=51`, reader)).statusCode).toBe(400);
  });

  it('the feed uses the posts indexes (no sequential scan of posts)', async () => {
    const u = await register(app, 'Plan');
    await sql.query('set enable_seqscan = off');
    const plan = (await q(`explain select p.id from posts p where p.published_at is not null and p.author_id = $1 order by p.created_at desc, p.id desc limit 21`, [u.user.id]))
      .map((r) => r['QUERY PLAN'])
      .join('\n');
    await sql.query('set enable_seqscan = on');
    expect(plan).toMatch(/posts_author_created_idx|posts_published_created_idx/);
  });
});

describe('storage quota, rate limits, leaderboard', () => {
  it('post photos count toward the 50 MB quota', async () => {
    const u = await register(app, 'Quota');
    await sql.query("insert into images (owner_id, kind, width, height, bytes, data) values ($1, 'car', 1, 1, $2, '\\x00')", [u.user.id, 50 * 1024 * 1024 - 100]);
    const id = (await req('POST', '/api/posts', u, {})).json().id;
    const r = await putPhoto(u, id, 0);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/50 MB/);
    await sql.query(`update images set bytes = $2 where owner_id = $1 and kind = 'car'`, [u.user.id, 50 * 1024 * 1024 - 200 * 1024]);
    expect((await putPhoto(u, id, 0)).statusCode).toBe(200);
    // replacing the same slot does not double-count
    expect((await putPhoto(u, id, 0)).statusCode).toBe(200);
  });

  it('posts per day and photos per day are limited (429)', async () => {
    const limited = await makeApp({ RATE_LIMIT_POSTS: '2', RATE_LIMIT_POST_PHOTOS: '3' });
    try {
      const u = await register(limited, 'Spammer');
      const create = () => limited.inject({ method: 'POST', url: '/api/posts', headers: u.auth, payload: {} });
      const p1 = (await create()).json().id;
      expect((await create()).statusCode).toBe(201);
      const third = await create();
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('RATE_LIMITED');
      const put = (i: number) =>
        limited.inject({ method: 'PUT', url: `/api/posts/${p1}/photos/${i}`, headers: { ...u.auth, 'content-type': 'image/jpeg' }, payload: smallJpeg });
      for (let i = 0; i < 3; i++) expect((await put(i)).statusCode).toBe(200);
      expect((await put(3)).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('leaderboard: +3 per published photo post, max 10 a month, deleted posts and drafts do not count', async () => {
    const u = await register(app, 'Scorer');
    const made: string[] = [];
    for (let i = 0; i < 12; i++) made.push((await makePost(u)).id);
    await req('POST', '/api/posts', u, {}); // draft
    let row = (await computeRanking(app.db, 'month')).find((r) => r.userId === u.user.id)!;
    expect(row.breakdown.posts).toBe(30);
    // delete 3: 9 left -> 27
    for (const id of made.slice(0, 3)) await req('DELETE', `/api/posts/${id}`, u);
    row = (await computeRanking(app.db, 'month')).find((r) => r.userId === u.user.id)!;
    expect(row.breakdown.posts).toBe(27);
    app.leaderboard.clear();
    const board = (await req('GET', '/api/leaderboard', u)).json();
    expect(board.me.points).toBeGreaterThanOrEqual(27);
  });
});

describe('demo removal includes v6 data', () => {
  it('removeDemo deletes demo posts, likes, comments, saves, follows and their reports', async () => {
    const real = await register(app, 'RealPerson');
    const [demo] = await q(
      `insert into users (email, password_hash, display_name) values ($1, 'x', 'Demo Person') returning id`,
      [`demo-v6@${DEMO_EMAIL_DOMAIN}`],
    );
    const demoAuth = { authorization: `Bearer ${app.jwt.sign({ sub: demo.id, typ: 'access' })}` };
    const demoU = { auth: demoAuth, user: { id: demo.id } } as unknown as U;
    const demoPost = await makePost(demoU);
    const realPost = await makePost(real);
    await req('POST', `/api/posts/${realPost.id}/like`, demoU);
    await req('POST', `/api/posts/${realPost.id}/save`, demoU);
    const demoComment = (await req('POST', `/api/posts/${realPost.id}/comments`, demoU, { text: 'demo says hi' })).json();
    await req('POST', `/api/posts/${demoPost.id}/like`, real);
    await req('POST', `/api/posts/${demoPost.id}/comments`, real, { text: 'real on demo' });
    await follow(demoU, real);
    await follow(real, demoU);
    await req('POST', '/api/reports', real, { targetType: 'post', targetId: demoPost.id, reason: 'x' });
    await req('POST', '/api/reports', real, { targetType: 'comment', targetId: demoComment.id, reason: 'x' });
    expect((await removeDemo(app.db)).users).toBe(1);
    expect(await num(`select count(*) from posts where id = $1`, [demoPost.id])).toBe(0);
    expect(await num(`select count(*) from post_likes where user_id = $1`, [demo.id])).toBe(0);
    expect(await num(`select count(*) from post_comments where author_id = $1`, [demo.id])).toBe(0);
    expect(await num(`select count(*) from post_saves where user_id = $1`, [demo.id])).toBe(0);
    expect(await num(`select count(*) from follows where follower_id = $1 or followee_id = $1`, [demo.id])).toBe(0);
    expect(await num(`select count(*) from reports where target_id in ($1, $2)`, [demoPost.id, demoComment.id])).toBe(0);
    expect(await num(`select count(*) from images where owner_id = $1`, [demo.id])).toBe(0);
    const rp = (await req('GET', `/api/posts/${realPost.id}`, real)).json();
    expect(rp).toMatchObject({ likeCount: 0, commentCount: 0 });
    expect((await req('GET', `/api/users/${real.user.id}`)).json()).toMatchObject({ followerCount: 0, followingCount: 0 });
  });
});

describe('review fixes', () => {
  it('mixed uploads at the same moment can not go over the quota (one lock per user)', async () => {
    const u = await register(app, 'Racer');
    const friend = await register(app, 'RacerFriend');
    await follow(u, friend);
    await follow(friend, u);
    const png = await noisePng(300, 300);
    const h = { ...u.auth, 'content-type': 'image/png' };
    const carId = (await req('POST', '/api/cars', u, { make: 'Lada', model: 'Niva', year: 2010 })).json().id;
    const clanId = (await req('POST', '/api/clans', u, { name: `Race clan ${Date.now()}`, tag: `R${Date.now() % 10000}`.slice(0, 5), isOpen: true })).json().id;
    const ev = await req('POST', '/api/events', u, {
      title: 'Race trip', startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), maxCars: 5, carId,
      meetingPoint: { lat: 40.4, lng: 49.8, label: 'Baku' },
    });
    expect(ev.statusCode, ev.body).toBe(201);
    const groupId = (await req('POST', '/api/conversations/group', u, { name: 'Race', userIds: [friend.user.id] })).json().id;
    const postId = (await req('POST', '/api/posts', u, {})).json().id;
    const uploads = () => [
      app.inject({ method: 'PUT', url: '/api/me/avatar', headers: h, payload: png }),
      app.inject({ method: 'PUT', url: `/api/cars/${carId}/photo`, headers: h, payload: png }),
      app.inject({ method: 'PUT', url: `/api/clans/${clanId}/logo`, headers: h, payload: png }),
      app.inject({ method: 'PUT', url: `/api/events/${ev.json().id}/cover`, headers: h, payload: png }),
      app.inject({ method: 'PUT', url: `/api/conversations/${groupId}/avatar`, headers: h, payload: png }),
      app.inject({ method: 'PUT', url: `/api/posts/${postId}/photos/0`, headers: h, payload: png }),
    ];
    // sizes of each kind for this picture, then clear them
    for (const r of await Promise.all(uploads())) expect(r.statusCode, r.body).toBe(200);
    const sizes = (await q(`select bytes from images where owner_id = $1`, [u.user.id])).map((r) => Number(r.bytes));
    expect(sizes).toHaveLength(6);
    await req('DELETE', '/api/me/avatar', u);
    await req('DELETE', `/api/cars/${carId}/photo`, u);
    await req('DELETE', `/api/clans/${clanId}/logo`, u);
    await req('DELETE', `/api/events/${ev.json().id}/cover`, u);
    await req('DELETE', `/api/conversations/${groupId}/avatar`, u);
    await req('DELETE', `/api/posts/${postId}/photos/0`, u);
    expect(await num(`select count(*) from images where owner_id = $1`, [u.user.id])).toBe(0);
    // room for exactly one more photo of any kind
    const free = Math.max(...sizes) + 10;
    expect(2 * Math.min(...sizes)).toBeGreaterThan(free);
    await sql.query("insert into images (owner_id, kind, width, height, bytes, data) values ($1, 'car', 1, 1, $2, '\\x00')", [u.user.id, USER_IMAGE_QUOTA_BYTES - free]);
    const res = await Promise.all(uploads());
    expect(res.map((r) => r.statusCode).filter((c) => c === 200)).toHaveLength(1);
    expect(res.map((r) => r.statusCode).filter((c) => c === 409)).toHaveLength(5);
    expect(await num(`select sum(bytes) from images where owner_id = $1`, [u.user.id])).toBeLessThanOrEqual(USER_IMAGE_QUOTA_BYTES);
  });

  it('quota is 50 MB; storage size helper for the daily log', async () => {
    expect(USER_IMAGE_QUOTA_BYTES).toBe(50 * 1024 * 1024);
    const s = await imageStorageMb(app.db);
    expect(s.count).toBeGreaterThan(0);
    expect(s.storedMb).toBeGreaterThan(0);
    expect(s.diskMb).toBeGreaterThan(0);
  });

  it('a post reported by 2+ different users loses its points (one reporter, many times, is not enough)', async () => {
    const author = await register(app, 'Reported');
    const r1 = await register(app, 'Reporter1');
    const r2 = await register(app, 'Reporter2');
    const p = await makePost(author);
    const pts = async () => (await computeRanking(app.db, 'month')).find((r) => r.userId === author.user.id)?.breakdown.posts ?? 0;
    expect(await pts()).toBe(3);
    for (let i = 0; i < 3; i++) await req('POST', '/api/reports', r1, { targetType: 'post', targetId: p.id, reason: 'x' });
    expect(await pts()).toBe(3);
    await req('POST', '/api/reports', r2, { targetType: 'post', targetId: p.id, reason: 'x' });
    expect(await pts()).toBe(0);
  });

  it('cancelling a friend request keeps a follow that existed before the request', async () => {
    const a = await register(app, 'Keeper');
    const b = await register(app, 'Kept');
    await follow(a, b);
    await sql.query(`update follows set created_at = now() - interval '1 day' where follower_id = $1`, [a.user.id]);
    const fr = (await req('POST', '/api/friends/requests', a, { userId: b.user.id })).json();
    expect((await req('DELETE', `/api/friends/requests/${fr.request.id}`, a)).statusCode).toBe(204);
    expect((await req('GET', `/api/users/${b.user.id}`, a)).json().isFollowing).toBe(true);
  });

  it('friend requests and accepts respect the 5000 following limit', async () => {
    const a = await register(app, 'Busy');
    const b = await register(app, 'Target');
    const c = await register(app, 'Asker');
    await sql.query(`
      with fresh as (
        insert into users (email, password_hash, display_name)
        select 'bulk' || g || '-' || $2 || '@example.com', 'x', 'Bulk' from generate_series(1, 5000) g returning id)
      insert into follows (follower_id, followee_id) select $1::uuid, id from fresh`, [a.user.id, Date.now()]);
    let r = await req('POST', '/api/friends/requests', a, { userId: b.user.id });
    expect(r.statusCode).toBe(409);
    expect((await follow(a, b)).statusCode).toBe(409);
    // c asks a: accepting would make a follow one more person
    const fr = (await req('POST', '/api/friends/requests', c, { userId: a.user.id })).json();
    r = await req('POST', `/api/friends/requests/${fr.request.id}/accept`, a);
    expect(r.statusCode).toBe(409);
    expect(await num(`select count(*) from friendships where user_id = $1`, [a.user.id])).toBe(0);
    await sql.query(`delete from users where display_name = 'Bulk'`);
  });
});
