# v3 spec — YOLCHU name + logo, Events, chat & clan management extras

Repo: /home/claude/offroad-repo. SPEC-v1 and SPEC-v2 still apply. Same error format, auth, strict bodies, az+en strings, Expo Go only.

## 1. Name & brand: YOLCHU
- App display name "YOLCHU" (Azerbaijani: "the one on the way"). app.json `name`, web title, in-app wordmark, About page.
  Keep `slug: offroad-app`, projectId and bundle ids unchanged (changing them breaks the Expo link).
- Logo + app icon + splash + favicon from the designer (files will appear in app/assets/brand/).

## 2. Events (Tədbirlər tab)
Event: `{id, title (3–80), description (≤2000), startsAt (future, ≤1 year ahead), endsAt? (> startsAt, ≤7 days later),
spot: SpotSummary|null, meetingPoint {lat,lng,label (≤80)}|null (at least one of spot / meetingPoint required),
maxCars (2–100), minDifficulty? (1–5, informational), requirements: string[] (≤8 tags, ≤24 chars, e.g. "4WD", "Winch", "Radio"),
visibility: 'public'|'clan' (clan = only members of organizer's clan can see/join), clan: {id,name,tag}|null,
organizer: UserSummary, status: 'scheduled'|'cancelled'|'finished' (finished derived from time), participantCount,
carCount, myStatus: 'organizer'|'going'|'waitlist'|null, conversationId (only for participants), coverUrl|null}`.
- Join with one of your own cars (`carId` required, + optional `seats` passengers 0–6). When full → waitlist (FIFO);
  when someone leaves, first waitlisted is promoted automatically and notified via chat system message.
- Organizer: edit (not after start), cancel (with reason → system message in event chat), remove participant, set cover photo
  (same image pipeline as v2). Organizer is a participant automatically (must pick a car too).
- Event chat: conversation type `event`, members = organizer + going + waitlist; leaving/removed loses access;
  cancelled/finished events keep chat read-only for 7 days.
- System messages: `{type:'system', text key + params}` for joined/left/promoted/cancelled/edited (rendered translated in app).
- Endpoints: `GET /api/events?scope=upcoming|mine|past&clanOnly=&near=lat,lng&limit&cursor`, `POST /api/events`,
  `GET/PATCH /api/events/:id`, `POST /api/events/:id/cancel {reason?}`, `POST /api/events/:id/join {carId, seats?}`,
  `POST /api/events/:id/leave`, `GET /api/events/:id/participants`, `DELETE /api/events/:id/participants/:userId` (organizer),
  `PUT/DELETE /api/events/:id/cover`. `GET /api/spots/:id` gains `upcomingEvents: EventSummary[]` (max 5).
- Limits: 10 events created/day/user; max 20 upcoming events organized per user. Reports accept targetType `event`.
- App: Tədbirlər tab (Upcoming / Mine / Past segmented, list cards with date block, spot, cars x/max, difficulty, clan badge);
  event page (cover, title, date/time, spot or meeting point map, requirements, participants with their cars, join/leave/waitlist,
  open chat, organizer tools, report); create/edit form (pick spot from list or "use map centre" meeting point, date/time picker
  that works on web + iOS + Android in Expo Go, max cars, level, requirements chips, public/clan); "Create event here" on spot page;
  spot page shows upcoming events. Add to phone calendar is out of scope.

## 3. Chat & clan management extras
- Delete own message (soft delete → "Message deleted" placeholder for everyone; within 24 h).
- Clan officers: role `officer` (leader can promote/demote). Officers can approve/reject requests, remove members (not leader/officers),
  and pin a message. Leader keeps edit/delete/handover.
- Clan invite: leader/officer invites a user (from their profile: "Klana dəvət et"); invitee accepts/declines from Söhbət → Klanlar;
  invite expires in 7 days. Max 30 pending invites per clan.
- Pinned message per conversation (clan: leader/officer; event: organizer; DM: either user) shown at top of chat.
- Mute a conversation (per user, no unread badge counting while muted).
- Clan member cap 200. Clan page shows clan's upcoming events.

## Acceptance checks
1. App, website and Expo Go show the YOLCHU name and new logo/icon.
2. Create public event on a spot; second user joins with a car; third joins after it's full → waitlist; second leaves → third promoted
   with a system message; organizer cancels → read-only chat with reason.
3. Clan-only event invisible (404) to non-members.
4. Officer approves a join request and removes a member; officer can't remove leader/officer (403).
5. Invite flow works; expired/duplicate invites rejected.
6. Delete own message, pin, mute work; can't delete others' messages (403).
7. All new text az + en.

## Server notes for app builders (v3)
Only the details and additions beyond the spec above. All v2 notes still apply. Errors use the same `{error:{code,message}}` shape.

**Events: shapes**
- `EventSummary` (lists, spot page, clan page): `{id, title, startsAt, endsAt|null, spot: {id,name,type,difficulty,lat,lng}|null, meetingPoint: {lat,lng,label}|null, maxCars, minDifficulty|null, requirements: string[], visibility: 'public'|'clan', clan: {id,name,tag}|null, organizer: {id,displayName,avatarUrl}, status: 'scheduled'|'cancelled'|'finished', participantCount, carCount, waitlistCount, isFull, myStatus: 'organizer'|'going'|'waitlist'|null, coverUrl|null}`.
- `Event` (GET/POST/PATCH `/events/:id`, join, cancel) = `EventSummary` + `{description, cancelReason|null, cancelledAt|null, conversationId|null, chatReadOnly, canEdit, createdAt, updatedAt}`.
- `carCount` = cars going (this is what counts against `maxCars`). `participantCount` = people going (each driver + their `seats` passengers). Waitlisted people are not in either count.
- `conversationId` is only set for the organizer, going and waitlisted people. It goes back to null 7 days after cancel/finish.
- `canEdit` is true only for the organizer, before the start time, while not cancelled.
- `status` 'finished' is worked out from time: after `endsAt`, or 24 h after `startsAt` if there's no `endsAt`.
- All times are ISO strings. Send `startsAt`/`endsAt` with an offset, e.g. `2026-11-02T09:00:00.000Z` (use `date.toISOString()`).

**Events: endpoints**
- `GET /api/events?scope=upcoming|mine|past&clanOnly=true&near=lat,lng&radiusKm=100&limit=20&cursor=` returns `{items: EventSummary[], nextCursor|null}`. To get the next page, pass `nextCursor` back as `cursor`.
  - `upcoming`: scheduled and not finished, soonest first.
  - `mine`: not finished, where I'm the organizer, going or waitlisted. This includes my cancelled ones, so I can still see them. Needs login (403 otherwise).
  - `past`: finished or cancelled, newest first.
  - `near` filters by the spot location, or by the meeting point if there's no spot. `radiusKm` is 1–1000 (default 100). `limit` is 1–50.
  - `clanOnly=true`: only clan-only events of my own clan. Logged out, this returns an empty list.
- `POST /api/events` returns 201 with an `Event`. Body: `{title, description?, startsAt, endsAt?, spotId?, meetingPoint?: {lat,lng,label?}, maxCars, minDifficulty?, requirements?, visibility?, carId, seats? (0–6)}`. `carId` is required because the organizer joins with a car.
  - Errors: no spot and no meeting point, bad times, or a bad body give 400. Someone else's car gives 403. An unknown spot or car gives 404.
  - Clan-only without being in a clan gives 409. The daily and upcoming limits also give 409 `CONFLICT`. Each limit has its own message (10 per day / 20 upcoming). Cancelled events don't count toward the upcoming limit.
  - The event's `clan` is the organizer's clan when they create the event. It is used for the clan badge and for who can see clan-only events.
- `PATCH /api/events/:id`: same fields minus `carId`/`seats`. All are optional, and `null` clears `endsAt`, `spotId`, `meetingPoint` or `minDifficulty`.
  - Only the organizer can do this (403). After start or once cancelled it returns 409. Lowering `maxCars` below the number of cars going returns 409.
  - Raising `maxCars` promotes people from the waitlist right away.
  - Each edit posts an `event.edited` system message.
- `POST /api/events/:id/cancel {reason? (≤300)}` returns the `Event`. Only the organizer can cancel. If it's already cancelled or finished you get 409.
- `POST /api/events/:id/join {carId, seats?}` returns the `Event`. Check `myStatus`: 'going', or 'waitlist' when the event is full.
  - Already joined gives 409. Cancelled or already started gives 409. Someone else's car gives 403.
  - Someone the organizer removed gives 403 and can't rejoin. If the user and the organizer have blocked each other, that also gives 403.
  - The waitlist is first come, first served. Joins are done one at a time per event, so even simultaneous joins can't go over `maxCars` (this is tested).
- `POST /api/events/:id/leave` returns 204. The organizer gets 409 (they cancel instead). Someone not in the event gets 404. If a 'going' person leaves, the first person on the waitlist is promoted.
- `GET /api/events/:id/participants` returns `{items: [{user, status: 'going'|'waitlist', isOrganizer, seats, car: {id,make,model,year,photoUrl}|null, joinedAt}]}`. The order is: organizer, then going, then waitlist (in queue order). `car` is null if that car was deleted.
- `DELETE /api/events/:id/participants/:userId` returns 204. Only the organizer can do this. Removing yourself gives 409, and so does removing someone after the event is over. If a 'going' person is removed, the next one on the waitlist is promoted.
- `PUT /api/events/:id/cover` takes raw image bytes, the same way as v2 photos (2 MB max). It is resized to 1024px max and counts toward the 20 MB per-user quota. It returns `{coverUrl}`. `DELETE` on the same path returns 204. Only the organizer can do either.
- `GET /api/spots/:id` now includes `upcomingEvents: EventSummary[]`: up to 5, soonest first, only the ones the viewer can see.
- `GET /api/clans/:id/events` returns `{items: EventSummary[]}`: up to 20 upcoming events of that clan. Clan-only ones only show for its members.
- `POST /api/reports` accepts `targetType: 'event'`. A clan-only event you can't see gives 404.

**Clan-only visibility**
- Who can see a clan-only event: members of its clan, the organizer, and anyone already going or waitlisted. Everyone else, including logged-out users, gets 404 on every event route. It is also left out of all lists, spot `upcomingEvents` and clan events.
- Someone who leaves the clan keeps seeing an event they had already joined, until they leave it.

**Event chat**
- Conversation `type: 'event'`. It is created with the event. Its members are the organizer, going and waitlisted people.
- Join, leave and remove update the chat live: sockets are added to or removed from the room right away.
- Each of these changes also emits `event:updated {eventId}` to the event chat room, so the app can reload the event page. A removed person gets it on their own user room.
- Cancelled or finished: the chat is read-only. Posting, deleting and pinning return 403. Reading and mute still work.
- 7 days after cancel or end, the chat is gone: the conversation returns 404 and drops out of `GET /conversations`.

**Messages: new fields** (REST and socket, in all chats)
- `Message` = `{id, conversationId, type: 'user'|'system', sender: {id,displayName,avatarUrl}|null, text, systemKey|null, systemParams|null, createdAt, clientId|null, deletedAt|null}`.
- For system messages, `sender` is null. Translate `systemKey` in the app; `text` is an English fallback.
- System message keys and params:
  - `event.joined`, `event.waitlisted`, `event.left`, `event.promoted`, `event.removed` → `{userId, displayName}`
  - `event.cancelled` → `{reason: string|null}`
  - `event.edited` → `{fields: string[]}`
- Deleted message: `deletedAt` is set and `text` is `''`. Show the "Message deleted" placeholder.

**Chat extras**
- `DELETE /api/conversations/:id/messages/:messageId` returns 204. You can only delete your own user messages, and only within 24 h. Someone else's message, a system message, or one older than 24 h gives 403. Deleting twice is fine (204).
  - The server emits `message:deleted {id, conversationId, deletedAt}` to the room.
  - If the deleted message was pinned, it is unpinned too.
- Pin:
  - `PUT /api/conversations/:id/pin {messageId}` returns `{pinned}`. `DELETE` on the same path returns 204.
  - Who can pin: in a clan chat the leader or an officer; in an event chat the organizer; in a DM either user. Anyone else gets 403.
  - Pinning a deleted message gives 400. A message from another chat gives 404.
  - The socket event `conversation:pinned {conversationId, pinned|null}` goes to the room.
  - `pinned` = `{message: Message, pinnedBy: userId, pinnedAt}`.
- Mute: `PUT /api/conversations/:id/mute` returns `{muted:true}`. `DELETE` on the same path returns `{muted:false}`. This is per user.
- `GET /api/conversations/unread` returns `{total}`, for the tab badge. Muted chats, deleted messages and my own messages are not counted.
- Each conversation item now also has `{eventId, muted, readOnly, readOnlyUntil|null, pinned|null, canPin}`.
  - `unreadCount` still counts in a muted chat. The app should hide the badge when `muted` is true.
  - For an event chat, `title` is the event title and `avatarUrl` is its cover.

**Clans: officers**
- `myRole` and member `role` can now be `'officer'`. `/members` is sorted leader, then officers, then members.
- `POST /api/clans/:id/members/:userId/role {role: 'officer'|'member'}` returns `{userId, role}`. Only the leader can do this (403). Targeting yourself gives 409. A user who isn't a member gives 404.
- Leader and officers can: see requests, approve, reject, remove members, invite, list or revoke invites, and pin.
- An officer removing the leader or another officer gives 403. The leader can remove officers.
- Leader-only actions stay leader-only: edit, logo, delete, handover, role changes.
- Handover can go to a member or an officer. The old leader becomes a member. Officers leave with the normal `/leave`.

**Clan invites**
- `POST /api/clans/:id/invites {userId}` returns 201 with `{id, clan:{id,name,tag,logoUrl}, invitedBy, user:{id}, createdAt, expiresAt}`. Invites expire after 7 days.
  - Errors: inviting yourself gives 400. An unknown user gives 404. Not the leader or an officer, or a block either way, gives 403.
  - 409: the user is already in a clan, already has a pending invite, or the clan already has 30 pending invites.
  - The invitee gets the socket event `clan:invite` (same shape, without `user`).
- `GET /api/clans/:id/invites` returns `{items:[{id, user, invitedById, createdAt, expiresAt}]}`. Only the leader or an officer can see this. Expired invites are hidden.
- `DELETE /api/clans/:id/invites/:inviteId` returns 204. This is the leader or an officer revoking an invite.
- `GET /api/me/clan-invites` returns `{items:[{id, clan, invitedBy|null, createdAt, expiresAt}]}`. These are my pending invites, for Söhbət → Klanlar.
- `POST /api/clan-invites/:id/accept` returns the `Clan` with `myRole: 'member'`.
  - Not my invite, or already revoked, gives 404. Expired gives 409 "This invite has expired".
  - Already in a clan, or the clan is full, gives 409. The one-clan rule is still enforced by the database.
  - Accepting clears all my other invites and requests.
- `POST /api/clan-invites/:id/decline` returns 204.

**Clan member cap**
- A clan can have at most 200 members. Join, approve and accepting an invite give 409 "This clan is full (200 members)". Joins are done one at a time per clan, so the cap can't be beaten by joining at the same moment.

**Database**
- Migration `server/drizzle/0002_v3_events_chat_extras.sql` only adds things: new tables, plus new columns that are either nullable or have a default. Old messages become `type 'user'`. It is tested on a v2 database that already has data in it.
