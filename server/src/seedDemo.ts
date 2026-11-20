/**
 * Demo data for the live app, so testers see a full community: 33 demo drivers with cars and mods,
 * spots, ratings, 4 clans with chats, friends, DMs, group chats, past + upcoming events.
 *
 * - Everything belongs to accounts with an email ending in @demo.yolchu.az; removeDemo() deletes exactly that.
 * - Inserts go straight into the database (no API, so no rate limits), in one transaction.
 * - Password: DEMO_PASSWORD env var (never stored in code, never logged). Same argon2 settings as sign-up.
 * - Photos are generated in-process and go through the normal image pipeline (re-encode, size limits, quota).
 * - Idempotent: if any demo account exists, seeding does nothing.
 * - Runs on startup only with DEMO_SEED=1 (or DEMO_REMOVE=1), see demoFromEnv(). Also `npm run seed:demo` / `remove:demo`.
 */
import argon2 from 'argon2';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './db/index.js';
import {
  carRatings,
  cars,
  clanMembers,
  clanRequests,
  clans,
  conversationMembers,
  conversations,
  eventParticipants,
  events,
  friendRequests,
  friendships,
  messages,
  mods,
  spotRatings,
  spots,
  users,
} from './db/schema.js';
import { ARGON2_OPTS } from './routes/auth.js';
import { TRIMS } from './routes/catalog.js';
import { processImage, saveImage } from './lib/images.js';
import { insertSystemMessage } from './lib/messages.js';
import {
  CLAN_CHATS,
  CLANS,
  COLOR_HEX,
  DEMO_EMAIL_DOMAIN,
  DMS,
  EVENTS,
  FRIEND_REQUESTS,
  GROUPS,
  SPOTS,
  USERS,
  type ClanTag,
  type Line,
} from './demo/data.js';
import { avatarPng, carPng, logoPng, rng } from './demo/pictures.js';

export { DEMO_EMAIL_DOMAIN };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BAKU_OFFSET = 4 * HOUR;

/** SQL list of all demo user ids. Demo emails are stored lower-case. */
const demoIds = sql.raw(`(select id from users where lower(email) like '%@${DEMO_EMAIL_DOMAIN}')`);

/** Subtle markers so real testers know this is demo content (bios, upcoming events). */
export const DEMO_BIO_MARK = 'Demo hesab';
export const DEMO_EVENT_MARK = '— Demo tədbir, real deyil.';
/** Demo password minimum length. */
export const DEMO_PASSWORD_MIN = 16;

export const demoEmail = (slug: string) => `${slug}@${DEMO_EMAIL_DOMAIN}`;

export type DemoCounts = {
  users: number;
  cars: number;
  mods: number;
  spots: number;
  spotRatings: number;
  carRatings: number;
  clans: number;
  clanRequests: number;
  friendships: number;
  friendRequests: number;
  events: number;
  conversations: number;
  messages: number;
  images: number;
};

export async function hasDemo(db: Db | Tx) {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${demoIds} d`);
  return r.rows[0].n > 0;
}

export async function seedDemo(
  db: Db,
  opts: { password?: string; now?: Date } = {},
): Promise<{ skipped: true } | { skipped: false; counts: DemoCounts }> {
  const password = opts.password ?? process.env.DEMO_PASSWORD;
  if (!password || password.length < DEMO_PASSWORD_MIN) {
    throw new Error(`DEMO_PASSWORD (at least ${DEMO_PASSWORD_MIN} characters) is required to seed demo data`);
  }
  if (await hasDemo(db)) return { skipped: true };

  const now = opts.now ?? new Date();
  const latest = new Date(now.getTime() - 60 * 1000);
  const rand = rng(20261120);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const between = (a: Date, b: Date) => new Date(a.getTime() + rand() * Math.max(0, b.getTime() - a.getTime()));
  const cap = (d: Date) => (d.getTime() > latest.getTime() ? latest : d);
  /** Baku local date `day` days from today (negative = past) at `hour` (decimal hours). */
  const bakuDay = (day: number, hour: number) => {
    const local = new Date(now.getTime() + BAKU_OFFSET);
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - BAKU_OFFSET;
    return new Date(midnight + day * DAY + hour * HOUR);
  };
  const lineAt = (l: Line) => cap(bakuDay(-l[2], l[3]));

  const counts: DemoCounts = {
    users: 0, cars: 0, mods: 0, spots: 0, spotRatings: 0, carRatings: 0, clans: 0, clanRequests: 0,
    friendships: 0, friendRequests: 0, events: 0, conversations: 0, messages: 0, images: 0,
  };
  const passwordHash = await argon2.hash(password, ARGON2_OPTS);

  // Pictures are rendered before the transaction (CPU work, no locks held).
  const avatarPics = new Map<string, Buffer>();
  const carPics = new Map<string, Buffer>();
  const logoPics = new Map<ClanTag, Buffer>();
  for (const u of USERS) {
    if (u.avatar) avatarPics.set(u.slug, await avatarPng(u.slug));
    for (const [i, c] of u.cars.entries()) {
      if (c.photo) carPics.set(`${u.slug}#${i}`, await carPng(`${u.slug}#${i}`, COLOR_HEX[c.color] ?? '#888888', c.body));
    }
  }
  for (const c of CLANS) logoPics.set(c.tag, await logoPng(c.tag, c.hue));

  await db.transaction(async (tx) => {
    // re-check inside the transaction (two instances starting at once)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('yolchu-demo-seed'))`);
    if (await hasDemo(tx)) throw new SkipSignal();

    const img = async (ownerId: string, kind: 'avatar' | 'car' | 'clan', png: Buffer) => {
      counts.images++;
      return saveImage(tx, ownerId, kind, await processImage(png, kind));
    };

    // ---------------- users ----------------
    const U = new Map<string, { id: string; name: string; created: Date }>();
    for (const u of USERS) {
      const created = bakuDay(-u.since, 9 + rand() * 12);
      const [row] = await tx
        .insert(users)
        .values({ email: demoEmail(u.slug), passwordHash, displayName: u.display, bio: `${u.bio} · ${DEMO_BIO_MARK}`, city: u.city, createdAt: created })
        .returning({ id: users.id });
      U.set(u.slug, { id: row.id, name: u.display, created });
      counts.users++;
    }
    const uid = (slug: string) => {
      const x = U.get(slug);
      if (!x) throw new Error(`demo data: unknown user ${slug}`);
      return x;
    };
    const notBefore = (slug: string, d: Date) => (d < uid(slug).created ? new Date(uid(slug).created.getTime() + HOUR) : d);

    for (const u of USERS) {
      const pic = avatarPics.get(u.slug);
      if (pic) {
        const id = await img(uid(u.slug).id, 'avatar', pic);
        await tx.update(users).set({ avatarImageId: id }).where(eq(users.id, uid(u.slug).id));
      }
    }

    // ---------------- cars + mods ----------------
    const trimById = new Map(TRIMS.map((t) => [t.id, t]));
    const carIds = new Map<string, string[]>();
    const carRows: { id: string; owner: string; created: Date }[] = [];
    for (const u of USERS) {
      const owner = uid(u.slug);
      const ids: string[] = [];
      for (const [i, c] of u.cars.entries()) {
        const t = c.trim ? trimById.get(c.trim) : undefined;
        if (c.trim && !t) throw new Error(`demo data: unknown trim ${c.trim}`);
        const created = cap(new Date(owner.created.getTime() + (1 + i * 12 + rand() * 10) * DAY));
        const [row] = await tx
          .insert(cars)
          .values({
            ownerId: owner.id,
            make: c.make,
            model: c.model,
            year: c.year,
            trimId: t?.id ?? null,
            engine: t?.engine ?? c.engine ?? null,
            engineL: t?.engineL ?? c.engineL ?? null,
            hp: t?.hp ?? c.hp ?? null,
            drive: t?.drive ?? '4WD',
            transmission: t?.transmission ?? c.transmission ?? null,
            fuel: t?.fuel ?? c.fuel ?? null,
            color: c.color,
            description: c.description ?? null,
            createdAt: created,
          })
          .returning({ id: cars.id });
        counts.cars++;
        ids.push(row.id);
        carRows.push({ id: row.id, owner: u.slug, created });
        const pic = carPics.get(`${u.slug}#${i}`);
        if (pic) await tx.update(cars).set({ photoImageId: await img(owner.id, 'car', pic) }).where(eq(cars.id, row.id));
        for (const [k, md] of (c.mods ?? []).entries()) {
          await tx.insert(mods).values({
            carId: row.id,
            name: md.name,
            category: md.category,
            price: md.price,
            currency: md.currency ?? 'AZN',
            pricePublic: !md.private,
            createdAt: cap(new Date(created.getTime() + (k + 1) * (2 + rand() * 8) * DAY)),
          });
          counts.mods++;
        }
      }
      carIds.set(u.slug, ids);
      await tx.update(users).set({ currentCarId: ids[0] }).where(eq(users.id, owner.id));
    }
    const firstCar = (slug: string) => carIds.get(slug)![0];

    // ---------------- spots ----------------
    const spotIds = new Map<string, string>();
    const spotRows: { id: string; owner: string; created: Date }[] = [];
    for (const s of SPOTS) {
      const created = notBefore(s.owner, new Date(now.getTime() - s.daysAgo * DAY - rand() * 10 * HOUR));
      const [row] = await tx
        .insert(spots)
        .values({
          ownerId: uid(s.owner).id,
          type: s.type,
          name: s.name,
          description: s.description,
          lat: s.lat,
          lng: s.lng,
          difficulty: s.type === 'trail' ? s.d! : null,
          season: s.season,
          tags: s.tags,
          createdAt: created,
        })
        .returning({ id: spots.id });
      spotIds.set(s.name, row.id);
      spotRows.push({ id: row.id, owner: s.owner, created });
      counts.spots++;
    }

    // ---------------- ratings (never your own car; not your own spot) ----------------
    const slugs = USERS.map((u) => u.slug);
    const stars = () => pick([5, 5, 5, 4, 4, 4, 3]);
    const raters = (owner: string, n: number) => {
      const pool = slugs.filter((s) => s !== owner);
      const out: string[] = [];
      while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      return out;
    };
    for (const s of spotRows) {
      for (const r of raters(s.owner, 2 + Math.floor(rand() * 7))) {
        const at = cap(between(notBefore(r, new Date(s.created.getTime() + 2 * HOUR)), latest));
        await tx.insert(spotRatings).values({ spotId: s.id, userId: uid(r).id, stars: stars(), createdAt: at, updatedAt: at });
        counts.spotRatings++;
      }
    }
    for (const c of carRows) {
      if (rand() > 0.72) continue;
      for (const r of raters(c.owner, 1 + Math.floor(rand() * 5))) {
        const at = cap(between(notBefore(r, new Date(c.created.getTime() + 2 * HOUR)), latest));
        await tx.insert(carRatings).values({ carId: c.id, userId: uid(r).id, stars: stars(), createdAt: at, updatedAt: at });
        counts.carRatings++;
      }
    }

    // ---------------- clans ----------------
    const clanIds = new Map<ClanTag, { id: string; convId: string }>();
    const clanOf = new Map<string, ClanTag>();
    for (const c of CLANS) {
      const created = bakuDay(-c.since, 11);
      const leader = USERS.find((u) => u.clan === c.tag && u.role === 'leader')!;
      const [row] = await tx
        .insert(clans)
        .values({
          name: c.name,
          nameKey: c.name.toLowerCase(),
          tag: c.tag.toUpperCase(),
          description: c.description,
          city: c.city,
          isOpen: c.isOpen,
          leaderId: uid(leader.slug).id,
          createdAt: created,
        })
        .returning({ id: clans.id });
      await tx.update(clans).set({ logoImageId: await img(uid(leader.slug).id, 'clan', logoPics.get(c.tag)!) }).where(eq(clans.id, row.id));
      const [conv] = await tx
        .insert(conversations)
        .values({ type: 'clan', clanId: row.id, createdAt: created, updatedAt: created })
        .returning({ id: conversations.id });
      clanIds.set(c.tag, { id: row.id, convId: conv.id });
      counts.clans++;
      counts.conversations++;
      for (const u of USERS.filter((x) => x.clan === c.tag)) {
        const joined = u.role === 'leader' ? created : bakuDay(-(u.joined ?? 60), 10);
        await tx.insert(clanMembers).values({ userId: uid(u.slug).id, clanId: row.id, role: u.role ?? 'member', joinedAt: joined });
        await tx.insert(conversationMembers).values({ conversationId: conv.id, userId: uid(u.slug).id, joinedAt: joined, lastReadAt: latest });
        clanOf.set(u.slug, c.tag);
      }
      for (const r of c.requests) {
        await tx.insert(clanRequests).values({ clanId: row.id, userId: uid(r).id, createdAt: cap(bakuDay(-(1 + Math.floor(rand() * 5)), 12 + rand() * 8)) });
        counts.clanRequests++;
      }
      let last = created;
      let pinId: string | null = null;
      for (const l of CLAN_CHATS[c.tag]) {
        if (clanOf.get(l[0]) !== c.tag) throw new Error(`demo data: ${l[0]} is not in ${c.tag}`);
        const at = lineAt(l);
        const [msg] = await tx
          .insert(messages)
          .values({ conversationId: conv.id, senderId: uid(l[0]).id, text: l[1], createdAt: at })
          .returning({ id: messages.id });
        counts.messages++;
        if (at > last) last = at;
        if (c.tag === 'DMK' && l[1].includes('klan gəzintisi')) pinId = msg.id;
      }
      await tx
        .update(conversations)
        .set({
          updatedAt: last,
          ...(pinId ? { pinnedMessageId: pinId, pinnedById: uid('elnur.aliyev').id, pinnedAt: last } : {}),
        })
        .where(eq(conversations.id, conv.id));
    }

    // ---------------- friendships (3–10 each) ----------------
    const friends = new Map<string, Set<string>>(slugs.map((s) => [s, new Set<string>()]));
    const pending = new Set(FRIEND_REQUESTS.map(([a, b]) => [a, b].sort().join('|')));
    const link = (a: string, b: string) => {
      if (a === b || pending.has([a, b].sort().join('|'))) return;
      friends.get(a)!.add(b);
      friends.get(b)!.add(a);
    };
    const full = (s: string) => friends.get(s)!.size >= 10;
    // people who chat together are friends (group members must be the admin's friends)
    for (const g of GROUPS) for (const m of g.members) link(g.admin, m);
    for (const d of DMS) link(d.a, d.b);
    // clan mates: leaders know everyone; others a few mates
    for (const c of CLANS) {
      const mates = USERS.filter((u) => u.clan === c.tag).map((u) => u.slug);
      const leader = USERS.find((u) => u.clan === c.tag && u.role === 'leader')!.slug;
      for (const m of mates) if (!full(m) && !full(leader)) link(leader, m);
      for (const m of mates) {
        for (let k = 0; k < 2; k++) {
          const o = pick(mates);
          if (!full(m) && !full(o)) link(m, o);
        }
      }
    }
    // same city / random others until everyone has at least 3
    for (const s of slugs) {
      const city = USERS.find((u) => u.slug === s)!.city;
      let tries = 0;
      while (friends.get(s)!.size < 3 + Math.floor(rand() * 3) && tries++ < 60) {
        const same = USERS.filter((u) => u.city === city && u.slug !== s).map((u) => u.slug);
        const o = same.length && rand() < 0.6 ? pick(same) : pick(slugs);
        if (o !== s && !full(o) && !full(s)) link(s, o);
      }
    }
    const done = new Set<string>();
    for (const [a, set] of friends) {
      for (const b of set) {
        const key = [a, b].sort().join('|');
        if (done.has(key)) continue;
        done.add(key);
        const since = cap(between(new Date(Math.max(uid(a).created.getTime(), uid(b).created.getTime()) + DAY), new Date(now.getTime() - 3 * DAY)));
        await tx.insert(friendships).values([
          { userId: uid(a).id, friendId: uid(b).id, createdAt: since },
          { userId: uid(b).id, friendId: uid(a).id, createdAt: since },
        ]);
        counts.friendships++;
      }
    }
    for (const [a, b] of FRIEND_REQUESTS) {
      await tx.insert(friendRequests).values({ fromId: uid(a).id, toId: uid(b).id, createdAt: cap(bakuDay(-(1 + Math.floor(rand() * 4)), 18)) });
      counts.friendRequests++;
    }

    // ---------------- DMs ----------------
    for (const d of DMS) {
      const a = uid(d.a).id;
      const b = uid(d.b).id;
      const times = d.lines.map(lineAt);
      const first = new Date(times[0].getTime() - 60 * 1000);
      const last = times[times.length - 1];
      const [conv] = await tx
        .insert(conversations)
        .values({ type: 'dm', dmKey: [a, b].sort().join(':'), createdAt: first, updatedAt: last })
        .returning({ id: conversations.id });
      counts.conversations++;
      await tx.insert(conversationMembers).values([
        { conversationId: conv.id, userId: a, joinedAt: first, lastReadAt: last },
        { conversationId: conv.id, userId: b, joinedAt: first, lastReadAt: last },
      ]);
      for (const [i, l] of d.lines.entries()) {
        await tx.insert(messages).values({ conversationId: conv.id, senderId: uid(l[0]).id, text: l[1], createdAt: times[i] });
        counts.messages++;
      }
    }

    // ---------------- group chats ----------------
    for (const g of GROUPS) {
      const times = g.lines.map(lineAt);
      const created = new Date(times[0].getTime() - 5 * 60 * 1000);
      const [conv] = await tx
        .insert(conversations)
        .values({ type: 'group', name: g.name, adminId: uid(g.admin).id, createdAt: created, updatedAt: times[times.length - 1] })
        .returning({ id: conversations.id });
      counts.conversations++;
      for (const m of [g.admin, ...g.members]) {
        await tx.insert(conversationMembers).values({ conversationId: conv.id, userId: uid(m).id, joinedAt: created, lastReadAt: latest });
      }
      await tx.insert(messages).values({
        conversationId: conv.id,
        senderId: null,
        type: 'system',
        systemKey: 'group.created',
        systemParams: { name: g.name, byUserId: uid(g.admin).id, byDisplayName: uid(g.admin).name },
        text: `${uid(g.admin).name} created the group "${g.name}"`,
        createdAt: created,
      });
      counts.messages++;
      for (const [i, l] of g.lines.entries()) {
        if (l[0] !== g.admin && !g.members.includes(l[0])) throw new Error(`demo data: ${l[0]} not in group ${g.name}`);
        await tx.insert(messages).values({ conversationId: conv.id, senderId: uid(l[0]).id, text: l[1], createdAt: times[i] });
        counts.messages++;
      }
    }

    // ---------------- events ----------------
    for (const e of EVENTS) {
      const startsAt = bakuDay(e.day, e.hour);
      const endsAt = new Date(startsAt.getTime() + e.hours * HOUR);
      const past = e.day < 0;
      if (past && endsAt > latest) throw new Error(`demo data: past event "${e.title}" has not ended yet`);
      const created = past ? new Date(startsAt.getTime() - (6 + rand() * 4) * DAY) : bakuDay(-(5 + Math.floor(rand() * 3)), 20);
      const orgClan = clanOf.get(e.organizer);
      if (e.visibility === 'clan' && !orgClan) throw new Error(`demo data: clan-only event "${e.title}" without a clan`);
      const spotId = spotIds.get(e.spot);
      if (!spotId) throw new Error(`demo data: unknown spot ${e.spot}`);
      if (e.going.length + 1 > e.maxCars) throw new Error(`demo data: "${e.title}" over max cars`);
      const [ev] = await tx
        .insert(events)
        .values({
          organizerId: uid(e.organizer).id,
          title: e.title,
          description: past ? e.description : `${e.description} ${DEMO_EVENT_MARK}`,
          startsAt,
          endsAt,
          spotId,
          maxCars: e.maxCars,
          minDifficulty: e.minDifficulty ?? null,
          requirements: e.requirements,
          visibility: e.visibility ?? 'public',
          clanId: orgClan ? clanIds.get(orgClan)!.id : null,
          createdAt: created,
          updatedAt: created,
        })
        .returning({ id: events.id });
      counts.events++;
      const [conv] = await tx
        .insert(conversations)
        .values({ type: 'event', eventId: ev.id, createdAt: created, updatedAt: created })
        .returning({ id: conversations.id });
      counts.conversations++;

      const joinWindowEnd = past ? new Date(startsAt.getTime() - 2 * HOUR) : latest;
      const people: { slug: string; status: 'going' | 'waitlist'; at: Date }[] = [{ slug: e.organizer, status: 'going', at: created }];
      let t = created;
      for (const [status, list] of [['going', e.going], ['waitlist', e.waitlist ?? []]] as const) {
        for (const s of list) {
          if (e.visibility === 'clan' && clanOf.get(s) !== orgClan) throw new Error(`demo data: ${s} can't see clan-only "${e.title}"`);
          t = notBefore(s, between(t, new Date(t.getTime() + (joinWindowEnd.getTime() - t.getTime()) / 3)));
          people.push({ slug: s, status, at: t });
        }
      }
      for (const p of people) {
        await tx.insert(eventParticipants).values({
          eventId: ev.id,
          userId: uid(p.slug).id,
          carId: firstCar(p.slug),
          seats: Math.floor(rand() * 3),
          status: p.status,
          joinedAt: p.at,
        });
        await tx.insert(conversationMembers).values({ conversationId: conv.id, userId: uid(p.slug).id, joinedAt: p.at, lastReadAt: latest });
        if (p.slug === e.organizer) continue;
        await tx.insert(messages).values({
          conversationId: conv.id,
          senderId: null,
          type: 'system',
          systemKey: p.status === 'going' ? 'event.joined' : 'event.waitlisted',
          systemParams: { userId: uid(p.slug).id, displayName: uid(p.slug).name },
          text: `${uid(p.slug).name} ${p.status === 'going' ? 'joined the event' : 'joined the waitlist'}`,
          createdAt: p.at,
        });
        counts.messages++;
      }
      let last = people[people.length - 1].at;
      let prev = new Date(0);
      for (const l of e.lines ?? []) {
        const sender = people.find((p) => p.slug === l[0]);
        if (!sender) throw new Error(`demo data: ${l[0]} is not in "${e.title}"`);
        // never before the sender joined (or before the previous line), never in the future
        const earliest = Math.max(sender.at.getTime() + 5 * 60 * 1000, prev.getTime() + 60 * 1000);
        const at = cap(new Date(Math.max(lineAt(l).getTime(), earliest)));
        prev = at;
        await tx.insert(messages).values({ conversationId: conv.id, senderId: uid(l[0]).id, text: l[1], createdAt: at });
        counts.messages++;
        if (at > last) last = at;
      }
      await tx.update(conversations).set({ updatedAt: last }).where(eq(conversations.id, conv.id));
    }
  }).catch((err) => {
    if (err instanceof SkipSignal) return;
    throw err;
  });

  if (counts.users === 0) return { skipped: true };
  return { skipped: false, counts };
}

class SkipSignal extends Error {}

/**
 * Delete everything that belongs to demo accounts, without touching real users' own data:
 * - real users keep their spots, cars, mods, clans, events, groups and messages;
 * - a real event at a demo spot keeps the spot's location as its meeting point;
 * - a real event loses its demo participants and promotes its waitlist into the freed places;
 * - real users in a demo clan / demo event / demo group simply lose that (demo) clan, event or group;
 * - DMs with demo users, reports about demo content and system messages naming demo users are removed.
 */
export async function removeDemo(db: Db): Promise<{ users: number }> {
  return db.transaction(async (tx) => {
    const ids = (await tx.execute<{ id: string }>(sql`select id from ${demoIds} d`)).rows.map((r) => r.id);
    if (!ids.length) return { users: 0 };

    // real events at demo spots: keep the location as the meeting point
    await tx.execute(sql`
      update events e set meeting_lat = s.lat, meeting_lng = s.lng, meeting_label = left(s.name, 80)
      from spots s
      where e.spot_id = s.id and s.owner_id in ${demoIds} and e.organizer_id not in ${demoIds} and e.meeting_lat is null`);

    // real upcoming events that will lose demo cars: promote their waitlist afterwards
    const affected = (
      await tx.execute<{ id: string }>(sql`
        select distinct e.id from events e join event_participants p on p.event_id = e.id
        where p.user_id in ${demoIds} and p.status = 'going' and e.organizer_id not in ${demoIds}
          and e.status = 'scheduled' and e.starts_at > now()`)
    ).rows.map((r) => r.id);

    // reports about demo content
    await tx.execute(sql`
      delete from reports where
        (target_type = 'user' and target_id in ${demoIds})
        or (target_type = 'spot' and target_id in (select id from spots where owner_id in ${demoIds}))
        or (target_type = 'car' and target_id in (select id from cars where owner_id in ${demoIds}))
        or (target_type = 'clan' and target_id in (select id from clans where leader_id in ${demoIds}))
        or (target_type = 'event' and target_id in (select id from events where organizer_id in ${demoIds}))
        or (target_type = 'message' and target_id in (select id from messages where sender_id in ${demoIds}))`);

    // DMs with a demo user
    await tx.execute(sql`
      delete from conversations where type = 'dm'
        and (split_part(dm_key, ':', 1)::uuid in ${demoIds} or split_part(dm_key, ':', 2)::uuid in ${demoIds})`);

    // groups a demo user created are demo content; other groups with a demo admin get a real admin
    await tx.execute(sql`
      delete from conversations c where c.type = 'group' and exists (
        select 1 from messages m where m.conversation_id = c.id and m.system_key = 'group.created'
          and (m.system_params->>'byUserId')::uuid in ${demoIds})`);
    await tx.execute(sql`
      update conversations c set admin_id = (
        select cm.user_id from conversation_members cm
        where cm.conversation_id = c.id and cm.user_id not in ${demoIds}
        order by cm.joined_at, cm.user_id limit 1)
      where c.type = 'group' and c.admin_id in ${demoIds}`);

    // groups with demo members: may end up empty once the demo accounts are gone
    const demoGroups = (
      await tx.execute<{ id: string }>(sql`
        select distinct cm.conversation_id as id from conversation_members cm
        join conversations c on c.id = cm.conversation_id
        where c.type = 'group' and cm.user_id in ${demoIds}`)
    ).rows.map((r) => r.id);

    // system messages in real chats that name a demo user
    await tx.execute(sql`
      delete from messages where type = 'system' and (
        (system_params->>'userId') in (select id::text from ${demoIds} d)
        or (system_params->>'byUserId') in (select id::text from ${demoIds} d))`);

    // the accounts: cascades to their spots, cars, mods, ratings, photos, clans they lead, events they
    // organize (with participants and chats), messages, memberships, friendships, requests, tokens, blocks
    await tx.execute(sql`delete from users where id in ${demoIds}`);

    // those groups, if nobody is left in them (other empty groups are not ours to touch)
    for (const id of demoGroups) {
      await tx.execute(sql`
        delete from conversations c where c.id = ${id} and c.type = 'group'
          and not exists (select 1 from conversation_members cm where cm.conversation_id = c.id)`);
    }

    for (const eventId of affected) await promoteWaitlist(tx, eventId);
    return { users: ids.length };
  });
}

/** Fill free places of a real event from its waitlist (first come, first served), like a normal leave. */
async function promoteWaitlist(tx: Tx, eventId: string) {
  const [e] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
  if (!e) return;
  const [going] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.status, 'going')));
  let free = e.maxCars - going.n;
  if (free <= 0) return;
  const waiting = await tx
    .select({ userId: eventParticipants.userId, name: users.displayName })
    .from(eventParticipants)
    .innerJoin(users, eq(users.id, eventParticipants.userId))
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.status, 'waitlist')))
    .orderBy(asc(eventParticipants.joinedAt));
  const [conv] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.eventId, eventId));
  for (const w of waiting) {
    if (free-- <= 0) break;
    await tx
      .update(eventParticipants)
      .set({ status: 'going' })
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, w.userId)));
    if (conv) await insertSystemMessage(tx, conv.id, 'event.promoted', { userId: w.userId, displayName: w.name });
  }
}

export const summaryLine = (c: DemoCounts) =>
  `demo seed: ${c.users} users, ${c.cars} cars, ${c.mods} mods, ${c.spots} spots, ${c.spotRatings + c.carRatings} ratings, ` +
  `${c.clans} clans, ${c.friendships} friendships, ${c.events} events, ${c.conversations} chats, ${c.messages} messages, ${c.images} photos`;

/**
 * Startup hook. Does nothing unless DEMO_SEED=1 or DEMO_REMOVE=1 is set (this is the only way it runs in
 * production). Logs one line; never logs the password. Errors are logged, they don't stop the server.
 */
export async function demoFromEnv(db: Db, env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<'seeded' | 'skipped' | 'removed' | 'none' | 'error'> {
  const seed = env.DEMO_SEED === '1';
  const remove = env.DEMO_REMOVE === '1';
  if (!seed && !remove) return 'none';
  if (seed && remove) {
    log('demo: DEMO_SEED and DEMO_REMOVE are both set - doing nothing (set only one)');
    return 'error';
  }
  try {
    if (remove) {
      const r = await removeDemo(db);
      log(`demo remove: deleted ${r.users} demo users and everything they owned`);
      return 'removed';
    }
    if (!env.DEMO_PASSWORD || env.DEMO_PASSWORD.length < DEMO_PASSWORD_MIN) {
      log(`demo seed: skipped - DEMO_PASSWORD is ${env.DEMO_PASSWORD ? 'too short' : 'not set'} (needs at least ${DEMO_PASSWORD_MIN} characters)`);
      return 'error';
    }
    const r = await seedDemo(db, { password: env.DEMO_PASSWORD });
    if (r.skipped) {
      log('demo seed: demo data already present - nothing to do');
      return 'skipped';
    }
    log(summaryLine(r.counts));
    return 'seeded';
  } catch (err) {
    log(`demo: failed - ${(err as Error).message}`);
    return 'error';
  }
}
