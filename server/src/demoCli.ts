/**
 * Local use: `npm run seed:demo` (needs DATABASE_URL and DEMO_PASSWORD) / `npm run remove:demo`.
 */
import './env.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { demoFromEnv } from './seedDemo.js';

async function main() {
  const cmd = process.argv[2];
  if (cmd !== 'seed' && cmd !== 'remove') throw new Error('Usage: demoCli.ts seed|remove');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { pool, db } = createDb(url);
  try {
    await runMigrations(db);
    const env = { ...process.env, DEMO_SEED: cmd === 'seed' ? '1' : '', DEMO_REMOVE: cmd === 'remove' ? '1' : '' };
    const r = await demoFromEnv(db, env, (line) => console.log(line));
    if (r === 'error') process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
