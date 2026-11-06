# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app

# Install backend dependencies from the workspace lockfile.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace apps/backend --include-workspace-root=false --no-audit --no-fund

# Development: source is bind-mounted at /app/apps/backend by docker compose.
FROM deps AS dev
ENV NODE_ENV=development
WORKDIR /app/apps/backend
COPY docker/api/entrypoint.sh /usr/local/bin/api-entrypoint
ENTRYPOINT ["api-entrypoint"]
CMD ["npx", "tsx", "watch", "src/server.ts"]

FROM deps AS build
COPY apps/backend apps/backend
RUN npm run build --workspace apps/backend

# Production: compiled JS + production dependencies only.
FROM base AS prod
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace apps/backend --include-workspace-root=false --omit=dev --no-audit --no-fund \
  && npm cache clean --force
COPY --from=build /app/apps/backend/dist apps/backend/dist
# Share card fonts: tsc copies no assets and @expo-google-fonts/inter is only a dev dependency.
COPY --from=build \
  /app/node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf \
  /app/node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf \
  /app/node_modules/@expo-google-fonts/inter/LICENSE_FONT \
  apps/backend/dist/assets/fonts/
COPY apps/backend/drizzle apps/backend/drizzle
WORKDIR /app/apps/backend
USER node
EXPOSE 3100
CMD ["node", "dist/server.js"]
