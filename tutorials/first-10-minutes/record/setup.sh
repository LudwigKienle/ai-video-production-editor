#!/usr/bin/env bash
# One-time setup for recording: app dependencies, Electron main bundle, local Tailwind CSS.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$(cd "$here/../../.." && pwd)"
cache="$here/../.cache/tw"

(cd "$app" && [ -d node_modules ] || npm ci --no-audit --no-fund)
(cd "$app" && node scripts/build-main.js)

mkdir -p "$cache"
if [ ! -d "$cache/node_modules/tailwindcss" ]; then
  (cd "$cache" && npm init -y >/dev/null && npm i tailwindcss@3.4.17 --no-audit --no-fund)
fi
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > "$cache/in.css"
(cd "$cache" && npx tailwindcss -c "$here/tailwind.config.cjs" -i in.css -o tailwind.css --minify)
echo "Tailwind CSS: $cache/tailwind.css"
