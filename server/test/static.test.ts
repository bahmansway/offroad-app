import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

let app: FastifyInstance;
let dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webdist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>SPA</html>');
  fs.writeFileSync(path.join(dir, 'garage.html'), '<html>GARAGE</html>');
  fs.mkdirSync(path.join(dir, '_expo'));
  fs.writeFileSync(path.join(dir, '_expo', 'app.js'), 'console.log(1)');
  fs.mkdirSync(path.join(dir, '_expo', 'static', 'js', 'web'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_expo', 'static', 'js', 'web', 'entry-abc123.js'), 'console.log(2)');
  app = await makeApp({ WEB_DIST: dir });
});
afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('web build serving', () => {
  it('serves index, assets, static routes and SPA fallback', async () => {
    expect((await app.inject({ url: '/' })).body).toContain('SPA');
    const js = await app.inject({ url: '/_expo/app.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
    expect((await app.inject({ url: '/garage' })).body).toContain('GARAGE');
    const deep = await app.inject({ url: '/spots/123?x=1' });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('SPA');
    expect((await app.inject({ url: '/../../etc/passwd' })).body).not.toContain('root:');
  });
  it('missing asset files 404 instead of returning index.html; extensionless routes still work', async () => {
    for (const url of [
      '/_expo/static/js/web/old-chunk-deadbeef.js',
      '/_expo/anything',
      '/assets/fonts/Barlow.ttf',
      '/assets/whatever',
      '/missing.css', '/x/y/app.js.map', '/logo.png', '/a.jpg', '/i.svg', '/f.woff', '/f.woff2', '/favicon.ico', '/manifest.json',
      '/Old-Chunk.JS',
    ]) {
      const r = await app.inject({ url });
      expect(r.statusCode, url).toBe(404);
      expect(r.headers['content-type'], url).not.toContain('text/html');
      expect(r.body).not.toContain('SPA');
    }
    for (const url of ['/garage', '/spots/123', '/cars/abc/edit', '/profile/', '/spots/123?ref=a.js']) {
      const r = await app.inject({ url });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-type'], url).toContain('text/html');
    }
  });

  it('hashed bundles are cached forever, html is not', async () => {
    const js = await app.inject({ url: '/_expo/static/js/web/entry-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject({ url: '/' })).headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ url: '/spots/xyz' })).headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ url: '/_expo/app.js' })).headers['cache-control']).not.toContain('immutable');
  });

  it('api routes are not swallowed by the SPA (any casing)', async () => {
    for (const url of ['/API/health', '/Api/unknown', '/API']) {
      const r = await app.inject({ url });
      expect(r.statusCode, url).toBe(404);
      expect(r.json().error.code).toBe('NOT_FOUND');
    }
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ ok: true });
    const r = await app.inject({ url: '/api/unknown' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });
});
