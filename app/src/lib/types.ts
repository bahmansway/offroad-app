// Shapes from SPEC-v1.md "API contract". Ids are treated as opaque strings (numbers also work at runtime).
export type Id = string;
export type SpotType = 'trail' | 'camp';
export type Currency = 'AZN' | 'USD' | 'EUR';
export const MOD_CATEGORIES = [
  'lift', 'tyres', 'wheels', 'recovery', 'armour', 'bumpers',
  'lighting', 'engine', 'suspension', 'interior', 'roof', 'other',
] as const;
export type ModCategory = (typeof MOD_CATEGORIES)[number];

export type Drive = '4WD' | 'AWD' | 'FWD' | 'RWD';
export type Transmission = 'manual' | 'automatic' | 'cvt';
export type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric' | 'lpg';
export const DRIVES: Drive[] = ['4WD', 'AWD', 'FWD', 'RWD'];
export const TRANSMISSIONS: Transmission[] = ['manual', 'automatic', 'cvt'];
export const FUELS: Fuel[] = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg'];

export interface User {
  id: Id;
  displayName: string;
  createdAt: string;
  email?: string;
  // v2 (optional so a v1 server still works)
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  currentCarId?: Id | null;
  currentCar?: CarSummary | null;
}

/** PATCH /api/me */
export interface MeInput {
  displayName?: string;
  bio?: string | null;
  city?: string | null;
  currentCarId?: Id | null;
}

/** Car catalog (SPEC-v2 §2) */
export interface CatalogBrand { name: string; modelCount: number }
export interface CatalogModel { name: string; offroad: boolean }
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
  drive: Drive;
  transmission: Transmission;
  fuel: Fuel;
  /** where the power figure was published, e.g. "EU" */
  market?: string;
  /** unit of `hp` as published: metric PS (EU/RU/AU) or US hp */
  powerUnit?: 'PS' | 'hp';
}

/** Spec fields every car can have (all optional, owner can override). */
export interface CarSpecs {
  trimId?: string | null;
  engine?: string | null;
  engineL?: number | null;
  hp?: number | null;
  drive?: Drive | null;
  transmission?: Transmission | null;
  fuel?: Fuel | null;
  color?: string | null;
}

export interface Owner {
  id: Id;
  displayName: string;
}

export interface Spot {
  id: Id;
  type: SpotType;
  name: string;
  description: string;
  lat: number;
  lng: number;
  difficulty: number | null;
  season: string | null;
  tags: string[];
  ratingAvg: number | null;
  ratingCount: number;
  owner: Owner;
  createdAt: string;
  myRating?: number | null;
  /** v3: up to 5 upcoming events here that I can see (GET /api/spots/:id only) */
  upcomingEvents?: EventSummary[];
}

export interface SpotInput {
  type: SpotType;
  name: string;
  description: string;
  lat: number;
  lng: number;
  difficulty: number | null;
  season?: string | null;
  tags: string[];
}

export interface RatingResult {
  ratingAvg: number | null;
  ratingCount: number;
  myRating: number | null;
}

export interface Mod {
  id: Id;
  name: string;
  category: ModCategory;
  currency: Currency;
  pricePublic: boolean;
  /** null for non-owners when pricePublic is false, or when no price was entered */
  price: number | null;
}

export interface ModInput {
  name: string;
  category: ModCategory;
  price?: number | null;
  currency: Currency;
  pricePublic: boolean;
}

/** List item from GET /api/cars. The contract does not spell it out, so everything beyond the basics is optional. */
export interface CarSummary extends CarSpecs {
  id: Id;
  make: string;
  model: string;
  year: number;
  photoUrl?: string | null;
  owner?: Owner;
  ratingAvg?: number | null;
  ratingCount?: number;
  modCount?: number;
  createdAt?: string;
}

export interface Car extends CarSpecs {
  id: Id;
  make: string;
  model: string;
  year: number;
  photoUrl?: string | null;
  description: string | null;
  owner: Owner;
  mods: Mod[];
  ratingAvg: number | null;
  ratingCount: number;
  myRating: number | null;
  totalPublicSpend: Partial<Record<Currency, number>>;
  hiddenPriceCount: number;
  createdAt: string;
}

export interface CarInput extends CarSpecs {
  make: string;
  model: string;
  year: number;
  description?: string | null;
}

export interface PublicUser {
  id: Id;
  displayName: string;
  createdAt: string;
  cars: CarSummary[];
  spotCount: number;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  currentCar?: CarSummary | null;
  /** v2 clans — filled by the server; the chat builder uses it */
  clan?: { id: Id; name: string; tag: string; logoUrl: string | null; role: string } | null;
  /** true when I blocked this user */
  isBlocked?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type ReportTarget = 'spot' | 'car' | 'user' | 'message' | 'clan' | 'event';

export type ErrorCode =
  | 'VALIDATION' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED'
  | 'NETWORK' | 'UNKNOWN';

// ---------- v2 clans & chat (SPEC-v2 §4 + "Server notes for app builders") ----------
export type ClanRole = 'leader' | 'officer' | 'member' | 'pending' | null;
export type MemberRole = 'leader' | 'officer' | 'member';

export interface UserRef {
  id: Id;
  displayName: string;
  avatarUrl: string | null;
}

export interface Clan {
  id: Id;
  name: string;
  tag: string;
  description: string;
  logoUrl: string | null;
  city: string | null;
  isOpen: boolean;
  leader: { id: Id; displayName: string; avatarUrl?: string | null };
  memberCount: number;
  myRole: ClanRole;
  /** null unless I am a member */
  conversationId: Id | null;
  createdAt: string;
}

export interface ClanInput {
  name: string;
  tag: string;
  description?: string;
  city?: string | null;
  isOpen?: boolean;
}

export interface ClanMember {
  user: UserRef;
  role: MemberRole;
  joinedAt: string;
}

export interface ClanRequest {
  user: UserRef;
  createdAt: string;
}

export type SystemKey =
  | 'event.joined' | 'event.waitlisted' | 'event.left' | 'event.promoted' | 'event.removed'
  | 'event.cancelled' | 'event.edited';

export interface Message {
  id: Id;
  conversationId: Id;
  /** v3: 'system' messages have no sender; render `systemKey` translated (`text` is an English fallback) */
  type?: 'user' | 'system';
  sender: UserRef | null;
  text: string;
  createdAt: string;
  clientId: string | null;
  systemKey?: SystemKey | string | null;
  systemParams?: Record<string, unknown> | null;
  /** v3: set when the sender deleted it (text is then '') */
  deletedAt?: string | null;
}

export interface Pinned {
  message: Message;
  pinnedBy: Id | null;
  pinnedAt: string | null;
}

export interface Conversation {
  id: Id;
  type: 'dm' | 'clan' | 'event';
  title: string;
  avatarUrl: string | null;
  clanId: Id | null;
  otherUser: UserRef | null;
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt: string;
  // v3
  eventId?: Id | null;
  muted?: boolean;
  readOnly?: boolean;
  readOnlyUntil?: string | null;
  pinned?: Pinned | null;
  canPin?: boolean;
}

/** `conversation:updated` socket payload */
export interface ConversationUpdate {
  id: Id;
  lastMessage: Message;
  updatedAt: string;
}

// ---------- v3 events (SPEC-v3 §2 + "Server notes for app builders (v3)") ----------
export type EventStatus = 'scheduled' | 'cancelled' | 'finished';
export type MyEventStatus = 'organizer' | 'going' | 'waitlist' | null;
export type EventVisibility = 'public' | 'clan';

export interface EventSpot {
  id: Id;
  name: string;
  type: SpotType | null;
  difficulty: number | null;
  lat: number | null;
  lng: number | null;
}

export interface MeetingPoint {
  lat: number;
  lng: number;
  label: string;
}

export interface EventSummary {
  id: Id;
  title: string;
  startsAt: string;
  endsAt: string | null;
  spot: EventSpot | null;
  meetingPoint: MeetingPoint | null;
  maxCars: number;
  minDifficulty: number | null;
  requirements: string[];
  visibility: EventVisibility;
  clan: { id: Id; name: string; tag: string } | null;
  organizer: UserRef;
  status: EventStatus;
  participantCount: number;
  carCount: number;
  waitlistCount: number;
  isFull: boolean;
  myStatus: MyEventStatus;
  coverUrl: string | null;
}

export interface EventDetail extends EventSummary {
  description: string;
  cancelReason: string | null;
  cancelledAt: string | null;
  conversationId: Id | null;
  chatReadOnly: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventInput {
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string | null;
  spotId?: Id | null;
  meetingPoint?: { lat: number; lng: number; label?: string } | null;
  maxCars: number;
  minDifficulty?: number | null;
  requirements?: string[];
  visibility?: EventVisibility;
}

export interface EventCreateInput extends EventInput {
  carId: Id;
  seats?: number;
}

export interface EventParticipant {
  user: UserRef;
  status: 'going' | 'waitlist';
  isOrganizer: boolean;
  seats: number;
  car: { id: Id; make: string; model: string; year: number; photoUrl: string | null } | null;
  joinedAt: string;
}

export type EventScope = 'upcoming' | 'mine' | 'past';

// ---------- v3 clan invites ----------
export interface ClanInviteClan { id: Id; name: string; tag: string; logoUrl: string | null }

/** GET /api/clans/:id/invites item (leader/officer view) */
export interface ClanInvite {
  id: Id;
  user: UserRef;
  invitedById: Id | null;
  createdAt: string;
  expiresAt: string;
}

/** GET /api/me/clan-invites item, and the `clan:invite` socket payload */
export interface MyClanInvite {
  id: Id;
  clan: ClanInviteClan;
  invitedBy: UserRef | null;
  createdAt: string;
  expiresAt: string;
}

/** `message:deleted` socket payload */
export interface MessageDeleted { id: Id; conversationId: Id; deletedAt: string }
/** `conversation:pinned` socket payload */
export interface ConversationPinned { conversationId: Id; pinned: Pinned | null }
