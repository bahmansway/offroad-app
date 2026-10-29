import { eq, inArray, sql } from 'drizzle-orm';
import { cars, clanMembers, clans, users } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { imageUrl } from './images.js';
import { DEFAULT_EVENT_LENGTH_MS } from './eventState.js';

/**
 * Scoreboard points, worked out from existing tables (no ledger). Months are Baku calendar months
 * (UTC+4, no daylight saving). Anti-farming caps are per Baku month; all-time is the sum of the months.
 * - spot shared: 10, once it is >= 24 h old and fewer than 2 different users reported it; max 10 spots a month (counted at creation)
 * - event organized: 15, max 4 a month; attended (going when it finished, not the organizer): 5, max 8 a month.
 *   Only events that finished, were not cancelled, lasted >= 1 h (endsAt, or the 24 h default) and had
 *   >= 2 cars going. Counted when the event ends.
 * - car with a photo: 5, only the user's first 2 such cars (by creation time)
 * - rating given (spot or car, not on your own spot): 1, max 20 a month
 */
export const POINTS = { spot: 10, organized: 15, attended: 5, car: 5, rating: 1 } as const;
export const MAX_CARS_COUNTED = 2;
/** Most items of each kind counted per Baku month (all-time = sum of the monthly caps). */
export const MONTHLY_CAPS = { spots: 10, events: 4, attended: 8, ratings: 20 } as const;
/** A spot counts only once it is this old and nobody has reported it. */
export const SPOT_MIN_AGE_HOURS = 24;
/** A spot loses its points once this many different users reported it (one rival's report is not enough). */
export const SPOT_REPORTERS_TO_DROP = 2;
/** Events earn points only if they lasted at least this long and had this many cars going. */
export const MIN_EVENT_MINUTES = 60;
export const MIN_CARS_GOING = 2;
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
        and ${end} - e.starts_at >= interval '${sql.raw(String(MIN_EVENT_MINUTES))} minutes'
        and (select count(*) from event_participants p where p.event_id = e.id and p.status = 'going') >= ${sql.raw(String(MIN_CARS_GOING))}
    ),
    raw as (
      select s.owner_id as user_id, 'spots' as kind, ${POINTS.spot}::int as pts, s.created_at as at, s.id::text as k
      from spots s
      where ${inRange(sql.raw('s.created_at'))}
        and s.created_at <= ${nowIso}::timestamptz - interval '${sql.raw(String(SPOT_MIN_AGE_HOURS))} hours'
        and (select count(distinct r.reporter_id) from reports r where r.target_type = 'spot' and r.target_id = s.id) < ${sql.raw(String(SPOT_REPORTERS_TO_DROP))}
      union all
      select f.organizer_id, 'events', ${POINTS.organized}::int, f.at, f.id::text
      from finished f
      union all
      select p.user_id, 'attended', ${POINTS.attended}::int, f.at, f.id::text
      from finished f
      join event_participants p on p.event_id = f.id
      where p.status = 'going' and p.user_id <> f.organizer_id
      union all
      select r.user_id, 'ratings', ${POINTS.rating}::int, r.at, r.k
      from (
        select sr.user_id, sr.created_at as at, 's' || sr.spot_id::text as k
        from spot_ratings sr join spots s on s.id = sr.spot_id
        where s.owner_id <> sr.user_id
        union all
        select cr.user_id, cr.created_at, 'c' || cr.car_id::text from car_ratings cr
      ) r
      where ${inRange(sql.raw('r.at'))}
    ),
    capped as (
      -- monthly caps per kind (Baku months); the range filter above is month-aligned, so filtering first is safe
      select raw.*,
        row_number() over (
          partition by raw.user_id, raw.kind, date_trunc('month', (raw.at at time zone 'UTC') + interval '4 hours')
          order by raw.at, raw.k
        ) as rn
      from raw
    ),
    act as (
      select user_id, kind, pts, at from capped
      where rn <= case kind
        when 'spots' then ${sql.raw(String(MONTHLY_CAPS.spots))}
        when 'events' then ${sql.raw(String(MONTHLY_CAPS.events))}
        when 'attended' then ${sql.raw(String(MONTHLY_CAPS.attended))}
        else ${sql.raw(String(MONTHLY_CAPS.ratings))} end
      union all
      -- cars: the user's first 2 photo cars ever (not a monthly cap), so rank before the range filter
      select x.owner_id, 'cars', ${POINTS.car}::int, x.created_at
      from (
        select c.owner_id, c.created_at,
          row_number() over (partition by c.owner_id order by c.created_at, c.id) as rn
        from cars c
        where c.photo_image_id is not null
      ) x
      where x.rn <= ${sql.raw(String(MAX_CARS_COUNTED))} and ${inRange(sql.raw('x.created_at'))}
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
