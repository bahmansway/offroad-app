// Client-side checks that mirror the server limits in SPEC-v1.md (the server validates again).
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
