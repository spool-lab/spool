#!/usr/bin/env bash
#
# Build first-party connector tarballs into dist/bundled-connectors/
# for inclusion in Electron's resources directory via electron-builder's
# extraResources configuration.
#
# Called from packages/app/package.json's prebuild hook. Also runnable
# manually for dev mode:
#
#   scripts/build-bundled-connectors.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/packages/app/dist/bundled-connectors"
BUILD_ONLY=false
if [[ "${1:-}" == "--build-only" ]]; then
  BUILD_ONLY=true
fi

FIRST_PARTY_PLUGINS=(
  "@spool-lab/connector-twitter-bookmarks"
)

for plugin in "${FIRST_PARTY_PLUGINS[@]}"; do
  echo "==> Building $plugin"
  pnpm --filter "$plugin" build
done

if [[ "$BUILD_ONLY" == true ]]; then
  echo "==> Build-only mode, skipping pack"
  exit 0
fi

echo "==> Preparing $OUT_DIR"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.tgz

for plugin in "${FIRST_PARTY_PLUGINS[@]}"; do
  echo "==> Packing $plugin"
  pkg_dir="$(pnpm --filter "$plugin" exec pwd)"
  (cd "$pkg_dir" && pnpm pack --pack-destination "$OUT_DIR")
done

# Also pack the SDK so plugins can resolve @spool/connector-sdk at runtime
echo "==> Packing @spool/connector-sdk"
pnpm --filter @spool/connector-sdk build
sdk_dir="$(pnpm --filter @spool/connector-sdk exec pwd)"
(cd "$sdk_dir" && pnpm pack --pack-destination "$OUT_DIR")

echo "==> Bundled connectors ready:"
ls -lh "$OUT_DIR"/*.tgz
