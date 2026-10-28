/**
 * Demo data for local development only. Refuses to run in production.
 * Usage: npm run seed   (uses DATABASE_URL)
 */
import './env.js';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { users, spots, cars, mods, spotRatings, carRatings } from './db/schema.js';

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'offroad-demo-123';

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== '1') {
    throw new Error('Refusing to seed in production (set ALLOW_SEED=1 to override)');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { pool, db } = createDb(url);
  await runMigrations(db);

  const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const upsertUser = async (email: string, displayName: string) => {
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) return existing;
    const [u] = await db.insert(users).values({ email, displayName, passwordHash: hash }).returning();
    return u;
  };
  const ali = await upsertUser('ali@demo.offroad.az', 'Ali 4x4');
  const leyla = await upsertUser('leyla@demo.offroad.az', 'Leyla');

  const [already] = await db.select({ id: spots.id }).from(spots).where(eq(spots.ownerId, ali.id)).limit(1);
  if (already) {
    console.log('Seed data already present - nothing to do.');
    await pool.end();
    return;
  }

  const spotRows = await db
    .insert(spots)
    .values([
      {
        ownerId: ali.id, type: 'trail', name: 'Candy Cane Mountains loop',
        description: 'Striped red-white hills near Xızı. Soft clay climbs, very slippery after rain.',
        lat: 40.9, lng: 49.1, difficulty: 3, season: 'Apr–Oct, dry days only', tags: ['clay', 'views', 'photo'],
      },
      {
        ownerId: leyla.id, type: 'trail', name: 'Qobustan mud volcanoes',
        description: 'Gravel and dirt tracks to the mud volcanoes. Easy in dry weather.',
        lat: 40.08, lng: 49.4, difficulty: 1, season: 'All year, avoid after rain', tags: ['mud volcano', 'gravel'],
      },
      {
        ownerId: ali.id, type: 'trail', name: 'Şahdağ high pass',
        description: 'Rocky mountain track with steep switchbacks. Low range and AT tyres needed.',
        lat: 41.3, lng: 48.1, difficulty: 4, season: 'Jun–Sep', tags: ['rocks', 'altitude', 'river crossing'],
      },
      {
        ownerId: leyla.id, type: 'trail', name: 'Lahıc forest road',
        description: 'Narrow forest track above the Girdimançay river towards Lahıc village.',
        lat: 40.85, lng: 48.39, difficulty: 2, season: 'May–Oct', tags: ['forest', 'river'],
      },
      {
        ownerId: ali.id, type: 'trail', name: 'Quba canyon run',
        description: 'Riverbed and canyon sections near Quba. Water level changes fast in spring.',
        lat: 41.36, lng: 48.5, difficulty: 5, season: 'Aug–Oct', tags: ['canyon', 'water', 'winch'],
      },
      {
        ownerId: leyla.id, type: 'camp', name: 'Qəbələ forest camp',
        description: 'Flat meadow by the forest edge, room for 6–8 cars. Bring firewood.',
        lat: 40.98, lng: 47.85, difficulty: null, season: 'May–Sep', tags: ['camp', 'meadow', 'fire pit'],
      },
    ])
    .returning();

  const [car] = await db
    .insert(cars)
    .values({
      ownerId: ali.id, make: 'Toyota', model: 'Land Cruiser 80', year: 1995, engine: '4.2 diesel',
      description: 'Weekend rig for the mountains.',
    })
    .returning();
  await db.insert(mods).values([
    { carId: car.id, name: '2" OME lift kit', category: 'lift', price: 2400, currency: 'AZN', pricePublic: true },
    { carId: car.id, name: 'BFGoodrich KO2 285/75R16', category: 'tyres', price: 3200, currency: 'AZN', pricePublic: true },
    { carId: car.id, name: 'Warn Zeon 10-S winch', category: 'recovery', price: 1500, currency: 'USD', pricePublic: false },
    { carId: car.id, name: 'Steel front bumper', category: 'bumpers', price: null, currency: 'AZN', pricePublic: true },
  ]);

  await db.insert(carRatings).values({ carId: car.id, userId: leyla.id, stars: 5 });
  await db.insert(spotRatings).values([
    { spotId: spotRows[0].id, userId: leyla.id, stars: 5 },
    { spotId: spotRows[1].id, userId: ali.id, stars: 4 },
  ]);

  console.log(`Seeded: 2 users (password "${DEMO_PASSWORD}"), ${spotRows.length} spots, 1 car with 4 mods.`);
  console.log('  ali@demo.offroad.az / leyla@demo.offroad.az');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
