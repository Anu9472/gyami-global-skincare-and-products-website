#!/usr/bin/env bash
set -euo pipefail

# Run the mutating API workflow smoke test only against the disposable database
# supplied by CI (or an explicitly selected local development database). Public
# and private uploads are isolated in a temporary directory and removed on exit.
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repository_root"

: "${DATABASE_URL:?DATABASE_URL is required for the API workflow smoke test}"

export NODE_ENV="${NODE_ENV:-development}"
# Do not inherit a developer's API port. The smoke process must own an
# independent listener; otherwise a healthy process on port 4000 can mask a
# failed smoke build and make the workflow result untrustworthy.
export PORT="${GYAMI_GLOBAL_SMOKE_PORT:-4010}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-ci-api-access-secret-with-at-least-32-characters}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-ci-api-refresh-secret-with-at-least-32-characters}"
export BANK_DATA_ENCRYPTION_KEY="${BANK_DATA_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175}"
export CUSTOMER_WEB_URL="${CUSTOMER_WEB_URL:-http://127.0.0.1:5173}"
export SHIPPING_PROVIDER="${SHIPPING_PROVIDER:-DEVELOPMENT}"
export WHATSAPP_PROVIDER="${WHATSAPP_PROVIDER:-DEVELOPMENT}"
export SMS_PROVIDER="${SMS_PROVIDER:-UNCONFIGURED}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@gyami_global.test}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-Demo@12345Secure}"
export DEMO_VENDOR_EMAIL="${DEMO_VENDOR_EMAIL:-vendor@gyami_global.test}"
export DEMO_VENDOR_PASSWORD="${DEMO_VENDOR_PASSWORD:-Demo@12345Secure}"
export DEMO_CUSTOMER_PASSWORD="${DEMO_CUSTOMER_PASSWORD:-Demo@12345Secure}"

smoke_storage="$(mktemp -d "${TMPDIR:-/tmp}/gyami_global-api-smoke.XXXXXX")"
export PRIVATE_UPLOAD_DIR="$smoke_storage/private"
export PUBLIC_UPLOAD_DIR="$smoke_storage/public"
mkdir -p "$PRIVATE_UPLOAD_DIR" "$PUBLIC_UPLOAD_DIR"

api_pid=""
cleanup() {
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  rm -rf "$smoke_storage"
}
trap cleanup EXIT

npm run prisma:seed --workspace @gyami-global/api
node apps/api/dist/src/main.js &
api_pid="$!"

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/v1/health/ready" >/dev/null; then
    GYAMI_GLOBAL_API_URL="http://127.0.0.1:${PORT}/api/v1" node scripts/smoke-api-workflow.mjs --execute
    exit 0
  fi
  sleep 0.5
done

echo "API did not become ready for the workflow smoke test." >&2
exit 1
