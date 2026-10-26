# syntax=docker/dockerfile:1
# The server edition: sign-in, library sync (SQLite on the /data volume) and the AI assistant.
# Configuration comes from the environment (see .env.example).

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
# postinstall generates the Prisma client, copies the MediaPipe runtime and downloads the pose model.
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/public/mediapipe ./public/mediapipe
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATABASE_URL=file:/data/pose-studio.db
RUN groupadd -r app && useradd -r -g app app && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/prisma/migrations ./prisma/migrations
COPY --from=build --chown=app:app /app/scripts/migrate.mjs ./scripts/migrate.mjs
USER app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Bring the database up to date, then serve.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
