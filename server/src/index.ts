import './env.js';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { demoFromEnv } from './seedDemo.js';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({ port: config.port, host: '0.0.0.0' });
  // Demo data only when explicitly asked for (DEMO_SEED=1 / DEMO_REMOVE=1), also in production.
  if (await demoFromEnv(app.db, process.env, (line) => app.log.info(line)) !== 'none') app.leaderboard.clear();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
