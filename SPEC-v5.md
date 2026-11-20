# v5 spec — phone notifications, event reminders, add to calendar

Repo: /home/claude/offroad-repo. SPEC-v1..v4 still apply (error format, auth, strict zod, az+en, blocks respected, Baku time for events).

Platform facts (Expo SDK 58): remote push is NOT available in Expo Go (needs a development/store build);
local scheduled notifications and expo-calendar DO work in Expo Go. Expo push service is free.
So: build push end-to-end now (it starts working once we ship a real build), and make reminders + calendar work today in Expo Go.

## 1. Message notifications (remote push)
- Server: table `push_tokens {id, userId, token (ExponentPushToken[...]), platform, createdAt, lastSeenAt}`, unique token.
  `POST /api/me/push-tokens {token, platform}` (upsert; a token moves to the latest user who registers it),
  `DELETE /api/me/push-tokens {token}` (called on logout). Validate token format.
- Send via Expo push API (https://exp.host/--/api/v2/push/send) in batches of ≤100, fire-and-forget after the DB commit, never blocking requests.
  Handle receipts/errors: on `DeviceNotRegistered` delete the token. Optional `EXPO_ACCESS_TOKEN` env for enhanced security; no secrets in code.
- Triggers (recipient-side rules: not to the sender, respect blocks, respect per-conversation mute, skip users currently connected to that conversation's socket room is optional):
  new message in DM / group / clan / event chat (title = sender name or chat title, body = message text truncated to 120 chars, data = {type:'message', conversationId});
  friend request received / accepted; clan invite received; clan join request (to leader + navigators); event: you were promoted from waitlist, event cancelled (to participants), event edited time/place (to participants).
- Settings: `GET/PATCH /api/me/notification-settings {messages, friends, clans, events}` booleans, default all true. Respect them server-side.
- Rate safety: coalesce — max 1 push per conversation per recipient per 30 s (later messages within the window are skipped; unread badge still counts).
- Badge number on iOS = unread messages + friend requests + clan invites (from the same logic as /api/me/badges).
- App: on login (and app start when logged in) ask permission once with a short az/en explanation screen first; if granted and NOT running in Expo Go, get the Expo push token (projectId from app config) and register it; on logout delete it. Android notification channel "messages" and "events". Tapping a notification opens the right screen (chat/:id, friends, clans, event/:id). Foreground: show an in-app banner instead of a system notification if the user is not already in that chat.
- Profile → "Bildirişlər" settings screen with the 4 toggles + a line explaining that in the Expo Go test app only reminders work, full notifications come with the store app.

## 2. Event reminders (local, work in Expo Go)
- When I join (going), or I'm the organizer, schedule local notifications: 24 h before and 2 h before start (skip times already passed). Title = event title, body = "Sabah 09:00 · Xızı" / "2 saata başlayır · <place>" (Baku time), data = {type:'event', eventId}.
- Cancel/reschedule when I leave, am removed, the event is cancelled, or its time changes (re-sync on app start and when events load: keep scheduled reminders = upcoming events where I'm organizer/going).
- Waitlisted: no reminder until promoted.
- Setting toggle "Tədbir xatırlatmaları" (local, stored per device) + respects the server `events` setting.
- Web: not supported (hide the toggle on web).

## 3. Add to calendar
- Event page button "Təqvimə əlavə et": on iOS/Android use expo-calendar (ask permission, pick the default calendar, create event with title, start/end (end = endsAt or start + 4 h), location = spot name or meeting point label + coordinates, notes = short description + app link, alarm 1 day before). Remember the created calendar event id per event on the device; if the event time changed, offer "Təqvimi yenilə".
- Web: download an .ics file with the same data (correct UTC times, escaped text).

## Acceptance
1. Server sends push for each trigger to the right people only (blocks, mutes, settings, coalescing) — verified with a mocked Expo push endpoint in tests.
2. In Expo Go: joining an event schedules 2 reminders; leaving cancels them; event time change reschedules.
3. Add to calendar works on phone (expo-calendar) and on web (.ics).
4. Push token registration only happens outside Expo Go; logout removes the token.
5. All new text az + en.

## Server notes for app builders (v5)
Only the details and additions beyond the spec above. All v2–v4 notes still apply. Errors use the same `{error:{code,message}}` shape.

**Push tokens**
- `POST /api/me/push-tokens {token, platform: 'ios'|'android', locale?: 'az'|'en'}` returns 204. `token` must look like `ExponentPushToken[...]` (or `ExpoPushToken[...]`), else 400. Unknown keys 400.
  - Upsert by token: the same token sent by another user moves to that user. Sending it again updates `platform`, `locale` and `lastSeenAt`.
  - `locale` (default `az`) is the language of the texts the server writes (friend request, event cancelled, ...). Send the app language, and send again when it changes.
  - At most 10 phones per user: the least recently seen are dropped. Limit 60 calls per hour (429).
- `DELETE /api/me/push-tokens {token}` returns 204. Only removes the token if it is yours (otherwise still 204). Needs login, so call it before clearing the session on logout.

- `POST /api/auth/logout {refreshToken, pushToken?}` (review fix): with `pushToken` the server also deletes that token for the user who owns the refresh token. This works even when the refresh token is already revoked or expired, so the app can send it after a lost session or retry an offline logout on the next start. A bad `pushToken` format gives 400; another user's token is never touched. Still 204.
  - The app sends it on every logout. On a lost session or a failed logout it keeps a note on the phone and retries on the next app start.

**Settings**
- `GET /api/me/notification-settings` returns `{messages, friends, clans, events}` (all `true` until changed).
- `PATCH` the same path with any of the four booleans; returns all four. Strict body (unknown key or non-boolean 400). `{}` is fine and changes nothing.
- `messages` = chat messages. `friends` = friend request received / accepted. `clans` = clan invite received, join request (leaders + navigators). `events` = promoted from the waitlist, time/place changed, cancelled.

**What the phone receives** (Expo push, `data` is what the app reads on tap)
| Trigger | Who | title / body | `data` | Android `channelId` |
|---|---|---|---|---|
| Chat message (user messages only, never system messages) | every chat member except the sender, minus muted chats and members who blocked the sender | DM: sender name / text. Group, clan, event chat: chat name / "Sender: text" | `{type:'message', conversationId}` | `messages` |
| Friend request | the recipient | "Dostluq təklifi" / "X sizə dostluq təklifi göndərdi" | `{type:'friend_request', userId}` (sender) | `messages` |
| Friend request accepted (also the auto-accept of crossing requests) | the person who sent the request | "Yeni dost" / "X dostluq təklifinizi qəbul etdi" | `{type:'friend_accepted', userId}` (who accepted) | `messages` |
| Clan invite | the invitee | "Klana dəvət" / "X sizi «Clan» klanına dəvət edir" | `{type:'clan_invite', clanId, inviteId}` | `messages` |
| Join request to a request-only clan (only the first time, not on repeats) | leader + navigators, minus anyone with a block either way | "Klana qoşulmaq istəyi" / "X «Clan» klanına qoşulmaq istəyir" | `{type:'clan_request', clanId}` | `messages` |
| Promoted from the waitlist (leave, removal, or more `maxCars`) | the promoted people | event title / "Yer açıldı: ..." | `{type:'event', eventId}` | `events` |
| Event edited, only when `startsAt`, `endsAt`, spot or meeting point changed | going + waitlisted, not the organizer, not people who blocked the organizer | event title / "Vaxt və ya yer dəyişdi: 22.11 09:00 · Place" (Baku time) | `{type:'event', eventId}` | `events` |
| Event cancelled | same as edited | event title / "Tədbir ləğv edildi: reason" | `{type:'event', eventId}` | `events` |
- Bodies are cut to 120 characters (with "…"), titles to 80.
- `badge` (iOS app icon) = unread messages + incoming friend requests + clan invites, the same numbers as `GET /api/me/badges`.
- Coalescing: at most one chat notification per chat per person per 30 s; later messages in the window send no push (the unread count still goes up).
  - Event time/place edits: at most one per event per person per 10 minutes (`event-edit:<id>`). Cancel and promotion are never held back.
  - Friend requests: at most one per sender → recipient per hour (send / cancel / send spam). Clan join requests: at most one per clan + requester per hour.
- Badge numbers for all recipients of one notification come from one grouped query (`appBadges` in `lib/badges.ts`), same rules as `/me/badges`.
- Settings are applied server-side. The sender never gets their own notification.

**How it is sent**
- `server/src/lib/push.ts`: fire-and-forget after the database change; a slow or broken Expo service never delays the API reply. Batches of up to 100.
- `DeviceNotRegistered` in the send ticket, or in the receipt checked about 15 minutes later, deletes that token.
- Failures are logged with counts, HTTP status and Expo error codes only: never tokens, never message text.
- Env (all optional): `EXPO_ACCESS_TOKEN` (only if "Enhanced security for push notifications" is turned on in the Expo project), `EXPO_PUSH_URL` (tests point it at a mock), `PUSH_COALESCE_MS` (default 30000), `PUSH_RECEIPT_DELAY_MS` (default 15 min).
- The coalescing memory is per server process (fine for the single Railway instance).

**Database**
- Migration `server/drizzle/0006_v5_push.sql` only adds the tables `push_tokens` and `notification_settings`. Tested on a v4 database that already has data.

**App side (for reference)**
- Remote push registration is skipped in Expo Go (`Constants.executionEnvironment === 'storeClient'` or `appOwnership === 'expo'`) and on simulators. Reminders (local notifications) and add-to-calendar (`expo-calendar/legacy`, because the new object API is not in Expo Go yet) work in Expo Go.
- Phone calendar entries are remembered per account (`cal.<userId>.<eventId>`); when an event is cancelled and it is in my phone calendar, the event page offers "Təqvimdən sil". Taps are de-duplicated by notification id (launch tap vs. listener). The reminder sync pages through all of my events.
- Local reminder ids are `yolchu-reminder:<eventId>:24h|2h`; the app re-syncs them on app start / foreground, on `event:updated`, after the event page loads, and when settings or language change.
