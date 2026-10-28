import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  smallint,
  doublePrecision,
  numeric,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_idx').on(t.tokenHash), index('refresh_tokens_user_idx').on(t.userId)],
);

export const spots = pgTable(
  'spots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['trail', 'camp'] }).notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    difficulty: smallint('difficulty'),
    season: text('season'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('spots_owner_idx').on(t.ownerId),
    index('spots_created_idx').on(t.createdAt),
    check('spots_type_check', sql`${t.type} in ('trail','camp')`),
    check(
      'spots_difficulty_check',
      sql`(${t.type} = 'trail' and ${t.difficulty} between 1 and 5) or (${t.type} = 'camp' and ${t.difficulty} is null)`,
    ),
  ],
);

export const spotRatings = pgTable(
  'spot_ratings',
  {
    spotId: uuid('spot_id')
      .notNull()
      .references(() => spots.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stars: smallint('stars').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.spotId, t.userId] }), check('spot_ratings_stars_check', sql`${t.stars} between 1 and 5`)],
);

export const cars = pgTable(
  'cars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    engine: text('engine'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cars_owner_idx').on(t.ownerId), index('cars_created_idx').on(t.createdAt)],
);

export const carRatings = pgTable(
  'car_ratings',
  {
    carId: uuid('car_id')
      .notNull()
      .references(() => cars.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stars: smallint('stars').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.carId, t.userId] }), check('car_ratings_stars_check', sql`${t.stars} between 1 and 5`)],
);

export const MOD_CATEGORIES = [
  'lift',
  'tyres',
  'wheels',
  'recovery',
  'armour',
  'bumpers',
  'lighting',
  'engine',
  'suspension',
  'interior',
  'roof',
  'other',
] as const;
export const CURRENCIES = ['AZN', 'USD', 'EUR'] as const;

export const mods = pgTable(
  'mods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carId: uuid('car_id')
      .notNull()
      .references(() => cars.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category', { enum: MOD_CATEGORIES }).notNull(),
    price: numeric('price', { precision: 12, scale: 2, mode: 'number' }),
    currency: text('currency', { enum: CURRENCIES }).notNull().default('AZN'),
    pricePublic: boolean('price_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mods_car_idx').on(t.carId)],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type', { enum: ['spot', 'car', 'user'] }).notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
