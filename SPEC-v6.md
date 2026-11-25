# v6 spec — photo posts, follow system, new Home feed, new tab order, Waze, map fixes

Repo: /home/claude/offroad-repo. SPEC-v1..v5 still apply (error format, auth, strict zod, az+en, blocks, private mod prices, Baku time, Expo Go only, push via lib/notify).

## Tabs (new order)
1. **Ana səhifə / Home** (new feed) · 2. **Kəşf et / Explore** (map) · 3. **Söhbət / Chat** (centre) · 4. **Qaraj / Garage** · 5. **Profil / Profile**.
Events move out of the tab bar: reachable from Home ("Tədbirlər" row/section + upcoming-trip card) and from Explore. Keep `/events` route working.

## 1. Photo posts (Instagram-like, simple)
- Post: `{id, author: UserSummary, photos: Photo[] (1–6, order kept), caption (≤1000), car: CarSummary|null (author's own car only), spot: SpotSummary|null (any visible spot; optional "assign to a road"), likeCount, commentCount, likedByMe, savedByMe, createdAt, editedAt}`.
- Upload: same image pipeline (re-encode JPEG, strip EXIF/GPS, max 1440 px long side, quality ~0.8), stored in Postgres like other images. Per-user photo quota 50 MB total (posts included). Rate: 20 posts/day, 60 photos/day.
- Endpoints: `POST /api/posts` (multipart-free: create post first with caption/car/spot, then `PUT /api/posts/:id/photos/:index` raw image bodies, then `POST /api/posts/:id/publish`; unpublished drafts older than 24 h are deleted), `GET /api/posts/:id`, `PATCH /api/posts/:id {caption, carId, spotId}` (author), `DELETE /api/posts/:id` (author), `POST/DELETE /api/posts/:id/like`, `POST/DELETE /api/posts/:id/save`, `GET /api/posts/:id/comments?cursor`, `POST /api/posts/:id/comments {text ≤500}`, `DELETE /api/comments/:id` (author of comment or of post).
- Lists: `GET /api/feed?cursor` (Home — posts from people I follow + my own, newest first; if I follow < 3 people, append "suggested" recent public posts flagged `suggested:true`), `GET /api/users/:id/posts?cursor`, `GET /api/me/saved?cursor`, `GET /api/spots/:id/posts?cursor`, `GET /api/cars/:id/posts?cursor`.
- Blocks: hidden both ways everywhere (feed, lists, comments, likes). Reports accept targetType `post` and `comment`.
- Push (existing settings, new "social" toggle default on): someone liked your post (coalesce 1/post/hour), commented, followed you.
- Leaderboard: +3 per published post with ≥1 photo, max 10 posts/month (same anti-farming style; deleted posts don't count).

## 2. Follow system (replaces friends)
- `POST/DELETE /api/users/:id/follow`, `GET /api/users/:id/followers?cursor&q=`, `GET /api/users/:id/following?cursor&q=`. No approval needed (public profiles). Blocks remove follows both ways and prevent following.
- **Migration from friends:** every existing friendship becomes mutual follow; pending friend requests become a follow from the requester. Friends endpoints stay working for one release but are no longer used by the app.
- "Dost" = mutual follow. Group chat adds require mutual follow (replaces friends-only). Search: people I follow first.
- PublicUser gains `followerCount, followingCount, postCount, isFollowing, followsMe`.
- Badges: friend requests replaced by "new followers since last viewed" (`POST /api/me/followers/seen`).

## 3. Home feed (new first tab)
- Top: compact header with YOLCHU wordmark, search icon, notifications/activity bell (likes, comments, new followers — `GET /api/me/activity?cursor`).
- "Next trip" card (my next going/organized event) or "Bu həftəsonu" suggestions (2–3 public upcoming events) — horizontal.
- Feed of post cards: author row (avatar, name, clan tag, time), photo carousel (swipe, dots, double-tap like with haptic), action row (like, comment, save, share-link), caption (2 lines + more), chips for car and spot (tap → car / spot page).
- Empty state for new users: "Follow drivers" suggestions (active users, clan mates) + "Share your first photo".
- Big "+" (create) button: New post (pick up to 6 photos → crop/order → caption → optional car + spot → share). Also offers "Spot paylaş" and "Tədbir yarat".
- Pull to refresh, infinite scroll, cached first page.

## 4. Profile (big change)
- Header: avatar, name, city, clan tag + title, bio; counts: Paylaşımlar · İzləyicilər · İzlənilir (tap → lists with search, follow/unfollow buttons); my monthly points/rank chip.
- Buttons: own profile → "Profili redaktə et", settings (gear); other → "İzlə / İzləyirsən", "Mesaj yaz", ··· (block, report).
- Tabs under header: **Paylaşımlar** (3-column photo grid; tap → post; own posts long-press/··· → edit caption/car/spot, delete) · **Qaraj** (their cars) · **Saxlanılanlar** (own profile only).
- Settings (gear) holds what the old profile list had: language, appearance, notifications, about/licences, logout.

## 5. Explore / map
- "Yol göstər / Navigate" on spot and event pages and the map pin card opens a chooser: **Waze** (`https://waze.com/ul?ll=<lat>,<lng>&navigate=yes`), Google Maps (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`), Apple Maps on iOS (`http://maps.apple.com/?daddr=<lat>,<lng>`). Use Linking; on web open in a new tab. Remember the last choice per device ("Həmişə Waze ilə aç" option).
- Tapping a pin shows a small bottom card (name, difficulty sign, distance, Navigate, Open) instead of jumping straight to the page.
- **Bug (from Bahman's screenshot, iPhone dark mode):** the "Near you" bottom sheet's drag handle does nothing, and the Difficulty range panel sits on top of / under the sheet so its 2/3 buttons are covered. Fix: the sheet must be draggable by its handle and header (snap points: collapsed ~120 px, half, full), the filter panel must close when the sheet is dragged up and must never overlap the sheet (render it as a popover anchored under the filter button, above the sheet's z-order, with a scrim/close). Also make "Show less/more" consistent with the snap state.
- **Map performance:** pin clustering (MapLibre built-in cluster source) with the designed cluster style; load pins from a GeoJSON source instead of DOM markers; only send changed data into the WebView; debounce region changes; don't re-render the whole map on list/filter changes. Target: smooth with 500+ pins on a mid-range Android.

## 6. Small extra suggestions included
- Share link for a post/spot/event (`https://<site>/p/:id`, `/spot/:id`, `/event/:id`) that opens the web app.
- Spot pages show a photo strip from posts assigned to that spot ("Bu yoldan şəkillər").
- Car pages show posts tagged with that car.

## Acceptance
1. Create a post with 3 photos + car + spot; it appears in followers' Home feed, on the profile grid, on the spot and car pages; EXIF stripped.
2. Like/comment/save/delete work; push for like/comment/follow (mock in tests); blocks hide everything both ways.
3. Follow/unfollow, followers/following lists with counts; friends migrated to mutual follows; group adds need mutual follow.
4. Tab order Home · Explore · Chat · Garage · Profile; events reachable from Home and Explore.
5. Navigate chooser opens Waze/Google/Apple Maps with the right coordinates.
6. Explore sheet drags by its handle on iPhone and Android; difficulty panel never overlaps it; map smooth with 500 pins.
7. All new text az + en; light/dark; a11y.

## Server notes for app builders (v6)
Only the details and additions beyond the spec above. All v2–v5 notes still apply. Errors use the same `{error:{code,message}}` shape. Every list is `{items, nextCursor}`: pass `nextCursor` back as `?cursor=` (null = no more). `limit` is 1–50 (default 20). A broken cursor gives 400.

**Shapes**
- `Post` = `{id, author: {id, displayName, avatarUrl, clan: {id,name,tag}|null}, photos: [{url, width, height}] (in order), caption, car: {id,make,model,year,photoUrl}|null, spot: {id,name,type,difficulty,lat,lng}|null, likeCount, commentCount, likedByMe, savedByMe, status: 'draft'|'published', createdAt, editedAt|null}`. Feed items also have `suggested: boolean`.
- `createdAt` is the moment the post was shared (publish time). `editedAt` is set when a published post's caption / car / spot changes.
- `Comment` = `{id, postId, author: {id,displayName,avatarUrl}, text, createdAt, canDelete}`. `canDelete` = I wrote it or it is on my post.
- Image urls are relative (`/api/images/<id>`), like other photos.

**Making a post**
1. `POST /api/posts {caption? (≤1000, trimmed), carId? (my own car, else 403), spotId? (any spot)}` → 201 `Post` with `status:'draft'`, `photos: []`. Unknown car / spot 404. Strict body.
2. `PUT /api/posts/:id/photos/:index` (index 0–5) with raw image bytes, same as other photos (JPEG/PNG/WebP, ≤2 MB, `Content-Type: image/jpeg`). Returns the draft `Post`. Re-encoded to JPEG, max 1440 px long side, quality 80, all EXIF/GPS removed. Sending the same index again replaces that photo. `DELETE` on the same path removes it (204). Only for drafts: after publishing both give 409. Someone else's draft 404.
3. `POST /api/posts/:id/publish` → `Post` (`status:'published'`). No photo yet 409. Calling it again on a published post just returns it.
- Drafts are only visible to their author (others get 404) and are deleted with their photos 24 h after `POST /posts` if not published (checked on server start and every hour). So upload and publish in one go.
- Photo order = index order (gaps are fine: indexes 0, 2, 3 show as 3 photos in that order).

**Post endpoints**
- `GET /api/posts/:id` (login optional) → `Post`. Draft of someone else, or a block either way: 404.
- `PATCH /api/posts/:id {caption?, carId?, spotId?}` (author; `null` clears car / spot) → `Post`. Someone else 403. 60 edits per hour.
- `DELETE /api/posts/:id` (author) → 204. Photos, likes, saves and comments go with it.
- `POST` / `DELETE /api/posts/:id/like` → `{likeCount, likedByMe}`. Both are idempotent.
- `POST` / `DELETE /api/posts/:id/save` → `{savedByMe}`.
- `GET /api/posts/:id/likes?cursor` → items `{user: {id,displayName,avatarUrl}, isFollowing, likedAt}`, newest first.
- `GET /api/posts/:id/comments?cursor` → `Comment[]`, **oldest first** (cursor continues forward).
- `POST /api/posts/:id/comments {text (1–500, trimmed)}` → 201 `Comment`.
- `DELETE /api/comments/:id` → 204. Comment author or post author; anyone else 403; unknown 404.
- Likes / saves / comments on drafts or hidden posts give 404.

**Lists** (all newest first, only published posts, people blocked either way left out)
- `GET /api/feed` (login required): my posts + people I follow. If I follow fewer than 3 people, once those run out the list continues with recent posts by others, marked `suggested: true` (same cursor, keep paging).
- `GET /api/users/:id/posts` (profile grid), `GET /api/spots/:id/posts` ("Bu yoldan şəkillər"), `GET /api/cars/:id/posts`. Unknown user / spot / car 404. Blocked either way: empty list.
- `GET /api/me/saved`: ordered by when I saved them.
- Cursors use `createdAt` + id, so new posts arriving while scrolling never shift or repeat pages.

**Follows**
- `POST /api/users/:id/follow` / `DELETE` same path → `{isFollowing, followsMe, followerCount, followingCount}` (counts are the other user's). Idempotent. Yourself 400, unknown 404, block either way 403 (follow only), following 5000 people 409. 100 follow/unfollow per hour.
- `GET /api/users/:id/followers?cursor&q=` and `/following?cursor&q=` → items `{user: {id,displayName,avatarUrl,city}, isFollowing, followsMe, isMe, since}`, newest follow first. `q` (≤40) filters by name. `isFollowing` / `followsMe` are about me and that row's person (false when logged out). Blocked either way with me: empty list; people I blocked / who blocked me are left out of anyone's list.
- `GET /api/users/:id` gains `followerCount, followingCount, postCount, isFollowing, followsMe` (old `friendship` fields still there for old app versions).
- Blocking someone removes follows both ways.
- "Dost" = we follow each other. `GET /api/search` users: people I follow first; each user has `isFollowing` and `isFriend` (= mutual follow).
- Group chats: `POST /conversations/group` and `POST /conversations/:id/members` now need a mutual follow with the admin (else 403 "You can only add people who follow you and whom you follow").

**Badges and activity**
- `GET /api/me/badges` → `{messages, friendRequests, clanInvites, newFollowers}`. `newFollowers` = followers since I last opened my followers list. Call `POST /api/me/followers/seen` (204) when the list is opened. `friendRequests` is kept for old app versions; the new app ignores it.
- iOS app icon number is now unread messages + new followers + clan invites.
- `GET /api/me/activity?cursor` (bell) → items `{id, type: 'like'|'comment'|'follow', actor: {id,displayName,avatarUrl}, post: {id, photoUrl}|null, comment: {id,text}|null, isFollowing, createdAt}`, newest first. Never my own actions, nobody blocked either way. `isFollowing` = I follow the actor (for a "follow back" button).

**Push** (Expo, same as v5; new setting `social`)
- `GET/PATCH /api/me/notification-settings` gains `social` (default true): likes, comments, new followers.
- Like: title "Yeni bəyənmə" / "New like", body "X paylaşımınızı bəyəndi", data `{type:'post_like', postId}`. At most one per post per hour.
- Comment: "Yeni şərh" / "New comment", body "X: text", data `{type:'post_comment', postId, commentId}`. Several comments by the same person on one post within a minute give one.
- Follow: "Yeni izləyici" / "New follower", body "X sizi izləməyə başladı", data `{type:'follow', userId}` (the follower). At most once per follower per hour.
- All on Android channel `messages`. Never for your own actions or when there is a block either way.

**Reports**: `POST /api/reports` accepts `targetType: 'post'` and `'comment'`. Things you can't see (drafts, blocked) give 404.

**Leaderboard**: `breakdown` gains `posts`. +3 per published post with at least one photo, max 10 posts per Baku month, counted at publish time. Deleted posts lose their points, and so do posts reported by 2 or more different users (same rule as spots). Add this to the "Xallar necə qazanılır?" sheet.

**Limits**
- Photo storage per user is now 50 MB for now (post photos included; about 300 post photos). Over it: 409 "Photo storage limit reached (50 MB)...". One user's uploads (avatar, car, clan logo, event cover, group photo, post photos) are checked one at a time, so uploads at the same moment can't go over it.
- The server logs one line with the total photo storage (MB stored, MB on disk, photo count) at startup and every 24 h.
- 20 posts per 24 h and 60 post photo uploads per 24 h per user (429 with `Retry-After`). Env `RATE_LIMIT_POSTS`, `RATE_LIMIT_POST_PHOTOS`.
- Likes + saves: 300 per hour. Comments: 60 per hour.

**Share links**: `/p/:id`, `/spot/:id`, `/event/:id` are served the web app (index.html) by the server; the app needs routes for them.

**Old friends endpoints (deprecated, still working for one release)**
- They stay in sync with follows: a friend request follows the other person, accept / auto-accept makes it mutual, cancel removes that follow (a follow that existed before the request stays), unfriend removes the follows both ways. Decline leaves the requester's follow (follows need no approval).
- Request and accept also respect the 5000 following limit (409).

**Database**
- Migration `server/drizzle/0007_v6_posts_follows.sql` only adds things: tables `posts`, `post_photos`, `post_likes`, `post_saves`, `post_comments`, `follows`, `followers_seen`; nullable `images.post_id` (photos are deleted with their post); `notification_settings.social` (default true).
- Data step (idempotent, `ON CONFLICT DO NOTHING`): every friendship → follows both ways; every pending friend request → a follow from the requester; declined requests and blocked pairs are skipped. Existing users get "followers seen = migration time", so migrated follows don't show as new followers. Tested on a v5 database with data.
- `demo remove` also deletes demo posts, likes, saves, comments, follows and reports about them.
