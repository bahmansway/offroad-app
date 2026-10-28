import { z } from 'zod';

export const ratingSchema = z.object({ stars: z.number().int().min(1).max(5) }).strict();

/** Average rounded to 1 decimal; null when there are no ratings yet. */
export const round1 = (n: number | null | undefined): number | null =>
  n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10;
