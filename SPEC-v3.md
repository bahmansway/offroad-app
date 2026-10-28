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
