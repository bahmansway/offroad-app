import { createApiClient } from './apiClient';
import { tokenStore, withLock } from './tokenStore';
import { API_URL } from './config';
import type {
  AuthResponse, Car, CarInput, CarSummary, CatalogBrand, CatalogModel, Clan, ClanInput, ClanMember, ClanRequest,
  Conversation, Id, MeInput, Message, Mod, ModInput, PublicUser, RatingResult, ReportTarget, Spot, SpotInput,
  SpotType, Trim, User, UserRef,
} from './types';
import { toArray } from './catalog';

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
  updateMe: (b: MeInput) => r<User>('/api/me', { method: 'PATCH', body: b }),
  uploadAvatar: (data: Uint8Array, contentType = 'image/jpeg') =>
    r<{ avatarUrl: string | null }>('/api/me/avatar', { method: 'PUT', binary: { data, contentType } }),
  deleteAvatar: () => r<void>('/api/me/avatar', { method: 'DELETE' }),

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
  uploadCarPhoto: (id: Id, data: Uint8Array, contentType = 'image/jpeg') =>
    r<{ photoUrl: string | null }>(`/api/cars/${enc(id)}/photo`, { method: 'PUT', binary: { data, contentType } }),
  deleteCarPhoto: (id: Id) => r<void>(`/api/cars/${enc(id)}/photo`, { method: 'DELETE' }),

  // car catalog (public). Accepts a bare array or {items} so either server shape works.
  catalogBrands: async () => toArray<CatalogBrand>(await r<unknown>('/api/catalog/brands', { auth: false })),
  catalogModels: async (brand: string) =>
    toArray<CatalogModel>(await r<unknown>('/api/catalog/models', { query: { brand }, auth: false })),
  catalogTrims: async (brand: string, model: string, year?: number) =>
    toArray<Trim>(await r<unknown>('/api/catalog/trims', { query: { brand, model, year }, auth: false })),

  // clans
  clans: (q?: string) => r<{ items: Clan[] }>('/api/clans', { query: { q } }),
  clan: (id: Id) => r<Clan>(`/api/clans/${enc(id)}`),
  createClan: (b: ClanInput) => r<Clan>('/api/clans', { method: 'POST', body: b }),
  updateClan: (id: Id, b: Partial<ClanInput>) => r<Clan>(`/api/clans/${enc(id)}`, { method: 'PATCH', body: b }),
  deleteClan: (id: Id) => r<void>(`/api/clans/${enc(id)}`, { method: 'DELETE' }),
  uploadClanLogo: (id: Id, data: Uint8Array, contentType = 'image/jpeg') =>
    r<{ logoUrl: string | null }>(`/api/clans/${enc(id)}/logo`, { method: 'PUT', binary: { data, contentType } }),
  deleteClanLogo: (id: Id) => r<void>(`/api/clans/${enc(id)}/logo`, { method: 'DELETE' }),
  joinClan: (id: Id) => r<Clan>(`/api/clans/${enc(id)}/join`, { method: 'POST' }),
  leaveClan: (id: Id) => r<Clan>(`/api/clans/${enc(id)}/leave`, { method: 'POST' }),
  clanMembers: (id: Id) => r<{ items: ClanMember[] }>(`/api/clans/${enc(id)}/members`),
  clanRequests: (id: Id) => r<{ items: ClanRequest[] }>(`/api/clans/${enc(id)}/requests`),
  approveRequest: (id: Id, userId: Id) =>
    r<void>(`/api/clans/${enc(id)}/requests/${enc(userId)}/approve`, { method: 'POST' }),
  rejectRequest: (id: Id, userId: Id) =>
    r<void>(`/api/clans/${enc(id)}/requests/${enc(userId)}/reject`, { method: 'POST' }),
  removeMember: (id: Id, userId: Id) => r<void>(`/api/clans/${enc(id)}/members/${enc(userId)}`, { method: 'DELETE' }),
  handOver: (id: Id, userId: Id) => r<Clan>(`/api/clans/${enc(id)}/leader`, { method: 'POST', body: { userId } }),

  // chat
  conversations: () => r<Conversation[]>('/api/conversations'),
  conversation: (id: Id) => r<Conversation>(`/api/conversations/${enc(id)}`),
  startDm: (userId: Id) => r<Conversation>('/api/conversations/dm', { method: 'POST', body: { userId } }),
  messages: (id: Id, q: { before?: Id; limit?: number } = {}) =>
    r<{ items: Message[]; hasMore: boolean }>(`/api/conversations/${enc(id)}/messages`, { query: q }),
  sendMessage: (id: Id, text: string, clientId: string) =>
    r<Message>(`/api/conversations/${enc(id)}/messages`, { method: 'POST', body: { text, clientId } }),
  markRead: (id: Id) => r<void>(`/api/conversations/${enc(id)}/read`, { method: 'POST' }),

  // safety
  block: (userId: Id) => r<void>(`/api/users/${enc(userId)}/block`, { method: 'POST' }),
  unblock: (userId: Id) => r<void>(`/api/users/${enc(userId)}/block`, { method: 'DELETE' }),
  blocks: () => r<{ items: UserRef[] }>('/api/me/blocks'),

  // other
  user: (id: Id) => r<PublicUser>(`/api/users/${enc(id)}`),
  report: (b: { targetType: ReportTarget; targetId: Id; reason: string }) =>
    r<unknown>('/api/reports', { method: 'POST', body: b }),
};
