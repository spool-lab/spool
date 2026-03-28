#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Helpers ──
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
dim()   { printf "\033[90m%s\033[0m\n" "$*"; }

# ── Preflight ──
command -v gh   >/dev/null || { red "gh CLI not found"; exit 1; }
command -v pnpm >/dev/null || { red "pnpm not found"; exit 1; }
command -v jq   >/dev/null || { red "jq not found"; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then
  red "Working tree is dirty. Commit or stash first."
  exit 1
fi

# ── Read current version ──
OLD_VERSION=$(jq -r .version package.json)
dim "Current version: $OLD_VERSION"

# ── Bump patch ──
IFS='.' read -r major minor patch <<< "$OLD_VERSION"
patch=$((patch + 1))
NEW_VERSION="$major.$minor.$patch"
green "Bumping to $NEW_VERSION"

# Update all package.json files
for f in package.json packages/app/package.json packages/core/package.json packages/cli/package.json packages/landing/package.json; do
  if [[ -f "$f" ]]; then
    jq --arg v "$NEW_VERSION" '.version = $v' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

# ── Build ──
green "Building app..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
cd packages/app
pnpm run build
cd "$ROOT"

# ── Find DMG ──
DMG=$(find packages/app/dist -name "*.dmg" ! -name "*.blockmap" | head -1)
if [[ -z "$DMG" ]]; then
  red "No DMG found in packages/app/dist/"
  exit 1
fi

DMG_NAME="Spool-${NEW_VERSION}-arm64.dmg"
FINAL_DMG="packages/app/dist/$DMG_NAME"
mv "$DMG" "$FINAL_DMG"
green "DMG: $FINAL_DMG ($(du -h "$FINAL_DMG" | cut -f1))"

# ── Clean junk from dist ──
find packages/app/dist -maxdepth 1 \
  -not -name "$DMG_NAME" \
  -not -name "." \
  -not -name "mac-arm64" \
  -exec rm -rf {} + 2>/dev/null || true

# ── Generate release notes from commits since last tag ──
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  NOTES=$(git log "$LAST_TAG"..HEAD --pretty=format:"- %s" --no-merges)
else
  NOTES=$(git log --pretty=format:"- %s" --no-merges -20)
fi

TAG="v$NEW_VERSION"

# ── Commit, tag, push ──
git add -A
git commit -m "release: v$NEW_VERSION"
git tag -a "$TAG" -m "v$NEW_VERSION"
git push && git push --tags

# ── Create GitHub release ──
green "Creating GitHub release $TAG..."
NOTES_FILE=$(mktemp)
cat > "$NOTES_FILE" <<NOTES_EOF
## What's new

$NOTES

## Install

Download **$DMG_NAME** and drag Spool to your Applications folder.
Requires macOS on Apple Silicon (M1+).
NOTES_EOF

gh release create "$TAG" "$FINAL_DMG" \
  --title "Spool $NEW_VERSION" \
  --notes-file "$NOTES_FILE"

rm -f "$NOTES_FILE"

green "Done! https://github.com/spool-lab/spool/releases/tag/$TAG"
