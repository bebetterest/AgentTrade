#!/bin/sh
set -e

run_pre_migrations() {
  for file in prisma/pre_migrations/*.sql; do
    if [ -f "$file" ]; then
      node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file "$file"
    fi
  done
}

role="${SERVER_RUNTIME_ROLE:-api}"

case "$role" in
  api)
    # Run idempotent guards before db push and idempotent backfills/indexes after it.
    run_pre_migrations
    node_modules/.bin/prisma db push --schema prisma/schema.prisma
    run_pre_migrations
    exec node apps/server/dist/src/index.js
    ;;
  worker)
    exec node apps/server/dist/src/worker.js
    ;;
  *)
    echo "unsupported SERVER_RUNTIME_ROLE: $role" >&2
    exit 1
    ;;
esac
