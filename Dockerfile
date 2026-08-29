# syntax=docker/dockerfile:1.7

FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS development-dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY scripts/build-native.ts ./scripts/build-native.ts
COPY native/artifact-store-guard.c native/sqlite-file-identity.c ./native/
RUN npm ci --no-audit --no-fund

FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS builder

WORKDIR /app

ARG BUILD_SHA
ARG BUILD_ID
ARG BUILD_TIMESTAMP
ARG VITE_AZURE_CLIENT_ID
ARG VITE_AZURE_TENANT_ID
ARG VITE_API_SCOPE

ENV VITE_AUTH_MODE=entra \
  VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID \
  VITE_AZURE_TENANT_ID=$VITE_AZURE_TENANT_ID \
  VITE_API_SCOPE=$VITE_API_SCOPE

COPY --from=development-dependencies /app/node_modules ./node_modules
COPY --from=development-dependencies /app/native/build ./native/build
COPY . .
RUN npm run stamp:build \
  && npm run build:client

FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS production-dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY scripts/build-native.ts ./scripts/build-native.ts
COPY native/artifact-store-guard.c native/sqlite-file-identity.c ./native/
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS runner

WORKDIR /app

ARG BUILD_SHA
ARG BUILD_ID
RUN test -n "$BUILD_SHA" && test -n "$BUILD_ID"

LABEL org.opencontainers.image.source="https://github.com/EnzoLopez2023/ShapePilot" \
  org.opencontainers.image.revision=$BUILD_SHA \
  org.opencontainers.image.version=$BUILD_ID

ENV NODE_ENV=production \
  PORT=3000 \
  DB_PATH=/home/data/shapepilot.db \
  SQLITE_JOURNAL_MODE=DELETE \
  BACKUP_ROOT=/home/data/backups/shapepilot \
  RECOVERY_WORK_ROOT=/home/data/recovery/shapepilot

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=production-dependencies /app/native/build ./native/build
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/version.json ./version.json
COPY --chown=node:node lib ./lib
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/live',{cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok||b.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "scripts/start-production.ts"]
