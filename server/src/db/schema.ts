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
  jsonb,
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
    /** v4: when the rating was first given (leaderboard points). Re-rating keeps it. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.spotId, t.userId] }),
    check('spot_ratings_stars_check', sql`${t.stars} between 1 and 5`),
    index('spot_ratings_created_idx').on(t.createdAt),
  ],
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
    /** v4: when the rating was first given (leaderboard points). Re-rating keeps it. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.carId, t.userId] }),
    check('car_ratings_stars_check', sql`${t.stars} between 1 and 5`),
    index('car_ratings_created_idx').on(t.createdAt),
  ],
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

export const REPORT_TARGETS = ['spot', 'car', 'user', 'message', 'clan', 'event', 'post', 'comment'] as const;

export const reports = pgTable(
  'reports',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type', { enum: REPORT_TARGETS }).notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reports_target_idx').on(t.targetType, t.targetId)],
);


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
    kind: text('kind', { enum: ['avatar', 'car', 'clan', 'event', 'group', 'post'] }).notNull(),
    /** v6: set for post photos, so deleting the post (or an old draft) deletes its photos too. */
    postId: uuid('post_id').references((): AnyPgColumn => posts.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull().default('image/jpeg'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('images_owner_idx').on(t.ownerId), index('images_post_idx').on(t.postId).where(sql`${t.postId} is not null`)],
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

export const CLAN_ROLES = ['leader', 'officer', 'member'] as const;

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
    role: text('role', { enum: CLAN_ROLES }).notNull(),
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
    type: text('type', { enum: ['dm', 'clan', 'event', 'group'] }).notNull(),
    /** v4 group chats: name, photo and admin (null for other types). */
    name: text('name'),
    avatarImageId: uuid('avatar_image_id').references((): AnyPgColumn => images.id, { onDelete: 'set null' }),
    adminId: uuid('admin_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    clanId: uuid('clan_id').references(() => clans.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references((): AnyPgColumn => events.id, { onDelete: 'cascade' }),
    pinnedMessageId: uuid('pinned_message_id').references((): AnyPgColumn => messages.id, { onDelete: 'set null' }),
    pinnedById: uuid('pinned_by_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    /** "smallerUserId:largerUserId" for DMs, so each pair has exactly one conversation. */
    dmKey: text('dm_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_clan_idx').on(t.clanId),
    uniqueIndex('conversations_dm_key_idx').on(t.dmKey),
    uniqueIndex('conversations_event_idx').on(t.eventId),
    check(
      'conversations_type_check',
      sql`(${t.type} = 'dm' and ${t.dmKey} is not null and ${t.clanId} is null and ${t.eventId} is null) or (${t.type} = 'clan' and ${t.clanId} is not null and ${t.dmKey} is null and ${t.eventId} is null) or (${t.type} = 'event' and ${t.eventId} is not null and ${t.dmKey} is null and ${t.clanId} is null) or (${t.type} = 'group' and ${t.name} is not null and ${t.dmKey} is null and ${t.clanId} is null and ${t.eventId} is null)`,
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
    /** Set while the user has muted this conversation (no unread badge). */
    mutedAt: timestamp('muted_at', { withTimezone: true }),
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
    /** null for system messages. */
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['user', 'system'] }).notNull().default('user'),
    /** User text; for system messages an English fallback (apps render systemKey + systemParams). */
    text: text('text').notNull(),
    systemKey: text('system_key'),
    systemParams: jsonb('system_params').$type<Record<string, unknown>>(),
    clientId: text('client_id'),
    /** Soft delete: text is kept for moderation but never returned by the API. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'messages_type_check',
      sql`(${t.type} = 'user' and ${t.senderId} is not null) or (${t.type} = 'system' and ${t.systemKey} is not null)`,
    ),
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


// ---------------- v3: clan invites, events ----------------

export const clanInvites = pgTable(
  'clan_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    invitedById: uuid('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set when the invitee declined; the row is kept for a 24 h re-invite cooldown. */
    declinedAt: timestamp('declined_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('clan_invites_clan_user_idx').on(t.clanId, t.userId), index('clan_invites_user_idx').on(t.userId)],
);

export const EVENT_VISIBILITY = ['public', 'clan'] as const;

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    spotId: uuid('spot_id').references((): AnyPgColumn => spots.id, { onDelete: 'set null' }),
    meetingLat: doublePrecision('meeting_lat'),
    meetingLng: doublePrecision('meeting_lng'),
    meetingLabel: text('meeting_label'),
    maxCars: integer('max_cars').notNull(),
    minDifficulty: smallint('min_difficulty'),
    requirements: text('requirements').array().notNull().default(sql`'{}'::text[]`),
    visibility: text('visibility', { enum: EVENT_VISIBILITY }).notNull().default('public'),
    /** Organizer's clan when the event was created (clan badge; required for visibility 'clan'). */
    clanId: uuid('clan_id').references((): AnyPgColumn => clans.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['scheduled', 'cancelled'] }).notNull().default('scheduled'),
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    coverImageId: uuid('cover_image_id').references((): AnyPgColumn => images.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_starts_idx').on(t.startsAt),
    index('events_organizer_idx').on(t.organizerId, t.createdAt),
    index('events_spot_idx').on(t.spotId),
    index('events_clan_idx').on(t.clanId),
    check('events_max_cars_check', sql`${t.maxCars} between 2 and 100`),
    check('events_visibility_check', sql`${t.visibility} in ('public','clan')`),
    check('events_status_check', sql`${t.status} in ('scheduled','cancelled')`),
  ],
);

export const PARTICIPANT_STATUSES = ['going', 'waitlist', 'removed'] as const;

export const eventParticipants = pgTable(
  'event_participants',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** set null if the car is deleted later */
    carId: uuid('car_id').references(() => cars.id, { onDelete: 'set null' }),
    seats: smallint('seats').notNull().default(0),
    /** removed = taken out by the organizer (kept so they can't rejoin; not a member of the chat). */
    status: text('status', { enum: PARTICIPANT_STATUSES }).notNull(),
    /** FIFO order for the waitlist */
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    index('event_participants_user_idx').on(t.userId),
    index('event_participants_event_status_idx').on(t.eventId, t.status, t.joinedAt),
    check('event_participants_status_check', sql`${t.status} in ('going','waitlist','removed')`),
    check('event_participants_seats_check', sql`${t.seats} between 0 and 6`),
  ],
);


// ---------------- v4: friends ----------------

/**
 * Friend requests. Pending = declinedAt null. A declined row is kept 24 h so the sender can't re-request
 * right away. Accept / cancel delete the row.
 */
export const friendRequests = pgTable(
  'friend_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('friend_requests_pair_idx').on(t.fromId, t.toId),
    index('friend_requests_to_idx').on(t.toId),
    check('friend_requests_not_self', sql`${t.fromId} <> ${t.toId}`),
  ],
);

/** Friendships: two rows per pair (A->B and B->A), so "my friends" is a simple lookup. */
export const friendships = pgTable(
  'friendships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    friendId: uuid('friend_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.friendId] }),
    index('friendships_friend_idx').on(t.friendId),
    check('friendships_not_self', sql`${t.userId} <> ${t.friendId}`),
  ],
);


// ---------------- v5: phone notifications ----------------

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export const PUSH_LOCALES = ['az', 'en'] as const;

/**
 * Expo push tokens (one row per phone app install). A token belongs to the last user who registered it,
 * so logging in as someone else on the same phone moves it.
 */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform', { enum: PUSH_PLATFORMS }).notNull(),
    /** Language of the texts the server writes (friend request, event cancelled ...). */
    locale: text('locale', { enum: PUSH_LOCALES }).notNull().default('az'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_tokens_token_idx').on(t.token),
    index('push_tokens_user_idx').on(t.userId),
    check('push_tokens_platform_check', sql`${t.platform} in ('ios','android')`),
    check('push_tokens_locale_check', sql`${t.locale} in ('az','en')`),
  ],
);

/** Per-user notification switches. No row = everything on. */
export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  messages: boolean('messages').notNull().default(true),
  friends: boolean('friends').notNull().default(true),
  clans: boolean('clans').notNull().default(true),
  events: boolean('events').notNull().default(true),
  /** v6: likes, comments and new followers. */
  social: boolean('social').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});



// ---------------- v6: photo posts, follows ----------------

/** created_at values are kept to whole milliseconds so cursors (ISO strings) compare exactly. */
const msNow = sql`date_trunc('milliseconds', now())`;

/**
 * Photo posts. A post starts as a draft (publishedAt null) while its photos are uploaded; drafts older
 * than 24 h are deleted. On publish, createdAt is set to the publish time (lists sort by it).
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
    caption: text('caption').notNull().default(''),
    carId: uuid('car_id').references((): AnyPgColumn => cars.id, { onDelete: 'set null' }),
    spotId: uuid('spot_id').references((): AnyPgColumn => spots.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(msNow),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    index('posts_published_created_idx').on(t.createdAt.desc(), t.id.desc()).where(sql`${t.publishedAt} is not null`),
    index('posts_author_created_idx').on(t.authorId, t.createdAt.desc(), t.id.desc()),
    index('posts_spot_created_idx').on(t.spotId, t.createdAt.desc(), t.id.desc()).where(sql`${t.spotId} is not null`),
    index('posts_car_created_idx').on(t.carId, t.createdAt.desc(), t.id.desc()).where(sql`${t.carId} is not null`),
    index('posts_drafts_idx').on(t.createdAt).where(sql`${t.publishedAt} is null`),
  ],
);

/** Photos of a post, in order (idx 0..5). The image row itself carries post_id for cleanup. */
export const postPhotos = pgTable(
  'post_photos',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    idx: smallint('idx').notNull(),
    imageId: uuid('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.idx] }),
    uniqueIndex('post_photos_image_idx').on(t.imageId),
    check('post_photos_idx_check', sql`${t.idx} between 0 and 5`),
  ],
);

export const postLikes = pgTable(
  'post_likes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(msNow),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_likes_user_idx').on(t.userId)],
);

export const postSaves = pgTable(
  'post_saves',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(msNow),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.userId] }),
    index('post_saves_user_created_idx').on(t.userId, t.createdAt.desc(), t.postId.desc()),
  ],
);

export const postComments = pgTable(
  'post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(msNow),
  },
  (t) => [
    index('post_comments_post_created_idx').on(t.postId, t.createdAt, t.id),
    index('post_comments_author_idx').on(t.authorId),
  ],
);

/** Who follows whom (no approval). "Friends" (Dost) = following each other. */
export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(msNow),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index('follows_followee_created_idx').on(t.followeeId, t.createdAt.desc(), t.followerId.desc()),
    index('follows_follower_created_idx').on(t.followerId, t.createdAt.desc(), t.followeeId.desc()),
    check('follows_not_self', sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

/** When the user last looked at their followers (badge = followers since then). No row = never. */
export const followersSeen = pgTable('followers_seen', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
});
