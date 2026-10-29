import { eq, inArray, sql } from 'drizzle-orm';
import { cars, clanMembers, clans, users } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { imageUrl } from './images.js';
import { DEFAULT_EVENT_LENGTH_MS } from './eventState.js';

/**
 * Scoreboard points, worked out from existing tables (no ledger). Months are Baku calendar months
 * (UTC+4, no daylight saving).
 * - spot shared: 10 (spot row still exists)
 * - event organized, finished, not cancelled, >= 2 cars going: 15 (counted when the event ends)
 * - event attended (going when it finished, not the organizer): 5 (counted when the event ends)
 * - car with a photo: 5, only the user's first 2 such cars (by creation time)
 * - rating given (spot or car, not on your own spot): 1, max 20 per Baku month
 */
export const POINTS = { spot: 10, organized: 15, attended: 5, car: 5, rating: 1 } as const;
export const MAX_CARS_COUNTED = 2;
export const MAX_RATINGS_PER_MONTH = 20;
export const LEADERBOARD_SIZE = 20;
export const LEADERBOARD_CACHE_MS = 5 * 60 * 1000;
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

export type Period = 'month' | 'all';
export type Breakdown = { spots: number; events: number; attended: number; cars: number; ratings: number };

/** Start of the Baku calendar month containing `now`, and the start of the next one (as UTC instants). */
export function bakuMonth(now: Date) {
  const local = new Date(now.getTime() + BAKU_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - BAKU_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - BAKU_OFFSET_MS),
  };
}

export type RankRow = { userId: string; points: number; breakdown: Breakdown; firstAt: Date };

/** Everyone with points in the period, best first. Ties: earlier first activity wins, then user id. */
export async function computeRanking(db: Db, period: Period, now = new Date()): Promise<RankRow[]> {
  const m = bakuMonth(now);
  const from = period === 'month' ? m.start : new Date(0);
  const to = period === 'month' ? m.end : new Date('9999-12-31T00:00:00Z');
  const nowIso = now.toISOString();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const end = sql.raw(`coalesce(e.ends_at, e.starts_at + interval '${DEFAULT_EVENT_LENGTH_MS / 1000} seconds')`);
  const inRange = (col: ReturnType<typeof sql.raw> | ReturnType<typeof sql>) =>
    sql`${col} >= ${fromIso}::timestamptz and ${col} < ${toIso}::timestamptz and ${col} <= ${nowIso}::timestamptz`;
  const result = await db.execute<{
    user_id: string;
    points: number;
    spots: number;
    events: number;
    attended: number;
    cars: number;
    ratings: number;
    first_at: Date | string;
  }>(sql`
    with finished as (
      select e.id, e.organizer_id, ${end} as at
      from events e
      where e.status = 'scheduled' and ${inRange(end)}
    ),
    act as (
      select s.owner_id as user_id, 'spots' as kind, ${POINTS.spot}::int as pts, s.created_at as at
      from spots s
      where ${inRange(sql.raw('s.created_at'))}
      union all
      select f.organizer_id, 'events', ${POINTS.organized}::int, f.at
      from finished f
      where (select count(*) from event_participants p where p.event_id = f.id and p.status = 'going') >= 2
      union all
      select p.user_id, 'attended', ${POINTS.attended}::int, f.at
      from finished f
      join event_participants p on p.event_id = f.id
      where p.status = 'going' and p.user_id <> f.organizer_id
      union all
      select x.owner_id, 'cars', ${POINTS.car}::int, x.created_at
      from (
        select c.owner_id, c.created_at,
          row_number() over (partition by c.owner_id order by c.created_at, c.id) as rn
        from cars c
        where c.photo_image_id is not null
      ) x
      where x.rn <= ${MAX_CARS_COUNTED} and ${inRange(sql.raw('x.created_at'))}
      union all
      select y.user_id, 'ratings', ${POINTS.rating}::int, y.at
      from (
        select r.user_id, r.at,
          row_number() over (
            partition by r.user_id, date_trunc('month', (r.at at time zone 'UTC') + interval '4 hours')
            order by r.at, r.k
          ) as rn
        from (
          select sr.user_id, sr.created_at as at, sr.spot_id::text as k
          from spot_ratings sr join spots s on s.id = sr.spot_id
          where s.owner_id <> sr.user_id
          union all
          select cr.user_id, cr.created_at, cr.car_id::text from car_ratings cr
        ) r
      ) y
      where y.rn <= ${MAX_RATINGS_PER_MONTH} and ${inRange(sql.raw('y.at'))}
    )
    select a.user_id,
      sum(a.pts)::int as points,
      coalesce(sum(a.pts) filter (where a.kind = 'spots'), 0)::int as spots,
      coalesce(sum(a.pts) filter (where a.kind = 'events'), 0)::int as events,
      coalesce(sum(a.pts) filter (where a.kind = 'attended'), 0)::int as attended,
      coalesce(sum(a.pts) filter (where a.kind = 'cars'), 0)::int as cars,
      coalesce(sum(a.pts) filter (where a.kind = 'ratings'), 0)::int as ratings,
      min(a.at) as first_at
    from act a
    join users u on u.id = a.user_id
    group by a.user_id
    order by points desc, first_at asc, a.user_id asc
  `);
  return result.rows.map((r) => ({
    userId: r.user_id,
    points: r.points,
    breakdown: { spots: r.spots, events: r.events, attended: r.attended, cars: r.cars, ratings: r.ratings },
    firstAt: new Date(r.first_at),
  }));
}

/** User shape on the board: avatar, current car and clan tag. */
async function boardUsers(db: Db, ids: string[]) {
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarImageId: users.avatarImageId,
      carId: cars.id,
      make: cars.make,
      model: cars.model,
      year: cars.year,
      photoImageId: cars.photoImageId,
      clanId: clans.id,
      clanName: clans.name,
      clanTag: clans.tag,
    })
    .from(users)
    .leftJoin(cars, eq(cars.id, users.currentCarId))
    .leftJoin(clanMembers, eq(clanMembers.userId, users.id))
    .leftJoin(clans, eq(clans.id, clanMembers.clanId))
    .where(inArray(users.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        displayName: r.displayName,
        avatarUrl: imageUrl(r.avatarImageId),
        currentCar: r.carId
          ? { id: r.carId, make: r.make!, model: r.model!, year: r.year!, photoUrl: imageUrl(r.photoImageId) }
          : null,
        clan: r.clanId ? { id: r.clanId, name: r.clanName!, tag: r.clanTag! } : null,
      },
    ]),
  );
}

export async function buildBoard(db: Db, period: Period, now = new Date()) {
  const ranking = await computeRanking(db, period, now);
  const ranks = new Map(ranking.map((r, i) => [r.userId, { rank: i + 1, points: r.points }]));
  const top = ranking.slice(0, LEADERBOARD_SIZE);
  const people = await boardUsers(db, top.map((r) => r.userId));
  return {
    period,
    monthStart: bakuMonth(now).start.toISOString(),
    computedAt: now.toISOString(),
    items: top
      .filter((r) => people.has(r.userId))
      .map((r) => ({ rank: ranks.get(r.userId)!.rank, user: people.get(r.userId), points: r.points, breakdown: r.breakdown })),
    ranks,
  };
}
export type Board = Awaited<ReturnType<typeof buildBoard>>;

/** 5-minute in-memory cache per period (one per app instance). */
export function createLeaderboard(db: Db, ttlMs = LEADERBOARD_CACHE_MS) {
  const cache = new Map<Period, { expires: number; board: Promise<Board> }>();
  return {
    get(period: Period): Promise<Board> {
      const hit = cache.get(period);
      if (hit && hit.expires > Date.now()) return hit.board;
      const board = buildBoard(db, period);
      cache.set(period, { expires: Date.now() + ttlMs, board });
      board.catch(() => cache.delete(period));
      return board;
    },
    clear() {
      cache.clear();
    },
  };
}
export type Leaderboard = ReturnType<typeof createLeaderboard>;
