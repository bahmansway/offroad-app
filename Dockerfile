# Railway builds this from the repo root. Website (Expo web export) + API in one service.

# ---- 1. Expo web export -> /app/dist ----
FROM node:22-slim AS web
WORKDIR /repo/app
COPY app/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY app/ ./
RUN npm run build:web

# ---- 2. Server build -> /repo/server/dist ----
FROM node:22-slim AS server
WORKDIR /repo/server
COPY server/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- 3. Runtime ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo/server
COPY --from=server /repo/server/node_modules ./node_modules
COPY --from=server /repo/server/dist ./dist
COPY --from=server /repo/server/drizzle ./drizzle
COPY --from=server /repo/server/package.json ./package.json
COPY --from=web /repo/app/dist /repo/app/dist
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
