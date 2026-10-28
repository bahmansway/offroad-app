# v2 spec — iOS redesign, car catalog, richer profiles, clans & chat

Repo: /home/claude/offroad-repo (this is the git repo; push to main deploys web + publishes to Expo Go).
Everything in SPEC-v1.md still applies unless changed here. Same error format, same auth.

## 1. iOS-style redesign (app only)
Approved mockups: Design canvas row "iOS-style redesign", files in
/tmp/claude-0/-home-claude/c3a4f1af-04a9-5bc4-a9b7-8eb403246849/scratchpad/canvas/project/ios*.dc.html
Tokens: see "Design tokens" at the bottom. Light by default, automatic dark mode (`userInterfaceStyle: automatic`).
Floating glass tab bar: Kəşf et, Tədbirlər (coming soon), Qaraj, Söhbət, Profil. All existing screens restyled.

## 2. Car catalog (free)
- Brand → Model list from the MIT-licensed list github.com/serhatkildaci/global-car-models (copy at
  /tmp/claude-0/-home-claude/c3a4f1af-04a9-5bc4-a9b7-8eb403246849/scratchpad/gcm/). Keep its MIT notice in
  server/src/data/catalog/LICENSE-global-car-models.txt and show it on an "About / licences" row in Profile.
  Fix Turkish names (e.g. "G-Serisi" → "G-Class"). Add missing: UAZ (Patriot, Hunter, Bukhanka/SGR, Pickup),
  Toyota Land Cruiser Prado, Mitsubishi Pajero Sport, Lada Niva Legend, Lada Niva Travel.
- Curated trims table (~40 popular offroad versions) server/src/data/catalog/trims.json:
  `{id, brand, model, generation, yearFrom, yearTo, engine:"4.5 V8 diesel", engineL, hp, drive:'4WD'|'AWD'|'FWD'|'RWD', transmission:'manual'|'automatic'|'cvt', fuel:'petrol'|'diesel'|'hybrid'|'electric'|'lpg'}`.
  Use manufacturer-published figures only; if unsure of a value, leave that trim out. Cover: LC 70/80/100/200/300,
  Prado 120/150, Lexus LX 570/600, GX 460, Patrol Y61/Y62, Pajero IV, Pajero Sport III, L200, Hilux, 4Runner,
  FJ Cruiser, Wrangler JL, Grand Cherokee, Defender (L663), Discovery 5, G-Class W463, Jimny JB74, Niva Legend,
  UAZ Patriot. Specs pre-filled from a trim stay editable (owner can override).
- Endpoints (public, cached): `GET /api/catalog/brands` → `[{name, modelCount}]`;
  `GET /api/catalog/models?brand=` → `[{name, offroad:boolean}]` (offroad = has a curated trim);
  `GET /api/catalog/trims?brand=&model=&year=` → `Trim[]`.
- Car gets new optional fields: `trimId, engine (≤40), engineL (0.5–10), hp (20–2000), drive, transmission, fuel, color (≤30)`.
  `make`/`model` stay free text (catalog is a helper, manual entry always allowed). Year still 1950–next year.

## 3. Profile details
- `PATCH /api/me` `{displayName?, bio? (≤300), city? (≤60), currentCarId? (own car or null)}`.
- Photos: `PUT /api/me/avatar` and `PUT /api/cars/:id/photo` (owner) — body = JPEG/PNG/WebP up to 2 MB, server
  re-encodes to JPEG (sharp), max 1024px (avatar 512px), strips EXIF/GPS. Stored in Postgres (bytea) for now.
  `DELETE` same paths removes it. Served at `GET /api/images/:id` with long cache headers; responses expose
  `avatarUrl` / `photoUrl` (null if none).
- `User` public shape adds `{avatarUrl, bio, city, currentCar: CarSummary|null}`.
- App: Profile screen per mockup (photo, name, city, bio, current car card, my cars, settings).
  Photo picking with expo-image-picker (works in Expo Go); resize client-side before upload (expo-image-manipulator).

## 4. Clans & chat
- Clan: `{id, name (3–40, unique, case-insensitive), tag (2–5 chars, unique), description (≤500), logoUrl, city,
  isOpen (anyone joins) | request (leader approves), leader:{id,displayName}, memberCount, myRole: 'leader'|'member'|'pending'|null}`.
- Rules: a user is in max 1 clan. Leader can edit clan, upload logo, approve/reject requests, remove members,
  hand over leadership. Leader must hand over before leaving (or delete clan if alone).
- Endpoints: `GET /api/clans?q=`, `POST /api/clans`, `GET/PATCH/DELETE /api/clans/:id`, `PUT /api/clans/:id/logo`,
  `POST /api/clans/:id/join`, `POST /api/clans/:id/leave`, `GET /api/clans/:id/members`,
  `GET /api/clans/:id/requests` (leader), `POST /api/clans/:id/requests/:userId/approve|reject` (leader),
  `DELETE /api/clans/:id/members/:userId` (leader), `POST /api/clans/:id/leader {userId}` (leader).
- Chat: conversations of type `dm` (2 users) or `clan` (all clan members, created with the clan).
  `GET /api/conversations` → `[{id, type, title, avatarUrl, lastMessage, unreadCount, updatedAt}]`,
  `POST /api/conversations/dm {userId}` (get or create), `GET /api/conversations/:id/messages?before=&limit=50`,
  `POST /api/conversations/:id/messages {text (1–2000), clientId}` , `POST /api/conversations/:id/read`.
  Message `{id, conversationId, sender:{id,displayName,avatarUrl}, text, createdAt, clientId}`.
  Only members can read/post. Removed/left clan members lose access to clan chat.
- Realtime: Socket.IO on same origin, path `/socket.io`, auth with access token in handshake; server emits
  `message:new` and `conversation:updated` to members. App falls back to polling every 10s if socket fails.
- Safety: `POST /api/users/:id/block` / `DELETE` unblock — blocked users can't DM you and their messages are hidden for you.
  Reports accept targetType `message` and `clan` too. Rate limit: 30 messages/min per user.
- App: Söhbət tab = conversation list + clan entry; chat screen (iOS-style bubbles), clan page (logo, members,
  join/request button, leader tools), "Klan yarat" form, start DM from a user's profile.

## Acceptance checks
1. App looks like the approved iOS mockups in light and dark mode on phone (Expo Go) and web.
2. Add car: pick brand → model → year → trim, specs fill in; or enter manually; owner can edit specs later.
3. Upload profile photo and car photo; set current car; another user sees them on the public profile.
4. Create clan, second user requests to join, leader approves, both chat in clan chat in real time.
5. DM between two users works; block stops new DMs; report a message works.
6. Non-members can't read clan chat (403); user can't be in two clans.
7. All new text in az + en.

## Design tokens (from the designer)
Tint light #C2410C / dark #FF8A3D; on-tint light #FFFFFF / dark #1A0A00; soft tint light #FBEAE0 (text #B4380A) / dark #3A2A20 (text #FF8A3D).
Light: bg #F2F2F7, cell #FFFFFF, text #000, secondary #6C6C70, separator rgba(60,60,67,0.18) hairline, fill rgba(118,118,128,0.12), destructive #D70015.
Dark: bg #000, cell #1C1C1E, text #FFF, secondary #AEAEB2, separator rgba(84,84,88,0.65), fill rgba(118,118,128,0.24), destructive #FF6961.
Glass: light rgba(255,255,255,0.68) + 0.5px rgba(255,255,255,0.7); dark rgba(28,28,30,0.62) + 0.5px rgba(255,255,255,0.14). Blur 20–30.
Difficulty: 5 segments 8px high, radius 4, gap 6, filled = tint; always number + word (1 Asan, 2 Orta, 3 Çətin, 4 Ekstrem, 5 Yalnız peşəkarlar).
Type: large title 34/700 (-0.6), title2 22/700, headline/body 17 600/400, subhead 15, footnote 13, tab 11/600. System font on iOS, Inter on Android/web.
Radii: grouped cards 26, sheets 34, tab bar 32 (64 tall pill, floats 24px above bottom, 16px sides), buttons pill, thumbnails 12, spec tiles 16.
Expo: expo-blur BlurView (glass), expo-symbols on iOS + Ionicons fallback, expo-haptics light impact, useColorScheme, modal/formSheet presentation for sheets. Map: OpenFreeMap "positron" (light) / "dark" style by scheme.

## Server notes for app builders
Only the details and additions beyond the spec above.

**Users**
- `GET /api/me`, `PATCH /api/me`, and the `user` returned by register/login all have this shape: `{id, email, displayName, createdAt, avatarUrl, bio, city, currentCarId, currentCar: CarSummary|null}`.
- `GET /api/users/:id` returns `{id, displayName, createdAt, avatarUrl, bio, city, currentCar, cars: CarSummary[], spotCount, clan: {id,name,tag,logoUrl,role}|null, isBlocked}`. `isBlocked` means "I blocked them".
- `PATCH /api/me`: send `null` to clear `bio`, `city` or `currentCarId`. Someone else's car returns 403. Deleting your current car sets it back to null.
- `GET /api/me/blocks` returns `{items: [{id, displayName, avatarUrl}]}`. `POST` and `DELETE /api/users/:id/block` both return 204, and calling them twice is fine.

**Photos** (`PUT /api/me/avatar`, `PUT /api/cars/:id/photo`, `PUT /api/clans/:id/logo`)
- The body is the raw image bytes, not multipart and not base64. Set `Content-Type` to `image/jpeg`, `image/png`, `image/webp` or `application/octet-stream`. On native, use `FileSystem.uploadAsync(url, uri, {httpMethod:'PUT', uploadType: FileSystemUploadType.BINARY_CONTENT, headers:{Authorization, 'Content-Type':'image/jpeg'}})`. On web, use `fetch(url, {method:'PUT', body: blob})`.
- The real type is checked from the file bytes. Anything else (GIF, SVG, HEIC, broken files) returns 415 `VALIDATION`. Over 2 MB returns 413. An empty body returns 400.
- Responses: `{avatarUrl}`, `{photoUrl}` or `{logoUrl}`. Each is a relative path `/api/images/<id>`, so prefix it with the API base URL. A new photo gets a new id. The old one returns 404, which makes caching safe.
- Size limits: avatar and clan logo 512px max, car photo 1024px max. Output is always JPEG with no EXIF/GPS. `DELETE` on the same path returns 204.

**Cars**
- `CarSummary` and `Car` now also include `trimId, engineL, hp, drive, transmission, fuel, color, photoUrl`.
- `trimId` must be an id from `trims.json` (otherwise 400). `hp` must be a whole number. All spec fields accept `null`.
- The app copies the trim values into the car itself. The server does not fill them in from `trimId`.

**Catalog**
- `/catalog/models` returns `[]` for an unknown brand. Brand matching ignores upper/lower case.
- `/catalog/trims` needs `brand`. `model` and `year` are optional filters.
- Each trim has an extra `market` field, e.g. "EU", "RU" or "GCC", which shows where that power figure was published. `yearTo: null` means still on sale.
- 51 curated trims. Not included because I was not sure of the official figures: LC80 1HZ, Wrangler JL 2.2 diesel, Pajero IV 3.2 early versions, Patrol Y61 4.8 petrol.
- Each trim also has `powerUnit`: `'PS'` (metric, markets EU/RU/AU) or `'hp'` (US). Show it next to the number, e.g. "286 PS". A car's own `hp` field has no unit stored.
- Licence text: `server/src/data/catalog/LICENSE-global-car-models.txt`.

**Limits**
- A user can have at most 20 cars. The 21st `POST /api/cars` returns 409 `CONFLICT`.
- Each user can store at most 20 MB of photos (after re-encoding). Over that, uploads return 409 `CONFLICT` "Photo storage limit reached". Replacing a photo doesn't count the old one.

**Clans**
- `Clan` also includes `conversationId` (null unless you are a member) and `createdAt`.
- Tags are saved in upper case. Clan names are unique ignoring upper/lower case.
- `POST /clans/:id/join` returns the `Clan`. Its `myRole` is `'member'` for an open clan, or `'pending'` for a request clan.
- `POST /clans/:id/leave` also cancels a pending request. A leader gets 409 here. Someone already removed gets 404.
- If two leader actions clash (e.g. two handovers at once), only one succeeds. The other gets 403, 404 or 409, so reload the clan after an error.
- `DELETE /clans/:id` returns 409 while the clan has other members.
- `GET /clans` returns `{items: Clan[]}` (up to 50). `/members` returns `{items: [{user:{id,displayName,avatarUrl}, role, joinedAt}]}`. `/requests` returns `{items: [{user, createdAt}]}`.
- These return 204: approve, reject, and remove member. `POST /leader` returns the updated `Clan`.
- Already in a clan (join, create or approve) returns 409 `CONFLICT`.

**Chat**
- `GET /api/conversations` returns an array, each item `{id, type, title, avatarUrl, clanId, otherUser|null, lastMessage|null, unreadCount, updatedAt}`, newest first. `GET /api/conversations/:id` returns one item.
- `POST /conversations/dm` returns that same item, with status 200.
- `GET /conversations/:id/messages` returns `{items: Message[], hasMore}`. Items are oldest first. `before` takes a message id. `limit` is 1–100, default 50.
- `POST .../messages` returns 201 with the `Message`. Resending the same `clientId` returns 200 with the original message, with no duplicate and no second socket event.
- Non-member returns 403. A DM where either side blocked the other returns 403. The limit is 30 messages per minute per user, then 429 `RATE_LIMITED` with a `Retry-After` header.

**Socket.IO**
- Connect with `io(API_BASE, {path:'/socket.io', auth:{token: accessToken}, transports:['websocket']})`. A bad or missing token gives `connect_error` with message `UNAUTHORIZED`.
- The server emits `ready {userId}` once the socket has joined its rooms.
- The server drops the socket when the access token expires (15 min). After refreshing the token, reconnect with the new one (update `socket.auth` before calling `connect()`).
- Events: `message:new` (Message) and `conversation:updated` (`{id, lastMessage, updatedAt}`). Users who blocked the sender don't receive them.
- Sending a message is REST only. The socket only delivers.
- New DMs and clan joins are added to a live socket automatically. Leaving or removal stops events immediately.
