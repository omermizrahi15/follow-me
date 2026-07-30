#!/usr/bin/env bash
# Put a couple of images into the booted simulator's photo library.
#
# The add-post-photos E2E flow drives the real iOS photo picker, which shows an
# empty state (and no selectable cells) on a fresh CI simulator. The flow only
# needs *at least two* photos to exist — it asserts on the selection count the
# app reports, not on which images came back — so seeding the app's own assets
# is enough and keeps the run offline.
#
# Usage: scripts/seed-simulator-photos.sh   (a booted simulator is required)
set -euo pipefail

cd "$(dirname "$0")/.."

if ! xcrun simctl list devices booted | grep -q '('; then
  echo "error: no booted simulator — boot one first (xcrun simctl boot 'iPhone 16')." >&2
  exit 1
fi

xcrun simctl addmedia booted assets/icon.png assets/logo.png

echo "Seeded 2 images into the booted simulator's photo library."
