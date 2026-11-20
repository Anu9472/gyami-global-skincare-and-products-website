#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$repository_root/scripts/local-development-env.sh"

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "PostgreSQL tools are not installed. Run: npm run db:setup:mac"
  exit 1
fi

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "Local PostgreSQL is not running. Run: npm run db:setup:mac"
  exit 1
fi

cd "$repository_root"
pids=()

shutdown() {
  trap - EXIT INT TERM
  for pid in "${pids[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  wait >/dev/null 2>&1 || true
}
trap shutdown EXIT INT TERM

start_service() {
  local name="$1"
  shift
  echo "Starting $name..."
  "$@" &
  pids+=("$!")
}

start_service "API (http://127.0.0.1:4000)" npm exec --workspace @gyami-global/api nest start -- --watch
start_service "Customer storefront (http://127.0.0.1:5173)" npm run dev --workspace @gyami-global/customer-web
start_service "Vendor panel (http://127.0.0.1:5174)" npm run dev --workspace @gyami-global/vendor-panel
start_service "Admin panel (http://127.0.0.1:5175)" npm run dev --workspace @gyami-global/admin-panel

echo "GYAMI Global local stack is starting. Press Ctrl+C once to stop all services."
wait "${pids[@]}"
