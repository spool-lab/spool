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
FULL_NAME="@spool-lab/connector-$PLUGIN"

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "plugin dir not found: $PLUGIN_DIR" >&2
  exit 2
fi

WORK_DIR="$(mktemp -d -t spool-phantom-check-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Pack via the shared script — produces a tarball with SDK bundled inside
# (bundledDependencies). SDK does NOT need to be separately installed.
echo "==> Packing $FULL_NAME (SDK bundled inside)"
bash "$REPO_ROOT/scripts/pack-connector.sh" "$PLUGIN" "$WORK_DIR"

TARBALL="$(ls "$WORK_DIR"/spool-lab-connector-"$PLUGIN"-*.tgz 2>/dev/null | head -1)"
if [[ -z "$TARBALL" ]]; then
  echo "tarball not found after pack in $WORK_DIR:" >&2
  ls "$WORK_DIR" >&2
  exit 1
fi

INSTALL_DIR="$WORK_DIR/install-test"
mkdir -p "$INSTALL_DIR"
cp "$TARBALL" "$INSTALL_DIR/plugin.tgz"

cd "$INSTALL_DIR"

cat > package.json <<EOF
{
  "name": "phantom-test",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "$FULL_NAME": "file:plugin.tgz"
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
