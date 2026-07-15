#!/usr/bin/env bash
# Emit the set of Edge Functions affected by a diff, as a GitHub Actions matrix.
# A change under _shared/ affects ALL functions (they all depend on it).
# Writes `any` and `matrix` to $GITHUB_OUTPUT (or stdout when run locally).
# Env: BASE_SHA, HEAD_SHA.
set -euo pipefail

all_functions() {
  find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' \
    -exec basename {} \; | sort
}

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
HEAD="${HEAD_SHA:-HEAD}"
BASE="${BASE_SHA:-}"
if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
  BASE=$(git rev-parse "${HEAD}~1" 2>/dev/null || git rev-parse "$HEAD")
fi

CHANGED=$(git diff --name-only "$BASE" "$HEAD" -- supabase/functions/ 2>/dev/null || true)

if echo "$CHANGED" | grep -q '^supabase/functions/_shared/'; then
  FNS=$(all_functions)
else
  FNS=$(echo "$CHANGED" | grep -oE '^supabase/functions/[^/]+/' \
    | cut -d/ -f3 | grep -v '^_shared$' | sort -u || true)
fi

if [ -z "$FNS" ]; then
  echo "any=false" >> "$OUT"
  echo 'matrix={"fn":[]}' >> "$OUT"
  echo "No function changes detected." >&2
else
  JSON=$(printf '%s\n' $FNS | jq -R . | jq -cs .)
  echo "any=true" >> "$OUT"
  echo "matrix={\"fn\":$JSON}" >> "$OUT"
  echo "Changed services: $(echo $FNS | tr '\n' ' ')" >&2
fi
