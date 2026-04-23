#!/usr/bin/env bash
#
# Pack a connector into a publish-ready tarball with @spool-lab/connector-sdk
# bundled inside it (bundledDependencies). Uses `pnpm deploy` to materialize
# deps into a hoisted node_modules, then `npm pack` to produce the tarball.
#
# `pnpm pack` alone errors with ERR_PNPM_BUNDLED_DEPENDENCIES_WITHOUT_HOISTED
# because the workspace uses isolated node-linker.
#
# Usage:
#   scripts/pack-connector.sh <plugin-name> [out-dir]
# e.g.
#   scripts/pack-connector.sh twitter-bookmarks /tmp/out
#
set -euo pipefail

PLUGIN="${1:-}"
OUT_DIR="${2:-$(mktemp -d -t spool-pack-XXXXXX)}"
if [[ -z "$PLUGIN" ]]; then
  echo "usage: $0 <plugin-name> [out-dir]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FULL_NAME="@spool-lab/connector-$PLUGIN"

if [[ ! -d "$REPO_ROOT/packages/connectors/$PLUGIN" ]]; then
  echo "plugin dir not found: packages/connectors/$PLUGIN" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
STAGE="$(mktemp -d -t spool-pack-stage-XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> Building $FULL_NAME and SDK"
pnpm --filter "$FULL_NAME" --filter "@spool-lab/connector-sdk" build

echo "==> Deploying $FULL_NAME to $STAGE (hoisted, prod-only)"
pnpm --filter "$FULL_NAME" deploy --prod --config.node-linker=hoisted "$STAGE"

echo "==> Packing tarball into $OUT_DIR"
# --ignore-scripts: the staged dir doesn't have the workspace scaffolding that
# prepack's `pnpm run build` expects. Build already ran above.
(cd "$STAGE" && npm pack --ignore-scripts --pack-destination "$OUT_DIR" >/dev/null)

TARBALL="$(ls "$OUT_DIR"/spool-lab-connector-"$PLUGIN"-*.tgz 2>/dev/null | head -1)"
if [[ -z "$TARBALL" ]]; then
  echo "tarball not found in $OUT_DIR:" >&2
  ls "$OUT_DIR" >&2
  exit 1
fi

# Sanity: confirm SDK was bundled
if ! tar -tzf "$TARBALL" | grep -q "package/node_modules/@spool-lab/connector-sdk/package.json"; then
  echo "SDK was not bundled into $TARBALL — bundledDependencies not honored?" >&2
  exit 1
fi

echo "==> $TARBALL"
