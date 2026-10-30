import { formatNumber, sameId, type Lang } from './format';
import type { Id, Leaderboard, LeaderboardBreakdown, LeaderboardItem } from './types';

/**
 * Scoreboard rules, exactly as the server counts them (server/src/lib/leaderboard.ts).
 * Shown in the "Xallar necə qazanılır?" sheet; keep both in step.
 */
export const POINT_RULES = {
  spot: 10, spotsPerMonth: 10, spotMinAgeHours: 24, spotReportersToDrop: 2,
  organized: 15, organizedPerMonth: 4,
  attended: 5, attendedPerMonth: 8,
  minEventMinutes: 60, minCarsGoing: 2,
  car: 5, carsCounted: 2,
  rating: 1, ratingsPerMonth: 20,
  cacheMinutes: 5,
} as const;

export const BOARD_SIZE = 20;
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Top 3 for the podium, ranks 4–20 for the list. */
export function splitBoard(items: LeaderboardItem[]): { podium: LeaderboardItem[]; rest: LeaderboardItem[] } {
  const sorted = [...items].sort((a, b) => a.rank - b.rank).slice(0, BOARD_SIZE);
  return { podium: sorted.slice(0, 3), rest: sorted.slice(3) };
}

/** Podium left-to-right: 2nd, 1st, 3rd (missing places are left out). */
export function podiumOrder<X extends { rank: number }>(podium: X[]): X[] {
  const [first, second, third] = [...podium].sort((a, b) => a.rank - b.rank);
  return [second, first, third].filter((x): x is X => !!x);
}

/** "#7", or "—" without a rank. */
export function rankText(rank: number | null | undefined): string {
  return rank && rank > 0 ? `#${rank}` : '—';
}

/** "1 250" (az) / "1,250" (en). */
export function formatPoints(n: number, lang: Lang): string {
  return formatNumber(Math.max(0, Math.round(n || 0)), lang);
}

export type MeBar =
  | { kind: 'hidden' } // logged out
  | { kind: 'none' } // logged in, no points this period
  | { kind: 'ranked'; rank: number; points: number; inTop: boolean };

/** The sticky "Sizin yeriniz" bar. */
export function meBarState(board: Pick<Leaderboard, 'me' | 'items'> | null | undefined, myId: Id | null | undefined): MeBar {
  if (!board?.me || !myId) return { kind: 'hidden' };
  const { rank, points } = board.me;
  if (!rank || points <= 0) return { kind: 'none' };
  return { kind: 'ranked', rank, points, inTop: board.items.some((i) => sameId(i.user.id, myId)) };
}

export const BREAKDOWN_KEYS: (keyof LeaderboardBreakdown)[] = ['spots', 'events', 'attended', 'cars', 'ratings'];

/** Non-zero parts of a breakdown, in a fixed order. */
export function breakdownParts(b: LeaderboardBreakdown | null | undefined): { key: keyof LeaderboardBreakdown; points: number }[] {
  if (!b) return [];
  return BREAKDOWN_KEYS.filter((k) => (b[k] ?? 0) > 0).map((k) => ({ key: k, points: b[k] }));
}

/** Month index (0–11) and year of the Baku month that starts at `monthStart` (a UTC instant). */
export function bakuMonthOf(monthStart: string): { month: number; year: number } | null {
  const ms = Date.parse(monthStart);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + BAKU_OFFSET_MS);
  return { month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

/** "Noyabr 2026" from the month names list. */
export function monthTitle(monthStart: string, months: readonly string[]): string {
  const m = bakuMonthOf(monthStart);
  if (!m) return '';
  const name = months[m.month] ?? '';
  return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)} ${m.year}`;
}
