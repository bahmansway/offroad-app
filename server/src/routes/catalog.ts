import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors.js';

export interface Trim {
  id: string;
  brand: string;
  model: string;
  generation: string;
  yearFrom: number;
  yearTo: number | null;
  engine: string;
  engineL: number;
  hp: number;
  drive: '4WD' | 'AWD' | 'FWD' | 'RWD';
  transmission: 'manual' | 'automatic' | 'cvt';
  fuel: 'petrol' | 'diesel' | 'hybrid' | 'electric' | 'lpg';
  /** Where the power figure was published (EU, RU, AU, US, GCC). */
  market: string;
  /** Unit of `hp`: 'PS' (metric, EU/RU/AU) or 'hp' (US/GCC). */
  powerUnit: 'PS' | 'hp';
}

// src/routes -> src/data/catalog (tsx); dist/routes -> dist/data/catalog (copied by `npm run build`).
const here = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_DIR = path.resolve(here, '../data/catalog');

const models: Record<string, string[]> = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'models.json'), 'utf8'));
export const TRIMS: Trim[] = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'trims.json'), 'utf8'));
export const trimById = new Map(TRIMS.map((t) => [t.id, t]));

const norm = (s: string) => s.trim().toLowerCase();
const brandByNorm = new Map(Object.keys(models).map((b) => [norm(b), b]));
const offroadKeys = new Set(TRIMS.map((t) => `${norm(t.brand)}|${norm(t.model)}`));
const brandList = Object.keys(models).map((name) => ({ name, modelCount: models[name].length }));

const CACHE = 'public, max-age=86400';

const modelsQuery = z.object({ brand: z.string().trim().min(1).max(60) });
const trimsQuery = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(80).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/catalog/brands', async (_req, reply) => {
    reply.header('cache-control', CACHE);
    return brandList;
  });

  app.get('/catalog/models', async (req, reply) => {
    const q = parse(modelsQuery, req.query);
    const brand = brandByNorm.get(norm(q.brand));
    reply.header('cache-control', CACHE);
    if (!brand) return [];
    return models[brand].map((name) => ({ name, offroad: offroadKeys.has(`${norm(brand)}|${norm(name)}`) }));
  });

  app.get('/catalog/trims', async (req, reply) => {
    const q = parse(trimsQuery, req.query);
    reply.header('cache-control', CACHE);
    return TRIMS.filter(
      (t) =>
        norm(t.brand) === norm(q.brand) &&
        (q.model === undefined || norm(t.model) === norm(q.model)) &&
        (q.year === undefined || (t.yearFrom <= q.year && (t.yearTo === null || q.year <= t.yearTo))),
    );
  });
}
