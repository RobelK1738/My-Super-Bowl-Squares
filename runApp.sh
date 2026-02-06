#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but not found. Install Node.js and retry." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found. Install npm (or Node.js) and retry." >&2
  exit 1
fi

if [[ ! -f .env.local ]]; then
  cat <<'ENV_EOF' > .env.local
# Required: add your Gemini API key
GEMINI_API_KEY=
ENV_EOF
  echo "Created .env.local. Please set GEMINI_API_KEY before running the app." >&2
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting dev server..."
npm run dev
