#!/usr/bin/env bash
set -euo pipefail

# ==== CONFIG ====
APP_PATH="${APP_PATH:-}"                                # Path to your signed .app
DMG_NAME="${DMG_NAME:-MyApp.dmg}"                        # Output DMG name
VOL_NAME="${VOL_NAME:-MyApp Installer}"                  # DMG volume name
TEAM_ID="${TEAM_ID:-}"                                   # Apple Developer Team ID
KEYCHAIN_PROFILE="${KEYCHAIN_PROFILE:-}"                 # notarytool keychain profile
APPLE_ID="${APPLE_ID:-}"                                 # Apple ID (optional if using keychain profile)
APPLE_APP_SPECIFIC_PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-}" # App-specific password
EXTRA_MB="${EXTRA_MB:-50}"                               # Extra space in DMG
NOTARY_WAIT="${NOTARY_WAIT:-true}"                       # "true" to wait for result
# =================

if [ -z "$APP_PATH" ]; then
  APP_PATH="$(find release -maxdepth 3 -type d -name '*.app' -print -quit 2>/dev/null || true)"
  APP_PATH="${APP_PATH:-MyApp.app}"
fi

DMG_NAME="${DMG_NAME%.dmg}.dmg"

echo "==> Verifying app exists at: $APP_PATH"
if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found. Set APP_PATH or place your signed app here."
  exit 1
fi

echo "==> Verifying code signature"
if ! codesign --verify --deep --strict --verbose=2 "$APP_PATH"; then
  echo "Error: Code signature verification failed. Ensure the app and all nested items are signed with hardened runtime."
  exit 1
fi

APP_SIZE_KB="$(du -sk "$APP_PATH" | awk '{print $1}')"
SIZE_MB="$((APP_SIZE_KB / 1024 + EXTRA_MB))"

echo "==> Creating DMG workspace"
WORK_DIR="$(mktemp -d)"
SRC_DIR="$WORK_DIR/dmg_src"
MOUNT_POINT="$WORK_DIR/mount"
mkdir -p "$SRC_DIR" "$MOUNT_POINT"

cleanup() {
  if [ -n "${MOUNT_POINT:-}" ] && [ -d "$MOUNT_POINT" ]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  if [ -n "${WORK_DIR:-}" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

cp -R "$APP_PATH" "$SRC_DIR/"
ln -s /Applications "$SRC_DIR/Applications" || true

echo "==> Creating DMG (${SIZE_MB}m)"
hdiutil create -size "${SIZE_MB}m" -fs HFS+ -volname "$VOL_NAME" -ov -format UDRW "$WORK_DIR/temp.dmg" >/dev/null
hdiutil attach "$WORK_DIR/temp.dmg" -nobrowse -quiet -mountpoint "$MOUNT_POINT"
ditto "$SRC_DIR/." "$MOUNT_POINT"
hdiutil detach "$MOUNT_POINT" >/dev/null
MOUNT_POINT=""

hdiutil convert "$WORK_DIR/temp.dmg" -format UDZO -o "$WORK_DIR/$DMG_NAME" >/dev/null
mv "$WORK_DIR/$DMG_NAME" "./$DMG_NAME"

echo "==> DMG created: $DMG_NAME"

echo "==> Submitting DMG for notarization"
NOTARY_ARGS=(submit "$DMG_NAME")
if [ -n "$KEYCHAIN_PROFILE" ]; then
  NOTARY_ARGS+=(--keychain-profile "$KEYCHAIN_PROFILE")
else
  if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ] || [ -z "$TEAM_ID" ]; then
    echo "Error: Set KEYCHAIN_PROFILE or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/TEAM_ID."
    exit 1
  fi
  NOTARY_ARGS+=(--apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD")
fi
if [ "$NOTARY_WAIT" = "true" ]; then
  NOTARY_ARGS+=(--wait)
fi

SUBMIT_OUTPUT="$(xcrun notarytool "${NOTARY_ARGS[@]}" 2>&1)" || {
  echo "$SUBMIT_OUTPUT"
  echo "Error: Notarization submission failed."
  exit 1
}
echo "$SUBMIT_OUTPUT"

echo "==> Stapling ticket to DMG"
if ! xcrun stapler staple "$DMG_NAME"; then
  echo "Error: Stapling failed."
  exit 1
fi

echo "==> Validating stapling"
xcrun stapler validate "$DMG_NAME"

echo "==> Success!"
echo "Distributable DMG: $DMG_NAME"
