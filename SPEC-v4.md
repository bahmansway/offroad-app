# v4 spec — friends, search & new chats, driver-titled clans, scoreboard, YOLCHU design pass

Repo: /home/claude/offroad-repo. SPEC-v1..v3 still apply (error format, auth, strict zod bodies, az+en strings, Expo Go only, private mod prices never leak, blocks respected everywhere).

## 1. Friends
- Friend request: `POST /api/friends/requests {userId}` → pending; `GET /api/friends/requests?dir=in|out`;
  `POST /api/friends/requests/:id/accept|decline`, `DELETE /api/friends/requests/:id` (cancel own outgoing).
  If B already sent A a request, A sending to B auto-accepts. Blocked either way → 403. Max 50 pending outgoing.
  Decline → same pair can't re-request for 24 h. Rate limit 30 requests/hour.
- Friends: `GET /api/friends?q=` (list, searchable), `DELETE /api/friends/:userId` (unfriend). Max 1000 friends.
- `PublicUser` gains `friendship: 'none'|'friends'|'outgoing'|'incoming'` (+ requestId when pending), `friendCount`, `mutualFriends` (count).
- Socket: `friend:request`, `friend:accepted` to the involved users. Unread badge count includes incoming requests (`GET /api/me/badges` → `{messages, friendRequests, clanInvites}`).

## 2. Search & creating chats
- `GET /api/search?q=` (2–40 chars) → `{users: UserSummary[] (≤10, excludes blocked both ways, friends first), clans: ClanSummary[] (≤5), conversations: ConversationSummary[] (≤10, only mine, title or member name match)}`.
- Group chats: conversation type `group`: `{name (1–40), avatarUrl?, admin, members (2–20 incl. creator)}`.
  `POST /api/conversations/group {name, userIds}` — userIds must all be the creator's friends.
  `PATCH /api/conversations/:id {name}` (admin), `PUT /api/conversations/:id/avatar` (admin),
  `POST /api/conversations/:id/members {userIds}` (admin, friends only, cap 20), `DELETE /api/conversations/:id/members/:userId` (admin removes / anyone removes self = leave).
  If the admin leaves, the longest-standing member becomes admin; last member leaving deletes the group.
  System messages for created / added / removed / left / renamed. Pin rules: admin. Mute, delete own message, reports as before.
- Starting a DM stays open to anyone not blocked (existing `POST /api/conversations/dm`).

## 3. Clans with driver titles
- Keep internal roles `leader | officer | member`. Display titles (az / en):
  leader = **Karvan başçısı** / Convoy leader · officer = **Bələdçi** / Navigator (co-leader) ·
  member = **Sürücü** / Driver · member who joined < 30 days ago = **Yeni sürücü** / Rookie (derived, automatic).
- Member payloads expose `role`, `joinedAt`, `title` ('leader'|'navigator'|'driver'|'rookie').
- Rename "officer" to "Bələdçi / Navigator" everywhere in the app UI. Permissions unchanged.
- Clan page shows the clan's total points this month (sum of members' monthly points, see §4) and its members sorted by title then points.

## 4. Scoreboard (top 20)
- Points are computed from existing data (no ledger table), in Baku calendar time:
  - Spot shared: 10 — only once the spot is ≥ 24 h old, still exists and has not been reported by 2 or more different users; max 10 spots per month.
  - Event organized that finished (not cancelled) with ≥ 2 cars going: 15; max 4 per month.
  - Event attended (status going when the event finished, not organizer): 5; max 8 per month.
  - An event only earns points (organizer or attendee) if it lasted ≥ 1 hour (endsAt, or the 24 h default) and had ≥ 2 cars going.
  - Car added with a photo: 5 (max 2 cars counted).
  - Rating given (spot or car): 1, max 20 per month.
  - Monthly caps use Baku months; all-time = sum of the monthly caps.
- `GET /api/leaderboard?period=month|all` → `{period, monthStart, items: [{rank, user: UserSummary(+avatar, currentCar summary, clan tag), points, breakdown: {spots, events, attended, cars, ratings}}] (top 20), me: {rank, points}|null}`.
  Ties: earlier first activity wins. Cache 5 minutes. Blocked users still appear (public board) but can't be opened if blocked.
- App: entry from Kəşf et header (trophy button) and from Profile ("Reytinq"); page with segmented Bu ay / Ümumi, top 3 podium, rows 4–20, sticky "Sizin yeriniz: #x · y xal" bar; tap → user profile; "Xallar necə qazanılır?" info sheet listing the rules above.
  Profile shows my points this month + rank.

## 5–6. Design pass
Implement DESIGN-PASS.md (designer's priority list; mockups on the canvas row "YOLCHU design pass"). Final logo = symmetric white mountain with road cut-out (already in app/assets/brand/).

## Acceptance checks
1. A sends B a friend request; B sees badge + accepts; both appear in each other's friends; unfriend works; blocked users can't request.
2. Search finds users, clans and my chats; "Yeni söhbət" starts a DM or a group with friends; non-friends can't be added to groups.
3. Group admin renames, adds, removes; leaving promotes the next admin; non-members get 403.
4. Clan members show driver titles incl. Rookie for new members; permissions unchanged.
5. Leaderboard shows top 20 for month and all time with correct points; my rank shown; info sheet explains points.
6. App reflects DESIGN-PASS.md in light and dark.
7. All new text az + en.

## Server notes for app builders (v4)
Only the details and additions beyond the spec above. All v2 and v3 notes still apply. Errors use the same `{error:{code,message}}` shape.

**Friends**
- `POST /api/friends/requests {userId}` returns `{status, request, user}`. `user` = `{id, displayName, avatarUrl}`.
  - New request: 201, `status: 'pending'`, `request` = `FriendRequest`.
  - They had already asked me: their request is accepted instead. 200, `status: 'friends'`, `request: null`.
  - Errors: yourself 400. Unknown user 404. A block either way 403. Already friends, already sent, 50 pending outgoing, or 1000 friends: 409. More than 30 per hour: 429.
  - After a decline, the sender gets 409 "...declined your request recently; try again in 24 hours". The person who declined can still send a request the other way.
- `FriendRequest` = `{id, from: {id,displayName,avatarUrl}, to: {...}, createdAt}`.
- `GET /api/friends/requests?dir=in|out` (default `in`) returns `{items: FriendRequest[]}`, newest first. Declined requests are in neither list.
- `POST /api/friends/requests/:id/accept` returns `{status:'friends', user}`. Only the recipient can do it; anyone else, or an old / cancelled / declined request, gets 404. Block 403. Friend cap 409.
- `POST /api/friends/requests/:id/decline` returns 204 (recipient only, else 404).
- `DELETE /api/friends/requests/:id` returns 204: the sender cancels. Anyone else 404. No cooldown after a cancel.
- `GET /api/friends?q=` returns `{items: [{user, since}]}`, sorted by name. `q` (≤40) filters by name.
- `DELETE /api/friends/:userId` returns 204, also if you were not friends.
- Blocking someone ends the friendship and deletes pending requests both ways.
- `GET /api/users/:id` now also has `friendship: 'none'|'friends'|'outgoing'|'incoming'`, `requestId` (set when outgoing / incoming, use it for accept / decline / cancel), `friendCount`, `mutualFriends`. On your own profile or logged out: `'none'`, `mutualFriends: 0`.
- Socket (to your user room): `friend:request` (a `FriendRequest`) to the recipient; `friend:accepted {user}` to both people, `user` being the other person. Nothing is sent for decline / cancel / unfriend.

**Badges**
- `GET /api/me/badges` returns `{messages, friendRequests, clanInvites}`. `messages` is the same number as `/conversations/unread`. `friendRequests` = pending incoming. `clanInvites` = my pending, not expired invites. Add them up for the Söhbət tab badge as you like.

**Search**
- `GET /api/search?q=` (`q` 2–40 chars, else 400). Login optional. Returns:
  - `users` (≤10): `{id, displayName, avatarUrl, city, isFriend}`. Friends first, then by name. Never yourself, never anyone blocked either way.
  - `clans` (≤5): `{id, name, tag, logoUrl, city, isOpen, memberCount}`. Matches name or tag.
  - `conversations` (≤10): the same item shape as `GET /conversations`. Only mine. Matches group name, clan name, event title, or the name of another member of a DM or group. Empty when logged out.

**Group chats**
- Conversation `type: 'group'`. Every conversation item (list, `GET /conversations/:id`) now also has `adminId` (groups only, else null), `isAdmin`, `memberCount`. For a group, `title` is its name and `avatarUrl` its photo.
- `POST /api/conversations/group {name (1–40), userIds (1–19, duplicates ignored)}` returns 201 with the conversation item. Every id must be my friend (else 403, nothing is created). Including yourself gives 400. Limit 20 groups per hour.
- `PATCH /api/conversations/:id {name}` returns the item. Admin only (403). Same name: nothing changes, no message.
- `PUT /api/conversations/:id/avatar` takes raw image bytes like the other photos (2 MB, resized to 512px, counts toward the admin's 20 MB) and returns `{avatarUrl}`. `DELETE` on the same path returns 204. Admin only.
- `POST /api/conversations/:id/members {userIds}` returns the item. Admin only. Non-friends of the admin 403. If all are already members 409 (others already in the list are skipped). Over 20 members 409 "A group can have at most 20 members".
- `DELETE /api/conversations/:id/members/:userId` returns 204. Your own id = leave (anyone). Someone else = admin only (403). Not a member 404.
  - If the admin leaves, the member who has been in the group longest becomes admin.
  - When the last member leaves, the group and its messages are deleted (404 after that).
- `GET /api/conversations/:id/members` (any chat I'm in) returns `{items: [{user, isAdmin, joinedAt}]}`, admin first, then by join time.
- Errors: not a member 403; unknown chat 404. Group-only routes on a DM / clan / event chat give 400.
- Pin: only the admin. Mute, delete own message, reports and blocks work as in other chats.
- System message keys (params):
  - `group.created` → `{name, byUserId, byDisplayName}`
  - `group.added`, `group.removed` → `{userId, displayName, byUserId, byDisplayName}`
  - `group.left`, `group.admin` (new admin) → `{userId, displayName}`
  - `group.renamed` → `{name, byUserId, byDisplayName}`
- Socket: members are added to / removed from the room right away (no reconnect needed). After every change the room gets `group:updated {conversationId}` (reload the chat header / member list). A removed or leaving member is taken out of the room first, then gets `group:removed {conversationId}` on their user room, and nothing about that group after it (not the "removed"/"left" system message either).
- `POST /api/conversations/dm` is unchanged: anyone not blocked.

**Clans: driver titles + points**
- `GET /api/clans/:id/members` items are now `{user, role, title, joinedAt, monthPoints}`. `title` is `'leader'|'navigator'|'driver'|'rookie'`. Rookie = a plain member who joined less than 30 days ago. Officers are always `navigator`.
- Sorted leader, navigators, drivers, rookies; inside each group by `monthPoints` (high first), then join time.
- `Clan` (all clan responses) gains `monthPoints` = sum of the current members' points this Baku month.
- `GET /api/users/:id` → `clan` gains `title`.
- Permissions still use `role`. Show "Bələdçi / Navigator" wherever the app said officer.

**Leaderboard**
- `GET /api/leaderboard?period=month|all` (default `month`, else 400). Login optional. Returns `{period, monthStart, computedAt, items, me}`.
  - `monthStart` = start of the current Baku month as a UTC time (e.g. `2026-10-31T20:00:00.000Z` for November). Sent for `all` too.
  - `items` (≤20): `{rank, user: {id, displayName, avatarUrl, currentCar: {id,make,model,year,photoUrl}|null, clan: {id,name,tag}|null}, points, breakdown: {spots, events, attended, cars, ratings}, blocked}`. `breakdown` values are points, not counts. `blocked` = you and this user blocked each other (either way): show the row but don't open the profile.
  - `me`: null when logged out. Logged in: `{rank, points}`; `rank` is null with `points: 0` when you have no points yet.
  - Only users with more than 0 points are ranked. Ties: whoever earned their first point of the period earlier ranks higher.
- Cached for 5 minutes, so new points can take up to 5 minutes to show (`computedAt` says when).
- Points, exactly as the rules list them (all caps are per Baku month; all-time adds the months up):
  - Spot shared 10, counted in the month it was created, but only once it is 24 h old and fewer than 2 different users have reported it (reports from one person alone, however many, don't remove points). Max 10 spots a month. Deleted spots don't count.
  - Event organized 15, max 4 a month: not cancelled, finished, lasted at least 1 hour, at least 2 cars going (organizer included). Counted when it ends.
  - Event attended 5, max 8 a month: going when the event finished, not the organizer, same event rules. Waitlisted or removed people get nothing.
  - Car with a photo 5: only your first 2 cars (by creation time) that have a photo. Removing the photo removes the points.
  - Rating given 1, at most 20 a month (spot or car). Changing a rating later doesn't count again. Rating your own spot gives nothing.
  - "Finished" = after `endsAt`, or 24 h after `startsAt` if there is no end time. Length = end minus start.
  - So a new spot shows up on the board about a day later. Say so in the "Xallar necə qazanılır?" sheet.

**Rate limits (new)**
- `GET /api/search`: 60 per minute per user (per IP when logged out), then 429.
- `POST /api/events`: every attempt counts (also failed ones), 30 per hour per user, then 429. The "10 created per 24 h" rule still gives 409.

**Database**
- Migration `server/drizzle/0004_v4_friends_groups.sql` only adds things: tables `friend_requests` and `friendships`, nullable group columns on `conversations` (`name`, `avatar_image_id`, `admin_id`), and `created_at` on `spot_ratings` / `car_ratings` (old rows get their `updated_at`). The conversation type check now also allows `group`. Tested on a v3 database that already has data.
- Migration `0005_v4_leaderboard_indexes.sql` only adds indexes (rating `created_at`, reports by target).
