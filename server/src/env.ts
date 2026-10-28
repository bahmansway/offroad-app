import fs from 'node:fs';
// Load server/.env for local runs if present (existing env vars win). Railway sets env directly.
if (fs.existsSync('.env')) process.loadEnvFile('.env');
