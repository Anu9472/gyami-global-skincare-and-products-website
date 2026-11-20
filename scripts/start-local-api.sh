#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$repository_root/scripts/local-development-env.sh"

cd "$repository_root"
exec npm exec --workspace @gyami-global/api nest start -- --watch
