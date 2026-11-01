#!/bin/sh
set -e
# A fresh checkout may have no generated migrations yet; drizzle-kit migrate then has nothing to do.
if ls drizzle/*/migration.sql >/dev/null 2>&1; then
  npx drizzle-kit migrate
else
  echo "No drizzle migrations found; skipping migrate"
fi
exec "$@"
