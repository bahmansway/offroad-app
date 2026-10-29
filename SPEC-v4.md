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
  - Spot shared: 10 (spot still exists, not removed after reports).
  - Event organized that finished (not cancelled) with ≥ 2 cars going: 15.
  - Event attended (status going when the event finished, not organizer): 5.
  - Car added with a photo: 5 (max 2 cars counted).
  - Rating given (spot or car): 1, max 20 per month.
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
