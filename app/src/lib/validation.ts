// Client-side checks that mirror the server limits in SPEC-v1.md / SPEC-v2.md (the server validates again).
import { DRIVES, FUELS, TRANSMISSIONS } from './types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const len = (s: string) => s.trim().length;
export const between = (s: string, min: number, max: number) => len(s) >= min && len(s) <= max;

export function validateRegister(v: { email: string; password: string; displayName: string }) {
  return {
    email: EMAIL_RE.test(v.email.trim()) && v.email.trim().length <= 254 ? null : 'auth.emailInvalid',
    password: v.password.length >= 8 && v.password.length <= 128 ? null : 'auth.passwordShort',
    displayName: between(v.displayName, 2, 40) ? null : 'auth.nameInvalid',
  };
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 24);
}

export const maxCarYear = () => new Date().getFullYear() + 1;

export function hasErrors(e: Record<string, string | null>): boolean {
  return Object.values(e).some(Boolean);
}

/** "2,8" / "2.8" → 2.8; empty → null; junk → NaN. */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

export function parseIntOrNull(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

export interface CarFormValues {
  make: string; model: string; year: string; engine: string; engineL: string; hp: string;
  drive: string | null; transmission: string | null; fuel: string | null; color: string; description: string;
}

/** Returns translation keys of the errors (null = ok). Limits from SPEC-v2 §2. */
export function validateCar(v: CarFormValues) {
  const y = Number(v.year);
  const l = parseDecimal(v.engineL);
  const hp = parseIntOrNull(v.hp);
  return {
    make: between(v.make, 1, 40) ? null : 'garage.makeInvalid',
    model: between(v.model, 1, 60) ? null : 'garage.modelInvalid',
    year: /^\d{4}$/.test(v.year.trim()) && y >= 1950 && y <= maxCarYear() ? null : 'garage.yearInvalid',
    engine: len(v.engine) <= 40 ? null : 'garage.engineTooLong',
    engineL: l === null || (l >= 0.5 && l <= 10) ? null : 'specs.engineLInvalid',
    hp: hp === null || (Number.isInteger(hp) && hp >= 20 && hp <= 2000) ? null : 'specs.hpInvalid',
    drive: v.drive === null || (DRIVES as string[]).includes(v.drive) ? null : 'errors.validation',
    transmission: v.transmission === null || (TRANSMISSIONS as string[]).includes(v.transmission) ? null : 'errors.validation',
    fuel: v.fuel === null || (FUELS as string[]).includes(v.fuel) ? null : 'errors.validation',
    color: len(v.color) <= 30 ? null : 'specs.colorTooLong',
    description: len(v.description) <= 1000 ? null : 'garage.descriptionTooLong',
  };
}

export function validateProfile(v: { displayName: string; city: string; bio: string }) {
  return {
    displayName: between(v.displayName, 2, 40) ? null : 'auth.nameInvalid',
    city: len(v.city) <= 60 ? null : 'profile.cityTooLong',
    bio: len(v.bio) <= 300 ? null : 'profile.bioTooLong',
  };
}

/** Same rules as the server's clan schema (SPEC-v2 §4). Tag: 2–5 letters/digits, any alphabet. */
export const CLAN_TAG_RE = /^[\p{L}\p{N}]{2,5}$/u;

export function validateClan(v: { name: string; tag: string; city: string; description: string }) {
  return {
    name: between(v.name, 3, 40) ? null : 'clan.nameInvalid',
    tag: CLAN_TAG_RE.test(v.tag.trim()) ? null : 'clan.tagInvalid',
    city: len(v.city) <= 60 ? null : 'clan.cityInvalid',
    description: len(v.description) <= 500 ? null : 'clan.descriptionInvalid',
  };
}
