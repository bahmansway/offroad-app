import { createApiClient } from './apiClient';
import { tokenStore, withLock } from './tokenStore';
import { API_URL } from './config';
import type {
  AuthResponse, Car, CarInput, CarSummary, Id, Mod, ModInput, PublicUser, RatingResult,
  ReportTarget, Spot, SpotInput, SpotType, User,
} from './types';

let authLostHandler: (() => void) | null = null;
export function onAuthLost(fn: (() => void) | null) {
  authLostHandler = fn;
}

export const client = createApiClient({
  baseUrl: API_URL,
  store: tokenStore,
  lock: withLock,
  onAuthLost: () => authLostHandler?.(),
});

const r = client.request;
const enc = encodeURIComponent;

export const api = {
  // auth
  register: (b: { email: string; password: string; displayName: string }) =>
    r<AuthResponse>('/api/auth/register', { method: 'POST', body: b, auth: false }),
  login: (b: { email: string; password: string }) =>
    r<AuthResponse>('/api/auth/login', { method: 'POST', body: b, auth: false }),
  logout: (refreshToken: string) =>
    r<void>('/api/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }),
  me: () => r<User>('/api/me'),

  // spots
  spots: (q: { type?: SpotType; minLevel?: number; maxLevel?: number; q?: string } = {}) =>
    r<{ items: Spot[] }>('/api/spots', { query: q }),
  spot: (id: Id) => r<Spot>(`/api/spots/${enc(id)}`),
  createSpot: (b: SpotInput) => r<Spot>('/api/spots', { method: 'POST', body: b }),
  updateSpot: (id: Id, b: Partial<SpotInput>) => r<Spot>(`/api/spots/${enc(id)}`, { method: 'PATCH', body: b }),
  deleteSpot: (id: Id) => r<void>(`/api/spots/${enc(id)}`, { method: 'DELETE' }),
  rateSpot: (id: Id, stars: number) =>
    r<RatingResult>(`/api/spots/${enc(id)}/rating`, { method: 'PUT', body: { stars } }),

  // cars & mods
  cars: (userId?: Id) => r<{ items: CarSummary[] }>('/api/cars', { query: { userId } }),
  car: (id: Id) => r<Car>(`/api/cars/${enc(id)}`),
  createCar: (b: CarInput) => r<Car>('/api/cars', { method: 'POST', body: b }),
  updateCar: (id: Id, b: Partial<CarInput>) => r<Car>(`/api/cars/${enc(id)}`, { method: 'PATCH', body: b }),
  deleteCar: (id: Id) => r<void>(`/api/cars/${enc(id)}`, { method: 'DELETE' }),
  addMod: (carId: Id, b: ModInput) => r<Mod>(`/api/cars/${enc(carId)}/mods`, { method: 'POST', body: b }),
  updateMod: (id: Id, b: Partial<ModInput>) => r<Mod>(`/api/mods/${enc(id)}`, { method: 'PATCH', body: b }),
  deleteMod: (id: Id) => r<void>(`/api/mods/${enc(id)}`, { method: 'DELETE' }),
  rateCar: (id: Id, stars: number) =>
    r<RatingResult>(`/api/cars/${enc(id)}/rating`, { method: 'PUT', body: { stars } }),

  // other
  user: (id: Id) => r<PublicUser>(`/api/users/${enc(id)}`),
  report: (b: { targetType: ReportTarget; targetId: Id; reason: string }) =>
    r<unknown>('/api/reports', { method: 'POST', body: b }),
};
