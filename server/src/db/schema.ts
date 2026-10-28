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
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    city: text('city'),
    avatarImageId: uuid('avatar_image_id').references((): AnyPgColumn => images.id, { onDelete: 'set null' }),
    currentCarId: uuid('current_car_id').references((): AnyPgColumn => cars.id, { onDelete: 'set null' }),
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

export const DRIVES = ['4WD', 'AWD', 'FWD', 'RWD'] as const;
export const TRANSMISSIONS = ['manual', 'automatic', 'cvt'] as const;
export const FUELS = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg'] as const;

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
    trimId: text('trim_id'),
    engineL: doublePrecision('engine_l'),
    hp: integer('hp'),
    drive: text('drive', { enum: DRIVES }),
    transmission: text('transmission', { enum: TRANSMISSIONS }),
    fuel: text('fuel', { enum: FUELS }),
    color: text('color'),
    photoImageId: uuid('photo_image_id').references((): AnyPgColumn => images.id, { onDelete: 'set null' }),
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

export const REPORT_TARGETS = ['spot', 'car', 'user', 'message', 'clan'] as const;

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type', { enum: REPORT_TARGETS }).notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------- v2: images, clans, chat, blocks ----------------

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Re-encoded JPEGs (EXIF stripped). Small enough to live in Postgres for now. */
export const images = pgTable(
  'images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['avatar', 'car', 'clan'] }).notNull(),
    mime: text('mime').notNull().default('image/jpeg'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('images_owner_idx').on(t.ownerId)],
);

export const clans = pgTable(
  'clans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** name.toLowerCase() computed in JS (Unicode-aware regardless of the database locale). */
    nameKey: text('name_key').notNull(),
    /** Stored upper-case (JS toUpperCase), unique. */
    tag: text('tag').notNull(),
    description: text('description').notNull().default(''),
    city: text('city'),
    isOpen: boolean('is_open').notNull().default(true),
    leaderId: uuid('leader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    logoImageId: uuid('logo_image_id').references((): AnyPgColumn => images.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('clans_name_key_idx').on(t.nameKey),
    uniqueIndex('clans_tag_idx').on(t.tag),
  ],
);

export const clanMembers = pgTable(
  'clan_members',
  {
    // user_id is the primary key: a user can be in at most one clan (enforced by the database).
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['leader', 'member'] }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clan_members_clan_idx').on(t.clanId)],
);

export const clanRequests = pgTable(
  'clan_requests',
  {
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clanId, t.userId] }), index('clan_requests_user_idx').on(t.userId)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type', { enum: ['dm', 'clan'] }).notNull(),
    clanId: uuid('clan_id').references(() => clans.id, { onDelete: 'cascade' }),
    /** "smallerUserId:largerUserId" for DMs, so each pair has exactly one conversation. */
    dmKey: text('dm_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_clan_idx').on(t.clanId),
    uniqueIndex('conversations_dm_key_idx').on(t.dmKey),
    check(
      'conversations_type_check',
      sql`(${t.type} = 'dm' and ${t.dmKey} is not null and ${t.clanId} is null) or (${t.type} = 'clan' and ${t.clanId} is not null and ${t.dmKey} is null)`,
    ),
  ],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conversation_members_user_idx').on(t.userId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conv_created_idx').on(t.conversationId, t.createdAt),
    uniqueIndex('messages_client_id_idx').on(t.conversationId, t.senderId, t.clientId),
  ],
);

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
);
