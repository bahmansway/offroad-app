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

export type ReportTarget = 'spot' | 'car' | 'user' | 'message' | 'clan';

export type ErrorCode =
  | 'VALIDATION' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED'
  | 'NETWORK' | 'UNKNOWN';
