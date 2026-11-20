#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$repository_root/scripts/local-development-env.sh"

postgres_prefix="$(brew --prefix postgresql@16)"
export PATH="$postgres_prefix/bin:$PATH"

brew services start postgresql@16 >/dev/null
for _ in {1..30}; do
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432 >/dev/null

if ! psql postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='gyami_global'" | grep -q 1; then
  psql postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE gyami_global LOGIN PASSWORD 'gyami_global-local'"
fi
if ! psql postgres -tAc "SELECT 1 FROM pg_database WHERE datname='gyami_global'" | grep -q 1; then
  createdb -O gyami_global gyami_global
fi

cd "$repository_root"
npm run prisma:generate --workspace @gyami-global/api
npm run prisma:migrate --workspace @gyami-global/api
npm run prisma:seed --workspace @gyami-global/api
echo "GYAMI Global PostgreSQL is ready on 127.0.0.1:5432."
