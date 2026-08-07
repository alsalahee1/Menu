# syntax=docker/dockerfile:1

# --- build stage -----------------------------------------------------------
# better-sqlite3 ships prebuilt binaries for common platforms but falls back to
# compiling from source, so the build stage carries a toolchain the runtime
# image does not need.
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime stage ---------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_FILE=/data/menu.db \
    UPLOAD_DIR=/data/uploads

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# The database and uploaded images live on a volume so a redeploy keeps them.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

# Node handles SIGTERM directly for the graceful shutdown in server/index.js,
# and --init supplies a PID 1 that reaps zombies.
CMD ["node", "server/index.js"]
