// Shapes from SPEC-v1.md "API contract". Ids are treated as opaque strings (numbers also work at runtime).
export type Id = string;
export type SpotType = 'trail' | 'camp';
export type Currency = 'AZN' | 'USD' | 'EUR';
export const MOD_CATEGORIES = [
  'lift', 'tyres', 'wheels', 'recovery', 'armour', 'bumpers',
  'lighting', 'engine', 'suspension', 'interior', 'roof', 'other',
] as const;
export type ModCategory = (typeof MOD_CATEGORIES)[number];

export interface User {
  id: Id;
  displayName: string;
  createdAt: string;
  email?: string;
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
export interface CarSummary {
  id: Id;
  make: string;
  model: string;
  year: number;
  engine?: string | null;
  owner?: Owner;
  ratingAvg?: number | null;
  ratingCount?: number;
  modCount?: number;
  createdAt?: string;
}

export interface Car {
  id: Id;
  make: string;
  model: string;
  year: number;
  engine: string | null;
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

export interface CarInput {
  make: string;
  model: string;
  year: number;
  engine?: string | null;
  description?: string | null;
}

export interface PublicUser {
  id: Id;
  displayName: string;
  createdAt: string;
  cars: CarSummary[];
  spotCount: number;
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

export type ReportTarget = 'spot' | 'car' | 'user';

export type ErrorCode =
  | 'VALIDATION' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED'
  | 'NETWORK' | 'UNKNOWN';
