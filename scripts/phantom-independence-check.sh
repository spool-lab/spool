#!/usr/bin/env bash
#
# Verify that a first-party connector plugin tarball can be `require`-d
# in isolation from the monorepo — no workspace-relative paths, no hidden
# imports. This is the split-readiness gate.
#
# Usage:
#   ./scripts/phantom-independence-check.sh <plugin-name>
# e.g.
#   ./scripts/phantom-independence-check.sh twitter-bookmarks
#
set -euo pipefail

PLUGIN="${1:-}"
if [[ -z "$PLUGIN" ]]; then
  echo "usage: $0 <plugin-name>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/packages/connectors/$PLUGIN"
SDK_DIR="$REPO_ROOT/packages/connector-sdk"
FULL_NAME="@spool-lab/connector-$PLUGIN"

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "plugin dir not found: $PLUGIN_DIR" >&2
  exit 2
fi

# Build fresh
echo "==> Building $FULL_NAME"
(cd "$REPO_ROOT" && pnpm --filter "$FULL_NAME" build)

echo "==> Building @spool/connector-sdk"
(cd "$REPO_ROOT" && pnpm --filter "@spool/connector-sdk" build)

# Create a staging temp dir — use a local name to avoid overriding $TMPDIR
WORK_DIR="$(mktemp -d -t spool-phantom-check-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Pack the plugin with pnpm — pnpm rewrites workspace: protocol refs to real semver
echo "==> Packing $FULL_NAME to $WORK_DIR"
(cd "$PLUGIN_DIR" && pnpm pack --pack-destination "$WORK_DIR")

TARBALL="$(ls "$WORK_DIR"/spool-lab-connector-"$PLUGIN"-*.tgz 2>/dev/null | head -1)"
if [[ -z "$TARBALL" ]]; then
  echo "tarball not found after pack in $WORK_DIR:" >&2
  ls "$WORK_DIR" >&2
  exit 1
fi

# Pack the SDK — it is marked private so pnpm pack refuses; use npm pack directly.
# The SDK has no workspace: deps so npm pack is fine here.
echo "==> Packing @spool/connector-sdk to $WORK_DIR"
(cd "$SDK_DIR" && npm pack --pack-destination "$WORK_DIR" 2>/dev/null)

SDK_TARBALL="$(ls "$WORK_DIR"/spool-connector-sdk-*.tgz 2>/dev/null | head -1)"
if [[ -z "$SDK_TARBALL" ]]; then
  echo "SDK tarball not found after pack in $WORK_DIR:" >&2
  ls "$WORK_DIR" >&2
  exit 1
fi

# Copy tarballs into the install dir so file: references are relative basenames
# (avoids npm path-handling quirks with absolute paths on some platforms)
INSTALL_DIR="$WORK_DIR/install-test"
mkdir -p "$INSTALL_DIR"
cp "$TARBALL"     "$INSTALL_DIR/plugin.tgz"
cp "$SDK_TARBALL" "$INSTALL_DIR/sdk.tgz"

cd "$INSTALL_DIR"

# Minimal package.json: explicit dep on both the plugin tarball and the SDK.
# The SDK is a peerDependency of the plugin so npm won't auto-install it;
# we list it here so it is present in the isolated node_modules.
cat > package.json <<EOF
{
  "name": "phantom-test",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "$FULL_NAME": "file:plugin.tgz",
    "@spool/connector-sdk": "file:sdk.tgz"
  }
}
EOF

echo "==> Installing plugin tarball in isolated environment"
npm install --no-audit --no-fund

echo "==> Requiring plugin entry point"
node --input-type=module -e "
import mod from '$FULL_NAME'
const Ctor = mod?.default ?? mod
if (!Ctor) {
  console.error('ERROR: default export is falsy')
  process.exit(1)
}
if (typeof Ctor !== 'function') {
  console.error('ERROR: default export is not a class/constructor, got: ' + typeof Ctor)
  process.exit(1)
}
console.log('OK: default export loaded and is constructor-shaped')
"

echo "==> Phantom independence check PASSED for $FULL_NAME"
