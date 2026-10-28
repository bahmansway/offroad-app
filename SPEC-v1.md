# v1 spec — accounts, spots map, garage

**What:** First working version. People sign up / log in, browse a map of trails and campsites with difficulty levels, add their own spots, rate spots, create a car profile, list modifications (with optional public price), and rate other people's cars. Events, clans and chat are v2. Photo uploads are v2 (cars/spots get a colour tile for now).

**Look:** follow the approved mockups — dark #14130E ground, surfaces #1F1D16 / #2A2820, lines #3A372C, text #F2EDE1, muted #ABA493, accent #FF8A2A (text on accent #14130E). Difficulty colours 1 #9FD49A, 2 #E8D36A, 3 #FF8A2A, 4 #F0574A, 5 #C9A0FF, always with the number too. Fonts Barlow Condensed (headings) + Barlow (body). Tap targets ≥ 44px. Bottom tabs: Explore, Garage, Profile (Events + Chat tabs shown as "Coming soon").

**Difficulty levels:** 1 Easy (any SUV) · 2 Moderate (AWD, good tyres) · 3 Hard (4x4 low range, AT tyres) · 4 Extreme (lockers, lift, winch) · 5 Expert only. Trails require a level; camps have none.

## API contract (server ↔ app). JSON, prefix `/api`. Auth: `Authorization: Bearer <accessToken>`.
Errors: `{ "error": { "code": "VALIDATION|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMITED", "message": "..." } }`.

### Auth
- `POST /api/auth/register` `{email, password (8–128), displayName (2–40)}` → 201 `{accessToken, refreshToken, user}`
- `POST /api/auth/login` `{email, password}` → `{accessToken, refreshToken, user}`
- `POST /api/auth/refresh` `{refreshToken}` → `{accessToken, refreshToken}` (rotates; old one revoked)
- `POST /api/auth/logout` `{refreshToken}` → 204
- `GET /api/me` → `user`
- `user` = `{id, displayName, createdAt}` (+ `email` only on /me and auth responses)
- Access token 15 min, refresh token 30 days. Rate limit login/register.

### Spots
- `GET /api/spots?type=trail|camp&minLevel=1&maxLevel=5&q=` → `{items: Spot[]}` (max 500)
- `GET /api/spots/:id` → `Spot` with `myRating`
- `POST /api/spots` (auth) `{type:'trail'|'camp', name (2–80), description (≤2000), lat (-90..90), lng (-180..180), difficulty (1–5, required for trail, null for camp), season (≤40, optional), tags: string[] (≤8, each ≤24)}` → 201 Spot
- `PATCH /api/spots/:id` / `DELETE /api/spots/:id` — owner only
- `PUT /api/spots/:id/rating` (auth) `{stars 1–5}` → `{ratingAvg, ratingCount, myRating}`
- `Spot` = `{id, type, name, description, lat, lng, difficulty, season, tags, ratingAvg, ratingCount, owner:{id,displayName}, createdAt}`

### Cars & mods
- `GET /api/cars?userId=` → `{items: CarSummary[]}` (no userId → latest 50)
- `GET /api/cars/:id` → `Car`
- `POST /api/cars` (auth) `{make (1–40), model (1–60), year (1950–next year), engine (≤40, optional), description (≤1000, optional)}` → 201 Car
- `PATCH /api/cars/:id` / `DELETE /api/cars/:id` — owner only
- `POST /api/cars/:id/mods` (owner) `{name (1–80), category, price (optional, 0–10,000,000), currency ('AZN'|'USD'|'EUR', default AZN), pricePublic (bool, default true)}` → 201 Mod
- `PATCH /api/mods/:id` / `DELETE /api/mods/:id` — owner of car only
- `PUT /api/cars/:id/rating` (auth, not owner) `{stars 1–5}` → `{ratingAvg, ratingCount, myRating}`
- categories: `lift, tyres, wheels, recovery, armour, bumpers, lighting, engine, suspension, interior, roof, other`
- `Mod` = `{id, name, category, currency, pricePublic, price}` — **`price` is null for everyone except the owner when pricePublic is false**
- `Car` = `{id, make, model, year, engine, description, owner:{id,displayName}, mods: Mod[], ratingAvg, ratingCount, myRating, totalPublicSpend: {AZN: n, USD: n, EUR: n}, hiddenPriceCount, createdAt}`

### Other
- `GET /api/users/:id` → `{id, displayName, createdAt, cars: CarSummary[], spotCount}`
- `POST /api/reports` (auth) `{targetType:'spot'|'car'|'user', targetId, reason (1–500)}` → 201
- `GET /api/health` → `{ok:true}`

## Acceptance checks
1. New user can register, log out, log back in; wrong password is rejected; session survives app reload.
2. Map centred on Baku shows spots as pins numbered by difficulty; filters (All/Trails/Camps, level range) work; tapping a pin/list item opens the spot page.
3. Logged-in user can add a trail (with level) and a camp (no level) by tapping a point on the map; it appears on the map for another user.
4. User can add a car, add 3 mods (one with price hidden); another user sees the car with that price shown as "Private" and the total excluding it; the owner sees all prices.
5. Another user can rate the car and a spot 1–5; owner cannot rate own car; averages update.
6. A user cannot edit/delete someone else's spot, car or mod (403).
7. App UI switches between Azerbaijani and English.
