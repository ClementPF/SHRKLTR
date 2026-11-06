# syntax=docker/dockerfile:1

# Static web export of apps/mobile, served by nginx. EXPO_PUBLIC_* values are inlined into the
# bundle at build time, so changing them means rebuilding this image.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace apps/mobile --include-workspace-root=false --no-audit --no-fund
COPY apps/mobile apps/mobile
WORKDIR /app/apps/mobile
ARG EXPO_PUBLIC_API_URL
ARG EXPO_PUBLIC_WEB_URL
ARG EXPO_PUBLIC_GOOGLE_CLIENT_ID
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_WEB_URL=$EXPO_PUBLIC_WEB_URL \
    EXPO_PUBLIC_GOOGLE_CLIENT_ID=$EXPO_PUBLIC_GOOGLE_CLIENT_ID \
    EXPO_PUBLIC_ENV=production \
    EXPO_PUBLIC_DEV_AUTH= \
    CI=1
RUN test -n "$EXPO_PUBLIC_API_URL" || { echo "EXPO_PUBLIC_API_URL build arg is required" >&2; exit 1; }
# Without it the bundle would fall back to http://localhost:8083 for app links.
RUN test -n "$EXPO_PUBLIC_WEB_URL" || { echo "EXPO_PUBLIC_WEB_URL build arg is required" >&2; exit 1; }
RUN npx expo export --platform web --output-dir dist

FROM nginx:stable-alpine AS serve
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
# A checkout made under a restrictive umask yields owner-only files; nginx must be able to read them.
COPY --from=build --chmod=a+rX /app/apps/mobile/dist /usr/share/nginx/html
EXPOSE 80
