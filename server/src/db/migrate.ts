import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './index.js';

// Works from both src/db (tsx) and dist/db (compiled): migrations live in server/drizzle.
const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../drizzle');

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
