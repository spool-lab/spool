#!/usr/bin/env bash
set -euo pipefail

# Spool installer — downloads the latest release and installs to /Applications
# Usage: curl -fsSL https://spool.pro/install.sh | bash

REPO="spool-lab/spool"
APP_NAME="Spool.app"
INSTALL_DIR="/Applications"

# ── Helpers ──
info()  { printf "\033[0;34m==>\033[0m \033[1m%s\033[0m\n" "$*"; }
ok()    { printf "\033[0;32m==>\033[0m \033[1m%s\033[0m\n" "$*"; }
err()   { printf "\033[0;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

# ── Checks ──
[[ "$(uname)" == "Darwin" ]] || err "Spool is macOS only."
[[ "$(uname -m)" == "arm64" ]] || err "Spool requires Apple Silicon (M1+)."
command -v curl >/dev/null || err "curl is required."

# ── Find latest release DMG ──
info "Finding latest release..."
DOWNLOAD_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -oE '"browser_download_url":[[:space:]]*"[^"]*arm64\.dmg"' \
  | head -1 \
  | sed -E 's/"browser_download_url":[[:space:]]*"//;s/"//')

[[ -n "$DOWNLOAD_URL" ]] || err "Could not find DMG in latest release."

VERSION=$(echo "$DOWNLOAD_URL" | grep -o '[0-9]*\.[0-9]*\.[0-9]*')
info "Downloading Spool ${VERSION}..."

# ── Download ──
TMPDIR_INSTALL=$(mktemp -d)
DMG_PATH="${TMPDIR_INSTALL}/Spool.dmg"
curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$DMG_PATH"

# ── Mount & copy ──
info "Installing to ${INSTALL_DIR}..."
MOUNT_POINT=$(hdiutil attach "$DMG_PATH" -nobrowse -quiet | tail -1 | sed 's/.*	//')

# Remove old version if exists
if [[ -d "${INSTALL_DIR}/${APP_NAME}" ]]; then
  rm -rf "${INSTALL_DIR}/${APP_NAME}"
fi

cp -R "${MOUNT_POINT}/${APP_NAME}" "${INSTALL_DIR}/"

# Unmount
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

# ── Cleanup ──
rm -rf "$TMPDIR_INSTALL"

ok "Spool ${VERSION} installed to ${INSTALL_DIR}/${APP_NAME}"
echo ""
echo "  Open Spool from your Applications folder, or run:"
echo "  open /Applications/Spool.app"
echo ""
