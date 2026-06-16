#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-LudwigKienle/ai-video-production-editor}"
DEFAULT_TEAM_ID="${APPLE_TEAM_ID:-5CCR39MBKP}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

echo "This sets GitHub Actions secrets for official desktop releases in ${REPO}."
echo "Export only the Developer ID Application identity as a .p12 before continuing."
echo

read -r -p "Path to exported Developer ID Application .p12: " P12_PATH
if [[ "$P12_PATH" == "~/"* ]]; then
  P12_PATH="${HOME}/${P12_PATH#"~/"}"
fi

if [[ ! -f "$P12_PATH" ]]; then
  echo "Error: .p12 file not found: ${P12_PATH}" >&2
  exit 1
fi

read -r -s -p "Password used when exporting the .p12: " MACOS_CERTIFICATE_PASSWORD
echo
read -r -p "Apple ID email for notarization: " APPLE_ID
read -r -s -p "Apple app-specific password: " APPLE_APP_SPECIFIC_PASSWORD
echo
read -r -p "Apple Team ID [${DEFAULT_TEAM_ID}]: " APPLE_TEAM_ID
APPLE_TEAM_ID="${APPLE_TEAM_ID:-$DEFAULT_TEAM_ID}"

if [[ -z "$MACOS_CERTIFICATE_PASSWORD" || -z "$APPLE_ID" || -z "$APPLE_APP_SPECIFIC_PASSWORD" || -z "$APPLE_TEAM_ID" ]]; then
  echo "Error: all secret values are required." >&2
  exit 1
fi

CERT_BASE64_FILE="$(mktemp)"
cleanup() {
  rm -f "$CERT_BASE64_FILE"
}
trap cleanup EXIT

base64 < "$P12_PATH" | tr -d '\n' > "$CERT_BASE64_FILE"

echo
echo "Uploading encrypted GitHub Actions secrets..."
gh secret set MACOS_CERTIFICATE_BASE64 --repo "$REPO" < "$CERT_BASE64_FILE"
printf '%s' "$MACOS_CERTIFICATE_PASSWORD" | gh secret set MACOS_CERTIFICATE_PASSWORD --repo "$REPO"
printf '%s' "$APPLE_ID" | gh secret set APPLE_ID --repo "$REPO"
printf '%s' "$APPLE_APP_SPECIFIC_PASSWORD" | gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo "$REPO"
printf '%s' "$APPLE_TEAM_ID" | gh secret set APPLE_TEAM_ID --repo "$REPO"

unset MACOS_CERTIFICATE_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID

echo
echo "Configured release secrets:"
gh secret list --repo "$REPO" | awk '{print "  - " $1}'
echo
echo "Next step: push a version tag, for example:"
echo "  git tag v2.5.0"
echo "  git push origin v2.5.0"
