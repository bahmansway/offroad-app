# Offroad App (working name — final name TBD)

## What it is
A community app that brings all offroad drivers into one place. Launch market: **Azerbaijan** (Azerbaijani + English, map centered on Baku). Owner: Bahman (no coding background — keep explanations short and plain).

### Core features
1. **Accounts** — people sign up and log in (email + password first; phone/Google later).
2. **Spots map** — users share good offroad places and campsites with photos, description, coordinates, season/access notes.
3. **Difficulty levels** for trails: 1 Easy (any SUV) · 2 Moderate (AWD, good tyres) · 3 Hard (4x4 low range, AT tyres) · 4 Extreme (lockers, lift, winch) · 5 Expert only.
4. **Events** — create a trip/meetup on a spot, date, max cars, min difficulty/vehicle requirement; others join.
5. **Garage** — each user's car profile (make, model, year, photos). Other users rate cars (1–5 stars).
6. **Modifications** — listed under each car: part, category (lift, tyres, winch, bumpers, lighting, armour, engine…), optional price + currency (AZN default) shown publicly only if the owner chooses; total spend per car.
7. **Chat & clans** — direct messages, clan group chat, event chat. Clans have a name, logo, leader, members, join requests.

## How the pieces fit
- `app/` — **Expo** (React Native) app with expo-router. One codebase → iPhone, Android and website.
- `server/` — **Node + Fastify** API, **PostgreSQL** (Drizzle ORM), **Socket.IO** for live chat.
- Maps: **MapLibre** with free OpenStreetMap-based tiles (no Google Maps bill).
- Photos: Railway storage bucket (S3-compatible), resized before upload.

## Hosting (cheapest reliable, ~$5/month)
- Railway hobby plan: API service + Postgres + bucket. Website build served from the API service.
- Phone apps: Expo Go for testing; store builds later via EAS when Bahman is ready.

## Local testing
```
cd server && npm install && npm run dev     # API on :4000 (needs DATABASE_URL)
cd app && npm install && npx expo start     # press w for web, scan QR for phone
```
- Local Postgres: `runuser -u claude -- npm --prefix server run db:start` / `db:stop` (port 5433, data in .pgdata). Tests: `cd server && npm test`.
- Web dev (`expo start --web` on :8081) needs `CORS_ORIGIN=http://localhost:8081` in server/.env.
- Installing Expo packages in the cloud sandbox: prefix with `EXPO_OFFLINE=1` (proxy blocks Expo's version check).
- Store/EAS phone builds must set `EXPO_PUBLIC_API_URL` to the https Railway URL.
- Railway deploys the repo root `Dockerfile` (web export + server). Needs `DATABASE_URL` and a random `JWT_SECRET` (≥32 chars).

## Rules
- No secrets in code — use environment variables (`.env` is git-ignored).
- Validate all input on the server (zod). Never trust the app.
- Passwords hashed (argon2). Auth via short-lived JWT + refresh token.
- Users can only edit/delete their own spots, cars, mods, events, messages; clan leaders manage their clan.
- Exact home locations are never shown; spot coordinates are only what the user chose to share.
- Report/block button on users, spots and messages from day one.
- Only the coordinator deploys, and only after review + tests pass.
- Texts in the app go through the translation files (az, en) — no hard-coded strings.

## Team
| Agent | Job |
|---|---|
| designer | Design system, screen mockups, UX copy (az + en) |
| builder | Writes app + server code |
| reviewer | Code review: security, privacy, correctness |
| tester | Runs tests, clicks through flows on web + phone sizes |
| researcher | Looks things up: map tiles, regulations, competitor apps |

No AI features yet, so no ai-engineer.
